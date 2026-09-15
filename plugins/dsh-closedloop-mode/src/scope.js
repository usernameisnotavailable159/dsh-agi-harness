/**
 * v0.8.9 预设作用域（开发者定向：列出全部预设，逐个开关，拨即生效，无保存按钮）。
 *
 * 语义：默认**全开**；`disabled` 名单内的预设关闭本插件的自动行为
 * （autoStart / 引导与状态面注入 / 写闸）。无预设会话用键 `(无预设)`。
 *
 * 生效配置三级优先：文件活值（DSH_HOME/closedloop-scope.json）> 进程覆盖（installSection setSource）> 挂载 config。
 *
 * 边界：
 *  - 显式 /optimal 命令不受作用域限制（用户主动=尊重，任何预设可用）；
 *  - 工具本体仍注册（host 级），未启用会话无盘档状态，调用即被状态闸拒绝——无副作用；
 *  - 案底：惰性 ctx.inject(['settings']) 使 fiber 挂未决依赖→reload 无界等待卡死；
 *    现改硬依赖 + 同步 installSection（宿主服务该命名空间，卡片才派发），reload 秒回。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const NO_PRESET = '(无预设)'
export const SCOPE_NS = 'closedloop'
const dshHome = () => process.env.DSH_HOME || join(homedir(), '.dsh')

/**
 * v0.8.42 会话级预设**持久化**（开发者定向方案 B，2026-09-15）
 *
 * 案底：`agent-preset/selected` 只在该次进程送达。新进程里**续跑**的会话，notePreset 只能
 * 用 `session.header.agentPreset` 兜底，而头里存的是**创建时**预设 ⇒ 用户后切的
 * daily/teacher 形同不存在，禁用预设被接管。
 * 实测（2026-09-15 session-c948ebf5-27f0-47ff-975f-02064cadecb2）：
 *   会话头 router-spec / 选择事件 teacher（在上一进程） ⇒ 当前进程闸按 router-spec 放行，
 *   21:35:05 注入第一拍并落写闸；而 GET /graded-mode/api/scope 自报 disabled=[daily,teacher]。
 *
 * 修法：只把**事件来源**的预设视为权威并落盘（sid→preset，原子替换），新进程先读盘再退 header。
 * 边界：
 *  - 从不记录 header 推导值 —— 否则会把"过期值"钉死在盘上；
 *  - 无记录的会话（真没切过预设）行为与从前完全一致（走 header 兜底）；
 *  - 磁盘损坏/不可写一律静默回退，不影响判定主链。
 */
export const PRESET_RECORD_MAX = 2000
const presetRecordFile = () => join(dshHome(), 'closedloop-presets.json')
let presetRecordCache = { mtimeMs: -1, val: {} }

/** 读盘上记录（按 mtime 缓存；缺文件/损坏/非法一律返回 {}，绝不抛）。 */
export function loadPresetRecord() {
  try {
    const f = presetRecordFile()
    if (!existsSync(f)) return {}
    const st = statSync(f)
    if (presetRecordCache.mtimeMs !== st.mtimeMs) {
      const raw = JSON.parse(readFileSync(f, 'utf8'))
      const val = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {}
      presetRecordCache = { mtimeMs: st.mtimeMs, val }
    }
    return presetRecordCache.val
  } catch { return {} }
}

/** 落盘一条权威记录（先写临时文件再 rename=原子替换，读方永不会看到半截 JSON）。 */
export function recordPreset(sid, preset) {
  try {
    const s = normalizePreset(sid); const p = normalizePreset(preset)
    if (!s || !p) return false
    const val = { ...loadPresetRecord() }
    val[s] = p
    const keys = Object.keys(val)
    if (keys.length > PRESET_RECORD_MAX) for (const k of keys.slice(0, keys.length - PRESET_RECORD_MAX)) delete val[k]
    const f = presetRecordFile()
    mkdirSync(dirname(f), { recursive: true })
    const tmp = f + '.tmp-' + process.pid
    writeFileSync(tmp, JSON.stringify(val))
    renameSync(tmp, f)
    presetRecordCache = { mtimeMs: statSync(f).mtimeMs, val }
    return true
  } catch { return false }
}

/** 预设发现（多根合并）：用户 DSH_HOME/.agent-presets + DSH 内置包 presets/。
 *  内置包非本插件依赖，解析失败时按常见全局安装路径兜底（全部 existsSync 守卫，缺了不报错）。 */
function presetRoots() {
  const roots = [join(dshHome(), '.agent-presets')]
  const pkgs = []
  try { pkgs.push(dirname(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-agent-presets/package.json'))) } catch { /* 非依赖，走兜底 */ }
  pkgs.push(join(homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-agent-presets'))
  for (const p of pkgs) {
    try { const dir = join(p, 'presets'); if (existsSync(dir) && !roots.includes(dir)) roots.push(dir) } catch { /* 跳过 */ }
  }
  return roots
}

/** 清单：(无预设) 恒列首位，其余跨根去重后按名排序。 */
export function listPresets() {
  const names = new Set()
  for (const root of presetRoots()) {
    try {
      for (const d of readdirSync(root, { withFileTypes: true })) if (d.isDirectory()) names.add(d.name)
    } catch { /* 根不存在=跳过 */ }
  }
  return [NO_PRESET, ...[...names].sort()]
}

/** 值校验：只认 { disabled: string[] }，非法拒写不污染已存值。 */
export function validateScopeValue(v) {
  if (!v || typeof v !== 'object') throw new Error('作用域配置须为对象')
  if (!Array.isArray(v.disabled) || v.disabled.some((x) => !String(x).trim())) throw new Error('disabled 须为字符串数组')
  return { disabled: [...new Set(v.disabled.map((x) => String(x).trim()))] }
}

/**
 * v0.8.40 预设追踪（2026-09-13 实测定因后的修复）
 *
 * 案底：dsh 0.1.5 把「当前预设」做成 Session **projection**，不是 session 属性 ——
 *   `@deepseek-ai/dsh-agent-presets/lib`：`agentPresetProjectionDefinition`
 *   （key=agentPreset，init=header.agentPreset，apply=`agent-preset/selected` 事件）。
 *   原实现读 `session?.agentPreset || session?.preset` 永远得到 undefined
 *   → 一律 fallback 成 `(无预设)`，导致预设作用域**实际失效**：
 *     · 想关掉 daily/teacher 关不掉（永远匹配不到）
 *     · 一旦把 `(无预设)` 加进禁用名单 → **所有会话**被静默跳过（本次故障）
 *
 * 修法：按会话自己维护预设 —— 在 session/event 钩子里捕获 `agent-preset/selected`
 *   （实测该事件在 `user/message` **之前**送达，见 2026-09-13 探针日志），
 *   首次见到会话时用 header 值兜底。
 */
const presetBySession = new Map()
const PRESET_CACHE_MAX = 500

function normalizePreset(v) {
  const s = typeof v === 'string' ? v.trim() : ''
  return s || null
}

/** 记录/更新某会话的当前预设（幂等；由 session/event 与 pre-step 调用）。 */
export function notePreset(session, event) {
  const sid = session?.id
  if (!sid) return
  const fromEvent = event?.type === 'agent-preset/selected' ? normalizePreset(event?.data?.agentPreset) : null
  if (fromEvent) {
    presetBySession.set(sid, fromEvent)
    recordPreset(sid, fromEvent) // v0.8.42：只有事件来源才算权威 ⇒ 落盘供新进程续跑时恢复
  } else if (!presetBySession.has(sid)) {
    const init = normalizePreset(loadPresetRecord()[sid]) // v0.8.42：盘上记录优先于会话头（头里是创建时值）
      || normalizePreset(session?.header?.agentPreset)
      || normalizePreset(session?.agentPreset)
      || normalizePreset(session?.preset)
    if (init) presetBySession.set(sid, init)
  }
  if (presetBySession.size > PRESET_CACHE_MAX) {
    for (const k of presetBySession.keys()) {
      if (presetBySession.size <= PRESET_CACHE_MAX) break
      presetBySession.delete(k)
    }
  }
}

/** 该会话当前预设：已追踪值优先，其次**盘上记录**（v0.8.42，新进程续跑），再 header/属性兜底，最后 `(无预设)`。 */
export function presetOf(session) {
  const sid = session?.id
  const tracked = sid ? presetBySession.get(sid) : null
  return normalizePreset(tracked)
    || normalizePreset(sid ? loadPresetRecord()[sid] : null)
    || normalizePreset(session?.header?.agentPreset)
    || normalizePreset(session?.agentPreset)
    || normalizePreset(session?.preset)
    || NO_PRESET
}

/** 判定：名单内=关闭；缺字段/空名单=全开。 */
export function presetAllowed(session, config) {
  const disabled = Array.isArray(config?.disabled) ? config.disabled : []
  return !disabled.includes(presetOf(session))
}

const scopeFile = () => join(dshHome(), 'closedloop-scope.json')
let fileCache = { size: -1, val: null }

export function liveScopeFromFile() {
  try {
    if (!existsSync(scopeFile())) return null
    const buf = readFileSync(scopeFile())
    if (fileCache.size !== buf.length) fileCache = { size: buf.length, val: validateScopeValue(JSON.parse(buf.toString('utf8'))) }
    return fileCache.val
  } catch { return null }
}

export function writeScopeFile(v) {
  const val = validateScopeValue(v)
  const f = scopeFile()
  try { mkdirSync(dirname(f), { recursive: true }) } catch { /* 已存在 */ }
  writeFileSync(f, JSON.stringify(val))
  fileCache = { size: -1, val: null }
  return liveScopeFromFile() || val
}

let liveOverride = null // 快照对象或 installSection setSource 给的取值函数
export function setLiveScope(v) {
  if (typeof v === 'function') liveOverride = v
  else if (v && typeof v === 'object') { const val = validateScopeValue(v); liveOverride = () => val }
  else liveOverride = null
}
export function getLiveScope() { try { return liveOverride ? liveOverride() : null } catch { return null } }

/** 生效配置：文件活值 > 进程覆盖 > 挂载 config。 */
export function effectiveScopeConfig(config) { return liveScopeFromFile() || getLiveScope() || config }

/** v0.8.28 卡片落盘镜像（案底：onChange 曾是空函数）：宿主 settings 节写入后调用，
 *  把宿主活值同步进活值文件。旧行为下卡片写宿主、插件读文件——文件里的旧值把新值盖住，
 *  表现为「关掉之后又变成全选、没有保存」。非法活值不写（抛错由调用方吞，不污染已存值）。 */
export function mirrorScopeToFile() {
  const v = getLiveScope()
  if (!v) return null
  return writeScopeFile(v)
}

/** v0.8.29 装载期护栏（案底 2026-09-08：用户「选完退出又全选」）。
 *  宿主 `settings.installSection` 在**装载时同步调一次** hooks.onChange（dsh-settings
 *  lib/index.js:338）；此刻宿主解析值还是基值（存储节为空 → `{disabled:[]}`），
 *  直接镜像就把活值文件刷成「全选」，而 `effectiveScopeConfig` 文件优先 → 重启即全选。
 *  用法：apply 里先建护栏 → onChange 走 onHostChange() → installSection 返回后 arm()。
 *  装载期返回 null（不动文件）；装载后的真实变更才镜像；非法活值吞错不落盘。 */
export function createScopeMirror() {
  let armed = false
  return {
    arm() { armed = true },
    onHostChange() {
      if (!armed) return null
      try { return mirrorScopeToFile() } catch { return null }
    },
  }
}
