import { readdir, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join, resolve } from 'path'
import type { SkillStep, SkillType } from '../types/index.js'

/** 默认 Skill 定义（skills/default/*.json） */
export interface DefaultSkillDefinition {
  slug: string
  name: string
  description: string
  type: SkillType
  triggers: string[]
  steps: SkillStep[]
}

const DEFAULT_SKILLS: DefaultSkillDefinition[] = [
  {
    slug: 'directory-analysis',
    name: 'Directory Analysis',
    description: '分析目录结构，识别项目类型、关键文件和目录布局',
    type: 'domain',
    triggers: ['目录', '文件夹', '项目结构', 'directory', 'list files', '分析目录'],
    steps: [
      { action: '确认目标目录路径', tool: 'list_directory', params: { path: '.' } },
      { action: '列出目录内容，区分文件与子目录' },
      { action: '识别配置文件、源码目录、文档等关键路径' },
      { action: '输出结构化目录摘要：树形概览 + 各目录用途说明' }
    ]
  },
  {
    slug: 'code-reading',
    name: 'Code Reading',
    description: '阅读并理解代码文件，解释模块职责、依赖关系和核心逻辑',
    type: 'domain',
    triggers: ['读代码', '解释代码', '代码结构', 'code review', '这个文件干什么', 'read code'],
    steps: [
      { action: '定位目标文件或模块路径' },
      { action: '读取源码文件', tool: 'read_file' },
      { action: '识别 imports、exports、主要函数/类' },
      { action: '解释代码职责、数据流和与其他模块的关系' },
      { action: 'FINAL ANSWER: 给出清晰的中文代码解读' }
    ]
  },
  {
    slug: 'file-search',
    name: 'File Search',
    description: '在目录中查找匹配名称或类型的文件，并返回路径列表',
    type: 'atomic',
    triggers: ['找文件', '搜索文件', 'find file', 'where is', '哪个文件', 'file search'],
    steps: [
      { action: '确定搜索根目录和匹配条件（文件名/扩展名/关键词）' },
      { action: '列出目录内容', tool: 'list_directory' },
      { action: '筛选匹配的文件路径', condition: '存在子目录时逐层探索' },
      { action: '返回匹配文件列表及简要说明' }
    ]
  },
  {
    slug: 'error-debugging',
    name: 'Error Debugging',
    description: '分析错误信息，定位根因并提出修复方案',
    type: 'domain',
    triggers: ['报错', '错误', 'debug', '失败', 'exception', 'error', '调试', 'fix bug'],
    steps: [
      { action: '解析错误信息：错误类型、堆栈、涉及文件/行号' },
      { action: '读取出错相关源文件', tool: 'read_file', condition: '错误信息包含文件路径' },
      { action: '对比预期行为与实际行为，推断根因' },
      { action: '提出具体修复步骤；若可安全修复，使用 write_file 应用补丁' },
      { action: '说明修复理由和验证方法' }
    ]
  },
  {
    slug: 'web-research',
    name: 'Web Research',
    description: '搜索网络信息，汇总可靠结论并注明来源局限',
    type: 'atomic',
    triggers: ['搜索', '查一下', 'web search', '网上', '最新', 'research', '查询资料'],
    steps: [
      { action: '提炼搜索关键词，明确信息需求' },
      { action: '执行网络搜索', tool: 'web_search' },
      { action: '筛选与问题最相关的结果' },
      { action: '综合多条信息给出结论，标注不确定性' }
    ]
  },
  {
    slug: 'document-summarization',
    name: 'Document Summarization',
    description: '读取文档或长文本，提取要点并生成结构化摘要',
    type: 'atomic',
    triggers: ['总结', '摘要', 'summarize', '概括', '文档总结', '太长', '提炼要点'],
    steps: [
      { action: '确认文档路径或内容来源' },
      { action: '读取文档全文', tool: 'read_file' },
      { action: '提取：主题、关键论点、重要数据/步骤' },
      { action: '输出结构化摘要（ bullet points 或分段）' }
    ]
  }
]

export function resolveDefaultSkillsDir(projectRoot?: string): string {
  const root = projectRoot ?? process.cwd()
  return join(root, 'skills', 'default')
}

/** 从 skills/default/*.json 加载，目录不存在时回退到内置定义 */
export async function loadDefaultSkillDefinitions(projectRoot?: string): Promise<DefaultSkillDefinition[]> {
  const dir = resolveDefaultSkillsDir(projectRoot)
  if (!existsSync(dir)) return DEFAULT_SKILLS

  try {
    const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort()
    if (files.length === 0) return DEFAULT_SKILLS

    const defs: DefaultSkillDefinition[] = []
    for (const file of files) {
      try {
        const raw = await readFile(join(dir, file), 'utf-8')
        const parsed = JSON.parse(raw) as DefaultSkillDefinition
        if (parsed.slug && parsed.name && parsed.steps?.length) {
          defs.push(parsed)
        }
      } catch {
        // skip invalid file
      }
    }
    return defs.length > 0 ? defs : DEFAULT_SKILLS
  } catch {
    return DEFAULT_SKILLS
  }
}

export { DEFAULT_SKILLS }
