import { app, BrowserWindow, ipcMain } from 'electron'
import { join, dirname } from 'path'
import { existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import { AgentCore, createAgentFromEnv } from '../core/agent/index.js'
import type { AgentRuntimeEvent } from '../core/agent/index.js'

config()

const mainDir = dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null
let agent: AgentCore | null = null

/** 解析 preload 绝对路径（兼容 index.mjs / index.js） */
function getPreloadPath(): string {
  const candidates = [
    join(mainDir, '../preload/index.mjs'),
    join(mainDir, '../preload/index.js'),
    join(app.getAppPath(), 'out/preload/index.mjs'),
    join(app.getAppPath(), 'out/preload/index.js')
  ]

  for (const p of candidates) {
    if (existsSync(p)) {
      console.log('[SEA] preload:', p)
      return p
    }
  }

  console.error('[SEA] preload not found, tried:\n', candidates.join('\n'))
  return candidates[0]
}

async function initAgent(): Promise<AgentCore> {
  const dataDir = join(app.getPath('userData'), 'agent-data')
  const projectRoot = process.env.PROJECT_ROOT ?? process.cwd()
  const core = createAgentFromEnv(dataDir, projectRoot)
  await core.initialize()

  core.onEvent((event: AgentRuntimeEvent) => {
    mainWindow?.webContents.send('agent:event', event)
  })

  return core
}

function createWindow(): void {
  const preloadPath = getPreloadPath()

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Self-Evolving Personal Agent',
    show: false,
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.webContents.on('preload-error', (_event, path, error) => {
    console.error('[SEA] preload-error:', path, error)
  })

  mainWindow.webContents.on('did-fail-load', (_event, code, desc, url) => {
    console.error(`[SEA] did-fail-load (${code}): ${desc} — ${url}`)
  })

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents
      .executeJavaScript('typeof window.agentAPI !== "undefined"')
      .then((ok) => console.log('[SEA] window.agentAPI ready:', ok))
      .catch((err) => console.error('[SEA] agentAPI check failed:', err))
    mainWindow?.show()
  })

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    console.log('[SEA] loadURL:', rendererUrl)
    mainWindow.loadURL(rendererUrl)
  } else {
    mainWindow.loadFile(join(mainDir, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function registerIpc(): void {
  ipcMain.handle('agent:send', async (_event, message: string) => {
    if (!agent) agent = await initAgent()
    return agent.processUserMessage(message)
  })

  ipcMain.handle('agent:get-messages', async () => {
    if (!agent) agent = await initAgent()
    return agent.getL1Messages()
  })

  ipcMain.handle('agent:get-memory', async () => {
    if (!agent) agent = await initAgent()
    return agent.getMemorySnapshot()
  })

  ipcMain.handle('agent:get-skills', async () => {
    if (!agent) agent = await initAgent()
    return agent.getSkillsSnapshot()
  })

  ipcMain.handle('agent:get-mcp-status', async () => {
    if (!agent) agent = await initAgent()
    return agent.getMCPStatuses()
  })

  ipcMain.handle('agent:init', async () => {
    if (!agent) agent = await initAgent()
    return { ok: true }
  })
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
