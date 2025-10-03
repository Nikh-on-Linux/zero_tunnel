const express = require('express');
const path = require('path');
const basicAuth = require('express-basic-auth');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// --- State Management ---
const connectedAgents = new Map(); // Stores agent sockets, keyed by their name
const browserSessions = new Map(); // Stores browser sockets, keyed by their socket.id

// --- SECURITY WARNING ---
// Change these credentials for any real-world use!
app.use(basicAuth({
    users: { 'admin': 'password123' },
    challenge: true,
    realm: 'Web Terminal Login'
}));

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Function to broadcast the updated list of connected agents to all browsers
function broadcastPcList() {
    const pcList = Array.from(connectedAgents.keys()).map(name => ({ name }));
    io.of('/web-clients').emit('update-pc-list', pcList);
    console.log('Broadcasting updated PC list:', pcList.map(p => p.name));
}

// Namespace for web browser clients
const webClients = io.of('/web-clients');
webClients.on('connection', (socket) => {
    console.log(`[MASTER] Web client connected: ${socket.id}`);
    browserSessions.set(socket.id, { socket, selectedAgent: null });

    // Send the current list of PCs to the newly connected client
    const pcList = Array.from(connectedAgents.keys()).map(name => ({ name }));
    socket.emit('update-pc-list', pcList);

    // Browser wants to connect to a specific agent
    socket.on('select-pc', (pcName) => {
        const session = browserSessions.get(socket.id);
        const agent = connectedAgents.get(pcName);

        if (session && agent) {
            console.log(`[MASTER] Connecting browser ${socket.id} to agent ${pcName}`);
            session.selectedAgent = pcName;
            // Notify the browser that the connection is established
            socket.emit('pc-selected-ack', { name: pcName });
        } else {
            console.error(`[MASTER] Agent ${pcName} not found for browser ${socket.id}`);
            socket.emit('pc-select-error', `Agent '${pcName}' is not connected.`);
        }
    });

    // Relay terminal input from browser to the selected agent
    socket.on('terminal-input', (data) => {
        const session = browserSessions.get(socket.id);
        if (session && session.selectedAgent) {
            const agent = connectedAgents.get(session.selectedAgent);
            agent?.socket.emit('terminal-input', data);
        }
    });
    
    // Relay terminal resize from browser to the selected agent
    socket.on('terminal-resize', (data) => {
        const session = browserSessions.get(socket.id);
        if (session && session.selectedAgent) {
            const agent = connectedAgents.get(session.selectedAgent);
            agent?.socket.emit('terminal-resize', data);
        }
    });

    socket.on('disconnect', () => {
        console.log(`[MASTER] Web client disconnected: ${socket.id}`);
        browserSessions.delete(socket.id);
    });
});

// Namespace for terminal agents
const agents = io.of('/agents');
agents.on('connection', (socket) => {
    console.log(`[MASTER] An agent is trying to connect...`);

    socket.on('agent-register', (agentName) => {
        if (connectedAgents.has(agentName)) {
            console.warn(`[MASTER] Agent with name '${agentName}' reconnected.`);
        }
        console.log(`[MASTER] Agent registered: ${agentName} (${socket.id})`);
        connectedAgents.set(agentName, { socket });
        
        // Relay terminal output from this agent to all connected browsers
        socket.on('terminal-output', (data) => {
            // Find which browser is connected to this agent and send data only to them
            for (const [browserId, session] of browserSessions.entries()) {
                if (session.selectedAgent === agentName) {
                    session.socket.emit('terminal-output', data);
                }
            }
        });

        broadcastPcList(); // Notify all browsers of the new agent
    });

    socket.on('disconnect', () => {
        // Find agent name by socket id and remove it
        for (const [name, agent] of connectedAgents.entries()) {
            if (agent.socket.id === socket.id) {
                console.log(`[MASTER] Agent disconnected: ${name}`);
                connectedAgents.delete(name);
                broadcastPcList(); // Notify all browsers that an agent has left
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
    console.log(`Master Proxy Server running on port ${PORT}`);
    console.log(`Access at: http://localhost:${PORT}`);
});
