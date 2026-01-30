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
    BUTTON_ENABLE_TIMEOUT: 60000,  // 60 seconds max wait for button to enable
    BUTTON_CHECK_INTERVAL: 300,    // Check every 300ms for button state

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
        // Multiple selectors for Send/Animate button (primary selector based on dev tools)
        sendBtnSelectors: [
            'div[role="button"][aria-label="Send"]',
            'div[aria-label="Send"][role="button"]',
            '.x1ed109x.x1n2onr6.xh8yej3 div[role="button"][aria-label="Send"]',
            'button[aria-label="Send"]',
            '[aria-label="Send message"][role="button"]'
        ],
        // Mode toggle (Image/Video) selectors
        modeToggleSelectors: [
            'div[role="button"][aria-label="Image"]',
            'div[role="button"][aria-label="Video"]',
            'div#_r_7d_[role="button"]'
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
 * Convert base64 data URL to Blob
 */
function base64ToBlob(base64Data, mimeType) {
    const parts = base64Data.split(',');
    const byteString = atob(parts[1]);
    const arrayBuffer = new ArrayBuffer(byteString.length);
    const uint8Array = new Uint8Array(arrayBuffer);

    for (let i = 0; i < byteString.length; i++) {
        uint8Array[i] = byteString.charCodeAt(i);
    }

    return new Blob([uint8Array], { type: mimeType });
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
 * Upload image via clipboard paste into the prompt input
 * This bypasses the need for file dialog which requires user activation
 */
async function uploadImage(imageData) {
    log(`Starting image upload for: ${imageData.name}`);

    // Find the prompt input (contenteditable div)
    const promptInput = await findElementFromSelectors(CONFIG.SELECTORS.promptInputSelectors);

    if (!promptInput) {
        throw new Error('Could not find prompt input for image paste');
    }

    // Focus the input first
    promptInput.focus();
    await sleep(300);

    // Convert base64 to blob
    const blob = base64ToBlob(imageData.data, imageData.type);

    // Create a File from the blob
    const file = new File([blob], imageData.name, { type: imageData.type });

    // Create DataTransfer with the file
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    // Method 1: Try direct paste event with DataTransfer (skipping Clipboard API to avoid focus errors)
    try {
        log('Using direct paste event method...');
        promptInput.focus();
        await sleep(100);

        // Create a custom paste event with file data
        const customPasteEvent = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(customPasteEvent, 'clipboardData', {
            value: {
                files: dataTransfer.files,
                items: dataTransfer.items,
                types: ['Files'],
                getData: () => ''
            }
        });

        promptInput.dispatchEvent(customPasteEvent);
        log('Dispatched paste event');

        await sleep(1500);

        // Check if upload was successful
        if (await waitForImagePreview()) {
            log(`Successfully uploaded image via paste: ${imageData.name}`);
            return;
        }
    } catch (e) {
        log(`Paste event failed: ${e.message}`, 'error');
    }

    // Method 2: Try beforeinput event with DataTransfer
    try {
        log('Trying beforeinput event method...');
        promptInput.focus();
        await sleep(100);

        // Create a more comprehensive paste event
        const inputEvent = new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertFromPaste',
            dataTransfer: dataTransfer
        });
        promptInput.dispatchEvent(inputEvent);

        await sleep(1500);

        if (await waitForImagePreview()) {
            log(`Successfully uploaded image via beforeinput: ${imageData.name}`);
            return;
        }
    } catch (e) {
        log(`Beforeinput event failed: ${e.message}`, 'error');
    }

    // Method 3: Try drag and drop on the prompt input itself
    try {
        log('Trying drag and drop on prompt input...');
        await simulateDragDropOnElement(promptInput, file);
        await sleep(2000);

        if (await waitForImagePreview()) {
            log(`Successfully uploaded image via drag-drop: ${imageData.name}`);
            return;
        }
    } catch (e) {
        log(`Drag drop on input failed: ${e.message}`, 'error');
    }

    // Method 4: Try clicking Add Media and looking for hidden input
    log('Trying Add Media button method as last resort...');
    const addMediaBtn = await findElementFromSelectors(CONFIG.SELECTORS.addMediaBtnSelectors, 3);

    if (addMediaBtn) {
        // Look for any file inputs that might already exist
        const existingInputs = document.querySelectorAll('input[type="file"]');

        for (const input of existingInputs) {
            try {
                input.files = dataTransfer.files;
                input.dispatchEvent(new Event('change', { bubbles: true }));
                await sleep(1000);

                if (await waitForImagePreview(1000)) {
                    log(`Uploaded via existing input: ${imageData.name}`);
                    return;
                }
            } catch (e) {
                // continue to next input
            }
        }
    }

    log('All upload methods attempted - proceeding with generation', 'error');
}

/**
 * Wait for image preview to appear (indicates successful upload)
 */
async function waitForImagePreview(timeout = 3000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
        // Look for common image preview indicators
        const previewSelectors = [
            'img[src*="blob:"]',
            'img[src*="data:image"]',
            '[aria-label*="preview" i]',
            '[aria-label*="Remove" i][role="button"]',  // Remove button appears when image is uploaded
            '[aria-label*="image" i][role="img"]',
            '.image-preview',
            '[data-testid*="image"]',
            'div[style*="background-image"]'
        ];

        for (const selector of previewSelectors) {
            const preview = document.querySelector(selector);
            if (preview) {
                log('Image preview detected');
                return true;
            }
        }

        await sleep(200);
    }

    return false;
}

/**
 * Simulate drag and drop specifically on an element
 */
async function simulateDragDropOnElement(element, file) {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    Object.defineProperty(dataTransfer, 'dropEffect', { value: 'copy', writable: true });
    Object.defineProperty(dataTransfer, 'effectAllowed', { value: 'all', writable: true });

    // Dispatch drag events on the specific element
    element.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer }));
    await sleep(50);

    element.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
    await sleep(50);

    element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));

    log('Drag-drop dispatched on element');
}

/**
 * Simulate drag and drop for file upload
 * Enhanced to find proper drop zones on Meta AI
 */
async function simulateDragDrop(file) {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    // Set proper drop effect
    Object.defineProperty(dataTransfer, 'dropEffect', {
        value: 'copy',
        writable: true
    });
    Object.defineProperty(dataTransfer, 'effectAllowed', {
        value: 'all',
        writable: true
    });

    // Try to find the best drop zone - look for common container patterns
    const dropZoneSelectors = [
        '[aria-label*="media" i]',
        '[aria-label*="upload" i]',
        '[role="main"]',
        '.x1n2onr6',
        '[data-testid*="composer"]',
        '[contenteditable="true"]',
        'main',
        '#root',
        'body'
    ];

    let dropZone = null;
    for (const selector of dropZoneSelectors) {
        dropZone = document.querySelector(selector);
        if (dropZone) {
            log(`Using drop zone: ${selector}`);
            break;
        }
    }

    dropZone = dropZone || document.body;

    // Dispatch dragenter
    dropZone.dispatchEvent(new DragEvent('dragenter', {
        bubbles: true,
        cancelable: true,
        dataTransfer
    }));

    await sleep(100);

    // Dispatch dragover multiple times (some sites need this)
    for (let i = 0; i < 3; i++) {
        dropZone.dispatchEvent(new DragEvent('dragover', {
            bubbles: true,
            cancelable: true,
            dataTransfer
        }));
        await sleep(50);
    }

    await sleep(100);

    // Dispatch drop
    dropZone.dispatchEvent(new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer
    }));

    // Also dispatch dragleave for cleanup
    dropZone.dispatchEvent(new DragEvent('dragleave', {
        bubbles: true,
        cancelable: true,
        dataTransfer
    }));

    log('Simulated drag and drop');
}

/**
 * Find the Send/Animate button element
 */
function findSendButton() {
    // Primary selector based on dev tools analysis
    let btn = document.querySelector('div[role="button"][aria-label="Send"]');
    if (btn) return btn;

    // Try other selectors
    for (const selector of CONFIG.SELECTORS.sendBtnSelectors) {
        btn = document.querySelector(selector);
        if (btn) return btn;
    }

    return null;
}

// ============================================================================
// MODE DETECTION FUNCTIONS (Image/Video Toggle)
// ============================================================================

/**
 * Get the current mode (Image or Video) from the toggle button
 * @returns {Promise<'Image'|'Video'|null>} Current mode or null if not found
 */
async function getCurrentMode() {
    // Look for the mode toggle button by checking both possible states
    const imageBtn = document.querySelector('div[role="button"][aria-label="Image"]');
    if (imageBtn) return 'Image';

    const videoBtn = document.querySelector('div[role="button"][aria-label="Video"]');
    if (videoBtn) return 'Video';

    // Fallback: try the dynamic ID selector
    const dynamicBtn = document.querySelector('div#_r_7d_[role="button"]');
    if (dynamicBtn) {
        return dynamicBtn.getAttribute('aria-label');
    }

    return null;
}

/**
 * Find the Video option in the dropdown menu after clicking the mode toggle
 * @returns {Promise<Element|null>} Video option element or null
 */
async function findVideoOption() {
    // Wait a moment for dropdown to appear
    await sleep(300);

    // Look for any menu item containing "Video" text
    const allMenuItems = document.querySelectorAll('[role="menuitem"], [role="option"], [role="menu"] div[role="button"]');
    for (const item of allMenuItems) {
        const text = item.textContent || item.innerText || '';
        if (text.trim() === 'Video' || item.getAttribute('aria-label') === 'Video') {
            log('Found Video option in dropdown');
            return item;
        }
    }

    // Fallback: look for aria-label
    const fallback = document.querySelector('[aria-label="Video"][role="menuitem"]') ||
        document.querySelector('[aria-label="Video"][role="option"]');
    if (fallback) {
        log('Found Video option via fallback selector');
        return fallback;
    }

    return null;
}

/**
 * Ensure the Meta AI is in Video mode before pasting images
 * If currently in Image mode, switch to Video mode
 * @returns {Promise<boolean>} true if now in Video mode, false if failed
 */
async function ensureVideoMode() {
    log('Checking current mode (Image/Video)...');

    const currentMode = await getCurrentMode();
    log(`Current mode detected: ${currentMode}`);

    if (currentMode === 'Video') {
        log('✓ Already in Video mode');
        return true;
    }

    if (currentMode === 'Image') {
        log('Currently in Image mode, switching to Video...');

        // Click the mode toggle button to open dropdown
        const modeButton = document.querySelector('div[role="button"][aria-label="Image"]');
        if (!modeButton) {
            log('Could not find Image mode toggle button', 'error');
            return false;
        }

        modeButton.click();
        log('Clicked mode toggle button, waiting for dropdown...');
        await sleep(500);

        // Look for Video option in the dropdown
        const videoOption = await findVideoOption();
        if (!videoOption) {
            log('Could not find Video option in dropdown', 'error');
            // Try pressing Escape to close dropdown
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            return false;
        }

        videoOption.click();
        log('Clicked Video option');
        await sleep(500);

        // Verify the switch was successful
        const newMode = await getCurrentMode();
        if (newMode === 'Video') {
            log('✓ Successfully switched to Video mode');
            return true;
        } else {
            log(`Failed to switch to Video mode (current: ${newMode})`, 'error');
            return false;
        }
    }

    log(`Unknown or missing mode state: ${currentMode}`, 'error');
    return false;
}

/**
 * Check if the Send/Animate button is enabled (glowing/active)
 * The button is enabled when aria-disabled is NOT 'true'
 */
function isSendButtonEnabled(btn) {
    if (!btn) return false;
    const disabled = btn.getAttribute('aria-disabled');
    return disabled !== 'true';
}

/**
 * Wait for the Send/Animate button to become enabled (glowing)
 * Uses MutationObserver to detect when aria-disabled changes from 'true' to 'false'
 */
function waitForSendButtonEnabled() {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();

        // First check if button is already enabled
        const btn = findSendButton();
        if (btn && isSendButtonEnabled(btn)) {
            log('Send button is already enabled!');
            resolve(btn);
            return;
        }

        log('Waiting for Send button to become enabled (image upload processing)...');

        // Set up interval to check for button state
        const checkInterval = setInterval(() => {
            // Check for timeout
            if (Date.now() - startTime > CONFIG.BUTTON_ENABLE_TIMEOUT) {
                clearInterval(checkInterval);
                if (buttonObserver) {
                    buttonObserver.disconnect();
                }
                reject(new Error('Timeout waiting for Send button to enable (image upload may have failed)'));
                return;
            }

            // Check for stop signal
            if (shouldStop) {
                clearInterval(checkInterval);
                if (buttonObserver) {
                    buttonObserver.disconnect();
                }
                reject(new Error('Stopped by user'));
                return;
            }

            // Check button state
            const currentBtn = findSendButton();
            if (currentBtn && isSendButtonEnabled(currentBtn)) {
                clearInterval(checkInterval);
                if (buttonObserver) {
                    buttonObserver.disconnect();
                }
                log('Send button is now enabled! (aria-disabled changed)');
                resolve(currentBtn);
                return;
            }
        }, CONFIG.BUTTON_CHECK_INTERVAL);

        // Also use MutationObserver for faster detection
        let buttonObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                // Check if aria-disabled attribute changed
                if (mutation.type === 'attributes' && mutation.attributeName === 'aria-disabled') {
                    const currentBtn = findSendButton();
                    if (currentBtn && isSendButtonEnabled(currentBtn)) {
                        clearInterval(checkInterval);
                        buttonObserver.disconnect();
                        log('Send button enabled detected via MutationObserver!');
                        resolve(currentBtn);
                        return;
                    }
                }

                // Also check for any DOM changes that might add the enabled button
                if (mutation.type === 'childList') {
                    const currentBtn = findSendButton();
                    if (currentBtn && isSendButtonEnabled(currentBtn)) {
                        clearInterval(checkInterval);
                        buttonObserver.disconnect();
                        log('Send button enabled detected via DOM change!');
                        resolve(currentBtn);
                        return;
                    }
                }
            }
        });

        // Observe the document for attribute changes and child list changes
        buttonObserver.observe(document.body, {
            attributes: true,
            attributeFilter: ['aria-disabled'],
            childList: true,
            subtree: true
        });
    });
}

/**
 * Click the Send/Animate button
 * ONLY targets the Send button with aria-label="Send"
 * Waits for button to become enabled (glowing) before clicking
 */
async function clickAnimateButton() {
    log('Looking for Send/Animate button...');

    // ONLY use the Send button - do NOT use Create button
    // Wait for Send button to become enabled (glowing) after image upload
    log('Waiting for Send button to become enabled (image upload processing)...');

    sendToSidebar({
        type: 'PROGRESS_UPDATE',
        current: -1,
        total: -1,
        status: 'Waiting for button to glow...'
    });

    const btn = await waitForSendButtonEnabled();

    if (!btn) {
        throw new Error('Could not find Send/Animate button or it never became enabled');
    }

    // Double-check button is enabled before clicking
    if (btn.getAttribute('aria-disabled') === 'true') {
        log('Button still shows disabled, waiting more...');
        await waitForSendButtonEnabled();
    }

    // Small delay to ensure UI is fully ready
    await sleep(500);

    // Log button state before clicking
    const ariaDisabled = btn.getAttribute('aria-disabled');
    log(`Send button aria-disabled = "${ariaDisabled}" - clicking now!`);

    // Click the button
    btn.click();
    log('✓ Clicked Send/Animate button!');

    // Wait a moment for the click to register
    await sleep(500);

    return btn;
}

/**
 * Wait for video generation to complete
 * 
 * Strategy: After clicking Send button, the button becomes disabled again.
 * We wait for the generation to finish by:
 * 1. Detecting when the Send button becomes disabled (generation started)
 * 2. Then waiting a fixed time for generation (since we can't reliably detect completion)
 * 3. Or watching for new video elements to appear
 */
async function waitForGenerationComplete() {
    log('Waiting for video generation to complete...');

    const startTime = Date.now();

    // First, verify the Send button is now disabled (generation started)
    await sleep(1000);
    const sendBtn = findSendButton();
    if (sendBtn) {
        const isDisabled = sendBtn.getAttribute('aria-disabled') === 'true';
        log(`Send button is now disabled: ${isDisabled} (generation should be in progress)`);
    }

    // Count existing video elements before we started
    const initialVideoCount = document.querySelectorAll('video').length;
    log(`Initial video count on page: ${initialVideoCount}`);

    // Wait for either:
    // 1. A new video element to appear
    // 2. Or timeout
    return new Promise((resolve, reject) => {
        const checkInterval = setInterval(() => {
            // Check for timeout
            if (Date.now() - startTime > CONFIG.TIMEOUT) {
                clearInterval(checkInterval);
                if (currentObserver) {
                    currentObserver.disconnect();
                    currentObserver = null;
                }
                log('Generation timeout - proceeding to next item');
                resolve(null); // Don't reject, just move on
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

            // Check if a new video appeared
            const currentVideoCount = document.querySelectorAll('video').length;
            if (currentVideoCount > initialVideoCount) {
                clearInterval(checkInterval);
                if (currentObserver) {
                    currentObserver.disconnect();
                    currentObserver = null;
                }
                log(`✓ New video detected! (${initialVideoCount} -> ${currentVideoCount})`);

                // Wait a bit for video to fully load
                setTimeout(() => resolve(true), 2000);
                return;
            }

            // Also check if the Send button becomes enabled again (might indicate completion or error)
            const currentSendBtn = findSendButton();
            if (currentSendBtn && !isSendButtonEnabled(currentSendBtn)) {
                // Still generating...
            } else if (currentSendBtn && isSendButtonEnabled(currentSendBtn) && Date.now() - startTime > 3000) {
                // Button became enabled again after at least 3 seconds - generation might be done
                clearInterval(checkInterval);
                if (currentObserver) {
                    currentObserver.disconnect();
                    currentObserver = null;
                }
                log('Send button enabled again - generation may be complete');
                resolve(true);
                return;
            }
        }, CONFIG.POLL_INTERVAL);

        // MutationObserver to detect new video elements faster
        currentObserver = new MutationObserver((mutations) => {
            const currentVideoCount = document.querySelectorAll('video').length;
            if (currentVideoCount > initialVideoCount) {
                clearInterval(checkInterval);
                currentObserver.disconnect();
                currentObserver = null;
                log(`✓ New video detected via observer! (${initialVideoCount} -> ${currentVideoCount})`);
                setTimeout(() => resolve(true), 2000);
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
 * 
 * Flow:
 * 1. Upload image (via clipboard paste)
 * 2. Set prompt text
 * 3. Wait for Send/Animate button to become enabled (glowing)
 * 4. Click the Send/Animate button
 * 5. Wait for video generation to complete
 * 6. Move to next item
 */
async function processItem(imageData, prompt, index, total) {
    log(`\n========================================`);
    log(`Processing item ${index + 1}/${total}`);
    log(`Image: ${imageData.name}`);
    log(`Prompt: ${prompt.substring(0, 50)}...`);
    log(`========================================\n`);

    // Step 0: Ensure we're in Video mode (not Image mode)
    sendToSidebar({
        type: 'PROGRESS_UPDATE',
        current: index + 1,
        total: total,
        status: 'Checking mode...'
    });

    log('Step 0: Ensuring Video mode is active...');
    const modeOk = await ensureVideoMode();
    if (!modeOk) {
        log('Warning: Could not verify Video mode, proceeding anyway...', 'error');
    }

    sendToSidebar({
        type: 'PROGRESS_UPDATE',
        current: index + 1,
        total: total,
        status: 'Uploading image...'
    });

    // Step 1: Upload image
    log('Step 1: Uploading image...');
    await uploadImage(imageData);
    log('✓ Image upload initiated');

    // Step 2: Set prompt (optional - some users may not want prompt)
    if (prompt && prompt.trim().length > 0) {
        log('Step 2: Setting prompt text...');
        await setPromptText(prompt);
        log('✓ Prompt set');
    }

    // Step 3: Wait for Send button to glow and click it
    log('Step 3: Waiting for Send/Animate button to become enabled...');
    sendToSidebar({
        type: 'PROGRESS_UPDATE',
        current: index + 1,
        total: total,
        status: 'Waiting for button to activate...'
    });

    await clickAnimateButton();
    log('✓ Animate button clicked');

    // Step 4: Wait for generation to complete
    log('Step 4: Waiting for video generation...');
    sendToSidebar({
        type: 'PROGRESS_UPDATE',
        current: index + 1,
        total: total,
        status: 'Generating video...'
    });

    await waitForGenerationComplete();
    log('✓ Generation complete (or timed out)');

    // Mark item complete
    sendToSidebar({
        type: 'ITEM_COMPLETE',
        index: index
    });

    log(`✓ Item ${index + 1}/${total} completed!\n`);

    // Update storage
    await chrome.storage.local.set({ currentIndex: index + 1 });
}

/**
 * Request image data from sidebar on-demand (lazy loading)
 * This prevents memory exhaustion when handling 30+ images
 */
async function requestImageData(index) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
            { type: 'GET_IMAGE_DATA', index: index },
            (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error('Could not get image from sidebar: ' + chrome.runtime.lastError.message));
                } else if (response && response.success) {
                    resolve(response.imageData);
                } else {
                    reject(new Error(response?.error || 'Failed to get image data'));
                }
            }
        );
    });
}

/**
 * Main automation runner - uses lazy loading for images
 * Images are fetched one-at-a-time from sidebar to prevent memory exhaustion
 */
async function runAutomation() {
    if (isRunning) {
        log('Automation already running');
        return;
    }

    isRunning = true;
    shouldStop = false;

    try {
        // Get queue metadata from storage (NOT full image data)
        const state = await chrome.storage.local.get(['queueMeta', 'prompts', 'currentIndex', 'totalItems']);

        // Support both old format (queue) and new format (queueMeta) for backwards compatibility
        const totalItems = state.totalItems || state.queueMeta?.length || 0;

        if (!state.prompts || totalItems === 0) {
            throw new Error('No queue found in storage');
        }

        const prompts = state.prompts;
        const startIndex = state.currentIndex || 0;

        log(`Starting automation from index ${startIndex}, total items: ${totalItems}`);
        log(`Using lazy loading - images will be fetched one at a time`);

        // Process each item sequentially - request images on-demand
        for (let i = startIndex; i < totalItems; i++) {
            if (shouldStop) {
                log('Automation stopped by user');
                sendToSidebar({ type: 'AUTOMATION_STOPPED' });
                break;
            }

            try {
                // LAZY LOADING: Request image data from sidebar for this specific index
                log(`Requesting image ${i + 1}/${totalItems} from sidebar...`);

                sendToSidebar({
                    type: 'PROGRESS_UPDATE',
                    current: i + 1,
                    total: totalItems,
                    status: 'Loading image...'
                });

                const imageData = await requestImageData(i);

                if (!imageData) {
                    throw new Error('Failed to load image data from sidebar');
                }

                log(`Image ${i + 1} loaded successfully (${imageData.name})`);

                await processItem(imageData, prompts[i], i, totalItems);

                // Add random delay before next item (except for last item)
                if (i < totalItems - 1) {
                    const delay = getRandomDelay();
                    log(`Waiting ${delay / 1000} seconds before next item...`);

                    sendToSidebar({
                        type: 'PROGRESS_UPDATE',
                        current: i + 1,
                        total: totalItems,
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
