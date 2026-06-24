import type { MemoryEvent } from '../types/index.js'
import { cosineSimilarity, generateId, readJson, writeJson } from '../utils/index.js'
import type { EmbeddingService } from '../llm/client.js'
import type { MemoryLimits, MemoryWriteResult } from '../types/index.js'
import { DEFAULT_MEMORY_LIMITS, lifecycleScore, migrateMemoryEvent } from './limits.js'
import { validateL2Event } from './validator.js'

type L2EventCreate = Omit<
  MemoryEvent,
  'id' | 'createdAt' | 'updatedAt' | 'embedding' | 'accessCount' | 'lastAccess' | 'status'
>

/** L2: 重要事件向量库 — 不是聊天记录 */
export class L2EventMemory {
  private events: MemoryEvent[] = []

  constructor(
    private embedding: EmbeddingService,
    private storagePath: string,
    private limits: MemoryLimits = DEFAULT_MEMORY_LIMITS
  ) {}

  async load(): Promise<void> {
    const raw = await readJson<MemoryEvent[]>(this.storagePath, [])
    this.events = raw.map(migrateMemoryEvent)
  }

  async save(): Promise<void> {
    await writeJson(this.storagePath, this.events)
  }

  async addEvent(event: L2EventCreate): Promise<MemoryWriteResult<MemoryEvent>> {
    const text = `${event.title}\n${event.description}`
    const embedding = await this.embedding.embed(text)
    const activeEvents = this.getActiveEvents()

    const validation = validateL2Event(
      {
        title: event.title,
        description: event.description,
        category: event.category,
        importance: event.importance,
        relatedTaskIds: event.relatedTaskIds
      },
      this.limits,
      activeEvents,
      embedding
    )

    if (!validation.ok) {
      if (validation.reason === 'duplicate' && validation.duplicateOf) {
        const merged = await this.mergeIntoExisting(validation.duplicateOf, event.relatedTaskIds)
        return {
          ok: true,
          record: merged,
          merged: true,
          message: validation.message
        }
      }
      return { ok: false, reason: validation.reason, message: validation.message }
    }

    const sanitized = validation.sanitized!
    const now = Date.now()
    const record: MemoryEvent = {
      ...sanitized,
      id: generateId(),
      embedding,
      accessCount: 1,
      lastAccess: now,
      status: 'active',
      createdAt: now,
      updatedAt: now
    }

    this.events.push(record)
    const evicted = this.enforceCapacity()
    await this.save()

    return {
      ok: true,
      record,
      evicted: evicted > 0 ? evicted : undefined,
      message: evicted > 0 ? `L2: 容量已满，淘汰 ${evicted} 条低分事件` : undefined
    }
  }

  /** 容量超限：按生命周期评分淘汰最低的活跃事件 */
  private enforceCapacity(): number {
    let evicted = 0
    while (this.getActiveEvents().length > this.limits.l2MaxEvents) {
      const active = this.getActiveEvents()
      const maxAccess = Math.max(...active.map((e) => e.accessCount), 1)
      const sorted = [...active].sort(
        (a, b) => lifecycleScore(a, maxAccess) - lifecycleScore(b, maxAccess)
      )
      const toRemove = sorted[0]
      this.events = this.events.filter((e) => e.id !== toRemove.id)
      evicted++
    }
    return evicted
  }

  private async mergeIntoExisting(
    existing: MemoryEvent,
    newTaskIds: string[]
  ): Promise<MemoryEvent> {
    const event = this.events.find((e) => e.id === existing.id)!
    event.relatedTaskIds = [...new Set([...event.relatedTaskIds, ...newTaskIds])]
    event.accessCount += 1
    event.lastAccess = Date.now()
    event.updatedAt = Date.now()
    event.importance = Math.min(1, event.importance + 0.05)
    await this.save()
    return event
  }

  async recordAccess(eventIds: string[]): Promise<void> {
    const now = Date.now()
    let changed = false
    for (const id of eventIds) {
      const event = this.events.find((e) => e.id === id && e.status === 'active')
      if (event) {
        event.accessCount += 1
        event.lastAccess = now
        changed = true
      }
    }
    if (changed) await this.save()
  }

  async search(query: string, topK = 5): Promise<MemoryEvent[]> {
    const active = this.getActiveEvents()
    if (active.length === 0) return []

    const queryEmb = await this.embedding.embed(query)
    const results = active
      .map((e) => ({
        event: e,
        score: cosineSimilarity(queryEmb, e.embedding ?? [])
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((s) => s.event)

    await this.recordAccess(results.map((e) => e.id))
    return results
  }

  getActiveEvents(): MemoryEvent[] {
    return this.events
      .filter((e) => e.status === 'active')
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  getActiveCount(): number {
    return this.getActiveEvents().length
  }

  async archiveEvents(ids: string[]): Promise<MemoryEvent[]> {
    const now = Date.now()
    const archived: MemoryEvent[] = []
    for (const id of ids) {
      const event = this.events.find((e) => e.id === id && e.status === 'active')
      if (event) {
        event.status = 'archived'
        event.archivedAt = now
        archived.push(event)
      }
    }
    if (archived.length > 0) await this.save()
    return archived
  }

  /** 定期清理：删除生命周期评分过低的活跃事件 */
  async lifecycleCleanup(minScore = 0.15, maxRemove = 5): Promise<number> {
    const active = this.getActiveEvents()
    if (active.length === 0) return 0

    const maxAccess = Math.max(...active.map((e) => e.accessCount), 1)
    const scored = active
      .map((e) => ({ event: e, score: lifecycleScore(e, maxAccess) }))
      .filter((s) => s.score < minScore)
      .sort((a, b) => a.score - b.score)
      .slice(0, maxRemove)

    for (const { event } of scored) {
      this.events = this.events.filter((e) => e.id !== event.id)
    }
    if (scored.length > 0) await this.save()
    return scored.length
  }

  getAll(): MemoryEvent[] {
    return [...this.events].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  getStats() {
    const active = this.getActiveEvents()
    const archived = this.events.filter((e) => e.status === 'archived')
    return {
      activeCount: active.length,
      archivedCount: archived.length,
      count: this.events.length,
      maxEvents: this.limits.l2MaxEvents,
      compressThreshold: this.limits.l3CompressEventThreshold,
      untilCompress: Math.max(0, this.limits.l3CompressEventThreshold - active.length)
    }
  }

  async updateImportance(id: string, importance: number): Promise<void> {
    const event = this.events.find((e) => e.id === id)
    if (event) {
      event.importance = Math.max(0, Math.min(1, importance))
      event.updatedAt = Date.now()
      await this.save()
    }
  }
}
