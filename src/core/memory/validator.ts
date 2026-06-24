import type { MemoryEvent } from '../types/index.js'
import type { MemoryLimits, MemoryRejectReason } from '../types/index.js'
import { cosineSimilarity } from '../utils/index.js'
import { truncateText } from './limits.js'

export interface L2EventInput {
  title: string
  description: string
  category: MemoryEvent['category']
  importance: number
  relatedTaskIds: string[]
}

const VALID_CATEGORIES = new Set<MemoryEvent['category']>([
  'project',
  'debug',
  'preference',
  'milestone',
  'other'
])

export function validateL1Message(
  content: string,
  limits: MemoryLimits
): { ok: true; content: string } | { ok: false; reason: MemoryRejectReason; message: string } {
  const trimmed = content.trim()
  if (!trimmed) {
    return { ok: false, reason: 'empty', message: 'L1: 消息内容为空' }
  }
  if (trimmed.length > limits.l1MaxMessageChars) {
    return {
      ok: true,
      content: truncateText(trimmed, limits.l1MaxMessageChars)
    }
  }
  return { ok: true, content: trimmed }
}

export function validateL2Event(
  input: L2EventInput,
  limits: MemoryLimits,
  existing: MemoryEvent[],
  newEmbedding?: number[]
): {
  ok: boolean
  sanitized?: L2EventInput
  reason?: MemoryRejectReason
  message?: string
  duplicateOf?: MemoryEvent
} {
  const title = input.title?.trim() ?? ''
  const description = input.description?.trim() ?? ''

  if (!title && !description) {
    return { ok: false, reason: 'empty', message: 'L2: 事件标题和描述均为空' }
  }

  if (!VALID_CATEGORIES.has(input.category)) {
    return { ok: false, reason: 'invalid_category', message: `L2: 无效分类 ${input.category}` }
  }

  const importance = Math.max(0, Math.min(1, input.importance ?? 0))
  if (importance < limits.l2MinImportance) {
    return {
      ok: false,
      reason: 'low_importance',
      message: `L2: 重要度 ${importance.toFixed(2)} 低于阈值 ${limits.l2MinImportance}`
    }
  }

  const sanitized: L2EventInput = {
    title: truncateText(title || description.slice(0, 50), limits.l2MaxTitleChars),
    description: truncateText(description || title, limits.l2MaxDescriptionChars),
    category: input.category,
    importance,
    relatedTaskIds: input.relatedTaskIds ?? []
  }

  // 标题精确重复
  const titleDup = existing.find(
    (e) => e.title.toLowerCase() === sanitized.title.toLowerCase()
  )
  if (titleDup) {
    return {
      ok: false,
      reason: 'duplicate',
      message: `L2: 标题重复「${sanitized.title}」`,
      duplicateOf: titleDup
    }
  }

  // 向量语义重复
  if (newEmbedding?.length) {
    for (const event of existing) {
      if (!event.embedding?.length) continue
      const sim = cosineSimilarity(newEmbedding, event.embedding)
      if (sim >= limits.l2DuplicateThreshold) {
        return {
          ok: false,
          reason: 'duplicate',
          message: `L2: 与已有事件「${event.title}」语义重复 (相似度 ${sim.toFixed(2)})`,
          duplicateOf: event
        }
      }
    }
  }

  return { ok: true, sanitized }
}

export function validateL3Fragment(
  fragment: string,
  limits: MemoryLimits
): { ok: true; fragment: string } | { ok: false; reason: MemoryRejectReason; message: string } {
  const trimmed = fragment.trim()
  if (!trimmed) {
    return { ok: false, reason: 'empty', message: 'L3: 追加内容为空' }
  }
  if (trimmed.length > limits.l3MaxFragmentChars) {
    return {
      ok: true,
      fragment: truncateText(trimmed, limits.l3MaxFragmentChars)
    }
  }
  return { ok: true, fragment: trimmed }
}
