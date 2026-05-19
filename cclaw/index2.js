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
            if (username === 'yzp1009') {
                // 免验证码登录
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

function connectWebSocket(token) {
    const ws = new WebSocket(ECLAW_WS_URL);
    wss = ws; // 保存到全局引用，供本地 HTTP 服务转发消息使用

    ws.on('open', () => {
        console.log('已连接到云端服务器！正在验证身份...');
        ws.send(JSON.stringify({ type: 'auth', data: { token } }));
    });

    // 心跳：定期发送心跳给服务器，防止连接被中断
    const heartbeatTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN && !authFailed) {
            ws.ping();
        }
    }, 25000); // 每 25 秒发送一次 ping

    ws.on('pong', () => {
        // 服务器响应了 pong，连接正常
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
                console.log(`\n[收到指令]: ${command} (Session: ${sessionId || 'none'})`);
                executeOpenClawCommand(command, ws, sessionId);
            } else if (msg.type === 'new_session') {
                const { sessionId, title } = msg;
                console.log(`\n[新会话通知]: sessionId=${sessionId}, title=${title || '新对话'}`);
                // 回复确认，告知服务端 cclaw 已收到新会话通知
                ws.send(JSON.stringify({
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
    });
}

function executeOpenClawCommand(command, ws, sessionId) {
    console.log(`正在调度本地 OpenClaw 执行... (会话: ${sessionId || 'default'})`);
    
    const activeSessionId = sessionId || 'default';
    
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    // openclaw 与 cclaw 在同一父目录下平级
    const execCliPath = path.join(__dirname, '..', 'openclaw', 'dist', 'index.js');
    // Linux 使用系统 node，Windows 使用捆绑的 node.exe（在父级目录）
    const execNodeExe = process.platform === 'win32'
        ? path.join(__dirname, '..', 'nodejs', 'node.exe')
        : 'node';

    const customEnv = { ...process.env };
    customEnv['CI'] = 'true';
    customEnv['FORCE_COLOR'] = '0';
    customEnv['OPENCLAW_LOG_LEVEL'] = 'info'; // 抑制 trace/debug 日志
    // 移除所有强制注入的 token，让它使用默认行为
    // customEnv['OPENCLAW_GATEWAY_TOKEN'] = '123456';
    // customEnv['OPENCLAW_GATEWAY_REMOTE_TOKEN'] = '123456';
    // customEnv['OPENCLAW_GATEWAY_AUTH_TOKEN'] = '123456';

    // 确保子进程明确知道配置文件的位置
    customEnv['OPENCLAW_STATE_DIR'] = dataDir;
    customEnv['OPENCLAW_CONFIG_PATH'] = path.join(dataDir, 'openclaw.json');
    // agent 配置也指向 data 目录，统一管理 models.json 和 auth-profiles.json
    customEnv['OPENCLAW_AGENT_DIR'] = dataDir;

    // 清理配置文件中的遗留 token 配置
    const configPath = path.join(dataDir, 'openclaw.json');
    try {
        if (fs.existsSync(configPath)) {
            // Remove BOM if present before parsing
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
            
            // Sync all API Keys from env block to models config and customEnv
            if (config.env) {
                for (const [key, value] of Object.entries(config.env)) {
                    customEnv[key] = value;
                    if (key.endsWith('_API_KEY') || key.endsWith('_OAUTH_TOKEN')) {
                        let provider = key.replace('_API_KEY', '').replace('_OAUTH_TOKEN', '').toLowerCase().replace('_', '-');
                        
                        // Handle minimax special cases
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
                                    config.models.providers[provider] = {
                                        models: [] // Add empty models array to pass validation
                                    };
                                    
                                    // Add default baseUrl for known providers
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
    // 注入系统指令，教导 AI 如何发送文件
    finalCommand += "\n\n[System Instruction: If the user asks you to send or provide a local file, do not say you cannot. Instead, you MUST output the exact tag `[SEND_FILE: <absolute_path>]` in your response (e.g., [SEND_FILE: /path/to/file.txt]). The system will intercept this tag and automatically transfer the file to the user.]";
    // 注入系统指令，教导 AI 如何发送子 Agent 的结构化消息
    finalCommand += `\n\n[System Instruction: When a sub-agent or any child process produces a status update, progress report, or result, you MUST output the exact tag format below in your response for each update:\n\`[SUBAGENT_MSG]{"agentId":"<agent-name>","message":"<update-content>","type":"info|result|error|progress"}[/SUBAGENT_MSG]\`\nThe system will intercept this tag and send the structured message to the user's mobile client in real-time. Each sub-agent update should use a separate tag. Example: [SUBAGENT_MSG]{"agentId":"代码审查员","message":"已完成代码审查，发现3个问题","type":"result"}[/SUBAGENT_MSG]]`;

    // 移除不支持的参数，添加 --local 使其不依赖后台 Gateway，确保 taskkill 能彻底杀掉
    const spawnArgs = [
        execCliPath, 
        "agent", 
        "--local",
        "--message", finalCommand, 
        "--session-id", dynamicSessionId
    ];

    // 显式传入子Agent消息通道信息（覆盖到 customEnv 确保子进程能读取）
    customEnv['CCLAW_SUBAGENT_API'] = `http://127.0.0.1:${LOCAL_API_PORT}/api/subagent_message`;
    customEnv['CCLAW_CURRENT_SESSION_ID'] = dynamicSessionId;
    // OpenClaw agent 本地模式需要使用 ANTHROPIC_API_KEY，这里用 MiniMax 的 key（兼容 Anthropic Messages API）
    if (customEnv['MINIMAX_API_KEY'] && !customEnv['ANTHROPIC_API_KEY']) {
        customEnv['ANTHROPIC_API_KEY'] = customEnv['MINIMAX_API_KEY'];
    }

    // Use PTY so all subprocess output (including sub-agent stdout) is visible to cclaw.
    const child = pty.spawn(execNodeExe, spawnArgs, {
        env: customEnv,
        cwd: __dirname,
    });

    // 为该会话保存执行状态
    const sessionState = {
        child: child,
        stdoutData: '',
        stderrData: '',
        subagentBuf: '' // Buffer for detecting [SUBAGENT_MSG] tags across PTY chunks
    };
    sessionChildren.set(activeSessionId, sessionState);

    child.on('data', (chunk) => {
        const text = chunk.toString();
        sessionState.stdoutData += text;
        // 追加到跨块缓冲区用于检测 [SUBAGENT_MSG] 标签
        sessionState.subagentBuf += text;

        // 安全阀：如果缓冲区过大（>10KB）说明没有合法标签，直接全部作为 stream 发送
        if (sessionState.subagentBuf.length > 10000) {
            ws.send(JSON.stringify({
                type: 'stream',
                sessionId: activeSessionId,
                data: { source: 'stdout', text: sessionState.subagentBuf, _sessionId: activeSessionId }
            }));
            sessionState.subagentBuf = '';
            return;
        }

        // 从缓冲区提取完整的 [SUBAGENT_MSG]...[/SUBAGENT_MSG] 消息
        const subagentRegex = /\[SUBAGENT_MSG\](\{.*?\})\[\/SUBAGENT_MSG\]/g;
        let cleanedBuf = sessionState.subagentBuf;
        let match;
        let hasSubagentMsg = false;

        while ((match = subagentRegex.exec(sessionState.subagentBuf)) !== null) {
            hasSubagentMsg = true;
            try {
                const msgData = JSON.parse(match[1]);
                console.log(`[subagent pty] 子Agent消息: agentId=${msgData.agentId || 'unknown'}, type=${msgData.type || 'info'}`);
                ws.send(JSON.stringify({
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

        if (cleanedBuf) {
            ws.send(JSON.stringify({
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
                        ws.send(JSON.stringify({ type: 'stream', sessionId: activeSessionId, data: { source: 'stdout', text: readyMsg, _sessionId: activeSessionId } }));
                        console.log(`文件上传成功: ${fileUrl}`);
                    }
                } else {
                    const errMsg = `\n\n[系统提示: 请求发送的文件不存在 ${filePath}]`;
                    completedState.stdoutData += errMsg;
                    ws.send(JSON.stringify({ type: 'stream', sessionId: activeSessionId, data: { source: 'stdout', text: errMsg, _sessionId: activeSessionId } }));
                }
            } catch (err) {
                console.error('文件上传失败:', err.message);
                const errMsg = `\n\n[系统提示: 文件上传失败 ${err.message}]`;
                completedState.stdoutData += errMsg;
                ws.send(JSON.stringify({ type: 'stream', sessionId: activeSessionId, data: { source: 'stdout', text: errMsg, _sessionId: activeSessionId } }));
            }
        }

        console.log(`[cclaw result] sessionId: ${activeSessionId}, stdout length: ${completedState.stdoutData.length}`);
        ws.send(JSON.stringify({ type: 'result', sessionId: activeSessionId, data: { code, stdout: completedState.stdoutData, stderr: completedState.stderrData, _sessionId: activeSessionId } }));
        await sendWorkspaceOutputFiles(ws, activeSessionId, completedState);
        ws.send(JSON.stringify({ type: 'done', sessionId: activeSessionId, data: { _sessionId: activeSessionId } }));
    });
}

/**
 * 检查工作区 outputs 目录中是否有子 Agent 生成的新文件，将其内容作为 stream 事件发送
 */
async function sendWorkspaceOutputFiles(ws, sessionId, completedState) {
    const configPath = path.join(__dirname, 'data', 'openclaw.json');
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
            ws.send(JSON.stringify({
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
                    wss.send(JSON.stringify({
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
                    wss.send(JSON.stringify({
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
