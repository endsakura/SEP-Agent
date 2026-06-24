import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/global.css'

async function bootstrap(): Promise<void> {
  const rootEl = document.getElementById('root')
  if (!rootEl) return

  // 等待 preload 注入（最多 3 秒）
  for (let i = 0; i < 60; i++) {
    if (window.agentAPI) break
    await new Promise((r) => setTimeout(r, 50))
  }

  if (!window.agentAPI) {
    rootEl.innerHTML = `
      <div style="padding:24px;font-family:sans-serif;color:#e6edf3;background:#0f1117;min-height:100vh;line-height:1.6">
        <h2>Preload 未加载</h2>
        <p><code>window.agentAPI</code> 不可用。</p>
        <p>请完全退出后重试：</p>
        <pre style="background:#161b22;padding:12px;border-radius:8px">taskkill /F /IM electron.exe
npm run dev</pre>
        <p>并查看终端是否有 <code>[SEA] preload-error</code> 日志。</p>
      </div>
    `
    return
  }

  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

bootstrap()
