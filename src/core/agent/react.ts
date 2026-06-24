import type { FailedPlanAttempt, ReActStep, Skill, TaskContext } from '../types/index.js'
import type { LLMClient } from '../llm/client.js'
import type { ToolRegistry } from '../tools/registry.js'
import { generateId } from '../utils/index.js'

/** 连续「只思考不行动」的最大步数，超过则强制结束 */
const MAX_IDLE_THINK_STEPS = 2

export class ReActPlanner {
  constructor(
    private llm: LLMClient,
    private tools: ToolRegistry,
    private maxIterations: number
  ) {}

  async plan(context: TaskContext, previousFailures: FailedPlanAttempt[] = []): Promise<TaskContext> {
    context.phase = previousFailures.length > 0 ? 'replanning' : 'planning'

    const systemPrompt = this.buildSystemPrompt(context)
    const steps: ReActStep[] = []
    let taskSucceeded = false
    let failureReason = ''
    let idleThinkCount = 0

    for (let i = 0; i < this.maxIterations; i++) {
      const response = await this.llm.chat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: this.buildUserPrompt(context, steps, previousFailures) }
        ],
        0.5
      )

      const parsed = this.parseResponse(response)
      steps.push(parsed)

      const enteredActionSpace = steps.some((s) => s.action)

      // --- use_tool：进入 action space ---
      if (parsed.decision === 'use_tool' || parsed.action) {
        if (!parsed.action) {
          idleThinkCount++
          continue
        }
        idleThinkCount = 0
        context.phase = 'execution'
        const result = await this.tools.execute(parsed.action.name, parsed.action.arguments)
        context.toolResults.push(result)

        if (result.success) {
          parsed.observation = result.output
        } else {
          parsed.observation = `Error: ${result.error}`
          parsed.failed = true
        }

        context.phase = 'observation'
        continue
      }

      // --- direct_answer：显式不进入 action space → 可终止 ---
      if (parsed.decision === 'direct_answer') {
        const answer = extractAnswer(parsed)
        if (answer) {
          context.finalResponse = answer
          taskSucceeded = true
          break
        }
        idleThinkCount++
        if (idleThinkCount >= MAX_IDLE_THINK_STEPS) {
          context.finalResponse = await this.forceDirectReply(context, steps)
          parsed.decision = 'direct_answer'
          parsed.answer = context.finalResponse
          taskSucceeded = context.finalResponse.length > 0
          break
        }
        continue
      }

      // --- 未声明 decision：禁止静默 FINAL ANSWER ---

      if (/FINAL ANSWER/i.test(parsed.thought) && !enteredActionSpace) {
        idleThinkCount++
        continue
      }

      if (/FINAL ANSWER/i.test(parsed.thought) && enteredActionSpace) {
        context.finalResponse = parsed.thought.replace(/.*FINAL ANSWER[:\s]*/i, '').trim()
        taskSucceeded = context.finalResponse.length > 0
        if (!taskSucceeded) failureReason = 'FINAL ANSWER 为空'
        break
      }

      if (looksLikeDirectReply(parsed.thought) && enteredActionSpace) {
        context.finalResponse = parsed.thought.trim()
        taskSucceeded = true
        break
      }

      if (isMetaOnlyThought(parsed.thought)) {
        idleThinkCount++
        if (idleThinkCount >= MAX_IDLE_THINK_STEPS || isDuplicateThought(parsed.thought, steps)) {
          context.finalResponse = await this.forceDirectReply(context, steps)
          parsed.decision = 'direct_answer'
          parsed.answer = context.finalResponse
          taskSucceeded = context.finalResponse.length > 0
          break
        }
        continue
      }

      idleThinkCount++

      if (steps.length >= 2 && isDuplicateThought(parsed.thought, steps.slice(0, -1))) {
        context.finalResponse = await this.forceDirectReply(context, steps)
        parsed.decision = 'direct_answer'
        parsed.answer = context.finalResponse
        taskSucceeded = context.finalResponse.length > 0
        break
      }

      if (idleThinkCount >= MAX_IDLE_THINK_STEPS) {
        context.finalResponse = await this.forceDirectReply(context, steps)
        parsed.decision = 'direct_answer'
        parsed.answer = context.finalResponse
        taskSucceeded = context.finalResponse.length > 0
        break
      }
    }

    if (!taskSucceeded) {
      const lastFailedStep = [...steps].reverse().find((s) => s.failed)
      const hasToolErrors = steps.some((s) => s.failed)

      if (hasToolErrors && lastFailedStep?.observation) {
        failureReason = lastFailedStep.observation
      } else if (steps.length >= this.maxIterations) {
        // 循环打满：最后一次尝试直接回复
        const fallback = await this.forceDirectReply(context, steps)
        if (fallback) {
          context.finalResponse = fallback
          taskSucceeded = true
        } else {
          failureReason = `达到单轮最大推理步数 (${this.maxIterations})，未能完成任务`
        }
      } else if (steps.length === 0) {
        failureReason = '规划器未产生任何有效步骤'
      } else {
        const last = steps[steps.length - 1]
        failureReason = last.observation?.startsWith('Error:')
          ? last.observation
          : `未能得出最终答案。最后一步: ${last.thought.slice(0, 200)}`
      }
    }

    context.reactSteps = steps
    context.success = taskSucceeded
    context.failureReason = taskSucceeded ? undefined : failureReason
    context.phase = taskSucceeded ? 'complete' : 'failed'
    return context
  }

  /** 强制生成面向用户的最终回复（打破 ReAct 空转） */
  private async forceDirectReply(context: TaskContext, steps: ReActStep[]): Promise<string> {
    const stepSummary = steps
      .slice(-3)
      .map((s) => s.thought.slice(0, 100))
      .join('; ')

    const response = await this.llm.chat(
      [
        {
          role: 'system',
          content:
            '根据用户问题和已有推理，用中文直接给出最终回复。不要解释推理过程，不要 JSON，不要提工具。'
        },
        {
          role: 'user',
          content: `用户: ${context.userRequest}\n\n推理摘要: ${stepSummary || '(无)'}\n\n请直接回复用户:`
        }
      ],
      0.6
    )
    return response.trim()
  }

  private buildSystemPrompt(context: TaskContext): string {
    const toolDefs = this.tools.getDefinitions()
    const toolsDesc = toolDefs.map((t) => `- ${t.name}: ${t.description}`).join('\n')

    const skillsDesc = context.matchedSkills.map((s) => this.formatSkill(s)).join('\n\n')

    const eventsDesc = context.retrievedEvents
      .map((e) => `- [${e.category}] ${e.title}: ${e.description}`)
      .join('\n')

    const l3 = context.longTermSummary ? `长期知识:\n${context.longTermSummary.content}` : ''

    const retryNote =
      context.attemptNumber && context.maxAttempts && context.attemptNumber > 1
        ? `\n注意: 这是第 ${context.attemptNumber}/${context.maxAttempts} 次尝试，前次执行已失败，请调整策略。`
        : ''

    const agentsBlock = context.agentsPrompt
      ? `\n---\n# Agent Identity & Rules (AGENTS.md)\n\n${context.agentsPrompt}\n---\n`
      : ''

    const progressBlock = context.progressContext
      ? `\n## 项目进度 (progress.md)\n${context.progressContext}\n`
      : ''

    const featureBlock = context.featureListContext
      ? `\n## 功能清单 (feature_list.json)\n${context.featureListContext}\n`
      : ''

    return `${agentsBlock}你是 Self-Evolving Personal Agent，使用 ReAct 模式处理**任务型**请求。${retryNote}
${progressBlock}${featureBlock}
可用工具:
${toolsDesc || '(无工具)'}

匹配到的 Skills:
${skillsDesc || '(无匹配 Skill)'}

相关事件记忆 (L2):
${eventsDesc || '(无)'}

${l3}

## Planner 决策（必须显式，不可省略）

每一步必须声明 \`decision\`，Planner 负责选择是否进入 action space：

| decision | 含义 | 要求 |
|----------|------|------|
| \`use_tool\` | 进入 action space | 必须附带 \`action\`，执行后根据 observation 继续 |
| \`direct_answer\` | **明确不进入** action space | 同一步给出 \`answer\` 或 thought 中以 "FINAL ANSWER:" 给出回复 |

**No-tool ReAct 合法路径（一步完成）:**
\`thought\` → \`decision: "direct_answer"\` → \`answer\`

**禁止:**
- 只分析「不需要工具」却不声明 \`direct_answer\`
- 未声明 \`decision\` 就直接 FINAL ANSWER（在未使用工具的首轮）
- 重复相同推理

**工具使用后:** 可根据 observation 继续 \`use_tool\`，或 \`direct_answer\` / FINAL ANSWER 结束。

回复格式 (JSON):
{
  "thought": "简要推理",
  "decision": "use_tool | direct_answer",
  "answer": "用户可见回复（decision=direct_answer 时填写）",
  "action": { "name": "tool_name", "arguments": {} }
}

- \`decision: "use_tool"\` 时填写 action，不要填 answer
- \`decision: "direct_answer"\` 时填写 answer（或 thought 内 FINAL ANSWER），不要填 action
- 若工具失败，分析后换 \`use_tool\` 或 \`direct_answer\` 说明原因`
  }

  private buildUserPrompt(
    context: TaskContext,
    steps: ReActStep[],
    previousFailures: FailedPlanAttempt[]
  ): string {
    const history = context.messages.map((m) => `[${m.role}] ${m.content}`).join('\n')
    const stepLog = steps
      .map((s, i) => {
        let log = `Step ${i + 1} Thought: ${s.thought}`
        if (s.decision) log += `\nDecision: ${s.decision}`
        if (s.answer) log += `\nAnswer: ${s.answer.slice(0, 200)}`
        if (s.action) log += `\nAction: ${s.action.name}(${JSON.stringify(s.action.arguments)})`
        if (s.observation) log += `\nObservation: ${s.observation}`
        return log
      })
      .join('\n\n')

    const failureLog = previousFailures
      .map(
        (f) =>
          `--- 第 ${f.attempt} 次尝试失败 ---\n原因: ${f.reason}\n步骤摘要:\n${f.steps
            .map((s, i) => {
              const action = s.action ? ` → ${s.action.name}` : ''
              const obs = s.observation ? ` = ${s.observation.slice(0, 150)}` : ''
              return `  ${i + 1}. ${s.thought.slice(0, 80)}${action}${obs}`
            })
            .join('\n')}`
      )
      .join('\n\n')

    const last = steps[steps.length - 1]
    const enteredActionSpace = steps.some((s) => s.action)
    let nudge = ''

    if (last && !last.action && !last.decision) {
      nudge =
        '\n⚠️ 缺少显式 decision。必须声明 "use_tool"（附带 action）或 "direct_answer"（附带 answer）。禁止只思考不决策。\n'
    } else if (last?.decision === 'direct_answer' && !extractAnswer(last)) {
      nudge = '\n⚠️ 已声明 direct_answer 但缺少 answer / FINAL ANSWER，请同一步给出用户可见回复。\n'
    } else if (last?.decision === 'use_tool' && !last.action) {
      nudge = '\n⚠️ 已声明 use_tool 但缺少 action，请填写工具调用。\n'
    } else if (
      last &&
      !last.action &&
      /FINAL ANSWER/i.test(last.thought) &&
      !enteredActionSpace
    ) {
      nudge =
        '\n⚠️ 未进入 action space 时，FINAL ANSWER 必须配合 decision: "direct_answer"。请重新输出完整 JSON。\n'
    }

    return `对话历史:
${history}

用户请求: ${context.userRequest}

${failureLog ? `此前失败记录:\n${failureLog}\n\n` : ''}${stepLog ? `本轮已执行步骤:\n${stepLog}\n` : ''}${nudge}
请继续（或立即 FINAL ANSWER）。`
  }

  private parseResponse(response: string): ReActStep {
    try {
      const json = extractJson(response)
      const parsed = JSON.parse(json) as {
        thought: string
        decision?: string
        answer?: string
        action?: { name: string; arguments?: Record<string, unknown> }
      }

      const step: ReActStep = { thought: parsed.thought || response }

      if (parsed.decision === 'use_tool' || parsed.decision === 'direct_answer') {
        step.decision = parsed.decision
      }

      if (parsed.answer?.trim()) {
        step.answer = parsed.answer.trim()
      }

      if (parsed.action?.name) {
        step.decision = step.decision ?? 'use_tool'
        step.action = {
          id: generateId(),
          name: parsed.action.name,
          arguments: parsed.action.arguments ?? {}
        }
      }

      return step
    } catch {
      return { thought: response.trim() }
    }
  }

  private formatSkill(skill: Skill): string {
    const steps = skill.steps
      .map((s, i) => `  ${i + 1}. ${s.action}${s.tool ? ` [${s.tool}]` : ''}`)
      .join('\n')
    return `Skill: ${skill.name} (v${skill.version})\n${skill.description}\n步骤:\n${steps}`
  }
}

/** 从 direct_answer 步骤提取用户可见回复 */
function extractAnswer(step: ReActStep): string | null {
  if (step.decision !== 'direct_answer') return null

  if (step.answer?.trim()) return step.answer.trim()

  const finalMatch = step.thought.match(/FINAL ANSWER[:\s]*([\s\S]*)/i)
  if (finalMatch?.[1]?.trim()) return finalMatch[1].trim()

  return null
}

/** 像面向用户的直接回复，而非元推理 */
function looksLikeDirectReply(thought: string): boolean {
  const t = thought.trim()
  if (t.length < 4) return false
  if (/FINAL ANSWER/i.test(t)) return false
  if (isMetaOnlyThought(t)) return false
  if (t.startsWith('{')) return false
  // 中文问候回复
  if (/^(你好|您好|嗨|Hello|Hi)[!，。~]?/.test(t) && t.length < 200) return true
  return false
}

/** 「用户在问好、不需要工具」类元推理，不是最终答案 */
function isMetaOnlyThought(thought: string): boolean {
  return /不需要.*工具|无需.*工具|不用.*工具|没有具体.*(请求|任务|需求)|只是.*(问好|打招呼|问候|闲聊)|no tool|do not need.*tool|用户只是/i.test(
    thought
  )
}

function normalizeThought(t: string): string {
  return t
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。！？、]/g, '')
    .slice(0, 80)
}

function isDuplicateThought(current: string, priorSteps: ReActStep[]): boolean {
  const cur = normalizeThought(current)
  for (const s of priorSteps) {
    const prev = normalizeThought(s.thought)
    if (cur === prev) return true
    if (cur.length > 15 && prev.length > 15 && (cur.includes(prev) || prev.includes(cur))) return true
  }
  return false
}

function extractJson(text: string): string {
  const match = text.match(/\{[\s\S]*\}/)
  return match ? match[0] : text
}
