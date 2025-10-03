const terminalElement = document.getElementById('terminal');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const terminalSize = document.getElementById('terminalSize');
const terminalTitle = document.getElementById('terminalTitle');
const pcSelector = document.getElementById('pc-selector');

let term = null;
let fitAddon = null;

// The single, persistent connection to the master server
const masterSocket = io('/web-clients');

function initializeTerminal() {
    term = new Terminal({
        cursorBlink: true,
        fontFamily: '"Fira Code", Menlo, "DejaVu Sans Mono", "Lucida Console", monospace',
        fontSize: 14,
        theme: { background: '#1e1e1e', foreground: '#d4d4d4', cursor: '#007acc' }
    });
    
    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalElement);
    
    fitAddon.fit();
    updateTerminalSize();

    // Send terminal input to the master server
    term.onData(data => masterSocket.emit('terminal-input', data));

    // Send resize events to the master server
    term.onResize(size => {
        masterSocket.emit('terminal-resize', { cols: size.cols, rows: size.rows });
        updateTerminalSize();
    });

    window.addEventListener('resize', () => fitAddon.fit());
}

function updateTerminalSize() {
    if (term) {
        terminalSize.textContent = `${term.cols}x${term.rows}`;
    }
}

function connectToPC(pc) {
    term.clear();
    term.write(`\x1b[33mRequesting connection to ${pc.name} via master...\x1b[0m\r\n`);
    masterSocket.emit('select-pc', pc.name);
}

function populatePCSelector(pcs) {
    pcSelector.innerHTML = ''; // Clear existing buttons
    if (pcs.length === 0) {
        pcSelector.innerHTML = '<p style="color: var(--text-secondary); font-size: 13px;">No agents connected.</p>';
        return;
    }

    pcs.forEach(pc => {
        const button = document.createElement('button');
        button.className = 'command-btn';
        button.textContent = pc.name;
        button.onclick = () => {
            connectToPC(pc);
            document.querySelectorAll('#pc-selector .command-btn').forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
        };
        pcSelector.appendChild(button);
    });
}

// --- Socket.IO Event Listeners for the Master Connection ---

masterSocket.on('connect', () => {
    console.log('Connected to master server.');
});

masterSocket.on('update-pc-list', (pcs) => {
    console.log('Received updated PC list:', pcs);
    populatePCSelector(pcs);
});

// Master confirms that the agent has been selected
masterSocket.on('pc-selected-ack', (pc) => {
    statusDot.classList.add('connected');
    statusText.textContent = `Connected to ${pc.name}`;
    terminalTitle.textContent = `user@${pc.name}: ~`;
    fitAddon.fit(); // Refit terminal for the new session
});

// Master sends terminal output from the agent
masterSocket.on('terminal-output', (data) => {
    term.write(data);
});

masterSocket.on('pc-select-error', (errorMsg) => {
    term.write(`\r\n\x1b[31mError: ${errorMsg}\x1b[0m\r\n`);
    statusDot.classList.remove('connected');
    statusText.textContent = 'Connection Failed';
});

masterSocket.on('disconnect', () => {
    console.log('Disconnected from master server.');
    statusDot.classList.remove('connected');
    statusText.textContent = 'Disconnected';
    terminalTitle.textContent = 'Connection Lost';
    term.write('\r\n\x1b[31mDisconnected from master server.\x1b[0m\r\n');
});


document.addEventListener('DOMContentLoaded', () => {
    initializeTerminal();
});
