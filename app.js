/* ============================================
   MANGA CLOUD READER — App Logic
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

function getToken() {
    return localStorage.getItem('mangacloud_token') || CONFIG.defaultToken;
}

const API_BASE = 'https://api.github.com/repos/' + CONFIG.owner + '/' + CONFIG.repo + '/contents';

// ---- STATE ----
var state = {
    currentFolder: null,
    currentRootConfig: null,
    currentSeries: null,
    chapters: [],
    currentChapterIndex: -1,
    currentPdfUrl: null,
    currentPdfBlob: null,
    headerVisible: true,
    hideTimer: null,
    navigationStack: []
};

// Build icon HTML from a root folder config
function getRootIconHtml(cfg) {
    if (!cfg) return '📁';
    if (cfg.isImage) {
        return '<img src="' + cfg.icon + '" alt="' + escapeAttr(cfg.path) + '" style="width:32px;height:32px;object-fit:contain;">';
    }
    return cfg.icon;
}

// ---- DOM ELEMENTS ----
function $(id) { return document.getElementById(id); }

// ---- PDF.js INIT ----
var pdfjsReady = false;

function initPdfJs() {
    return new Promise(function (resolve) {
        if (pdfjsReady) { resolve(); return; }

        // Load pdf.js via legacy script
        var script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        script.onload = function () {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            pdfjsReady = true;
            resolve();
        };
        document.head.appendChild(script);
    });
}

// ---- GITHUB API ----
function fetchGitHub(path) {
    var encodedPath = path.split('/').map(function (p) { return encodeURIComponent(p); }).join('/');
    var url = API_BASE + '/' + encodedPath + '?ref=' + CONFIG.branch;
    return fetch(url, {
        headers: {
            'Authorization': 'token ' + getToken(),
            'Accept': 'application/vnd.github.v3+json'
        }
    }).then(function (resp) {
        if (!resp.ok) throw new Error('GitHub API error: ' + resp.status);
        return resp.json();
    });
}

function fetchPdfBlob(path) {
    var encodedPath = path.split('/').map(function (p) { return encodeURIComponent(p); }).join('/');
    var url = API_BASE + '/' + encodedPath + '?ref=' + CONFIG.branch;
    return fetch(url, {
        headers: {
            'Authorization': 'token ' + getToken(),
            'Accept': 'application/vnd.github.v3.raw'
        }
    }).then(function (resp) {
        if (!resp.ok) throw new Error('Download error: ' + resp.status);
        return resp.blob();
    });
}

// ---- VIEW NAVIGATION ----
function showView(name) {
    var views = document.querySelectorAll('.view');
    views.forEach(function (v) { v.classList.remove('active'); });
    document.getElementById('view-' + name).classList.add('active');
    if (name !== 'reader') {
        window.scrollTo(0, 0);
    }
}

// ---- LOADING ----
function showLoading(text) {
    $('loader-text').textContent = text || 'Loading...';
    $('loading-overlay').classList.add('active');
}
function hideLoading() {
    $('loading-overlay').classList.remove('active');
}

// ---- TOAST ----
function showToast(msg) {
    var toast = $('toast');
    toast.textContent = msg;
    toast.classList.add('visible');
    setTimeout(function () { toast.classList.remove('visible'); }, 2500);
}

// ---- NATURAL SORT ----
function naturalSort(a, b) {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

// ---- FORMAT FILE SIZE ----
function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

// ---- READING PROGRESS ----
function saveProgress(seriesPath, chapterName) {
    try {
        var progress = JSON.parse(localStorage.getItem('mangacloud_progress') || '{}');
        progress[seriesPath] = chapterName;
        localStorage.setItem('mangacloud_progress', JSON.stringify(progress));
    } catch (e) { /* ignore */ }
}

function getProgress(seriesPath) {
    try {
        var progress = JSON.parse(localStorage.getItem('mangacloud_progress') || '{}');
        return progress[seriesPath] || null;
    } catch (e) { return null; }
}

// ---- HELPERS ----
function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function escapeAttr(str) {
    return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function truncate(str, max) {
    return str.length > max ? str.slice(0, max) + '…' : str;
}

// ============================================
// LIBRARY VIEW
// ============================================
function renderLibrary() {
    var grid = $('library-grid');
    grid.innerHTML = CONFIG.rootFolders.map(function (folder) {
        var iconHtml = folder.isImage
            ? '<img src="' + folder.icon + '" alt="' + escapeAttr(folder.path) + '" style="width:36px;height:36px;object-fit:contain;">'
            : folder.icon;
        return '<div class="folder-card" data-path="' + escapeAttr(folder.path) + '">' +
            '<div class="folder-icon">' + iconHtml + '</div>' +
            '<div class="folder-info">' +
            '<div class="folder-name">' + escapeHtml(folder.path) + '</div>' +
            '<div class="folder-desc">' + escapeHtml(folder.desc) + '</div>' +
            '</div>' +
            '<div class="folder-arrow">' +
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>' +
            '</div>' +
            '</div>';
    }).join('');

    grid.querySelectorAll('.folder-card').forEach(function (card) {
        card.addEventListener('click', function () {
            state.navigationStack.push('library');
            openFolder(card.dataset.path);
        });
    });
}

// ============================================
// SERIES VIEW
// ============================================
function openFolder(folderPath) {
    showLoading('Loading collection...');
    state.currentFolder = folderPath;
    // Track which root folder we're inside
    state.currentRootConfig = CONFIG.rootFolders.find(function (r) { return r.path === folderPath; }) || state.currentRootConfig;

    fetchGitHub(folderPath).then(function (items) {
        var folders = items.filter(function (i) { return i.type === 'dir'; })
            .sort(function (a, b) { return naturalSort(a.name, b.name); });
        var pdfs = items.filter(function (i) { return i.type === 'file' && i.name.toLowerCase().endsWith('.pdf'); })
            .sort(function (a, b) { return naturalSort(a.name, b.name); });

        $('series-title').textContent = folderPath.split('/').pop();
        $('series-subtitle').textContent = folders.length + ' series · ' + pdfs.length + ' files';

        var list = $('series-list');
        var iconHtml = getRootIconHtml(state.currentRootConfig);

        if (folders.length > 0) {
            list.innerHTML = folders.map(function (f) {
                var lastRead = getProgress(f.path);
                var badgeHtml = lastRead ? '<div class="series-badge">↗ ' + truncate(lastRead.replace(/\.pdf$/i, ''), 20) + '</div>' : '';
                return '<div class="series-card" data-path="' + escapeAttr(f.path) + '" data-name="' + escapeAttr(f.name) + '">' +
                    '<div class="series-emoji">' + iconHtml + '</div>' +
                    '<div class="series-name">' + escapeHtml(f.name) + '</div>' +
                    badgeHtml +
                    '</div>';
            }).join('');
        }

        // If only PDFs, go straight to chapters
        if (pdfs.length > 0 && folders.length === 0) {
            hideLoading();
            openSeries(folderPath, folderPath.split('/').pop());
            return;
        }

        list.querySelectorAll('.series-card').forEach(function (card) {
            card.addEventListener('click', function () {
                state.navigationStack.push('series');
                openSeries(card.dataset.path, card.dataset.name);
            });
        });

        if (folders.length === 0 && pdfs.length === 0) {
            list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📭</div><div class="empty-state-text">This folder is empty</div></div>';
        }

        hideLoading();
        showView('series');
    }).catch(function (err) {
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

    fetchGitHub(seriesPath).then(function (items) {
        var pdfs = items.filter(function (i) { return i.type === 'file' && i.name.toLowerCase().endsWith('.pdf'); })
            .sort(function (a, b) { return naturalSort(a.name, b.name); });
        var subfolders = items.filter(function (i) { return i.type === 'dir'; })
            .sort(function (a, b) { return naturalSort(a.name, b.name); });

        // Deeper navigation if only subfolders
        if (subfolders.length > 0 && pdfs.length === 0) {
            hideLoading();
            state.currentFolder = seriesPath;
            $('series-title').textContent = seriesName;
            $('series-subtitle').textContent = subfolders.length + ' items';
            var list = $('series-list');
            var iconHtml = getRootIconHtml(state.currentRootConfig);
            list.innerHTML = subfolders.map(function (f) {
                return '<div class="series-card" data-path="' + escapeAttr(f.path) + '" data-name="' + escapeAttr(f.name) + '">' +
                    '<div class="series-emoji">' + iconHtml + '</div>' +
                    '<div class="series-name">' + escapeHtml(f.name) + '</div>' +
                    '</div>';
            }).join('');
            list.querySelectorAll('.series-card').forEach(function (card) {
                card.addEventListener('click', function () {
                    state.navigationStack.push('series');
                    openSeries(card.dataset.path, card.dataset.name);
                });
            });
            showView('series');
            return;
        }

        state.chapters = pdfs;
        $('chapters-title').textContent = seriesName;
        $('chapters-subtitle').textContent = pdfs.length + ' chapters';

        var chaptersList = $('chapters-list');

        if (pdfs.length === 0) {
            chaptersList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📭</div><div class="empty-state-text">No chapters found</div></div>';
        } else {
            var lastRead = getProgress(seriesPath);
            chaptersList.innerHTML = pdfs.map(function (pdf, idx) {
                var displayName = pdf.name.replace(/\.pdf$/i, '');
                var isLastRead = lastRead === pdf.name;
                return '<div class="chapter-item' + (isLastRead ? ' last-read' : '') + '" data-index="' + idx + '">' +
                    '<div class="chapter-number">' + (idx + 1) + '</div>' +
                    '<div class="chapter-info">' +
                    '<div class="chapter-name">' + escapeHtml(displayName) + '</div>' +
                    '<div class="chapter-size">' + formatSize(pdf.size) + (isLastRead ? ' · Last read' : '') + '</div>' +
                    '</div>' +
                    '<div class="chapter-read-icon">' +
                    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>' +
                    '</div>' +
                    '</div>';
            }).join('');

            chaptersList.querySelectorAll('.chapter-item').forEach(function (item) {
                item.addEventListener('click', function () {
                    state.navigationStack.push('chapters');
                    openChapter(parseInt(item.dataset.index));
                });
            });
        }

        hideLoading();
        showView('chapters');
    }).catch(function (err) {
        hideLoading();
        showToast('Error loading chapters');
        console.error(err);
    });
}

// ============================================
// READER VIEW
// ============================================
function openChapter(index) {
    if (index < 0 || index >= state.chapters.length) return;

    state.currentChapterIndex = index;
    var chapter = state.chapters[index];

    showLoading('Downloading ' + chapter.name + '...');

    initPdfJs().then(function () {
        return fetchPdfBlob(chapter.path);
    }).then(function (blob) {
        state.currentPdfBlob = blob;
        showLoading('Rendering pages...');
        return blob.arrayBuffer();
    }).then(function (arrayBuffer) {
        return pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    }).then(function (pdf) {
        var totalPages = pdf.numPages;

        $('reader-title').textContent = chapter.name.replace(/\.pdf$/i, '');
        $('reader-progress').textContent = totalPages + ' pages';

        var container = $('reader-container');
        container.innerHTML = '';

        var devicePixelRatio = window.devicePixelRatio || 1;
        var containerWidth = Math.min(window.innerWidth, 800);

        // Render pages sequentially
        var renderPage = function (pageNum) {
            if (pageNum > totalPages) {
                // All done
                saveProgress(state.currentSeries, chapter.name);
                $('btn-prev-chapter').disabled = index <= 0;
                $('btn-next-chapter').disabled = index >= state.chapters.length - 1;
                hideLoading();
                showView('reader');
                window.scrollTo(0, 0);
                state.headerVisible = true;
                $('reader-header').classList.remove('hidden');
                $('chapter-nav').classList.remove('hidden');
                startHideTimer();
                return;
            }

            pdf.getPage(pageNum).then(function (page) {
                var unscaledViewport = page.getViewport({ scale: 1 });
                var scale = (containerWidth * devicePixelRatio) / unscaledViewport.width;
                var viewport = page.getViewport({ scale: scale });

                var canvas = document.createElement('canvas');
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                canvas.style.width = '100%';
                canvas.style.height = 'auto';
                container.appendChild(canvas);

                var ctx = canvas.getContext('2d');
                page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () {
                    $('reader-progress').textContent = 'Rendered ' + pageNum + ' / ' + totalPages;
                    renderPage(pageNum + 1);
                });
            });
        };

        renderPage(1);
    }).catch(function (err) {
        hideLoading();
        showToast('Error loading PDF');
        console.error(err);
    });
}

// ---- READER HEADER AUTO-HIDE ----
function startHideTimer() {
    clearTimeout(state.hideTimer);
    state.hideTimer = setTimeout(function () {
        state.headerVisible = false;
        $('reader-header').classList.add('hidden');
        $('chapter-nav').classList.add('hidden');
    }, 3000);
}

function toggleReaderUI() {
    state.headerVisible = !state.headerVisible;
    if (state.headerVisible) {
        $('reader-header').classList.remove('hidden');
        $('chapter-nav').classList.remove('hidden');
        startHideTimer();
    } else {
        $('reader-header').classList.add('hidden');
        $('chapter-nav').classList.add('hidden');
    }
}

// ---- DOWNLOAD ----
function downloadCurrentPdf() {
    if (!state.currentPdfBlob || state.currentChapterIndex < 0) return;
    var chapter = state.chapters[state.currentChapterIndex];
    var url = URL.createObjectURL(state.currentPdfBlob);
    var a = document.createElement('a');
    a.href = url;
    a.download = chapter.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    showToast('Download started!');
}

// ---- CLEANUP ----
function cleanupReader() {
    var container = $('reader-container');
    container.innerHTML = '';
    state.currentPdfBlob = null;
    state.currentPdfUrl = null;
    clearTimeout(state.hideTimer);
}

// ---- BACK NAVIGATION ----
function goBack() {
    var prev = state.navigationStack.pop();
    if (prev === 'chapters') {
        cleanupReader();
        showView('chapters');
    } else if (prev === 'series') {
        showView('series');
    } else {
        showView('library');
    }
}

// ============================================
// EVENT LISTENERS
// ============================================
document.addEventListener('DOMContentLoaded', function () {
    renderLibrary();

    // Back buttons
    $('btn-back-library').addEventListener('click', function () {
        state.navigationStack = [];
        showView('library');
    });

    $('btn-back-series').addEventListener('click', function () {
        goBack();
    });

    $('btn-back-chapters').addEventListener('click', function () {
        goBack();
    });

    // Download
    $('btn-download').addEventListener('click', downloadCurrentPdf);

    // Chapter navigation
    $('btn-prev-chapter').addEventListener('click', function () {
        cleanupReader();
        openChapter(state.currentChapterIndex - 1);
    });
    $('btn-next-chapter').addEventListener('click', function () {
        cleanupReader();
        openChapter(state.currentChapterIndex + 1);
    });

    // Tap reader to toggle UI
    $('reader-container').addEventListener('click', function () {
        toggleReaderUI();
    });

    // Browser back button support
    window.addEventListener('popstate', function () {
        goBack();
    });

    // ---- SETTINGS MODAL ----
    function openSettings() {
        var saved = localStorage.getItem('mangacloud_token');
        $('token-input').value = saved || '';
        $('settings-modal').classList.add('active');
        $('token-input').focus();
    }
    function closeSettings() {
        $('settings-modal').classList.remove('active');
    }

    $('btn-open-settings').addEventListener('click', openSettings);
    $('btn-close-settings').addEventListener('click', closeSettings);
    $('settings-modal').addEventListener('click', function (e) {
        if (e.target === $('settings-modal')) closeSettings();
    });

    $('btn-save-token').addEventListener('click', function () {
        var val = $('token-input').value.trim();
        if (!val) { showToast('Please enter a token'); return; }
        localStorage.setItem('mangacloud_token', val);
        closeSettings();
        showToast('Token saved! ✓');
    });

    $('btn-reset-token').addEventListener('click', function () {
        localStorage.removeItem('mangacloud_token');
        $('token-input').value = '';
        closeSettings();
        showToast('Token reset to default');
    });

    // Register service worker (requires secure context — https or localhost)
    if ('serviceWorker' in navigator &&
        (location.protocol === 'https:' || location.hostname === 'localhost')) {
        navigator.serviceWorker.register('sw.js').catch(function (err) {
            console.log('SW registration failed:', err);
        });
    }
});
