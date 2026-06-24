import type { LongTermSummary } from '../types/index.js'
import { generateId, readJson, writeJson } from '../utils/index.js'
import type { MemoryLimits, MemoryWriteResult } from '../types/index.js'
import { DEFAULT_MEMORY_LIMITS, trimToMaxChars } from './limits.js'
import { validateL3Fragment } from './validator.js'

/** L3: 长期压缩知识 */
export class L3SummaryMemory {
  private summary: LongTermSummary | null = null

  constructor(
    private storagePath: string,
    private limits: MemoryLimits = DEFAULT_MEMORY_LIMITS
  ) {}

  async load(): Promise<void> {
    this.summary = await readJson<LongTermSummary | null>(this.storagePath, null)
  }

  async save(): Promise<void> {
    await writeJson(this.storagePath, this.summary)
  }

  get(): LongTermSummary | null {
    return this.summary
  }

  async update(
    content: string,
    topics: string[],
    sourceEventIds: string[] = []
  ): Promise<{ summary: LongTermSummary; evicted: boolean }> {
    const { content: trimmed, evicted } = trimToMaxChars(content, this.limits.l3MaxChars)

    if (this.summary) {
      this.summary = {
        ...this.summary,
        content: trimmed,
        topics,
        sourceEventIds: [...new Set([...this.summary.sourceEventIds, ...sourceEventIds])],
        updatedAt: Date.now()
      }
    } else {
      this.summary = {
        id: generateId(),
        content: trimmed,
        topics,
        sourceEventIds,
        updatedAt: Date.now()
      }
    }

    await this.save()
    return { summary: this.summary, evicted }
  }

  async appendKnowledge(fragment: string, topics: string[] = []): Promise<MemoryWriteResult<LongTermSummary>> {
    const validation = validateL3Fragment(fragment, this.limits)
    if (!validation.ok) {
      return { ok: false, reason: validation.reason, message: validation.message }
    }

    const existing = this.summary?.content ?? ''
    const merged = existing ? `${existing}\n\n${validation.fragment}` : validation.fragment
    const mergedTopics = [...new Set([...(this.summary?.topics ?? []), ...topics])]
    const { summary, evicted } = await this.update(merged, mergedTopics, this.summary?.sourceEventIds ?? [])

    return {
      ok: true,
      record: summary,
      evicted: evicted ? 1 : undefined,
      message: evicted ? `L3: 超过 ${this.limits.l3MaxChars} 字符，已压缩剔除早期内容` : undefined
    }
  }

  getStats() {
    const chars = this.summary?.content.length ?? 0
    return {
      chars,
      maxChars: this.limits.l3MaxChars,
      usagePercent: Math.round((chars / this.limits.l3MaxChars) * 100)
    }
  }

  toPromptContext(): string {
    if (!this.summary) return '(暂无长期记忆)'
    return `主题: ${this.summary.topics.join(', ')}\n${this.summary.content}`
  }
}
