import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import type { FeatureList, ProposedFeature, ProgressUpdate } from '../types/index.js'
import { readJson, writeJson } from '../utils/index.js'
import type { ToolRegistry } from '../tools/registry.js'

const DEFAULT_FEATURE_LIST: FeatureList = {
  completed: [],
  in_progress: [],
  planned: []
}

export class ProjectContext {
  private agentsMd = ''
  private progressMd = ''
  private featureList: FeatureList = { ...DEFAULT_FEATURE_LIST }

  constructor(private projectRoot: string) {}

  async load(): Promise<void> {
    this.agentsMd = await this.readOptional(join(this.projectRoot, 'AGENTS.md'))
    this.progressMd = await this.readProgress()
    this.featureList = await readJson<FeatureList>(
      join(this.projectRoot, 'feature_list.json'),
      DEFAULT_FEATURE_LIST
    )
  }

  private async readProgress(): Promise<string> {
    const progressPath = join(this.projectRoot, 'progress.md')
    const claudeProgressPath = join(this.projectRoot, 'claude-progress.md')

    if (existsSync(progressPath)) {
      return readFile(progressPath, 'utf-8')
    }
    if (existsSync(claudeProgressPath)) {
      return readFile(claudeProgressPath, 'utf-8')
    }
    return ''
  }

  private async readOptional(path: string): Promise<string> {
    try {
      if (existsSync(path)) return await readFile(path, 'utf-8')
    } catch {
      // ignore
    }
    return ''
  }

  getAgentsPrompt(): string {
    return this.agentsMd
  }

  getProgressContext(): string {
    return this.progressMd
  }

  getFeatureListContext(): string {
    return JSON.stringify(this.featureList, null, 2)
  }

  getFeatureList(): FeatureList {
    return { ...this.featureList }
  }

  async proposeFeatures(features: ProposedFeature[]): Promise<string[]> {
    const added: string[] = []
    const allExisting = new Set([
      ...this.featureList.completed,
      ...this.featureList.in_progress,
      ...this.featureList.planned
    ])

    for (const { name, reason } of features) {
      const trimmed = name.trim()
      if (!trimmed || allExisting.has(trimmed)) continue

      this.featureList.planned.push(trimmed)
      allExisting.add(trimmed)
      added.push(trimmed)

      await this.appendProgressNote(`Proposed feature: **${trimmed}** — ${reason}`)
    }

    if (added.length > 0) {
      await writeJson(join(this.projectRoot, 'feature_list.json'), this.featureList)
    }

    return added
  }

  async applyProgressUpdate(update: ProgressUpdate): Promise<void> {
    const date = new Date().toISOString().slice(0, 10)
    const sections: string[] = [`\n## ${date} (auto)`]

    if (update.completed?.length) {
      sections.push('### Completed\n' + update.completed.map((i) => `- ${i}`).join('\n'))
    }
    if (update.in_progress?.length) {
      sections.push('### In Progress\n' + update.in_progress.map((i) => `- ${i}`).join('\n'))
    }
    if (update.blocked?.length) {
      sections.push('### Blocked\n' + update.blocked.map((i) => `- ${i}`).join('\n'))
    }
    if (update.next?.length) {
      sections.push('### Next\n' + update.next.map((i) => `- ${i}`).join('\n'))
    }

    if (sections.length <= 1) return

    const progressPath = join(this.projectRoot, 'progress.md')
    const existing = existsSync(progressPath) ? await readFile(progressPath, 'utf-8') : '# Progress\n'
    await writeFile(progressPath, existing + sections.join('\n\n') + '\n', 'utf-8')
    this.progressMd = await readFile(progressPath, 'utf-8')
  }

  private async appendProgressNote(note: string): Promise<void> {
    const progressPath = join(this.projectRoot, 'progress.md')
    const existing = existsSync(progressPath)
      ? await readFile(progressPath, 'utf-8')
      : '# Progress\n'
    const date = new Date().toISOString().slice(0, 10)
    const entry = `\n- [${date}] ${note}\n`
    await writeFile(progressPath, existing + entry, 'utf-8')
    this.progressMd = await readFile(progressPath, 'utf-8')
  }

  async reload(): Promise<void> {
    await this.load()
  }
}

export function registerProjectTools(registry: ToolRegistry, project: ProjectContext): void {
  registry.register(
    {
      name: 'get_feature_list',
      description: '读取项目功能清单 feature_list.json（completed / in_progress / planned）',
      parameters: { type: 'object', properties: {} },
      source: 'local'
    },
    async () => project.getFeatureListContext()
  )

  registry.register(
    {
      name: 'get_progress',
      description: '读取项目进度 progress.md，了解当前开发状态',
      parameters: { type: 'object', properties: {} },
      source: 'local'
    },
    async () => project.getProgressContext() || '(progress.md 为空)'
  )
}

export function resolveProjectRoot(explicit?: string): string {
  if (explicit) return explicit

  const cwd = process.cwd()
  if (existsSync(join(cwd, 'AGENTS.md'))) return cwd

  // electron-vite dev: cwd may be project root already
  return cwd
}
