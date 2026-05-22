# Claw Client

> 🤖 Claw Client — AI assistant client running on Ubuntu servers, with Playwright browser automation support

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js v22+](https://img.shields.io/badge/Node.js-v22+-green.svg)](https://nodejs.org/)
[![Playwright](https://img.shields.io/badge/Playwright-Enabled-blue.svg)](https://playwright.dev/)

## 🏗️ System Architecture

```
🌐 Web UI → 📡 eclaw-server (Relay & Dispatch) → 🤖 claw-client (Terminal Execution)
                                                    ↓
                                              🧠 xCrab-Agent (AI Brain)
```

claw-client is the **terminal execution client** among the three, responsible for:
- Receiving commands forwarded by eclaw-server
- Executing commands on the target server using node-pty
- Maintaining WebSocket connection with eclaw-server
- Supporting Playwright browser automation

| Project | Role | Repository |
|---------|------|------------|
| 🧠 xCrab-Agent | AI Brain (dialogue engine + tool calling) | [xCrab-Agent](https://github.com/yzp100911/xCrab-Agent) |
| 📡 eclaw-server | Relay & Dispatch Server | [eclaw-server](https://github.com/yzp100911/eclaw-server) |
| 🤖 claw-client | Terminal Executor (this project) | Right here! |

---

## Features

- **AI Assistant Client** — Executes instructions based on xCrab Gateway
- **Browser Automation** — Playwright-driven, capable of complex web page operations
- **WebSocket Communication** — Real-time connection with eClaw Server
- **Background Service** — Supports systemd service configuration

## Requirements

- Ubuntu 24.04
- Node.js v22+
- Playwright browser dependencies

## Installation

```bash
git clone https://github.com/yzp100911/claw-client.git
cd claw-client/cclaw
npm install
```

## Configuration

Edit the configuration in `index.js`, fill in your server address and authentication info.

## Running

```bash
# Manual run
./start.sh

# Or use systemd service
sudo cp cclaw.service /etc/systemd/system/
sudo systemctl enable cclaw
sudo systemctl start cclaw
```

## Service Management

```bash
# Check status
sudo systemctl status cclaw

# View logs
journalctl -u cclaw -f

# Restart service
sudo systemctl restart cclaw
```

## Project Structure

```
claw-client/
├── cclaw/
│   ├── index.js          # Main entry point
│   ├── status-monitor.js # Status monitoring
│   ├── start.sh          # Startup script
│   └── cclaw.service     # systemd service config
├── openclaw/             # OpenClaw components (independently open-sourced)
└── LICENSE
```

## License

MIT
