import type { LongTermSummary, MemoryEvent } from '../types/index.js'
import type { LLMClient } from '../llm/client.js'

export interface L3CompressOutput {
  content: string
  topics: string[]
}

/**
 * L3 周期性压缩：将一批 L2 事件总结为长期能力与兴趣画像
 *
 * L2 → Reflection(LLM) → Summary → L3
 */
export class L3Compressor {
  constructor(private llm: LLMClient) {}

  async compress(
    events: MemoryEvent[],
    existingSummary: LongTermSummary | null
  ): Promise<L3CompressOutput> {
    if (events.length === 0) {
      return { content: existingSummary?.content ?? '', topics: existingSummary?.topics ?? [] }
    }

    const eventList = events
      .map((e, i) => `${i + 1}. [${e.category}] ${e.title}: ${e.description}`)
      .join('\n')

    const existingBlock = existingSummary?.content
      ? `\n\n已有长期记忆（请综合更新，不要简单拼接）：\n${existingSummary.content}`
      : ''

    const response = await this.llm.chat(
      [
        { role: 'system', content: L3_COMPRESS_SYSTEM },
        {
          role: 'user',
          content: `请根据以下事件：\n\n${eventList}${existingBlock}\n\n总结用户的长期能力、兴趣和偏好。`
        }
      ],
      0.3
    )

    return parseCompressOutput(response, existingSummary)
  }
}

const L3_COMPRESS_SYSTEM = `你是长期记忆压缩引擎。将多条 L2 事件总结为一份结构化的 L3 长期记忆。

输出格式（Markdown）：

用户擅长：
- ...

用户兴趣：
- ...

用户偏好：
- ...

其他重要认知：
- ...

要求：
1. 提炼能力和兴趣，不要复述事件原文
2. 合并相似条目，去除冗余
3. 若提供了已有长期记忆，综合更新而非简单追加
4. 在回复最后一行附加主题标签：TOPICS: tag1, tag2, tag3`

function parseCompressOutput(
  response: string,
  existing: LongTermSummary | null
): L3CompressOutput {
  const topicsMatch = response.match(/TOPICS:\s*(.+)$/im)
  let content = response
  let topics: string[] = existing?.topics ?? []

  if (topicsMatch) {
    content = response.slice(0, topicsMatch.index).trim()
    topics = topicsMatch[1]
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
  }

  if (!content.trim()) {
    content = existing?.content ?? response.trim()
  }

  return { content, topics }
}
