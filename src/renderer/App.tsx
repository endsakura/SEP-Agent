import { useState } from 'react'
import { ChatPanel } from './components/ChatPanel'
import { MemoryPanel } from './components/MemoryPanel'
import { SkillsPanel } from './components/SkillsPanel'
import './App.css'

type Tab = 'chat' | 'memory' | 'skills'

export default function App() {
  const [tab, setTab] = useState<Tab>('chat')
  const [currentPhase, setCurrentPhase] = useState('')

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo">
          <div className="logo-icon">🧠</div>
          <div>
            <h1>SEA</h1>
            <p>Self-Evolving Agent</p>
          </div>
        </div>

        <nav className="nav">
          <button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>
            💬 对话
          </button>
          <button className={tab === 'memory' ? 'active' : ''} onClick={() => setTab('memory')}>
            🧩 记忆
          </button>
          <button className={tab === 'skills' ? 'active' : ''} onClick={() => setTab('skills')}>
            ⚡ Skills
          </button>
        </nav>

        <div className="architecture">
          <div className="arch-title">系统架构</div>
          <div className="arch-flow">
            <div className="arch-box">Electron UI</div>
            <div className="arch-arrow">↓</div>
            <div className="arch-box highlight">Agent Core</div>
            <div className="arch-arrow">↓</div>
            <div className="arch-row">
              <span>Memory</span>
              <span>Skills</span>
              <span>Tools</span>
            </div>
          </div>
          {currentPhase && (
            <div className="current-phase">
              当前: <strong>{currentPhase}</strong>
            </div>
          )}
        </div>
      </aside>

      <main className="main">
        {tab === 'chat' && <ChatPanel onPhaseChange={setCurrentPhase} />}
        {tab === 'memory' && <MemoryPanel />}
        {tab === 'skills' && <SkillsPanel />}
      </main>
    </div>
  )
}
