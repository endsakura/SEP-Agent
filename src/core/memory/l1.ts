import type { ChatMessage } from '../types/index.js'
import { generateId } from '../utils/index.js'
import type { MemoryLimits, MemoryWriteResult } from '../types/index.js'
import { DEFAULT_MEMORY_LIMITS } from './limits.js'
import { validateL1Message } from './validator.js'
import { truncateText } from './limits.js'

/** L1: 最近 N 轮对话滑动窗口 */
export class L1Memory {
  private messages: ChatMessage[] = []

  constructor(
    private limits: MemoryLimits = DEFAULT_MEMORY_LIMITS
  ) {}

  add(role: ChatMessage['role'], content: string, metadata?: Record<string, unknown>): MemoryWriteResult<ChatMessage> {
    const validation = validateL1Message(content, this.limits)
    if (!validation.ok) {
      return { ok: false, reason: validation.reason, message: validation.message }
    }

    let finalContent = validation.content
    if (content.trim().length > this.limits.l1MaxMessageChars) {
      finalContent = truncateText(content.trim(), this.limits.l1MaxMessageChars)
    }

    const msg: ChatMessage = {
      id: generateId(),
      role,
      content: finalContent,
      timestamp: Date.now(),
      metadata
    }
    this.messages.push(msg)

    const maxMessages = this.limits.l1WindowSize * 2
    let evicted = 0
    if (this.messages.length > maxMessages) {
      evicted = this.messages.length - maxMessages
      this.messages = this.messages.slice(-maxMessages)
    }

    return { ok: true, record: msg, evicted: evicted > 0 ? evicted : undefined }
  }

  getAll(): ChatMessage[] {
    return [...this.messages]
  }

  getRecent(count: number): ChatMessage[] {
    return this.messages.slice(-count)
  }

  clear(): void {
    this.messages = []
  }

  load(messages: ChatMessage[]): void {
    this.messages = messages.slice(-this.limits.l1WindowSize * 2)
  }

  toPromptContext(): string {
    return this.messages
      .map((m) => `[${m.role}] ${m.content}`)
      .join('\n')
  }
}
