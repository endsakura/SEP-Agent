import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type { ToolRegistry } from './registry.js'
import type { MCPServerConfig, MCPConnectionStatus } from './mcp-types.js'
import { mcpToolName, toToolDefinition } from './mcp-types.js'

interface ConnectedServer {
  config: MCPServerConfig
  client: Client
}

export class MCPClientManager {
  private servers: ConnectedServer[] = []
  private statuses: MCPConnectionStatus[] = []

  async connectAll(configs: MCPServerConfig[], registry: ToolRegistry): Promise<MCPConnectionStatus[]> {
    await this.disconnectAll()
    this.statuses = []

    for (const config of configs) {
      const status = await this.connectOne(config, registry)
      this.statuses.push(status)
    }

    return this.statuses
  }

  private async connectOne(config: MCPServerConfig, registry: ToolRegistry): Promise<MCPConnectionStatus> {
    const status: MCPConnectionStatus = { name: config.name, connected: false, toolCount: 0 }

    try {
      const client = new Client(
        { name: 'self-evolving-agent', version: '0.1.0' },
        { capabilities: {} }
      )

      const transport = this.createTransport(config)
      await client.connect(transport)

      const { tools } = await client.listTools()
      for (const tool of tools) {
        const def = toToolDefinition(config.name, tool)
        const qualifiedName = mcpToolName(config.name, tool.name)

        registry.register(def, async (args) => {
          const result = await client.callTool({ name: tool.name, arguments: args })
          return formatToolResult(result)
        })

        // 避免重复注册检查 — registry 会覆盖同名
        void qualifiedName
      }

      this.servers.push({ config, client })
      status.connected = true
      status.toolCount = tools.length
    } catch (err) {
      status.error = err instanceof Error ? err.message : String(err)
    }

    return status
  }

  private createTransport(config: MCPServerConfig) {
    if (config.transport === 'sse') {
      if (!config.url) throw new Error(`MCP server "${config.name}": SSE 需要 url`)
      return new SSEClientTransport(new URL(config.url))
    }

    if (!config.command) {
      throw new Error(`MCP server "${config.name}": stdio 需要 command`)
    }

    return new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: { ...process.env, ...config.env } as Record<string, string>
    })
  }

  async disconnectAll(): Promise<void> {
    for (const server of this.servers) {
      try {
        await server.client.close()
      } catch {
        // ignore close errors
      }
    }
    this.servers = []
  }

  getStatuses(): MCPConnectionStatus[] {
    return [...this.statuses]
  }
}

function formatToolResult(result: {
  content?: Array<{ type: string; text?: string }>
  isError?: boolean
}): string {
  if (!result.content?.length) {
    return result.isError ? 'MCP tool returned error with no content' : '(empty result)'
  }

  const text = result.content
    .map((c) => {
      if (c.type === 'text' && c.text) return c.text
      if (c.type === 'image') return '[image content]'
      return JSON.stringify(c)
    })
    .join('\n')

  if (result.isError) {
    throw new Error(text || 'MCP tool error')
  }

  return text
}
