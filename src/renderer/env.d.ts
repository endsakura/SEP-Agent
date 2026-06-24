/// <reference types="vite/client" />

export interface AgentAPI {
  init: () => Promise<{ ok: boolean }>
  send: (message: string) => Promise<unknown>
  getMessages: () => Promise<unknown[]>
  getMemory: () => Promise<unknown>
  getSkills: () => Promise<unknown>
  getMCPStatus: () => Promise<unknown[]>
  onEvent: (callback: (event: unknown) => void) => () => void
}

declare global {
  interface Window {
    agentAPI?: AgentAPI
  }
}

export {}
