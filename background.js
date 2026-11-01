/**
 * Mohrez Quick Autofill - Background Service Worker
 * Handles network communication with local Python Agent (http://127.0.0.1:23157/api/autofill)
 * completely bypassing webpage CORS and Mixed Content limitations!
 */

const AGENT_URL = 'http://127.0.0.1:23157/api/autofill';

async function fetchFromAgent() {
  try {
    const res = await fetch(AGENT_URL, { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      const data = await res.json();
      return Array.isArray(data.items) ? data.items : [];
    }
  } catch (err) {
    console.warn('Agent offline or error:', err);
  }
  return null;
}

async function saveToAgent(items) {
  try {
    const res = await fetch(AGENT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
      signal: AbortSignal.timeout(2000)
    });
    return res.ok;
  } catch (err) {
    console.warn('Agent save failed:', err);
    return false;
  }
}

// Listen for messages from content scripts and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'SET_EXTENSION_STATE') {
    const isEnabled = request.isEnabled !== false;
    chrome.storage.local.set({ 'mqa_autofill_enabled': isEnabled }, () => {
      if (chrome.tabs && chrome.tabs.query) {
        chrome.tabs.query({}, (tabs) => {
          for (const tab of tabs) {
            if (tab.id) {
              chrome.tabs.sendMessage(tab.id, {
                action: 'EXTENSION_STATE_UPDATED',
                isEnabled
              }).catch(() => {});
            }
          }
        });
      }
    });
    sendResponse({ ok: true, isEnabled });
    return true;
  }

  if (request.action === 'OPEN_TAB' && request.url) {
    const targetUrl = request.url;
    if (chrome.tabs) {
      if (sender.tab && sender.tab.id && chrome.tabs.update) {
        chrome.tabs.update(sender.tab.id, { url: targetUrl }, (tab) => {
          if (chrome.runtime.lastError || !tab) {
            chrome.tabs.create({ url: targetUrl });
          }
        });
      } else if (chrome.tabs.create) {
        chrome.tabs.create({ url: targetUrl });
      }
      sendResponse({ ok: true });
    }
    return true;
  }

  if (request.action === 'GET_AUTOFILL_ITEMS') {
    fetchFromAgent().then((items) => {
      if (items !== null) {
        // Cache in local extension storage as backup
        chrome.storage.local.set({ mqa_autofill_items: items });
        sendResponse({ ok: true, items, source: 'backend' });
      } else {
        // Fallback to extension storage if agent is unreachable
        chrome.storage.local.get(['mqa_autofill_items'], (res) => {
          sendResponse({ ok: true, items: res.mqa_autofill_items || [], source: 'cache' });
        });
      }
    });
    return true; // Keep channel open for async response
  }

  if (request.action === 'SAVE_AUTOFILL_ITEMS') {
    const items = request.items || [];
    // 1. Save to extension storage
    chrome.storage.local.set({ mqa_autofill_items: items });
    // 2. Save to central Python backend
    saveToAgent(items).then((ok) => {
      sendResponse({ ok, count: items.length });
    });
    return true;
  }
});
