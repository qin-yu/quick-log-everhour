// The side panel talks to the Everhour frame directly (chrome.tabs.sendMessage), and content scripts
// reach the panel with chrome.runtime.sendMessage, so the service worker only wires up the action icon.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});
chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});
