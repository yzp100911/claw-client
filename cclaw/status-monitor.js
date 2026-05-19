/**
 * status-monitor.js — cclaw 执行状态监控脚本
 *
 * 作用：
 *   1. 轮询 cclaw 本地的 /api/status 端口，检测 OpenClaw 是否正在执行任务
 *   2. 将执行状态推送到云端，供网页端 (wclaw) 实时获取
 *   3. 提供本地 HTTP 端点供其他工具查询
 *
 * 由 cclaw/index.js 自动启动，也可独立运行：
 *   node status-monitor.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// ==================== 配置 ====================
const CCLAW_STATUS_HOST = '127.0.0.1';
const CCLAW_STATUS_PORT = 10091;
const CCLAW_STATUS_PATH = '/api/status';
const CLOUD_API_URL = process.env.CLOUD_API_URL || 'http://127.0.0.1:10090';
const MONITOR_PORT = 10092;
const POLL_INTERVAL_MS = 2000;

// 从环境变量获取数据目录（由 cclaw/index.js 传入），否则回退到脚本所在目录
const DATA_DIR = process.env.CCLAW_DATA_DIR || __dirname;
const TOKEN_FILE = path.join(DATA_DIR, 'data', '.cclaw_token');

// ==================== 状态管理 ====================
let currentState = {
    executing: false,
    sessionCount: 0,
    sessions: [],
    lastSeen: Date.now(),
    lastChanged: Date.now()
};

// 状态变更回调列表
const stateChangeCallbacks = [];

function onStateChange(callback) {
    stateChangeCallbacks.push(callback);
}

// ==================== 工具函数 ====================

/** 读取 cclaw token */
function readToken() {
    try {
        if (fs.existsSync(TOKEN_FILE)) {
            return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
        }
    } catch (e) {
        console.error(`[监控] 读取 token 失败: ${e.message}`);
    }
    return null;
}

/** 使用 http 模块发起 GET 请求 */
function httpGet(url, timeoutMs) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, { timeout: timeoutMs }, (res) => {
            let body = '';
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => {
                resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body });
            });
        });
        req.on('error', (err) => reject(err));
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
}

/** 使用 http 模块发起 POST 请求 */
function httpPost(url, data, token, timeoutMs) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const body = JSON.stringify(data);
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || 80,
            path: urlObj.pathname,
            method: 'POST',
            timeout: timeoutMs,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };
        if (token) {
            options.headers['Authorization'] = 'Bearer ' + token;
        }
        const req = http.request(options, (res) => {
            let responseBody = '';
            res.on('data', chunk => { responseBody += chunk; });
            res.on('end', () => {
                resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: responseBody });
            });
        });
        req.on('error', (err) => reject(err));
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.write(body);
        req.end();
    });
}

/** 解析云 URL 的 hostname 和 port */
function parseHost(url) {
    const u = new URL(url);
    return { hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80) };
}

// ==================== 轮询 cclaw 状态 ====================
async function pollCclawStatus() {
    try {
        const res = await httpGet(`http://${CCLAW_STATUS_HOST}:${CCLAW_STATUS_PORT}${CCLAW_STATUS_PATH}`, 3000);
        if (res.ok) {
            try {
                const body = JSON.parse(res.body);
                if (body.code === 200) {
                    const data = body.data;
                    const oldExecuting = currentState.executing;

                    currentState.executing = data.executing;
                    currentState.sessionCount = data.sessionCount;
                    currentState.sessions = data.sessions || [];
                    currentState.lastSeen = Date.now();

                    if (data.executing !== oldExecuting) {
                        currentState.lastChanged = Date.now();
                        const direction = data.executing ? '开始执行' : '执行结束';
                        console.log(`[状态变更] ${direction} (会话: ${data.sessions.map(s => s.sessionId).join(', ') || '无'})`);
                        // 触发状态变更回调
                        for (const cb of stateChangeCallbacks) {
                            try { cb(oldExecuting, data.executing); } catch (e) {}
                        }
                    }
                }
            } catch (e) {
                console.error(`[监控] 解析 cclaw 状态失败: ${e.message}`);
            }
        }
    } catch (e) {
        // cclaw 可能还没启动，标记为空闲
        if (currentState.executing !== false) {
            console.log('[状态变更] cclaw 连接断开，标记为空闲');
            const oldVal = currentState.executing;
            currentState.executing = false;
            currentState.sessionCount = 0;
            currentState.sessions = [];
            currentState.lastChanged = Date.now();
            for (const cb of stateChangeCallbacks) {
                try { cb(oldVal, false); } catch (e) {}
            }
        }
    }
}

// ==================== 推送到云端（经由 cclaw 本地 WebSocket 转发） ====================
async function pushStatusToCloud() {
    try {
        const res = await httpPost(
            `http://${CCLAW_STATUS_HOST}:${CCLAW_STATUS_PORT}/api/forward_status`,
            {
                executing: currentState.executing,
                sessionCount: currentState.sessionCount,
                sessions: currentState.sessions,
                lastChanged: currentState.lastChanged,
                lastSeen: currentState.lastSeen,
                timestamp: Date.now()
            },
            null, // 本地 API 不需要 token
            3000
        );

        if (res.ok) {
            // console.log(`[监控推送] 状态已同步: ${currentState.executing ? '执行中' : '空闲'}`);
        } else {
            console.error(`[监控推送] 本地转发失败 (HTTP ${res.status}): ${res.body.substring(0, 200)}`);
        }
    } catch (e) {
        console.error(`[监控推送] 本地转发错误: ${e.message}`);
    }
}

// ==================== 本地 HTTP 服务 ====================
const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.method === 'GET') {
        if (req.url === '/api/cclaw_status') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                code: 200,
                data: {
                    executing: currentState.executing,
                    sessionCount: currentState.sessionCount,
                    sessions: currentState.sessions,
                    lastSeen: currentState.lastSeen,
                    lastChanged: currentState.lastChanged
                }
            }));
        } else if (req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code: 200, status: 'running' }));
        } else {
            res.writeHead(404);
            res.end(JSON.stringify({ code: 404, message: 'Not Found' }));
        }
    } else {
        res.writeHead(405);
        res.end(JSON.stringify({ code: 405, message: 'Method Not Allowed' }));
    }
});

// ==================== 启动 ====================
server.listen(MONITOR_PORT, '127.0.0.1', () => {
    console.log(`============================================`);
    console.log(`  cclaw 状态监控脚本已启动`);
    console.log(`  数据目录: ${DATA_DIR}`);
    console.log(`  Token 文件: ${TOKEN_FILE}`);
    console.log(`  本地状态端点: http://127.0.0.1:${MONITOR_PORT}/api/cclaw_status`);
    console.log(`  云端推送: ${CLOUD_API_URL}/api/cclaw_exec_status`);
    console.log(`============================================`);
});

// 状态变更 → 立即推送到云端
onStateChange((prev, curr) => {
    console.log(`[监控] 状态变化: ${prev ? '执行中' : '空闲'} → ${curr ? '执行中' : '空闲'}`);
    pushStatusToCloud();
});

// 定期轮询 cclaw
setInterval(pollCclawStatus, POLL_INTERVAL_MS);

// 立即执行一次轮询
pollCclawStatus();

// 定期推送当前状态到云端（每 30 秒同步一次，应对网络波动）
setInterval(pushStatusToCloud, 30000);

// 进程退出清理
process.on('SIGINT', () => {
    console.log('\n[监控脚本] 正在停止...');
    server.close();
    process.exit(0);
});
process.on('SIGTERM', () => {
    server.close();
    process.exit(0);
});
