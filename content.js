/**
 * content.js - DOM Automation for Meta AI Image-to-Video
 * 
 * Target URL: https://www.meta.ai/media
 * 
 * DOM SELECTORS (verified from user-provided page inspection):
 * 
 * Prompt Input:
 * - Selector: div[aria-label="Describe your image..."][contenteditable="true"]
 * - Type: Contenteditable div with Lexical editor
 * - Interaction: Set textContent and dispatch 'input' event
 * 
 * Add Media Button:
 * - Selector: div[aria-label="Add media"][role="button"]
 * - Triggers file upload dialog
 * 
 * Create Button:
 * - Selector: div[aria-label="Create"][role="button"]
 * - Triggers image/video generation
 * 
 * Send Button:
 * - Selector: div[aria-label="Send"][role="button"]
 * - Alternative submit (may be disabled until prompt entered)
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
    // Timing
    MIN_DELAY: 5000,        // 5 seconds minimum between items
    MAX_DELAY: 15000,       // 15 seconds maximum between items
    TIMEOUT: 120000,        // 2 minutes timeout per generation
    POLL_INTERVAL: 500,     // Check every 500ms for completion

    // DOM Selectors - Multiple fallbacks for each element
    SELECTORS: {
        // Multiple selectors for prompt input (tried in order)
        promptInputSelectors: [
            'div[contenteditable="true"][data-lexical-editor="true"]',
            'div[aria-label="Describe your image..."][contenteditable="true"]',
            'div[contenteditable="true"][role="textbox"]',
            '[contenteditable="true"][aria-placeholder]',
            'div[contenteditable="true"].notranslate',
            'textarea[placeholder*="Describe"]',
            'textarea[placeholder*="prompt"]',
            '[role="textbox"][contenteditable="true"]',
            'div[contenteditable="true"]'
        ],
        // Multiple selectors for Add Media button
        addMediaBtnSelectors: [
            'div[aria-label="Add media"][role="button"]',
            'div[aria-label="Add Media"][role="button"]',
            'button[aria-label="Add media"]',
            'button[aria-label="Add Media"]',
            '[aria-label*="media"][role="button"]',
            '[aria-label*="Media"][role="button"]',
            'input[type="file"][accept*="image"]'
        ],
        // Multiple selectors for Create button
        createBtnSelectors: [
            'div[aria-label="Create"][role="button"]',
            'button[aria-label="Create"]',
            'div[aria-label="Generate"][role="button"]',
            'button[aria-label="Generate"]',
            '[aria-label="Submit"][role="button"]'
        ],
        // Multiple selectors for Send button
        sendBtnSelectors: [
            'div[aria-label="Send"][role="button"]',
            'button[aria-label="Send"]',
            '[aria-label="Send message"][role="button"]'
        ],
        // Download button detection
        downloadBtn: 'a[download], div[aria-label="Download"][role="button"], button[aria-label="Download"], [aria-label*="download" i][role="button"]',
        // Loading indicator
        loadingSpinner: '[role="progressbar"], .loading, [aria-busy="true"], [data-loading="true"]'
    }
};

// ============================================================================
// STATE
// ============================================================================

let isRunning = false;
let shouldStop = false;
let currentObserver = null;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Wait for specified milliseconds
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get random delay between min and max
 */
function getRandomDelay() {
    return Math.floor(Math.random() * (CONFIG.MAX_DELAY - CONFIG.MIN_DELAY + 1)) + CONFIG.MIN_DELAY;
}

/**
 * Find element with retry
 */
async function findElement(selector, maxAttempts = 10, delay = 500) {
    for (let i = 0; i < maxAttempts; i++) {
        const element = document.querySelector(selector);
        if (element) return element;
        await sleep(delay);
    }
    return null;
}

/**
 * Find element from array of selectors (tries each in order with retry)
 */
async function findElementFromSelectors(selectors, maxAttempts = 10, delay = 500) {
    // First, try each selector immediately
    for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
            log(`Found element with selector: ${selector}`);
            return element;
        }
    }

    // If not found, retry with delays
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await sleep(delay);
        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element) {
                log(`Found element with selector: ${selector} (attempt ${attempt + 1})`);
                return element;
            }
        }
    }

    // Log which selectors were tried for debugging
    log(`Could not find element. Tried selectors: ${selectors.slice(0, 3).join(', ')}...`, 'error');
    return null;
}

/**
 * Convert base64 to File object
 */
function base64ToFile(base64Data, fileName, mimeType) {
    const arr = base64Data.split(',');
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], fileName, { type: mimeType });
}

/**
 * Send message to sidebar
 */
function sendToSidebar(message) {
    chrome.runtime.sendMessage(message);
}

/**
 * Log to console with prefix
 */
function log(message, type = 'info') {
    const prefix = '[Meta AI Automator]';
    if (type === 'error') {
        console.error(prefix, message);
    } else {
        console.log(prefix, message);
    }
}

// ============================================================================
// DOM INTERACTION FUNCTIONS
// ============================================================================

/**
 * Set text in the prompt input (contenteditable div)
 */
async function setPromptText(text) {
    const promptInput = await findElementFromSelectors(CONFIG.SELECTORS.promptInputSelectors);

    if (!promptInput) {
        throw new Error('Could not find prompt input');
    }

    // Clear existing content
    promptInput.textContent = '';

    // Focus the element
    promptInput.focus();

    // Set new content
    promptInput.textContent = text;

    // Dispatch input event for React/Lexical to pick up
    promptInput.dispatchEvent(new Event('input', { bubbles: true }));

    // Also try InputEvent for better compatibility
    promptInput.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: text
    }));

    log(`Set prompt: "${text.substring(0, 50)}..."`);
    await sleep(300);
}

/**
 * Upload image via the Add Media button
 */
async function uploadImage(imageData) {
    const addMediaBtn = await findElementFromSelectors(CONFIG.SELECTORS.addMediaBtnSelectors);

    if (!addMediaBtn) {
        throw new Error('Could not find Add Media button');
    }

    // Create file from base64 data
    const file = base64ToFile(imageData.data, imageData.name, imageData.type);

    // Create a hidden file input
    let fileInput = document.querySelector('input[type="file"][data-automator="true"]');
    if (!fileInput) {
        fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.style.display = 'none';
        fileInput.setAttribute('data-automator', 'true');
        document.body.appendChild(fileInput);
    }

    // Create DataTransfer to set files
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    fileInput.files = dataTransfer.files;

    // Click the Add Media button to open file dialog
    addMediaBtn.click();

    await sleep(500);

    // Look for the actual file input that Meta AI creates
    const metaFileInput = document.querySelector('input[type="file"][accept*="image"]');

    if (metaFileInput) {
        // Set files on the actual input
        metaFileInput.files = dataTransfer.files;

        // Dispatch change event
        metaFileInput.dispatchEvent(new Event('change', { bubbles: true }));

        log(`Uploaded image: ${imageData.name}`);
    } else {
        // Fallback: try drag and drop simulation
        log('File input not found, trying alternative upload method...');
        await simulateDragDrop(file);
    }

    // Wait for preview to load
    await sleep(1500);
}

/**
 * Simulate drag and drop for file upload
 */
async function simulateDragDrop(file) {
    const dropZone = document.querySelector('.x1n2onr6') || document.body;

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    // Dispatch dragenter
    const dragEnterEvent = new DragEvent('dragenter', {
        bubbles: true,
        cancelable: true,
        dataTransfer
    });
    dropZone.dispatchEvent(dragEnterEvent);

    await sleep(100);

    // Dispatch dragover
    const dragOverEvent = new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        dataTransfer
    });
    dropZone.dispatchEvent(dragOverEvent);

    await sleep(100);

    // Dispatch drop
    const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer
    });
    dropZone.dispatchEvent(dropEvent);

    log('Simulated drag and drop');
}

/**
 * Click the Create or Send button
 */
async function clickGenerate() {
    // Try Create button selectors first
    let btn = await findElementFromSelectors(CONFIG.SELECTORS.createBtnSelectors, 3);

    if (!btn) {
        // Fallback to Send button selectors
        btn = await findElementFromSelectors(CONFIG.SELECTORS.sendBtnSelectors, 3);
    }

    if (!btn) {
        throw new Error('Could not find Create or Send button');
    }

    // Check if button is disabled
    if (btn.getAttribute('aria-disabled') === 'true') {
        log('Button is disabled, waiting...');
        await sleep(1000);
    }

    btn.click();
    log('Clicked generate button');
}

/**
 * Wait for generation to complete
 * Uses MutationObserver to detect when download button appears
 */
function waitForCompletion() {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();

        // Set up interval to check for completion
        const checkInterval = setInterval(async () => {
            // Check for timeout
            if (Date.now() - startTime > CONFIG.TIMEOUT) {
                clearInterval(checkInterval);
                if (currentObserver) {
                    currentObserver.disconnect();
                    currentObserver = null;
                }
                reject(new Error('Generation timeout (2 minutes)'));
                return;
            }

            // Check for stop signal
            if (shouldStop) {
                clearInterval(checkInterval);
                if (currentObserver) {
                    currentObserver.disconnect();
                    currentObserver = null;
                }
                reject(new Error('Stopped by user'));
                return;
            }

            // Check for download button
            const downloadBtn = document.querySelector(CONFIG.SELECTORS.downloadBtn);
            if (downloadBtn) {
                clearInterval(checkInterval);
                if (currentObserver) {
                    currentObserver.disconnect();
                    currentObserver = null;
                }
                log('Generation complete - download button found');
                resolve(downloadBtn);
                return;
            }

            // Check if loading spinner disappeared
            const spinner = document.querySelector(CONFIG.SELECTORS.loadingSpinner);
            if (!spinner) {
                // Wait a bit more to ensure completion
                await sleep(1000);
                const downloadBtnAfterWait = document.querySelector(CONFIG.SELECTORS.downloadBtn);
                if (downloadBtnAfterWait) {
                    clearInterval(checkInterval);
                    if (currentObserver) {
                        currentObserver.disconnect();
                        currentObserver = null;
                    }
                    log('Generation complete - loading finished');
                    resolve(downloadBtnAfterWait);
                    return;
                }
            }
        }, CONFIG.POLL_INTERVAL);

        // Also set up MutationObserver for faster detection
        currentObserver = new MutationObserver((mutations) => {
            const downloadBtn = document.querySelector(CONFIG.SELECTORS.downloadBtn);
            if (downloadBtn) {
                clearInterval(checkInterval);
                currentObserver.disconnect();
                currentObserver = null;
                log('Generation complete - detected via observer');
                resolve(downloadBtn);
            }
        });

        currentObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    });
}

/**
 * Trigger download of the generated content
 */
async function triggerDownload(downloadBtn) {
    if (!downloadBtn) {
        log('No download button provided', 'error');
        return false;
    }

    downloadBtn.click();
    log('Triggered download');
    await sleep(1000);
    return true;
}

// ============================================================================
// MAIN AUTOMATION LOOP
// ============================================================================

/**
 * Process a single item (image + prompt)
 */
async function processItem(imageData, prompt, index, total) {
    log(`Processing item ${index + 1}/${total}`);

    sendToSidebar({
        type: 'PROGRESS_UPDATE',
        current: index + 1,
        total: total,
        status: 'Uploading image'
    });

    // Step 1: Upload image
    await uploadImage(imageData);

    // Step 2: Set prompt
    await setPromptText(prompt);

    // Step 3: Click generate
    await clickGenerate();

    sendToSidebar({
        type: 'PROGRESS_UPDATE',
        current: index + 1,
        total: total,
        status: 'Generating...'
    });

    // Step 4: Wait for completion
    const downloadBtn = await waitForCompletion();

    // Step 5: Download result
    if (downloadBtn) {
        await triggerDownload(downloadBtn);
    }

    sendToSidebar({
        type: 'ITEM_COMPLETE',
        index: index
    });

    // Update storage
    await chrome.storage.local.set({ currentIndex: index + 1 });
}

/**
 * Main automation runner
 */
async function runAutomation() {
    if (isRunning) {
        log('Automation already running');
        return;
    }

    isRunning = true;
    shouldStop = false;

    try {
        // Get queue from storage
        const state = await chrome.storage.local.get(['queue', 'prompts', 'currentIndex']);

        if (!state.queue || !state.prompts) {
            throw new Error('No queue found in storage');
        }

        const queue = state.queue;
        const prompts = state.prompts;
        const startIndex = state.currentIndex || 0;

        log(`Starting automation from index ${startIndex}, total items: ${queue.length}`);

        // Process each item sequentially
        for (let i = startIndex; i < queue.length; i++) {
            if (shouldStop) {
                log('Automation stopped by user');
                sendToSidebar({ type: 'AUTOMATION_STOPPED' });
                break;
            }

            try {
                await processItem(queue[i], prompts[i], i, queue.length);

                // Add random delay before next item (except for last item)
                if (i < queue.length - 1) {
                    const delay = getRandomDelay();
                    log(`Waiting ${delay / 1000} seconds before next item...`);

                    sendToSidebar({
                        type: 'PROGRESS_UPDATE',
                        current: i + 1,
                        total: queue.length,
                        status: `Waiting ${Math.round(delay / 1000)}s...`
                    });

                    await sleep(delay);
                }
            } catch (error) {
                log(`Error processing item ${i + 1}: ${error.message}`, 'error');
                sendToSidebar({
                    type: 'ITEM_ERROR',
                    index: i,
                    error: error.message
                });

                // Skip to next item
                await chrome.storage.local.set({ currentIndex: i + 1 });

                // Wait a bit before continuing
                await sleep(3000);
            }
        }

        // Automation complete
        if (!shouldStop) {
            log('Automation complete!');
            sendToSidebar({ type: 'AUTOMATION_COMPLETE' });
            await chrome.storage.local.set({ isRunning: false, currentIndex: 0 });
        }

    } catch (error) {
        log(`Automation error: ${error.message}`, 'error');
        sendToSidebar({
            type: 'ITEM_ERROR',
            index: -1,
            error: error.message
        });
    } finally {
        isRunning = false;
        shouldStop = false;
    }
}

/**
 * Stop the automation
 */
function stopAutomation() {
    log('Stop requested');
    shouldStop = true;

    if (currentObserver) {
        currentObserver.disconnect();
        currentObserver = null;
    }
}

// ============================================================================
// MESSAGE LISTENER
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        case 'START_AUTOMATION':
            runAutomation();
            sendResponse({ success: true });
            break;

        case 'STOP_AUTOMATION':
            stopAutomation();
            sendResponse({ success: true });
            break;

        default:
            sendResponse({ success: false, error: 'Unknown message type' });
    }

    return true; // Keep channel open for async response
});

// ============================================================================
// AUTO-RESUME ON PAGE LOAD
// ============================================================================

(async function checkAndResume() {
    const state = await chrome.storage.local.get(['isRunning', 'currentIndex']);

    if (state.isRunning && state.currentIndex > 0) {
        log('Detected interrupted automation, resuming...');
        await sleep(2000); // Wait for page to fully load
        runAutomation();
    }
})();

/**
 * Diagnostic function to help debug element detection
 */
async function runDiagnostics() {
    log('Running diagnostics...');

    // Check for prompt input elements
    log('Checking for prompt input elements:');
    for (const selector of CONFIG.SELECTORS.promptInputSelectors) {
        const el = document.querySelector(selector);
        if (el) {
            log(`  ✓ FOUND: ${selector}`);
        }
    }

    // Log all contenteditable elements
    const editables = document.querySelectorAll('[contenteditable="true"]');
    log(`Found ${editables.length} contenteditable element(s)`);
    editables.forEach((el, i) => {
        const attrs = [];
        if (el.getAttribute('aria-label')) attrs.push(`aria-label="${el.getAttribute('aria-label')}"`);
        if (el.getAttribute('role')) attrs.push(`role="${el.getAttribute('role')}"`);
        if (el.getAttribute('data-lexical-editor')) attrs.push('data-lexical-editor');
        if (el.className) attrs.push(`class="${el.className.substring(0, 50)}"`);
        log(`  [${i}] ${el.tagName} - ${attrs.join(', ')}`);
    });

    // Check for Add Media button
    log('Checking for Add Media button:');
    for (const selector of CONFIG.SELECTORS.addMediaBtnSelectors) {
        const el = document.querySelector(selector);
        if (el) {
            log(`  ✓ FOUND: ${selector}`);
        }
    }

    // Check for Create/Send buttons
    log('Checking for Create/Send buttons:');
    for (const selector of [...CONFIG.SELECTORS.createBtnSelectors, ...CONFIG.SELECTORS.sendBtnSelectors]) {
        const el = document.querySelector(selector);
        if (el) {
            log(`  ✓ FOUND: ${selector}`);
        }
    }
}

log('Content script loaded on ' + window.location.href);

// Run diagnostics after page fully loads
setTimeout(runDiagnostics, 2000);
