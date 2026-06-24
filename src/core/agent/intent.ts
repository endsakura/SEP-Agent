export type UserIntent = 'chitchat' | 'task'

/** 纯问候 / 闲聊 — 不进入 ReAct 工具循环 */
const CHITCHAT_EXACT =
  /^(你好|您好|嗨|hi|hello|hey|yo|在吗|在不在|早上好|下午好|晚上好|谢谢|多谢|thanks|thank\s*you|bye|再见|拜拜|ok|好的|嗯+|哦+|哈+|666|2333)[!.?~\s]*$/i

/** 短句闲聊 / 身份询问（无任务动词） */
const CHITCHAT_PHRASE =
  /^(你(好|是谁|叫什么|能做什么|可以做什么|会什么)|你是谁|介绍一下你自己|你能帮我什么)[!.?~\s]*$/i

/** 明确任务信号 — 命中则一定是 task */
const TASK_SIGNALS =
  /读|写|文件|目录|代码|搜索|查|找|分析|总结|调试|报错|error|debug|实现|创建|删除|修改|运行|执行|list|read|write|search|help me|please/i

/**
 * 判断用户输入是闲聊还是任务。
 * 闲聊 → 直接对话，不走 ReAct。
 */
export function classifyIntent(message: string): UserIntent {
  const trimmed = message.trim()
  if (!trimmed) return 'chitchat'

  if (TASK_SIGNALS.test(trimmed)) return 'task'

  if (trimmed.length <= 16 && CHITCHAT_EXACT.test(trimmed)) return 'chitchat'
  if (CHITCHAT_PHRASE.test(trimmed)) return 'chitchat'

  // 极短且无任务信号
  if (trimmed.length <= 8 && !TASK_SIGNALS.test(trimmed)) return 'chitchat'

  return 'task'
}

export function isChitchat(intent: UserIntent): boolean {
  return intent === 'chitchat'
}
