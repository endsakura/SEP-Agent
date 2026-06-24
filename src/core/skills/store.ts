import type { CandidateSkill, Skill, SkillStep } from '../types/index.js'
import { cosineSimilarity, generateId, readJson, writeJson } from '../utils/index.js'
import type { EmbeddingService } from '../llm/client.js'
import { loadDefaultSkillDefinitions } from './defaults.js'
import { seedBuiltinSkills } from './seed.js'

const PROMOTION_THRESHOLD = 0.6
const EVOLUTION_USAGE_THRESHOLD = 3

export class SkillStore {
  private skills: Skill[] = []

  constructor(
    private embedding: EmbeddingService,
    private storagePath: string,
    private promotionThreshold = PROMOTION_THRESHOLD,
    private projectRoot?: string
  ) {}

  async load(): Promise<void> {
    this.skills = await readJson<Skill[]>(this.storagePath, [])
  }

  /** 启动时注入 skills/default 内置 Skill（按 slug 去重） */
  async seedDefaults(): Promise<number> {
    const definitions = await loadDefaultSkillDefinitions(this.projectRoot)
    const { skills, added } = await seedBuiltinSkills(this.skills, definitions, this.embedding)
    this.skills = skills
    if (added > 0) await this.save()
    return added
  }

  async save(): Promise<void> {
    await writeJson(this.storagePath, this.skills)
  }

  async search(query: string, topK = 3): Promise<Skill[]> {
    const active = this.skills.filter((s) => s.status === 'active')
    if (active.length === 0) return []

    const queryEmb = await this.embedding.embed(query)
    return active
      .map((s) => ({
        skill: s,
        score: cosineSimilarity(queryEmb, s.embedding ?? []) * (0.5 + s.score * 0.5)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((x) => x.skill)
  }

  async addCandidate(candidate: CandidateSkill): Promise<Skill> {
    const text = `${candidate.name}\n${candidate.description}\n${candidate.triggers.join(' ')}`
    const embedding = await this.embedding.embed(text)

    const skill: Skill = {
      id: generateId(),
      name: candidate.name,
      description: candidate.description,
      type: candidate.type,
      version: 1,
      status: 'candidate',
      steps: candidate.steps,
      triggers: candidate.triggers,
      successCount: 0,
      usageCount: 0,
      score: 0,
      embedding,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    this.skills.push(skill)
    await this.save()
    return skill
  }

  async recordUsage(skillId: string, success: boolean): Promise<Skill | null> {
    const skill = this.skills.find((s) => s.id === skillId)
    if (!skill) return null

    skill.usageCount++
    if (success) skill.successCount++
    skill.score = skill.usageCount > 0 ? skill.successCount / skill.usageCount : 0
    skill.updatedAt = Date.now()

    if (skill.status === 'candidate' && skill.score >= this.promotionThreshold && skill.usageCount >= 2) {
      skill.status = 'active'
    }

    await this.save()
    return skill
  }

  /** Skill 进化：v1 → v2 → v3 → v4 */
  async evolveSkill(
    skillId: string,
    newSteps: SkillStep[],
    evolutionNotes: string
  ): Promise<Skill | null> {
    const parent = this.skills.find((s) => s.id === skillId)
    if (!parent || parent.status !== 'active') return null
    if (parent.usageCount < EVOLUTION_USAGE_THRESHOLD) return null

    const text = `${parent.name}\n${parent.description}\n${evolutionNotes}`
    const embedding = await this.embedding.embed(text)

    const evolved: Skill = {
      id: generateId(),
      name: parent.name,
      description: `${parent.description} (v${parent.version + 1}: ${evolutionNotes})`,
      type: parent.type,
      version: parent.version + 1,
      status: 'active',
      steps: newSteps,
      triggers: parent.triggers,
      successCount: 0,
      usageCount: 0,
      score: parent.score,
      parentSkillId: parent.id,
      embedding,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    parent.status = 'deprecated'
    parent.updatedAt = Date.now()
    this.skills.push(evolved)
    await this.save()
    return evolved
  }

  getActive(): Skill[] {
    return this.skills.filter((s) => s.status === 'active')
  }

  getBuiltin(): Skill[] {
    return this.skills.filter((s) => s.builtinId)
  }

  getCandidates(): Skill[] {
    return this.skills.filter((s) => s.status === 'candidate')
  }

  getAll(): Skill[] {
    return [...this.skills].sort((a, b) => b.updatedAt - a.updatedAt)
  }
}
