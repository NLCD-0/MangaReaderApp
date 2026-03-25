/* ============================================
   MANGA CLOUD READER — App Logic (Optimized)
   GitHub API + PDF.js + SPA Navigation
   ============================================ */

// ---- CONFIG ----
const CONFIG = {
    defaultToken: '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',
    owner: 'NLCD-0',
    repo: 'CLOUD',
    branch: 'main',
    rootFolders: [
        { path: 'Manga & Webtoon', icon: '📖', desc: 'Manga & Webtoons' },
        { path: 'ao3', icon: 'ao3_icon.png', desc: 'Archive of Our Own', isImage: true },
        { path: 'Novela', icon: '📕', desc: 'Novelas' }
    ]
};

const API_BASE = `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents`;

function getToken() {
    return localStorage.getItem('mangacloud_token') || CONFIG.defaultToken;
}

// ---- STATE ----
const state = {
    currentFolder: null,
    currentRootConfig: null,
    currentSeries: null,
    chapters: [],
    currentChapterIndex: -1,
    currentPdfBlob: null,
    headerVisible: true,
    hideTimer: null,
    navigationStack: [],
    isTextMode: false,
    renderGen: 0
};

function isAo3Mode() {
    return state.currentRootConfig && state.currentRootConfig.path === 'ao3';
}

// ---- CACHED DOM REFS ----
const dom = {};

function cacheDom() {
    const ids = [
        'library-grid', 'series-list', 'series-title', 'series-subtitle',
        'chapters-list', 'chapters-title', 'chapters-subtitle',
        'reader-container', 'reader-title', 'reader-progress', 'reader-header',
        'chapter-nav', 'btn-prev-chapter', 'btn-next-chapter', 'btn-download',
        'btn-back-library', 'btn-back-series', 'btn-back-chapters',
        'btn-open-settings', 'btn-close-settings', 'settings-modal',
        'btn-save-token', 'btn-reset-token', 'token-input',
        'loading-overlay', 'loader-text', 'toast', 'btn-bookmark',
        'continue-reading', 'continue-reading-list'
    ];
    ids.forEach(id => { dom[id] = document.getElementById(id); });
}

// Icon HTML builder (cached per config)
function getRootIconHtml(cfg) {
    if (!cfg) return '📁';
    if (cfg.isImage) {
        return `<img src="${cfg.icon}" alt="${escapeAttr(cfg.path)}" style="width:32px;height:32px;object-fit:contain;">`;
    }
    return cfg.icon;
}

// ---- PDF.js INIT ----
let pdfjsReady = false;

function initPdfJs() {
    if (pdfjsReady) return Promise.resolve();
    return new Promise(resolve => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        script.onload = () => {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            pdfjsReady = true;
            resolve();
        };
        document.head.appendChild(script);
    });
}

// ---- GITHUB API ----
function encodePath(path) {
    return path.split('/').map(encodeURIComponent).join('/');
}

function githubHeaders(accept) {
    return {
        'Authorization': 'token ' + getToken(),
        'Accept': accept
    };
}

function fetchGitHub(path) {
    const url = `${API_BASE}/${encodePath(path)}?ref=${CONFIG.branch}`;
    return fetch(url, { headers: githubHeaders('application/vnd.github.v3+json') })
        .then(resp => {
            if (!resp.ok) throw new Error('GitHub API error: ' + resp.status);
            return resp.json();
        });
}

function fetchPdfBlob(path) {
    const url = `${API_BASE}/${encodePath(path)}?ref=${CONFIG.branch}`;
    return fetch(url, { headers: githubHeaders('application/vnd.github.v3.raw') })
        .then(resp => {
            if (!resp.ok) throw new Error('Download error: ' + resp.status);
            return resp.blob();
        });
}

// ---- VIEW NAVIGATION ----
const allViews = [];

function initViews() {
    document.querySelectorAll('.view').forEach(v => allViews.push(v));
}

function showView(name) {
    allViews.forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + name).classList.add('active');
    if (name !== 'reader') window.scrollTo(0, 0);
}

// ---- LOADING ----
function showLoading(text) {
    dom['loader-text'].textContent = text || 'Loading...';
    dom['loading-overlay'].classList.add('active');
}

function hideLoading() {
    dom['loading-overlay'].classList.remove('active');
}

// ---- TOAST ----
let toastTimer = null;
function showToast(msg) {
    clearTimeout(toastTimer);
    dom.toast.textContent = msg;
    dom.toast.classList.add('visible');
    toastTimer = setTimeout(() => dom.toast.classList.remove('visible'), 2500);
}

// ---- NATURAL SORT ----
const sortOpts = { numeric: true, sensitivity: 'base' };
function naturalSort(a, b) {
    return a.localeCompare(b, undefined, sortOpts);
}

// ---- FORMAT FILE SIZE ----
function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

// ---- BOOKMARKS ----
let bookmarkCache = null;

function loadBookmarks() {
    if (bookmarkCache) return bookmarkCache;
    try {
        bookmarkCache = JSON.parse(localStorage.getItem('mangacloud_bookmarks') || '{}');
    } catch { bookmarkCache = {}; }
    return bookmarkCache;
}

function saveBookmark(chapterPath, scrollY) {
    const bm = loadBookmarks();
    bm[chapterPath] = scrollY;
    bookmarkCache = bm;
    try {
        localStorage.setItem('mangacloud_bookmarks', JSON.stringify(bm));
    } catch { /* ignore */ }
}

function getBookmark(chapterPath) {
    const val = loadBookmarks()[chapterPath];
    return (val !== undefined) ? val : null;
}

function clearBookmark(chapterPath) {
    const bm = loadBookmarks();
    delete bm[chapterPath];
    bookmarkCache = bm;
    try {
        localStorage.setItem('mangacloud_bookmarks', JSON.stringify(bm));
    } catch { /* ignore */ }
}

function isBookmarkableMode() {
    return state.isTextMode ||
        (state.currentRootConfig && state.currentRootConfig.path === 'Novela');
}

function updateBookmarkBtn() {
    if (!dom['btn-bookmark']) return;
    const chapter = state.chapters[state.currentChapterIndex];
    if (!chapter || !isBookmarkableMode()) {
        dom['btn-bookmark'].classList.remove('active');
        dom['btn-bookmark'].style.display = 'none';
        return;
    }
    dom['btn-bookmark'].style.display = 'flex';
    const marked = getBookmark(chapter.path) !== null;
    dom['btn-bookmark'].classList.toggle('active', marked);
}

function toggleBookmark() {
    const chapter = state.chapters[state.currentChapterIndex];
    if (!chapter) return;
    if (getBookmark(chapter.path) !== null) {
        clearBookmark(chapter.path);
        updateBookmarkBtn();
        showToast('Bookmark removed');
    } else {
        saveBookmark(chapter.path, window.scrollY);
        updateBookmarkBtn();
        showToast('Position bookmarked! 🔖');
    }
}

// ---- READING PROGRESS ----
let progressCache = null;

function loadProgress() {
    if (progressCache) return progressCache;
    try {
        progressCache = JSON.parse(localStorage.getItem('mangacloud_progress') || '{}');
    } catch { progressCache = {}; }
    return progressCache;
}

function saveProgress(seriesPath, chapterName) {
    const progress = loadProgress();
    progress[seriesPath] = chapterName;
    try {
        localStorage.setItem('mangacloud_progress', JSON.stringify(progress));
    } catch { /* ignore */ }
}

function getProgress(seriesPath) {
    return loadProgress()[seriesPath] || null;
}

// ---- HELPERS ----
const escapeDiv = document.createElement('div');
function escapeHtml(str) {
    escapeDiv.textContent = str;
    return escapeDiv.innerHTML;
}

function escapeAttr(str) {
    return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function truncate(str, max) {
    return str.length > max ? str.slice(0, max) + '…' : str;
}

// ---- SHARED: filter & sort items ----
function splitItems(items) {
    const folders = [];
    const pdfs = [];
    for (let i = 0, len = items.length; i < len; i++) {
        const item = items[i];
        if (item.type === 'dir') {
            folders.push(item);
        } else if (item.type === 'file' && item.name.toLowerCase().endsWith('.pdf')) {
            pdfs.push(item);
        }
    }
    folders.sort((a, b) => naturalSort(a.name, b.name));
    pdfs.sort((a, b) => naturalSort(a.name, b.name));
    return { folders, pdfs };
}

// ---- SHARED: reader completion ----
function finishReader(chapter, index) {
    saveProgress(state.currentSeries, chapter.name);
    dom['btn-prev-chapter'].disabled = index <= 0;
    dom['btn-next-chapter'].disabled = index >= state.chapters.length - 1;
    hideLoading();
    showView('reader');
    window.scrollTo(0, 0);
    state.headerVisible = true;
    dom['reader-header'].classList.remove('hidden');
    dom['chapter-nav'].classList.remove('hidden');
}

// ---- SHARED: navigate chapter ----
function navigateChapter(index) {
    if (isAo3Mode()) {
        openChapterAsText(index);
    } else {
        openChapter(index);
    }
}

// ============================================
// CONTINUE READING
// ============================================
function renderContinueReading() {
    const section = dom['continue-reading'];
    const list = dom['continue-reading-list'];
    if (!section || !list) return;

    const progress = loadProgress();
    const entries = Object.entries(progress); // [[seriesPath, chapterName], ...]

    if (entries.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';

    list.innerHTML = entries.map(([seriesPath, chapterName]) => {
        const seriesName = seriesPath.split('/').pop();
        const displayChapter = chapterName.replace(/\.pdf$/i, '');
        const rootCfg = CONFIG.rootFolders.find(r => seriesPath.startsWith(r.path));
        const iconHtml = rootCfg && rootCfg.isImage
            ? `<img src="${rootCfg.icon}" alt="" style="width:20px;height:20px;object-fit:contain;border-radius:3px;">`
            : (rootCfg ? rootCfg.icon : '📖');
        const hasBookmark = getBookmark(seriesPath + '/' + chapterName) !== null;
        return `<div class="cr-card" data-series="${escapeAttr(seriesPath)}" data-chapter="${escapeAttr(chapterName)}">
            <div class="cr-icon">${iconHtml}</div>
            <div class="cr-info">
                <div class="cr-series">${escapeHtml(seriesName)}</div>
                <div class="cr-chapter">${escapeHtml(displayChapter)}</div>
            </div>
            ${hasBookmark ? '<div class="cr-bookmark">🔖</div>' : ''}
            <button class="cr-remove" data-series="${escapeAttr(seriesPath)}" aria-label="Remove from recent" title="Remove">×</button>
        </div>`;
    }).join('');
}

// ============================================
// LIBRARY VIEW — event delegation
// ============================================
function renderLibrary() {
    const grid = dom['library-grid'];
    grid.innerHTML = CONFIG.rootFolders.map(folder => {
        const iconHtml = folder.isImage
            ? `<img src="${folder.icon}" alt="${escapeAttr(folder.path)}" style="width:36px;height:36px;object-fit:contain;">`
            : folder.icon;
        return `<div class="folder-card" data-path="${escapeAttr(folder.path)}">
            <div class="folder-icon">${iconHtml}</div>
            <div class="folder-info">
                <div class="folder-name">${escapeHtml(folder.path)}</div>
                <div class="folder-desc">${escapeHtml(folder.desc)}</div>
            </div>
            <div class="folder-arrow">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
            </div>
        </div>`;
    }).join('');

    // Event delegation on grid
    grid.addEventListener('click', e => {
        const card = e.target.closest('.folder-card');
        if (!card) return;
        state.navigationStack.push('library');
        openFolder(card.dataset.path);
    });
}

// ============================================
// SERIES VIEW
// ============================================
function renderSeriesCards(container, items, iconHtml) {
    container.innerHTML = items.map(f => {
        const lastRead = getProgress(f.path);
        const badgeHtml = lastRead
            ? `<div class="series-badge">↗ ${truncate(lastRead.replace(/\.pdf$/i, ''), 20)}</div>`
            : '';
        return `<div class="series-card" data-path="${escapeAttr(f.path)}" data-name="${escapeAttr(f.name)}">
            <div class="series-emoji">${iconHtml}</div>
            <div class="series-name">${escapeHtml(f.name)}</div>
            ${badgeHtml}
        </div>`;
    }).join('');
}

function attachSeriesListeners(container) {
    container.addEventListener('click', e => {
        const card = e.target.closest('.series-card');
        if (!card) return;
        state.navigationStack.push('series');
        openSeries(card.dataset.path, card.dataset.name);
    });
}

function openFolder(folderPath) {
    showLoading('Loading collection...');
    state.currentFolder = folderPath;
    state.currentRootConfig = CONFIG.rootFolders.find(r => r.path === folderPath) || state.currentRootConfig;

    fetchGitHub(folderPath).then(items => {
        const { folders, pdfs } = splitItems(items);

        dom['series-title'].textContent = folderPath.split('/').pop();
        dom['series-subtitle'].textContent = folders.length + ' series · ' + pdfs.length + ' files';

        const list = dom['series-list'];
        const iconHtml = getRootIconHtml(state.currentRootConfig);

        // If only PDFs, go straight to chapters
        if (pdfs.length > 0 && folders.length === 0) {
            hideLoading();
            openSeries(folderPath, folderPath.split('/').pop());
            return;
        }

        if (folders.length > 0) {
            renderSeriesCards(list, folders, iconHtml);
        } else {
            list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📭</div><div class="empty-state-text">This folder is empty</div></div>';
        }

        attachSeriesListeners(list);
        hideLoading();
        showView('series');
    }).catch(err => {
        hideLoading();
        showToast('Error loading folder');
        console.error(err);
    });
}

// ============================================
// CHAPTERS VIEW
// ============================================
function openSeries(seriesPath, seriesName) {
    showLoading('Loading chapters...');
    state.currentSeries = seriesPath;

    fetchGitHub(seriesPath).then(items => {
        const { folders: subfolders, pdfs } = splitItems(items);

        // Deeper navigation if only subfolders
        if (subfolders.length > 0 && pdfs.length === 0) {
            hideLoading();
            state.currentFolder = seriesPath;
            dom['series-title'].textContent = seriesName;
            dom['series-subtitle'].textContent = subfolders.length + ' items';
            const list = dom['series-list'];
            renderSeriesCards(list, subfolders, getRootIconHtml(state.currentRootConfig));
            attachSeriesListeners(list);
            showView('series');
            return;
        }

        state.chapters = pdfs;
        dom['chapters-title'].textContent = seriesName;
        dom['chapters-subtitle'].textContent = pdfs.length + ' chapters';

        const chaptersList = dom['chapters-list'];

        if (pdfs.length === 0) {
            chaptersList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📭</div><div class="empty-state-text">No chapters found</div></div>';
        } else {
            const lastRead = getProgress(seriesPath);
            chaptersList.innerHTML = pdfs.map((pdf, idx) => {
                const displayName = pdf.name.replace(/\.pdf$/i, '');
                const isLastRead = lastRead === pdf.name;
                return `<div class="chapter-item${isLastRead ? ' last-read' : ''}" data-index="${idx}">
                    <div class="chapter-number">${idx + 1}</div>
                    <div class="chapter-info">
                        <div class="chapter-name">${escapeHtml(displayName)}</div>
                        <div class="chapter-size">${formatSize(pdf.size)}${isLastRead ? ' · Last read' : ''}</div>
                    </div>
                    <div class="chapter-read-icon">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
                    </div>
                </div>`;
            }).join('');

            // Event delegation handled by persistent listener in DOMContentLoaded
        }

        hideLoading();
        showView('chapters');
    }).catch(err => {
        hideLoading();
        showToast('Error loading chapters');
        console.error(err);
    });
}

// Refresh last-read highlight in the cached chapters list without re-fetching
function refreshChaptersHighlight() {
    const lastRead = getProgress(state.currentSeries);
    const items = dom['chapters-list'].querySelectorAll('.chapter-item');
    items.forEach((item, idx) => {
        const chapter = state.chapters[idx];
        if (!chapter) return;
        const isLastRead = lastRead === chapter.name;
        item.classList.toggle('last-read', isLastRead);
        const sizeEl = item.querySelector('.chapter-size');
        if (sizeEl) {
            sizeEl.textContent = formatSize(chapter.size) + (isLastRead ? ' · Last read' : '');
        }
    });
}

// Refresh the last-read badge on the cached series card for the current series
function refreshSeriesHighlight() {
    const seriesPath = state.currentSeries;
    if (!seriesPath) return;
    const card = dom['series-list'].querySelector(`.series-card[data-path="${CSS.escape(seriesPath)}"]`);
    if (!card) return;
    const lastRead = getProgress(seriesPath);
    let badge = card.querySelector('.series-badge');
    if (lastRead) {
        const text = '\u2197 ' + truncate(lastRead.replace(/\.pdf$/i, ''), 20);
        if (badge) {
            badge.textContent = text;
        } else {
            badge = document.createElement('div');
            badge.className = 'series-badge';
            badge.textContent = text;
            card.appendChild(badge);
        }
    } else {
        if (badge) badge.remove();
    }
}

// ============================================
// READER VIEW (canvas mode)
// ============================================
function openChapter(index) {
    if (index < 0 || index >= state.chapters.length) return;

    state.currentChapterIndex = index;
    state.isTextMode = false;
    const chapter = state.chapters[index];
    const gen = ++state.renderGen; // invalidates any previous render chain

    showLoading('Downloading ' + chapter.name + '...');

    initPdfJs()
        .then(() => fetchPdfBlob(chapter.path))
        .then(blob => {
            if (gen !== state.renderGen) return Promise.reject('stale');
            state.currentPdfBlob = blob;
            showLoading('Rendering pages...');
            return blob.arrayBuffer();
        })
        .then(buf => {
            if (gen !== state.renderGen) return Promise.reject('stale');
            return pdfjsLib.getDocument({ data: buf }).promise;
        })
        .then(pdf => {
            if (gen !== state.renderGen) return;
            const totalPages = pdf.numPages;
            const container = dom['reader-container'];
            container.innerHTML = '';

            dom['reader-title'].textContent = chapter.name.replace(/\.pdf$/i, '');
            dom['reader-progress'].textContent = totalPages + ' pages';

            const dpr = window.devicePixelRatio || 1;
            const containerWidth = Math.min(window.innerWidth, 800);

            // Use DocumentFragment for batched DOM insertion
            const frag = document.createDocumentFragment();

            const renderPage = pageNum => {
                if (gen !== state.renderGen) return; // stale — abort silently
                if (pageNum > totalPages) {
                    container.appendChild(frag);
                    finishReader(chapter, index);
                    startHideTimer();
                    updateBookmarkBtn();
                    // Restore bookmarked scroll position if any
                    const savedY = getBookmark(chapter.path);
                    if (savedY !== null) {
                        setTimeout(() => {
                            window.scrollTo({ top: savedY, behavior: 'smooth' });
                            showToast('📖 Jumped to bookmarked position');
                        }, 150);
                    }
                    return;
                }

                pdf.getPage(pageNum).then(page => {
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

                    page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise.then(() => {
                        if (gen !== state.renderGen) return;
                        dom['reader-progress'].textContent = `Rendered ${pageNum} / ${totalPages}`;
                        // Flush fragment every 5 pages for progressive display
                        if (pageNum % 5 === 0) {
                            container.appendChild(frag);
                        }
                        renderPage(pageNum + 1);
                    });
                });
            };

            renderPage(1);
        })
        .catch(err => {
            if (err === 'stale') return; // expected — suppress
            hideLoading();
            showToast('Error loading PDF');
            console.error(err);
        });
}

// ============================================
// TEXT READER (AO3 mode)
// ============================================
function extractParagraphs(textContent) {
    const items = textContent.items;
    const lines = [];
    let currentLine = '';
    let lastY = null;

    for (let i = 0, len = items.length; i < len; i++) {
        const item = items[i];
        const str = item.str;

        if (str.trim() === '') {
            if (currentLine.trim()) {
                lines.push(currentLine.trim());
                currentLine = '';
            }
            continue;
        }

        const y = item.transform ? item.transform[5] : null;

        if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
            if (currentLine.trim()) lines.push(currentLine.trim());
            currentLine = str;
        } else {
            if (currentLine && !currentLine.endsWith(' ') && !str.startsWith(' ')) {
                currentLine += ' ';
            }
            currentLine += str;
        }
        lastY = y;
    }
    if (currentLine.trim()) lines.push(currentLine.trim());

    // Merge into paragraphs
    const paragraphs = [];
    let para = '';

    for (let i = 0, len = lines.length; i < len; i++) {
        const line = lines[i];
        if (para && line.length > 0) {
            const prevEnds = /[.!?:;"'»)\]]$/.test(para);
            const lineStarts = /^[A-ZÀ-ÖØ-Þ"'«(\[]/.test(line);
            const isShort = para.length < 60;

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

function openChapterAsText(index) {
    if (index < 0 || index >= state.chapters.length) return;

    state.currentChapterIndex = index;
    state.isTextMode = true;
    const chapter = state.chapters[index];

    showLoading('Downloading ' + chapter.name + '...');

    initPdfJs()
        .then(() => fetchPdfBlob(chapter.path))
        .then(blob => {
            state.currentPdfBlob = blob;
            showLoading('Extracting text...');
            return blob.arrayBuffer();
        })
        .then(buf => pdfjsLib.getDocument({ data: buf }).promise)
        .then(pdf => {
            const totalPages = pdf.numPages;
            const container = dom['reader-container'];
            container.innerHTML = '';
            container.classList.add('text-mode');

            dom['reader-title'].textContent = chapter.name.replace(/\.pdf$/i, '');
            dom['reader-progress'].textContent = totalPages + ' pages';

            const frag = document.createDocumentFragment();

            const extractPage = pageNum => {
                if (pageNum > totalPages) {
                    container.appendChild(frag);
                    finishReader(chapter, index);
                    updateBookmarkBtn();
                    // Restore bookmarked position if any
                    const savedY = getBookmark(chapter.path);
                    if (savedY !== null) {
                        setTimeout(() => {
                            window.scrollTo({ top: savedY, behavior: 'smooth' });
                            showToast('📖 Jumped to bookmarked position');
                        }, 150);
                    }
                    return;
                }

                pdf.getPage(pageNum)
                    .then(page => page.getTextContent())
                    .then(textContent => {
                        const pageDiv = document.createElement('div');
                        pageDiv.className = 'text-page';

                        const paragraphs = extractParagraphs(textContent);

                        if (paragraphs.length === 0) {
                            const p = document.createElement('p');
                            p.className = 'text-empty-page';
                            p.textContent = `— Page ${pageNum} (no text) —`;
                            pageDiv.appendChild(p);
                        } else {
                            for (let i = 0; i < paragraphs.length; i++) {
                                const p = document.createElement('p');
                                p.textContent = paragraphs[i];
                                pageDiv.appendChild(p);
                            }
                        }

                        frag.appendChild(pageDiv);
                        dom['reader-progress'].textContent = `Extracted ${pageNum} / ${totalPages}`;

                        // Flush every 10 pages for progressive display
                        if (pageNum % 10 === 0) {
                            container.appendChild(frag);
                        }
                        extractPage(pageNum + 1);
                    });
            };

            extractPage(1);
        })
        .catch(err => {
            hideLoading();
            showToast('Error extracting text');
            console.error(err);
        });
}

// ---- READER HEADER AUTO-HIDE ----
function startHideTimer() {
    clearTimeout(state.hideTimer);
    state.hideTimer = setTimeout(() => {
        if (state.isTextMode) return; // Keep visible in text mode
        state.headerVisible = false;
        dom['reader-header'].classList.add('hidden');
        dom['chapter-nav'].classList.add('hidden');
    }, 3000);
}

function toggleReaderUI() {
    state.headerVisible = !state.headerVisible;
    if (state.headerVisible) {
        dom['reader-header'].classList.remove('hidden');
        dom['chapter-nav'].classList.remove('hidden');
        startHideTimer();
    } else {
        dom['reader-header'].classList.add('hidden');
        dom['chapter-nav'].classList.add('hidden');
    }
}

// ---- DOWNLOAD ----
function downloadCurrentPdf() {
    if (!state.currentPdfBlob || state.currentChapterIndex < 0) return;
    const chapter = state.chapters[state.currentChapterIndex];
    const url = URL.createObjectURL(state.currentPdfBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = chapter.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Download started!');
}

// ---- CLEANUP ----
function cleanupReader() {
    const container = dom['reader-container'];
    container.classList.remove('text-mode');
    state.currentPdfBlob = null;
    state.isTextMode = false;
    clearTimeout(state.hideTimer);
    if (dom['btn-bookmark']) {
        dom['btn-bookmark'].classList.remove('active');
        dom['btn-bookmark'].style.display = 'none';
    }
    // Defer heavy canvas cleanup so the view transition isn't blocked
    setTimeout(() => { container.innerHTML = ''; }, 80);
}

// ---- BACK NAVIGATION ----
function goBack() {
    const prev = state.navigationStack.pop();
    if (prev === 'chapters') {
        cleanupReader();
        refreshChaptersHighlight();
        showView('chapters');
    } else if (prev === 'library-recent') {
        cleanupReader();
        renderContinueReading();
        showView('library');
    } else if (prev === 'series') {
        refreshSeriesHighlight();
        showView('series');
    } else {
        showView('library');
    }
}

// ============================================
// EVENT LISTENERS
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    cacheDom();
    initViews();
    renderLibrary();
    renderContinueReading();

    // Chapters list — single persistent listener
    dom['chapters-list'].addEventListener('click', e => {
        const item = e.target.closest('.chapter-item');
        if (!item) return;
        state.navigationStack.push('chapters');
        navigateChapter(parseInt(item.dataset.index));
    });

    // Continue Reading — single persistent listener
    dom['continue-reading-list'].addEventListener('click', e => {
        // Remove button
        const removeBtn = e.target.closest('.cr-remove');
        if (removeBtn) {
            e.stopPropagation();
            const seriesPath = removeBtn.dataset.series;
            const progress = loadProgress();
            delete progress[seriesPath];
            progressCache = progress;
            try { localStorage.setItem('mangacloud_progress', JSON.stringify(progress)); } catch {}
            renderContinueReading();
            return;
        }
        // Card click — open chapter
        const card = e.target.closest('.cr-card');
        if (!card) return;
        const seriesPath = card.dataset.series;
        const chapterName = card.dataset.chapter;
        const rootCfg = CONFIG.rootFolders.find(r => seriesPath.startsWith(r.path));

        state.currentSeries = seriesPath;
        state.currentRootConfig = rootCfg || null;
        state.navigationStack = ['library-recent'];

        showLoading('Loading...');
        fetchGitHub(seriesPath).then(items => {
            const { pdfs } = splitItems(items);
            state.chapters = pdfs;
            const idx = pdfs.findIndex(p => p.name === chapterName);
            hideLoading();
            navigateChapter(idx >= 0 ? idx : 0);
        }).catch(() => { hideLoading(); showToast('Error loading chapter'); });
    });

    // Back buttons
    dom['btn-back-library'].addEventListener('click', () => {
        state.navigationStack = [];
        showView('library');
        renderContinueReading();
    });
    dom['btn-back-series'].addEventListener('click', goBack);
    dom['btn-back-chapters'].addEventListener('click', goBack);

    // Bookmark
    dom['btn-bookmark'].addEventListener('click', e => { e.stopPropagation(); toggleBookmark(); });
    dom['btn-bookmark'].style.display = 'none'; // hidden until text reader opens

    // Download
    dom['btn-download'].addEventListener('click', downloadCurrentPdf);

    // Chapter navigation
    dom['btn-prev-chapter'].addEventListener('click', () => {
        const wasText = state.isTextMode;
        const chapter = state.chapters[state.currentChapterIndex];
        if (chapter) clearBookmark(chapter.path);
        const prevIdx = state.currentChapterIndex - 1;
        cleanupReader();
        wasText ? openChapterAsText(prevIdx) : openChapter(prevIdx);
    });
    dom['btn-next-chapter'].addEventListener('click', () => {
        const wasText = state.isTextMode;
        const chapter = state.chapters[state.currentChapterIndex];
        if (chapter) clearBookmark(chapter.path);
        const nextIdx = state.currentChapterIndex + 1;
        cleanupReader();
        wasText ? openChapterAsText(nextIdx) : openChapter(nextIdx);
    });

    // Tap reader to toggle UI
    dom['reader-container'].addEventListener('click', toggleReaderUI);

    // Browser back button support
    window.addEventListener('popstate', goBack);

    // ---- SETTINGS MODAL ----
    const openSettings = () => {
        dom['token-input'].value = localStorage.getItem('mangacloud_token') || '';
        dom['settings-modal'].classList.add('active');
        dom['token-input'].focus();
    };
    const closeSettings = () => dom['settings-modal'].classList.remove('active');

    dom['btn-open-settings'].addEventListener('click', openSettings);
    dom['btn-close-settings'].addEventListener('click', closeSettings);
    dom['settings-modal'].addEventListener('click', e => {
        if (e.target === dom['settings-modal']) closeSettings();
    });

    dom['btn-save-token'].addEventListener('click', () => {
        const val = dom['token-input'].value.trim();
        if (!val) { showToast('Please enter a token'); return; }
        localStorage.setItem('mangacloud_token', val);
        closeSettings();
        showToast('Token saved! ✓');
    });

    dom['btn-reset-token'].addEventListener('click', () => {
        localStorage.removeItem('mangacloud_token');
        dom['token-input'].value = '';
        closeSettings();
        showToast('Token reset to default');
    });

    // Register service worker
    if ('serviceWorker' in navigator &&
        (location.protocol === 'https:' || location.hostname === 'localhost')) {
        navigator.serviceWorker.register('sw.js').catch(err => {
            console.log('SW registration failed:', err);
        });
    }
});
