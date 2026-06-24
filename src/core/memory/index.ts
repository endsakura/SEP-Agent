import type { ChatMessage, LongTermSummary, MemoryEvent, L3CompressResult } from '../types/index.js'
import { L1Memory } from './l1.js'
import { L2EventMemory } from './l2.js'
import { L3SummaryMemory } from './l3.js'
import { L3Compressor } from './l3-compress.js'
import type { EmbeddingService } from '../llm/client.js'
import type { LLMClient } from '../llm/client.js'
import { joinPath } from '../utils/index.js'
import type { MemoryLimits, MemoryWriteResult } from '../types/index.js'
import { DEFAULT_MEMORY_LIMITS } from './limits.js'

type L2EventInput = Omit<
  MemoryEvent,
  'id' | 'createdAt' | 'updatedAt' | 'embedding' | 'accessCount' | 'lastAccess' | 'status'
>

export class MemoryManager {
  readonly l1: L1Memory
  readonly l2: L2EventMemory
  readonly l3: L3SummaryMemory
  private limits: MemoryLimits
  private compressor: L3Compressor

  constructor(
    embedding: EmbeddingService,
    llm: LLMClient,
    dataDir: string,
    limits: Partial<MemoryLimits> = {}
  ) {
    this.limits = { ...DEFAULT_MEMORY_LIMITS, ...limits }
    this.l1 = new L1Memory(this.limits)
    this.l2 = new L2EventMemory(embedding, joinPath(dataDir, 'l2-events.json'), this.limits)
    this.l3 = new L3SummaryMemory(joinPath(dataDir, 'l3-summary.json'), this.limits)
    this.compressor = new L3Compressor(llm)
  }

  async initialize(): Promise<void> {
    await this.l2.load()
    await this.l3.load()
    // 启动时若活跃事件已超限，补一次压缩
    await this.maybeCompressL3()
  }

  async retrieveForTask(query: string): Promise<{
    l1Context: string
    events: MemoryEvent[]
    summary: LongTermSummary | null
  }> {
    const events = await this.l2.search(query, 5)
    return {
      l1Context: this.l1.toPromptContext(),
      events,
      summary: this.l3.get()
    }
  }

  addConversation(role: ChatMessage['role'], content: string): MemoryWriteResult<ChatMessage> {
    return this.l1.add(role, content)
  }

  /**
   * 新增 L2 事件完整流程：
   * Embedding → 去重 → 写入 → 达到阈值 → L3 压缩 → 归档
   */
  async addEvent(event: L2EventInput): Promise<MemoryWriteResult<MemoryEvent>> {
    const result = await this.l2.addEvent(event)

    if (result.ok && !result.merged) {
      const compressed = await this.maybeCompressL3()
      if (compressed.compressed) {
        const extra = `L3: 已压缩 ${compressed.eventCount} 条事件并归档`
        result.message = result.message ? `${result.message}; ${extra}` : extra
      }
    }

    // 每次写入后做轻量生命周期清理
    await this.l2.lifecycleCleanup()

    return result
  }

  /**
   * 周期性 L3 压缩：活跃 L2 事件达到阈值时触发
   *
   * L2 → Reflection(LLM) → Summary → L3 → 归档旧事件
   */
  async maybeCompressL3(): Promise<L3CompressResult> {
    const threshold = this.limits.l3CompressEventThreshold
    const activeCount = this.l2.getActiveCount()

    if (activeCount < threshold) {
      return { compressed: false, eventCount: 0, archivedIds: [] }
    }

    const events = this.l2.getActiveEvents()
    const existing = this.l3.get()
    const { content, topics } = await this.compressor.compress(events, existing)

    const sourceIds = events.map((e) => e.id)
    const mergedTopics = [...new Set([...(existing?.topics ?? []), ...topics])]
    const summary = await this.l3.update(content, mergedTopics, [
      ...(existing?.sourceEventIds ?? []),
      ...sourceIds
    ])

    const archived = await this.l2.archiveEvents(sourceIds)

    return {
      compressed: true,
      eventCount: events.length,
      archivedIds: archived.map((e) => e.id),
      summary: summary.summary
    }
  }

  async appendKnowledge(fragment: string, topics: string[] = []): Promise<MemoryWriteResult<LongTermSummary>> {
    return this.l3.appendKnowledge(fragment, topics)
  }

  getLimits(): MemoryLimits {
    return { ...this.limits }
  }

  getStats() {
    return {
      l1: { count: this.l1.getAll().length, maxMessages: this.limits.l1WindowSize * 2 },
      l2: this.l2.getStats(),
      l3: this.l3.getStats()
    }
  }

  getSnapshot() {
    return {
      l1: this.l1.getAll(),
      l2: this.l2.getAll(),
      l3: this.l3.get()
    }
  }
}

export { DEFAULT_MEMORY_LIMITS } from './limits.js'
export type { MemoryLimits, MemoryWriteResult } from '../types/index.js'
export { L3Compressor } from './l3-compress.js'
