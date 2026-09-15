#!/usr/bin/env node
/**
 * backfill-presets —— 一次性回填 v0.8.42 的会话级预设记录。
 *
 * 为什么需要：持久化只对「修复上线之后发生的 agent-preset/selected」生效；现存会话
 * 在盘上没有记录 ⇒ 新进程续跑时仍会退回创建时 header 值（根因 6）。
 * 本脚本从转录里取**最后一条** `agent-preset/selected`（只认事件来源，规则与插件一致：
 * header 推导值绝不入盘），合并进 closedloop-presets.json。
 *
 * 用法：node plugins/dsh-closedloop-mode/scripts/backfill-presets.mjs [--dry-run]
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

// 双端可用：DSH_HOME 优先，其次 ~/.dsh（PC=WSL 与 Termux 都是这个布局）。
// 案底：初版把 /home/hiro 写死，手机上直接 ENOENT（scandir '/home/hiro/.dsh/sessions'）；
// 采集设备不同（PC 用 root、手机用 rish），转录目录可能不可读，故 readdirSync 要守卫。
const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const SESS = join(HOME, 'sessions')
const OUT = join(HOME, 'closedloop-presets.json')
const dry = process.argv.includes('--dry-run')

let rec = {}
try { if (existsSync(OUT)) rec = JSON.parse(readFileSync(OUT, 'utf8')) } catch { rec = {} }
const before = Object.keys(rec).length

let scanned = 0, withSel = 0, skipped = 0
let projects = []
try { projects = readdirSync(SESS) } catch { projects = [] } // 目录不存在/不可读=按 0 处理，不抛
for (const proj of projects) {
  let dirs = []
  try { dirs = readdirSync(join(SESS, proj)) } catch { continue }
  for (const d of dirs) {
    let file = null
    for (const fn of ['session.v3.jsonl.zstd', 'session.jsonl.zstd']) {
      const p = join(SESS, proj, d, fn)
      if (existsSync(p)) { file = p; break }
    }
    if (!file) continue
    scanned++
    let data = ''
    try { data = execFileSync('zstdcat', [file], { maxBuffer: 256 * 1024 * 1024 }).toString('utf8') } catch { skipped++; continue }
    let last = null
    for (const line of data.split('\n')) {
      if (!line.includes('"agent-preset/selected"')) continue
      try { const v = JSON.parse(line).data?.agentPreset; if (v) last = String(v).trim() } catch { /* 跳过坏行 */ }
    }
    if (last) { rec[d] = last; withSel++ }
  }
}

console.log(`扫描转录 ${scanned} 份（读失败 ${skipped}），其中带选择事件 ${withSel} 份`)
console.log(`记录条数：${before} → ${Object.keys(rec).length}${dry ? '（dry-run，未写盘）' : ''}`)
if (!dry) {
  mkdirSync(dirname(OUT), { recursive: true })
  const tmp = OUT + '.tmp-' + process.pid
  writeFileSync(tmp, JSON.stringify(rec))
  renameSync(tmp, OUT) // 原子替换
  console.log(`已写入 ${OUT}（${statSync(OUT).size} 字节）`)
}
// 抽查：取记录里第一条做样例（不写死某个设备的会话 ID——案底：初版写死 PC 的 c948ebf5，手机上恒为(无记录)）
const sample = Object.entries(rec).slice(0, 3)
console.log(sample.length ? `抽查 ${sample.length} 条：${sample.map(([k, v]) => `${k.slice(0, 18)}…→${v}`).join('  ')}` : '抽查：记录为空')
console.log(`输出文件：${OUT}`)
