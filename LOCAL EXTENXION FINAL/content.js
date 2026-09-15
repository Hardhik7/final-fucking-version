(function () {
  if (window.aiFoldersInitialized) return;
  window.aiFoldersInitialized = true;

  const STORAGE_KEY = 'geminiDataV2';
  const UI_KEY      = 'geminiDataV2_ui';
  const ALLOWED     = ['gemini.google.com', 'chatgpt.com', 'chat.openai.com', 'chat.deepseek.com'];
  const uid         = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const MAX_TITLE   = 120;
  const MAX_NAME    = 200;

  // ---------- Storage shim (works as extension OR userscript) ----------
  const storage = (() => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return {
        get(keys, cb) { chrome.storage.local.get(keys, cb); },
        set(obj, cb)  { chrome.storage.local.set(obj, cb); },
        onChange(fn)  { chrome.storage.onChanged.addListener((c, a) => a === 'local' && fn(c)); }
      };
    }
    // localStorage fallback — used only when chrome.storage is unavailable.
    //
    // ⚠️  Known limitation: localStorage is origin-scoped, so in userscript
    //     mode each AI site (Gemini / ChatGPT / DeepSeek) gets its OWN folder
    //     tree. Folders will NOT be shared across sites. Cross-site sharing
    //     requires GM_setValue with a @grant, which cannot be conditionally
    //     added from inside a single script. The extension path
    //     (chrome.storage.local) does share across all matched origins.
    return {
      get(keys, cb) {
        const out = {};
        for (const k of [].concat(keys)) {
          const raw = localStorage.getItem(k);
          if (raw != null) { try { out[k] = JSON.parse(raw); } catch (_) {} }
        }
        cb(out);
      },
      set(obj, cb) {
        for (const [k, v] of Object.entries(obj)) localStorage.setItem(k, JSON.stringify(v));
        cb && cb();
      },
      onChange(fn) {
        window.addEventListener('storage', (e) => {
          if (!e.newValue || (e.key !== STORAGE_KEY && e.key !== UI_KEY)) return;
          try { fn({ [e.key]: { newValue: JSON.parse(e.newValue) } }); }
          catch (_) {}
        });
      }
    };
  })();

  // ---------- Shadow host ----------
  const host = document.createElement('div');
  host.id = 'ai-folders-ext';
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }

    #fab { position: fixed; bottom: 24px; right: 24px; width: 56px; height: 56px;
      border-radius: 28px; background: #1a73e8; color: #fff; font-size: 24px;
      display: flex; align-items: center; justify-content: center; cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,.35); z-index: 2147483647; border: none;
      transition: transform .15s ease; }
    #fab:hover { transform: scale(1.06); }
    #fab:active { transform: scale(.95); }

    #panel { position: fixed; bottom: 90px; right: 24px; width: 360px; max-height: 72vh;
      background: #1e1e1e; color: #eee; border-radius: 12px; overflow: hidden;
      box-shadow: 0 10px 30px rgba(0,0,0,.5); z-index: 2147483647;
      display: none; flex-direction: column; border: 1px solid #333; }
    #panel.open { display: flex; }

    .header { padding: 12px 14px; background: #2a2a2a; font-weight: 600; font-size: 13.5px;
      display: flex; justify-content: space-between; align-items: center; }
    .close-btn { background: none; border: none; color: #aaa; cursor: pointer;
      font-size: 20px; line-height: 1; padding: 0 4px; }
    .close-btn:hover { color: #fff; }

    .search-row { padding: 10px 12px 0; }
    .search-input { width: 100%; padding: 8px 10px; background: #2a2a2a; border: 1px solid #3a3a3a;
      color: #fff; border-radius: 6px; font-size: 13px; outline: none; }
    .search-input:focus { border-color: #1a73e8; }

    .content { padding: 12px; overflow-y: auto; flex-grow: 1; }
    .content::-webkit-scrollbar { width: 8px; }
    .content::-webkit-scrollbar-thumb { background: #3a3a3a; border-radius: 4px; }

    .row { display: flex; gap: 8px; margin-bottom: 12px; }
    .new-folder { flex-grow: 1; padding: 8px 10px; background: #2a2a2a; border: 1px solid #3a3a3a;
      color: #fff; border-radius: 6px; font-size: 13px; outline: none; }
    .new-folder:focus { border-color: #1a73e8; }
    .btn { background: #1a73e8; color: #fff; border: none; padding: 8px 14px;
      border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; }
    .btn:hover { background: #1557b0; }

    .folder { margin-top: 6px; border-radius: 6px; }
    .folder-header { padding: 8px 10px; background: #262626; display: flex; align-items: center;
      gap: 6px; border-radius: 6px; border: 2px dashed transparent;
      transition: background .15s, border-color .15s; }
    .folder-header:hover { background: #2d2d2d; }
    .folder.drag-over > .folder-header { border-color: #1a73e8; background: #2f3a52; }
    .folder-title { font-weight: 500; font-size: 13.5px; flex-grow: 1; cursor: pointer;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .folder-title:focus-visible { outline: 2px solid #1a73e8; outline-offset: 2px; border-radius: 3px; }
    .folder-count { font-weight: 400; opacity: .55; font-size: 12px; }
    .folder-actions { display: flex; gap: 2px; opacity: 0; transition: opacity .15s; }
    .folder-header:hover .folder-actions,
    .folder-header:focus-within .folder-actions { opacity: 1; }

    .icon-btn { background: none; border: none; color: #aaa; cursor: pointer;
      font-size: 13px; padding: 3px 5px; border-radius: 4px; line-height: 1; }
    .icon-btn:hover { color: #fff; background: rgba(255,255,255,.08); }
    .icon-btn:focus-visible { outline: 2px solid #1a73e8; outline-offset: 1px; }
    .icon-btn.del:hover { color: #ff5252; }

    .chat-list { padding: 6px 0 4px 14px; margin-left: 8px; border-left: 1px solid #333;
      display: none; flex-direction: column; gap: 3px; }
    .chat-list.open { display: flex; }

    /* Direct-children wrapper — keeps reorder queries from seeing nested folders' chats. */
    .chats-wrap { display: flex; flex-direction: column; gap: 3px; }

    .chat-item { display: flex; align-items: center; gap: 5px; padding: 5px 6px;
      border-radius: 4px; background: #222; transition: background .15s; }
    .chat-item:hover { background: #2a2a2a; }
    .chat-item[draggable="true"] { cursor: grab; }
    .chat-item.dragging { opacity: .45; }
    .chat-item a { color: #8ab4f8; text-decoration: none; font-size: 12.5px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-grow: 1; }
    .chat-item a:hover { text-decoration: underline; }
    .chat-actions { display: flex; gap: 1px; opacity: 0; transition: opacity .15s; }
    .chat-item:hover .chat-actions,
    .chat-item:focus-within .chat-actions { opacity: 1; }

    .add-chat-btn { width: 100%; padding: 5px; background: transparent; color: #888;
      border: 1px dashed #3a3a3a; border-radius: 4px; cursor: pointer; font-size: 12px;
      margin-top: 3px; }
    .add-chat-btn:hover { background: #2a2a2a; color: #ccc; border-color: #666; }

    .tag { font-size: 10px; padding: 1px 5px; border-radius: 3px; font-weight: 700;
      flex-shrink: 0; color: #fff; }
    .tag.gem { background: #1a73e8; }
    .tag.gpt { background: #10a37f; }
    .tag.dps { background: #4d6bfe; }
    .tag.unk { background: #666; }

    .empty { color: #666; font-size: 13px; text-align: center; padding: 24px 10px; }

    .toolbar { display: flex; gap: 6px; padding: 8px 12px; border-top: 1px solid #333;
      background: #232323; }
    .toolbar button { flex: 1; padding: 6px; background: #2d2d2d; color: #bbb;
      border: none; border-radius: 4px; cursor: pointer; font-size: 11.5px; }
    .toolbar button:hover { background: #3a3a3a; color: #fff; }
    .toolbar button:focus-visible { outline: 2px solid #1a73e8; outline-offset: -2px; }

    .search-result-meta { font-size: 10.5px; color: #777; flex-shrink: 0;
      max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .toast { position: fixed; bottom: 24px; left: 24px; background: #323232; color: #fff;
      padding: 10px 14px; border-radius: 6px; font-size: 12.5px;
      box-shadow: 0 4px 14px rgba(0,0,0,.4); opacity: 0; transform: translateY(10px);
      transition: opacity .2s, transform .2s; pointer-events: none;
      z-index: 2147483647; max-width: 280px; }
    .toast.show { opacity: 1; transform: translateY(0); }
  `;
  shadow.appendChild(style);

  // ---------- Toast ----------
  const toastEl = document.createElement('div');
  toastEl.className = 'toast';
  shadow.appendChild(toastEl);
  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1900);
  }

  // ---------- Debounce ----------
  function debounce(fn, wait) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  // ---------- State ----------
  let rootFolders = [];
  let uiState = { panelOpen: false, search: '' };
  let lastSaveTime = 0;

  // The chat <div> currently being dragged, or null.
  // We cannot use shadow.querySelector('.dragging') because the drag source may
  // live in a *different* folder's subtree, and we need a stable reference
  // through the whole dragover/drop/dragend sequence.
  let draggingEl = null;

  // Set true by a folder drop handler; consumed by dragend. When a drag is
  // cancelled (Escape, drop outside any folder) no drop handler runs, so we
  // must resync the DOM back to state — otherwise a visually re-parented chat
  // can linger in the wrong folder until the next full re-render.
  let dropHandled = false;

  // Map<folderObject, titleSpan> — populated during render, cleared at start of
  // renderAll. Keyed by object (not id) so duplicate/missing ids can never collide.
  const folderEls = new Map();

  function loadState() {
    storage.get([STORAGE_KEY, UI_KEY], (res) => {
      rootFolders = res[STORAGE_KEY] || [];
      uiState = Object.assign({ panelOpen: false, search: '' }, res[UI_KEY] || {});
      applyUiState();
      renderAll();
    });
  }
  // Full save + re-render. Use for structural changes (add/delete folder, import).
  function saveFolders() {
    lastSaveTime = Date.now();
    storage.set({ [STORAGE_KEY]: rootFolders }, renderAll);
  }
  // Silent save — no re-render. Use when the DOM was already updated inline.
  function saveFoldersQuiet() {
    lastSaveTime = Date.now();
    storage.set({ [STORAGE_KEY]: rootFolders });
  }
  function saveUi() {
    storage.set({ [UI_KEY]: uiState });
  }

  storage.onChange((changes) => {
    if (!changes[STORAGE_KEY]) return;
    rootFolders = changes[STORAGE_KEY].newValue || [];
    // Skip the rebuild if another tab saved mid-drag — the DOM is currently
    // mid-reorder and rebuilding under the dragged node is unwanted churn.
    if (Date.now() - lastSaveTime > 150 && !draggingEl) renderAll();
  });

  // ---------- FAB + Panel ----------
  const fab = document.createElement('button');
  fab.id = 'fab';
  fab.textContent = '📁';
  fab.title = 'AI Folders';
  fab.setAttribute('aria-label', 'Open AI Folders');
  shadow.appendChild(fab);

  const panel = document.createElement('div');
  panel.id = 'panel';
  panel.innerHTML = `
    <div class="header">
      <span>📁 AI Folders</span>
      <button class="close-btn" title="Close" aria-label="Close">&times;</button>
    </div>
    <div class="search-row">
      <input type="text" class="search-input" placeholder="Search chats across folders…" autocomplete="off" aria-label="Search chats" />
    </div>
    <div class="content">
      <div class="row">
        <input type="text" class="new-folder" placeholder="New root folder…" autocomplete="off" aria-label="New folder name" />
        <button class="btn add-folder">Add</button>
      </div>
      <div class="folders-container"></div>
    </div>
    <div class="toolbar">
      <button class="export-btn" title="Download all folders as JSON">⬇ Export</button>
      <button class="import-btn" title="Load folders from JSON">⬆ Import</button>
      <button class="expand-all-btn">⊞ Expand</button>
      <button class="collapse-all-btn">⊟ Collapse</button>
    </div>
  `;
  shadow.appendChild(panel);

  const searchInput    = panel.querySelector('.search-input');
  const newFolderInput = panel.querySelector('.new-folder');
  const foldersEl      = panel.querySelector('.folders-container');
  const contentEl      = panel.querySelector('.content');

  // ---------- UI wiring ----------
  fab.addEventListener('click', () => {
    uiState.panelOpen = !uiState.panelOpen;
    applyUiState();
    saveUi();
  });
  panel.querySelector('.close-btn').addEventListener('click', () => {
    uiState.panelOpen = false;
    applyUiState();
    saveUi();
  });
  function applyUiState() {
    panel.classList.toggle('open', uiState.panelOpen);
    if (searchInput.value !== uiState.search) searchInput.value = uiState.search;
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && uiState.panelOpen) {
      uiState.panelOpen = false;
      applyUiState();
      saveUi();
    }
  });

  document.addEventListener('click', (e) => {
    if (uiState.panelOpen && !host.contains(e.target)) {
      uiState.panelOpen = false;
      applyUiState();
      saveUi();
    }
  });

  newFolderInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addRootFolder(); });
  panel.querySelector('.add-folder').addEventListener('click', addRootFolder);
  function addRootFolder() {
    const name = newFolderInput.value.trim().slice(0, MAX_NAME);
    if (!name) return;
    rootFolders.push({ id: uid(), name, isOpen: true, chats: [], folders: [] });
    newFolderInput.value = '';
    saveFolders();
    toast(`Folder "${name}" created`);
  }

  searchInput.addEventListener('input', debounce(() => {
    uiState.search = searchInput.value;
    saveUi();
    renderAll();
  }, 200));

  panel.querySelector('.expand-all-btn').addEventListener('click', () => {
    setAllOpen(rootFolders, true); saveFolders();
  });
  panel.querySelector('.collapse-all-btn').addEventListener('click', () => {
    setAllOpen(rootFolders, false); saveFolders();
  });
  function setAllOpen(arr, open) {
    arr.forEach((f) => { f.isOpen = open; if (f.folders) setAllOpen(f.folders, open); });
  }

  // ---------- Export / Import ----------
  panel.querySelector('.export-btn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(rootFolders, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-folders-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    // Revoking synchronously can cancel the download before it starts in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Exported');
  });

  panel.querySelector('.import-btn').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          if (!Array.isArray(data)) throw new Error('Root must be an array');
          const seenUrls = new Set();
          const seenIds  = new Set();
          const normalized = data.map((f) => normalizeFolder(f, seenUrls, seenIds)).filter(Boolean);
          if (normalized.length === 0) throw new Error('No valid folders found');
          if (confirm(`Import ${normalized.length} root folder(s)?\n\nThis will REPLACE your current folders.`)) {
            rootFolders = normalized;
            saveFolders();
            toast(`Imported ${normalized.length} folder(s)`);
          }
        } catch (err) {
          toast('Invalid file: ' + err.message);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  });

  function normalizeFolder(f, seenUrls, seenIds) {
    if (typeof f !== 'object' || !f) return null;
    // Re-issue any id that is missing or collides with one already emitted.
    let id = (typeof f.id === 'string' && f.id) ? f.id : uid();
    if (seenIds.has(id)) id = uid();
    seenIds.add(id);

    return {
      id,
      name:    String(f.name ?? 'Untitled').slice(0, MAX_NAME),
      isOpen:  !!f.isOpen,
      chats:   Array.isArray(f.chats)
        ? f.chats
            .filter((c) =>
              c &&
              typeof c.url === 'string' &&
              /^https?:\/\//i.test(c.url) &&
              !seenUrls.has(c.url) &&
              (seenUrls.add(c.url), true)
            )
            .map((c) => ({
              url:   c.url,
              title: String(c.title ?? 'Saved Chat').slice(0, MAX_TITLE)
            }))
        : [],
      folders: Array.isArray(f.folders)
        ? f.folders.map((c) => normalizeFolder(c, seenUrls, seenIds)).filter(Boolean)
        : []
    };
  }

  // ---------- Helpers ----------
  function siteInfo(url) {
    if (url.includes('gemini.google.com'))                              return { tag: 'G', cls: 'gem', label: 'Gemini' };
    if (url.includes('chatgpt.com') || url.includes('chat.openai.com')) return { tag: 'C', cls: 'gpt', label: 'ChatGPT' };
    if (url.includes('chat.deepseek.com'))                              return { tag: 'D', cls: 'dps', label: 'DeepSeek' };
    return { tag: '?', cls: 'unk', label: 'Other' };
  }

  function safeUrl(u) {
    return (typeof u === 'string' && /^https?:\/\//i.test(u)) ? u : '#';
  }

  function getCurrentTitle() {
    let t = (document.title || '').trim();
    t = t.replace(/\s*[-–—|]\s*(Gemini|ChatGPT|DeepSeek|OpenAI)\s*$/i, '').trim();
    t = t.replace(/^(Gemini|ChatGPT|DeepSeek)\s*[-–—|]\s*/i, '').trim();
    return (t || 'Saved Chat').slice(0, MAX_TITLE);
  }

  function htmlToText(html) {
    if (!html) return '';
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return (doc.body.textContent || '').trim();
    } catch (_) { return ''; }
  }

  function extractDropUrl(dt) {
    const raw = (dt.getData('text/uri-list') || dt.getData('URL') || '').trim();
    if (!raw) return '';
    const first = raw.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
    return first || '';
  }

  function isDuplicateUrl(url) {
    let found = false;
    (function walk(arr) {
      arr.forEach((f) => {
        if (found) return;
        if (f.chats && f.chats.some((c) => c.url === url)) { found = true; return; }
        if (f.folders) walk(f.folders);
      });
    })(rootFolders);
    return found;
  }

  function countChats(folder) {
    let n = (folder.chats || []).length;
    (folder.folders || []).forEach((f) => { n += countChats(f); });
    return n;
  }

  // Remove a chat (by url) from wherever it lives in the tree.
  // Returns the removed chat object, or null if not found.
  function detachChatByUrl(url) {
    let removed = null;
    (function walk(arr) {
      arr.forEach((f) => {
        if (removed) return;
        const idx = (f.chats || []).findIndex((c) => c.url === url);
        if (idx !== -1) { removed = f.chats.splice(idx, 1)[0]; return; }
        if (f.folders) walk(f.folders);
      });
    })(rootFolders);
    return removed;
  }

  // Which element in `container` should the dragged node be inserted *before*?
  // Scoped to direct children so nested subfolder chats are never considered.
  function getDragAfterElement(container, y) {
    const els = [...container.querySelectorAll(':scope > .chat-item:not(.dragging)')];
    return els.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) return { offset, element: child };
      return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }

  // ---------- Folder title rendering + inline refresh ----------
  function updateFolderTitle(titleSpan, folder) {
    const n = countChats(folder);
    titleSpan.textContent = (folder.isOpen ? '📂 ' : '📁 ') + folder.name;
    if (n > 0) {
      const cnt = document.createElement('span');
      cnt.className = 'folder-count';
      cnt.textContent = ` (${n})`;
      titleSpan.appendChild(cnt);
    }
    titleSpan.title = folder.name;
    titleSpan.setAttribute('aria-expanded', String(folder.isOpen));
    titleSpan.setAttribute('aria-label', `${folder.name} folder, ${n} chat${n === 1 ? '' : 's'}`);
  }

  // Refresh every visible folder title's count without a full re-render.
  function refreshCounts() {
    for (const [folder, titleSpan] of folderEls) {
      updateFolderTitle(titleSpan, folder);
    }
  }

  // ---------- Render ----------
  function renderAll() {
    const prevScroll = contentEl.scrollTop;

    folderEls.clear();
    foldersEl.innerHTML = '';
    const q = uiState.search.trim().toLowerCase();
    const fragment = document.createDocumentFragment();

    if (q) {
      renderSearchResults(q, fragment);
    } else if (rootFolders.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No folders yet. Create one above to get started.';
      fragment.appendChild(empty);
    } else {
      renderRecursive(rootFolders, fragment, rootFolders);
    }

    foldersEl.appendChild(fragment);
    contentEl.scrollTop = prevScroll;
  }

  function renderSearchResults(query, parentEl) {
    const results = [];
    (function walk(arr, path) {
      arr.forEach((f) => {
        const newPath = path ? `${path} / ${f.name}` : f.name;
        (f.chats || []).forEach((c) => {
          if (c.title.toLowerCase().includes(query) || c.url.toLowerCase().includes(query)) {
            results.push({ path: newPath, chat: c });
          }
        });
        if (f.folders) walk(f.folders, newPath);
      });
    })(rootFolders, '');

    if (results.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = `No matches for "${query}"`;
      parentEl.appendChild(empty);
      return;
    }

    results.forEach(({ path, chat }) => {
      const item = document.createElement('div');
      item.className = 'chat-item';

      const info = siteInfo(chat.url);
      const tag = document.createElement('span');
      tag.className = `tag ${info.cls}`;
      tag.textContent = info.tag;
      tag.title = info.label;

      const a = document.createElement('a');
      a.href = safeUrl(chat.url);
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = chat.title;
      a.title = chat.title;

      const meta = document.createElement('span');
      meta.className = 'search-result-meta';
      meta.textContent = path;
      meta.title = path;

      item.append(tag, a, meta);
      parentEl.appendChild(item);
    });
  }

  function renderRecursive(folderArray, parentElement, parentArray) {
    folderArray.forEach((folder, folderIdx) => {
      if (!folder.folders) folder.folders = [];
      if (!folder.chats)   folder.chats   = [];
      if (!folder.id)      folder.id      = uid();   // backfill for legacy v1/v2 data

      const el = document.createElement('div');
      el.className = 'folder';

      // ----- HEADER -----
      const header = document.createElement('div');
      header.className = 'folder-header';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'folder-title';
      titleSpan.setAttribute('tabindex', '0');
      titleSpan.setAttribute('role', 'button');
      updateFolderTitle(titleSpan, folder);

      // Register for inline count refreshes (keyed by object — collision-proof)
      folderEls.set(folder, titleSpan);

      const actions = document.createElement('div');
      actions.className = 'folder-actions';

      const addSubBtn = document.createElement('button');
      addSubBtn.className = 'icon-btn';
      addSubBtn.title = 'Add subfolder';
      addSubBtn.setAttribute('aria-label', `Add subfolder to ${folder.name}`);
      addSubBtn.textContent = '➕';

      const renameBtn = document.createElement('button');
      renameBtn.className = 'icon-btn';
      renameBtn.title = 'Rename';
      renameBtn.setAttribute('aria-label', `Rename folder ${folder.name}`);
      renameBtn.textContent = '✏️';

      const delBtn = document.createElement('button');
      delBtn.className = 'icon-btn del';
      delBtn.title = 'Delete';
      delBtn.setAttribute('aria-label', `Delete folder ${folder.name}`);
      delBtn.textContent = '🗑️';

      actions.append(addSubBtn, renameBtn, delBtn);
      header.append(titleSpan, actions);

      // ----- CHAT LIST (declared up front so drop handlers can close over them) -----
      const list = document.createElement('div');
      list.className = `chat-list ${folder.isOpen ? 'open' : ''}`;

      const chatsWrap = document.createElement('div');
      chatsWrap.className = 'chats-wrap';

      // Live visual reordering while dragging a saved chat over this folder's
      // own chat list. State is synced from the DOM on drop.
      chatsWrap.addEventListener('dragover', (e) => {
        if (!draggingEl) return;          // ignore external URL drags
        e.preventDefault();
        const after = getDragAfterElement(chatsWrap, e.clientY);
        if (after == null) chatsWrap.appendChild(draggingEl);
        else chatsWrap.insertBefore(draggingEl, after);
      });

      // Whole-folder drop target.
      // stopPropagation is critical: nested folders share ancestry, and without
      // it a drop on a subfolder bubbles up to every ancestor and re-moves the
      // chat to the outermost folder.
      el.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.classList.add('drag-over');
      });
      el.addEventListener('dragleave', (e) => {
        e.stopPropagation();
        if (!el.contains(e.relatedTarget)) el.classList.remove('drag-over');
      });
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropHandled = true;   // tell dragend this drag was consumed
        // A drop on a nested folder never fires dragleave on its ancestors,
        // so clear every stale highlight in one sweep.
        shadow.querySelectorAll('.drag-over').forEach((n) => n.classList.remove('drag-over'));

        const internal = e.dataTransfer.getData('application/x-ai-folders-chat');
        if (internal) {
          try {
            const { url } = JSON.parse(internal);
            const movedChat = detachChatByUrl(url);
            if (!movedChat) return;

            // Make sure the dragged DOM node actually lives in this folder's
            // list — if the user dropped on the header of a collapsed folder,
            // it never got re-parented by the dragover handler.
            if (draggingEl && draggingEl.parentElement !== chatsWrap) {
              chatsWrap.appendChild(draggingEl);
            }

            // Rebuild this folder's chat array from the post-drag DOM order.
            const order = [...chatsWrap.querySelectorAll(':scope > .chat-item')]
              .map((n) => n.dataset.chatUrl);

            const byUrl = new Map(folder.chats.map((c) => [c.url, c]));
            byUrl.set(movedChat.url, movedChat);
            folder.chats = order.map((u) => byUrl.get(u)).filter(Boolean);

            if (!folder.isOpen) {
              folder.isOpen = true;
              list.classList.add('open');
            }
            refreshCounts();       // updates this folder AND the source folder
            saveFoldersQuiet();    // DOM is already correct — no re-render
            return;
          } catch (_) {}
        }

        const url = extractDropUrl(e.dataTransfer);
        if (!url || !ALLOWED.some((d) => url.includes(d))) return;

        let title = '';
        const text = e.dataTransfer.getData('text/plain');
        const html = e.dataTransfer.getData('text/html');
        if (text)      title = text;
        else if (html) title = htmlToText(html);

        title = (title || url.split('/').filter(Boolean).pop() || 'Saved Chat')
                  .split('\n')[0]
                  .trim()
                  .slice(0, MAX_TITLE);

        if (isDuplicateUrl(url)) { toast('Already saved'); return; }
        folder.chats.push({ url, title });
        folder.isOpen = true;
        saveFolders();
        toast(`Saved to "${folder.name}"`);
      });

      // ----- CHAT ITEMS -----
      folder.chats.forEach((chat) => {
        const item = document.createElement('div');
        item.className = 'chat-item';
        item.draggable = true;
        item.dataset.chatUrl = chat.url;   // stable identity for DOM→state sync

        item.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('application/x-ai-folders-chat', JSON.stringify({ url: chat.url }));
          e.dataTransfer.effectAllowed = 'move';
          item.classList.add('dragging');
          draggingEl = item;
          dropHandled = false;   // fresh drag — no drop has consumed it yet
        });
        item.addEventListener('dragend', () => {
          item.classList.remove('dragging');
          draggingEl = null;
          // If no folder drop handler ran (Escape / drop outside the panel),
          // the DOM may have been visually re-parented by dragover shuffling.
          // Rebuild from state so the UI can't drift from storage.
          if (!dropHandled) renderAll();
          dropHandled = false;
        });

        const info = siteInfo(chat.url);
        const tag = document.createElement('span');
        tag.className = `tag ${info.cls}`;
        tag.textContent = info.tag;
        tag.title = info.label;

        const a = document.createElement('a');
        a.href = safeUrl(chat.url);
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = chat.title;
        a.title = chat.title;

        const chatActions = document.createElement('div');
        chatActions.className = 'chat-actions';

        const renameChatBtn = document.createElement('button');
        renameChatBtn.className = 'icon-btn';
        renameChatBtn.title = 'Rename chat';
        renameChatBtn.setAttribute('aria-label', `Rename chat ${chat.title}`);
        renameChatBtn.textContent = '✏️';
        renameChatBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const nn = prompt('Rename chat:', chat.title);
          if (nn != null && nn.trim()) {
            chat.title = nn.trim().slice(0, MAX_TITLE);
            // Inline DOM update — no full re-render
            a.textContent = chat.title;
            a.title = chat.title;
            renameChatBtn.setAttribute('aria-label', `Rename chat ${chat.title}`);
            delChatBtn.setAttribute('aria-label', `Remove ${chat.title} from folder`);
            saveFoldersQuiet();
          }
        });

        const delChatBtn = document.createElement('button');
        delChatBtn.className = 'icon-btn del';
        delChatBtn.title = 'Remove from folder';
        delChatBtn.setAttribute('aria-label', `Remove ${chat.title} from folder`);
        delChatBtn.textContent = '❌';
        delChatBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          // Resolve the index at click time by object identity. A closured
          // render-time index goes stale after any prior inline delete and
          // would silently splice the wrong chat.
          const idx = folder.chats.indexOf(chat);
          if (idx !== -1) folder.chats.splice(idx, 1);
          item.remove();
          refreshCounts();
          saveFoldersQuiet();
        });

        chatActions.append(renameChatBtn, delChatBtn);
        item.append(tag, a, chatActions);
        chatsWrap.appendChild(item);
      });

      const subContainer = document.createElement('div');
      renderRecursive(folder.folders, subContainer, folder.folders);

      const addBtn = document.createElement('button');
      addBtn.className = 'add-chat-btn';
      addBtn.textContent = '+ Save Current Page Here';
      addBtn.addEventListener('click', () => {
        const url = window.location.href;
        const isRoot = /^https?:\/\/[^/]+\/?$/.test(url)
                    || /\/(app|chat|c)\/?$/.test(url)
                    || url.endsWith('/#');
        if (isRoot) { toast('Open a specific chat first'); return; }
        if (isDuplicateUrl(url)) { toast('Already saved'); return; }
        folder.chats.push({ url, title: getCurrentTitle() });
        folder.isOpen = true;
        saveFolders();
        toast(`Saved to "${folder.name}"`);
      });

      list.append(chatsWrap, subContainer, addBtn);

      // ----- HEADER EVENTS -----
      function toggleFolder() {
        folder.isOpen = !folder.isOpen;
        list.classList.toggle('open', folder.isOpen);
        updateFolderTitle(titleSpan, folder);
        saveFoldersQuiet();
      }
      titleSpan.addEventListener('click', toggleFolder);
      titleSpan.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleFolder();
        }
      });

      addSubBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const name = prompt(`New subfolder in "${folder.name}":`);
        if (name && name.trim()) {
          folder.folders.push({ id: uid(), name: name.trim().slice(0, MAX_NAME), isOpen: true, chats: [], folders: [] });
          folder.isOpen = true;
          saveFolders();
        }
      });
      renameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const nn = prompt('Rename folder:', folder.name);
        if (nn != null && nn.trim()) {
          folder.name = nn.trim().slice(0, MAX_NAME);
          // Inline DOM update — no full re-render
          updateFolderTitle(titleSpan, folder);
          saveFoldersQuiet();
        }
      });
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const c = countChats(folder);
        if (confirm(`Delete "${folder.name}"${c ? ` and its ${c} chat(s)` : ''}?\n\nThis does NOT affect the actual chats on Gemini/ChatGPT/DeepSeek.`)) {
          parentArray.splice(folderIdx, 1);
          saveFolders();
          toast('Folder deleted');
        }
      });

      el.append(header, list);
      parentElement.appendChild(el);
    });
  }

  // ---------- Boot ----------
  loadState();
})();