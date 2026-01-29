/**
 * sidebar.js - Handles sidebar UI interactions
 * 
 * Responsibilities:
 * - File selection and validation
 * - Prompt parsing
 * - Queue management via chrome.storage.local
 * - Communication with content script
 * - Progress display
 */

// DOM Elements
const imageInput = document.getElementById('imageInput');
const selectImagesBtn = document.getElementById('selectImagesBtn');
const promptsInput = document.getElementById('promptsInput');
const imageCount = document.getElementById('imageCount');
const promptCount = document.getElementById('promptCount');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const logContainer = document.getElementById('logContainer');

// State
let selectedFiles = [];
let isRunning = false;

/**
 * Initialize sidebar - load any existing queue state
 */
async function init() {
    // Load existing state from storage
    const state = await chrome.storage.local.get(['queue', 'currentIndex', 'isRunning', 'prompts']);

    if (state.isRunning) {
        isRunning = true;
        updateUIState();
        const total = state.prompts?.length || 0;
        const current = state.currentIndex || 0;
        updateProgress(current, total);
    }

    // Listen for messages from content script
    chrome.runtime.onMessage.addListener(handleMessage);

    // Load log from storage
    const logState = await chrome.storage.local.get(['logs']);
    if (logState.logs) {
        logState.logs.forEach(entry => addLogEntry(entry.message, entry.type, false));
    }
}

/**
 * Handle messages from content script
 */
function handleMessage(message, sender, sendResponse) {
    switch (message.type) {
        case 'PROGRESS_UPDATE':
            updateProgress(message.current, message.total);
            addLogEntry(`Processing ${message.current}/${message.total}: ${message.status}`);
            break;

        case 'ITEM_COMPLETE':
            addLogEntry(`✓ Completed item ${message.index + 1}`, 'success');
            break;

        case 'ITEM_ERROR':
            addLogEntry(`✗ Error on item ${message.index + 1}: ${message.error}`, 'error');
            break;

        case 'AUTOMATION_COMPLETE':
            isRunning = false;
            updateUIState();
            addLogEntry('✓ Automation complete!', 'success');
            progressText.textContent = 'Complete';
            break;

        case 'AUTOMATION_STOPPED':
            isRunning = false;
            updateUIState();
            addLogEntry('⏹ Automation stopped', 'error');
            progressText.textContent = 'Stopped';
            break;
    }
}

/**
 * Trigger file picker
 */
selectImagesBtn.addEventListener('click', () => {
    imageInput.click();
});

/**
 * Handle file selection
 */
imageInput.addEventListener('change', (e) => {
    selectedFiles = Array.from(e.target.files);
    const count = selectedFiles.length;
    imageCount.textContent = `${count} image${count !== 1 ? 's' : ''} selected`;

    // Log selected files
    if (count > 0) {
        addLogEntry(`Selected ${count} images`);
    }
});

/**
 * Handle prompt input changes
 */
promptsInput.addEventListener('input', () => {
    const prompts = getPrompts();
    promptCount.textContent = `${prompts.length} prompt${prompts.length !== 1 ? 's' : ''}`;
});

/**
 * Parse prompts from textarea
 */
function getPrompts() {
    return promptsInput.value
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
}

/**
 * Convert File to base64 for storage
 */
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ name: file.name, type: file.type, data: reader.result });
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

/**
 * Start automation
 */
startBtn.addEventListener('click', async () => {
    const prompts = getPrompts();

    // Validation
    if (selectedFiles.length === 0) {
        addLogEntry('Error: No images selected', 'error');
        return;
    }

    if (prompts.length === 0) {
        addLogEntry('Error: No prompts entered', 'error');
        return;
    }

    if (selectedFiles.length !== prompts.length) {
        addLogEntry(`Error: Image count (${selectedFiles.length}) != prompt count (${prompts.length})`, 'error');
        return;
    }

    // Convert files to base64 for storage
    addLogEntry('Preparing images...');
    const imagesData = await Promise.all(selectedFiles.map(fileToBase64));

    // Save queue to storage
    await chrome.storage.local.set({
        queue: imagesData,
        prompts: prompts,
        currentIndex: 0,
        isRunning: true,
        logs: []
    });

    isRunning = true;
    updateUIState();
    updateProgress(0, prompts.length);
    addLogEntry('Starting automation...');

    // Send start command to content script
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.url?.includes('meta.ai/media')) {
        addLogEntry('Error: Please navigate to https://www.meta.ai/media', 'error');
        isRunning = false;
        await chrome.storage.local.set({ isRunning: false });
        updateUIState();
        return;
    }

    // Send message with error handling
    try {
        await chrome.tabs.sendMessage(tab.id, { type: 'START_AUTOMATION' });
    } catch (error) {
        // Content script may not be loaded, inject it first
        addLogEntry('Injecting content script...', 'info');
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['content.js']
            });
            // Wait a moment for the script to initialize
            await new Promise(resolve => setTimeout(resolve, 500));
            // Retry sending the message
            await chrome.tabs.sendMessage(tab.id, { type: 'START_AUTOMATION' });
        } catch (injectError) {
            addLogEntry('Error: Could not start automation. Please refresh the page.', 'error');
            isRunning = false;
            await chrome.storage.local.set({ isRunning: false });
            updateUIState();
        }
    }
});

/**
 * Stop automation
 */
stopBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab) {
        try {
            await chrome.tabs.sendMessage(tab.id, { type: 'STOP_AUTOMATION' });
        } catch (error) {
            // Content script may not be available, just update local state
            console.log('Could not reach content script, updating local state only');
        }
    }

    await chrome.storage.local.set({ isRunning: false });
    isRunning = false;
    updateUIState();
    addLogEntry('Stopping automation...');
});

/**
 * Update UI based on running state
 */
function updateUIState() {
    startBtn.disabled = isRunning;
    stopBtn.disabled = !isRunning;
    selectImagesBtn.disabled = isRunning;
    promptsInput.disabled = isRunning;
}

/**
 * Update progress bar and text
 */
function updateProgress(current, total) {
    const percent = total > 0 ? (current / total) * 100 : 0;
    progressBar.style.width = `${percent}%`;
    progressText.textContent = `Processing ${current}/${total}`;
}

/**
 * Add entry to activity log
 */
function addLogEntry(message, type = 'info', save = true) {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;

    const time = new Date().toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    entry.innerHTML = `<span class="time">[${time}]</span> ${message}`;
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;

    // Save to storage for persistence
    if (save) {
        chrome.storage.local.get(['logs'], (result) => {
            const logs = result.logs || [];
            logs.push({ time, message, type });
            // Keep only last 50 entries
            if (logs.length > 50) logs.shift();
            chrome.storage.local.set({ logs });
        });
    }
}

// Initialize
init();
