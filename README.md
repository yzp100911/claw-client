# Claw Client 🦀

> 🤖 **Claw Client 执行端** — 运行在 Ubuntu 服务器上的 AI 助手客户端，支持 Playwright 浏览器自动化

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js v22+](https://img.shields.io/badge/Node.js-v22+-green.svg)](https://nodejs.org/)
[![Playwright](https://img.shields.io/badge/Playwright-Enabled-blue.svg)](https://playwright.dev/)

---

## 🏗️ 系统架构关系

```
🌐 Web UI → 📡 eclaw-server (中转与调度) → 🤖 claw-client (终端执行)
                                                ↓
                                          🧠 xCrab-Agent (AI 大脑)
```

| 项目 | 角色 | 仓库地址 |
|------|------|----------|
| 🧠 **xCrab-Agent** | AI 对话引擎（智能助手） | [→ 前往仓库](https://github.com/yzp100911/xCrab-Agent) |
| 📡 **eclaw-server** | 中转服务器（Web ↔ 执行端 的桥梁） | [→ 前往仓库](https://github.com/yzp100911/eclaw-server) |
| 🤖 **claw-client** | 执行终端（在目标服务器上执行命令） | 就是本仓库！ |

---

## 🌐 语言切换

| Language | File |
|----------|------|
| 🇨🇳 **中文** | `README.md`（当前） |
| 🇬🇧 **English** | [`README_EN.md`](README_EN.md) |

---

## ✨ 功能特性

- **AI 助手客户端** — 基于 xCrab Gateway 的指令执行
- **浏览器自动化** — Playwright 驱动，可执行复杂网页操作
- **WebSocket 通信** — 与 eClaw Server 保持实时连接
- **后台服务运行** — 支持 systemd 服务配置

## 📋 环境要求

- Ubuntu 24.04 / 22.04
- Node.js v22+
- Playwright 浏览器依赖

## 🚀 安装部署

### 1️⃣ 安装 Node.js

```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 验证安装
node -v    # 应显示 v22.x.x
npm -v     # 应显示 10.x.x
```

### 2️⃣ 克隆仓库

```bash
git clone https://github.com/yzp100911/claw-client.git
cd claw-client/cclaw
```

### 3️⃣ 安装依赖

```bash
npm install
```

### 4️⃣ 安装 Playwright 浏览器

```bash
npx playwright install chromium
npx playwright install-deps
```

### 5️⃣ 配置

编辑 `index.js` 中的配置项，填入你的服务器地址和认证信息：

```javascript
const SERVER_URL = 'ws://your-server-ip:port';  // 改为你的 eclaw-server 地址
const AUTH_TOKEN = 'your-auth-token';           // 改为你的认证令牌
```

## ▶️ 运行

```bash
# 手动运行
./start.sh

# 或使用 systemd 服务（推荐）
sudo cp cclaw.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable cclaw
sudo systemctl start cclaw
```

## 🔧 服务管理

```bash
# 查看状态
sudo systemctl status cclaw

# 查看日志
journalctl -u cclaw -f

# 重启服务
sudo systemctl restart cclaw

# 停止服务
sudo systemctl stop cclaw
```

## 📁 项目结构

```
claw-client/
├── cclaw/
│   ├── index.js          # 主入口
│   ├── status-monitor.js # 状态监控
│   ├── start.sh          # 启动脚本
│   └── cclaw.service     # systemd 服务配置
├── openclaw/             # OpenClaw 组件（已独立开源）
└── LICENSE
```

## 📄 开源协议

本项目采用 [MIT](LICENSE) 开源协议。
