# Self-Evolving Personal Agent

具备三层记忆、Skill 进化、ReAct 规划与反思引擎的个人 Agent 系统。

## 架构

```
┌────────────────────────────┐
│        Electron UI          │
│ Chat / Memory / Skills      │
└────────────┬───────────────┘
             │
             ▼
┌────────────────────────────┐
│        Agent Core           │
│  ReAct Planner              │
│  Reflection Engine          │
└────────────┬───────────────┘
             │
 ┌───────────┼───────────────┐
 ▼           ▼               ▼
Memory     Skills          Tools
L1/L2/L3   Atomic/Domain   MCP/Local
```

## 核心创新

### 1. 三层记忆

| 层级 | 内容 | 说明 |
|------|------|------|
| L1 | 最近 20 轮对话 | 滑动窗口 |
| L2 | 重要事件 | **不是聊天记录**，是「用户开始 OCR 项目」这类事件 |
| L3 | 长期总结 | 压缩知识 |

### 2. Skill 生命周期

```
任务成功 → Reflection → Candidate Skill → 评分 → Skill 库
```

Skill 会进化：v1 简单步骤 → v2 工具调用 → v3 条件分支 → v4 自动化流程

### 3. 运行流程

```
User Request → ReAct Planner → Memory Retrieval → Skill Retrieval
→ Tool Selection → Execution → Observation → Reflection
→ Update Memory → Update Skill
```

执行失败时自动**重新规划**，最多 5 次（可通过 `MAX_RETRY_ATTEMPTS` 配置），全部失败后终止并返回失败原因。

## MCP 集成

支持通过配置文件连接真实 MCP Server（stdio / SSE）：

```bash
cp mcp-servers.example.json mcp-servers.json
# 编辑 mcp-servers.json，配置 server 命令和参数
```

`.env` 中设置：
```env
MCP_SERVERS_CONFIG=./mcp-servers.json
```

MCP 工具会以 `mcp_{serverName}_{toolName}` 格式注册到 Agent 工具库。

## Agent 上下文文件（强烈推荐）

| 文件 | 作用 |
|------|------|
| `AGENTS.md` | 身份、原则、工作流 — **启动时注入 System Prompt** |
| `feature_list.json` | Product Evolution 功能清单 (completed / in_progress / planned) |
| `progress.md` | 项目进度日志 — 每次启动读取，避免失忆 |

Reflection 会自动：
- 发现缺失功能 → 提议并写入 `feature_list.json` 的 `planned`
- 可选更新 `progress.md`

也可通过工具 `get_feature_list` / `get_progress` 运行时读取。

配置项目根目录：
```env
PROJECT_ROOT=.
```

## 快速开始

```bash
# 安装依赖
npm install

# 配置 LLM API
cp .env.example .env
# 编辑 .env 填入 LLM_API_KEY

# 开发模式
npm run dev
```

## 配置

在 `.env` 中配置 OpenAI 兼容 API：

```env
LLM_API_KEY=your-api-key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
```

支持 Qwen、DeepSeek 等 OpenAI 兼容接口，修改 `LLM_BASE_URL` 即可。

## 项目结构

```
src/
├── main/           # Electron 主进程
├── preload/        # IPC 桥接
├── renderer/       # React UI
└── core/
    ├── agent/      # ReAct + Reflection + 编排
    ├── memory/     # L1/L2/L3
    ├── skills/     # Skill 存储与进化
    ├── tools/      # 本地工具 + MCP 适配
    ├── llm/        # LLM 客户端
    └── types/      # 类型定义
```

## 内置工具

- `read_file` — 读取文件
- `write_file` — 写入文件
- `list_directory` — 列出目录
- `web_search` — 真实网络搜索（DuckDuckGo 免 Key，或配置 Tavily / Brave / SerpAPI）

## License

MIT
