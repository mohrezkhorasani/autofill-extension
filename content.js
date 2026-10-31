/**
 * Mohrez Quick Autofill - Content Script
 * Domain & Input Identifier Priority Sorting:
 * 1. Exact Match: Same Domain + Same Input Identifier (ID / Name / Selector)
 * 2. Domain Match: Same Domain
 * 3. Field Match: Same Input Identifier on other domains
 * 4. General items
 */

(function () {
  'use strict';

  if (window.__MQA_INJECTED__) return;
  window.__MQA_INJECTED__ = true;

  let currentTargetInput = null;
  let triggerButton = null;
  let popupContainer = null;
  let isPopupOpen = false;

  // Purge any legacy demo items if they exist
  function purgeLegacyItems(list) {
    if (!Array.isArray(list)) return [];
    return list.filter((it) => {
      if (!it) return false;
      const v = String(it.value || '').toLowerCase();
      const l = String(it.label || '').toLowerCase();
      // Remove any item with example.com or old mock data
      if (v.includes('example.com') || v.includes('6037-9918') || l.includes('ایمیل کاری') || l.includes('ایمیل اصلی')) {
        return false;
      }
      return true;
    });
  }

  function getCurrentDomain() {
    try {
      return window.location.hostname || 'localhost';
    } catch {
      return 'web';
    }
  }

  function getInputIdentifier(el) {
    if (!el) return '';
    if (el.id && el.id.trim()) return `#${el.id.trim()}`;
    if (el.name && el.name.trim()) return `name=${el.name.trim()}`;
    if (el.getAttribute('autocomplete') && el.getAttribute('autocomplete').trim()) {
      return `auto=${el.getAttribute('autocomplete').trim()}`;
    }
    if (el.placeholder && el.placeholder.trim()) return `ph=${el.placeholder.trim()}`;
    if (el.getAttribute('aria-label') && el.getAttribute('aria-label').trim()) {
      return `aria=${el.getAttribute('aria-label').trim()}`;
    }
    return '';
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

  async function getStoredItems() {
    // 1. Check central backend first
    const backendItems = await fetchBackendItems();
    if (backendItems !== null && backendItems.length > 0) {
      const clean = purgeLegacyItems(backendItems);
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ mqa_autofill_items: clean });
      }
      return clean;
    }

    // 2. Fallback to extension local storage
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['mqa_autofill_items'], (res) => {
          let list = [];
          if (res && res.mqa_autofill_items && Array.isArray(res.mqa_autofill_items)) {
            list = purgeLegacyItems(res.mqa_autofill_items);
            if (list.length !== res.mqa_autofill_items.length) {
              chrome.storage.local.set({ mqa_autofill_items: list });
            }
          }
          if (list.length > 0) {
            syncBackendItems(list);
          }
          resolve(list);
        });
      } else {
        const local = localStorage.getItem('mqa_autofill_items');
        let list = [];
        if (local) {
          try {
            list = purgeLegacyItems(JSON.parse(local));
            localStorage.setItem('mqa_autofill_items', JSON.stringify(list));
          } catch {}
        }
        if (list.length > 0) {
          syncBackendItems(list);
        }
        resolve(list);
      }
    });
  }

  async function saveNewItem(label, value, category = 'عمومی') {
    const items = await getStoredItems();
    const currentDomain = getCurrentDomain();
    const currentInputId = getInputIdentifier(currentTargetInput);

    const newItem = {
      id: Date.now().toString(),
      label: label.trim() || 'آیتم جدید',
      value: value.trim(),
      category: category.trim() || 'عمومی',
      domain: currentDomain,
      fieldId: currentInputId,
      target: 'browser',
      createdAt: Date.now()
    };

    items.unshift(newItem);

    // Save to extension storage
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ mqa_autofill_items: items });
    } else {
      localStorage.setItem('mqa_autofill_items', JSON.stringify(items));
    }

    // Also sync to central backend so homepage tools page sees it immediately!
    syncBackendItems(items);

    showToast(`مقدار «${newItem.label}» برای این فیلد و دامین ذخیره شد`);
    return newItem;
  }

  function showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'mqa-toast';
    toast.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2">
        <path d="M20 6L9 17l-5-5"/>
      </svg>
      <span>${msg}</span>
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  function getTriggerButton() {
    if (triggerButton) return triggerButton;

    triggerButton = document.createElement('div');
    triggerButton.className = 'mqa-trigger-btn';
    triggerButton.setAttribute('title', 'Mohrez Autofill');
    triggerButton.innerHTML = `
      <svg viewBox="0 0 24 24">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
      </svg>
    `;

    triggerButton.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      togglePopup();
    });

    triggerButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    });

    document.body.appendChild(triggerButton);
    return triggerButton;
  }

  function positionTrigger(el) {
    if (!el || !document.contains(el)) {
      hideTrigger();
      return;
    }

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      hideTrigger();
      return;
    }

    const btn = getTriggerButton();
    const btnSize = 24;
    const padding = 5;

    const pageX = window.pageXOffset || document.documentElement.scrollLeft || 0;
    const pageY = window.pageYOffset || document.documentElement.scrollTop || 0;

    let top = pageY + rect.top + (rect.height - btnSize) / 2;
    let left;

    const style = window.getComputedStyle(el);
    const isRtl = style.direction === 'rtl';

    if (isRtl) {
      left = pageX + rect.left + padding;
    } else {
      left = pageX + rect.right - btnSize - padding;
    }

    btn.style.top = `${Math.round(top)}px`;
    btn.style.left = `${Math.round(left)}px`;
    btn.style.display = 'flex';
  }

  function hideTrigger() {
    if (triggerButton && !isPopupOpen) {
      triggerButton.style.display = 'none';
    }
  }

  async function showPopup() {
    if (popupContainer) {
      popupContainer.remove();
      popupContainer = null;
    }

    if (!currentTargetInput || !document.contains(currentTargetInput)) return;

    isPopupOpen = true;

    const items = await getStoredItems();
    const currentDomain = getCurrentDomain();
    const currentFieldId = getInputIdentifier(currentTargetInput);

    const rect = currentTargetInput.getBoundingClientRect();
    const pageX = window.pageXOffset || document.documentElement.scrollLeft || 0;
    const pageY = window.pageYOffset || document.documentElement.scrollTop || 0;

    const popup = document.createElement('div');
    popup.className = 'mqa-popup-container';

    const popupWidth = 310;
    const estimatedHeight = 320; // Average popup height

    // Check space below vs space above in the viewport
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const shouldOpenUpwards = spaceBelow < estimatedHeight && spaceAbove > spaceBelow;

    let top;
    if (shouldOpenUpwards) {
      top = pageY + rect.top - 6; // Will adjust precisely after appending
      popup.classList.add('mqa-open-up');
    } else {
      top = pageY + rect.bottom + 4;
    }

    let left;
    const style = window.getComputedStyle(currentTargetInput);
    const isRtl = style.direction === 'rtl';

    if (isRtl) {
      left = pageX + rect.right - popupWidth;
      if (left < pageX + 10) left = pageX + rect.left;
    } else {
      left = pageX + rect.left;
    }

    if (left + popupWidth > pageX + window.innerWidth - 10) {
      left = pageX + window.innerWidth - popupWidth - 10;
    }
    if (left < pageX + 10) {
      left = pageX + 10;
    }

    popup.style.top = `${Math.round(top)}px`;
    popup.style.left = `${Math.round(left)}px`;

    const currentValue = currentTargetInput.value || currentTargetInput.innerText || '';
    const canSaveCurrent = currentValue.trim().length > 0;

    popup.innerHTML = `
      <div class="mqa-popup-header">
        <span class="mqa-popup-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
          </svg>
          Mohrez Autofill
        </span>
        <span class="mqa-domain-badge" title="دامین فعلی: ${escapeHtml(currentDomain)}">
          ${escapeHtml(currentDomain)}
        </span>
      </div>

      <div class="mqa-popup-search">
        <input type="text" placeholder="جستجو میان مقادیر ذخیره‌شده..." id="mqa-search-box" autocomplete="off" />
      </div>

      <div class="mqa-popup-list" id="mqa-items-list">
        <!-- Injected dynamically -->
      </div>

      <div class="mqa-popup-footer">
        <button class="mqa-btn-action mqa-btn-save" id="mqa-btn-save-current" ${canSaveCurrent ? '' : 'disabled'}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
            <polyline points="17 21 17 13 7 13 7 21"></polyline>
            <polyline points="7 3 7 8 15 8"></polyline>
          </svg>
          <span>ذخیره مقدار فعلی (${canSaveCurrent ? (currentValue.length > 15 ? currentValue.substring(0, 15) + '...' : currentValue) : 'فیلد خالیست'})</span>
        </button>
      </div>
    `;

    popup.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });

    popup.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    function getPriorityScore(it) {
      const sameDomain = it.domain && it.domain.toLowerCase() === currentDomain.toLowerCase();
      const sameField = currentFieldId && it.fieldId && it.fieldId.toLowerCase() === currentFieldId.toLowerCase();

      // اول: شناسه یکتا دامین یکسان
      if (sameDomain && sameField) return 1;
      // دوم: دامین یکسان
      if (sameDomain) return 2;
      // سوم: شناسه یکسان (در دامین‌های دیگر)
      if (sameField) return 3;
      // چهارم: سایر موارد عمومی
      return 4;
    }

    function renderList(filterText = '') {
      const listContainer = popup.querySelector('#mqa-items-list');
      if (!listContainer) return;

      const q = filterText.toLowerCase().trim();
      let filtered = items.filter((it) => {
        if (!q) return true;
        return (
          it.label.toLowerCase().includes(q) ||
          it.value.toLowerCase().includes(q) ||
          (it.domain && it.domain.toLowerCase().includes(q)) ||
          (it.fieldId && it.fieldId.toLowerCase().includes(q)) ||
          (it.category && it.category.toLowerCase().includes(q))
        );
      });

      filtered.sort((a, b) => {
        const scoreA = getPriorityScore(a);
        const scoreB = getPriorityScore(b);
        if (scoreA !== scoreB) {
          return scoreA - scoreB;
        }
        return (b.createdAt || 0) - (a.createdAt || 0);
      });

      if (filtered.length === 0) {
        listContainer.innerHTML = `
          <div class="mqa-empty-msg">
            هنوز مقداری ذخیره نشده است.<br/>
            متنی در این فیلد بنویسید و روی دکمه سبز زیر بزنید تا ذخیره شود.
          </div>
        `;
        return;
      }

      listContainer.innerHTML = '';
      filtered.forEach((it) => {
        const score = getPriorityScore(it);
        const el = document.createElement('div');
        
        let priorityClass = '';
        let badgeHtml = '';
        if (score === 1) {
          priorityClass = 'mqa-item-exact';
          badgeHtml = '<span class="mqa-item-badge badge-exact">همین فیلد و سایت</span>';
        } else if (score === 2) {
          priorityClass = 'mqa-item-domain';
          badgeHtml = '<span class="mqa-item-badge badge-domain">همین سایت</span>';
        } else if (score === 3) {
          priorityClass = 'mqa-item-field';
          badgeHtml = '<span class="mqa-item-badge badge-field">همین نوع فیلد</span>';
        }

        el.className = `mqa-popup-item ${priorityClass}`;
        el.innerHTML = `
          <div class="mqa-item-info">
            <div class="mqa-item-toprow">
              <span class="mqa-item-label">${escapeHtml(it.label)}</span>
              ${badgeHtml}
            </div>
            <div class="mqa-item-val">${escapeHtml(it.value)}</div>
            ${it.domain ? `<div class="mqa-item-meta">${escapeHtml(it.domain)}${it.fieldId ? ' • ' + escapeHtml(it.fieldId) : ''}</div>` : ''}
          </div>
          ${it.category ? `<span class="mqa-item-tag">${escapeHtml(it.category)}</span>` : ''}
        `;

        el.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          fillField(it.value);
          closePopup();
        });

        listContainer.appendChild(el);
      });
    }

    renderList();

    const searchBox = popup.querySelector('#mqa-search-box');
    if (searchBox) {
      searchBox.addEventListener('input', (e) => {
        renderList(e.target.value);
      });
      setTimeout(() => {
        try {
          searchBox.focus({ preventScroll: true });
        } catch {
          searchBox.focus();
        }
      }, 60);
    }

    const saveBtn = popup.querySelector('#mqa-btn-save-current');
    if (saveBtn && canSaveCurrent) {
      saveBtn.addEventListener('mousedown', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const defaultLabel = inferFieldLabel(currentTargetInput) || 'مقدار فیلد';
        const label = prompt(`عنوان ذخیره‌سازی برای «${currentDomain}» (${currentFieldId || 'عمومی'}):`, defaultLabel);
        if (label !== null && label.trim()) {
          await saveNewItem(label, currentValue);
          closePopup();
        }
      });
    }

    document.body.appendChild(popup);
    popupContainer = popup;

    // If opening upwards, now that it's in DOM, recalculate top accurately using actual height
    if (shouldOpenUpwards) {
      const actualHeight = popup.offsetHeight || estimatedHeight;
      const accurateTop = pageY + rect.top - actualHeight - 6;
      popup.style.top = `${Math.max(pageY + 10, Math.round(accurateTop))}px`;
    }
  }

  function closePopup() {
    isPopupOpen = false;
    if (popupContainer) {
      popupContainer.remove();
      popupContainer = null;
    }
  }

  function togglePopup() {
    if (isPopupOpen) {
      closePopup();
    } else {
      showPopup();
    }
  }

  function fillField(text) {
    if (!currentTargetInput) return;

    if (currentTargetInput.isContentEditable) {
      currentTargetInput.innerText = text;
      currentTargetInput.dispatchEvent(new Event('input', { bubbles: true }));
      currentTargetInput.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      currentTargetInput.value = text;
      const inputEvent = new Event('input', { bubbles: true });
      const changeEvent = new Event('change', { bubbles: true });
      currentTargetInput.dispatchEvent(inputEvent);
      currentTargetInput.dispatchEvent(changeEvent);

      const tracker = currentTargetInput._valueTracker;
      if (tracker) {
        tracker.setValue('');
      }
    }

    showToast('فیلد با موفقیت پر شد ✨');
    try {
      currentTargetInput.focus({ preventScroll: true });
    } catch {
      currentTargetInput.focus();
    }
  }

  function inferFieldLabel(el) {
    if (!el) return '';
    if (el.placeholder) return el.placeholder;
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    if (el.name) return el.name;
    if (el.id) {
      const labelTag = document.querySelector(`label[for="${el.id}"]`);
      if (labelTag) return labelTag.innerText.trim();
      return el.id;
    }
    return '';
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isSupportedInput(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    if (el.id === 'mqa-search-box' || el.closest('.mqa-popup-container') || el.closest('.mqa-trigger-btn')) {
      return false;
    }
    if (el.isContentEditable) return true;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName === 'INPUT') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      const forbidden = ['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'hidden', 'color', 'range'];
      return !forbidden.includes(type);
    }
    return false;
  }

  // Focus listener
  document.addEventListener('focusin', (e) => {
    if (isPopupOpen) return;

    if (isSupportedInput(e.target)) {
      currentTargetInput = e.target;
      positionTrigger(currentTargetInput);
    }
  }, true);

  // Click listener
  document.addEventListener('click', (e) => {
    if (triggerButton && triggerButton.contains(e.target)) return;
    if (popupContainer && popupContainer.contains(e.target)) return;

    if (isSupportedInput(e.target)) {
      closePopup();
      currentTargetInput = e.target;
      positionTrigger(currentTargetInput);
      return;
    }

    closePopup();
    hideTrigger();
  }, true);

  window.addEventListener('resize', () => {
    if (isPopupOpen) return;
    if (currentTargetInput && document.contains(currentTargetInput)) {
      positionTrigger(currentTargetInput);
    } else {
      closePopup();
      hideTrigger();
    }
  });

  window.addEventListener('scroll', () => {
    if (isPopupOpen) return;
    if (currentTargetInput && document.contains(currentTargetInput)) {
      positionTrigger(currentTargetInput);
    } else {
      closePopup();
      hideTrigger();
    }
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closePopup();
      hideTrigger();
    }
  });

})();
