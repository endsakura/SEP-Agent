import type { CandidateSkill, Skill, SkillStep, TaskContext } from '../types/index.js'
import type { LLMClient } from '../llm/client.js'
import { SkillStore } from './store.js'

export class SkillManager {
  constructor(
    private store: SkillStore,
    private llm: LLMClient
  ) {}

  async retrieve(query: string): Promise<Skill[]> {
    return this.store.search(query, 3)
  }

  async processCandidate(candidate: CandidateSkill): Promise<Skill> {
    return this.store.addCandidate(candidate)
  }

  async recordUsage(skillId: string, success: boolean): Promise<void> {
    await this.store.recordUsage(skillId, success)
  }

  /** 根据任务结果尝试进化 Skill */
  async tryEvolve(skill: Skill, context: TaskContext): Promise<Skill | null> {
    if (skill.version >= 4) return null

    const evolutionPrompt = this.buildEvolutionPrompt(skill, context)
    const response = await this.llm.chat(
      [
        { role: 'system', content: EVOLUTION_SYSTEM },
        { role: 'user', content: evolutionPrompt }
      ],
      0.3
    )

    try {
      const parsed = JSON.parse(extractJson(response)) as {
        shouldEvolve: boolean
        steps?: SkillStep[]
        notes?: string
      }
      if (!parsed.shouldEvolve || !parsed.steps?.length) return null
      return this.store.evolveSkill(skill.id, parsed.steps, parsed.notes ?? 'evolved')
    } catch {
      return null
    }
  }

  async initialize(): Promise<void> {
    await this.store.load()
    await this.store.seedDefaults()
  }

  getSnapshot() {
    return {
      active: this.store.getActive(),
      candidates: this.store.getCandidates(),
      builtin: this.store.getBuiltin()
    }
  }

  private buildEvolutionPrompt(skill: Skill, context: TaskContext): string {
    return `当前 Skill (v${skill.version}):
名称: ${skill.name}
步骤: ${JSON.stringify(skill.steps, null, 2)}

任务: ${context.userRequest}
执行步骤: ${JSON.stringify(context.reactSteps, null, 2)}
成功: ${context.success}

请判断是否需要进化到 v${skill.version + 1}。`
  }
}

const EVOLUTION_SYSTEM = `你是 Skill 进化引擎。根据任务执行结果，决定 Skill 是否进化。

进化路径:
- v1: 简单步骤
- v2: 加工具调用
- v3: 加条件分支
- v4: 自动化流程

返回 JSON:
{
  "shouldEvolve": boolean,
  "steps": [{ "action": "...", "tool": "...", "condition": "...", "params": {} }],
  "notes": "进化说明"
}`

function extractJson(text: string): string {
  const match = text.match(/\{[\s\S]*\}/)
  return match ? match[0] : text
}
