/**
 * background.js - Service Worker for Meta AI Automator
 * 
 * Responsibilities:
 * - Register sidebar panel
 * - Handle extension icon click
 * - Relay messages if needed
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
