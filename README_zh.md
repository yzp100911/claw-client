# Claw Client

> 🤖 Claw Client 执行端 — 运行在 Ubuntu 服务器上的 AI 助手客户端，支持 Playwright 浏览器自动化

[![GPL-3.0 License](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)
[![Node.js v22+](https://img.shields.io/badge/Node.js-v22+-green.svg)](https://nodejs.org/)
[![Playwright](https://img.shields.io/badge/Playwright-Enabled-blue.svg)](https://playwright.dev/)

## 功能特性

- **AI 助手客户端** — 基于 xCrab Gateway 的指令执行
- **浏览器自动化** — Playwright 驱动，可执行复杂网页操作
- **WebSocket 通信** — 与 eClaw Server 保持实时连接
- **后台服务运行** — 支持 systemd 服务配置

## 环境要求

- Ubuntu 24.04
- Node.js v22+
- Playwright 浏览器依赖

## 安装

```bash
git clone https://github.com/yzp100911/claw-client.git
cd claw-client/cclaw
npm install
```

## 配置

编辑 `index.js` 中的配置，填入你的服务器地址和认证信息。

## 运行

```bash
# 手动运行
./start.sh

# 或使用 systemd 服务
sudo cp cclaw.service /etc/systemd/system/
sudo systemctl enable cclaw
sudo systemctl start cclaw
```

## 服务管理

```bash
# 查看状态
sudo systemctl status cclaw

# 查看日志
journalctl -u cclaw -f

# 重启服务
sudo systemctl restart cclaw
```

## 项目结构

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

## 开源协议

本项目采用 [GPL-3.0](LICENSE) 开源协议。