/**
 * inject-guard — 记忆注入的接缝守卫（issue #14 修复的纯函数层，零依赖）。
 *
 * 治的病（issue #14 逐字引了三处官方包源码，均已核对）：
 *   ① `content` 必须是 `ContentBlock[]`——字符串会被 `dsh-llm` 的纯文本投影
 *      `contentHasImage(content)` 打成 `TypeError: content.some is not a function`
 *      （实测 `/compact` 100% 失败）；
 *   ② 正常轮次的请求被 `agent-loop` `deepFreeze`——就地 `messages.push(...)` 必抛，
 *      异常又被 `try/catch` 降级成 warn → 每轮记忆注入静默失效（无人可见）；
 *   ③ 压缩摘要 / 会话标题这类辅助调用，其 `messages` 是新建可变的，注入会破坏
 *      "摘要指令必须是最后一条消息"的前提。
 *
 * 所以注入决策收进这一个纯函数：它什么都不改，只回答「能不能注、注什么形态」。
 */
/** 辅助调用目的：注入必须让位（摘要指令必须是最后一条消息）。 */
export const AUX_PURPOSES = ['compaction', 'session-title'];
/**
 * 就地注入决策（`llm/stream` 路径）。
 * @param options 请求对象（只看 purpose / messages）
 * @param injection 渲染好的记忆段文本
 * @param opts.recentMessages 去重时比对的最近消息（缺省=请求自身）
 * @param opts.probeLen 去重探针长度（默认 40 字符）
 */
export function decideInjection(options, injection, opts = {}) {
    const text = String(injection ?? '');
    if (!text)
        return { action: 'skip', why: 'no-injection' };
    const purpose = typeof options?.purpose === 'string' ? options.purpose : '';
    if (AUX_PURPOSES.includes(purpose))
        return { action: 'skip', why: 'aux-call' };
    const messages = options?.messages;
    if (!Array.isArray(messages))
        return { action: 'skip', why: 'no-messages' };
    if (Object.isFrozen(messages))
        return { action: 'skip', why: 'frozen' };
    if (alreadyPresent(opts.recentMessages ?? messages, text, opts.probeLen ?? 40)) {
        return { action: 'skip', why: 'already-present' };
    }
    return { action: 'inject', message: { role: 'system', content: [{ type: 'text', text }] } };
}
/** 注入段是否已在最近消息里出现过（`agent/pre-step` 与 `llm/stream` 双路径去重）。 */
export function alreadyPresent(messages, injection, probeLen = 40) {
    const probe = String(injection ?? '').slice(0, probeLen);
    if (!probe)
        return true;
    for (const m of messages ?? []) {
        try {
            if (JSON.stringify(m ?? '').includes(probe))
                return true;
        }
        catch {
            /* 不可序列化（循环引用等）=跳过该条，不因此判"已存在" */
        }
    }
    return false;
}
/** 人读的跳过原因（日志用）。 */
export function skipReasonText(why) {
    switch (why) {
        case 'aux-call': return '辅助调用（compaction/session-title）不改请求形状';
        case 'frozen': return '请求被 agent-loop deepFreeze（本轮走 agent/pre-step 注入）';
        case 'already-present': return '同一记忆段已在最近消息里（去重）';
        case 'no-messages': return '请求没有 messages 数组';
        default: return '记忆段为空';
    }
}

/**
 * `agent/pre-step` 注入消息的 source.kind。
 * 插件注入**永不**冒用 'user'——那是真人帧的判类器（介入率统计、
 * 写闸的 humanTurnSids、goal 的真人签收门都按 source.kind==='user' 判类）。
 */
export const PRE_STEP_SOURCE_KIND = 'plugin';
/** 稳定唯一的本地消息 id（不 import node:crypto，保持本模块零依赖）。 */
function localMessageId() {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === 'function')
        return `engram-inject-${c.randomUUID()}`;
    return `engram-inject-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
/**
 * 构造 `agent/pre-step` 注入消息——**必须**走这里，不要手写裸对象。
 *
 * 案底（2026-09-12 生产事故，本机 4/4 命中）：
 *   旧实现返回 `{ role: 'user', content: [{ type: 'text', text: injection }] }`，
 *   缺 `id` 与 `source`。pre-step 瀑布链里下游**官方**监听器无保护地读
 *   `message.source.kind`（dsh-repeat-tool-reminder:1510 / dsh-tool-skill
 *   invokedSkillNames / dsh-session-reference prepareDirectMessages /
 *   dsh-agent-loop RuntimeContextProjection.isOwned），当场抛
 *   `TypeError: Cannot read properties of undefined (reading 'kind')`
 *   → preStep 抛出 → 整轮 `turn/end{kind:'error'}`，用户看到"本轮运行失败"。
 *   即便侥幸穿过瀑布链，`dsh-session.assertMessageEventShape` 也会以
 *   "message has invalid source" 拒收这条落盘事件。
 *
 * @param injection 渲染好的记忆段文本（空白 ⇒ 返回 undefined，调用方不注入）
 * @param opts.plugin 自报的插件名（诊断用）
 * @param opts.name   注入段来源名（sections 记账用）
 */
export function buildPreStepInjectionMessage(injection, opts = {}) {
    const text = String(injection ?? '');
    if (text.trim() === '')
        return undefined;
    const plugin = typeof opts.plugin === 'string' && opts.plugin !== ''
        ? opts.plugin
        : '@dsh-external/dsh-engram-relay';
    const name = typeof opts.name === 'string' && opts.name !== '' ? opts.name : 'engram:relay';
    return {
        id: localMessageId(),
        role: 'user',
        content: [{ type: 'text', text }],
        source: {
            kind: PRE_STEP_SOURCE_KIND,
            plugin,
            form: 'snapshot',
            sections: [{ name, text }],
        },
    };
}
