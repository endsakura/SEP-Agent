import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import type { AgentConfig, FailedPlanAttempt, TaskContext } from '../types/index.js'
import { generateId, joinPath, ensureDir } from '../utils/index.js'
import { LLMClient, EmbeddingService } from '../llm/client.js'
import { MemoryManager } from '../memory/index.js'
import { SkillManager } from '../skills/manager.js'
import { SkillStore } from '../skills/store.js'
import {
  ToolRegistry,
  registerLocalTools,
  MCPClientManager,
  parseMCPServersConfig,
  type MCPConnectionStatus
} from '../tools/registry.js'
import { ReActPlanner } from './react.js'
import { ReflectionEngine } from './reflection.js'
import { DirectChatHandler } from './direct-chat.js'
import { classifyIntent } from './intent.js'
import { ProjectContext, registerProjectTools, resolveProjectRoot } from '../context/index.js'

export type AgentEventListener = (event: AgentRuntimeEvent) => void

export type AgentRuntimeEvent =
  | { type: 'phase'; phase: TaskContext['phase']; taskId: string; attempt?: number }
  | { type: 'replan'; attempt: number; maxAttempts: number; reason: string; taskId: string }
  | { type: 'message'; role: 'assistant'; content: string; taskId: string }
  | { type: 'react_step'; step: TaskContext['reactSteps'][0]; taskId: string; attempt?: number }
  | { type: 'reflection'; result: unknown; taskId: string }
  | { type: 'error'; error: string; taskId: string }
  | { type: 'mcp_status'; servers: MCPConnectionStatus[] }

/**
 * Agent Core — 完整运行流程:
 * User Request → ReAct Planner → Memory Retrieval → Skill Retrieval
 * → Tool Selection → Execution → Observation → Reflection
 * → Update Memory → Update Skill
 *
 * 执行失败时自动重新规划，最多 maxRetryAttempts 次。
 */
export class AgentCore {
  private llm: LLMClient
  private embedding: EmbeddingService
  private memory: MemoryManager
  private skills: SkillManager
  private tools: ToolRegistry
  private mcp: MCPClientManager
  private planner: ReActPlanner
  private directChat: DirectChatHandler
  private reflection: ReflectionEngine
  private project: ProjectContext
  private listeners: AgentEventListener[] = []
  private mcpStatuses: MCPConnectionStatus[] = []

  constructor(private config: AgentConfig) {
    this.llm = new LLMClient(config)
    this.embedding = new EmbeddingService(this.llm)
    this.memory = new MemoryManager(this.embedding, this.llm, config.dataDir, {
      l1WindowSize: config.l1WindowSize,
      ...config.memoryLimits
    })
    this.skills = new SkillManager(
      new SkillStore(
        this.embedding,
        joinPath(config.dataDir, 'skills.json'),
        config.skillPromotionThreshold,
        resolveProjectRoot(config.projectRoot)
      ),
      this.llm
    )
    this.tools = new ToolRegistry()
    this.mcp = new MCPClientManager()
    this.project = new ProjectContext(resolveProjectRoot(config.projectRoot))
    registerLocalTools(this.tools)
    this.planner = new ReActPlanner(this.llm, this.tools, config.maxReactIterations)
    this.directChat = new DirectChatHandler(this.llm)
    this.reflection = new ReflectionEngine(this.llm, this.memory, this.skills, this.project)
  }

  async initialize(): Promise<void> {
    await ensureDir(this.config.dataDir)
    await this.project.load()
    registerProjectTools(this.tools, this.project)
    await this.memory.initialize()
    await this.skills.initialize()
    await this.connectMCPServers()
  }

  private async connectMCPServers(): Promise<void> {
    const configs = await loadMCPServerConfigs(this.config)
    if (configs.length === 0) return

    this.tools.unregisterByPrefix('mcp_')
    this.mcpStatuses = await this.mcp.connectAll(configs, this.tools)
    this.emit({ type: 'mcp_status', servers: this.mcpStatuses })
  }

  onEvent(listener: AgentEventListener): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }

  private emit(event: AgentRuntimeEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  async processUserMessage(userRequest: string): Promise<TaskContext> {
    const taskId = generateId()
    const maxAttempts = this.config.maxRetryAttempts
    const failedAttempts: FailedPlanAttempt[] = []

    const context: TaskContext = {
      taskId,
      userRequest,
      messages: this.memory.l1.getAll(),
      retrievedEvents: [],
      longTermSummary: null,
      matchedSkills: [],
      reactSteps: [],
      toolResults: [],
      success: false,
      phase: 'memory_retrieval',
      maxAttempts,
      failedAttempts
    }

    this.memory.addConversation('user', userRequest)
    const intent = classifyIntent(userRequest)
    context.intent = intent

    this.emit({ type: 'phase', phase: 'memory_retrieval', taskId })

    try {
      const retrieved = await this.memory.retrieveForTask(userRequest)
      context.retrievedEvents = retrieved.events
      context.longTermSummary = retrieved.summary

      context.agentsPrompt = this.project.getAgentsPrompt()
      context.progressContext = this.project.getProgressContext()
      context.featureListContext = this.project.getFeatureListContext()

      // --- 闲聊：直接回复，跳过 ReAct / Skill / 重试 ---
      if (intent === 'chitchat') {
        this.emit({ type: 'phase', phase: 'planning', taskId })
        const replied = await this.directChat.respond(context)
        this.emit({
          type: 'react_step',
          step: replied.reactSteps[0] ?? { thought: 'direct chat' },
          taskId
        })

        if (replied.finalResponse) {
          this.memory.addConversation('assistant', replied.finalResponse)
          this.emit({ type: 'message', role: 'assistant', content: replied.finalResponse, taskId })
        }

        const reflectionResult = await this.reflection.reflect(replied)
        this.emit({ type: 'reflection', result: reflectionResult, taskId })
        this.emit({ type: 'phase', phase: 'complete', taskId })
        return replied
      }

      // --- 任务型：ReAct + 可选重试 ---
      this.emit({ type: 'phase', phase: 'skill_retrieval', taskId })
      context.matchedSkills = await this.skills.retrieve(userRequest)

      this.emit({ type: 'phase', phase: 'tool_selection', taskId })

      let finalContext: TaskContext = context

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        context.attemptNumber = attempt
        context.reactSteps = []
        context.toolResults = []
        context.finalResponse = undefined
        context.failureReason = undefined
        context.success = false

        this.emit({
          type: 'phase',
          phase: attempt > 1 ? 'replanning' : 'planning',
          taskId,
          attempt
        })

        const planned = await this.planner.plan(context, failedAttempts)

        for (const step of planned.reactSteps) {
          this.emit({ type: 'react_step', step, taskId, attempt })
        }

        if (planned.success) {
          finalContext = planned
          break
        }

        const reason = planned.failureReason ?? '执行未成功完成'
        failedAttempts.push({
          attempt,
          steps: planned.reactSteps,
          reason
        })
        context.failedAttempts = failedAttempts

        if (attempt < maxAttempts) {
          this.emit({ type: 'replan', attempt, maxAttempts, reason, taskId })
        } else {
          planned.finalResponse =
            `任务在 ${maxAttempts} 次尝试后仍未成功。\n\n最后失败原因: ${reason}\n\n` +
            `建议: 请检查工具配置、文件路径或简化任务后重试。`
          planned.success = false
          planned.phase = 'failed'
          finalContext = planned
        }
      }

      if (finalContext.finalResponse) {
        this.memory.addConversation('assistant', finalContext.finalResponse)
        this.emit({
          type: 'message',
          role: 'assistant',
          content: finalContext.finalResponse,
          taskId
        })
      }

      const reflectionResult = await this.reflection.reflect(finalContext)
      await this.project.reload()
      this.emit({ type: 'reflection', result: reflectionResult, taskId })
      this.emit({ type: 'phase', phase: finalContext.success ? 'complete' : 'failed', taskId })

      return finalContext
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      this.emit({ type: 'error', error, taskId })
      context.success = false
      context.phase = 'failed'
      context.finalResponse = `处理出错: ${error}`
      this.memory.addConversation('assistant', context.finalResponse)
      return context
    }
  }

  getMemorySnapshot() {
    return this.memory.getSnapshot()
  }

  getSkillsSnapshot() {
    return this.skills.getSnapshot()
  }

  getL1Messages() {
    return this.memory.l1.getAll()
  }

  getMCPStatuses() {
    return this.mcpStatuses
  }

  getProjectContext() {
    return {
      agentsMd: this.project.getAgentsPrompt(),
      progress: this.project.getProgressContext(),
      featureList: this.project.getFeatureList()
    }
  }
}

async function loadMCPServerConfigs(config: AgentConfig) {
  if (config.mcpServersConfig) {
    return parseMCPServersConfig(config.mcpServersConfig)
  }

  const configPath = config.mcpServersConfigPath
  if (configPath && existsSync(configPath)) {
    const raw = await readFile(configPath, 'utf-8')
    return parseMCPServersConfig(raw)
  }

  return []
}

export function createAgentFromEnv(dataDir: string, projectRoot?: string): AgentCore {
  const config: AgentConfig = {
    llmApiKey: process.env.LLM_API_KEY ?? '',
    llmBaseUrl: process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1',
    llmModel: process.env.LLM_MODEL ?? 'gpt-4o-mini',
    embeddingApiKey: process.env.EMBEDDING_API_KEY,
    embeddingBaseUrl: process.env.EMBEDDING_BASE_URL,
    embeddingModel: process.env.EMBEDDING_MODEL,
    dataDir,
    l1WindowSize: 20,
    skillPromotionThreshold: 0.6,
    maxReactIterations: 8,
    maxRetryAttempts: Number(process.env.MAX_RETRY_ATTEMPTS ?? 5),
    mcpServersConfig: process.env.MCP_SERVERS,
    mcpServersConfigPath: process.env.MCP_SERVERS_CONFIG,
    projectRoot: projectRoot ?? process.env.PROJECT_ROOT
  }
  return new AgentCore(config)
}
