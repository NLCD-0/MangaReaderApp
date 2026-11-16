/* ========================================================
   CLOUD READER — Application Logic
   GitHub API + PDF.js + JSZip + HTML & PDF Text Reader
   Mobile-First · Chrome Translation Friendly · GitHub Pages
   ======================================================== */

// ---- CONFIGURATION ----
const CONFIG = {
    owner: 'NLCD-0',
    repo: 'CLOUD',
    branch: 'main',
    rootFolders: [
        {
            path: 'Manga & Webtoon',
            icon: '📖',
            desc: 'Manga & Webtoon collections',
            functions: [1, 4],
            storyIsFolder: true
        },
        {
            path: 'Novela',
            icon: '📕',
            desc: 'Novels & Light Novels',
            functions: [1, 4],
            storyIsFolder: true
        },
        {
            path: 'ao3',
            icon: 'ao3_icon.png',
            desc: 'Archive of Our Own stories',
            isImage: true,
            functions: [2, 3, 4],
            storyIsFolder: false
        }
    ]
};

const API_BASE = `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents`;

// ---- TOKEN MANAGEMENT (PASSWORD MODE) ----
function getToken() {
    return localStorage.getItem('mangacloud_token') || '';
}

function setToken(token) {
    if (token) {
        localStorage.setItem('mangacloud_token', token.trim());
    } else {
        localStorage.removeItem('mangacloud_token');
    }
    updateTokenUI();
}

function updateTokenUI() {
    const hasTok = !!getToken();
    const alertEl = document.getElementById('token-alert');
    if (alertEl) {
        alertEl.style.display = hasTok ? 'none' : 'block';
    }
}

// ---- APP STATE ----
const state = {
    currentRootConfig: null,
    currentPath: '',
    currentSeriesName: '',
    items: [],           // current list of chapters/stories
    currentIndex: -1,     // index of open item in state.items
    currentStory: null,   // currently reading story object
    currentBlob: null,    // loaded PDF blob
    isTextMode: false,    // true if reading text, false if webtoon canvas
    fontSize: parseInt(localStorage.getItem('mangacloud_font_size') || '18', 10),
    isSerif: localStorage.getItem('mangacloud_font_serif') === 'true',
    renderGen: 0,
    headerVisible: true,
    hideTimer: null,
    navigationStack: []
};

// ---- DOM CACHE ----
const dom = {};
function cacheDom() {
    const ids = [
        'view-library', 'view-log', 'view-series', 'view-chapters', 'view-reader',
        'library-grid', 'continue-reading', 'continue-reading-list', 'btn-see-all-log',
        'header-log-count', 'btn-open-log', 'btn-open-settings', 'token-alert', 'btn-banner-token',
        'btn-back-log-to-library', 'log-count-subtitle', 'btn-clear-log', 'log-filter-pills',
        'log-search-input', 'btn-clear-log-search', 'log-list',
        'btn-back-series', 'series-title', 'series-subtitle', 'btn-download-folder-zip',
        'series-breadcrumbs', 'series-search-input', 'series-list',
        'btn-back-chapters', 'chapters-title', 'chapters-subtitle', 'btn-download-all',
        'chapters-breadcrumbs', 'chapters-search-input', 'chapters-list',
        'reader-header', 'btn-back-from-reader', 'reader-title', 'reader-progress',
        'btn-toggle-mode', 'toggle-mode-icon', 'toggle-mode-text',
        'btn-bookmark', 'btn-download', 'reader-text-toolbar',
        'btn-font-decrease', 'font-size-val', 'btn-font-increase', 'btn-font-family',
        'reader-container', 'chapter-nav', 'btn-prev-chapter', 'btn-next-chapter',
        'btn-nav-bookmark',
        'settings-modal', 'btn-close-settings', 'token-input', 'btn-toggle-token-visibility',
        'btn-save-token', 'btn-reset-token',
        'loading-overlay', 'loader-text', 'toast'
    ];
    ids.forEach(id => {
        dom[id] = document.getElementById(id);
    });
}

// ---- NOTIFICATIONS & OVERLAYS ----
let toastTimer = null;
function showToast(msg) {
    if (!dom.toast) return;
    clearTimeout(toastTimer);
    dom.toast.textContent = msg;
    dom.toast.classList.add('visible');
    toastTimer = setTimeout(() => dom.toast.classList.remove('visible'), 2600);
}

function showLoading(text) {
    if (!dom['loading-overlay']) return;
    dom['loader-text'].textContent = text || 'Loading...';
    dom['loading-overlay'].classList.add('active');
}

function hideLoading() {
    if (!dom['loading-overlay']) return;
    dom['loading-overlay'].classList.remove('active');
}

// ---- GITHUB API REQUESTS ----
function encodePath(path) {
    return path.split('/').map(encodeURIComponent).join('/');
}

function githubHeaders(accept = 'application/vnd.github.v3+json') {
    const token = getToken();
    const headers = { 'Accept': accept };
    if (token) {
        headers['Authorization'] = token.startsWith('github_pat_') ? `Bearer ${token}` : `token ${token}`;
    }
    return headers;
}

async function fetchGitHub(path) {
    const token = getToken();
    if (!token) {
        openSettingsModal();
        throw new Error('No GitHub token configured');
    }
    const url = `${API_BASE}/${encodePath(path)}?ref=${CONFIG.branch}`;
    const resp = await fetch(url, { headers: githubHeaders() });
    if (resp.status === 401) {
        showToast('Token Error: 401 Bad Credentials 🔑');
        openSettingsModal();
        throw new Error('401 Unauthorized');
    }
    if (resp.status === 403) {
        showToast('Token Error: 403 Lacks Contents Read Permission ⚠️');
        throw new Error('403 Forbidden');
    }
    if (!resp.ok) {
        throw new Error(`GitHub API error ${resp.status}`);
    }
    return resp.json();
}

async function fetchRawBlob(path) {
    const url = `${API_BASE}/${encodePath(path)}?ref=${CONFIG.branch}`;
    const resp = await fetch(url, { headers: githubHeaders('application/vnd.github.v3.raw') });
    if (!resp.ok) throw new Error(`Fetch error: ${resp.status}`);
    return resp.blob();
}

async function fetchRawText(path) {
    const url = `${API_BASE}/${encodePath(path)}?ref=${CONFIG.branch}`;
    const resp = await fetch(url, { headers: githubHeaders('application/vnd.github.v3.raw') });
    if (!resp.ok) throw new Error(`Fetch error: ${resp.status}`);
    return resp.text();
}

// ---- UTILITIES ----
function debounce(fn, ms = 150) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}

const sortCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
function naturalSort(a, b) {
    return sortCollator.compare(a, b);
}

function formatSize(bytes) {
    if (!bytes || bytes <= 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function escapeAttr(str) {
    if (!str) return '';
    return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function truncate(str, max) {
    return str && str.length > max ? str.slice(0, max) + '…' : str;
}

function formatRelativeTime(timestamp) {
    if (!timestamp) return '';
    const diff = Math.floor((Date.now() - timestamp) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    const days = Math.floor(diff / 86400);
    if (days < 7) return `${days}d ago`;
    const date = new Date(timestamp);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Icon helper
function getCategoryIconHtml(cfg, size = 32) {
    if (!cfg) return '📁';
    if (cfg.isImage) {
        return `<img src="${cfg.icon}" alt="${escapeAttr(cfg.path)}" style="width:${size}px;height:${size}px;object-fit:contain;">`;
    }
    return `<span style="font-size:${size * 0.75}px;">${cfg.icon}</span>`;
}

// ---- VIEW ROUTING ----
function showView(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById(`view-${name}`);
    if (target) {
        target.classList.add('active');
        if (name !== 'reader') {
            window.scrollTo(0, 0);
        }
    }
}

// ---- BOOKMARK SYSTEM ----
function loadBookmarks() {
    try {
        return JSON.parse(localStorage.getItem('mangacloud_bookmarks') || '{}');
    } catch {
        return {};
    }
}

function saveBookmark(key, scrollY) {
    if (!key) return;
    const bm = loadBookmarks();
    bm[key] = {
        scrollY: Math.round(scrollY || 0),
        time: Date.now()
    };
    try {
        localStorage.setItem('mangacloud_bookmarks', JSON.stringify(bm));
    } catch { /* ignore */ }
    updateReadingLogBookmark(key, bm[key].scrollY);
}

function getBookmark(key) {
    if (!key) return null;
    const bm = loadBookmarks();
    return bm[key] ? bm[key].scrollY : null;
}

function clearBookmark(key) {
    if (!key) return;
    const bm = loadBookmarks();
    if (bm[key]) {
        delete bm[key];
        try {
            localStorage.setItem('mangacloud_bookmarks', JSON.stringify(bm));
        } catch { /* ignore */ }
        updateReadingLogBookmark(key, null);
    }
}

function getItemBookmarkKey(item) {
    if (!item) return '';
    // Unique key: for AO3 it's story.storyKey; for Manga/Novela it's chapter path
    if (item.type === 'ao3_story') {
        return item.storyKey || item.path;
    }
    return item.path;
}

function updateBookmarkButtons() {
    const item = state.items[state.currentIndex];
    if (!item) {
        if (dom['btn-bookmark']) dom['btn-bookmark'].classList.remove('active');
        if (dom['btn-nav-bookmark']) dom['btn-nav-bookmark'].classList.remove('active');
        return;
    }
    const key = getItemBookmarkKey(item);
    const hasBm = getBookmark(key) !== null;

    if (dom['btn-bookmark']) dom['btn-bookmark'].classList.toggle('active', hasBm);
    if (dom['btn-nav-bookmark']) dom['btn-nav-bookmark'].classList.toggle('active', hasBm);
}

function toggleCurrentBookmark() {
    const item = state.items[state.currentIndex];
    if (!item) return;
    const key = getItemBookmarkKey(item);
    const existing = getBookmark(key);

    if (existing !== null) {
        clearBookmark(key);
        updateBookmarkButtons();
        showToast('Bookmark removed');
    } else {
        saveBookmark(key, window.scrollY);
        updateBookmarkButtons();
        showToast('Reading position bookmarked! 🔖');
    }
}

// ---- READING LOG & PROGRESS SYSTEM ----
function loadReadingLog() {
    try {
        return JSON.parse(localStorage.getItem('mangacloud_reading_log') || '{}');
    } catch {
        return {};
    }
}

function saveReadingLogRecord(record) {
    const log = loadReadingLog();
    log[record.id] = {
        ...log[record.id],
        ...record,
        lastReadTime: Date.now()
    };
    try {
        localStorage.setItem('mangacloud_reading_log', JSON.stringify(log));
    } catch { /* ignore */ }
    updateLogCountBadge();
}

function updateReadingLogBookmark(key, scrollY) {
    const log = loadReadingLog();
    let updated = false;
    for (const id in log) {
        if (log[id].currentBookmarkKey === key || log[id].id === key || id === key) {
            log[id].bookmark = scrollY;
            updated = true;
        }
    }
    if (updated) {
        try {
            localStorage.setItem('mangacloud_reading_log', JSON.stringify(log));
        } catch { /* ignore */ }
    }
}

function removeReadingLogRecord(id) {
    const log = loadReadingLog();
    if (log[id]) {
        delete log[id];
        try {
            localStorage.setItem('mangacloud_reading_log', JSON.stringify(log));
        } catch { /* ignore */ }
        updateLogCountBadge();
        renderReadingLogView();
        renderContinueReadingShelf();
    }
}

function clearAllReadingLog() {
    if (confirm('Are you sure you want to clear your entire reading log?')) {
        localStorage.removeItem('mangacloud_reading_log');
        updateLogCountBadge();
        renderReadingLogView();
        renderContinueReadingShelf();
        showToast('Reading log cleared');
    }
}

function updateLogCountBadge() {
    const count = Object.keys(loadReadingLog()).length;
    if (dom['header-log-count']) {
        dom['header-log-count'].textContent = count;
        dom['header-log-count'].style.display = count > 0 ? 'flex' : 'none';
    }
    if (dom['log-count-subtitle']) {
        dom['log-count-subtitle'].textContent = `${count} ${count === 1 ? 'story' : 'stories'} tracked`;
    }
}

// Record reading progress when an item is opened
function recordReadingProgress(item, index) {
    const rootCfg = state.currentRootConfig;
    if (!rootCfg || !item) return;

    if (rootCfg.storyIsFolder) {
        // Manga & Webtoon / Novela: Carpet is the Story!
        const storyId = state.currentPath;
        const storyTitle = state.currentSeriesName || storyId.split('/').pop();
        const chapterName = item.name.replace(/\.pdf$/i, '');
        const bmKey = getItemBookmarkKey(item);

        saveReadingLogRecord({
            id: storyId,
            type: rootCfg.path,
            category: rootCfg.path,
            title: storyTitle,
            folderPath: storyId,
            lastChapterName: chapterName,
            lastChapterIndex: index,
            totalChapters: state.items.length,
            currentBookmarkKey: bmKey,
            bookmark: getBookmark(bmKey)
        });
    } else {
        // AO3: Every file is its own story!
        const storyId = item.storyKey || item.path;
        const bmKey = getItemBookmarkKey(item);

        saveReadingLogRecord({
            id: storyId,
            type: 'ao3',
            category: 'ao3',
            title: item.baseName,
            folderPath: state.currentPath,
            storyKey: storyId,
            hasPdf: item.hasPdf,
            hasHtml: item.hasHtml,
            pdfPath: item.pdfFile ? item.pdfFile.path : null,
            htmlPath: item.htmlFile ? item.htmlFile.path : null,
            lastMode: state.isTextMode ? 'text' : 'pdf',
            currentBookmarkKey: bmKey,
            bookmark: getBookmark(bmKey)
        });
    }
    renderContinueReadingShelf();
}

// ---- HOME: CONTINUE READING SHELF ----
function renderContinueReadingShelf() {
    const section = dom['continue-reading'];
    const list = dom['continue-reading-list'];
    if (!section || !list) return;

    const log = loadReadingLog();
    const entries = Object.values(log).sort((a, b) => (b.lastReadTime || 0) - (a.lastReadTime || 0));

    if (entries.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    const recent = entries.slice(0, 8);

    list.innerHTML = recent.map(entry => {
        const rootCfg = CONFIG.rootFolders.find(r => r.path === entry.category);
        const iconHtml = rootCfg && rootCfg.isImage
            ? `<img src="${rootCfg.icon}" alt="" style="width:22px;height:22px;object-fit:contain;">`
            : (rootCfg ? rootCfg.icon : '📖');

        const displaySubtitle = entry.lastChapterName
            ? entry.lastChapterName
            : (entry.hasHtml && entry.hasPdf ? 'HTML + PDF' : (entry.hasHtml ? 'HTML' : 'PDF'));

        const hasBm = entry.currentBookmarkKey ? getBookmark(entry.currentBookmarkKey) !== null : false;

        return `
            <div class="cr-card" data-log-id="${escapeAttr(entry.id)}">
                <div class="cr-icon">${iconHtml}</div>
                <div class="cr-info">
                    <div class="cr-series">${escapeHtml(entry.title)}</div>
                    <div class="cr-chapter">
                        ${escapeHtml(displaySubtitle)}
                        ${hasBm ? '<span class="cr-bookmark-pill">🔖</span>' : ''}
                    </div>
                </div>
                <div class="cr-actions">
                    <button class="cr-btn cr-btn-remove" data-remove-id="${escapeAttr(entry.id)}" aria-label="Remove" title="Remove">✕</button>
                </div>
            </div>`;
    }).join('');
}

// ---- READING LOG VIEW RENDERING ----
let logFilterCategory = 'all';
let logSearchQuery = '';

function renderReadingLogView() {
    const listEl = dom['log-list'];
    if (!listEl) return;

    const log = loadReadingLog();
    let entries = Object.values(log).sort((a, b) => (b.lastReadTime || 0) - (a.lastReadTime || 0));

    // Category filter
    if (logFilterCategory !== 'all') {
        entries = entries.filter(e => e.category === logFilterCategory);
    }

    // Text search filter
    if (logSearchQuery.trim()) {
        const q = logSearchQuery.toLowerCase();
        entries = entries.filter(e =>
            (e.title && e.title.toLowerCase().includes(q)) ||
            (e.lastChapterName && e.lastChapterName.toLowerCase().includes(q))
        );
    }

    if (entries.length === 0) {
        listEl.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📜</div>
                <div class="empty-state-text">No started stories found${logSearchQuery ? ' matching your search' : ''}.</div>
            </div>`;
        return;
    }

    listEl.innerHTML = entries.map(entry => {
        const rootCfg = CONFIG.rootFolders.find(r => r.path === entry.category);
        const iconHtml = rootCfg && rootCfg.isImage
            ? `<img src="${rootCfg.icon}" alt="" style="width:28px;height:28px;object-fit:contain;">`
            : (rootCfg ? rootCfg.icon : '📖');

        const subtitle = entry.lastChapterName
            ? `Chapter: ${entry.lastChapterName}`
            : (entry.hasHtml && entry.hasPdf ? 'Story · HTML & PDF' : (entry.hasHtml ? 'Story · HTML' : 'Story · PDF'));

        const hasBm = entry.currentBookmarkKey ? getBookmark(entry.currentBookmarkKey) !== null : false;
        const timeAgo = formatRelativeTime(entry.lastReadTime);

        return `
            <div class="log-card" data-log-id="${escapeAttr(entry.id)}">
                <div class="log-card-icon">${iconHtml}</div>
                <div class="log-card-body">
                    <div class="log-card-header">
                        <div class="log-card-title">${escapeHtml(entry.title)}</div>
                        <span class="log-card-category">${escapeHtml(entry.category)}</span>
                    </div>
                    <div class="log-card-chapter">${escapeHtml(subtitle)}</div>
                    <div class="log-card-footer">
                        <span>🕒 ${timeAgo}</span>
                        ${hasBm ? '<span class="log-bookmark-badge">🔖 Bookmarked</span>' : ''}
                    </div>
                </div>
                <div class="log-card-actions">
                    <button class="btn-log-resume" data-resume-id="${escapeAttr(entry.id)}">Read</button>
                    <button class="btn-log-remove" data-remove-id="${escapeAttr(entry.id)}" title="Remove">✕</button>
                </div>
            </div>`;
    }).join('');
}

// Resume reading directly from log entry
async function resumeFromLog(logId) {
    const log = loadReadingLog();
    const entry = log[logId];
    if (!entry) return;

    showLoading(`Opening ${entry.title}...`);
    try {
        const rootCfg = CONFIG.rootFolders.find(r => r.path === entry.category);
        state.currentRootConfig = rootCfg;
        state.currentPath = entry.folderPath;
        state.currentSeriesName = entry.title;

        if (entry.category === 'ao3') {
            // AO3 story
            const items = await fetchGitHub(entry.folderPath);
            const { stories } = processAo3Items(items);
            state.items = stories;
            const idx = stories.findIndex(s => s.baseName === entry.title || (entry.storyKey && s.storyKey === entry.storyKey));
            hideLoading();
            if (idx >= 0) {
                state.navigationStack.push('log');
                openAo3Story(idx);
            } else {
                showToast('Story file not found in repository');
            }
        } else {
            // Manga or Novela series carpet
            const items = await fetchGitHub(entry.folderPath);
            const { pdfs } = processStandardItems(items);
            state.items = pdfs;
            const idx = entry.lastChapterIndex >= 0 && entry.lastChapterIndex < pdfs.length
                ? entry.lastChapterIndex
                : 0;
            hideLoading();
            state.navigationStack.push('log');
            openStandardChapter(idx);
        }
    } catch (err) {
        hideLoading();
        showToast('Error opening story from log');
        console.error(err);
    }
}

// ---- LIBRARY HOME VIEW ----
function renderLibraryHome() {
    const grid = dom['library-grid'];
    if (!grid) return;

    grid.innerHTML = CONFIG.rootFolders.map(folder => {
        const iconHtml = getCategoryIconHtml(folder, 36);
        const tagsHtml = folder.functions.map(f => {
            if (f === 1) return '<span class="folder-tag">Webtoon</span>';
            if (f === 2) return '<span class="folder-tag">HTML</span>';
            if (f === 3) return '<span class="folder-tag">PDF Text</span>';
            if (f === 4) return '<span class="folder-tag">Download</span>';
            return '';
        }).join('');

        return `
            <div class="folder-card" data-path="${escapeAttr(folder.path)}">
                <div class="folder-icon">${iconHtml}</div>
                <div class="folder-info">
                    <div class="folder-name">${escapeHtml(folder.path)}</div>
                    <div class="folder-desc">${escapeHtml(folder.desc)}</div>
                    <div class="folder-tags">${tagsHtml}</div>
                </div>
                <div class="folder-arrow">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M9 18l6-6-6-6"/>
                    </svg>
                </div>
            </div>`;
    }).join('');
}

// ---- FOLDER SCANNING & ITEM PROCESSING ----
// For Manga & Webtoon and Novela:
function processStandardItems(rawItems) {
    const folders = [];
    const pdfs = [];
    for (const item of rawItems) {
        if (item.type === 'dir') {
            folders.push(item);
        } else if (item.type === 'file' && item.name.toLowerCase().endsWith('.pdf')) {
            pdfs.push({
                ...item,
                type: 'pdf',
                baseName: item.name.replace(/\.pdf$/i, '')
            });
        }
    }
    folders.sort((a, b) => naturalSort(a.name, b.name));
    pdfs.sort((a, b) => naturalSort(a.name, b.name));
    return { folders, pdfs };
}

// For AO3: pairs .pdf and .html files sharing the same name into 1 story entry!
// Compares adjacent positions (1 position down i+1 and 1 position up i-1) in internal index.
function processAo3Items(rawItems) {
    const folders = [];
    const rawFiles = [];

    for (const item of rawItems) {
        if (item.type === 'dir') {
            folders.push(item);
        } else if (item.type === 'file') {
            const extMatch = item.name.match(/\.(pdf|html?)$/i);
            if (extMatch) {
                rawFiles.push({
                    ...item,
                    ext: extMatch[1].toLowerCase(),
                    baseName: item.name.replace(/\.(pdf|html?)$/i, '')
                });
            }
        }
    }

    folders.sort((a, b) => naturalSort(a.name, b.name));
    // Sort raw files so matching names (.html and .pdf) are adjacent in internal index
    rawFiles.sort((a, b) => naturalSort(a.name, b.name));

    // Internal index comparison: for each file, check 1 position down (i + 1) and 1 position up (i - 1)
    const storyMap = new Map();

    for (let i = 0; i < rawFiles.length; i++) {
        const file = rawFiles[i];
        const key = file.baseName.toLowerCase();

        let htmlFile = file.ext.startsWith('html') ? file : null;
        let pdfFile = file.ext === 'pdf' ? file : null;

        // Check 1 position up (i - 1) in internal index
        if (i > 0) {
            const prev = rawFiles[i - 1];
            if (prev.baseName.toLowerCase() === key) {
                if (prev.ext.startsWith('html')) htmlFile = prev;
                if (prev.ext === 'pdf') pdfFile = prev;
            }
        }

        // Check 1 position down (i + 1) in internal index
        if (i < rawFiles.length - 1) {
            const next = rawFiles[i + 1];
            if (next.baseName.toLowerCase() === key) {
                if (next.ext.startsWith('html')) htmlFile = next;
                if (next.ext === 'pdf') pdfFile = next;
            }
        }

        // Show only as 1 in the UI
        if (!storyMap.has(key)) {
            const parentDir = file.path.substring(0, file.path.lastIndexOf('/'));
            storyMap.set(key, {
                baseName: file.baseName,
                storyKey: `${parentDir}/${file.baseName}`,
                type: 'ao3_story',
                htmlFile: htmlFile,
                pdfFile: pdfFile,
                hasHtml: !!htmlFile,
                hasPdf: !!pdfFile,
                path: (pdfFile || htmlFile).path,
                name: (pdfFile || htmlFile).name,
                size: (pdfFile ? pdfFile.size : 0) || (htmlFile ? htmlFile.size : 0)
            });
        } else {
            const story = storyMap.get(key);
            if (htmlFile && !story.htmlFile) {
                story.htmlFile = htmlFile;
                story.hasHtml = true;
            }
            if (pdfFile && !story.pdfFile) {
                story.pdfFile = pdfFile;
                story.hasPdf = true;
            }
            story.path = (story.pdfFile || story.htmlFile).path;
            story.name = (story.pdfFile || story.htmlFile).name;
        }
    }

    const stories = Array.from(storyMap.values());
    stories.sort((a, b) => naturalSort(a.baseName, b.baseName));

    return { folders, stories, rawFiles };
}

// ---- NAVIGATION & BREADCRUMBS ----
function buildBreadcrumbs(containerEl, currentPath) {
    if (!containerEl) return;
    const parts = currentPath.split('/');
    if (parts.length <= 1) {
        containerEl.style.display = 'none';
        return;
    }
    containerEl.style.display = 'flex';

    let running = '';
    const crumbsHtml = parts.map((part, i) => {
        running = running ? `${running}/${part}` : part;
        const isLast = i === parts.length - 1;
        if (isLast) {
            return `<span class="breadcrumb-item active">${escapeHtml(part)}</span>`;
        }
        return `
            <a class="breadcrumb-item" data-breadcrumb="${escapeAttr(running)}">${escapeHtml(part)}</a>
            <span class="breadcrumb-sep">/</span>`;
    }).join('');

    containerEl.innerHTML = crumbsHtml;
}

// ---- FOLDER NAVIGATION ROUTER ----
async function openFolder(folderPath) {
    if (!getToken()) {
        openSettingsModal();
        return;
    }

    showLoading('Loading folder contents...');
    try {
        state.currentPath = folderPath;
        const rootCfg = CONFIG.rootFolders.find(r => folderPath.startsWith(r.path));
        state.currentRootConfig = rootCfg || state.currentRootConfig;

        const rawItems = await fetchGitHub(folderPath);

        if (state.currentRootConfig.path === 'ao3') {
            // AO3 Mode: arbitrary nesting
            const { folders, stories } = processAo3Items(rawItems);
            hideLoading();

            if (folders.length > 0 && stories.length === 0) {
                // Folder containing only subfolders -> show in series view
                renderSeriesView(folderPath, folders);
            } else {
                // Mixed folders + stories, or pure stories -> show in chapters view
                renderAo3ChaptersView(folderPath, folders, stories);
            }
        } else {
            // Manga & Webtoon or Novela Mode
            const { folders, pdfs } = processStandardItems(rawItems);
            hideLoading();

            if (folders.length > 0 && pdfs.length === 0) {
                // Series folders level
                renderSeriesView(folderPath, folders);
            } else {
                // Chapters level
                renderStandardChaptersView(folderPath, folders, pdfs);
            }
        }
    } catch (err) {
        hideLoading();
        showToast('Error loading folder');
        console.error(err);
    }
}

// ---- SERIES VIEW RENDERING ----
function renderSeriesView(folderPath, folders) {
    const listEl = dom['series-list'];
    dom['series-title'].textContent = folderPath.split('/').pop();
    dom['series-subtitle'].textContent = `${folders.length} ${folders.length === 1 ? 'folder' : 'folders'}`;

    buildBreadcrumbs(dom['series-breadcrumbs'], folderPath);
    if (dom['series-search-input']) dom['series-search-input'].value = '';

    const iconHtml = getCategoryIconHtml(state.currentRootConfig, 36);

    listEl.innerHTML = folders.map(f => {
        const lastRead = loadReadingLog()[f.path];
        const badgeHtml = lastRead
            ? `<div class="series-badge">↗ ${escapeHtml(lastRead.lastChapterName || 'In progress')}</div>`
            : '';

        return `
            <div class="series-card" data-path="${escapeAttr(f.path)}" data-name="${escapeAttr(f.name)}">
                <button class="series-download-btn" data-download-folder="${escapeAttr(f.path)}" data-folder-name="${escapeAttr(f.name)}" title="Download folder as ZIP">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                </button>
                <div class="series-emoji">${iconHtml}</div>
                <div class="series-name">${escapeHtml(f.name)}</div>
                ${badgeHtml}
            </div>`;
    }).join('');

    showView('series');
}

// ---- CHAPTERS VIEW: MANGA & NOVELA ----
function renderStandardChaptersView(folderPath, subfolders, pdfs) {
    state.items = pdfs;
    state.currentSeriesName = folderPath.split('/').pop();

    dom['chapters-title'].textContent = state.currentSeriesName;
    const subParts = [];
    if (subfolders.length > 0) subParts.push(`${subfolders.length} folders`);
    if (pdfs.length > 0) subParts.push(`${pdfs.length} chapters`);
    dom['chapters-subtitle'].textContent = subParts.join(' · ') || 'Empty folder';

    buildBreadcrumbs(dom['chapters-breadcrumbs'], folderPath);
    if (dom['chapters-search-input']) dom['chapters-search-input'].value = '';

    const listEl = dom['chapters-list'];
    const logRecord = loadReadingLog()[folderPath];
    const lastReadChapter = logRecord ? logRecord.lastChapterName : null;

    // Subfolders (if any)
    const folderHtml = subfolders.map(f => `
        <div class="chapter-item chapter-folder" data-type="folder" data-path="${escapeAttr(f.path)}">
            <div class="chapter-number chapter-folder-icon">📁</div>
            <div class="chapter-info">
                <div class="chapter-name">${escapeHtml(f.name)}</div>
                <div class="chapter-meta"><span>Folder</span></div>
            </div>
            <div class="chapter-read-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M9 18l6-6-6-6"/>
                </svg>
            </div>
        </div>`).join('');

    // Chapter PDFs
    const pdfHtml = pdfs.map((pdf, idx) => {
        const isLastRead = lastReadChapter === pdf.baseName;
        const bm = getBookmark(pdf.path) !== null;

        return `
            <div class="chapter-item ${isLastRead ? 'last-read' : ''}" data-type="standard_chapter" data-index="${idx}">
                <div class="chapter-number">${idx + 1}</div>
                <div class="chapter-info">
                    <div class="chapter-name">${escapeHtml(pdf.baseName)}</div>
                    <div class="chapter-meta">
                        <span>${formatSize(pdf.size)}</span>
                        ${isLastRead ? '<span>· Last read</span>' : ''}
                        ${bm ? '<span style="color:var(--accent-gold);">· 🔖</span>' : ''}
                    </div>
                </div>
                <button class="chapter-download-btn" data-download-idx="${idx}" title="Download chapter PDF">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                </button>
                <div class="chapter-read-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M9 18l6-6-6-6"/>
                    </svg>
                </div>
            </div>`;
    }).join('');

    listEl.innerHTML = folderHtml + pdfHtml || `
        <div class="empty-state">
            <div class="empty-state-icon">📭</div>
            <div class="empty-state-text">No chapters found in this folder</div>
        </div>`;

    showView('chapters');
}

// ---- CHAPTERS VIEW: AO3 (Stories & Nested Folders) ----
function renderAo3ChaptersView(folderPath, subfolders, stories) {
    state.items = stories;
    state.currentSeriesName = folderPath.split('/').pop();

    dom['chapters-title'].textContent = state.currentSeriesName;
    const subParts = [];
    if (subfolders.length > 0) subParts.push(`${subfolders.length} folders`);
    if (stories.length > 0) subParts.push(`${stories.length} stories`);
    dom['chapters-subtitle'].textContent = subParts.join(' · ') || 'Empty folder';

    buildBreadcrumbs(dom['chapters-breadcrumbs'], folderPath);
    if (dom['chapters-search-input']) dom['chapters-search-input'].value = '';

    const listEl = dom['chapters-list'];

    // Subfolders
    const folderHtml = subfolders.map(f => `
        <div class="chapter-item chapter-folder" data-type="folder" data-path="${escapeAttr(f.path)}">
            <div class="chapter-number chapter-folder-icon">📁</div>
            <div class="chapter-info">
                <div class="chapter-name">${escapeHtml(f.name)}</div>
                <div class="chapter-meta"><span>Folder</span></div>
            </div>
            <div class="chapter-read-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M9 18l6-6-6-6"/>
                </svg>
            </div>
        </div>`).join('');

    // Story items (merged by base name!)
    const storiesHtml = stories.map((story, idx) => {
        let badgeClass = 'html';
        let badgeText = 'HTML';
        if (story.hasHtml && story.hasPdf) {
            badgeClass = 'both';
            badgeText = 'HTML + PDF';
        } else if (story.hasPdf) {
            badgeClass = 'pdf';
            badgeText = 'PDF';
        }

        const bm = getBookmark(getItemBookmarkKey(story)) !== null;
        const logRecord = loadReadingLog()[story.storyKey || story.path];

        return `
            <div class="chapter-item ${logRecord ? 'last-read' : ''}" data-type="ao3_story" data-index="${idx}">
                <div class="chapter-number">${idx + 1}</div>
                <div class="chapter-info">
                    <div class="chapter-name">${escapeHtml(story.baseName)}</div>
                    <div class="chapter-meta">
                        <span class="badge-format ${badgeClass}">${badgeText}</span>
                        <span>${formatSize(story.size)}</span>
                        ${bm ? '<span style="color:var(--accent-gold);">· 🔖</span>' : ''}
                    </div>
                </div>
                <button class="chapter-download-btn" data-download-idx="${idx}" title="Download story">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                </button>
                <div class="chapter-read-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M9 18l6-6-6-6"/>
                    </svg>
                </div>
            </div>`;
    }).join('');

    listEl.innerHTML = folderHtml + storiesHtml || `
        <div class="empty-state">
            <div class="empty-state-icon">📭</div>
            <div class="empty-state-text">No stories found in this folder</div>
        </div>`;

    showView('chapters');
}

// ============================================
// FUNCTION 1: WEBTOON PDF RENDERER (Descendent images)
// ============================================
let pdfjsReadyPromise = null;
function initPdfJs() {
    if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        return Promise.resolve(window.pdfjsLib);
    }
    if (pdfjsReadyPromise) return pdfjsReadyPromise;
    pdfjsReadyPromise = new Promise(resolve => {
        const interval = setInterval(() => {
            if (window.pdfjsLib) {
                clearInterval(interval);
                window.pdfjsLib.GlobalWorkerOptions.workerSrc =
                    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                resolve(window.pdfjsLib);
            }
        }, 50);
    });
    return pdfjsReadyPromise;
}

// Render PDF pages as continuous vertical canvases
async function renderPdfWebtoon(pdfBlob, itemTitle) {
    state.isTextMode = false;
    const container = dom['reader-container'];
    container.innerHTML = '';
    container.classList.remove('text-mode');
    dom['reader-text-toolbar'].style.display = 'none';

    dom['reader-title'].textContent = itemTitle;
    dom['reader-progress'].textContent = 'Rendering pages...';

    const gen = ++state.renderGen;
    const pdfLib = await initPdfJs();
    const arrayBuffer = await pdfBlob.arrayBuffer();
    if (gen !== state.renderGen) return;

    const pdf = await pdfLib.getDocument({ data: arrayBuffer }).promise;
    if (gen !== state.renderGen) return;

    const totalPages = pdf.numPages;
    dom['reader-progress'].textContent = `${totalPages} pages`;

    const dpr = Math.min(window.devicePixelRatio || 1, 2.0);
    const containerWidth = Math.min(window.innerWidth, 820);
    const frag = document.createDocumentFragment();

    const renderPage = async pageNum => {
        if (gen !== state.renderGen) return;
        if (pageNum > totalPages) {
            container.appendChild(frag);
            dom['reader-progress'].textContent = `${totalPages} pages`;
            finishReaderSetup();
            return;
        }

        const page = await pdf.getPage(pageNum);
        if (gen !== state.renderGen) return;

        const unscaled = page.getViewport({ scale: 1 });
        const scale = (containerWidth * dpr) / unscaled.width;
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = '100%';
        canvas.style.height = 'auto';
        frag.appendChild(canvas);

        await page.render({
            canvasContext: canvas.getContext('2d'),
            viewport: viewport
        }).promise;

        if (gen !== state.renderGen) return;

        dom['reader-progress'].textContent = `Page ${pageNum} / ${totalPages}`;
        if (pageNum % 4 === 0) {
            container.appendChild(frag);
        }

        renderPage(pageNum + 1);
    };

    renderPage(1);
}

// ============================================
// FUNCTION 2: READ TEXT FROM HTML FILE
// ============================================
function sanitizeAndExtractHtml(rawHtml) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawHtml, 'text/html');

    // Remove unsafe or noisy elements
    const removeSelectors = ['script', 'style', 'iframe', 'object', 'embed', 'link'];
    removeSelectors.forEach(sel => {
        doc.querySelectorAll(sel).forEach(el => el.remove());
    });

    // Check for AO3 exported HTML structure:
    // AO3 exports contain #preface and #chapters (.userstuff)
    const prefaceEl = doc.getElementById('preface');
    const chaptersEl = doc.getElementById('chapters') || doc.querySelector('.userstuff') || doc.body;

    let prefaceHtml = '';
    if (prefaceEl) {
        const titleEl = prefaceEl.querySelector('.title, h1');
        const authorEl = prefaceEl.querySelector('.byline, h2');
        const summaryEl = prefaceEl.querySelector('.summary');
        const tagsEl = prefaceEl.querySelector('.tags');

        const titleText = titleEl ? titleEl.textContent.trim() : '';
        const authorText = authorEl ? authorEl.textContent.trim() : '';
        const summaryHtml = summaryEl ? summaryEl.innerHTML.trim() : '';

        const tagsList = tagsEl ? Array.from(tagsEl.querySelectorAll('dd, li')).map(t => t.textContent.trim()).filter(Boolean) : [];

        prefaceHtml = `
            <div class="ao3-preface-card">
                ${titleText ? `<h1 class="ao3-title">${escapeHtml(titleText)}</h1>` : ''}
                ${authorText ? `<div class="ao3-author">${escapeHtml(authorText)}</div>` : ''}
                ${tagsList.length > 0 ? `
                    <div class="ao3-tags-list">
                        ${tagsList.map(tag => `<span class="ao3-tag-pill">${escapeHtml(tag)}</span>`).join('')}
                    </div>` : ''}
                ${summaryHtml ? `
                    <div class="ao3-summary-box">
                        <div class="ao3-summary-title">Summary:</div>
                        ${summaryHtml}
                    </div>` : ''}
            </div>`;
    }

    // Process chapters / body text into semantic paragraphs
    // Ensure all styles that would override black-on-white are stripped
    const cleanNodes = [];
    const elements = chaptersEl.querySelectorAll('p, h1, h2, h3, h4, hr, blockquote, img');

    if (elements.length > 0) {
        elements.forEach(el => {
            const tag = el.tagName.toLowerCase();
            if (tag === 'hr') {
                cleanNodes.push('<hr class="text-section-break">');
            } else if (tag === 'p') {
                const text = el.textContent.trim();
                if (text) {
                    if (isSectionBreakText(text)) {
                        cleanNodes.push('<hr class="text-section-break">');
                    } else {
                        // Strip inline color/background overrides so black-on-white persists
                        el.removeAttribute('style');
                        el.querySelectorAll('*').forEach(child => child.removeAttribute('style'));
                        cleanNodes.push(`<p>${el.innerHTML}</p>`);
                    }
                }
            } else if (['h1', 'h2', 'h3', 'h4'].includes(tag)) {
                cleanNodes.push(`<${tag} style="margin: 1.5em 0 0.8em; font-weight:700;">${escapeHtml(el.textContent.trim())}</${tag}>`);
            } else if (tag === 'blockquote') {
                cleanNodes.push(`<blockquote style="border-left:3px solid #cbd5e1; padding-left:14px; margin:16px 0; font-style:italic;">${el.innerHTML}</blockquote>`);
            } else if (tag === 'img') {
                const src = el.getAttribute('src');
                if (src && !src.startsWith('javascript:')) {
                    cleanNodes.push(`<img src="${escapeAttr(src)}" alt="${escapeAttr(el.alt || '')}" class="story-inline-img" loading="lazy">`);
                }
            }
        });
    } else {
        // Fallback: split body text by double newline
        const lines = chaptersEl.textContent.split(/\n\s*\n/);
        lines.forEach(line => {
            const t = line.trim();
            if (t) {
                if (isSectionBreakText(t)) {
                    cleanNodes.push('<hr class="text-section-break">');
                } else {
                    cleanNodes.push(`<p>${escapeHtml(t)}</p>`);
                }
            }
        });
    }

    return {
        prefaceHtml,
        bodyHtml: cleanNodes.join('\n')
    };
}

async function renderHtmlStory(htmlPath, itemTitle) {
    state.isTextMode = true;
    const container = dom['reader-container'];
    container.innerHTML = '';
    container.classList.add('text-mode');
    dom['reader-text-toolbar'].style.display = 'flex';

    dom['reader-title'].textContent = itemTitle;
    dom['reader-progress'].textContent = 'Text Mode (HTML)';

    applyTypographySettings();

    showLoading('Loading story HTML...');
    const rawHtml = await fetchRawText(htmlPath);
    hideLoading();

    const { prefaceHtml, bodyHtml } = sanitizeAndExtractHtml(rawHtml);

    const article = document.createElement('article');
    article.className = `story-text-body ${state.isSerif ? 'font-serif' : ''}`;
    article.innerHTML = prefaceHtml + bodyHtml;

    container.appendChild(article);
    finishReaderSetup();
}

// ============================================
// FUNCTION 3: EXTRACT TEXT FROM PDF (Chrome Translation Ready)
// ============================================
function isSectionBreakText(text) {
    const t = text.trim();
    if (!t) return false;
    if (/^[.\u2026\u22EF]+$/.test(t)) return false; // purely dots/ellipsis are not section breaks
    return !/[a-zA-Z0-9\u00C0-\u024F]/.test(t) && t.length >= 2;
}

// Intelligently rebuilds paragraphs from PDF coordinate text stream
function extractParagraphsFromPdfPage(textContent) {
    const items = textContent.items;
    const lines = [];
    let currentLine = '';
    let lastY = null;
    let lastHeight = null;
    let lastX = null;
    let lastWidth = null;

    const flushLine = () => {
        if (currentLine.trim()) lines.push(currentLine.trim());
        currentLine = '';
        lastY = null; lastX = null; lastWidth = null;
    };

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const str = item.str;

        if (!str || str.trim() === '') {
            if (str && currentLine && !currentLine.endsWith(' ')) currentLine += ' ';
            if (item.hasEOL) flushLine();
            continue;
        }

        const y = item.transform ? item.transform[5] : null;
        const x = item.transform ? item.transform[4] : null;
        const height = (item.height && item.height > 0) ? item.height : (lastHeight || 9);
        const threshold = height * 0.45;

        const prevHadEOL = (i > 0 && items[i - 1].hasEOL);
        const sameLine = !prevHadEOL && (lastY === null || y === null || Math.abs(y - lastY) <= threshold);

        if (!sameLine) {
            flushLine();
            currentLine = str;
        } else {
            if (currentLine && !currentLine.endsWith(' ') && !str.startsWith(' ')) {
                currentLine += ' ';
            }
            currentLine += str;
        }

        lastY = y;
        lastX = x;
        lastWidth = item.width;
        if (item.height > 0) lastHeight = item.height;
        if (item.hasEOL) flushLine();
    }
    if (currentLine.trim()) lines.push(currentLine.trim());

    // Merge lines into coherent paragraphs
    const paragraphs = [];
    let para = '';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (isSectionBreakText(line)) {
            if (para.trim()) paragraphs.push(para.trim());
            paragraphs.push('---');
            para = '';
            continue;
        }

        if (para && line.length > 0) {
            const prevEnds = /[.!?:;"'»)\]…”’»]$/.test(para);
            const lineStarts = /^[A-ZÀ-ÖØ-Þ"'«(\[¿¡“‘—–]/.test(line);
            const isShort = para.length < 55;

            if ((prevEnds && lineStarts) || isShort) {
                if (para.trim()) paragraphs.push(para.trim());
                para = line;
            } else {
                para += ' ' + line;
            }
        } else {
            para += (para ? ' ' : '') + line;
        }
    }
    if (para.trim()) paragraphs.push(para.trim());

    return paragraphs;
}

async function renderPdfAsExtractedText(pdfBlob, itemTitle) {
    state.isTextMode = true;
    const container = dom['reader-container'];
    container.innerHTML = '';
    container.classList.add('text-mode');
    dom['reader-text-toolbar'].style.display = 'flex';

    dom['reader-title'].textContent = itemTitle;
    dom['reader-progress'].textContent = 'Extracting text...';

    applyTypographySettings();

    const gen = ++state.renderGen;
    const pdfLib = await initPdfJs();
    const arrayBuffer = await pdfBlob.arrayBuffer();
    if (gen !== state.renderGen) return;

    const pdf = await pdfLib.getDocument({ data: arrayBuffer }).promise;
    if (gen !== state.renderGen) return;

    const totalPages = pdf.numPages;
    const article = document.createElement('article');
    article.className = `story-text-body ${state.isSerif ? 'font-serif' : ''}`;
    container.appendChild(article);

    let pendingCarryOver = '';

    const extractPage = async pageNum => {
        if (gen !== state.renderGen) return;
        if (pageNum > totalPages) {
            if (pendingCarryOver) {
                const p = document.createElement('p');
                p.textContent = pendingCarryOver;
                article.appendChild(p);
            }
            dom['reader-progress'].textContent = `Extracted ${totalPages} pages`;
            finishReaderSetup();
            return;
        }

        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        let paragraphs = extractParagraphsFromPdfPage(textContent);

        if (pendingCarryOver) {
            if (paragraphs.length > 0) {
                const startsLower = /^[a-zà-öø-þ,;:—–]/.test(paragraphs[0]);
                const prevIncomplete = !/[.!?…"'»)\]]\s*$/.test(pendingCarryOver);
                if (prevIncomplete || startsLower) {
                    paragraphs[0] = pendingCarryOver + ' ' + paragraphs[0];
                } else {
                    paragraphs.unshift(pendingCarryOver);
                }
            }
            pendingCarryOver = '';
        }

        if (paragraphs.length > 0 && pageNum < totalPages) {
            const last = paragraphs[paragraphs.length - 1];
            if (last !== '---' && !/[.!?…"'»)\]]\s*$/.test(last)) {
                pendingCarryOver = last;
                paragraphs = paragraphs.slice(0, -1);
            }
        }

        for (const pText of paragraphs) {
            if (pText === '---') {
                const hr = document.createElement('hr');
                hr.className = 'text-section-break';
                article.appendChild(hr);
            } else {
                const p = document.createElement('p');
                p.textContent = pText;
                article.appendChild(p);
            }
        }

        dom['reader-progress'].textContent = `Extracted page ${pageNum} / ${totalPages}`;
        extractPage(pageNum + 1);
    };

    extractPage(1);
}

// ---- TYPOGRAPHY CONTROLS ----
function applyTypographySettings() {
    document.documentElement.style.setProperty('--reader-font-size', `${state.fontSize}px`);
    if (dom['font-size-val']) dom['font-size-val'].textContent = `${state.fontSize}px`;

    const bodyEl = document.querySelector('.story-text-body');
    if (bodyEl) {
        bodyEl.classList.toggle('font-serif', state.isSerif);
    }
    if (dom['btn-font-family']) {
        dom['btn-font-family'].textContent = state.isSerif ? 'Sans' : 'Serif';
    }
}

function changeFontSize(delta) {
    state.fontSize = Math.min(Math.max(state.fontSize + delta, 13), 32);
    localStorage.setItem('mangacloud_font_size', state.fontSize);
    applyTypographySettings();
}

function toggleFontFamily() {
    state.isSerif = !state.isSerif;
    localStorage.setItem('mangacloud_font_serif', state.isSerif ? 'true' : 'false');
    applyTypographySettings();
}

// ---- READER POST-LOAD SETUP ----
function finishReaderSetup() {
    hideLoading();
    showView('reader');

    const item = state.items[state.currentIndex];
    recordReadingProgress(item, state.currentIndex);
    updateBookmarkButtons();
    updateReaderNavButtons();
    updateReaderModeToggleButton();

    // Check if there is an active bookmark for this item to jump to
    const key = getItemBookmarkKey(item);
    const savedY = getBookmark(key);
    if (savedY !== null && savedY > 0) {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                window.scrollTo({ top: savedY, behavior: 'smooth' });
                showToast('📖 Jumped to bookmarked position');
            });
        });
    } else {
        window.scrollTo(0, 0);
    }

    state.headerVisible = true;
    dom['reader-header'].classList.remove('hidden');
    dom['chapter-nav'].classList.remove('hidden');
    startHeaderHideTimer();
}

function updateReaderNavButtons() {
    dom['btn-prev-chapter'].disabled = state.currentIndex <= 0;
    dom['btn-next-chapter'].disabled = state.currentIndex >= state.items.length - 1;
}

function updateReaderModeToggleButton() {
    const item = state.items[state.currentIndex];
    const isAo3 = state.currentRootConfig && state.currentRootConfig.path === 'ao3';

    if (isAo3 && item && item.hasPdf) {
        dom['btn-toggle-mode'].style.display = 'flex';
        if (state.isTextMode) {
            dom['toggle-mode-icon'].textContent = '📄';
            dom['toggle-mode-text'].textContent = 'PDF';
            dom['btn-toggle-mode'].setAttribute('title', 'Switch to Webtoon PDF mode');
        } else {
            dom['toggle-mode-icon'].textContent = '📝';
            dom['toggle-mode-text'].textContent = 'Text';
            dom['btn-toggle-mode'].setAttribute('title', 'Switch to Extracted Text mode');
        }
    } else {
        dom['btn-toggle-mode'].style.display = 'none';
    }
}

// Toggle between Text and PDF mode for AO3 story
async function toggleAo3ReaderMode() {
    const item = state.items[state.currentIndex];
    if (!item || !item.hasPdf) return;

    if (state.isTextMode) {
        // Switch to PDF mode
        showLoading('Opening PDF mode...');
        if (!state.currentBlob) {
            state.currentBlob = await fetchRawBlob(item.pdfFile.path);
        }
        await renderPdfWebtoon(state.currentBlob, item.baseName);
        showToast('Switched to PDF 📄');
    } else {
        // Switch to Text mode
        showLoading('Opening Text mode...');
        if (item.hasHtml) {
            await renderHtmlStory(item.htmlFile.path, item.baseName);
        } else {
            if (!state.currentBlob) {
                state.currentBlob = await fetchRawBlob(item.pdfFile.path);
            }
            await renderPdfAsExtractedText(state.currentBlob, item.baseName);
        }
        showToast('Switched to Text 📝');
    }
}

// ---- OPENING CHAPTERS & STORIES ----
// Manga & Novela (Function 1: Webtoon PDF)
async function openStandardChapter(index) {
    if (index < 0 || index >= state.items.length) return;
    state.currentIndex = index;
    const chapter = state.items[index];

    showLoading(`Downloading ${chapter.baseName}...`);
    try {
        state.currentBlob = await fetchRawBlob(chapter.path);
        showLoading('Rendering chapter...');
        await renderPdfWebtoon(state.currentBlob, chapter.baseName);
    } catch (err) {
        hideLoading();
        showToast('Error loading chapter');
        console.error(err);
    }
}

// AO3 Story: "app open files as text by default, and once open the file, ther's a button to change to pdf if is aviable"
async function openAo3Story(index, forcePdf = false) {
    if (index < 0 || index >= state.items.length) return;
    state.currentIndex = index;
    const story = state.items[index];

    showLoading(`Opening ${story.baseName}...`);
    try {
        if (forcePdf && story.hasPdf) {
            state.currentBlob = await fetchRawBlob(story.pdfFile.path);
            await renderPdfWebtoon(state.currentBlob, story.baseName);
        } else {
            // Default to text!
            // "when extract text, use teh HTML file"
            if (story.hasHtml) {
                await renderHtmlStory(story.htmlFile.path, story.baseName);
            } else if (story.hasPdf) {
                state.currentBlob = await fetchRawBlob(story.pdfFile.path);
                await renderPdfAsExtractedText(state.currentBlob, story.baseName);
            }
        }
    } catch (err) {
        hideLoading();
        showToast('Error opening story');
        console.error(err);
    }
}

// Navigate to previous/next chapter
function navigateReader(direction) {
    const currentItem = state.items[state.currentIndex];

    // USER REQUIREMENT: "if go to next chapter, will remove the bookmark"
    if (direction === 1 && currentItem) {
        const key = getItemBookmarkKey(currentItem);
        clearBookmark(key);
    }

    const targetIdx = state.currentIndex + direction;
    if (targetIdx < 0 || targetIdx >= state.items.length) return;

    cleanupReader();

    if (state.currentRootConfig && state.currentRootConfig.path === 'ao3') {
        openAo3Story(targetIdx);
    } else {
        openStandardChapter(targetIdx);
    }
}

// Reader auto-hide header
function startHeaderHideTimer() {
    clearTimeout(state.hideTimer);
    state.hideTimer = setTimeout(() => {
        if (state.isTextMode) return; // Keep visible in text mode for easy reading
        state.headerVisible = false;
        dom['reader-header'].classList.add('hidden');
        dom['chapter-nav'].classList.add('hidden');
    }, 3200);
}

function toggleReaderUI() {
    state.headerVisible = !state.headerVisible;
    if (state.headerVisible) {
        dom['reader-header'].classList.remove('hidden');
        dom['chapter-nav'].classList.remove('hidden');
        startHeaderHideTimer();
    } else {
        dom['reader-header'].classList.add('hidden');
        dom['chapter-nav'].classList.add('hidden');
    }
}

function cleanupReader() {
    clearTimeout(state.hideTimer);
    state.currentBlob = null;
    state.renderGen++;
    if (dom['reader-container']) {
        const canvases = dom['reader-container'].querySelectorAll('canvas');
        canvases.forEach(c => {
            c.width = 1;
            c.height = 1;
            const ctx = c.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, 1, 1);
        });
        dom['reader-container'].innerHTML = '';
    }
}

// ============================================
// FUNCTION 4: DOWNLOADS (Individual & Folders)
// ============================================
// Download single file
async function downloadFileFromUrl(path, fileName, btnEl) {
    if (btnEl) btnEl.disabled = true;
    showToast(`Downloading ${fileName}...`);
    try {
        const blob = await fetchRawBlob(path);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        showToast(`Downloaded ${fileName}! ✓`);
    } catch (err) {
        console.error(err);
        showToast('Error downloading file');
    } finally {
        if (btnEl) btnEl.disabled = false;
    }
}

// Download current item open in reader
function downloadCurrentReaderItem() {
    const item = state.items[state.currentIndex];
    if (!item) return;

    if (state.currentRootConfig && state.currentRootConfig.path === 'ao3') {
        // "if wants to download, download the pdf file"
        if (item.hasPdf) {
            downloadFileFromUrl(item.pdfFile.path, item.pdfFile.name, dom['btn-download']);
        } else if (item.hasHtml) {
            downloadFileFromUrl(item.htmlFile.path, item.htmlFile.name, dom['btn-download']);
        }
    } else {
        downloadFileFromUrl(item.path, item.name, dom['btn-download']);
    }
}

// Download story from chapter/story list
function downloadItemByIndex(idx, btnEl) {
    const item = state.items[idx];
    if (!item) return;

    if (state.currentRootConfig && state.currentRootConfig.path === 'ao3') {
        // "if wants to download, download the pdf file"
        if (item.hasPdf) {
            downloadFileFromUrl(item.pdfFile.path, item.pdfFile.name, btnEl);
        } else if (item.hasHtml) {
            downloadFileFromUrl(item.htmlFile.path, item.htmlFile.name, btnEl);
        }
    } else {
        downloadFileFromUrl(item.path, item.name, btnEl);
    }
}

// Collect files recursively for ZIP download
async function collectFilesRecursively(folderPath, isAo3) {
    const items = await fetchGitHub(folderPath);
    const files = [];

    if (isAo3) {
        // For AO3: pair items; "if wants to download, download the pdf file"
        const { folders, stories } = processAo3Items(items);
        for (const story of stories) {
            if (story.hasPdf) {
                files.push(story.pdfFile);
            } else if (story.hasHtml) {
                files.push(story.htmlFile);
            }
        }
        for (const sub of folders) {
            const subFiles = await collectFilesRecursively(sub.path, true);
            files.push(...subFiles);
        }
    } else {
        // Manga & Novela: collect PDFs
        for (const item of items) {
            if (item.type === 'file' && item.name.toLowerCase().endsWith('.pdf')) {
                files.push(item);
            } else if (item.type === 'dir') {
                const subFiles = await collectFilesRecursively(item.path, false);
                files.push(...subFiles);
            }
        }
    }
    return files;
}

// Folder ZIP download
let isDownloadingZip = false;
async function downloadFolderAsZip(folderPath, folderName, btnEl) {
    if (!getToken()) {
        openSettingsModal();
        return;
    }
    if (isDownloadingZip) {
        showToast('A download is already in progress...');
        return;
    }

    isDownloadingZip = true;
    if (btnEl) btnEl.disabled = true;
    const safeZipName = (folderName || 'cloud_collection').replace(/[\\/:*?"<>|]/g, '_');

    try {
        showLoading(`Scanning ${folderName}...`);
        const isAo3 = folderPath.startsWith('ao3');
        const files = await collectFilesRecursively(folderPath, isAo3);

        if (files.length === 0) {
            hideLoading();
            showToast(`No downloadable files found in ${folderName}`);
            return;
        }

        const zip = new JSZip();
        const total = files.length;

        for (let i = 0; i < total; i++) {
            const file = files[i];
            showLoading(`Downloading (${i + 1}/${total}):\n${truncate(file.name, 28)}`);
            let blob = null;
            for (let attempt = 1; attempt <= 2; attempt++) {
                try {
                    blob = await fetchRawBlob(file.path);
                    break;
                } catch (fetchErr) {
                    if (attempt === 2) throw fetchErr;
                    await new Promise(r => setTimeout(r, 600));
                }
            }
            const relPath = file.path.startsWith(`${folderPath}/`)
                ? file.path.substring(folderPath.length + 1)
                : file.name;
            zip.file(relPath, blob);
        }

        showLoading(`Generating ZIP archive for ${folderName}...`);
        const zipBlob = await zip.generateAsync({
            type: 'blob',
            compression: 'STORE'
        }, meta => {
            showLoading(`Packaging ZIP: ${Math.round(meta.percent)}%`);
        });

        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${safeZipName}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 3000);

        hideLoading();
        showToast(`Downloaded ${safeZipName}.zip (${total} files)! 📦`);
    } catch (err) {
        console.error('ZIP download error:', err);
        hideLoading();
        showToast('ZIP download error');
    } finally {
        isDownloadingZip = false;
        if (btnEl) btnEl.disabled = false;
    }
}

// ---- SETTINGS MODAL (PASSWORD MODE) ----
function openSettingsModal() {
    const input = dom['token-input'];
    input.value = getToken();
    input.type = 'password';
    dom['settings-modal'].classList.add('active');
    setTimeout(() => input.focus(), 80);
}

function closeSettingsModal() {
    dom['settings-modal'].classList.remove('active');
}

function toggleTokenVisibility() {
    const input = dom['token-input'];
    const btn = dom['btn-toggle-token-visibility'];
    if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🙈';
    } else {
        input.type = 'password';
        btn.textContent = '👁️';
    }
}

// ---- EVENT LISTENERS SETUP ----
function initEventListeners() {
    // Top Header Buttons
    dom['btn-open-log'].addEventListener('click', () => {
        renderReadingLogView();
        showView('log');
    });

    dom['btn-see-all-log'].addEventListener('click', () => {
        renderReadingLogView();
        showView('log');
    });

    dom['btn-open-settings'].addEventListener('click', openSettingsModal);
    dom['btn-banner-token'].addEventListener('click', openSettingsModal);
    dom['btn-close-settings'].addEventListener('click', closeSettingsModal);

    dom['settings-modal'].addEventListener('click', e => {
        if (e.target === dom['settings-modal']) closeSettingsModal();
    });

    dom['btn-toggle-token-visibility'].addEventListener('click', toggleTokenVisibility);

    dom['btn-save-token'].addEventListener('click', () => {
        const val = dom['token-input'].value.trim();
        if (!val) {
            showToast('Please enter your GitHub token');
            return;
        }
        setToken(val);
        closeSettingsModal();
        showToast('Token saved securely! ✓');
        renderContinueReadingShelf();
        updateLogCountBadge();
    });

    dom['btn-reset-token'].addEventListener('click', () => {
        setToken('');
        dom['token-input'].value = '';
        closeSettingsModal();
        showToast('Token cleared from memory');
    });

    // Navigation Back Buttons
    dom['btn-back-log-to-library'].addEventListener('click', () => {
        showView('library');
        renderContinueReadingShelf();
    });

    dom['btn-back-series'].addEventListener('click', () => {
        const parts = state.currentPath.split('/');
        if (parts.length > 1) {
            parts.pop();
            openFolder(parts.join('/'));
        } else {
            showView('library');
            renderContinueReadingShelf();
        }
    });

    dom['btn-back-chapters'].addEventListener('click', () => {
        const parts = state.currentPath.split('/');
        if (parts.length > 1) {
            parts.pop();
            openFolder(parts.join('/'));
        } else {
            showView('library');
            renderContinueReadingShelf();
        }
    });

    dom['btn-back-from-reader'].addEventListener('click', () => {
        cleanupReader();
        const prev = state.navigationStack.pop();
        if (prev === 'log') {
            renderReadingLogView();
            showView('log');
        } else {
            showView('chapters');
        }
    });

    // Breadcrumb Clicks
    document.addEventListener('click', e => {
        const bc = e.target.closest('[data-breadcrumb]');
        if (bc) {
            e.preventDefault();
            openFolder(bc.dataset.breadcrumb);
        }
    });

    // Library Root Categories Click
    dom['library-grid'].addEventListener('click', e => {
        const card = e.target.closest('.folder-card');
        if (!card) return;
        state.navigationStack = ['library'];
        openFolder(card.dataset.path);
    });

    // Continue Reading Shelf Click
    dom['continue-reading-list'].addEventListener('click', e => {
        const removeBtn = e.target.closest('[data-remove-id]');
        if (removeBtn) {
            e.stopPropagation();
            removeReadingLogRecord(removeBtn.dataset.removeId);
            return;
        }
        const card = e.target.closest('.cr-card');
        if (card) {
            resumeFromLog(card.dataset.logId);
        }
    });

    // Reading Log View Actions
    dom['log-filter-pills'].addEventListener('click', e => {
        const pill = e.target.closest('.filter-pill');
        if (!pill) return;
        dom['log-filter-pills'].querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        logFilterCategory = pill.dataset.filter;
        renderReadingLogView();
    });

    dom['log-search-input'].addEventListener('input', debounce(e => {
        logSearchQuery = e.target.value;
        dom['btn-clear-log-search'].style.display = logSearchQuery ? 'block' : 'none';
        renderReadingLogView();
    }, 150));

    dom['btn-clear-log-search'].addEventListener('click', () => {
        dom['log-search-input'].value = '';
        logSearchQuery = '';
        dom['btn-clear-log-search'].style.display = 'none';
        renderReadingLogView();
    });

    dom['btn-clear-log'].addEventListener('click', clearAllReadingLog);

    dom['log-list'].addEventListener('click', e => {
        const resumeBtn = e.target.closest('[data-resume-id]');
        if (resumeBtn) {
            resumeFromLog(resumeBtn.dataset.resumeId);
            return;
        }
        const removeBtn = e.target.closest('[data-remove-id]');
        if (removeBtn) {
            removeReadingLogRecord(removeBtn.dataset.removeId);
            return;
        }
        const card = e.target.closest('.log-card');
        if (card) {
            resumeFromLog(card.dataset.logId);
        }
    });

    // Series View Clicks
    dom['series-list'].addEventListener('click', e => {
        const zipBtn = e.target.closest('[data-download-folder]');
        if (zipBtn) {
            e.stopPropagation();
            downloadFolderAsZip(zipBtn.dataset.downloadFolder, zipBtn.dataset.folderName, zipBtn);
            return;
        }
        const card = e.target.closest('.series-card');
        if (card) {
            state.navigationStack.push('series');
            openFolder(card.dataset.path);
        }
    });

    dom['btn-download-folder-zip'].addEventListener('click', () => {
        if (!state.currentPath) return;
        const name = state.currentPath.split('/').pop();
        downloadFolderAsZip(state.currentPath, name, dom['btn-download-folder-zip']);
    });

    // Chapters View Clicks
    dom['chapters-list'].addEventListener('click', e => {
        const dlBtn = e.target.closest('[data-download-idx]');
        if (dlBtn) {
            e.stopPropagation();
            const idx = parseInt(dlBtn.dataset.downloadIdx, 10);
            downloadItemByIndex(idx, dlBtn);
            return;
        }

        const item = e.target.closest('.chapter-item');
        if (!item) return;

        if (item.dataset.type === 'folder') {
            state.navigationStack.push('chapters');
            openFolder(item.dataset.path);
        } else if (item.dataset.type === 'ao3_story') {
            state.navigationStack.push('chapters');
            const idx = parseInt(item.dataset.index, 10);
            openAo3Story(idx);
        } else if (item.dataset.type === 'standard_chapter') {
            state.navigationStack.push('chapters');
            const idx = parseInt(item.dataset.index, 10);
            openStandardChapter(idx);
        }
    });

    dom['btn-download-all'].addEventListener('click', () => {
        if (!state.currentPath) return;
        const name = state.currentPath.split('/').pop();
        downloadFolderAsZip(state.currentPath, name, dom['btn-download-all']);
    });

    // Reader UI Actions
    dom['btn-toggle-mode'].addEventListener('click', e => {
        e.stopPropagation();
        toggleAo3ReaderMode();
    });

    dom['btn-bookmark'].addEventListener('click', e => {
        e.stopPropagation();
        toggleCurrentBookmark();
    });

    dom['btn-nav-bookmark'].addEventListener('click', e => {
        e.stopPropagation();
        toggleCurrentBookmark();
    });

    dom['btn-download'].addEventListener('click', e => {
        e.stopPropagation();
        downloadCurrentReaderItem();
    });

    dom['btn-prev-chapter'].addEventListener('click', () => navigateReader(-1));
    dom['btn-next-chapter'].addEventListener('click', () => navigateReader(1));

    dom['btn-font-decrease'].addEventListener('click', () => changeFontSize(-2));
    dom['btn-font-increase'].addEventListener('click', () => changeFontSize(2));
    dom['btn-font-family'].addEventListener('click', toggleFontFamily);

    // Tap reader container to toggle header visibility
    dom['reader-container'].addEventListener('click', toggleReaderUI);

    // Search filters in Series and Chapters views
    if (dom['series-search-input']) {
        dom['series-search-input'].addEventListener('input', debounce(e => {
            const q = e.target.value.toLowerCase();
            dom['series-list'].querySelectorAll('.series-card').forEach(card => {
                const name = card.dataset.name.toLowerCase();
                card.style.display = name.includes(q) ? 'flex' : 'none';
            });
        }, 150));
    }

    if (dom['chapters-search-input']) {
        dom['chapters-search-input'].addEventListener('input', debounce(e => {
            const q = e.target.value.toLowerCase();
            dom['chapters-list'].querySelectorAll('.chapter-item').forEach(item => {
                const name = (item.querySelector('.chapter-name')?.textContent || '').toLowerCase();
                item.style.display = name.includes(q) ? 'flex' : 'none';
            });
        }, 150));
    }

    // Browser back button popstate
    window.addEventListener('popstate', () => {
        const prev = state.navigationStack.pop();
        if (prev === 'chapters') {
            showView('chapters');
        } else if (prev === 'series') {
            showView('series');
        } else if (prev === 'log') {
            renderReadingLogView();
            showView('log');
        } else {
            showView('library');
            renderContinueReadingShelf();
        }
    });
}

// ---- APP INITIALIZATION ----
document.addEventListener('DOMContentLoaded', () => {
    cacheDom();
    updateTokenUI();
    renderLibraryHome();
    renderContinueReadingShelf();
    updateLogCountBadge();
    applyTypographySettings();
    initEventListeners();

    // Auto open settings modal on first visit if no token
    if (!getToken()) {
        setTimeout(openSettingsModal, 400);
    }

    // Register Service Worker for offline shell support
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
        navigator.serviceWorker.register('sw.js').catch(err => {
            console.log('SW registration:', err);
        });
    }
});
