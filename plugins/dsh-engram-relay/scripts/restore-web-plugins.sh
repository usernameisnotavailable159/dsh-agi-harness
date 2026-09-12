#!/usr/bin/env bash
# restore-web-plugins.sh — 恢复被"临时禁用几乎所有插件"清掉的 web profile 插件面。
#
# 背景（2026-09-12 事故）：
#   为规避 "Cannot read properties of undefined (reading 'kind')" 崩溃，
#   ~/.dsh/profiles/web 被就地改写：
#     · package.json  dsh.profile.bundles  15 项 → 2 项（只剩 dsh-base + dsh-web-app）
#     · cordis.patch.yml                    4527 B → 2 B（内容变成 "[]"）
#   真正的根因是 dsh-engram-relay 的 pre-step 注入消息缺 source（已修复，见
#   plugins/dsh-engram-relay/tests/pre-step-message-contract.test.mjs），
#   禁用插件只是绕开，不是修复。
#
# 本脚本：默认 dry-run（只打印将做什么）。加 --apply 才真的写。
#   ./restore-web-plugins.sh            # 预演
#   ./restore-web-plugins.sh --apply    # 执行（自动先备份当前状态）
#
# 前置：先跑离线组合验证（不碰线上）——
#   DSH_HOME=<验证目录> dsh --profile web --dump-config
set -euo pipefail

PROFILE_DIR="${PROFILE_DIR:-$HOME/.dsh/profiles/web}"
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

PKG="$PROFILE_DIR/package.json"
PATCH="$PROFILE_DIR/cordis.patch.yml"
# 事故前的完好备份（15 bundles / 1646 B）
PKG_BAK="${PKG_BAK_OVERRIDE:-$PROFILE_DIR/package.json.bak-20260912-103142}"
#
# ⚠️ patch 层必须用 **10:21:31** 那份，不能用 cordis.patch.yml.bak：
#   cordis.patch.yml.bak        (10:28:50, 4527B) 含 4 条 `# dsh-fix:` 自动注入条目，
#        把 compaction-basic / command-compact / undo-snapshot / dsh-market
#        从用户明确设置的 disabled:false **翻回 true**（写它的工具已不在磁盘上）。
#        用这份 = 把机器擅自禁用的状态当成用户意图，/compact、undo、插件市场会继续失效。
#   .bak-20260912022131         (10:21:31, 4087B) 是 dsh-fix 注入**之前**的快照，
#        = 用户真实意图（含 10:09 拍板的 ccrb 禁用 + 四项 disabled:false）。
PATCH_BAK="${PATCH_BAK_OVERRIDE:-$PROFILE_DIR/cordis.patch.yml.bak-20260912022131}"

die() { echo "❌ $*" >&2; exit 1; }

[ -f "$PKG" ]        || die "找不到 $PKG"
[ -f "$PKG_BAK" ]    || die "找不到备份 $PKG_BAK（恢复 bundles 需要它）"
[ -f "$PATCH_BAK" ]  || die "找不到备份 $PATCH_BAK（恢复 patch 需要它）"
if grep -q "dsh-fix:" "$PATCH_BAK" 2>/dev/null; then
  echo "⚠️  警告：$PATCH_BAK 含 '# dsh-fix:' 自动注入条目——" >&2
  echo "     它们会把用户明确启用的插件翻回 disabled:true。建议改用不含 dsh-fix 的快照：" >&2
  echo "       PATCH_BAK_OVERRIDE=$PROFILE_DIR/cordis.patch.yml.bak-20260912022131 $0 $*" >&2
fi

echo "=== 现状 ==="
python3 - "$PKG" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
b=d.get('dsh',{}).get('profile',{}).get('bundles',[])
print(f"  bundles: {len(b)} 项")
for x in b: print(f"     - {x}")
PY
echo "  cordis.patch.yml: $(wc -c <"$PATCH") B"

echo
echo "=== 将恢复为 ==="
python3 - "$PKG_BAK" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
b=d.get('dsh',{}).get('profile',{}).get('bundles',[])
print(f"  bundles: {len(b)} 项")
for x in b: print(f"     - {x}")
PY
echo "  cordis.patch.yml: $(wc -c <"$PATCH_BAK") B"

# 安全闸：确认备份里引用的第三方包都真实存在（否则恢复后启动会找不到插件）
echo
echo "=== 依赖可用性检查（无需联网）==="
python3 - "$PKG_BAK" "$PROFILE_DIR/node_modules" <<'PY'
import json,os,sys
d=json.load(open(sys.argv[1])); nm=sys.argv[2]
missing=[]
for k in d['dsh']['profile']['bundles']:
    # dsh-base / dsh-web-app 由 DSH 安装本体解析，不在 profile/node_modules 下
    if k.startswith('@deepseek-ai/dsh-'): continue
    if not os.path.exists(os.path.join(nm,k)): missing.append(k)
if missing:
    print("  ⚠️  缺失:", ", ".join(missing)); sys.exit(1)
print("  ✓ 全部 13 个第三方插件目录存在")
PY

if [ "$APPLY" -eq 0 ]; then
  echo
  echo "（dry-run）未改动任何文件。加 --apply 执行。"
  exit 0
fi

TS=$(date +%Y%m%d-%H%M%S)
echo
echo "=== 备份当前状态 ==="
cp -a "$PKG"   "$PKG.pre-restore-$TS"
cp -a "$PATCH" "$PATCH.pre-restore-$TS"
echo "  $PKG.pre-restore-$TS"
echo "  $PATCH.pre-restore-$TS"

echo "=== 恢复 ==="
cp -a "$PKG_BAK"   "$PKG"
cp -a "$PATCH_BAK" "$PATCH"
echo "  bundles → $(python3 -c "import json;print(len(json.load(open('$PKG'))['dsh']['profile']['bundles']))") 项"
echo "  cordis.patch.yml → $(wc -c <"$PATCH") B"

echo
echo "=== 校验 JSON/YAML 可解析 ==="
python3 -c "import json;json.load(open('$PKG'));print('  ✓ package.json JSON 合法')"
if command -v python3 >/dev/null; then
python3 - "$PATCH" <<'PY'
import sys
try:
    import yaml
except ImportError:
    print("  (无 pyyaml，跳过 YAML 解析检查)"); raise SystemExit(0)
yaml.safe_load(open(sys.argv[1])); print("  ✓ cordis.patch.yml YAML 合法")
PY
fi

echo
echo "✅ 已恢复。下一步："
echo "   1) 重启 dsh 使其生效（patchReload: live 只对插件文件热更，bundles 变更需重启）："
echo "        pkill -f 'dsh --profile web' ; dsh --profile web --port 3080"
echo "   2) 重启后确认插件面：dsh --profile web --dump-config | grep -c 'engram-relay'"
echo "   3) 若出现问题，回滚："
echo "        cp -a $PKG.pre-restore-$TS $PKG"
echo "        cp -a $PATCH.pre-restore-$TS $PATCH"
