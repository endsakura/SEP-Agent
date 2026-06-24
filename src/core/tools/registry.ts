import type { ToolDefinition, ToolResult } from '../types/index.js'
import { generateId } from '../utils/index.js'
import { toolReadFile, toolWriteFile, toolListDirectory } from './local-fs.js'
import { toolWebSearch, getWebSearchProviderLabel } from './web-search.js'

export type ToolHandler = (args: Record<string, unknown>) => Promise<string>

export class ToolRegistry {
  private tools = new Map<string, { def: ToolDefinition; handler: ToolHandler }>()

  register(def: ToolDefinition, handler: ToolHandler): void {
    this.tools.set(def.name, { def, handler })
  }

  unregister(name: string): void {
    this.tools.delete(name)
  }

  unregisterByPrefix(prefix: string): void {
    for (const name of this.tools.keys()) {
      if (name.startsWith(prefix)) this.tools.delete(name)
    }
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.def)
  }

  getMCPDefinitions(): ToolDefinition[] {
    return this.getDefinitions().filter((t) => t.source === 'mcp')
  }

  async execute(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name)
    const id = generateId()

    if (!tool) {
      return { toolCallId: id, success: false, output: '', error: `Unknown tool: ${name}` }
    }

    try {
      const output = await tool.handler(args)
      return { toolCallId: id, success: true, output }
    } catch (err) {
      return {
        toolCallId: id,
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }
}

/** 注册内置本地工具（均为真实实现） */
export function registerLocalTools(registry: ToolRegistry): void {
  registry.register(
    {
      name: 'read_file',
      description: '读取本地文本文件的真实内容（UTF-8）',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件绝对或相对路径' }
        },
        required: ['path']
      },
      source: 'local'
    },
    toolReadFile
  )

  registry.register(
    {
      name: 'write_file',
      description: '将内容真实写入本地文件（UTF-8），自动创建父目录',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '目标文件路径' },
          content: { type: 'string', description: '写入内容' }
        },
        required: ['path', 'content']
      },
      source: 'local'
    },
    toolWriteFile
  )

  registry.register(
    {
      name: 'list_directory',
      description: '列出目录下的真实文件和子目录（含文件大小）',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '目录路径，默认当前目录' }
        },
        required: ['path']
      },
      source: 'local'
    },
    toolListDirectory
  )

  const searchProvider = getWebSearchProviderLabel()
  registry.register(
    {
      name: 'web_search',
      description: `真实网络搜索（当前 provider: ${searchProvider}，可配置 TAVILY/BRAVE/SERPAPI API Key）`,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' }
        },
        required: ['query']
      },
      source: 'local'
    },
    toolWebSearch
  )
}

export { MCPClientManager } from './mcp.js'
export { parseMCPServersConfig, type MCPServerConfig, type MCPConnectionStatus } from './mcp-types.js'
