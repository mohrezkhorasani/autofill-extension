/**
 * Mohrez Quick Autofill - Popup Script
 */

(function () {
  'use strict';

  let allItems = [];

  const listContainer = document.getElementById('mqa-popup-list');
  const countBadge = document.getElementById('mqa-count-badge');
  const searchInput = document.getElementById('mqa-popup-search');
  const inputLabel = document.getElementById('mqa-new-label');
  const inputCat = document.getElementById('mqa-new-cat');
  const inputVal = document.getElementById('mqa-new-val');
  const btnAdd = document.getElementById('mqa-btn-add-item');

  function purgeLegacyItems(list) {
    if (!Array.isArray(list)) return [];
    return list.filter((it) => {
      if (!it) return false;
      const v = String(it.value || '').toLowerCase();
      const l = String(it.label || '').toLowerCase();
      if (v.includes('example.com') || v.includes('6037-9918') || l.includes('ایمیل کاری') || l.includes('ایمیل اصلی')) {
        return false;
      }
      return true;
    });
  }

  async function fetchBackendItems() {
    return new Promise((resolve) => {
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ action: 'GET_AUTOFILL_ITEMS' }, (res) => {
            if (chrome.runtime.lastError || !res || !res.ok) {
              resolve(null);
            } else {
              resolve(Array.isArray(res.items) ? res.items : []);
            }
          });
          return;
        }
      } catch {}
      resolve(null);
    });
  }

  async function syncBackendItems(items) {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: 'SAVE_AUTOFILL_ITEMS', items }, () => {
          if (chrome.runtime.lastError) {}
        });
      }
    } catch {}
  }

  async function loadStoredItems() {
    const backendItems = await fetchBackendItems();
    if (backendItems !== null && backendItems.length > 0) {
      allItems = purgeLegacyItems(backendItems);
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ mqa_autofill_items: allItems });
      }
      renderItems();
      return;
    }

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['mqa_autofill_items'], (res) => {
        if (res && res.mqa_autofill_items && Array.isArray(res.mqa_autofill_items)) {
          allItems = purgeLegacyItems(res.mqa_autofill_items);
          if (allItems.length !== res.mqa_autofill_items.length) {
            chrome.storage.local.set({ mqa_autofill_items: allItems });
          }
          if (allItems.length > 0) {
            syncBackendItems(allItems);
          }
        } else {
          allItems = [];
        }
        renderItems();
      });
    } else {
      const local = localStorage.getItem('mqa_autofill_items');
      if (local) {
        try {
          allItems = purgeLegacyItems(JSON.parse(local));
          localStorage.setItem('mqa_autofill_items', JSON.stringify(allItems));
        } catch {
          allItems = [];
        }
      } else {
        allItems = [];
      }
      renderItems();
    }
  }

  function saveItems() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ mqa_autofill_items: allItems });
    } else {
      localStorage.setItem('mqa_autofill_items', JSON.stringify(allItems));
    }
    syncBackendItems(allItems);
    renderItems();
  }

  function renderItems() {
    const q = (searchInput.value || '').toLowerCase().trim();
    const filtered = allItems.filter(
      (it) => it.label.toLowerCase().includes(q) || 
              it.value.toLowerCase().includes(q) || 
              (it.domain && it.domain.toLowerCase().includes(q)) || 
              (it.fieldId && it.fieldId.toLowerCase().includes(q)) || 
              (it.category && it.category.toLowerCase().includes(q))
    );

    countBadge.innerText = `${allItems.length} مورد`;
    listContainer.innerHTML = '';

    if (filtered.length === 0) {
      listContainer.innerHTML = `<div class="empty-note">هیچ موردی پیدا نشد.</div>`;
      return;
    }

    filtered.forEach((it) => {
      const card = document.createElement('div');
      card.className = 'item-card';
      card.innerHTML = `
        <div class="item-details">
          <div class="item-label">
            ${escapeHtml(it.label)} 
            ${it.category ? `<span style="font-size: 9px; opacity: 0.6;">(${escapeHtml(it.category)})</span>` : ''}
          </div>
          <div class="item-val">${escapeHtml(it.value)}</div>
          ${it.domain ? `<div style="font-size: 9px; color: #64748b; font-family: monospace; direction: ltr; text-align: right; margin-top: 2px;">${escapeHtml(it.domain)}${it.fieldId ? ' • ' + escapeHtml(it.fieldId) : ''}</div>` : ''}
        </div>
        <button class="item-del-btn" title="حذف این مورد">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      `;

      card.querySelector('.item-del-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`آیا از حذف «${it.label}» مطمئن هستید؟`)) {
          allItems = allItems.filter((item) => item.id !== it.id);
          saveItems();
        }
      });

      listContainer.appendChild(card);
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  searchInput.addEventListener('input', renderItems);

  btnAdd.addEventListener('click', () => {
    const label = inputLabel.value.trim();
    const val = inputVal.value.trim();
    const cat = inputCat.value.trim() || 'عمومی';

    if (!val) {
      alert('لطفاً مقدار را وارد کنید.');
      return;
    }

    const newItem = {
      id: Date.now().toString(),
      label: label || 'آیتم جدید',
      value: val,
      category: cat,
      domain: 'عمومی',
      fieldId: '',
      target: 'browser',
      createdAt: Date.now()
    };

    allItems.unshift(newItem);
    saveItems();

    inputLabel.value = '';
    inputVal.value = '';
    inputCat.value = '';
  });

  loadStoredItems();
})();
