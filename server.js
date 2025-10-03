const pty = require('node-pty');
const io = require('socket.io-client');
require('dotenv').config();

// --- AGENT CONFIGURATION ---
// IMPORTANT: Give each agent a unique name. This can be set via an environment variable
// or hardcoded. For example: AGENT_NAME = process.env.AGENT_NAME || "Lab-PC-01";
const AGENT_NAME = process.env.SYSTEM_NAME;
const MASTER_SERVER_URL = process.env.ROOT_URL;
// -------------------------

console.log(`[AGENT] Starting agent: ${AGENT_NAME}`);

// Connect to the '/agents' namespace on the master server
const masterSocket = io(`${MASTER_SERVER_URL}/agents`, {
    reconnection: true,
    reconnectionDelay: 5000,
    reconnectionAttempts: Infinity,
    transports: ['websocket'], // Force websocket for better performance
});

// Use a Map to store and manage PTY processes for multiple concurrent browser sessions.
// The key is the browser's socket.id, and the value is the ptyProcess object.
const ptyProcesses = new Map();

/**
 * Creates a new pseudo-terminal (PTY) process for a given browser session.
 * @param {string} browserId - The unique socket.id of the connecting browser client.
 */
function createPtyProcess(browserId) {
    // If a PTY already exists for this browser, kill it to ensure a fresh session.
    if (ptyProcesses.has(browserId)) {
        ptyProcesses.get(browserId).kill();
        console.log(`[AGENT] Killed existing PTY for ${browserId}.`);
    }

    const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
    const ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-color',
        cols: 80,
        rows: 24,
        cwd: process.env.HOME || process.cwd(),
        env: process.env
    });

    // Listen for data (output) from the PTY process.
    ptyProcess.onData((data) => {
        // Send the output to the master server, specifying which browser it belongs to.
        masterSocket.emit('terminal-output', { browserId, data });
    });

    // Store the new PTY process in the map.
    ptyProcesses.set(browserId, ptyProcess);
    console.log(`[AGENT] New PTY process created for browser: ${browserId}`);
}

// --- Socket.IO Event Handlers ---

masterSocket.on('connect', () => {
    console.log(`[AGENT] Connected to master server at ${MASTER_SERVER_URL}`);
    // Register this agent with the master server using its unique name.
    masterSocket.emit('agent-register', AGENT_NAME);
});

// --- Event: 'create-new-terminal' ---
// Master server instructs this agent to create a new terminal session for a browser.
masterSocket.on('create-new-terminal', ({ browserId }) => {
    createPtyProcess(browserId);
});

// --- Event: 'terminal-input' ---
// Master server forwards keyboard input from a browser.
masterSocket.on('terminal-input', ({ browserId, data }) => {
    const ptyProcess = ptyProcesses.get(browserId);
    if (ptyProcess) {
        ptyProcess.write(data);
    }
});

// --- Event: 'terminal-resize' ---
// Master server forwards a resize event from a browser.
masterSocket.on('terminal-resize', ({ browserId, size }) => {
    const ptyProcess = ptyProcesses.get(browserId);
    if (ptyProcess) {
        ptyProcess.resize(size.cols, size.rows);
        console.log(`[AGENT] Terminal for ${browserId} resized to ${size.cols}x${size.rows}`);
    }
});

// --- Event: 'close-terminal' ---
// Master server instructs this agent to terminate a specific PTY process.
masterSocket.on('close-terminal', ({ browserId }) => {
    const ptyProcess = ptyProcesses.get(browserId);
    if (ptyProcess) {
        ptyProcess.kill();
        ptyProcesses.delete(browserId);
        console.log(`[AGENT] PTY process killed for browser: ${browserId}`);
    }
});

masterSocket.on('disconnect', (reason) => {
    console.error(`[AGENT] Disconnected from master server: ${reason}`);
    // Clean up all active PTY processes when the agent disconnects from the master.
    for (const [browserId, ptyProcess] of ptyProcesses.entries()) {
        ptyProcess.kill();
        console.log(`[AGENT] Killed PTY for ${browserId} due to disconnection.`);
    }
    ptyProcesses.clear();
});

masterSocket.on('connect_error', (err) => {
    console.error(`[AGENT] Connection error: ${err.message}`);
});
