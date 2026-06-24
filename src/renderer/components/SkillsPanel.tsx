import { useState, useEffect, useCallback } from 'react'
import type { Skill } from '../../core/types/index'
import './SkillsPanel.css'

export function SkillsPanel() {
  const [active, setActive] = useState<Skill[]>([])
  const [candidates, setCandidates] = useState<Skill[]>([])
  const [tab, setTab] = useState<'active' | 'candidate'>('active')

  const refresh = useCallback(async () => {
    const data = await window.agentAPI.getSkills()
    setActive(data.active)
    setCandidates(data.candidates)
  }, [])

  useEffect(() => {
    window.agentAPI.init().then(refresh)
    const interval = setInterval(refresh, 5000)
    return () => clearInterval(interval)
  }, [refresh])

  const skills = tab === 'active' ? active : candidates

  return (
    <div className="skills-panel">
      <div className="panel-header">
        <h2>Skill 系统</h2>
        <button className="refresh-btn" onClick={refresh}>刷新</button>
      </div>

      <div className="skills-lifecycle">
        <span>任务成功</span>
        <span className="arrow">→</span>
        <span>Reflection</span>
        <span className="arrow">→</span>
        <span>Candidate</span>
        <span className="arrow">→</span>
        <span>评分</span>
        <span className="arrow">→</span>
        <span>Skill 库</span>
      </div>

      <div className="memory-tabs">
        <button className={tab === 'active' ? 'active' : ''} onClick={() => setTab('active')}>
          活跃 Skills ({active.length})
        </button>
        <button className={tab === 'candidate' ? 'active' : ''} onClick={() => setTab('candidate')}>
          候选 Skills ({candidates.length})
        </button>
      </div>

      <div className="skills-content">
        {skills.length === 0 ? (
          <p className="empty">
            {tab === 'active' ? '暂无活跃 Skill' : '暂无候选 Skill'}
            <br />
            <span className="hint">成功完成任务后，Reflection 会自动生成候选 Skill</span>
          </p>
        ) : (
          skills.map((s) => (
            <SkillCard key={s.id} skill={s} />
          ))
        )}
      </div>
    </div>
  )
}

function SkillCard({ skill }: { skill: Skill }) {
  const [expanded, setExpanded] = useState(false)
  const scorePercent = (skill.score * 100).toFixed(0)

  return (
    <div className={`skill-card status-${skill.status}`}>
      <div className="skill-card-header" onClick={() => setExpanded(!expanded)}>
        <div>
          <h4>{skill.name}</h4>
          <span className="skill-meta">
            v{skill.version} · {skill.type} · {skill.status}
            {skill.builtinId && <span className="builtin-tag">内置</span>}
          </span>
        </div>
        <div className="skill-stats">
          <span className="stat">
            <span className="stat-value">{scorePercent}%</span>
            <span className="stat-label">成功率</span>
          </span>
          <span className="stat">
            <span className="stat-value">{skill.usageCount}</span>
            <span className="stat-label">使用</span>
          </span>
        </div>
      </div>

      <p className="skill-desc">{skill.description}</p>

      {skill.triggers.length > 0 && (
        <div className="triggers">
          {skill.triggers.map((t) => (
            <span key={t} className="trigger-tag">{t}</span>
          ))}
        </div>
      )}

      {expanded && (
        <div className="skill-steps">
          <div className="steps-title">执行步骤 (v{skill.version})</div>
          {skill.steps.map((step, i) => (
            <div key={i} className="step">
              <span className="step-num">{i + 1}</span>
              <div>
                <div>{step.action}</div>
                {step.tool && <span className="step-tool">🔧 {step.tool}</span>}
                {step.condition && <span className="step-condition">if: {step.condition}</span>}
              </div>
            </div>
          ))}
          {skill.version < 4 && (
            <p className="evolve-hint">
              进化路径: v1 简单步骤 → v2 工具调用 → v3 条件分支 → v4 自动化流程
            </p>
          )}
        </div>
      )}
    </div>
  )
}
