import type { MemoryLimits } from '../types/index.js'
import type { MemoryEvent } from '../types/index.js'

export type { MemoryLimits, MemoryRejectReason, MemoryWriteResult } from '../types/index.js'

export const DEFAULT_MEMORY_LIMITS: MemoryLimits = {
  l1WindowSize: 20,
  l1MaxMessageChars: 8000,
  l2MaxEvents: 500,
  l2MinImportance: 0.3,
  l2DuplicateThreshold: 0.9,
  l2MaxTitleChars: 200,
  l2MaxDescriptionChars: 2000,
  l3MaxChars: 12000,
  l3MaxFragmentChars: 2000,
  l3CompressEventThreshold: 20
}

export function truncateText(text: string, maxLen: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxLen) return trimmed
  return trimmed.slice(0, maxLen - 3) + '...'
}

/** L3 超限时保留尾部内容 */
export function trimToMaxChars(content: string, maxChars: number): { content: string; evicted: boolean } {
  if (content.length <= maxChars) return { content, evicted: false }

  const marker = '\n\n[...早期记忆已因容量限制压缩剔除...]\n\n'
  const keepLen = maxChars - marker.length
  const tail = content.slice(-keepLen)
  return { content: marker + tail, evicted: true }
}

/**
 * L2 生命周期评分（用于淘汰低价值事件）
 * score = 0.6 * importance + 0.3 * access_norm + 0.1 * recency
 */
export function lifecycleScore(event: MemoryEvent, maxAccessAmongActive: number): number {
  const accessNorm =
    maxAccessAmongActive > 0 ? Math.min(1, event.accessCount / maxAccessAmongActive) : 0
  const ageDays = (Date.now() - event.lastAccess) / (1000 * 60 * 60 * 24)
  const recency = 1 / (1 + ageDays / 30)
  return event.importance * 0.6 + accessNorm * 0.3 + recency * 0.1
}

/** @deprecated 使用 lifecycleScore */
export function evictionScore(event: { importance: number; updatedAt: number }): number {
  const ageDays = (Date.now() - event.updatedAt) / (1000 * 60 * 60 * 24)
  const recency = 1 / (1 + ageDays / 30)
  return event.importance * 0.7 + recency * 0.3
}

export function migrateMemoryEvent(event: MemoryEvent): MemoryEvent {
  return {
    ...event,
    accessCount: event.accessCount ?? 1,
    lastAccess: event.lastAccess ?? event.updatedAt,
    status: event.status ?? 'active'
  }
}
