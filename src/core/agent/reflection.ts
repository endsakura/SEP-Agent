import type { ReflectionResult, TaskContext } from '../types/index.js'
import type { LLMClient } from '../llm/client.js'
import type { MemoryManager } from '../memory/index.js'
import type { MemoryWriteResult } from '../types/index.js'
import type { SkillManager } from '../skills/manager.js'
import type { ProjectContext } from '../context/project.js'

/** Reflection Engine — 每次任务结束必须执行 */
export class ReflectionEngine {
  constructor(
    private llm: LLMClient,
    private memory: MemoryManager,
    private skills: SkillManager,
    private project: ProjectContext
  ) {}

  async reflect(context: TaskContext): Promise<ReflectionResult> {
    // 闲聊：跳过重量级 Reflection（不写 L2 / 不生成 Skill）
    if (context.intent === 'chitchat') {
      context.phase = 'complete'
      return { shouldCreateEvent: false, lessonsLearned: [] }
    }

    context.phase = 'reflection'

    const prompt = this.buildReflectionPrompt(context)
    const response = await this.llm.chat(
      [
        { role: 'system', content: REFLECTION_SYSTEM },
        { role: 'user', content: prompt }
      ],
      0.3
    )

    const result = this.parseReflection(response, context)
    await this.applyReflection(result, context)
    return result
  }

  private buildReflectionPrompt(context: TaskContext): string {
    const featureList = this.project.getFeatureListContext()

    return `任务 ID: ${context.taskId}
用户请求: ${context.userRequest}
是否成功: ${context.success}
最终回复: ${context.finalResponse ?? '(无)'}

ReAct 步骤:
${JSON.stringify(context.reactSteps, null, 2)}

使用的 Skills:
${context.matchedSkills.map((s) => s.name).join(', ') || '(无)'}

当前功能清单:
${featureList}

请进行反思。若发现缺失能力或用户需要尚未实现的功能，通过 proposedFeatures 提议加入 planned。`
  }

  private parseReflection(response: string, context: TaskContext): ReflectionResult {
    try {
      const parsed = JSON.parse(extractJson(response)) as ReflectionResult
      if (parsed.candidateSkill) {
        parsed.candidateSkill.sourceTaskId = context.taskId
      }
      return parsed
    } catch {
      return {
        shouldCreateEvent: context.success,
        lessonsLearned: ['任务已完成'],
        event: context.success
          ? {
              title: truncate(context.userRequest, 80),
              description: context.finalResponse ?? context.userRequest,
              category: 'other' as const,
              importance: 0.5,
              relatedTaskIds: [context.taskId]
            }
          : undefined
      }
    }
  }

  private async applyReflection(result: ReflectionResult, context: TaskContext): Promise<void> {
    const memoryLogs: string[] = []

    if (result.shouldCreateEvent && result.event) {
      const writeResult = await this.memory.addEvent({
        ...result.event,
        relatedTaskIds: [...(result.event.relatedTaskIds ?? []), context.taskId]
      })
      this.collectMemoryLog(memoryLogs, 'L2', writeResult)
    }

    if (result.summaryUpdate) {
      const writeResult = await this.memory.appendKnowledge(result.summaryUpdate)
      this.collectMemoryLog(memoryLogs, 'L3', writeResult)
    }

    if (memoryLogs.length > 0) {
      result.lessonsLearned = [...result.lessonsLearned, ...memoryLogs]
    }

    if (result.candidateSkill) {
      const skill = await this.skills.processCandidate(result.candidateSkill)
      if (context.success) {
        await this.skills.recordUsage(skill.id, true)
      }
    }

    if (result.proposedFeatures?.length) {
      const added = await this.project.proposeFeatures(result.proposedFeatures)
      if (added.length > 0) {
        result.lessonsLearned = [
          ...result.lessonsLearned,
          `提议新功能: ${added.join(', ')}`
        ]
      }
    }

    if (result.progressUpdate) {
      await this.project.applyProgressUpdate(result.progressUpdate)
    }

    for (const skill of context.matchedSkills) {
      await this.skills.recordUsage(skill.id, context.success)
      if (context.success && skill.usageCount >= 2) {
        await this.skills.tryEvolve(skill, context)
      }
    }

    context.phase = 'complete'
  }

  private collectMemoryLog(
    logs: string[],
    layer: string,
    result: MemoryWriteResult
  ): void {
    if (!result.ok) {
      logs.push(`${layer} 写入拒绝: ${result.message}`)
      return
    }
    if (result.merged) {
      logs.push(`${layer} 重复事件已合并`)
    } else if (result.evicted) {
      logs.push(`${layer} 写入成功，淘汰 ${result.evicted} 条旧记忆`)
    } else if (result.message) {
      logs.push(`${layer}: ${result.message}`)
    }
  }
}

const REFLECTION_SYSTEM = `你是 Agent 反思引擎。每次任务结束后分析执行过程。

## 记忆规则
1. L2 记忆是"事件"，不是聊天记录。例如：用户开始OCR项目、调试Agent失败、切换模型
2. 只有重要事件才写入 L2，且 importance 需 ≥ 0.3
3. 重复事件会被合并，低重要度事件会被拒绝
4. 成功的可复用流程应生成 Candidate Skill

## Product Evolution（重要）
阅读当前功能清单，判断任务是否暴露了**尚未实现的能力**。
若有，通过 proposedFeatures 提议新功能（会自动加入 feature_list.json 的 planned）。

例如：用户要求浏览网页但 Browser Agent 未实现 → 提议 { "name": "Browser Agent", "reason": "用户需要网页自动化" }

## 返回 JSON
{
  "shouldCreateEvent": boolean,
  "event": {
    "title": "事件标题",
    "description": "事件描述",
    "category": "project|debug|preference|milestone|other",
    "importance": 0.0-1.0,
    "relatedTaskIds": []
  },
  "candidateSkill": {
    "name": "skill名称",
    "description": "描述",
    "type": "atomic|domain",
    "steps": [{ "action": "步骤", "tool": "工具名(可选)", "condition": "条件(可选)" }],
    "triggers": ["触发词"],
    "reflectionNotes": "为什么生成这个 skill"
  },
  "summaryUpdate": "需要追加到L3长期记忆的压缩知识",
  "proposedFeatures": [
    { "name": "功能名称", "reason": "为什么需要这个功能" }
  ],
  "progressUpdate": {
    "completed": ["已完成项"],
    "in_progress": ["进行中项"],
    "blocked": ["阻塞项"],
    "next": ["下一步"]
  },
  "lessonsLearned": ["经验教训"]
}

candidateSkill 仅在任务成功且流程可复用时生成。
proposedFeatures 仅在发现真正缺失的能力时填写，避免重复提议已有功能。`

function extractJson(text: string): string {
  const match = text.match(/\{[\s\S]*\}/)
  return match ? match[0] : text
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 3) + '...'
}
