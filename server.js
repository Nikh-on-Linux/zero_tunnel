const pty = require('node-pty');
const io = require('socket.io-client');
require('dotenv').config()
// --- AGENT CONFIGURATION ---
const AGENT_NAME = "Lab-28"; // IMPORTANT: Give each agent a unique name
const MASTER_SERVER_URL = process.env.ROOT_URL; // URL of your master server
// -------------------------

console.log(`[AGENT] Starting agent: ${AGENT_NAME}`);
const masterSocket = io(`${MASTER_SERVER_URL}/agents`, {
    reconnection: true,
    reconnectionDelay: 5000,
    reconnectionAttempts: Infinity
});

let ptyProcess = null;

function createPtyProcess() {
    const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
    ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-color',
        cols: 80,
        rows: 24,
        cwd: process.env.HOME,
        env: process.env
    });

    // Listen for data from the PTY and send it to the master server
    ptyProcess.onData((data) => {
        masterSocket.emit('terminal-output', data);
    });

    console.log('[AGENT] PTY process created.');
}

masterSocket.on('connect', () => {
    console.log(`[AGENT] Connected to master server at ${MASTER_SERVER_URL}`);
    masterSocket.emit('agent-register', AGENT_NAME);
    
    // Create a new PTY process for this connection
    if (!ptyProcess) {
        createPtyProcess();
    }
});

// Listen for input from the master server and write it to the PTY
masterSocket.on('terminal-input', (data) => {
    if (ptyProcess) {
        ptyProcess.write(data);
    }
});

// Listen for resize events from the master
masterSocket.on('terminal-resize', (data) => {
    if (ptyProcess) {
        ptyProcess.resize(data.cols, data.rows);
        console.log(`[AGENT] Terminal resized to ${data.cols}x${data.rows}`);
    }
});

masterSocket.on('disconnect', (reason) => {
    console.error(`[AGENT] Disconnected from master server: ${reason}`);
    // The PTY process can be killed and recreated on reconnect to ensure a fresh session
    if (ptyProcess) {
        ptyProcess.kill();
        ptyProcess = null;
        console.log('[AGENT] PTY process killed.');
    }
});

masterSocket.on('connect_error', (err) => {
    console.error(`[AGENT] Connection error: ${err.message}`);
});
