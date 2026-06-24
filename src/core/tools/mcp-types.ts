import type { ToolDefinition } from '../types/index.js'

export type MCPTransportType = 'stdio' | 'sse'

export interface MCPServerConfig {
  name: string
  transport: MCPTransportType
  /** stdio: 启动命令 */
  command?: string
  /** stdio: 命令参数 */
  args?: string[]
  /** stdio: 环境变量 */
  env?: Record<string, string>
  /** sse: 服务端 URL */
  url?: string
  /** 是否启用，默认 true */
  enabled?: boolean
}

export interface MCPConnectionStatus {
  name: string
  connected: boolean
  toolCount: number
  error?: string
}

export function parseMCPServersConfig(raw: string | undefined): MCPServerConfig[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw) as MCPServerConfig[]
    return Array.isArray(parsed) ? parsed.filter((s) => s.enabled !== false) : []
  } catch {
    return []
  }
}

export function mcpToolName(serverName: string, toolName: string): string {
  const safeServer = serverName.replace(/[^a-zA-Z0-9_-]/g, '_')
  return `mcp_${safeServer}_${toolName}`
}

export function toToolDefinition(serverName: string, tool: {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}): ToolDefinition {
  return {
    name: mcpToolName(serverName, tool.name),
    description: `[MCP:${serverName}] ${tool.description ?? tool.name}`,
    parameters: (tool.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} },
    source: 'mcp'
  }
}
