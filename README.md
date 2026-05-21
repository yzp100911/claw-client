# claw-client 🤖

**claw-client (cclaw)** — 远程命令执行终端，连接到 eclaw-server 中转调度服务器，在目标服务器上执行 Shell 命令并返回结果。

通过 `node-pty` 在服务器上创建伪终端（Pseudo Terminal），支持实时命令执行、状态监控和 AI 对话辅助。

---

## 📦 系统架构关系

```
  网页端 (浏览器/手机)         eclaw-server               claw-client (本仓库)
  ┌──────────────┐        ┌──────────────────┐        ┌─────────────────────┐
  │  🌐 wclaw   │  HTTPS │  📡 中转调度服务器 │  WS  │  🤖 命令执行终端    │
  │  聊天界面    │◄──────►│  Express + WS    │◄─────►│  node-pty 伪终端    │
  │  发送命令    │         │  消息转发/路由    │       │  实时 Shell 执行    │
  └──────────────┘        └────────┬─────────┘       │  结果返回           │
                                   │ HTTP             └─────────────────────┘
                                   ▼
                          ┌──────────────────┐
                          │  🧠 xCrab-Agent  │
                          │  AI 对话引擎      │
                          └──────────────────┘
```

> - **claw-client** = 在目标服务器上执行命令的执行端 ← **本仓库**
> - **eclaw-server** = 中转调度服务器（claw-client 连接到它接收指令）
> - **xCrab-Agent** = 提供 AI 对话能力（可选）

---

## 🚀 部署指南（Windows / Linux）

### 📋 环境要求

| 环境 | 要求 | 说明 |
|------|------|------|
| **Node.js** | **v22.12 或更高** | ⚠️ 必须 22.12+，因为使用了最新的 node-pty API |
| **npm** | 随 Node.js 自带 | 无需额外安装 |
| **系统** | Windows 10+ / Ubuntu 20.04+ | 已测试 |

---

## 🪟 Windows 环境部署

### 1️⃣ 安装 Node.js

**方法一（推荐）：官网下载安装包**
- 访问 [https://nodejs.org](https://nodejs.org) 下载 **v22.x LTS** 版本
- 运行安装程序，勾选 "Add to PATH"
- 验证安装：

```bash
node -v    # 应显示 v22.x.x
npm -v     # 应显示 10.x.x
```

**方法二：使用 winget 安装**
```bash
winget install OpenJS.NodeJS.LTS
```

### 2️⃣ 安装 Git 与克隆仓库

```bash
# 安装 Git（https://git-scm.com/downloads/win）
git clone https://github.com/yzp100911/claw-client.git
cd claw-client
```

### 3️⃣ 安装依赖

```bash
npm install
```

> ⚠️ **Windows 构建注意**：`node-pty` 在 Windows 上需要 **Visual Studio Build Tools** 或 **Windows SDK**。
>
> 如果安装报错，尝试以下任一方案：
> - **方案A**：以管理员身份打开 PowerShell，执行 `npm install --global windows-build-tools`
> - **方案B**：安装 [Visual Studio 2022 Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)，勾选 "C++ 构建工具"
> - **方案C**：使用预编译版本（如果可用）：`npm install node-pty --force`

### 4️⃣ 配置连接（两种方式二选一）

#### ⭐ 方式 A（推荐）：使用 `.env` 文件

```bash
# 复制模板文件并重命名为 .env
copy .env.example .env

# 用记事本打开 .env 修改配置
notepad .env
```

将 `.env` 文件内容修改为你的实际配置：

```env
# 如果 eclaw-server 在同一台机器
ECLAW_API_URL=http://127.0.0.1:10090
ECLAW_WS_URL=ws://127.0.0.1:10090/ws

# 如果 eclaw-server 在远程服务器
# ECLAW_API_URL=http://你的服务器IP:10090
# ECLAW_WS_URL=ws://你的服务器IP:10090/ws
```

#### 方式 B：使用系统环境变量

**临时设置（当前会话有效）：**

```bash
set ECLAW_API_URL=http://127.0.0.1:10090
set ECLAW_WS_URL=ws://127.0.0.1:10090/ws
```

**永久设置（系统环境变量）：**
- 打开 **系统属性 → 高级 → 环境变量**
- 添加系统变量：
  - 变量名：`ECLAW_API_URL`，值：`http://127.0.0.1:10090`
  - 变量名：`ECLAW_WS_URL`，值：`ws://127.0.0.1:10090/ws`

### 5️⃣ 启动 claw-client

```bash
# 直接启动
node index.js

# 或使用启动脚本（Windows 用 Git Bash 运行）
# bash start.sh
```

看到以下输出即启动成功：
```
================================================
  cclaw 客户端启动成功
================================================
已连接到服务器 ws://127.0.0.1:10090/ws
等待指令...
```

---

## 🐧 Linux 环境部署（Ubuntu / CentOS）

### 1️⃣ 安装 Node.js

**Ubuntu/Debian：**

```bash
# 安装 Node.js 22.x
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 验证安装
node -v    # 应显示 v22.x.x
npm -v     # 应显示 10.x.x
```

**CentOS/RHEL：**

```bash
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo yum install -y nodejs
node -v
npm -v
```

### 2️⃣ 克隆仓库

```bash
sudo apt-get install -y git    # Ubuntu
# sudo yum install -y git      # CentOS

git clone https://github.com/yzp100911/claw-client.git
cd claw-client
```

### 3️⃣ 安装依赖

```bash
npm install
```

> 如果 `node-pty` 编译报错，安装构建工具：
> ```bash
> sudo apt-get install -y build-essential python3 make g++    # Ubuntu
> # sudo yum groupinstall -y "Development Tools"              # CentOS
> ```

### 4️⃣ 配置连接（两种方式二选一）

#### ⭐ 方式 A（推荐）：使用 `.env` 文件

```bash
# 复制模板文件并重命名为 .env
cp .env.example .env

# 编辑 .env 文件
nano .env
```

将 `.env` 文件内容修改为你的实际配置：

```env
# 如果 eclaw-server 在同一台机器
ECLAW_API_URL=http://127.0.0.1:10090
ECLAW_WS_URL=ws://127.0.0.1:10090/ws
```

#### 方式 B：使用环境变量

```bash
# 设置环境变量（临时）
export ECLAW_API_URL=http://127.0.0.1:10090
export ECLAW_WS_URL=ws://127.0.0.1:10090/ws

# 如果要持久化，添加到 ~/.bashrc
echo 'export ECLAW_API_URL=http://127.0.0.1:10090' >> ~/.bashrc
echo 'export ECLAW_WS_URL=ws://127.0.0.1:10090/ws' >> ~/.bashrc
source ~/.bashrc
```

> 📌 **连接远程服务器**：如果 eclaw-server 在远程服务器（如 `38.76.210.18`）：
> ```bash
> export ECLAW_API_URL=http://38.76.210.18:10090
> export ECLAW_WS_URL=ws://38.76.210.18:10090/ws
> ```

### 5️⃣ 启动 claw-client

```bash
# 方法一：直接启动
node index.js

# 方法二：使用启动脚本（推荐）
chmod +x start.sh
./start.sh
```

启动脚本会自动检查 Node.js 版本、安装依赖并启动。

### 6️⃣ ★ 设置开机自启（systemd 服务）

项目已自带 `cclaw.service` 文件，按以下步骤设置：

```bash
# 1. 修改服务文件中的路径为你的实际部署路径
sudo nano cclaw.service

# 修改 WorkingDirectory 和 ExecStart 中的路径
# 例如部署在 /home/user/claw-client：
# WorkingDirectory=/home/user/claw-client
# ExecStart=/usr/bin/node /home/user/claw-client/index.js

# 2. 复制到 systemd 目录
sudo cp cclaw.service /etc/systemd/system/

# 3. 如果需要连接远程 eclaw-server，添加环境变量
# 编辑服务文件添加：
# Environment=ECLAW_API_URL=http://你的服务器IP:10090
# Environment=ECLAW_WS_URL=ws://你的服务器IP:10090/ws
# 如果本地部署（127.0.0.1:10090），则无需修改

# 4. 重新加载并启用
sudo systemctl daemon-reload
sudo systemctl enable cclaw
sudo systemctl start cclaw

# 5. 查看状态
sudo systemctl status cclaw

# 6. 查看实时日志
sudo journalctl -u cclaw -f
```

---

## 🔗 连接流程示意

```
1. claw-client 启动
       │
2. 读取 ECLAW_WS_URL 配置（优先 .env 文件，其次环境变量）
       │
3. 连接 eclaw-server 的 WebSocket (ws://...:10090/ws)
       │
4. 连接成功，进入等待状态
       │
5. 收到来自网页端的命令
       │
6. 通过 node-pty 在本地 Shell 执行
       │
7. 实时返回执行结果到网页端
```

---

## ⚙️ 环境变量说明

| 变量 | 默认值 | 必填 | 说明 |
|------|--------|------|------|
| `ECLAW_API_URL` | `http://127.0.0.1:10090` | ✅ | eclaw-server HTTP API 地址 |
| `ECLAW_WS_URL` | `ws://127.0.0.1:10090/ws` | ✅ | eclaw-server WebSocket 地址 |
| `CCLAW_AI_BACKEND` | `xcrab` | ❌ | AI 后端选择（`xcrab` 推荐 / `hermes` 已废弃） |
| `XCRAB_GATEWAY_URL` | `http://localhost:3000` | ❌ | xCrab-Agent 网关地址 |
| `XCRAB_GATEWAY_TOKEN` | `100911yzpYZP@` | ❌ | xCrab-Agent 网关令牌 |
| `LOCAL_API_PORT` | `10091` | ❌ | 本地健康检查 API 端口 |
| `NODE_ENV` | `production` | ❌ | 运行环境 |

> 💡 **配置优先级**：`.env` 文件 > 系统环境变量 > 代码默认值

---

## 📁 项目结构

```
claw-client/
├── index.js              # 入口文件（主程序）
├── package.json          # 依赖配置
├── start.sh              # Ubuntu 启动脚本
├── cclaw.service         # Linux systemd 服务文件
├── .env.example          # ⭐ 环境变量模板（复制为 .env 后生效）
├── .gitignore            # Git 忽略规则
│
├── data/                 # 数据存储目录
├── projects/             # 项目文件目录
│
├── status-monitor.js     # 状态监控脚本
├── hello_loop.sh         # 心跳测试脚本
├── say_hello.sh          # 测试脚本
├── send_hello.py         # 发送测试
├── send_hello.sh         # 发送测试脚本
├── send_hello_cron.py    # 定时任务测试
├── send_hello_loop.py    # 循环发送测试
├── send_hello_loop.sh    # 循环发送测试脚本
├── send_ping.sh          # Ping 测试脚本
│
└── .playwright-cli/      # Playwright CLI 浏览器自动化配置
```

---

## 🔧 故障排除

| 问题 | 解决方案 |
|------|----------|
| **Node.js 版本过低** | cclaw 需要 **v22.12+**，升级 Node.js 到最新 LTS 版本 |
| **node-pty 编译失败** | 安装 `build-essential`（Linux）或 Visual Studio Build Tools（Windows） |
| **连接 eclaw-server 失败** | 检查 `ECLAW_WS_URL` 配置是否正确，确认 eclaw-server 已启动且防火墙放行端口 |
| **WebSocket 连接断开** | 检查网络连通性，确认服务器间防火墙允许 WebSocket 连接 |
| **执行命令无响应** | 检查 node-pty 是否正常工作，尝试在本地 `node -e "console.log('test')"` |

---

## 📝 许可证

MIT
