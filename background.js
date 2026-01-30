/**
 * background.js - Service Worker for Meta AI Automator
 * 
 * Responsibilities:
 * - Register sidebar panel
 * - Handle extension icon click
 * - Relay messages between content script and sidebar for lazy loading
 */

// Open sidebar when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
    chrome.sidePanel.open({ tabId: tab.id });
});

// Set sidebar panel behavior
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Handle install/update
chrome.runtime.onInstalled.addListener(() => {
    console.log('Meta AI Automator installed');
});

/**
 * Message relay for lazy loading
 * Content script requests image data -> Background relays to Sidebar -> Sidebar responds with base64
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_IMAGE_DATA') {
        // Relay to all extension pages (sidebar will handle it)
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                sendResponse({ success: false, error: 'Sidebar not available. Please keep sidebar open.' });
            } else {
                sendResponse(response);
            }
        });
        return true; // Keep channel open for async response
    }
    return false;
});
