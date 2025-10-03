// DOM Element References
const terminalElement = document.getElementById('terminal');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const terminalSize = document.getElementById('terminalSize');
const terminalTitle = document.getElementById('terminalTitle');
const pcSelector = document.getElementById('pc-selector');
const closeBtn = document.getElementById('close-btn');

// Terminal and Addon Instances
let term = null;
let fitAddon = null;

// The single, persistent Socket.IO connection to the master server's '/web-clients' namespace
const masterSocket = io('/web-clients');

/**
 * Initializes the xterm.js terminal instance and its addons.
 * This function is called once when the DOM is fully loaded.
 */
function initializeTerminal() {
    term = new Terminal({
        cursorBlink: true,
        fontFamily: '"Fira Code", Menlo, "DejaVu Sans Mono", "Lucida Console", monospace',
        fontSize: 14,
        theme: {
            background: '#1e1e1e',
            foreground: '#d4d4d4',
            cursor: '#007acc',
            selection: 'rgba(255, 255, 255, 0.3)',
        }
    });

    // Load the 'fit' addon to make the terminal responsive
    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);

    // Attach the terminal to the designated DOM element
    term.open(terminalElement);

    // Fit the terminal to its container size
    fitAddon.fit();
    updateTerminalSize();

    // Event handler for user input (e.g., typing)
    // The data is sent to the master server to be relayed to the agent.
    term.onData(data => masterSocket.emit('terminal-input', data));

    // Event handler for terminal resize events
    // The new dimensions are sent to the master server.
    term.onResize(size => {
        masterSocket.emit('terminal-resize', { cols: size.cols, rows: size.rows });
        updateTerminalSize();
    });

    // Add a window resize listener to refit the terminal automatically.
    window.addEventListener('resize', () => fitAddon.fit());
}

/**
 * Updates the terminal size display in the footer.
 */
function updateTerminalSize() {
    if (term) {
        terminalSize.textContent = `${term.cols}x${term.rows}`;
    }
}

/**
 * Initiates a connection request to a selected PC (agent).
 * @param {object} pc - An object containing the name of the PC to connect to.
 */
function connectToPC(pc) {
    // Clear the terminal and display a connection message.
    term.clear();
    term.write(`\x1b[33mRequesting new terminal session on ${pc.name}...\x1b[0m\r\n`);
    masterSocket.emit('select-pc', pc.name);
}

/**
 * Dynamically creates and populates the PC selection buttons in the sidebar.
 * @param {Array<object>} pcs - An array of PC objects, each with a 'name' property.
 */
function populatePCSelector(pcs) {
    pcSelector.innerHTML = ''; // Clear any existing buttons
    if (pcs.length === 0) {
        pcSelector.innerHTML = '<p class="no-agents-msg">No agents connected.</p>';
        return;
    }

    pcs.forEach(pc => {
        const button = document.createElement('button');
        button.className = 'command-btn';
        button.textContent = pc.name;
        button.onclick = () => {
            // Initiate connection on button click
            connectToPC(pc);
            // Visually mark the selected button as active
            document.querySelectorAll('#pc-selector .command-btn').forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
        };
        pcSelector.appendChild(button);
    });
}

/**
 * Resets the UI to its disconnected/default state.
 */
function resetUI() {
    statusDot.classList.remove('connected');
    statusText.textContent = 'Disconnected';
    terminalTitle.textContent = 'Select a PC to begin';
    document.querySelectorAll('#pc-selector .command-btn').forEach(btn => btn.classList.remove('active'));
    term.clear();
    term.write('\x1b[31mSession closed.\x1b[0m\r\nSelect a PC to start a new session.');
}

// --- Socket.IO Event Listeners for the Master Connection ---

masterSocket.on('connect', () => {
    console.log('Successfully connected to master server.');
});

// Event: 'update-pc-list' - Received from master when agents connect/disconnect.
masterSocket.on('update-pc-list', (pcs) => {
    console.log('Received updated PC list:', pcs);
    populatePCSelector(pcs);
});

// Event: 'pc-selected-ack' - Master confirms the agent has been selected.
masterSocket.on('pc-selected-ack', (pc) => {
    statusDot.classList.add('connected');
    statusText.textContent = `Connected to ${pc.name}`;
    terminalTitle.textContent = `user@${pc.name}: ~`;
    fitAddon.fit(); // Refit terminal for the new session
});

// Event: 'terminal-output' - Master relays terminal output from the agent.
masterSocket.on('terminal-output', (data) => {
    term.write(data);
});

// Event: 'pc-select-error' - Master reports an error (e.g., agent not found).
masterSocket.on('pc-select-error', (errorMsg) => {
    term.write(`\r\n\x1b[31mError: ${errorMsg}\x1b[0m\r\n`);
    statusDot.classList.remove('connected');
    statusText.textContent = 'Connection Failed';
});

// Event: 'close-terminal-ack' - Master confirms the session has been closed.
masterSocket.on('close-terminal-ack', () => {
    resetUI();
});

masterSocket.on('disconnect', () => {
    console.log('Disconnected from master server.');
    resetUI();
    term.write('\r\n\x1b[1;31mConnection to master server lost. Attempting to reconnect...\x1b[0m\r\n');
});

// --- DOM Event Listeners ---

// Initialize the terminal once the page content has fully loaded.
document.addEventListener('DOMContentLoaded', () => {
    initializeTerminal();

    // Add click listener for the close button.
    closeBtn.addEventListener('click', () => {
        masterSocket.emit('close-terminal');
    });
});
