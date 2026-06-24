export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  timestamp: number
  metadata?: Record<string, unknown>
}

/** L2: 重要事件 — 不是聊天记录 */
export interface MemoryEvent {
  id: string
  title: string
  description: string
  category: 'project' | 'debug' | 'preference' | 'milestone' | 'other'
  importance: number // 0-1
  embedding?: number[]
  createdAt: number
  updatedAt: number
  relatedTaskIds: string[]
  /** 被检索/合并次数 */
  accessCount: number
  /** 最后被访问时间 */
  lastAccess: number
  status: 'active' | 'archived'
  archivedAt?: number
}

/** L3: 长期压缩知识 */
export interface LongTermSummary {
  id: string
  content: string
  topics: string[]
  updatedAt: number
  sourceEventIds: string[]
}

export type SkillType = 'atomic' | 'domain'
export type SkillStatus = 'candidate' | 'active' | 'deprecated'

export interface SkillStep {
  action: string
  tool?: string
  condition?: string
  params?: Record<string, unknown>
}

export interface Skill {
  id: string
  name: string
  description: string
  type: SkillType
  version: number
  status: SkillStatus
  steps: SkillStep[]
  triggers: string[]
  successCount: number
  usageCount: number
  score: number
  parentSkillId?: string
  /** 内置 Skill 标识，用于启动时去重 */
  builtinId?: string
  createdAt: number
  updatedAt: number
  embedding?: number[]
}

export interface CandidateSkill {
  name: string
  description: string
  type: SkillType
  steps: SkillStep[]
  triggers: string[]
  sourceTaskId: string
  reflectionNotes: string
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  source: 'local' | 'mcp'
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ToolResult {
  toolCallId: string
  success: boolean
  output: string
  error?: string
}

export type AgentPhase =
  | 'planning'
  | 'replanning'
  | 'memory_retrieval'
  | 'skill_retrieval'
  | 'tool_selection'
  | 'execution'
  | 'observation'
  | 'reflection'
  | 'complete'
  | 'failed'

/** Planner 显式决策：是否进入 action space */
export type PlannerDecision = 'use_tool' | 'direct_answer'

export interface ReActStep {
  thought: string
  /** 显式声明：use_tool 须附带 action；direct_answer 表示不进入 action space */
  decision?: PlannerDecision
  /** decision=direct_answer 时的用户可见回复 */
  answer?: string
  action?: ToolCall
  observation?: string
  failed?: boolean
}

export interface FailedPlanAttempt {
  attempt: number
  steps: ReActStep[]
  reason: string
}

export interface TaskContext {
  taskId: string
  userRequest: string
  messages: ChatMessage[]
  retrievedEvents: MemoryEvent[]
  longTermSummary: LongTermSummary | null
  matchedSkills: Skill[]
  reactSteps: ReActStep[]
  toolResults: ToolResult[]
  finalResponse?: string
  failureReason?: string
  success: boolean
  phase: AgentPhase
  attemptNumber?: number
  maxAttempts?: number
  failedAttempts?: FailedPlanAttempt[]
  /** chitchat = 闲聊直接回复; task = ReAct 任务流 */
  intent?: 'chitchat' | 'task'
  /** AGENTS.md 注入内容 */
  agentsPrompt?: string
  /** progress.md 项目进度 */
  progressContext?: string
  /** feature_list.json 快照 */
  featureListContext?: string
}

export interface FeatureList {
  completed: string[]
  in_progress: string[]
  planned: string[]
}

export interface ProposedFeature {
  name: string
  reason: string
}

export interface ProgressUpdate {
  completed?: string[]
  in_progress?: string[]
  blocked?: string[]
  next?: string[]
}

/** 各层记忆容量与校验阈值 */
export interface MemoryLimits {
  l1WindowSize: number
  l1MaxMessageChars: number
  l2MaxEvents: number
  l2MinImportance: number
  l2DuplicateThreshold: number
  l2MaxTitleChars: number
  l2MaxDescriptionChars: number
  l3MaxChars: number
  l3MaxFragmentChars: number
  /** 活跃 L2 事件达到此数量时触发 L3 压缩 */
  l3CompressEventThreshold: number
}

export interface L3CompressResult {
  compressed: boolean
  eventCount: number
  archivedIds: string[]
  summary?: LongTermSummary
}

export type MemoryRejectReason =
  | 'empty'
  | 'too_long'
  | 'low_importance'
  | 'duplicate'
  | 'invalid_category'

export interface MemoryWriteResult<T = unknown> {
  ok: boolean
  record?: T
  reason?: MemoryRejectReason
  message?: string
  evicted?: number
  merged?: boolean
}

export interface ReflectionResult {
  shouldCreateEvent: boolean
  event?: Omit<MemoryEvent, 'id' | 'createdAt' | 'updatedAt' | 'embedding'>
  candidateSkill?: CandidateSkill
  summaryUpdate?: string
  lessonsLearned: string[]
  /** Product Evolution: 发现缺失功能，加入 planned */
  proposedFeatures?: ProposedFeature[]
  /** 自动追加 progress.md 条目 */
  progressUpdate?: ProgressUpdate
}

export interface AgentConfig {
  llmApiKey: string
  llmBaseUrl: string
  llmModel: string
  embeddingApiKey?: string
  embeddingBaseUrl?: string
  embeddingModel?: string
  dataDir: string
  l1WindowSize: number
  skillPromotionThreshold: number
  maxReactIterations: number
  maxRetryAttempts: number
  memoryLimits?: Partial<MemoryLimits>
  mcpServersConfig?: string
  mcpServersConfigPath?: string
  projectRoot?: string
}

export interface MemorySnapshot {
  l1: ChatMessage[]
  l2: MemoryEvent[]
  l3: LongTermSummary | null
}

export interface SkillsSnapshot {
  active: Skill[]
  candidates: Skill[]
  builtin?: Skill[]
}
