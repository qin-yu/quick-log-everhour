// The panel talks to the Everhour frame directly (chrome.tabs.sendMessage), and content scripts reach the
// panel with chrome.runtime.sendMessage, so the background script only wires up the action icon.
// The same page is Chrome's side panel (side_panel) and Firefox's sidebar (sidebar_action).
if (chrome.sidePanel) {
  const openOnClick = () => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
  chrome.runtime.onInstalled.addListener(openOnClick);
  chrome.runtime.onStartup.addListener(openOnClick);
} else {
  // Firefox only opens a sidebar from a user action, so toggle() must be called synchronously in the click handler.
  chrome.action.onClicked.addListener(() => { browser.sidebarAction.toggle(); });
}
