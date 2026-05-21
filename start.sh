#!/bin/bash
# cclaw 客户端 - Ubuntu 启动脚本
# 使用方法: chmod +x start.sh && ./start.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "================================================"
echo "  cclaw 客户端 - Ubuntu 启动脚本"
echo "================================================"

# 检测 Node.js
if ! command -v node &> /dev/null; then
    echo "[错误] 未找到 node，请先安装 Node.js 22.12+"
    echo "  安装方法:"
    echo "    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
    echo "    sudo apt-get install -y nodejs"
    exit 1
fi

NODE_VER=$(node -v)
echo "Node.js 版本: $NODE_VER"

# 检查 Node.js 版本 >= 22.12
NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
NODE_MINOR=$(node -e "console.log(process.versions.node.split('.')[1])")
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 12 ]; }; then
    echo "[错误] Node.js 版本过低，需要 >= 22.12 (当前: $(node -v))"
    echo "  请升级 Node.js:"
    echo "    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
    echo "    sudo apt-get install -y nodejs"
    exit 1
fi

# 检测 npm
if ! command -v npm &> /dev/null; then
    echo "[错误] 未找到 npm"
    exit 1
fi

# OC(废弃)：openclaw 已不再使用，pnpm 检测保留供参考
# 检测 pnpm（openclaw 需要）
# if command -v pnpm &> /dev/null; then
#     echo "pnpm 已安装: $(pnpm -v)"
# else
#     echo "[提示] 未安装 pnpm，将使用 npm 安装 cclaw 依赖"
# fi

# 安装 cclaw 依赖
if [ ! -d "node_modules" ]; then
    echo "正在安装 cclaw 依赖..."
    npm install
    echo "依赖安装完成"
fi

# OC(废弃)：openclaw dist 检查已废弃，保留供参考
# 检查 openclaw dist 是否就绪
# if [ ! -f "../openclaw/dist/index.js" ]; then
#     echo "[警告] openclaw/dist/index.js 不存在"
#     echo "  请确保 openclaw 已构建完成"
#     echo "  进入 ../openclaw 目录执行: pnpm install && pnpm build"
# fi

echo ""
echo "正在启动 cclaw 客户端..."
echo "服务端地址: http://127.0.0.1:10090 (同机部署)"
echo "如需连接远程服务器，请设置环境变量:"
echo "  export ECLAW_API_URL=http://xunrf.cn:10090"
echo "  export ECLAW_WS_URL=ws://xunrf.cn:10090/ws"
echo "================================================"

# 启动 cclaw
exec node index.js
