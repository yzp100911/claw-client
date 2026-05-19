# Claw Client

> 🤖 Claw Client — AI Assistant Client running on Ubuntu server, supporting Playwright browser automation

[![GPL-3.0 License](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)
[![Node.js v22+](https://img.shields.io/badge/Node.js-v22+-green.svg)](https://nodejs.org/)
[![Playwright](https://img.shields.io/badge/Playwright-Enabled-blue.svg)](https://playwright.dev/)
[![Stars](https://img.shields.io/github/stars/yzp100911/claw-client?style=social)](https://github.com/yzp100911/claw-client)
[![Forks](https://img.shields.io/github/forks/yzp100911/claw-client?style=social)](https://github.com/yzp100911/claw-client)

## Features

- **AI Assistant Client** — Command execution based on xCrab Gateway
- **Browser Automation** — Powered by Playwright, executing complex web operations
- **WebSocket Communication** — Maintains real-time connection with eClaw Server
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

Edit the configuration in `index.js` with your server address and authentication info.

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
│   └── cclaw.service     # systemd service configuration
├── openclaw/             # OpenClaw component (independently open-sourced)
└── LICENSE
```

## Related Projects

- [xCrab-Agent](https://github.com/yzp100911/xCrab-Agent) — Multi-model AI Gateway
- [eClaw Server](https://github.com/yzp100911/eclaw-server) — Web Server
- [Claw Client](https://github.com/yzp100911/claw-client) — Execution Client

## License

This project is licensed under [GPL-3.0](LICENSE).