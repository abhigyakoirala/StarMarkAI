(function () {
  const STORAGE_KEY = 'chatSectionBookmarksV2';
  const PENDING_KEY = 'chatSectionPendingJumpV2';
  const BTN_CLASS = 'chat-bookmark-btn';
  const OVERLAY_ID = 'chat-bookmark-overlay';
  const TARGET_ATTR = 'data-chat-bookmark-id';
  const BOOKMARK_TEXT_MAX = 150;

  // ── Utilities ──────────────────────────────────────────────────────────────

  function normalizeUrl(url) {
    try {
      const u = new URL(url || location.href);
      u.hash = '';
      u.search = '';
      return u.toString().replace(/\/$/, '');
    } catch (_) {
      return (url || location.href).split('#')[0].split('?')[0].replace(/\/$/, '');
    }
  }

  function hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    return Math.abs(h).toString(36);
  }

  function cleanTitle(s, provider) {
    let out = (s || '').replace(/\s+/g, ' ').trim();
    if (provider === 'claude') out = out.replace(/\s+-\s+Claude\s*$/i, '').trim();
    else out = out.replace(/\s+-\s+ChatGPT\s*$/i, '').replace(/\s+\|\s+ChatGPT\s*$/i, '').trim();
    return out;
  }

  function getProvider(url) {
    try {
      const h = new URL(url || location.href).hostname;
      if (h.includes('claude.ai')) return 'claude';
      if (h.includes('chatgpt.com') || h.includes('chat.openai.com')) return 'chatgpt';
    } catch (_) {}
    return 'unknown';
  }

  // ── URL parsing ────────────────────────────────────────────────────────────

  function parseChatGptUrl(url) {
    try {
      const u = new URL(url || location.href);
      const projectMatch = u.pathname.match(/\/g\/([^/]+)\/c\/([^/]+)/);
      if (projectMatch) {
        return {
          provider: 'chatgpt', isProjectChat: true,
          projectId: projectMatch[1], chatId: projectMatch[2],
          projectKey: `${u.origin}/g/${projectMatch[1]}`,
          chatKey: `${u.origin}/g/${projectMatch[1]}/c/${projectMatch[2]}`
        };
      }
      const normalMatch = u.pathname.match(/\/c\/([^/]+)/);
      if (normalMatch) {
        return {
          provider: 'chatgpt', isProjectChat: false,
          projectId: null, chatId: normalMatch[1],
          projectKey: null, chatKey: `${u.origin}/c/${normalMatch[1]}`
        };
      }
    } catch (_) {}
    return {
      provider: 'chatgpt', isProjectChat: false, projectId: null,
      chatId: normalizeUrl(url || location.href), projectKey: null,
      chatKey: normalizeUrl(url || location.href)
    };
  }

  function parseClaudeUrl(url) {
    // NOTE: As of 2025, ALL Claude chats (including project chats) use the
    // same URL pattern: /chat/<conversationId>
    // Project membership cannot be detected from the URL alone — it must be
    // read from the DOM in getPageMeta(). This function only extracts the
    // chatId from the URL.
    try {
      const u = new URL(url || location.href);
      const chatMatch = u.pathname.match(/\/chat\/([^/]+)/i);
      if (chatMatch) {
        return {
          provider: 'claude', isProjectChat: false,
          projectId: null, chatId: chatMatch[1],
          projectKey: null, chatKey: `${u.origin}/chat/${chatMatch[1]}`
        };
      }
    } catch (_) {}
    return {
      provider: 'claude', isProjectChat: false, projectId: null,
      chatId: normalizeUrl(url || location.href), projectKey: null,
      chatKey: normalizeUrl(url || location.href)
    };
  }

  function parseCurrentUrl() {
    const provider = getProvider(location.href);
    if (provider === 'claude') return parseClaudeUrl(location.href);
    return parseChatGptUrl(location.href);
  }

  // Read project name, project ID, and chat name directly from the Claude
  // header bar. This is the ONLY reliable source since all Claude chat URLs
  // use the same /chat/<id> pattern regardless of project membership.
  //
  // Header DOM for a project chat:
  //   <a href="/project/<projectId>"><span>Website</span></a>  /
  //   <button data-testid="chat-title-button" aria-label="Chat name, rename chat">
  //
  // Header DOM for a normal chat:
  //   <button data-testid="chat-title-button" aria-label="Chat name, rename chat">
  function getClaudeHeaderNames() {
    const result = { projectName: null, projectId: null, chatName: null };

    // Chat name from aria-label: "DevOps practices for personal websites, rename chat"
    const titleBtn = document.querySelector('[data-testid="chat-title-button"]');
    if (titleBtn) {
      const label = (titleBtn.getAttribute('aria-label') || '').replace(/,?\s*rename chat\s*$/i, '').trim();
      if (label) result.chatName = label;
    }

    // Project detection: look for a /project/ breadcrumb anchor in the header.
    const projectAnchor = document.querySelector('a[href^="/project/"]');
    if (projectAnchor) {
      // Extract projectId from href e.g. /project/019db6c6-921b-7310-ad03-1b11b7d36cda
      const m = (projectAnchor.getAttribute('href') || '').match(/\/project\/([^/]+)/);
      if (m) result.projectId = m[1];
      const span = projectAnchor.querySelector('span');
      const text = ((span || projectAnchor).textContent || '').replace(/\s+/g, ' ').trim();
      if (text && !text.includes('/')) result.projectName = text;
    }

    return result;
  }

  function getClaudeProjectName() {
    return getClaudeHeaderNames().projectName;
  }

  function getTitleParts(info) {
    const raw = cleanTitle(document.title || 'Untitled Chat', info.provider);
    if (info.provider === 'claude') {
      // Project detection is DOM-based — getClaudeHeaderNames() tells us
      // whether we are in a project regardless of URL structure.
      const header = getClaudeHeaderNames();
      return {
        projectName: header.projectName || null,
        chatName: header.chatName || raw || `Chat ${info.chatId || ''}`.trim()
      };
    }
    if (info.isProjectChat) {
      const idx = raw.indexOf(' - ');
      if (idx >= 0) {
        return {
          projectName: cleanTitle(raw.slice(0, idx), 'chatgpt') || `Project ${info.projectId}`,
          chatName: cleanTitle(raw.slice(idx + 3), 'chatgpt') || `Chat ${info.chatId}`
        };
      }
      return { projectName: raw || `Project ${info.projectId}`, chatName: raw || `Chat ${info.chatId}` };
    }
    return { projectName: null, chatName: raw || `Chat ${info.chatId}` };
  }

  function getPageMeta() {
    const info = parseCurrentUrl();
    const titles = getTitleParts(info);

    // For Claude, project membership comes from the DOM (header breadcrumb),
    // not the URL. Pull projectId and projectName from the header result
    // which is already computed inside getTitleParts via getClaudeHeaderNames().
    let isProjectChat = info.isProjectChat;
    let projectId = info.projectId;
    let projectKey = info.projectKey;
    let projectName = titles.projectName;

    if (info.provider === 'claude') {
      const header = getClaudeHeaderNames();
      isProjectChat = !!(header.projectId || header.projectName);
      projectId = header.projectId || null;
      projectKey = projectId
        ? `${location.origin}/project/${projectId}`
        : null;
      projectName = header.projectName || null;
    }

    return {
      provider: info.provider,
      url: normalizeUrl(location.href),
      isProjectChat,
      projectId: isProjectChat ? projectId : null,
      projectKey: isProjectChat ? projectKey : null,
      projectName: isProjectChat ? projectName : null,
      chatId: info.chatId,
      chatKey: info.chatKey,
      chatName: titles.chatName,
      title: document.title || titles.chatName
    };
  }

  // ── Message element detection ──────────────────────────────────────────────

  function isInsideComposer(el) {
    return !!(el && el.closest([
      'form',
      'textarea',
      'input',
      '[contenteditable="true"]',
      '[data-testid*="composer"]',
      '[data-testid*="prompt"]',
      '[aria-label*="Message"]',
      '[aria-label*="message"]'
    ].join(',')));
  }

  function hasComposerDescendant(el) {
    return !!(el && el.querySelector && el.querySelector([
      'textarea',
      'input',
      '[contenteditable="true"]',
      '[data-testid*="composer"]',
      '[data-testid*="prompt"]'
    ].join(',')));
  }

  function textLength(el) {
    return ((el && el.innerText) || '').replace(/\s+/g, ' ').trim().length;
  }

  function usableMessageEl(el, minLen) {
    return el instanceof HTMLElement &&
      textLength(el) >= (minLen || 20) &&
      !el.closest('#' + OVERLAY_ID) &&
      !isInsideComposer(el) &&
      !hasComposerDescendant(el);
  }

  function topLevelOnly(list) {
    const arr = Array.from(new Set(list)).filter(Boolean);
    return arr.filter(el => !arr.some(other => other !== el && other.contains(el)));
  }

  function getClaudeCandidates() {
    // Claude's current DOM (verified May 2026):
    // Every turn lives inside a `div.contents` wrapper that has exactly one
    // child. User turns: div.mb-1.mt-6.group  Assistant turns: div.group.relative.pb-3
    // Neither has a data-testid. We collect both and filter out composer/empty.

    // 1) Preferred: grab the direct child of every div.contents that has
    //    substantive text and is not the composer.
    const contentsDivs = Array.from(document.querySelectorAll('div.contents'));
    if (contentsDivs.length) {
      const turns = contentsDivs
        .map(c => c.children[0])
        .filter(el => usableMessageEl(el, 20));
      if (turns.length) return topLevelOnly(turns);
    }

    // 2) Fallback A — user messages have a stable data-testid.
    const userMsgs = Array.from(document.querySelectorAll('[data-testid="user-message"]'))
      .filter(el => usableMessageEl(el, 10));
    // Walk up to the turn wrapper (div.mb-1.mt-6.group) for consistent anchoring.
    const userTurns = userMsgs.map(el => {
      let cur = el;
      while (cur.parentElement) {
        if (cur.classList.contains('group') && cur.classList.contains('mt-6')) return cur;
        cur = cur.parentElement;
      }
      return el;
    });

    // 3) Fallback B — assistant turns: div.group.relative.pb-3
    const assistantTurns = Array.from(document.querySelectorAll('div.group.relative.pb-3'))
      .filter(el => usableMessageEl(el, 20));

    const combined = [...userTurns, ...assistantTurns].filter(Boolean);
    if (combined.length) return topLevelOnly(combined);

    // 4) Legacy fallbacks for older Claude layouts.
    const realTurns = Array.from(document.querySelectorAll(
      '[data-testid="human-turn"], [data-testid="assistant-turn"]'
    )).filter(el => usableMessageEl(el, 20));
    if (realTurns.length) return topLevelOnly(realTurns);

    return [];
  }

  function getChatGptCandidates() {
    // Prefer the actual ChatGPT message author containers. The conversation
    // turn/article wrappers span the page width, which created a second star
    // near the scrollbar. Author-role nodes map one-to-one to question/answer
    // content and keep the button beside the message itself.
    const authorRoleNodes = Array.from(document.querySelectorAll(
      'main [data-message-author-role="user"], main [data-message-author-role="assistant"]'
    )).filter(el => usableMessageEl(el, 8));
    if (authorRoleNodes.length) return topLevelOnly(authorRoleNodes);

    // Fallback for older ChatGPT layouts. Keep this narrow and prefer real
    // message containers before any page-width wrappers.
    const selectors = [
      '[data-message-id]',
      '[data-testid^="conversation-turn"] .markdown',
      '[data-testid^="conversation-turn"] [class*="whitespace-pre-wrap"]',
      '.markdown'
    ];
    const set = new Set();
    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        if (usableMessageEl(el, 20)) set.add(el);
      });
    });
    const arr = Array.from(set).filter(el => !el.closest('.chat-bookmark-popup'));
    return topLevelOnly(arr);
  }

  function getMessageCandidates() {
    const provider = getProvider(location.href);
    return provider === 'claude' ? getClaudeCandidates() : getChatGptCandidates();
  }


  function firstUsableDescendant(root, selectors, minLen) {
    for (const sel of selectors) {
      const nodes = [];
      if (root.matches && root.matches(sel)) nodes.push(root);
      if (root.querySelectorAll) nodes.push(...root.querySelectorAll(sel));
      for (const node of nodes) {
        if (usableMessageEl(node, minLen || 8)) return node;
      }
    }
    return null;
  }

  function getPlacementHost(el) {
    const provider = getProvider(location.href);
    if (!(el instanceof HTMLElement)) return el;

    if (provider === 'chatgpt') {
      const host = firstUsableDescendant(el, [
        '[data-message-author-role="user"] .whitespace-pre-wrap',
        '[data-message-author-role="user"] [class*="whitespace-pre-wrap"]',
        '[data-message-author-role="user"]',
        '[data-message-author-role="assistant"] .markdown',
        '[data-message-author-role="assistant"] [data-message-id]',
        '[data-message-author-role="assistant"]',
        '[data-testid^="conversation-turn"] .markdown',
        '.markdown',
        '[class*="whitespace-pre-wrap"]'
      ], 8);
      return host || el;
    }

    if (provider === 'claude') {
      // Attach directly to the turn wrapper — descending into nested content
      // causes clipping and swallowed pointer events on the current Claude layout.
      return el;
    }

    return el;
  }

  function getCleanText(el) {
    if (!(el instanceof HTMLElement)) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.' + BTN_CLASS).forEach(btn => btn.remove());
    return (clone.innerText || '').replace(/\s+/g, ' ').trim();
  }

  function limitBookmarkText(text, maxLen = BOOKMARK_TEXT_MAX) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (clean.length <= maxLen) return clean;
    return clean.slice(0, Math.max(0, maxLen - 1)).trimEnd() + '…';
  }

  
function bookmarkMergeKey(bookmark) {
  const b = bookmark || {};
  return String(b.id || b.targetKey || ((b.url || '') + '|' + (b.createdAt || '') + '|' + (b.snippet || b.label || b.title || '')));
}

function hasDeletedBookmarks(group) {
  return !!(group && group.deletedBookmarks && Object.keys(normalizeDeletedBookmarks(group.deletedBookmarks)).length);
}

function normalizeDeletedBookmarks(value) {
    const out = {};
    if (!value || typeof value !== 'object') return out;
    Object.entries(value).forEach(([key, raw]) => {
      const deletedAt = typeof raw === 'number' ? raw : Number(raw && raw.deletedAt);
      if (key && Number.isFinite(deletedAt) && deletedAt > 0) out[key] = { deletedAt };
    });
    return out;
  }

  function rememberDeletedBookmark(group, bookmark) {
    if (!group || !bookmark) return;
    const deletedAt = Date.now();
    group.deletedBookmarks = normalizeDeletedBookmarks(group.deletedBookmarks);
    if (bookmark.id) group.deletedBookmarks['id:' + bookmark.id] = { deletedAt };
    if (bookmark.targetKey) group.deletedBookmarks['target:' + bookmark.targetKey] = { deletedAt };
  group.deletedBookmarks['merge:' + bookmarkMergeKey(bookmark)] = { deletedAt };
  }

  function clearDeletedBookmarkForTarget(group, targetKey) {
    if (!group || !targetKey || !group.deletedBookmarks) return;
    delete group.deletedBookmarks['target:' + targetKey];
  }

  function sanitizeStoreForStorage(store) {
    if (!store || typeof store !== 'object') return { groups: {}, version: 3 };
    const groups = {};
    Object.entries(store.groups && typeof store.groups === 'object' ? store.groups : {}).forEach(([key, group]) => {
      if (!group || typeof group !== 'object') return;
      groups[key] = {
        ...group,
        deletedBookmarks: normalizeDeletedBookmarks(group.deletedBookmarks),
        bookmarks: Array.isArray(group.bookmarks) ? group.bookmarks.map(bookmark => {
          const b = { ...(bookmark || {}) };
          if (b.snippet) b.snippet = limitBookmarkText(b.snippet, BOOKMARK_TEXT_MAX);
          if (b.label) b.label = limitBookmarkText(b.label, BOOKMARK_TEXT_MAX);
          if (b.title) b.title = limitBookmarkText(b.title, BOOKMARK_TEXT_MAX);
          if (b.target && typeof b.target === 'object') {
            b.target = { ...b.target };
            if (b.target.snippet) b.target.snippet = limitBookmarkText(b.target.snippet, 100);
          }
          return b;
        }) : []
      };
    });
    return { ...store, version: store.version || 3, groups };
  }

  function getElementKey(el) {
    if (!el.getAttribute(TARGET_ATTR)) {
      const provider = getProvider(location.href);
      const testid = el.getAttribute('data-testid') || '';
      const messageHost = el.closest && el.closest('[data-message-id]');
      const turnHost = el.closest && el.closest('[data-turn-id]');
      const base = (messageHost && messageHost.getAttribute('data-message-id')) ||
        el.getAttribute('data-message-id') ||
        (turnHost && turnHost.getAttribute('data-turn-id')) ||
        el.getAttribute('data-turn-id') ||
        el.id || '';
      const text = getCleanText(el).slice(0, 120);
      const index = getMessageCandidates().indexOf(el);
      const role = provider === 'chatgpt'
        ? ((messageHost && messageHost.getAttribute('data-message-author-role')) ||
          el.getAttribute('data-message-author-role') ||
          (turnHost && turnHost.getAttribute('data-turn')) ||
          'unknown')
        : (testid.includes('human') || testid.includes('user') ? 'user'
          : testid.includes('assistant') || testid.includes('bot') ? 'assistant'
          : 'unknown');
      const key = base ? `${provider}-msg-${base}` : `${provider}-idx-${index}-${role}-${hash(text)}`;
      el.setAttribute(TARGET_ATTR, key);
    }
    return el.getAttribute(TARGET_ATTR);
  }

  // ── Storage ────────────────────────────────────────────────────────────────

  function getStorage(cb) {
    chrome.storage.local.get({ [STORAGE_KEY]: { groups: {}, version: 3 } }, data =>
      cb(data[STORAGE_KEY] || { groups: {}, version: 3 })
    );
  }

  function notifyBackupWriter(reason) {
    try {
      chrome.runtime.sendMessage({ type: 'MARK_BACKUP_DIRTY', reason: reason || 'Bookmark changed from page star' }, () => {
        // Ignore lastError; backup status is shown in the popup.
        void chrome.runtime.lastError;
      });
    } catch (_) {}
  }

  function setStorage(store, cb) {
    chrome.storage.local.set({ [STORAGE_KEY]: sanitizeStoreForStorage(store) }, () => {
      notifyBackupWriter('Bookmark changed from page star');
      if (typeof cb === 'function') cb();
    });
  }

  // ── Inline bookmark buttons ───────────────────────────────────────────────
  // v3.3 uses visible per-message stars. The earlier overlay version could
  // fail to appear when provider layouts swallowed hover events. This version
  // inserts exactly one direct-child star into each accepted message container.

  function hasOwnBookmarkButton(el) {
    return Array.from(el.children || []).some(child => child.classList && child.classList.contains(BTN_CLASS));
  }

  function ensureElementCanHostButton(el) {
    const style = window.getComputedStyle(el);
    if (style.position === 'static') el.style.position = 'relative';
    el.style.overflow = 'visible';
    // Use provider-specific host class so CSS rules stay isolated.
    if (getProvider(location.href) === 'claude') {
      el.classList.add('chat-bookmark-claude-host');
    } else {
      el.classList.add('chat-bookmark-host');
    }
  }

  function isElementBookmarkedInStore(store, meta, targetKey) {
    const chatGroup = store.groups && store.groups[meta.chatKey];
    return !!(chatGroup && Array.isArray(chatGroup.bookmarks) &&
      chatGroup.bookmarks.some(b => b.targetKey === targetKey));
  }

  function refreshBtnState(btn, el) {
    const meta = getPageMeta();
    const key = getElementKey(el);
    if (!key || !meta.chatKey) {
      btn.textContent = '☆';
      btn.classList.remove('saved');
      btn.title = 'Bookmark this chat section';
      return;
    }
    getStorage(store => {
      const saved = isElementBookmarkedInStore(store, meta, key);
      btn.textContent = saved ? '★' : '☆';
      btn.classList.toggle('saved', !!saved);
      btn.title = saved ? 'Remove bookmark' : 'Bookmark this chat section';
    });
  }

  function refreshAllButtonStates() {
    document.querySelectorAll('.' + BTN_CLASS).forEach(btn => {
      const key = btn.dataset.targetKey || '';
      const el = key ? document.querySelector(`[${TARGET_ATTR}="${CSS.escape(key)}"]`) : null;
      if (el) refreshBtnState(btn, el);
    });
  }

  function removeStaleButtonsForElement(el, host, key) {
    // Remove any old page-width buttons from previous placement logic while
    // preserving the single button attached to the chosen content host.
    const scope = el instanceof HTMLElement ? el : document;
    Array.from(scope.querySelectorAll('.' + BTN_CLASS)).forEach(btn => {
      if (btn.parentElement !== host) btn.remove();
    });

    // Also de-dupe globally by target key. This handles dynamic rerenders where
    // the same message is discovered by more than one fallback selector.
    if (key) {
      const existing = Array.from(document.querySelectorAll(`.${BTN_CLASS}[data-target-key="${CSS.escape(key)}"]`));
      existing.forEach(btn => {
        if (btn.parentElement !== host) btn.remove();
      });
    }
  }

  function attachBookmarkButton(el) {
    if (!(el instanceof HTMLElement)) return;
    if (el.closest('#' + OVERLAY_ID)) return;

    const provider = getProvider(location.href);
    const host = getPlacementHost(el);
    if (!(host instanceof HTMLElement)) return;

    const key = getElementKey(el);
    removeStaleButtonsForElement(el, host, key);
    if (hasOwnBookmarkButton(host)) return;

    ensureElementCanHostButton(host);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = 'Bookmark this chat section';
    btn.textContent = '☆';
    btn.dataset.targetKey = key || '';

    if (provider === 'claude') {
      btn.className = BTN_CLASS + ' chat-bookmark-btn-claude';
    } else {
      btn.className = BTN_CLASS;
    }

    // Use capture phase for Claude so page-level handlers cannot swallow the click.
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      toggleBookmark(el, btn);
    }, provider === 'claude');

    host.appendChild(btn);
    refreshBtnState(btn, el);
  }

  // ── Main loop ──────────────────────────────────────────────────────────────

  function addBookmarkButtons() {
    const meta = getPageMeta();
    if (!meta.chatKey) return;
    if (meta.chatKey === normalizeUrl(location.origin)) return;
    if (meta.provider === 'claude' && !meta.chatId && !meta.isProjectChat) return;

    getMessageCandidates().forEach(el => attachBookmarkButton(el));
  }

  // ── Save/remove bookmark ───────────────────────────────────────────────────

  function toggleBookmark(el, btn) {
    const meta = getPageMeta();
    const targetKey = getElementKey(el);
    if (!targetKey || !meta.chatKey) return;

    getStorage(store => {
      store.version = 3;
      store.groups = store.groups || {};
      const existing = store.groups[meta.chatKey] || { bookmarks: [] };
      const currentList = Array.isArray(existing.bookmarks) ? existing.bookmarks : [];
      const existingIndex = currentList.findIndex(b => b.targetKey === targetKey);

      if (existingIndex >= 0) {
        const removedBookmark = currentList[existingIndex];
        rememberDeletedBookmark(existing, removedBookmark);
        existing.updatedAt = Date.now();
        existing.lastChangedAt = existing.updatedAt;
        currentList.splice(existingIndex, 1);
        existing.bookmarks = currentList;
        store.groups[meta.chatKey] = existing;
        if (!currentList.length && !hasDeletedBookmarks(existing)) delete store.groups[meta.chatKey];
        setStorage(store, () => {
          btn.textContent = '☆';
          btn.classList.remove('saved');
          btn.title = 'Bookmark this chat section';
        });
        return;
      }

      const snippet = limitBookmarkText(getCleanText(el), BOOKMARK_TEXT_MAX) || 'Bookmarked section';
      const messages = getMessageCandidates();
      const index = messages.indexOf(el);
      const messageHost = el.closest && el.closest('[data-message-id]');
      const turnHost = el.closest && el.closest('[data-turn-id]');
      const targetMeta = {
        index,
        snippet: limitBookmarkText(snippet, 100),
        textHash: hash(getCleanText(el).slice(0, 500)),
        role: meta.provider === 'chatgpt'
          ? ((messageHost && messageHost.getAttribute('data-message-author-role')) ||
            el.getAttribute('data-message-author-role') ||
            (turnHost && turnHost.getAttribute('data-turn')) ||
            'unknown')
          : undefined,
        messageId: messageHost ? messageHost.getAttribute('data-message-id') : (el.getAttribute('data-message-id') || null),
        turnId: turnHost ? turnHost.getAttribute('data-turn-id') : (el.getAttribute('data-turn-id') || null)
      };
      const bookmark = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        provider: meta.provider,
        targetKey,
        target: targetMeta,
        snippet,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        url: meta.url
      };

      clearDeletedBookmarkForTarget(existing, targetKey);
      store.groups[meta.chatKey] = {
        provider: meta.provider,
        chatKey: meta.chatKey,
        chatId: meta.chatId,
        chatName: existing.chatNameOverride || meta.chatName,
        chatNameDetected: meta.chatName,
        chatNameOverride: existing.chatNameOverride || null,
        url: meta.url,
        isProjectChat: meta.isProjectChat,
        projectKey: meta.isProjectChat ? meta.projectKey : null,
        projectId: meta.isProjectChat ? meta.projectId : null,
        projectName: meta.isProjectChat ? (existing.projectNameOverride || meta.projectName) : null,
        projectNameDetected: meta.isProjectChat ? meta.projectName : null,
        projectNameOverride: meta.isProjectChat ? (existing.projectNameOverride || null) : null,
        updatedAt: Date.now(),
        lastChangedAt: Date.now(),
        deletedBookmarks: normalizeDeletedBookmarks(existing.deletedBookmarks),
        bookmarks: currentList
      };
      store.groups[meta.chatKey].bookmarks.unshift(bookmark);
      setStorage(store, () => {
        btn.textContent = '★';
        btn.classList.add('saved');
        btn.title = 'Remove bookmark';
      });
    });
  }

  // ── Jump to bookmark ───────────────────────────────────────────────────────

  function parseMessageIdFromTargetKey(targetKey) {
    const raw = String(targetKey || '');
    const m = raw.match(/^(chatgpt|claude)-msg-(.+)$/);
    return m ? m[2] : null;
  }

  function cssEscapeValue(value) {
    return CSS && typeof CSS.escape === 'function' ? CSS.escape(String(value || '')) : String(value || '').replace(/"/g, '\"');
  }

  function getStableChatGptElement(targetKey, target) {
    if (getProvider(location.href) !== 'chatgpt') return null;
    const messageId = (target && target.messageId) || parseMessageIdFromTargetKey(targetKey);
    if (messageId) {
      const escaped = cssEscapeValue(messageId);
      const byMessage = document.querySelector(`[data-message-id="${escaped}"]`);
      if (byMessage) return byMessage;
      const byTurn = document.querySelector(`[data-turn-id="${escaped}"]`);
      if (byTurn) return byTurn;
      const byContainer = document.querySelector(`[data-turn-id-container="${escaped}"]`);
      if (byContainer) return byContainer;
    }
    if (target && target.turnId) {
      const escapedTurn = cssEscapeValue(target.turnId);
      return document.querySelector(`[data-turn-id="${escapedTurn}"], [data-turn-id-container="${escapedTurn}"]`);
    }
    return null;
  }

  function scoreMessageCandidate(el, target) {
    if (!el || !target) return -1;
    let score = 0;
    const text = getCleanText(el).toLowerCase();
    const snippet = String(target.snippet || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const role = String(target.role || '').toLowerCase();
    const elRole = String(el.getAttribute('data-message-author-role') || el.getAttribute('data-turn') || '').toLowerCase();
    if (role && elRole && role === elRole) score += 20;
    if (target.textHash && hash(getCleanText(el).slice(0, 500)) === target.textHash) score += 80;
    if (snippet) {
      const shortNeedle = snippet.slice(0, 80);
      const shorterNeedle = snippet.slice(0, 40);
      if (text.startsWith(shortNeedle)) score += 70;
      else if (text.includes(shortNeedle)) score += 55;
      else if (text.startsWith(shorterNeedle)) score += 45;
      else if (text.includes(shorterNeedle)) score += 30;
    }
    if (Number.isInteger(target.index)) {
      const messages = getMessageCandidates();
      const idx = messages.indexOf(el);
      if (idx === target.index) score += 10;
      else if (Math.abs(idx - target.index) <= 2) score += 4;
    }
    return score;
  }

  function findBestTargetByContent(target) {
    if (!target) return null;
    const messages = getMessageCandidates();
    let best = null;
    let bestScore = -1;
    messages.forEach(el => {
      const score = scoreMessageCandidate(el, target);
      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    });
    if (best && bestScore >= 30) return best;
    if (Number.isInteger(target.index) && messages[target.index]) return messages[target.index];
    return null;
  }

  function getScrollTargetElement(el) {
    if (!(el instanceof HTMLElement)) return el;
    if (getProvider(location.href) === 'chatgpt') {
      // Do NOT always promote to the full conversation turn. Current ChatGPT
      // assistant turns can contain multiple message blocks inside one
      // data-testid="conversation-turn-*" wrapper, for example tool/status
      // text followed by the final answer. Scrolling the wrapper makes several
      // bookmarks in the same answer land on the first block. Prefer the exact
      // message block that owns data-message-id, then the passed element.
      return el.closest('[data-message-id]') ||
        (el.matches && el.matches('[data-turn-id]') ? el : null) ||
        el.closest('[data-turn-id]') ||
        el;
    }
    return el;
  }

  function getHeaderOffsetPx() {
    const header = document.querySelector('header') || document.querySelector('[data-testid="mobile-header"]');
    const headerHeight = header ? Math.min(180, Math.max(56, header.getBoundingClientRect().height)) : 76;
    // Leave breathing room above the bookmarked message so it is not hidden
    // under ChatGPT's sticky header and is not jammed against the viewport edge.
    return headerHeight + 56;
  }

  function getPageScrollContainer(el) {
    // ChatGPT and Claude sometimes scroll inside a nested thread container rather
    // than the window. If we only call window.scrollTo, the target can highlight
    // correctly but stay off-screen. Walk upward and pick the first element that
    // actually scrolls; fall back to the document scroller.
    let node = el && el.parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
      const style = window.getComputedStyle(node);
      const canScrollY = /(auto|scroll|overlay)/.test(style.overflowY || style.overflow || '');
      if (canScrollY && node.scrollHeight > node.clientHeight + 24) return node;
      node = node.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function getScrollTop(container) {
    if (container === document.scrollingElement || container === document.documentElement || container === document.body) {
      return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
    }
    return container.scrollTop || 0;
  }

  function setScrollTop(container, top) {
    const value = Math.max(0, top);
    if (container === document.scrollingElement || container === document.documentElement || container === document.body) {
      window.scrollTo(0, value);
      return;
    }
    container.scrollTop = value;
  }

  function maxScrollTop(container) {
    if (container === document.scrollingElement || container === document.documentElement || container === document.body) {
      const doc = document.documentElement;
      return Math.max(0, doc.scrollHeight - window.innerHeight);
    }
    return Math.max(0, container.scrollHeight - container.clientHeight);
  }

  function animateScrollTop(container, targetTop, duration) {
    const startTop = getScrollTop(container);
    const endTop = Math.max(0, Math.min(maxScrollTop(container), targetTop));
    const distance = endTop - startTop;
    if (Math.abs(distance) < 2) {
      setScrollTop(container, endTop);
      return Promise.resolve();
    }

    const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      setScrollTop(container, endTop);
      return Promise.resolve();
    }

    const ms = Math.max(320, Math.min(1200, duration || 760));
    const start = performance.now();
    return new Promise(resolve => {
      const step = now => {
        const progress = Math.min(1, (now - start) / ms);
        setScrollTop(container, startTop + distance * easeInOutCubic(progress));
        if (progress < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  function getTargetScrollTop(container, targetEl) {
    const offset = getHeaderOffsetPx();
    const targetRect = targetEl.getBoundingClientRect();

    if (container === document.scrollingElement || container === document.documentElement || container === document.body) {
      return targetRect.top + window.scrollY - offset;
    }

    const containerRect = container.getBoundingClientRect();
    return container.scrollTop + (targetRect.top - containerRect.top) - offset;
  }

  function scrollContainerToElement(container, targetEl, behavior, duration) {
    const top = getTargetScrollTop(container, targetEl);
    if (behavior === 'auto') {
      setScrollTop(container, top);
      return Promise.resolve();
    }
    return animateScrollTop(container, top, duration || 780);
  }

  function scrollToBookmarkElement(el) {
    const targetEl = getScrollTargetElement(el);
    if (!(targetEl instanceof HTMLElement)) return;
    const container = getPageScrollContainer(targetEl);

    targetEl.classList.add('chat-bookmark-target');

    // Use our own easing animation instead of native scrollIntoView. Native
    // scrolling can snap very quickly in ChatGPT/Claude nested scroll roots.
    scrollContainerToElement(container, targetEl, 'smooth', 850);

    // ChatGPT often lays out code blocks, file tiles, and generated widgets after
    // the first scroll. Re-apply the offset smoothly after layout settles.
    setTimeout(() => scrollContainerToElement(getPageScrollContainer(targetEl), targetEl, 'smooth', 420), 650);
    setTimeout(() => {
      const desired = getHeaderOffsetPx();
      const currentTop = targetEl.getBoundingClientRect().top;
      if (currentTop < desired - 28 || currentTop > window.innerHeight - 140) {
        scrollContainerToElement(getPageScrollContainer(targetEl), targetEl, 'smooth', 500);
      }
    }, 1300);
    setTimeout(() => targetEl.classList.remove('chat-bookmark-target'), 3200);
  }

  function findJumpElement(targetKey, target) {
    const byStableId = getStableChatGptElement(targetKey, target);
    if (byStableId) return byStableId;
    if (targetKey) {
      const byAttr = document.querySelector(`[${TARGET_ATTR}="${CSS.escape(targetKey)}"]`);
      if (byAttr) return byAttr;
    }
    return findBestTargetByContent(target);
  }

  function jumpTo(targetKey, target) {
    const provider = getProvider(location.href);
    let scanDirection = -1;
    const attempt = (n) => {
      addBookmarkButtons();
      const el = findJumpElement(targetKey, target);
      if (el) {
        scrollToBookmarkElement(el);
        return;
      }

      // If ChatGPT/Claude has not rendered the target yet, gently scan the
      // conversation. This helps when a chat opens near the bottom and older
      // messages are lazily rendered. We avoid this for the first few attempts
      // so newly opened pages can hydrate normally.
      if (n >= 4 && n < 34) {
        const step = Math.max(520, Math.floor(window.innerHeight * 0.72));
        if (provider === 'chatgpt' || provider === 'claude') {
          const atTop = window.scrollY <= 4;
          const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 8;
          if (atTop) scanDirection = 1;
          if (atBottom) scanDirection = -1;
          window.scrollBy({ top: step * scanDirection, behavior: 'auto' });
        }
      }
      if (n < 55) setTimeout(() => attempt(n + 1), 260);
    };
    attempt(0);
  }

  // ── Runtime messages ───────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === 'JUMP_TO_BOOKMARK') {
      jumpTo(message.targetKey, message.target || null);
      sendResponse({ ok: true });
    }
    if (message && message.type === 'REFRESH_BOOKMARK_STATES') {
      refreshAllButtonStates();
      sendResponse({ ok: true });
    }
  });

  chrome.storage.local.get(PENDING_KEY, data => {
    const pending = data[PENDING_KEY];
    if (pending && normalizeUrl(pending.url) === normalizeUrl(location.href)) {
      chrome.storage.local.remove(PENDING_KEY);
      setTimeout(() => jumpTo(pending.targetKey, pending.target || null), 800);
    }
  });

  addBookmarkButtons();

  const observer = new MutationObserver(() => {
    clearTimeout(window.__chatBookmarkMutationTimer);
    window.__chatBookmarkMutationTimer = setTimeout(addBookmarkButtons, 250);
  });
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }

  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(addBookmarkButtons, 500);
    }
    addBookmarkButtons();
  }, 1500);
})();
