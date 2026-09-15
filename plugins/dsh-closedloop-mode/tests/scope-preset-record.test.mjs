/**
 * scope-preset-record.test — v0.8.42 会话级预设持久化（开发者定向方案 B）
 *
 * 案底：`agent-preset/selected` 只在该次进程送达。新进程里**续跑**的会话，notePreset 只能用
 * `session.header.agentPreset` 兜底，而头里是**创建时**预设 ⇒ 用户后切的 daily/teacher 形同不存在，
 * 禁用预设被接管。实测 2026-09-15 session-c948ebf5-…4cadecb2：头=router-spec / 选=teacher，
 * 21:35:05 被注入第一拍并落写闸，而 GET /graded-mode/api/scope 自报 disabled=[daily,teacher]。
 *
 * 本组守护：事件来源落盘 → 新进程先读盘再退 header；header 推导值绝不落盘；损坏静默回退。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-preset-rec-')) // 真盘零接触
const HOME = process.env.DSH_HOME
const REC = path.join(HOME, 'closedloop-presets.json')

const m1 = await import('../src/scope.js')

test('p1 事件来源的预设落盘（原子写、读得回、不留临时残渣）', () => {
  const sid = 'session-resume-1'
  const session = { id: sid, header: { agentPreset: 'router-spec' } }
  m1.notePreset(session, { type: 'agent-preset/selected', data: { agentPreset: 'teacher' } })
  assert.equal(m1.presetOf(session), 'teacher', '进程内追踪立即生效')
  assert.ok(fs.existsSync(REC), '记录文件应落盘')
  assert.deepEqual(JSON.parse(fs.readFileSync(REC, 'utf8')), { [sid]: 'teacher' })
  assert.equal(fs.readdirSync(HOME).some((f) => f.includes('.tmp-')), false, 'rename 后不留 .tmp 残渣')
})

test('p2 ★新进程续跑：从盘恢复当前预设，创建时 header 不得遮蔽（案底场景）', async () => {
  const fresh = await import('../src/scope.js?fresh=1') // 新模块实例 = 进程内 Map 清空 = 新进程
  const resumed = { id: 'session-resume-1', header: { agentPreset: 'router-spec' } }
  assert.equal(resumed.agentPreset, undefined, '前提：session 上没有 agentPreset 属性（dsh 0.1.5 projection）')
  assert.equal(fresh.presetOf(resumed), 'teacher', '★ 修复点：盘上记录优先于会话头')
  assert.equal(fresh.presetAllowed(resumed, { disabled: ['teacher'] }), false, '★ 禁用预设必须被拦住')
  assert.equal(fresh.presetAllowed(resumed, { disabled: ['router-spec'] }), true, '不再用创建时 header 值误判')
})

test('p3 无记录会话行为与从前一致（header 兜底 / 真无预设归 (无预设)）', async () => {
  const fresh = await import('../src/scope.js?fresh=2')
  assert.equal(fresh.presetOf({ id: 'never-switched', header: { agentPreset: 'router-spec' } }), 'router-spec')
  assert.equal(fresh.presetOf({ id: 'no-preset-at-all' }), '(无预设)')
  assert.equal(
    fresh.presetAllowed({ id: 'never-switched', header: { agentPreset: 'router-spec' } }, { disabled: ['router-spec'] }),
    false,
    '老会话仍按 header 判定（零变化）',
  )
})

test('p4 盘上文件损坏一律静默回退，不影响判定主链', async () => {
  const bak = fs.readFileSync(REC, 'utf8')
  fs.writeFileSync(REC, '{broken json')
  const fresh = await import('../src/scope.js?fresh=3')
  assert.deepEqual(fresh.loadPresetRecord(), {}, '损坏返回空表且不抛')
  assert.equal(
    fresh.presetOf({ id: 'session-resume-1', header: { agentPreset: 'router-spec' } }),
    'router-spec',
    '回退到 header 兜底',
  )
  fs.writeFileSync(REC, bak)
})

test('p5 只记事件来源 —— header 推导值绝不落盘（否则过期值被钉死）', () => {
  const sid = 'header-only-1'
  m1.notePreset({ id: sid, header: { agentPreset: 'daily' } }) // 首次见到，无事件
  assert.equal(m1.presetOf({ id: sid, header: { agentPreset: 'daily' } }), 'daily')
  assert.equal(JSON.parse(fs.readFileSync(REC, 'utf8'))[sid], undefined, 'header 推导值不得出现在盘上')
})
