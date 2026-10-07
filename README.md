# Yanlian · AI Sales Practice Coach

<p align="center">
  <b>让销售新人先在 AI 客户面前犯错，再去面对真正的客户。</b><br/>
  双角色 · 实时语音 · 场景化训练 · 评分复盘
</p>

<p align="center">
  <a href="https://siguadht.github.io/yanlian-ai-sales-coach/"><b>🌐 在线体验官网</b></a>
  &nbsp;·&nbsp;
  <a href="#quick-start"><b>▶ 本地运行完整产品</b></a>
  &nbsp;·&nbsp;
  <a href="#product-demo"><b>🖼 查看产品界面</b></a>
</p>

<p align="center">
  <a href="https://siguadht.github.io/yanlian-ai-sales-coach/">
    <img src="docs/assets/product-workspace.png" alt="言练 AI 销售陪练工作台演示" width="100%" />
  </a>
</p>

言练是一款面向销售新人的双角色 AI 陪练：你可以扮演销售，与 AI 客户进行真实异议对话并获得评分；也可以扮演客户，观察 AI 销售如何推进需求、处理顾虑并完成复盘。产品覆盖装修、教育和保险场景，并提供实时语音、文字陪练、话术助手与训练历史。

## 在线演示 / Live demo

| 入口 | 能体验什么 | 说明 |
| --- | --- | --- |
| **[互动产品官网 →](https://siguadht.github.io/yanlian-ai-sales-coach/)** | 产品故事、双角色切换、异议处理流程和复盘演示 | 免费公开访问，不调用模型或语音服务 |
| **[本地完整产品](#quick-start)** | 实时语音、AI 客户对话、AI 销售示范、评分与历史记录 | 需要自行配置模型与阿里云语音凭证 |

> GitHub Pages 是无需登录的互动宣传演示；完整 AI 产品在本地运行。仓库不包含模型密钥、体验码、用户数据库或原始录音。

<details>
<summary><b>展开查看官网完整长页</b></summary>
<br/>
<a href="https://siguadht.github.io/yanlian-ai-sales-coach/">
  <img src="docs/assets/landing.png" alt="言练互动产品官网完整页面" width="100%" />
</a>
</details>

## Product demo

### 1. 创建训练场景

根据行业、岗位、训练主题、难度和扮演角色创建练习。装修行业进一步区分电销获客与设计师签约两条业务线。

![Yanlian practice workspace](docs/assets/product-workspace.png)

### 2. 进行实时语音陪练

用户扮演销售时，AI 作为客户提出异议并在结束后评分；用户扮演客户时，AI 作为销售进行示范，结束后输出示范拆解。

![Real-time voice practice](docs/assets/product-voice.png)

### 3. 随时调用话术助手

围绕开场、需求探询、价格异议、竞品比较和成交推进获得可执行的话术建议。

![Sales assistant](docs/assets/product-assistant.png)

### 4. 查看训练历史与趋势

保留文字对话、训练结果和分数趋势，支持回看与继续练习；原始录音不落盘。

![Practice history and score trend](docs/assets/product-history.png)

## Features

- 双角色训练：用户扮销售 / 用户扮客户
- 连续实时语音：实时转写、静音断句、AI 播报后自动恢复收听
- 文字陪练：语音不可用时可直接输入
- 训练结果：销售角色获得评分与建议，客户角色获得示范拆解
- 话术助手：围绕真实销售问题提供建议
- 历史记录：保存文字消息、训练结果和趋势，原始录音不落盘
- 装修、教育、保险场景；装修支持电销获客与设计师签约两条线
- 可选邀请码登录与后端数据隔离，供公网演示部署使用

## Tech stack

- Frontend: Next.js 16, React 19, TypeScript
- Backend: FastAPI, SQLAlchemy, SQLite
- LLM: OpenAI-compatible API
- Speech: Alibaba Cloud ASR and TTS; optional Doubao TTS adapter

## Requirements

- Python 3.12
- Node.js 22+
- An OpenAI-compatible model endpoint and API key
- Alibaba Cloud Intelligent Speech credentials for voice features

The external model and speech services may incur charges. Never commit real credentials.

## Quick start

### macOS / Linux

```bash
git clone https://github.com/siguadht/yanlian-ai-sales-coach.git
cd yanlian-ai-sales-coach
./scripts/setup.sh
```

Edit `.env` and replace every placeholder with your own service configuration, then run:

```bash
./scripts/dev.sh
```

### Windows PowerShell

```powershell
git clone https://github.com/siguadht/yanlian-ai-sales-coach.git
cd yanlian-ai-sales-coach
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\setup.ps1
```

Edit `.env`, then run:

```powershell
.\scripts\dev.ps1
```

Open:

- Product workspace: <http://127.0.0.1:3000/>
- Promotional page: <http://127.0.0.1:3000/landing>
- Backend API docs: <http://127.0.0.1:18011/docs>

## Configuration

Copying `.env.example` to `.env` is handled by the setup scripts. Required values:

```dotenv
LLM_BASE_URL=
LLM_API_KEY=
LLM_DIALOG_MODEL=
LLM_EVAL_MODEL=
ALIYUN_ACCESS_KEY_ID=
ALIYUN_ACCESS_KEY_SECRET=
ALIYUN_ASR_APP_KEY=
ALIYUN_TTS_APP_KEY=
```

For a public demo, deploy behind HTTPS and configure `PUBLIC_AUTH_ENABLED=true`, a random `AUTH_SECRET`, separate `INVITE_CODES`, a persistent `DATABASE_URL`, and a public `wss://` origin. Do not expose the local SQLite database or reuse invitation codes across users.

## Manual development

Backend:

```bash
cd backend
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 18011
```

Frontend, in another terminal:

```bash
cd frontend
npm ci
BACKEND_URL=http://127.0.0.1:18011 \
NEXT_PUBLIC_BACKEND_WS_ORIGIN=ws://127.0.0.1:18011 \
npm run dev -- --hostname 127.0.0.1 --port 3000
```

## Verification

```bash
cd backend && .venv/bin/python -m pytest -q
cd ../frontend && npm run test && npm run lint && npm run typecheck && npm run build
```

Browser microphone access requires `localhost`, `127.0.0.1`, or HTTPS. The current continuous-call mode pauses listening while the AI is speaking and does not support interruption.

## Data and security

- `.env`, local databases, invitation codes, build artifacts, caches, and raw audio are excluded from Git.
- Raw audio is processed in memory and is not persisted by the application.
- Model and speech credentials stay on the backend.
- Public deployments must enable authentication, HTTPS, persistent storage, rate limits, and per-user isolation.

## License

[MIT](LICENSE)
