import type { TaskContext } from '../types/index.js'
import type { LLMClient } from '../llm/client.js'

/** 闲聊 / 非任务型输入：单次 LLM 回复，不走 ReAct */
export class DirectChatHandler {
  constructor(private llm: LLMClient) {}

  async respond(context: TaskContext): Promise<TaskContext> {
    context.phase = 'complete'

    const history = context.messages
      .slice(-6)
      .map((m) => `[${m.role}] ${m.content}`)
      .join('\n')

    const memoryHint = context.longTermSummary
      ? `\n长期记忆摘要:\n${context.longTermSummary.content.slice(0, 500)}`
      : ''

    const response = await this.llm.chat(
      [
        {
          role: 'system',
          content: `你是 Self-Evolving Personal Agent (SEA)，用户的个人助手。
当前是闲聊/问候场景，请自然、简洁地用中文回复。
- 不要调用工具，不要输出 JSON，不要分析推理过程
- 1～3 句话即可
- 可简要介绍你能帮用户做什么（读文件、写代码、搜索、记忆等）${memoryHint}`
        },
        {
          role: 'user',
          content: history
            ? `近期对话:\n${history}\n\n用户: ${context.userRequest}`
            : context.userRequest
        }
      ],
      0.7
    )

    context.finalResponse = response.trim()
    context.success = context.finalResponse.length > 0
    context.reactSteps = [
      {
        thought: '闲聊模式：直接回复',
        decision: 'direct_answer',
        answer: context.finalResponse,
        observation: context.finalResponse
      }
    ]
    context.phase = context.success ? 'complete' : 'failed'
    return context
  }
}
