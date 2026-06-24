import { contextBridge, ipcRenderer } from 'electron'

const api = {
  init: () => ipcRenderer.invoke('agent:init'),
  send: (message: string) => ipcRenderer.invoke('agent:send', message),
  getMessages: () => ipcRenderer.invoke('agent:get-messages'),
  getMemory: () => ipcRenderer.invoke('agent:get-memory'),
  getSkills: () => ipcRenderer.invoke('agent:get-skills'),
  getMCPStatus: () => ipcRenderer.invoke('agent:get-mcp-status'),
  onEvent: (callback: (event: unknown) => void) => {
    const handler = (_: Electron.IpcRendererEvent, event: unknown) => callback(event)
    ipcRenderer.on('agent:event', handler)
    return () => ipcRenderer.removeListener('agent:event', handler)
  }
}

try {
  contextBridge.exposeInMainWorld('agentAPI', api)
} catch (err) {
  console.error('[preload] contextBridge.exposeInMainWorld failed:', err)
}
