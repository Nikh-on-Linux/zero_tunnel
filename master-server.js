const express = require('express');
const path = require('path');
const basicAuth = require('express-basic-auth');
const http = require('http');
const socketIo = require('socket.io');
const {configDotenv} = require("dotenv");

configDotenv();

const app = express();
const server = http.createServer(app);

// Initialize Socket.IO with the 'ws' engine for performance improvements
const io = new socketIo.Server(server, {
    wsEngine: require('ws').Server,
});

// --- State Management ---
// Stores agent sockets, keyed by their unique name
const connectedAgents = new Map();
// Stores browser client sockets and their state, keyed by socket.id
const browserSessions = new Map();

// --- Security ---
// WARNING: Change these credentials for any real-world application!
app.use(basicAuth({
    users: { 'infinity': '1/0' },
    challenge: true,
    realm: 'Web Terminal Login'
}));

// Serve static files (index.html, script.js, style.css) from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Broadcasts the updated list of connected agents to all connected browser clients.
 * This function is called whenever an agent connects or disconnects.
 */
function broadcastPcList() {
    const pcList = Array.from(connectedAgents.keys()).map(name => ({ name }));
    io.of('/web-clients').emit('update-pc-list', pcList);
    console.log('[MASTER] Broadcasting updated PC list:', pcList.map(p => p.name));
}

// === Namespace for Web Browser Clients (/web-clients) ===
const webClients = io.of('/web-clients');
webClients.on('connection', (socket) => {
    console.log(`[MASTER] Web client connected: ${socket.id}`);
    browserSessions.set(socket.id, { socket, selectedAgent: null });

    // Send the current list of available agents to the newly connected client
    const pcList = Array.from(connectedAgents.keys()).map(name => ({ name }));
    socket.emit('update-pc-list', pcList);

    // --- Event: 'select-pc' ---
    // A browser client requests a terminal session with a specific agent.
    socket.on('select-pc', (pcName) => {
        const session = browserSessions.get(socket.id);
        const agent = connectedAgents.get(pcName);

        if (session && agent) {
            console.log(`[MASTER] Connecting browser ${socket.id} to agent ${pcName}`);
            session.selectedAgent = pcName;

            // Instruct the agent to create a new PTY process for this specific browser
            agent.socket.emit('create-new-terminal', { browserId: socket.id });

            // Acknowledge the selection back to the browser to update its UI
            socket.emit('pc-selected-ack', { name: pcName });
        } else {
            console.error(`[MASTER] Agent '${pcName}' not found for browser ${socket.id}`);
            socket.emit('pc-select-error', `Agent '${pcName}' is not connected or does not exist.`);
        }
    });

    // --- Event: 'terminal-input' ---
    // Relays keyboard input from the browser to the appropriate agent.
    socket.on('terminal-input', (data) => {
        const session = browserSessions.get(socket.id);
        if (session && session.selectedAgent) {
            const agent = connectedAgents.get(session.selectedAgent);
            // Forward the input data along with the browserId to the agent
            agent?.socket.emit('terminal-input', { browserId: socket.id, data });
        }
    });

    // --- Event: 'terminal-resize' ---
    // Relays terminal resize events from the browser to the agent.
    socket.on('terminal-resize', (size) => {
        const session = browserSessions.get(socket.id);
        if (session && session.selectedAgent) {
            const agent = connectedAgents.get(session.selectedAgent);
            // Forward the resize data along with the browserId to the agent
            agent?.socket.emit('terminal-resize', { browserId: socket.id, size });
        }
    });

    // --- Event: 'close-terminal' ---
    // A browser client requests to close their terminal session.
    socket.on('close-terminal', () => {
        const session = browserSessions.get(socket.id);
        if (session && session.selectedAgent) {
            const agent = connectedAgents.get(session.selectedAgent);
            console.log(`[MASTER] Browser ${socket.id} requested to close session with ${session.selectedAgent}`);
            // Instruct the agent to kill the specific PTY process for this browser
            agent?.socket.emit('close-terminal', { browserId: socket.id });
            session.selectedAgent = null;
            socket.emit('close-terminal-ack'); // Acknowledge closure to the client
        }
    });

    // --- Event: 'disconnect' ---
    // Handles browser client disconnection.
    socket.on('disconnect', () => {
        console.log(`[MASTER] Web client disconnected: ${socket.id}`);
        const session = browserSessions.get(socket.id);
        // If the disconnected browser had an active session, tell the agent to clean it up.
        if (session && session.selectedAgent) {
            const agent = connectedAgents.get(session.selectedAgent);
            agent?.socket.emit('close-terminal', { browserId: socket.id });
        }
        browserSessions.delete(socket.id);
    });
});

// === Namespace for Terminal Agents (/agents) ===
const agents = io.of('/agents');
agents.on('connection', (socket) => {
    console.log(`[MASTER] An agent is attempting to connect...`);
    let agentName = null; // To keep track of the agent's name for the life of the socket

    // --- Event: 'agent-register' ---
    // An agent connects and identifies itself with a name.
    socket.on('agent-register', (name) => {
        agentName = name;
        console.log(`[MASTER] Agent registered: ${agentName} (${socket.id})`);
        connectedAgents.set(agentName, { socket });

        // Notify all browser clients that a new agent is available
        broadcastPcList();
    });

    // --- Event: 'terminal-output' ---
    // Relays terminal output from an agent to the correct browser client.
    socket.on('terminal-output', ({ browserId, data }) => {
        const session = browserSessions.get(browserId);
        session?.socket.emit('terminal-output', data);
    });

    // --- Event: 'disconnect' ---
    // Handles agent disconnection.
    socket.on('disconnect', () => {
        if (agentName) {
            console.log(`[MASTER] Agent disconnected: ${agentName}`);
            connectedAgents.delete(agentName);
            // Notify all browser clients that an agent has disconnected
            broadcastPcList();
        }
    });
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
    console.log(`Master Proxy Server running on port ${PORT}`);
    console.log(`Access at: http://localhost:${PORT}`);
});
