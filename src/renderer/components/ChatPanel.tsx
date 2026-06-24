import { useState, useEffect, useRef, useCallback } from 'react'
import type { ChatMessage } from '../../core/types/index'
import type { AgentRuntimeEvent } from './types'
import './ChatPanel.css'

interface Props {
  onPhaseChange?: (phase: string) => void
}

export function ChatPanel({ onPhaseChange }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [phase, setPhase] = useState('')
  const [reactLog, setReactLog] = useState<string[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.agentAPI.init().then(() => {
      window.agentAPI.getMessages().then(setMessages)
    })

    const unsub = window.agentAPI.onEvent((event: AgentRuntimeEvent) => {
      if (event.type === 'phase') {
        const label = event.attempt ? `${event.phase} (${event.attempt})` : event.phase
        setPhase(label)
        onPhaseChange?.(label)
      }
      if (event.type === 'replan') {
        setReactLog((prev) => [
          ...prev,
          `🔄 第 ${event.attempt}/${event.maxAttempts} 次失败，重新规划: ${event.reason.slice(0, 100)}`
        ])
      }
      if (event.type === 'react_step') {
        const s = event.step
        let line: string
        if (s.action) {
          line = `🔧 ${s.action.name}: ${s.observation?.slice(0, 120) ?? '...'}`
        } else if (s.decision === 'direct_answer') {
          line = s.answer
            ? `📋 direct_answer → ${s.answer.slice(0, 120)}`
            : `📋 direct_answer: ${s.thought.slice(0, 100)}`
        } else if (s.decision === 'use_tool') {
          line = `🔧 use_tool (等待 action): ${s.thought.slice(0, 80)}`
        } else {
          line = `💭 ${s.thought.slice(0, 120)}`
        }
        setReactLog((prev) => [...prev, line])
      }
      if (event.type === 'message' && event.role === 'assistant') {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: event.content,
            timestamp: Date.now()
          }
        ])
      }
    })

    return unsub
  }, [onPhaseChange])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, reactLog])

  const send = useCallback(async () => {
    if (!input.trim() || loading) return
    const text = input.trim()
    setInput('')
    setLoading(true)
    setReactLog([])

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now()
    }
    setMessages((prev) => [...prev, userMsg])

    try {
      await window.agentAPI.send(text)
      const updated = await window.agentAPI.getMessages()
      setMessages(updated)
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `错误: ${err instanceof Error ? err.message : String(err)}`,
          timestamp: Date.now()
        }
      ])
    } finally {
      setLoading(false)
      setPhase('')
    }
  }, [input, loading])

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <h2>对话</h2>
        {phase && <span className="phase-badge">{phase}</span>}
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="empty-state">
            <p>Self-Evolving Personal Agent</p>
            <p className="hint">发送消息开始对话。Agent 会自动检索记忆、匹配 Skill、执行工具并反思进化。</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`message message-${m.role}`}>
            <div className="message-role">{m.role === 'user' ? '你' : 'Agent'}</div>
            <div className="message-content">{m.content}</div>
          </div>
        ))}
        {reactLog.length > 0 && (
          <div className="react-log">
            <div className="react-log-title">ReAct 执行</div>
            {reactLog.map((line, i) => (
              <div key={i} className="react-log-line">{line}</div>
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-area">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
          rows={3}
          disabled={loading}
        />
        <button onClick={send} disabled={loading || !input.trim()}>
          {loading ? '思考中...' : '发送'}
        </button>
      </div>
    </div>
  )
}
