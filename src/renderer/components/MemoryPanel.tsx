import { useState, useEffect, useCallback } from 'react'
import type { MemorySnapshot } from '../../core/types/index'
import './MemoryPanel.css'

export function MemoryPanel() {
  const [memory, setMemory] = useState<MemorySnapshot | null>(null)
  const [tab, setTab] = useState<'l1' | 'l2' | 'l3'>('l2')

  const refresh = useCallback(async () => {
    const data = await window.agentAPI.getMemory()
    setMemory(data)
  }, [])

  useEffect(() => {
    window.agentAPI.init().then(refresh)
    const interval = setInterval(refresh, 5000)
    return () => clearInterval(interval)
  }, [refresh])

  if (!memory) {
    return <div className="panel-loading">加载记忆...</div>
  }

  return (
    <div className="memory-panel">
      <div className="panel-header">
        <h2>记忆系统</h2>
        <button className="refresh-btn" onClick={refresh}>刷新</button>
      </div>

      <div className="memory-tabs">
        <button className={tab === 'l1' ? 'active' : ''} onClick={() => setTab('l1')}>
          L1 对话窗口 ({memory.l1.length})
        </button>
        <button className={tab === 'l2' ? 'active' : ''} onClick={() => setTab('l2')}>
          L2 事件 ({memory.l2.length})
        </button>
        <button className={tab === 'l3' ? 'active' : ''} onClick={() => setTab('l3')}>
          L3 长期总结
        </button>
      </div>

      <div className="memory-content">
        {tab === 'l1' && (
          <div className="memory-list">
            {memory.l1.length === 0 ? (
              <p className="empty">暂无对话记录</p>
            ) : (
              memory.l1.map((m) => (
                <div key={m.id} className="memory-item l1-item">
                  <span className="role-tag">{m.role}</span>
                  <p>{m.content}</p>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'l2' && (
          <div className="memory-list">
            <p className="l2-hint">L2 存储的是「事件」，不是聊天记录。例如：开始项目、调试失败、切换模型。</p>
            {memory.l2.length === 0 ? (
              <p className="empty">暂无事件记忆</p>
            ) : (
              memory.l2.map((e) => (
                <div key={e.id} className={`memory-item l2-item ${e.status === 'archived' ? 'archived' : ''}`}>
                  <div className="item-header">
                    <span className={`category-tag cat-${e.category}`}>{e.category}</span>
                    <span className="importance">
                      {e.status === 'archived' ? '已归档' : '活跃'} · 重要度 {(e.importance * 100).toFixed(0)}% · 访问 {e.accessCount ?? 0}
                    </span>
                  </div>
                  <h4>{e.title}</h4>
                  <p>{e.description}</p>
                  <time>{new Date(e.createdAt).toLocaleString()}</time>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'l3' && (
          <div className="memory-list">
            {!memory.l3 ? (
              <p className="empty">暂无长期总结</p>
            ) : (
              <div className="memory-item l3-item">
                <div className="topics">
                  {memory.l3.topics.map((t) => (
                    <span key={t} className="topic-tag">{t}</span>
                  ))}
                </div>
                <p className="l3-content">{memory.l3.content}</p>
                <time>更新于 {new Date(memory.l3.updatedAt).toLocaleString()}</time>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
