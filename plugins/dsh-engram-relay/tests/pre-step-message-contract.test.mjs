/**
 * pre-step-message-contract.test — `agent/pre-step` 注入消息必须满足 DSH 消息契约。
 *
 * 案底（2026-09-12 生产事故，逐字复现）：
 *   本插件的 `agent/pre-step` 监听器（lib/relay.js，src/relay.ts）往
 *   `decision.messages` 尾部追加了一条**裸 user 消息**：
 *
 *       return { ...decision, messages: [...msgs, { role: 'user', content: [{ type: 'text', text: injection }] }] }
 *
 *   它缺 `source`（也缺 `id`）。这在 DSH 里不是"可选字段"：
 *     · `dsh-session` 的 `assertMessageEventShape` 要求每个 `user/message` 必须有
 *       `id: string` 且 `source.kind: string`——缺了会直接抛
 *       "message has invalid source"。
 *     · 更早、更隐蔽的是**同一个 pre-step 瀑布链里**的下游监听器会**无保护地**
 *       读 `message.source.kind`：`dsh-repeat-tool-reminder`(index.js:1510)、
 *       `dsh-tool-skill`(invokedSkillNames)、`dsh-session-reference`
 *       (prepareDirectMessages)、`dsh-agent-loop`(RuntimeContextProjection.isOwned)。
 *       它们拿到的 `messages` 是本插件 transform 之后的返回值，于是当场抛
 *       `TypeError: Cannot read properties of undefined (reading 'kind')`。
 *   preStep 抛出 → agent-loop 的 turn 循环捕获 → `turn/end{kind:'error'}`。
 *   用户可见症状就是本轮运行失败、消息无法发出去。
 *
 *   用户观测（本机会话存档，非推测）：
 *     加载了 engram-relay 的会话 4/4 崩（898abb54、b2b4f5d8、ef9c5620、1bb978c8），
 *     未加载的会话 0/9 崩。错误串在 5 个会话里逐字一致。
 *
 * 契约（本测试断言的四条，全部来自官方源码）：
 *   c1 `id`      : 非空字符串——`dsh-session` assertMessageEventShape
 *   c2 `role`    : 'user'——MESSAGE_ROLE_BY_TYPE['user/message']
 *   c3 `source`  : 对象且 `source.kind` 为非空字符串——assertMessageEventShape
 *   c4 `content` : ContentBlock[] 数组，每块是对象（issue #14 的 content.some 教训）
 *
 * 另外 c5：注入消息**不得**冒用 `{kind:'user'}`——那是真人帧的判类器
 *   （介入率统计、写闸的 humanTurnSids、goal 的真人签收门都按它判类）。
 *   插件注入必须自报 `kind:'plugin'` + 自己的 plugin 名。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { buildPreStepInjectionMessage, PRE_STEP_SOURCE_KIND } = await import('../lib/inject-guard.js')

/** 官方 `dsh-session` 的 assertMessageEventShape 对 user/message 的等价校验（逐条对齐）。 */
function assertDshUserMessage(m, label) {
  assert.equal(typeof m, 'object', `${label}: 消息必须是对象`)
  assert.notEqual(m, null, `${label}: 消息不能是 null`)
  assert.equal(typeof m.id, 'string', `${label}: id 必须是字符串（dsh-session 断言）`)
  assert.notEqual(m.id, '', `${label}: id 不能是空串`)
  assert.equal(m.role, 'user', `${label}: role 必须是 'user'（MESSAGE_ROLE_BY_TYPE）`)
  assert.equal(typeof m.source, 'object', `${label}: source 必须是对象（dsh-session 断言）`)
  assert.notEqual(m.source, null, `${label}: source 不能是 null`)
  assert.equal(typeof m.source.kind, 'string', `${label}: source.kind 必须是字符串（dsh-session 断言）`)
  assert.notEqual(m.source.kind, '', `${label}: source.kind 不能是空串`)
  assert.equal(Array.isArray(m.content), true, `${label}: content 必须是数组（issue #14）`)
  for (const [i, b] of m.content.entries()) {
    assert.equal(typeof b, 'object', `${label}: content[${i}] 必须是对象`)
    assert.notEqual(b, null, `${label}: content[${i}] 不能是 null`)
    assert.equal(typeof b.type, 'string', `${label}: content[${i}].type 必须是字符串`)
  }
}

/** 逐字复刻生产崩溃点：pre-step 瀑布链下游的无保护读法。 */
const downstreamReaders = {
  'dsh-repeat-tool-reminder pre-step (index.js:1510)':
    (msgs) => msgs.some((message) => message.source.kind === 'user'),
  'dsh-tool-skill invokedSkillNames (index.js:384)':
    (msgs) => { for (const m of msgs) { if (m.source.kind !== 'user') continue } },
  'dsh-session-reference prepareDirectMessages (index.js:486)':
    (msgs) => msgs.map((m) => { if (m.source.kind !== 'user') return [m] }),
  'dsh-agent-loop RuntimeContextProjection.isOwned (index.js:223)':
    (msgs) => msgs.map((m) => m.source.kind === 'plugin' && m.source.plugin === '@deepseek-ai/dsh-system-prompt'),
  'dsh-llm-pi-ai foreignAssistant (index.js:144)':
    (msgs) => msgs.map((m) => { const s = m.source.kind === 'model' ? m.source : undefined; return s }),
}

test('c1-c4 注入消息满足 DSH user/message 契约（id/role/source.kind/content[]）', () => {
  const m = buildPreStepInjectionMessage('<engram-memory>记忆段</engram-memory>')
  assertDshUserMessage(m, 'pre-step 注入')
})

test('c5 插件注入自报 kind=plugin（不冒用真人帧 kind=user）', () => {
  const m = buildPreStepInjectionMessage('记忆段')
  assert.equal(m.source.kind, PRE_STEP_SOURCE_KIND)
  assert.equal(m.source.kind, 'plugin', '插件注入必须自报 plugin——kind=user 会被介入率/写闸当成真人')
  assert.equal(typeof m.source.plugin, 'string')
  assert.equal(m.source.plugin, '@dsh-external/dsh-engram-relay')
})

test('c1-c4 空/异常入参也不产出违约消息', () => {
  for (const text of ['', undefined, null]) {
    const m = buildPreStepInjectionMessage(text)
    if (m === undefined) continue // 渲染为空 ⇒ 不注入，调用方直接 return decision
    assertDshUserMessage(m, `渲染文本=${JSON.stringify(text)}`)
  }
})

test('c6 逐字复现生产崩溃：下游无保护读者不得抛 reading \'kind\'', () => {
  const m = buildPreStepInjectionMessage('<engram-memory>浅思维：灵枢校准</engram-memory>')
  for (const [label, read] of Object.entries(downstreamReaders)) {
    assert.doesNotThrow(
      () => read([m]),
      `${label} 抛了 reading 'kind'——preStep 会因此整轮失败`,
    )
  }
})

test('c6b 负对照：缺 source 的裸消息确实会炸（证明本测试的判据不是空转）', () => {
  const bare = { role: 'user', content: [{ type: 'text', text: '旧的违约形态' }] }
  assert.throws(
    () => downstreamReaders['dsh-repeat-tool-reminder pre-step (index.js:1510)']([bare]),
    /Cannot read properties of undefined \(reading 'kind'\)/,
    '负对照必须复现历史崩溃形态，否则本测试没有抓住真 bug',
  )
})

test('c7 id 唯一且稳定前缀（同文本两次注入不共用 id）', () => {
  const a = buildPreStepInjectionMessage('同一段')
  const b = buildPreStepInjectionMessage('同一段')
  assert.notEqual(a.id, b.id, '两条注入消息不得共用 id（dsh 用它追踪）')
})

/**
 * c8 真实瀑布链组合复现（不是单点调用）。
 *
 * 官方 cordis `waterfall` 的语义（cordis/lib/index.js:317）：监听器**外层先跑、由它
 * 决定何时调 next()**；后注册的（或默认 prepend=false 的）在内层。engram 的 pre-step
 * 监听器用的是 `ctx.on(...)`（无 prepend）→ 它是**内层**：`const decision = await next()`
 * 先拿到内层结果，再往外返回带注入的 decision。于是它的返回值必须原样穿过**外层的
 * 所有官方监听器**——那些监听器正是在这一刻读 `message.source.kind`。
 *
 * 本测试按真实顺序串起：engram（内层）→ 官方外层消费者，确认不抛。
 */
test('c8 真实 waterfall 组合（engram 内层 → 官方外层）不抛 reading kind', async () => {
  const { buildPreStepInjectionMessage: build } = await import('../lib/inject-guard.js')

  // 最内层：built-in 行为（agent-loop 传给 waterfall 的 inner next）
  const inner = () => Promise.resolve({
    kind: 'enter',
    messages: [{ id: 'u1', role: 'user', content: [{ type: 'text', text: '继续' }], source: { kind: 'user', rpcId: 'r1' } }],
  })

  // 真插件监听器（逐字对齐 lib/relay.js 的 pre-step 主体）
  const engramListener = async (payload, next) => {
    const decision = await next()
    const msgs = decision.messages
    const injection = '<engram-memory>[[记忆A]] · 浅思维·验证：✓图谱锚定</engram-memory>'
    const message = build(injection, { plugin: 'dsh-engram-relay', name: 'engram:relay' })
    if (message === undefined) return decision
    return { ...decision, messages: [...msgs, message] }
  }

  // 官方**外层**消费者（注册更早 / prepend），逐字对齐各包实现
  const outer = [
    ['dsh-agent-instructions', (d) => { d.messages.filter((m) => m.source.kind === 'agent-instructions'); return d }],
    ['dsh-repeat-tool-reminder', (d) => { d.messages.some((m) => m.source.kind === 'user'); return d }],
    ['dsh-tool-skill', (d) => { for (const m of d.messages) { if (m.source.kind !== 'user') continue } return d }],
    ['dsh-session-reference', (d) => { d.messages.map((m) => (m.source.kind !== 'user' ? [m] : [])); return d }],
    ['dsh-goal-round-driver', (d) => { d.messages.filter((m) => !(m.source.kind === 'goal' && m.source.round === 0)); return d }],
  ]

  // 组合：outer[0] 在最外 → ... → engram → inner
  let chain = engramListener
  for (const [, fn] of outer) {
    const downstream = chain
    chain = async (payload, next) => fn(await downstream(payload, next))
  }

  const result = await chain({ agent: { session: { id: 's1' } }, messages: [] }, inner)
  assert.equal(result.kind, 'enter')
  assert.equal(result.messages.length, 2, '注入消息必须穿过整条外层链存活')
  const injected = result.messages.at(-1)
  assert.equal(injected.source.kind, 'plugin')
  assert.equal(typeof injected.id, 'string')

  // 负对照：同一组合里，把注入换成历史违约形态（缺 source）→ 整条链必炸
  const badListener = async (payload, next) => {
    const decision = await next()
    return { ...decision, messages: [...decision.messages, { role: 'user', content: [{ type: 'text', text: '旧的裸注入' }] }] }
  }
  let badChain = badListener
  for (const [, fn] of outer) {
    const downstream = badChain
    badChain = async (payload, next) => fn(await downstream(payload, next))
  }
  await assert.rejects(
    () => badChain({ agent: { session: { id: 's1' } }, messages: [] }, inner),
    /Cannot read properties of undefined \(reading 'kind'\)/,
    '负对照必须让整条链在官方外层消费者处炸掉——否则本组合测试是空转的',
  )
})
