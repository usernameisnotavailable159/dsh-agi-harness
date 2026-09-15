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

const SESS = '/home/hiro/.dsh/sessions'
const OUT = join(process.env.DSH_HOME || '/home/hiro/.dsh', 'closedloop-presets.json')
const dry = process.argv.includes('--dry-run')

let rec = {}
try { if (existsSync(OUT)) rec = JSON.parse(readFileSync(OUT, 'utf8')) } catch { rec = {} }
const before = Object.keys(rec).length

let scanned = 0, withSel = 0, skipped = 0
for (const proj of readdirSync(SESS)) {
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
const probe = 'session-c948ebf5-27f0-47ff-975f-02064cadecb2'
console.log(`抽查 ${probe.slice(0, 22)}… → ${rec[probe] ?? '(无记录)'}`)
