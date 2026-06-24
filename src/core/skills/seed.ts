import type { DefaultSkillDefinition } from './defaults.js'
import type { Skill } from '../types/index.js'
import type { EmbeddingService } from '../llm/client.js'
import { generateId } from '../utils/index.js'

/** 将默认 Skill 写入库：status=active，立即可用 */
export async function seedBuiltinSkills(
  existing: Skill[],
  definitions: DefaultSkillDefinition[],
  embedding: EmbeddingService
): Promise<{ skills: Skill[]; added: number }> {
  const skills = [...existing]
  let added = 0

  for (const def of definitions) {
    const exists = skills.some(
      (s) => s.builtinId === def.slug || s.name.toLowerCase() === def.name.toLowerCase()
    )
    if (exists) continue

    const text = `${def.name}\n${def.description}\n${def.triggers.join(' ')}`
    const emb = await embedding.embed(text)
    const now = Date.now()

    skills.push({
      id: generateId(),
      name: def.name,
      description: def.description,
      type: def.type,
      version: def.steps.some((s) => s.tool) ? 2 : 1,
      status: 'active',
      steps: def.steps,
      triggers: def.triggers,
      successCount: 1,
      usageCount: 1,
      score: 1,
      builtinId: def.slug,
      embedding: emb,
      createdAt: now,
      updatedAt: now
    })
    added++
  }

  return { skills, added }
}
