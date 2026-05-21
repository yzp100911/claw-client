const WebSocket = require('ws');
const axios = require('axios');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const http = require('http');
const FormData = require('form-data');
const pty = require('node-pty');

// 云端中间件地址（与 server.js 部署在同一台服务器，默认走本地回环）
const ECLAW_API_URL = process.env.ECLAW_API_URL || 'http://127.0.0.1:10090';
const ECLAW_WS_URL = process.env.ECLAW_WS_URL || 'ws://127.0.0.1:10090/ws';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

console.log('===================================================');
console.log('  cclaw 客户端 - 连接云端 eclaw 中间件');
console.log('===================================================');

let wss;
let currentChild = null;
let currentToken = null;
let authFailed = false; // 标记认证失败，防止重复尝试旧 token
let currentSessionId = null; // 保存当前执行的 sessionId

// 多会话管理 - 使用 Map 存储每个会话的执行状态
const sessionChildren = new Map();

// 尝试从本地文件加载 token，实现重启免登录
// 使用 __dirname（脚本所在目录），避免被 process.cwd() 影响
const TOKEN_FILE = path.join(__dirname, 'data', '.cclaw_token');

function saveToken(token) {
    try {
        const dataDir = path.join(__dirname, 'data');
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(TOKEN_FILE, token, 'utf8');
    } catch(e) {
        console.error('保存凭据失败:', e.message);
    }
}

function loadToken() {
    try {
        if (fs.existsSync(TOKEN_FILE)) {
            return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
        }
    } catch(e) {
        return null;
    }
    return null;
}

function startClient() {
    // 如果认证失败过，就不要再用旧 token 了，直接让用户重新登录
    if (authFailed) {
        console.log('凭据已失效，请重新登录。\n');
        authFailed = false; // 重置标记
    } else {
        const savedToken = loadToken();
        if (savedToken) {
            console.log('检测到本地保存的登录凭据，尝试自动恢复连接...');
            currentToken = savedToken;
            connectWebSocket(savedToken);
            return;
        }
    }

    rl.question('请输入账号：', (username) => {
        rl.question('请输入密码: ', (password) => {
            if (username === 'yzp1009' || username === 'ad1009') {
                // 免验证码登录（信任账号可直接登录）
                loginAndConnect(username, password, '', '');
                return;
            }
            
            rl.question('请输入绑定的手机号: ', (phone) => {
                if (!username || !password || !phone) {
                    console.log('输入不能为空，请重新输入');
                    return startClient();
                }
                sendSmsAndLogin(username, password, phone);
            });
        });
    });
}

async function sendSmsAndLogin(username, password, phone) {
    try {
        console.log(`\n正在向 ${phone} 发送短信验证码...`);
        const res = await axios.post(`${ECLAW_API_URL}/api/send_sms`, { phone });
        
        if (res.data.code === 200) {
            console.log('✅ 验证码发送成功！(如果没有真实配置短信宝，请查看 eclaw 服务端控制台打印的验证码)');
            rl.question('请输入收到的短信验证码: ', (sms_code) => {
                if (!sms_code) {
                    console.log('验证码不能为空');
                    return startClient();
                }
                loginAndConnect(username, password, phone, sms_code);
            });
        } else {
            console.log('❌ 验证码发送失败:', res.data.message);
            startClient();
        }
    } catch (err) {
        console.error('❌ 网络错误，无法连接到云端:', err.message);
        setTimeout(() => startClient(), 2000);
    }
}

async function loginAndConnect(username, password, phone, sms_code) {
    try {
        console.log(`\n正在登录云端 ${ECLAW_API_URL}...`);
        const res = await axios.post(`${ECLAW_API_URL}/api/login`, { 
            username, password, phone, sms_code 
        });
        
        if (res.data.code === 200) {
            const token = res.data.data.token;
            console.log('✅ 登录成功！准备建立长连接...');
            authFailed = false; // 登录成功，重置失败标记
            saveToken(token); // 登录成功后保存 token
            currentToken = token;
            connectWebSocket(token);
        } else {
            console.log('❌ 登录失败:', res.data.message);
            startClient();
        }
    } catch (err) {
        if (err.response && err.response.data) {
            console.error('❌ 登录失败:', err.response.data.message);
        } else {
            console.error('❌ 网络错误，无法连接到云端:', err.message);
        }
        setTimeout(() => startClient(), 2000);
    }
}

/**
 * 安全的 ws.send 包装：检查连接状态，捕获发送异常
 */
function wsSafeSend(ws, data) {
    try {
        if (ws && ws.readyState === WebSocket.OPEN && !authFailed) {
            ws.send(data);
            return true;
        }
    } catch (e) {
        console.error('[ws] 发送失败:', e.message);
    }
    return false;
}

function connectWebSocket(token) {
    const ws = new WebSocket(ECLAW_WS_URL);
    wss = ws; // 保存到全局引用，供本地 HTTP 服务转发消息使用

    let pongReceived = true;        // 标记上次 ping 是否收到 pong
    let pingTimeoutTimer = null;    // ping 超时定时器

    ws.on('open', () => {
        console.log('已连接到云端服务器！正在验证身份...');
        pongReceived = true; // 重置心跳状态
        wsSafeSend(ws, JSON.stringify({ type: 'auth', data: { token } }));
    });

    // 心跳：每 20 秒检测一次连接活性
    const heartbeatTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN && !authFailed) {
            if (!pongReceived) {
                // 上次 ping 没有收到 pong，连接已失效，主动断开触发重连
                console.warn('[心跳] 未收到 pong 响应，判定连接已失效，触发重连');
                ws.terminate(); // 立即终止 TCP 连接
                return;
            }
            pongReceived = false;
            try {
                ws.ping();
            } catch (e) {
                console.warn('[心跳] ping 发送失败:', e.message);
                ws.terminate();
                return;
            }
            // 设置 pong 超时检测：10 秒内没收到 pong 就断开
            if (pingTimeoutTimer) clearTimeout(pingTimeoutTimer);
            pingTimeoutTimer = setTimeout(() => {
                if (!pongReceived && ws.readyState === WebSocket.OPEN) {
                    console.warn('[心跳] pong 超时(10s)，强制断开');
                    ws.terminate();
                }
            }, 10000);
        }
    }, 20000); // 每 20 秒检测一次

    ws.on('pong', () => {
        pongReceived = true;
        if (pingTimeoutTimer) {
            clearTimeout(pingTimeoutTimer);
            pingTimeoutTimer = null;
        }
    });

    ws.on('message', (message) => {
        try {
            const msg = JSON.parse(message);
            if (msg.type === 'auth_success') {
                console.log('>>> 身份验证成功，等待手机端 (wclaw) 发送指令 <<<');
                // 登录成功后启动状态监控脚本，避免启动日志与登录提示混在一起
                autoStartMonitor();
            } else if (msg.type === 'error' && msg.message === '认证失败') {
                console.error('云端拒绝了连接 (凭据可能已过期)');
                // 凭据无效时，清除本地缓存并重新提示输入
                try {
                    if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
                } catch(e) {}
                authFailed = true; // 设置标记，防止再次尝试旧 token
                // 立即关闭 WebSocket 连接，防止 close 事件触发重连
                clearInterval(heartbeatTimer); // 清除心跳定时器
                ws.removeAllListeners('close');
                ws.close();
                startClient();
            } else if (msg.type === 'command') {
                const command = msg.data;
                const sessionId = msg.sessionId;
                const backend = msg.backend || process.env.CCLAW_AI_BACKEND || 'xcrab';
                const username = msg.username || 'unknown';
                console.log(`\n[收到指令]: ${command} (Session: ${sessionId || 'none'}, Backend: ${backend}, 用户: ${username})`);
                if (backend === 'hermes') {
                    // Hermes(废弃)：直接返回提示，不执行
                    // executeHermesCommand(command, ws, sessionId, username);
                    wsSafeSend(ws, JSON.stringify({ type: 'stream', sessionId, data: { source: 'stdout', text: '⚠️ HM(废弃)：Hermes 已不再维护，请切换到 xCrab 使用。', _sessionId: sessionId || 'default' } }));
                    wsSafeSend(ws, JSON.stringify({ type: 'done', sessionId, data: { _sessionId: sessionId || 'default' } }));
                } else if (backend === 'xcrab') {
                    executeXcrabCommand(command, ws, sessionId, username);
                } else {
                    // OpenClaw(废弃)：直接返回提示，不执行
                    // executeOpenClawCommand(command, ws, sessionId, username);
                    wsSafeSend(ws, JSON.stringify({ type: 'stream', sessionId, data: { source: 'stdout', text: '⚠️ OC(废弃)：OpenClaw 已不再维护，请切换到 xCrab 使用。', _sessionId: sessionId || 'default' } }));
                    wsSafeSend(ws, JSON.stringify({ type: 'done', sessionId, data: { _sessionId: sessionId || 'default' } }));
                }
            } else if (msg.type === 'new_session') {
                const { sessionId, title } = msg;
                console.log(`\n[新会话通知]: sessionId=${sessionId}, title=${title || '新对话'}`);
                // 回复确认，告知服务端 cclaw 已收到新会话通知
                wsSafeSend(ws, JSON.stringify({
                    type: 'new_session_ack',
                    sessionId,
                    message: `会话已就绪`
                }));
            } else if (msg.type === 'stop') {
                console.log(`\n[收到停止指令]`);
                // 停止所有会话的任务
                const sessionIds = Array.from(sessionChildren.keys());
                if (sessionIds.length > 0) {
                    console.log(`正在停止 ${sessionIds.length} 个会话的任务...`);
                    try {
                        if (process.platform === 'win32') {
                            // 暴力兜底：强制清理所有可能残留的浏览器进程
                            const browsers = ['chrome.exe', 'chromium.exe', 'msedge.exe'];
                            for (const browser of browsers) {
                                try {
                                    require('child_process').execSync(`taskkill /im ${browser} /f`, { stdio: 'ignore' });
                                } catch(e) { /* 忽略没找到的错误 */ }
                            }
                            // 清理会话状态
                            sessionChildren.clear();
                            // 主动触发重启流程：退出码为 99 将被 start.bat 识别为需要重启
                            console.log('正在完全重启 cclaw 以彻底切断执行...');
                            process.exit(99);
                        } else {
                            for (const [sid, state] of sessionChildren) {
                                state.child.kill('SIGKILL');
                            }
                            sessionChildren.clear();
                        }
                    } catch (e) {
                        console.error('停止任务失败:', e.message);
                    }
                } else {
                    console.log('没有正在执行的任务');
                }
            } else if (msg.type === 'error') {
                console.error('云端错误:', msg.message);
            }
        } catch (e) {
            console.error('消息解析失败', e);
        }
    });

    ws.on('close', () => {
        // 清除心跳定时器
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
        }
        
        // 如果是认证失败导致的关闭，就不要重连了
        if (authFailed) {
            console.log('\n[系统] 认证失败，不再尝试重连\n');
            return;
        }
        
        console.log('\n===================================================');
        console.log('❌ 警告：与云端服务器断开连接，正在尝试重连...');
        console.log('===================================================\n');
        setTimeout(() => {
            if (!authFailed) {
                connectWebSocket(token);
            }
        }, 5000);
    });

    ws.on('error', (err) => {
        console.error('WebSocket 发生错误:', err.message);
        // error 后通常会自动触发 close，但主动清理避免不可靠
        if (pingTimeoutTimer) clearTimeout(pingTimeoutTimer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        // 如果还没有 close，主动关闭让 close 事件里的重连逻辑生效
        try { ws.close(); } catch(e) {}
    });
}

function executeOpenClawCommand(command, ws, sessionId, username) {
    console.log(`正在调度本地 OpenClaw 执行... (会话: ${sessionId || 'default'}, 用户: ${username || 'unknown'})`);

    const activeSessionId = sessionId || 'default';

    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    // ======== OC(废弃)：以下为 OpenClaw 执行逻辑，保留供参考 ========
    /*  // 【注释开始】OpenClaw(废弃)
    const execCliPath = path.join(__dirname, '..', 'openclaw', 'dist', 'index.js');
    const execNodeExe = process.platform === 'win32'
        ? path.join(__dirname, '..', 'nodejs', 'node.exe')
        : 'node';

    const customEnv = { ...process.env };
    customEnv['CI'] = 'true';
    customEnv['FORCE_COLOR'] = '0';
    customEnv['OPENCLAW_LOG_LEVEL'] = 'error';
    customEnv['OPENCLAW_STATE_DIR'] = dataDir;
    customEnv['OPENCLAW_CONFIG_PATH'] = path.join(dataDir, 'openclaw.json');
    customEnv['OPENCLAW_AGENT_DIR'] = dataDir;

    const configPath = path.join(dataDir, 'openclaw.json');
    try {
        if (fs.existsSync(configPath)) {
            let content = fs.readFileSync(configPath, 'utf8');
            if (content.charCodeAt(0) === 0xFEFF) {
                content = content.slice(1);
            }
            let config = JSON.parse(content);
            let modified = false;

            if (config.gateway) {
                if (config.gateway.auth && config.gateway.auth.token) {
                    delete config.gateway.auth.token;
                    modified = true;
                }
                if (config.gateway.remote && config.gateway.remote.token) {
                    delete config.gateway.remote.token;
                    modified = true;
                }
            }

            if (config.env) {
                for (const [key, value] of Object.entries(config.env)) {
                    customEnv[key] = value;
                    if (key.endsWith('_API_KEY') || key.endsWith('_OAUTH_TOKEN')) {
                        let provider = key.replace('_API_KEY', '').replace('_OAUTH_TOKEN', '').toLowerCase().replace('_', '-');
                        if (provider === 'minimax') {
                            customEnv['OPENCLAW_API_KEY_minimax'] = value;
                            customEnv['OPENCLAW_API_KEY_minimax-portal'] = value;
                            if (config.models && config.models.providers) {
                                if (config.models.providers['minimax']) {
                                    config.models.providers['minimax'].apiKey = value;
                                    modified = true;
                                }
                                if (config.models.providers['minimax-portal']) {
                                    config.models.providers['minimax-portal'].apiKey = value;
                                    modified = true;
                                }
                            }
                        } else {
                            customEnv[`OPENCLAW_API_KEY_${provider}`] = value;
                            if (config.models && config.models.providers) {
                                if (!config.models.providers[provider]) {
                                    config.models.providers[provider] = { models: [] };
                                    if (provider === 'openrouter') {
                                        config.models.providers[provider].baseUrl = "https://openrouter.ai/api/v1";
                                    } else if (provider === 'openai') {
                                        config.models.providers[provider].baseUrl = "https://api.openai.com/v1";
                                    } else if (provider === 'anthropic') {
                                        config.models.providers[provider].baseUrl = "https://api.anthropic.com";
                                    }
                                }
                                config.models.providers[provider].apiKey = value;
                                modified = true;
                            }
                        }
                    }
                }
            }

            if (modified) {
                fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
            }
        }
    } catch(e) {
        console.error("清理/更新 openclaw.json 失败:", e);
    }

    const dynamicSessionId = sessionId || `cclaw-web-${Date.now()}`;

    let finalCommand = command;
    finalCommand += "\n\n[System Instruction: If the user asks you to send or provide a local file, do not say you cannot. Instead, you MUST output the exact tag `[SEND_FILE: <absolute_path>]` in your response (e.g., [SEND_FILE: /path/to/file.txt]). The system will intercept this tag and automatically transfer the file to the user.]";
    finalCommand += `\n\n[System Instruction: When a sub-agent or any child process produces a status update, progress report, or result, you MUST output the exact tag format below in your response for each update:\n\`[SUBAGENT_MSG]{"agentId":"<agent-name>","message":"<update-content>","type":"info|result|error|progress"}[/SUBAGENT_MSG]\`\nThe system will intercept this tag and send the structured message to the user's mobile client in real-time. Each sub-agent update should use a separate tag. Example: \\[SUBAGENT_MSG]{"agentId":"代码审查员","message":"已完成代码审查，发现3个问题","type":"result"}[/SUBAGENT_MSG]]`;
    finalCommand += `\n\n[System Instruction: Web端定时任务投递规则] 当用户通过网页端(web端)要求你创建定时/重复任务来发送消息时，你必须遵守以下规则，否则消息会错误地发送到微信插件而不是网页端。\n规则1：cron job 必须使用 delivery.mode = "webhook"，让 cron 系统直接通过 HTTP POST 把消息投递回网页端，不需要启动 AI 子会话。\n规则2：delivery.to 必须设为 "http://xunrf.cn:10090/api/cron_deliver?username=${username || 'unknown'}"，把用户名作为查询参数传递。\n规则3：不要在 cron job 中设置 payload.kind，不要使用 agentTurn 或 userTurn，否则会触发 AI 子会话导致并发限制。\n规则4：把要发送的消息内容放在 summary 字段中。\n重要：不要设置 delivery.mode = "announce" 或 "none"，不要设置 delivery.channel，不要设置 payload。]`;

    const spawnArgs = [
        execCliPath,
        "agent",
        "--local",
        "--message", finalCommand,
        "--session-id", dynamicSessionId
    ];

    customEnv['CCLAW_SUBAGENT_API'] = `http://127.0.0.1:${LOCAL_API_PORT}/api/subagent_message`;
    customEnv['CCLAW_CURRENT_SESSION_ID'] = dynamicSessionId;
    customEnv['CCLAW_USERNAME'] = username || 'unknown';
    if (customEnv['MINIMAX_API_KEY'] && !customEnv['ANTHROPIC_API_KEY']) {
        customEnv['ANTHROPIC_API_KEY'] = customEnv['MINIMAX_API_KEY'];
    }

    const child = pty.spawn(execNodeExe, spawnArgs, {
        env: customEnv,
        cwd: __dirname,
    });

    const sessionState = {
        child: child,
        stdoutData: '',
        stderrData: '',
        subagentBuf: ''
    };
    sessionChildren.set(activeSessionId, sessionState);

    child.on('data', (chunk) => {
        const text = chunk.toString();
        sessionState.stdoutData += text;
        sessionState.subagentBuf += text;

        if (sessionState.subagentBuf.length > 10000) {
            wsSafeSend(ws, JSON.stringify({
                type: 'stream',
                sessionId: activeSessionId,
                data: { source: 'stdout', text: sessionState.subagentBuf, _sessionId: activeSessionId }
            }));
            sessionState.subagentBuf = '';
            return;
        }

        const subagentRegex = /\[SUBAGENT_MSG\](\{.*?\})\[\/SUBAGENT_MSG\]/g;
        let cleanedBuf = sessionState.subagentBuf;
        let match;
        let hasSubagentMsg = false;

        while ((match = subagentRegex.exec(sessionState.subagentBuf)) !== null) {
            hasSubagentMsg = true;
            try {
                const msgData = JSON.parse(match[1]);
                console.log(`[subagent pty] 子Agent消息: agentId=${msgData.agentId || 'unknown'}, type=${msgData.type || 'info'}`);
                wsSafeSend(ws, JSON.stringify({
                    type: 'subagent_message',
                    sessionId: activeSessionId,
                    data: {
                        agentId: msgData.agentId || 'unknown',
                        message: msgData.message || '',
                        type: msgData.type || 'info'
                    }
                }));
            } catch (e) {
                console.log(`[subagent pty] 解析失败(标签仍会从 stream 中移除): ${e.message}`);
            }
        }

        if (hasSubagentMsg) {
            cleanedBuf = sessionState.subagentBuf.replace(subagentRegex, '');
        }

        // 检查末尾是否有未闭合标签，保留以待下一个 chunk
        const lastOpenTag = cleanedBuf.lastIndexOf('[SUBAGENT_MSG]');
        const lastCloseTag = cleanedBuf.lastIndexOf('[/SUBAGENT_MSG]');
        if (lastOpenTag > lastCloseTag) {
            sessionState.subagentBuf = cleanedBuf.substring(lastOpenTag);
            cleanedBuf = cleanedBuf.substring(0, lastOpenTag);
        } else if (hasSubagentMsg) {
            sessionState.subagentBuf = '';
        } else {
            sessionState.subagentBuf = '';
        }

        // 过滤掉 OpenClaw 内部诊断日志（PTY 合并了 stdout/stderr，导致 diag 日志泄漏到流中）
        if (cleanedBuf) {
            cleanedBuf = cleanedBuf.split('\n').filter(line => {
                return !/\[\w+\]\s*lane task error/.test(line) &&
                       !/\[\w+\]\s*webhook/.test(line) &&
                       !/\[diagnostic\]/.test(line) &&
                       !/\[system\]/.test(line);
            }).join('\n');
        }

        if (cleanedBuf && cleanedBuf.trim()) {
            wsSafeSend(ws, JSON.stringify({
                type: 'stream',
                sessionId: activeSessionId,
                data: { source: 'stdout', text: cleanedBuf, _sessionId: activeSessionId }
                        }));
        }
    });

    child.on('exit', async (code) => {
        console.log(`[会话 ${activeSessionId} 执行完成] Exit code: ${code}`);

        const completedState = sessionChildren.get(activeSessionId);
        sessionChildren.delete(activeSessionId);
        if (!completedState) {
            console.error(`会话 ${activeSessionId} 状态已丢失`);
            return;
        }

        const stdoutData = completedState.stdoutData;
        const stderrData = completedState.stderrData;

                if (stdoutData) console.log('输出:', stdoutData.substring(0, 500) + '...');
        if (stderrData) console.error('错误:', stderrData.substring(0, 500) + '...');

        const fileMatch = stdoutData.match(/\[SEND_FILE:\s*(.+?)\]/);
        if (fileMatch) {
            const filePath = fileMatch[1].trim();
            console.log(`检测到文件发送请求: ${filePath}`);
            try {
                if (fs.existsSync(filePath)) {
                    const form = new FormData();
                    form.append('file', fs.createReadStream(filePath), { filename: path.basename(filePath) });
                    const res = await axios.post(`${ECLAW_API_URL}/api/cclaw_upload`, form, {
                        headers: { ...form.getHeaders(), 'Authorization': `Bearer ${currentToken}` }
                    });
                    if (res.data.code === 200) {
                        const fileUrl = res.data.url;
                        const fileName = res.data.originalname;
                        const readyMsg = `\n\n[FILE_READY: ${fileUrl} | ${fileName}]`;
                        completedState.stdoutData += readyMsg;
                        wsSafeSend(ws, JSON.stringify({ type: 'stream', sessionId: activeSessionId, data: { source: 'stdout', text: readyMsg, _sessionId: activeSessionId } }));
                        console.log(`文件上传成功: ${fileUrl}`);
                    }
                } else {
                    const errMsg = `\n\n[系统提示: 请求发送的文件不存在 ${filePath}]`;
                    completedState.stdoutData += errMsg;
                    wsSafeSend(ws, JSON.stringify({ type: 'stream', sessionId: activeSessionId, data: { source: 'stdout', text: errMsg, _sessionId: activeSessionId } }));
                }
            } catch (err) {
                console.error('文件上传失败:', err.message);
                const errMsg = `\n\n[系统提示: 文件上传失败 ${err.message}]`;
                completedState.stdoutData += errMsg;
                wsSafeSend(ws, JSON.stringify({ type: 'stream', sessionId: activeSessionId, data: { source: 'stdout', text: errMsg, _sessionId: activeSessionId } }));
            }
        }

        console.log(`[cclaw result] sessionId: ${activeSessionId}, stdout length: ${completedState.stdoutData.length}`);
        wsSafeSend(ws, JSON.stringify({ type: 'result', sessionId: activeSessionId, data: { code, stdout: completedState.stdoutData, stderr: completedState.stderrData, _sessionId: activeSessionId } }));
        await sendWorkspaceOutputFiles(ws, activeSessionId, completedState);
        wsSafeSend(ws, JSON.stringify({ type: 'done', sessionId: activeSessionId, data: { _sessionId: activeSessionId } }));
    */  // 【注释结束】OpenClaw(废弃)
}


/**
 * executeXcrabCommand — 通过 xCrab Gateway 执行 AI 指令
 */
function executeXcrabCommand(command, ws, sessionId, username) {
    const activeSessionId = sessionId || "default";
    console.log(`正在调用 xCrab Gateway 执行... (会话: ${activeSessionId})`);

    // xCrab Gateway 地址（从 .env 配置，默认 3000 端口）
    const XCRAB_GATEWAY_URL = process.env.XCRAB_GATEWAY_URL || "http://localhost:3000";
    const XCRAB_GATEWAY_TOKEN = process.env.XCRAB_GATEWAY_TOKEN || "100911yzpYZP@";

    // 先发送一个"执行中"的提示
    wsSafeSend(ws, JSON.stringify({
        type: "stream",
        sessionId: activeSessionId,
        data: { source: "stdout", text: "🤖 正在调用 xCrab AI 处理...", _sessionId: activeSessionId }
    }));

    // 调用 xCrab Gateway /api/chat 接口
    const axios = require("axios");
    axios.post(`${XCRAB_GATEWAY_URL}/api/chat`, {
        message: command,
        sessionId: activeSessionId
    }, {
        headers: {
            "Authorization": `Bearer ${XCRAB_GATEWAY_TOKEN}`,
            "Content-Type": "application/json"
        },
        timeout: 300000  // 5 分钟超时
    }).then(response => {
        const data = response.data;
        if (data.code === 200 && data.data && data.data.content) {
            const reply = data.data.content;
            // 分段发送以避免单次消息过大
            const chunks = reply.match(/.{1,2000}/gs) || [reply];
            for (const chunk of chunks) {
                wsSafeSend(ws, JSON.stringify({
                    type: "stream",
                    sessionId: activeSessionId,
                    data: { source: "stdout", text: chunk, _sessionId: activeSessionId }
                }));
            }
        } else {
            wsSafeSend(ws, JSON.stringify({
                type: "stream",
                sessionId: activeSessionId,
                data: { source: "stdout", text: `⚠️ xCrab 返回异常: ${JSON.stringify(data)}`, _sessionId: activeSessionId }
            }));
        }
        // 发送完成信号
        wsSafeSend(ws, JSON.stringify({
            type: "done",
            sessionId: activeSessionId,
            data: { _sessionId: activeSessionId }
        }));
    }).catch(err => {
        const errMsg = err.response ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}` : err.message;
        console.error(`调用 xCrab Gateway 失败: ${errMsg}`);
        wsSafeSend(ws, JSON.stringify({
            type: "stream",
            sessionId: activeSessionId,
            data: { source: "stderr", text: `❌ 调用 xCrab 失败: ${errMsg}`, _sessionId: activeSessionId }
        }));
        wsSafeSend(ws, JSON.stringify({
            type: "done",
            sessionId: activeSessionId,
            data: { _sessionId: activeSessionId }
        }));
    });
}

// ======== HM(废弃)：以下为 Hermes 执行逻辑，保留供参考 ========
/*  // 【注释开始】Hermes(废弃)
function executeHermesCommand(command, ws, sessionId, username) {
    console.log(`正在调度 Hermes Agent 执行... (会话: ${sessionId || 'default'})`);

    const activeSessionId = sessionId || 'default';

    // 使用数组构造系统指令，避免深层嵌套的字符串转义问题
    const instructions = [
        '[System Instruction: If the user asks you to send or provide a local file, do not say you cannot. Instead, you MUST output the exact tag [SEND_FILE: <absolute_path>] in your response (e.g., [SEND_FILE: /path/to/file.txt]). The system will intercept this tag and automatically transfer the file to the user.]',
        '[System Instruction: When a sub-agent or any child process produces a status update, progress report, or result, you MUST output the exact tag format below in your response for each update:',
        `\\[SUBAGENT_MSG]{"agentId":"<agent-name>","message":"<update-content>","type":"info|result|error|progress"}\\[/SUBAGENT_MSG]`,
        'The system will intercept this tag and send the structured message to the user\'s mobile client in real-time. Each sub-agent update should use a separate tag. Example: \\[SUBAGENT_MSG]{"agentId":"\u4ee3\u7801\u5ba1\u67e5\u5458","message":"\u5df2\u5b8c\u6210\u4ee3\u7801\u5ba1\u67e5\uff0c\u53d1\u73b03\u4e2a\u95ee\u9898","type":"result"}\\[/SUBAGENT_MSG]]'
    ];

    instructions.push(`[System Instruction: Web端定时任务投递规则] 当用户通过网页端要求我创建定时/重复任务发送消息时，必须遵守：不要用默认投递机制，直接在脚本中用 curl 调用 http://xunrf.cn:10090/api/cron_deliver，POST，Content-Type: application/json，body: {"username":"${username}","message":"消息内容"}。`);
    let finalCommand = command + '\n\n' + instructions.join('\n');

    const customEnv = { ...process.env };
    customEnv['CI'] = 'true';
    customEnv['FORCE_COLOR'] = '0';
    if (!customEnv['HTTP_PROXY']) {
        customEnv['HTTP_PROXY'] = 'http://127.0.0.1:7890';
        customEnv['HTTPS_PROXY'] = 'http://127.0.0.1:7890';
        customEnv['http_proxy'] = 'http://127.0.0.1:7890';
        customEnv['https_proxy'] = 'http://127.0.0.1:7890';
    }
    if (!customEnv['HERMES_HOME']) {
        customEnv['HERMES_HOME'] = '/home/ubuntu/.hermes';
    }

    const hermesBin = '/usr/local/bin/hermes';
    const spawnArgs = ['chat', '-q', finalCommand, '-Q']; // -Q 安静模式：不输出 Query 回显/banner/工具日志，只输出回复

    customEnv['CCLAW_SUBAGENT_API'] = `http://127.0.0.1:${LOCAL_API_PORT}/api/subagent_message`;
    customEnv['CCLAW_CURRENT_SESSION_ID'] = activeSessionId;

    const child = pty.spawn(hermesBin, spawnArgs, {
        env: customEnv,
        cwd: __dirname,
    });

    const sessionState = {
        child: child,
        stdoutData: '',
        stderrData: '',
        subagentBuf: ''
    };
    sessionChildren.set(activeSessionId, sessionState);

    child.on('data', (chunk) => {
        const text = chunk.toString();
        // -Q 模式只输出 session_id: + 回复，剥离 ANSI 后过滤 session_id 行即可
        const clean = text.replace(/\x1B(?:\[[0-9;]*[a-zA-Z]|\][^\x07\x1B]*(?:\x07|\x1B\\)|[A-Z\\^_])/g, '');
        const filtered = clean.split('\n').filter(l => !/^session_id:/.test(l.trim())).join('\n');

        sessionState.stdoutData += filtered;
        sessionState.subagentBuf += text; // 子代理消息仍用原始文本检测

        if (sessionState.subagentBuf.length > 10000) {
            if (filtered.trim()) {
                wsSafeSend(ws, JSON.stringify({
                    type: 'stream',
                    sessionId: activeSessionId,
                    data: { source: 'stdout', text: filtered, _sessionId: activeSessionId }
                }));
            }
            sessionState.subagentBuf = '';
            return;
        }

        const subagentRegex = /\[SUBAGENT_MSG\](\{.*?\})\[\/SUBAGENT_MSG\]/g;
        let cleanedBuf = sessionState.subagentBuf;
        let match;
        let hasSubagentMsg = false;

        while ((match = subagentRegex.exec(sessionState.subagentBuf)) !== null) {
            hasSubagentMsg = true;
            try {
                const msgData = JSON.parse(match[1]);
                console.log(`[subagent pty] \u5b50Agent\u6d88\u606f: agentId=${msgData.agentId || 'unknown'}, type=${msgData.type || 'info'}`);
                wsSafeSend(ws, JSON.stringify({
                    type: 'subagent_message',
                    sessionId: activeSessionId,
                    data: {
                        agentId: msgData.agentId || 'unknown',
                        message: msgData.message || '',
                        type: msgData.type || 'info'
                    }
                }));
            } catch (e) {
                console.log(`[subagent pty] \u89e3\u6790\u5931\u8d25: ${e.message}`);
            }
        }

        if (hasSubagentMsg) {
            cleanedBuf = sessionState.subagentBuf.replace(subagentRegex, '');
        }

        const lastOpenTag = cleanedBuf.lastIndexOf('[SUBAGENT_MSG]');
        const lastCloseTag = cleanedBuf.lastIndexOf('[/SUBAGENT_MSG]');
        if (lastOpenTag > lastCloseTag) {
            sessionState.subagentBuf = cleanedBuf.substring(lastOpenTag);
            cleanedBuf = cleanedBuf.substring(0, lastOpenTag);
        } else if (hasSubagentMsg) {
            sessionState.subagentBuf = '';
        } else {
            sessionState.subagentBuf = '';
        }

        if (cleanedBuf) {
            const cleanBuf = cleanedBuf.replace(/\x1B(?:\[[0-9;]*[a-zA-Z]|\][^\x07\x1B]*(?:\x07|\x1B\\)|[A-Z\\^_])/g, '')
                .split('\n').filter(l => !/^session_id:/.test(l.trim())).join('\n');
            if (cleanBuf.trim()) {
                wsSafeSend(ws, JSON.stringify({
                    type: 'stream',
                    sessionId: activeSessionId,
                    data: { source: 'stdout', text: cleanBuf, _sessionId: activeSessionId }
                }));
            }
        }
    });

    child.on('exit', async (code) => {
        console.log(`[Hermes \u4f1a\u8bdd ${activeSessionId} \u6267\u884c\u5b8c\u6210] Exit code: ${code}`);

        const completedState = sessionChildren.get(activeSessionId);
        sessionChildren.delete(activeSessionId);
        if (!completedState) {
            console.error(`\u4f1a\u8bdd ${activeSessionId} \u72b6\u6001\u5df2\u4e22\u5931`);
            return;
        }

        const stdoutData = completedState.stdoutData;
        const stderrData = completedState.stderrData;

        if (stdoutData) console.log('\u8f93\u51fa:', stdoutData.substring(0, 500) + '...');
        if (stderrData) console.error('\u9519\u8bef:', stderrData.substring(0, 500) + '...');

        const fileMatch = stdoutData.match(/\[SEND_FILE:\s*(.+?)\]/);
        if (fileMatch) {
            const filePath = fileMatch[1].trim();
            console.log(`\u68c0\u6d4b\u5230\u6587\u4ef6\u53d1\u9001\u8bf7\u6c42: ${filePath}`);
            try {
                if (fs.existsSync(filePath)) {
                    const FormData = require('form-data');
                    const form = new FormData();
                    form.append('file', fs.createReadStream(filePath), { filename: path.basename(filePath) });
                    const res = await axios.post(`${ECLAW_API_URL}/api/cclaw_upload`, form, {
                        headers: { ...form.getHeaders(), 'Authorization': `Bearer ${currentToken}` }
                    });
                    if (res.data.code === 200) {
                        const fileUrl = res.data.url;
                        const fileName = res.data.originalname;
                        const readyMsg = `\n\n[FILE_READY: ${fileUrl} | ${fileName}]`;
                        completedState.stdoutData += readyMsg;
                        wsSafeSend(ws, JSON.stringify({ type: 'stream', sessionId: activeSessionId, data: { source: 'stdout', text: readyMsg, _sessionId: activeSessionId } }));
                        console.log(`\u6587\u4ef6\u4e0a\u4f20\u6210\u529f: ${fileUrl}`);
                    }
                } else {
                    const errMsg = `\n\n[\u7cfb\u7edf\u63d0\u793a: \u8bf7\u6c42\u53d1\u9001\u7684\u6587\u4ef6\u4e0d\u5b58\u5728 ${filePath}]`;
                    completedState.stdoutData += errMsg;
                    wsSafeSend(ws, JSON.stringify({ type: 'stream', sessionId: activeSessionId, data: { source: 'stdout', text: errMsg, _sessionId: activeSessionId } }));
                }
            } catch (err) {
                console.error('\u6587\u4ef6\u4e0a\u4f20\u5931\u8d25:', err.message);
                const errMsg = `\n\n[\u7cfb\u7edf\u63d0\u793a: \u6587\u4ef6\u4e0a\u4f20\u5931\u8d25 ${err.message}]`;
                completedState.stdoutData += errMsg;
                wsSafeSend(ws, JSON.stringify({ type: 'stream', sessionId: activeSessionId, data: { source: 'stdout', text: errMsg, _sessionId: activeSessionId } }));
            }
        }

        // 检测常见 Hermes 错误并生成友好的提示
        const allOutput = (completedState.stdoutData + '\n' + completedState.stderrData).toLowerCase();
        let friendlyError = '';
        if (allOutput.includes('429') && allOutput.includes('usage limit')) {
            friendlyError = '\n\n[系统提示] Hermes Agent API 调用达到周配额上限（每周 6000 tokens），请等待额度重置（5月18日周一）后再试，或升级 Token Plan。';
        } else if (allOutput.includes('429') || allOutput.includes('rate_limit')) {
            friendlyError = '\n\n[系统提示] Hermes Agent API 被限频（429），请稍后重试。';
        } else if (allOutput.includes('401') || allOutput.includes('unauthorized')) {
            friendlyError = '\n\n[系统提示] Hermes Agent 认证失败，请检查 API Key 配置。';
        } else if (allOutput.includes('timeout') || allOutput.includes('timed out')) {
            friendlyError = '\n\n[系统提示] Hermes Agent 请求超时。';
        } else if (code !== 0 && !completedState.stdoutData.trim()) {
            friendlyError = '\n\n[系统提示] Hermes Agent 执行失败，请检查服务状态或稍后重试。';
        }

        if (friendlyError) {
            completedState.stdoutData += friendlyError;
            wsSafeSend(ws, JSON.stringify({ type: 'stream', sessionId: activeSessionId, data: { source: 'stdout', text: friendlyError, _sessionId: activeSessionId } }));
        }

        console.log(`[cclaw result] sessionId: ${activeSessionId}, stdout length: ${completedState.stdoutData.length}`);
        wsSafeSend(ws, JSON.stringify({ type: 'result', sessionId: activeSessionId, data: { code, stdout: completedState.stdoutData, stderr: completedState.stderrData, _sessionId: activeSessionId } }));
        wsSafeSend(ws, JSON.stringify({ type: 'done', sessionId: activeSessionId, data: { _sessionId: activeSessionId } }));
    });
}  // HM(废弃)：executeHermesCommand 结束
*/  // 【注释结束】Hermes(废弃)


/**
 * 检查工作区 outputs 目录中是否有子 Agent 生成的新文件，将其内容作为 stream 事件发送
 */
async function sendWorkspaceOutputFiles(ws, sessionId, completedState) {
    const configPath = path.join(__dirname, 'data', 'openclaw.json'); // OC(废弃)：openclaw 配置文件
    let workspaces = [];

    try {
        if (fs.existsSync(configPath)) {
            let content = fs.readFileSync(configPath, 'utf8');
            if (content.charCodeAt(0) === 0xFEFF) {
                content = content.slice(1);
            }
            const config = JSON.parse(content);
            if (config.agents && config.agents.list) {
                for (const agent of config.agents.list) {
                    if (agent.workspace) {
                        const outputsDir = path.join(agent.workspace, 'outputs');
                        if (fs.existsSync(outputsDir)) {
                            workspaces.push({ agentId: agent.id, dir: outputsDir });
                        }
                    }
                }
            }
        }
    } catch(e) {
        console.log(`[workspace] 读取配置文件失败: ${e.message}`);
        return;
    }

    if (workspaces.length === 0) {
        return;
    }

    // 记录检查前的文件快照（只关注 .md 文件）
    function getOutputFiles() {
        const files = [];
        for (const ws of workspaces) {
            try {
                if (fs.existsSync(ws.dir)) {
                    const entries = fs.readdirSync(ws.dir);
                    for (const entry of entries) {
                        const filePath = path.join(ws.dir, entry);
                        try {
                            const stat = fs.statSync(filePath);
                            if (stat.isFile() && (entry.endsWith('.md') || entry.endsWith('.txt'))) {
                                files.push({ path: filePath, agentId: ws.agentId, mtimeMs: stat.mtimeMs });
                            }
                        } catch(e) {}
                    }
                }
            } catch(e) {}
        }
        return files;
    }

    // 检查是否有新文件（不在初始快照中）
    const initialFiles = getOutputFiles();
    const initialSet = new Set(initialFiles.map(f => f.path));

    // 轮询等待新文件（最多 60 秒，每 3 秒检查一次）
    const maxWaitMs = 60000;
    const pollInterval = 3000;
    const startTime = Date.now();

    let newFiles = [];
    while (Date.now() - startTime < maxWaitMs) {
        const currentFiles = getOutputFiles();
        newFiles = currentFiles.filter(f => !initialSet.has(f.path) && f.mtimeMs > startTime - 5000);
        if (newFiles.length > 0) {
            console.log(`[workspace] 发现 ${newFiles.length} 个新输出文件`);
            break;
        }
        // 等待轮询间隔
        await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    // 发送新文件内容
    for (const file of newFiles) {
        try {
            const fileContent = fs.readFileSync(file.path, 'utf8');
            const header = `\n\n---\n**${file.agentId} 输出结果:**\n\n`;
            const fullContent = header + fileContent;

            // 发送 stream 事件给前端
            wsSafeSend(ws, JSON.stringify({
                type: 'stream',
                sessionId: sessionId,
                data: { source: 'stdout', text: fullContent, _sessionId: sessionId }
            }));

            // 追加到最终结果中
            completedState.stdoutData += fullContent;
            console.log(`[workspace] 已发送 ${file.agentId} 的输出文件: ${file.path} (${fileContent.length} chars)`);
        } catch(e) {
            console.log(`[workspace] 读取输出文件失败 ${file.path}: ${e.message}`);
        }
    }
}

// ===================================================
//  本地 HTTP 服务：接收子 Agent 消息并转发到远端服务端
// ===================================================
const LOCAL_API_PORT = 10091;

let monitorProcess = null; // 状态监控子进程引用

/**
 * 自动启动状态监控脚本（status-monitor.js）
 * 监控脚本会轮询本地的 /api/status 并将执行状态推送到云端
 */
function autoStartMonitor() {
    if (monitorProcess) {
        return; // 已启动，避免重复
    }

    const monitorScript = path.join(__dirname, 'status-monitor.js');
    if (!fs.existsSync(monitorScript)) {
        console.log('[监控] status-monitor.js 不存在，跳过自动启动');
        return;
    }

    try {
        const { spawn } = require('child_process');
        // 传入 CCLAW_DATA_DIR 环境变量，让监控脚本在正确的目录查找 token 文件
        const monitorEnv = { ...process.env, CCLAW_DATA_DIR: __dirname };
        monitorProcess = spawn(process.execPath, [monitorScript], {
            cwd: __dirname,
            env: monitorEnv,
            stdio: 'pipe',
            detached: false
        });

        monitorProcess.stdout.on('data', (data) => {
            const msg = data.toString().trim();
            if (msg) console.log(`[监控] ${msg}`);
        });

        monitorProcess.stderr.on('data', (data) => {
            const msg = data.toString().trim();
            if (msg) console.error(`[监控错误] ${msg}`);
        });

        monitorProcess.on('error', (err) => {
            console.error(`[监控] 启动失败: ${err.message}`);
            monitorProcess = null;
        });

        monitorProcess.on('exit', (code) => {
            if (code !== 0 && code !== null) {
                console.log(`[监控] 进程退出 (code: ${code})`);
            }
            monitorProcess = null;
        });

        console.log('[监控] status-monitor.js 已自动启动');
    } catch (err) {
        console.error(`[监控] 启动失败: ${err.message}`);
        monitorProcess = null;
    }
}

/**
 * 停止状态监控脚本
 */
function stopMonitor() {
    if (monitorProcess) {
        try {
            monitorProcess.kill();
        } catch (e) {
            // 忽略
        }
        monitorProcess = null;
    }
}

const localServer = http.createServer((req, res) => {
    // 只处理 POST /api/subagent_message
    if (req.method === 'POST' && req.url === '/api/subagent_message') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const { sessionId, agentId, message, type } = data;

                if (!sessionId || !message) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 400, message: 'sessionId 和 message 不能为空' }));
                    return;
                }

                // 通过 WebSocket 转发给远端服务端
                if (wss && wss.readyState === WebSocket.OPEN && !authFailed) {
                    wsSafeSend(wss, JSON.stringify({
                        type: 'subagent_message',
                        sessionId,
                        data: { agentId: agentId || 'unknown', message, type: type || 'info' }
                    }));
                    console.log(`[subagent] 已转发子Agent消息: sessionId=${sessionId}, agentId=${agentId || 'unknown'}, type=${type || 'info'}`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 200, message: '消息已转发' }));
                } else {
                    console.warn(`[subagent] WebSocket 未连接，无法转发消息`);
                    res.writeHead(503, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 503, message: 'WebSocket 未连接' }));
                }
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 400, message: 'JSON 解析失败: ' + e.message }));
            }
        });
    } else if (req.method === 'GET' && req.url === '/api/status') {
        // 返回当前 cclaw 的执行状态（给第三方监控脚本使用）
        const executing = sessionChildren.size > 0;
        const sessions = Array.from(sessionChildren.keys()).map(sid => ({
            sessionId: sid
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            code: 200,
            data: {
                executing,
                sessionCount: sessionChildren.size,
                sessions,
                timestamp: Date.now()
            }
        }));
    } else if (req.method === 'POST' && req.url === '/api/forward_status') {
        // 接收 status-monitor.js 推送的执行状态，通过已认证 WebSocket 转发到服务端
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                if (wss && wss.readyState === WebSocket.OPEN && !authFailed) {
                    wsSafeSend(wss, JSON.stringify({
                        type: 'status_update',
                        data: data
                    }));
                }
                // WebSocket 未连接时也返回 200，monitor 定期轮询会在重连后自动续上
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 200, message: '已接收' }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 400, message: 'JSON 解析失败: ' + e.message }));
            }
        });
    } else {
        res.writeHead(404);
        res.end();
    }
});

localServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.log(`[本地API] 端口 ${LOCAL_API_PORT} 已被占用，跳过（可能已有实例在运行）`);
    } else {
        console.error(`[本地API] 监听失败:`, err.message);
    }
});

localServer.listen(LOCAL_API_PORT, '127.0.0.1', () => {
    //console.log(`子 Agent 消息本地接收服务已启动: http://127.0.0.1:${LOCAL_API_PORT}/api/subagent_message`);
    // 设置环境变量，让子进程（OpenClaw/Claude Code）知道如何发送消息
    process.env['CCLAW_SUBAGENT_API'] = `http://127.0.0.1:${LOCAL_API_PORT}/api/subagent_message`;
});

// cclaw 退出时清理监控子进程
process.on('exit', () => {
    stopMonitor();
});
process.on('SIGINT', () => {
    stopMonitor();
    process.exit();
});
process.on('SIGTERM', () => {
    stopMonitor();
    process.exit();
});

// 启动客户端
startClient();
