// Grove - Markdown Notes App


let currentNote = null;
let currentFolder = '';
let previewMode = 'edit'; // 'edit', 'split', 'preview'
let autoSaveTimeout = null;
let recentFiles = JSON.parse(localStorage.getItem('grove-recent') || '[]').slice(0, 5);
let allContacts = [];
let defaultContactTemplate = '[{{first_name}} {{last_name}}](mailto:{{email}})';
let wikilinkMap = null; // Cache for wikilink title-to-path mapping

// Convert a mermaid SVG element to a PNG Blob (2× resolution).
async function svgToPngBlob(svgEl) {
    const rect = svgEl.getBoundingClientRect();
    const width  = rect.width  || svgEl.viewBox.baseVal.width  || 800;
    const height = rect.height || svgEl.viewBox.baseVal.height || 600;

    const cloned = svgEl.cloneNode(true);
    cloned.setAttribute('width',  width);
    cloned.setAttribute('height', height);
    // White background rectangle so PNG isn't transparent
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%');
    bg.setAttribute('fill', 'white');
    cloned.insertBefore(bg, cloned.firstChild);

    const svgData = new XMLSerializer().serializeToString(cloned);
    const url = URL.createObjectURL(new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' }));

    const img = new Image();
    img.src = url;
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });

    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width  = width  * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    URL.revokeObjectURL(url);

    return new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/png'));
}

async function copyMermaidAsPng(svgEl, btn) {
    btn.disabled = true;
    btn.textContent = '⏳';

    const reset = (label) => {
        btn.innerHTML = '<i class="fas fa-copy"></i> Copy PNG';
        btn.disabled = false;
        if (label) { btn.textContent = label; setTimeout(() => { btn.innerHTML = '<i class="fas fa-copy"></i> Copy PNG'; }, 2000); }
    };

    // Fallback: download as PNG file
    const downloadFallback = async () => {
        try {
            const blob = await svgToPngBlob(svgEl);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = 'diagram.png'; a.click();
            URL.revokeObjectURL(url);
            reset('✓ Downloaded');
        } catch (e) { reset('✗ Failed'); }
    };

    if (navigator.clipboard && window.ClipboardItem) {
        try {
            // Pass Promise directly — required to preserve user-gesture in Safari
            await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': svgToPngBlob(svgEl) })
            ]);
            reset('✓ Copied');
        } catch (e) {
            console.warn('Clipboard write failed, trying download:', e);
            await downloadFallback();
        }
    } else {
        await downloadFallback();
    }
}

function addMermaidCopyButtons(container) {
    container.querySelectorAll('.mermaid svg').forEach(svg => {
        const wrapper = svg.closest('.mermaid');
        if (!wrapper || wrapper.querySelector('.mermaid-copy-btn')) return;
        const btn = document.createElement('button');
        btn.className = 'mermaid-copy-btn';
        btn.innerHTML = '<i class="fas fa-copy"></i> Copy PNG';
        btn.addEventListener('click', (e) => { e.stopPropagation(); copyMermaidAsPng(svg, btn); });
        wrapper.appendChild(btn);
    });
}

// Token colors sourced directly from atom-one-dark / atom-one-light themes.
// Applied as inline styles so browser extensions (e.g. Dark Reader) can't override them.
const HLJS_COLORS = {
    dark: {
        _base: '#abb2bf', _bg: '#282c34', _border: '#3e4451',
        keyword: '#c678dd', doctag: '#c678dd', formula: '#c678dd',
        comment: '#5c6370', quote: '#5c6370',
        deletion: '#e06c75', name: '#e06c75', section: '#e06c75',
        'selector-tag': '#e06c75', subst: '#e06c75',
        literal: '#56b6c2',
        addition: '#98c379', attribute: '#98c379', regexp: '#98c379', string: '#98c379',
        attr: '#d19a66', number: '#d19a66', 'selector-attr': '#d19a66',
        'selector-class': '#d19a66', 'selector-pseudo': '#d19a66',
        'template-variable': '#d19a66', type: '#d19a66', variable: '#d19a66',
        bullet: '#61aeee', link: '#61aeee', meta: '#61aeee',
        'selector-id': '#61aeee', symbol: '#61aeee', title: '#61aeee',
        'built_in': '#e6c07b',
    },
    light: {
        _base: '#383a42', _bg: '#fafafa', _border: '#e0e0e0',
        keyword: '#a626a4', doctag: '#a626a4', formula: '#a626a4',
        comment: '#a0a1a7', quote: '#a0a1a7',
        deletion: '#e45649', name: '#e45649', section: '#e45649',
        'selector-tag': '#e45649', subst: '#e45649',
        literal: '#0184bb',
        addition: '#50a14f', attribute: '#50a14f', regexp: '#50a14f', string: '#50a14f',
        attr: '#986801', number: '#986801', 'selector-attr': '#986801',
        'selector-class': '#986801', 'selector-pseudo': '#986801',
        'template-variable': '#986801', type: '#986801', variable: '#986801',
        bullet: '#4078f2', link: '#4078f2', meta: '#4078f2',
        'selector-id': '#4078f2', symbol: '#4078f2', title: '#4078f2',
        'built_in': '#c18401',
    }
};

// Highlight code blocks inside a container using highlight.js.
// If hljs isn't loaded yet, inject it lazily then re-render.
function applyHljs(container) {
    const hjs = window.hljs;
    if (!hjs) {
        if (!window._hljsInjected) {
            window._hljsInjected = true;
            const s = document.createElement('script');
            s.src = '/static/js/highlight.min.js';
            s.onload = () => renderPreview();
            document.head.appendChild(s);
        }
        return;
    }
    const isLight = document.body.classList.contains('light-theme');
    const palette = HLJS_COLORS[isLight ? 'light' : 'dark'];

    container.querySelectorAll('pre code').forEach(el => {
        hjs.highlightElement(el);
        const pre = el.parentElement;
        pre.classList.add('hljs-pre');

        // Force background and base text color via inline styles (beats browser extensions)
        pre.style.setProperty('background', palette._bg, 'important');
        pre.style.setProperty('border-color', palette._border, 'important');
        el.style.setProperty('color', palette._base, 'important');
        el.style.setProperty('background', 'transparent', 'important');

        // Force token colors via inline styles
        el.querySelectorAll('[class]').forEach(span => {
            for (const cls of span.classList) {
                if (cls.startsWith('hljs-')) {
                    const token = cls.slice(5); // strip 'hljs-'
                    const color = palette[token];
                    if (color) { span.style.setProperty('color', color, 'important'); break; }
                }
            }
        });

        // Language label
        const langClass = [...el.classList].find(c => c.startsWith('language-'));
        if (langClass) {
            const lang = langClass.replace('language-', '');
            if (lang && lang !== 'plaintext' && !pre.querySelector('.hljs-lang-label')) {
                const label = document.createElement('span');
                label.className = 'hljs-lang-label';
                label.textContent = lang;
                pre.insertBefore(label, el);
            }
        }
    });
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    // Clear wikilink cache on page load to ensure fresh data
    wikilinkMap = null;
    
    // Configure marked options
    if (typeof marked !== 'undefined') {
        try {
            const opts = { gfm: true, breaks: false, mangle: false, smartLists: true };
            if (typeof marked.use === 'function') marked.use(opts);
            else if (typeof marked.setOptions === 'function') marked.setOptions(opts);
        } catch (e) { /* ignore */ }
    }

    initVaultSelect();
    loadContacts();
    loadProfiles();

    loadTree();
    loadTags();
    loadTemplates();
    loadRecentFiles();
    setupEventListeners();
    setupDragAndDrop();
    setupTreeDragAndDrop();
    setupKeyboardShortcuts();
    setupMarkdownToolbar();
    loadTheme();

    // Query LLM status to set button state
    fetch('/api/llm/status').then(r=>r.json()).then(s => {
        const btn = document.getElementById('llm-btn');
        if (!btn) return;
        if (s && s.effective) {
            btn.disabled = false;
            btn.title = 'LLM Assist';
        } else {
            btn.disabled = true;
            btn.title = 'LLM disabled (set GROVE_LLM_* env vars)';
        }
    }).catch(()=>{});

    // Deep-link: if URL has #open=path/to/file.md, load it
    try {
        const hash = window.location.hash || '';
        const m = hash.match(/(?:#|&)open=([^&]+)/);
        if (m && m[1]) {
            const path = decodeURIComponent(m[1]);
            setTimeout(() => loadNote(path), 250);
        } else {
            // No deep link - show splash
            showSplash(true);
        }
    } catch (e) { 
        showSplash(true);
    }

    // Respond to back/forward on hash changes
    window.addEventListener('hashchange', () => {
        const hash = window.location.hash || '';
        const m = hash.match(/(?:#|&)open=([^&]+)/);
        const path = m && m[1] ? decodeURIComponent(m[1]) : '';
        if (path && path !== currentNote) {
            loadNote(path);
        }
    });
});

function initVaultSelect() {
    const sel = document.getElementById('vault-select');
    if (!sel) return;
    fetch('/api/vaults').then(r=>r.json()).then(data => {
        sel.innerHTML = '';
        data.vaults.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name; opt.textContent = name;
            if (name === data.active) opt.selected = true;
            sel.appendChild(opt);
        });
    });
    sel.addEventListener('change', async () => {
        const name = sel.value;
        const resp = await fetch('/api/vaults/switch', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name})});
        if (resp.ok) {
            localStorage.setItem('grove-recent', '[]');
            location.reload();
        }
    });
}

let pendingDeleteVault = null;
async function deleteCurrentVault() {
    const sel = document.getElementById('vault-select');
    const name = sel.value;
    if (name === 'vault') {
        showNotification('Cannot delete the default vault');
        return;
    }
    pendingDeleteVault = name;
    document.getElementById('delete-vault-name').textContent = `"${name}"`;
    showModal('delete-vault-modal');
}

async function confirmDeleteVault() {
    if (!pendingDeleteVault) { hideModal('delete-vault-modal'); return; }
    const name = pendingDeleteVault;
    const resp = await fetch('/api/vaults/delete', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name})});
    if (resp.ok) {
        hideModal('delete-vault-modal');
        localStorage.setItem('grove-recent', '[]');
        location.reload();
    } else {
        const err = await resp.json();
        hideModal('delete-vault-modal');
        showNotification(err.error || 'Delete failed');
    }
}


async function createVaultFromModal() {
    const input = document.getElementById('modal-vault-name');
    const name = (input.value || '').trim();
    if (!name) return;
    const resp = await fetch('/api/vaults/create', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name})});
    if (!resp.ok) { showNotification('Vault already exists or invalid'); return; }
    await fetch('/api/vaults/switch', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name})});
    hideModal('new-vault-modal');
    localStorage.setItem('grove-recent', '[]');
    location.reload();
}


// Setup tree drag and drop for root level
function setupTreeDragAndDrop() {
    const fileTree = document.getElementById('file-tree');
    
    fileTree.addEventListener('dragover', (e) => {
        // Only allow drop on root if target is the tree container itself
        if (e.target === fileTree || e.target.classList.contains('tree-children')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        }
    });
    
    fileTree.addEventListener('drop', async (e) => {
        if (e.target === fileTree || e.target.classList.contains('tree-children')) {
            e.preventDefault();
            e.stopPropagation();
            
            if (draggedItem) {
                const sourcePath = draggedItem.dataset.path;
                const sourceType = draggedItem.dataset.type;
                
                // Choose API endpoint based on source type
                const endpoint = sourceType === 'folder' ? '/api/move-folder' : '/api/move';
                
                // Move to root
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        source: sourcePath,
                        target: ''
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    showNotification('Moved to root');
                    loadTree();
                    
                    if (sourceType === 'file' && currentNote === sourcePath) {
                        currentNote = result.path;
                    }
                } else {
                    showNotification(`Error: ${result.error}`);
                }
            }
        }
    });
}

// Load file tree
async function loadTree() {
    const response = await fetch('/api/tree');
    const tree = await response.json();
    renderTree(tree, document.getElementById('file-tree'));
}

// Render tree recursively
function renderTree(items, container, level = 0) {
    container.innerHTML = '';
    
    items.forEach(item => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'tree-item';
        itemDiv.style.paddingLeft = `${level * 16 + 8}px`;
        itemDiv.dataset.path = item.path;
        itemDiv.dataset.type = item.type;
        
        if (item.type === 'folder') {
            itemDiv.classList.add('tree-folder');
            itemDiv.innerHTML = `<i class="fas fa-folder"></i> ${item.name}`;
            itemDiv.setAttribute('draggable', 'true');
            itemDiv.addEventListener('click', (e) => {
                e.stopPropagation();
                currentFolder = item.path;
                
                // Highlight selected folder
                document.querySelectorAll('.tree-folder.selected').forEach(el => el.classList.remove('selected'));
                itemDiv.classList.add('selected');
                
                // Toggle folder expansion
                const existingChildren = itemDiv.nextElementSibling;
                if (existingChildren && existingChildren.classList.contains('tree-children')) {
                    // Folder is already expanded, collapse it
                    existingChildren.remove();
                    itemDiv.querySelector('i').classList.remove('fa-folder-open');
                    itemDiv.querySelector('i').classList.add('fa-folder');
                } else if (item.children && item.children.length > 0) {
                    // Expand folder
                    const childContainer = document.createElement('div');
                    childContainer.className = 'tree-children';
                    renderTree(item.children, childContainer, level + 1);
                    itemDiv.after(childContainer);
                    itemDiv.querySelector('i').classList.remove('fa-folder');
                    itemDiv.querySelector('i').classList.add('fa-folder-open');
                }
            });
            
            // Make folders draggable
            itemDiv.addEventListener('dragstart', handleDragStart);
            itemDiv.addEventListener('dragend', handleDragEnd);
            
            // Make folders drop targets
            itemDiv.addEventListener('dragover', handleDragOver);
            itemDiv.addEventListener('dragleave', handleDragLeave);
            itemDiv.addEventListener('drop', handleDrop);

            // Add context menu for folders (right-click to delete)
            itemDiv.addEventListener('contextmenu', (e) => {
                console.log('Context menu triggered for folder:', item.name);
                e.preventDefault();
                e.stopPropagation();
                showFolderContextMenu(e, item.path, item.name);
            });
        } else if (item.type === 'asset') {
            const ext = (item.name.split('.').pop() || '').toLowerCase();
            const iconMap = {png:'fa-image',jpg:'fa-image',jpeg:'fa-image',gif:'fa-image',webp:'fa-image',svg:'fa-image',pdf:'fa-file-pdf',mp3:'fa-file-audio',mp4:'fa-file-video',wav:'fa-file-audio'};
            const icon = iconMap[ext] || 'fa-file';
            itemDiv.innerHTML = `<i class="fas ${icon}"></i> ${item.name}`;
            itemDiv.style.opacity = '0.8';
            itemDiv.addEventListener('click', () => {
                // Open asset in preview modal or new tab
                const url = `/api/file/${item.path}`;
                if (['png','jpg','jpeg','gif','webp','svg'].includes(ext)) {
                    // Open image in preview modal
                    openImagePreview(url, item.name, item.path);
                } else {
                    window.open(url, '_blank');
                }
            });

            // Add context menu for assets (right-click to delete)
            itemDiv.addEventListener('contextmenu', (e) => {
                console.log('Context menu triggered for asset:', item.name);
                e.preventDefault();
                e.stopPropagation();
                showFileContextMenu(e, item.path, item.name);
            });
        } else {
            const starIcon = item.starred ? '<i class="fas fa-star" style="color: gold; font-size: 0.8em; margin-right: 4px;"></i>' : '';
            itemDiv.innerHTML = `${starIcon}<i class="fas fa-file-alt"></i> ${item.name}`;
            itemDiv.setAttribute('draggable', 'true');
            itemDiv.addEventListener('click', () => {
                loadNote(item.path);
                closeMobileMenu();
            });
            
            // Make files draggable
            itemDiv.addEventListener('dragstart', handleDragStart);
            itemDiv.addEventListener('dragend', handleDragEnd);

            // Add context menu for files (right-click to delete)
            itemDiv.addEventListener('contextmenu', (e) => {
                console.log('Context menu triggered for file:', item.name);
                e.preventDefault();
                e.stopPropagation();
                showFileContextMenu(e, item.path, item.name);
            });
        }
        
        container.appendChild(itemDiv);
        
        // Folders start collapsed - only expand on click
        // (children are rendered on-demand when folder is clicked)
    });
}

// Load a note
let currentNoteTags = [];
let currentNoteFrontmatter = '';
let showFrontmatter = false;

function setHashOpen(path) {
    try {
        const enc = encodeURIComponent(path);
        if (!window.location.hash.includes(enc)) {
            window.location.hash = `open=${enc}`;
        }
    } catch (e) { /* ignore */ }
}

async function loadNote(path, forceEditMode = false) {
    closeMobileMenu(); // close sidebar on mobile whenever a note is opened
    const response = await fetch(`/api/note/${path}`);
    const note = await response.json();
    
    currentNote = path;
    currentNoteTags = note.tags || [];
    
    // Strip frontmatter from content
    let content = note.content;
    currentNoteFrontmatter = '';
    
    const fmMatch = content.match(/^(---\n[\s\S]*?\n---)\n*([\s\S]*)$/);
    if (fmMatch) {
        currentNoteFrontmatter = fmMatch[1];
        content = fmMatch[2];
    }
    
    // Default to preview mode when opening a note (unless forceEditMode is true)
    previewMode = forceEditMode ? 'edit' : 'preview';
    showFrontmatter = false;
    const editorContainer = document.getElementById('drop-zone');
    
    if (forceEditMode) {
        editorContainer.classList.remove('preview-only', 'split-view');
        document.getElementById('preview-toggle').innerHTML = '<i class="fas fa-eye"></i>';
        document.getElementById('preview-toggle').title = 'Preview (Ctrl+P)';
    } else {
        editorContainer.classList.remove('split-view');
        editorContainer.classList.add('preview-only');
        document.getElementById('preview-toggle').innerHTML = '<i class="fas fa-edit"></i>';
        document.getElementById('preview-toggle').title = 'Edit Mode (Ctrl+P)';
    }
    
    document.getElementById('note-title').textContent = note.title;
    renderTagsDisplay();
    document.getElementById('editor').value = content;
    document.getElementById('editor').disabled = false;
    document.getElementById('tags-btn').disabled = false;
    const fmToggle = document.getElementById('frontmatter-toggle');
    if (fmToggle) fmToggle.disabled = true;
    document.getElementById('preview-toggle').disabled = false;
    document.getElementById('rename-btn').disabled = false;
    document.getElementById('share-btn').disabled = false;
    document.getElementById('frontmatter-preview').disabled = false;
    document.getElementById('star-btn').disabled = false;
    
    // Update star button appearance
    updateStarButton(note.starred || false);
    
    // Render preview (default mode)
    renderPreview();
    
    // Add to recent files
    addToRecent(path, note.title);
    // Update URL hash for deep link
    setHashOpen(path);
    
    // Update breadcrumbs
    updateBreadcrumbs();
    
    // Setup auto-save for this note
    setupAutoSave();
    
    // Load backlinks for this note
    loadBacklinks(path);
    
    // Highlight active note
    document.querySelectorAll('.tree-item').forEach(item => {
        item.classList.remove('active');
        if (item.textContent.trim().replace(/^\s*[\w-]+\s*/, '') === note.title) {
            item.classList.add('active');
        }
    });
}

function renderTagsDisplay() {
    const container = document.getElementById('tags-display');
    container.innerHTML = '';
    
    if (currentNoteTags.length === 0) {
        container.innerHTML = '<span style="color: #888; font-size: 12px;">No tags</span>';
        return;
    }
    
    currentNoteTags.forEach(tag => {
        const badge = document.createElement('span');
        badge.className = 'tag-badge';
        badge.textContent = tag;
        container.appendChild(badge);
    });
}

function openTagsModal() {
    renderTagsModal();
    showModal('tags-modal');
    document.getElementById('tags-modal-input').focus();
}

function renderTagsModal() {
    const container = document.getElementById('tags-modal-display');
    container.innerHTML = '';
    
    if (currentNoteTags.length === 0) {
        container.innerHTML = '<p style="color: #888; text-align: center; margin: 20px 0;">No tags yet. Add one below!</p>';
        return;
    }
    
    currentNoteTags.forEach(tag => {
        const badge = document.createElement('span');
        badge.className = 'tag-badge';
        badge.innerHTML = `
            ${escapeHtml(tag)}
            <span class="remove-tag" data-tag="${escapeHtml(tag)}">&times;</span>
        `;
        
        badge.querySelector('.remove-tag').addEventListener('click', () => {
            removeTag(tag);
        });
        
        container.appendChild(badge);
    });
}

async function addTagFromModal() {
    const input = document.getElementById('tags-modal-input');
    const tag = input.value.trim();
    
    if (tag && !currentNoteTags.includes(tag)) {
        currentNoteTags.push(tag);
        // Save body first (without frontmatter), then update tags via API
        await saveBodyOnly();
        await saveTags();
        await reloadFrontmatter();
        renderTagsModal();
        renderTagsDisplay();
        input.value = '';
    }
}

async function removeTag(tag) {
    currentNoteTags = currentNoteTags.filter(t => t !== tag);
    // Save body first (without frontmatter), then update tags via API
    await saveBodyOnly();
    await saveTags();
    await reloadFrontmatter();
    renderTagsModal();
    renderTagsDisplay();
}

// Save just the body content to the server (prepends stored frontmatter)
async function saveBodyOnly() {
    if (!currentNote) return;
    
    let content = document.getElementById('editor').value;
    
    // Frontmatter is managed by Grove; always strip any accidental inclusion
    {
        const { body } = stripFrontmatter(content);
        content = body;
    }
    
    // Add stored frontmatter
    if (currentNoteFrontmatter) {
        content = currentNoteFrontmatter + '\n\n' + content;
    }
    
    await fetch(`/api/note/${currentNote}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
    });
}

// Reload frontmatter from server after tag changes
async function reloadFrontmatter() {
    if (!currentNote) return;
    
    const response = await fetch(`/api/note/${currentNote}`);
    const note = await response.json();
    
    const { fm } = stripFrontmatter(note.content);
    currentNoteFrontmatter = fm;
    
    // Editor never shows frontmatter; nothing to toggle
    // Keep stored frontmatter fresh for saves
}

function stripFrontmatter(text) {
    const match = text.match(/^(---\n[\s\S]*?\n---)\n*([\s\S]*)$/);
    if (match) return { fm: match[1], body: match[2] };
    return { fm: '', body: text };
}

// LLM helpers (optional)
function initLlmUi() {
    // nothing yet; placeholder in case we need dynamic pieces later
}

function openLlmModal() {
    fetch('/api/llm/status').then(r=>r.json()).then(s => {
        const note = document.getElementById('llm-status-note');
        if (note) {
            note.textContent = s && s.effective ? '' : 'LLM disabled or not configured';
        }
        // Populate model dropdown
        const sel = document.getElementById('llm-model-select');
        if (sel && s && s.models) {
            sel.innerHTML = '';
            s.models.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m;
                opt.textContent = m;
                if (m === s.model) opt.selected = true;
                sel.appendChild(opt);
            });
        }
        showModal('llm-modal');
        setTimeout(()=>document.getElementById('llm-prompt').focus(),0);
    }).catch(()=>{
        showModal('llm-modal');
    });
}

async function runLlm() {
    const ta = document.getElementById('llm-prompt');
    const includeSel = document.getElementById('llm-include-selection').checked;
    const mode = document.getElementById('llm-insert-mode').value;
    const editor = document.getElementById('editor');
    const runBtn = document.getElementById('llm-run-btn');
    const sel = includeSel ? editor.value.substring(editor.selectionStart, editor.selectionEnd) : '';
    const modelSel = document.getElementById('llm-model-select');
    const payload = { prompt: ta.value, selection: sel, model: modelSel ? modelSel.value : '' };
    
    // Create abort controller for timeout
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 60000); // 60s timeout
    
    let loadingToast = null;
    try {
        // Close modal immediately and show progress toast
        hideModal('llm-modal');
        if (runBtn) runBtn.disabled = true;
        loadingToast = showNotification('LLM thinking...', true); // persistent toast
        
        const resp = await fetch('/api/llm', { 
            method: 'POST', 
            headers: {'Content-Type': 'application/json'}, 
            body: JSON.stringify(payload),
            signal: abortController.signal
        });
        const data = await resp.json();
        
        if (!resp.ok) { 
            hideNotification(loadingToast);
            showNotification(data.error || 'LLM failed'); 
            return; 
        }
        
        const text = data.text || '';
        insertLlmText(editor, text, mode);
        hideNotification(loadingToast);
        showNotification('✓ Inserted AI output');

        // Re-render preview if visible
        if (previewMode !== 'edit') renderPreview();

        // Trigger autosave soon
        saveNoteUpdated();
    } catch (e) {
        hideNotification(loadingToast);
        if (e.name === 'AbortError') {
            showNotification('LLM request timed out (60s)');
        } else {
            showNotification('LLM call failed');
        }
    } finally {
        clearTimeout(timeoutId);
        if (runBtn) runBtn.disabled = false;
    }
}

function insertLlmText(editor, text, mode) {
    const marker = `\n\n<!-- ai: inserted ${new Date().toISOString()} -->\n`;
    const insert = text + marker;
    if (mode === 'replace') {
        const start = editor.selectionStart, end = editor.selectionEnd;
        editor.value = editor.value.substring(0,start) + insert + editor.value.substring(end);
        editor.selectionStart = editor.selectionEnd = start + insert.length;
    } else if (mode === 'cursor') {
        const pos = editor.selectionStart;
        editor.value = editor.value.substring(0,pos) + insert + editor.value.substring(pos);
        editor.selectionStart = editor.selectionEnd = pos + insert.length;
    } else {
        // below selection
        const end = editor.selectionEnd;
        editor.value = editor.value.substring(0,end) + '\n\n' + insert + editor.value.substring(end);
        editor.selectionStart = editor.selectionEnd = end + insert.length + 2;
    }
    editor.focus();
}

// Resolve relative paths in rendered markdown (images, links)
function resolveRelativePaths(container) {
    if (!currentNote) return;
    
    // Get the directory of the current note
    const parts = currentNote.split('/');
    parts.pop(); // Remove filename
    const noteDir = parts.join('/');
    
    // Process images
    container.querySelectorAll('img').forEach(img => {
        const src = img.getAttribute('src');
        if (src && !src.startsWith('/') && !src.startsWith('http') && !src.startsWith('data:')) {
            // Relative path - resolve it
            let resolvedPath;
            if (src.startsWith('./')) {
                resolvedPath = noteDir ? `${noteDir}/${src.slice(2)}` : src.slice(2);
            } else {
                resolvedPath = noteDir ? `${noteDir}/${src}` : src;
            }
            img.setAttribute('src', `/api/file/${resolvedPath}`);
        }
    });
    
    // Process links to local files (not .md notes, not external)
    container.querySelectorAll('a').forEach(a => {
        const href = a.getAttribute('href');
        if (href && !href.startsWith('/') && !href.startsWith('http') && !href.startsWith('#') && !href.endsWith('.md')) {
            // Check if it looks like a file (has extension)
            if (href.includes('.') && !href.includes('://')) {
                let resolvedPath;
                if (href.startsWith('./')) {
                    resolvedPath = noteDir ? `${noteDir}/${href.slice(2)}` : href.slice(2);
                } else {
                    resolvedPath = noteDir ? `${noteDir}/${href}` : href;
                }
                a.setAttribute('href', `/api/file/${resolvedPath}`);
                a.setAttribute('target', '_blank');
            }
        }
    });
}

// Share functions
function getRenderedHtml() {
    const body = document.getElementById('editor').value;
    const title = document.getElementById('note-title').textContent;
    let html;
    if (typeof marked === 'function') html = marked(body);
    else if (typeof marked === 'object' && typeof marked.parse === 'function') html = marked.parse(body);
    else html = '<pre>' + body + '</pre>';
    return { title, body, html };
}

function shareViaPrint() {
    hideModal('share-modal');
    const { title, html } = getRenderedHtml();
    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html><head><title>${title}</title>
        <style>body{font-family:system-ui,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.6}
        h1,h2,h3{margin-top:1.5em} pre{background:#f5f5f5;padding:12px;border-radius:4px;overflow-x:auto}
        code{background:#f5f5f5;padding:2px 4px;border-radius:3px} blockquote{border-left:3px solid #ccc;margin-left:0;padding-left:16px;color:#666}
        @media print{body{margin:0;max-width:none}}</style></head>
        <body><h1>${title}</h1>${html}</body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 300);
}

async function shareViaEmail() {
    hideModal('share-modal');
    const { title, html } = getRenderedHtml();

    // Create formatted HTML for email with inline styles
    const emailHtml = `<div style="font-family:system-ui,-apple-system,sans-serif;line-height:1.6;color:#333">
<h1 style="margin-top:0;color:#2c3e50">${title}</h1>
${html}
</div>`;

    try {
        // Automatically copy formatted content to clipboard
        await navigator.clipboard.write([
            new ClipboardItem({
                'text/html': new Blob([emailHtml], { type: 'text/html' }),
                'text/plain': new Blob([document.getElementById('editor').value], { type: 'text/plain' })
            })
        ]);

        // Open email client
        window.open('mailto:?subject=' + encodeURIComponent(title));

        // Show persistent notification
        showNotification('✓ Formatted content copied! Just paste (Cmd+V) into email body', true);
    } catch (e) {
        // Fallback: open email and show instruction
        window.open('mailto:?subject=' + encodeURIComponent(title));
        showNotification('Copy the note content manually');
    }
}

async function shareViaCopyMarkdown() {
    hideModal('share-modal');
    const body = document.getElementById('editor').value;
    try {
        await navigator.clipboard.writeText(body);
        showNotification('Markdown copied to clipboard');
    } catch (e) {
        showNotification('Copy failed');
    }
}

function shareViaCopyLink() {
    hideModal('share-modal');
    if (!currentNote) { showNotification('No note selected'); return; }
    const url = `${window.location.origin}/#open=${encodeURIComponent(currentNote)}`;
    // Clipboard API with fallback
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(url).then(()=>showNotification('Link copied'))
            .catch(()=>fallbackCopy(url));
    } else {
        fallbackCopy(url);
    }
}

function fallbackCopy(text) {
    try {
        const tmp = document.createElement('textarea');
        tmp.value = text;
        tmp.setAttribute('readonly','');
        tmp.style.position = 'fixed';
        tmp.style.left = '-9999px';
        document.body.appendChild(tmp);
        tmp.select();
        document.execCommand('copy');
        document.body.removeChild(tmp);
        showNotification('Link copied');
    } catch (e) {
        showNotification('Copy failed');
    }
}

async function shareViaCopyHtml() {
    hideModal('share-modal');
    const { html } = getRenderedHtml();
    
    // Try ClipboardItem API first (needs HTTPS + browser support)
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        try {
            await navigator.clipboard.write([
                new ClipboardItem({
                    'text/html': new Blob([html], { type: 'text/html' }),
                    'text/plain': new Blob([html], { type: 'text/plain' })
                })
            ]);
            showNotification('HTML copied to clipboard');
            return;
        } catch (e) { /* fall through */ }
    }
    
    // Fallback: use execCommand with a hidden contenteditable div (works on HTTP + Safari)
    try {
        const tmp = document.createElement('div');
        tmp.contentEditable = true;
        tmp.innerHTML = html;
        tmp.style.position = 'fixed';
        tmp.style.left = '-9999px';
        document.body.appendChild(tmp);
        const range = document.createRange();
        range.selectNodeContents(tmp);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('copy');
        sel.removeAllRanges();
        document.body.removeChild(tmp);
        showNotification('HTML copied to clipboard');
    } catch (e2) {
        // Last resort: plain text
        try { await navigator.clipboard.writeText(html); showNotification('HTML copied as text'); }
        catch (e3) { showNotification('Copy failed — try HTTPS for full clipboard support'); }
    }
}

// ─── Image Upload & Paste ───

function uploadImageForEditor(editor) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.pdf';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const formData = new FormData();
        formData.append('file', file);
        formData.append('folder', 'attachments');
        try {
            const resp = await fetch('/api/upload', { method: 'POST', body: formData });
            const result = await resp.json();
            if (result.success) {
                insertTextAtCursor(editor, result.markdown + '\n');
                showNotification('Image uploaded');
            } else {
                showNotification(result.error || 'Upload failed');
            }
        } catch (err) {
            showNotification('Upload failed');
        }
    };
    input.click();
}

async function handleImagePaste(e) {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;

    for (const item of items) {
        if (item.type.startsWith('image/')) {
            e.preventDefault();
            const blob = item.getAsFile();
            const reader = new FileReader();
            reader.onload = async () => {
                const b64 = reader.result;
                const ext = blob.type.split('/')[1] || 'png';
                const filename = `paste-${Date.now()}.${ext}`;
                try {
                    const resp = await fetch('/api/upload/paste', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ data: b64, filename, folder: 'attachments' })
                    });
                    const result = await resp.json();
                    if (result.success) {
                        insertTextAtCursor(e.target, result.markdown + '\n');
                        showNotification('Image pasted');
                    }
                } catch (err) {
                    showNotification('Paste upload failed');
                }
            };
            reader.readAsDataURL(blob);
            return;
        }
    }
}

function insertTextAtCursor(editor, text) {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const val = editor.value;
    editor.value = val.substring(0, start) + text + val.substring(end);
    editor.selectionStart = editor.selectionEnd = start + text.length;
    editor.focus();
}

// ─── Contacts Management ───

async function loadContacts() {
    try {
        const resp = await fetch('/api/contacts');
        allContacts = await resp.json();
        if (!Array.isArray(allContacts)) allContacts = [];
    } catch (e) { allContacts = []; }
    // Load default contact template from config
    try {
        const cfg = await (await fetch('/api/config')).json();
        if (cfg.default_contact_template) defaultContactTemplate = cfg.default_contact_template;
    } catch (e) {}
}

function openContactsModal() {
    document.getElementById('contacts-search').value = '';
    renderContactsList();
    showModal('contacts-modal');
}

function renderContactsList(filterText = '') {
    const container = document.getElementById('contacts-list');
    if (allContacts.length === 0) {
        container.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-secondary);">No contacts yet.</div>';
        return;
    }

    // Filter contacts based on search text
    const filter = filterText.toLowerCase().trim();
    const filteredContacts = filter ? allContacts.filter(c => {
        const firstName = (c.first_name || '').toLowerCase();
        const lastName = (c.last_name || '').toLowerCase();
        const email = (c.email || '').toLowerCase();
        const phone = (c.phone || '').toLowerCase();
        const officePhone = (c.office_phone || '').toLowerCase();
        const mobilePhone = (c.mobile_phone || '').toLowerCase();
        const zoomId = (c.zoom_id || '').toLowerCase();
        const company = (c.company || '').toLowerCase();
        const title = (c.title || '').toLowerCase();
        const department = (c.department || '').toLowerCase();
        const note = (c.note || '').toLowerCase();
        const id = (c.id || '').toLowerCase();

        return firstName.includes(filter) ||
               lastName.includes(filter) ||
               email.includes(filter) ||
               phone.includes(filter) ||
               officePhone.includes(filter) ||
               mobilePhone.includes(filter) ||
               zoomId.includes(filter) ||
               company.includes(filter) ||
               title.includes(filter) ||
               department.includes(filter) ||
               note.includes(filter) ||
               id.includes(filter);
    }) : allContacts;

    if (filteredContacts.length === 0) {
        container.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-secondary);">No contacts match your search.</div>';
        return;
    }

    container.innerHTML = '';
    filteredContacts.forEach(c => {
        const row = document.createElement('div');
        row.className = 'contact-row';

        // Build clickable contact method icons
        const methods = [];
        if (c.email) methods.push(`<a href="mailto:${escapeHtml(c.email)}" title="${escapeHtml(c.email)}" style="color:inherit;"><i class="fas fa-envelope"></i></a>`);
        const anyPhone = c.mobile_phone || c.phone || c.office_phone;
        if (anyPhone) methods.push(`<a href="tel:${escapeHtml(anyPhone)}" title="${escapeHtml(anyPhone)}" style="color:inherit;"><i class="fas fa-phone"></i></a>`);
        if (c.office_phone && c.office_phone !== anyPhone) methods.push(`<a href="tel:${escapeHtml(c.office_phone)}" title="Office: ${escapeHtml(c.office_phone)}" style="color:inherit;"><i class="fas fa-building"></i></a>`);
        if (c.zoom_id) {
            const zoomUrl = c.zoom_id.startsWith('http') ? c.zoom_id : `https://zoom.us/j/${c.zoom_id}`;
            methods.push(`<a href="${escapeHtml(zoomUrl)}" target="_blank" title="Zoom: ${escapeHtml(c.zoom_id)}" style="color:inherit;"><i class="fas fa-video"></i></a>`);
        }
        const methodsHtml = methods.length > 0 ? ' · ' + methods.join(' ') : '';

        row.innerHTML = `
            <div class="contact-info">
                <div class="name">${escapeHtml(c.first_name)} ${escapeHtml(c.last_name)}</div>
                <div class="detail">${escapeHtml(c.id || '')}${c.email ? ' · ' + escapeHtml(c.email) : ''}${c.company ? ' · ' + escapeHtml(c.company) : ''}${methodsHtml}</div>
            </div>
            <div class="contact-actions">
                <button class="btn-secondary" style="padding:4px 8px;" data-edit="${c.id}"><i class="fas fa-pen"></i></button>
                <button class="btn-secondary" style="padding:4px 8px;" data-delete="${c.id}"><i class="fas fa-trash"></i></button>
            </div>
        `;
        row.querySelector('[data-edit]').addEventListener('click', () => openContactEdit(c));
        row.querySelector('[data-delete]').addEventListener('click', async () => {
            if (!confirm(`Delete ${c.first_name} ${c.last_name}?`)) return;
            await fetch(`/api/contacts/${c.id}`, {method:'DELETE'});
            await loadContacts();
            renderContactsList();
        });
        container.appendChild(row);
    });
}

async function openContactEdit(contact) {
    document.getElementById('contact-edit-title').textContent = contact ? 'Edit Contact' : 'Add Contact';
    const idField = document.getElementById('contact-edit-id');
    idField.value = contact ? contact.id : '';
    idField.dataset.existing = contact ? contact.id : '';
    document.getElementById('contact-first-name').value = contact ? (contact.first_name || '') : '';
    document.getElementById('contact-last-name').value = contact ? (contact.last_name || '') : '';
    document.getElementById('contact-title').value = contact ? (contact.title || '') : '';
    document.getElementById('contact-department').value = contact ? (contact.department || '') : '';
    document.getElementById('contact-company').value = contact ? (contact.company || '') : '';
    document.getElementById('contact-email').value = contact ? (contact.email || '') : '';
    document.getElementById('contact-phone').value = contact ? (contact.phone || '') : '';
    document.getElementById('contact-office-phone').value = contact ? (contact.office_phone || '') : '';
    document.getElementById('contact-mobile-phone').value = contact ? (contact.mobile_phone || '') : '';
    document.getElementById('contact-zoom-id').value = contact ? (contact.zoom_id || '') : '';
    document.getElementById('contact-note').value = contact ? (contact.note || '') : '';

    // Populate profile dropdown
    const profileSelect = document.getElementById('contact-profile');
    profileSelect.innerHTML = '<option value="">Select Profile...</option>';
    allProfiles.forEach(p => {
        const option = document.createElement('option');
        option.value = p.id;
        option.textContent = p.name + (p.is_default ? ' (Default)' : '');
        if (contact && contact.profile_id === p.id) {
            option.selected = true;
        } else if (!contact && p.is_default) {
            option.selected = true;
        }
        profileSelect.appendChild(option);
    });

    showModal('contact-edit-modal');
    setTimeout(() => document.getElementById('contact-first-name').focus(), 0);
}

async function saveContactFromModal() {
    const existingId = document.getElementById('contact-edit-id').dataset.existing;
    const newId = document.getElementById('contact-edit-id').value.trim();
    const profileValue = document.getElementById('contact-profile').value;
    const data = {
        id: newId || undefined,
        first_name: document.getElementById('contact-first-name').value.trim(),
        last_name: document.getElementById('contact-last-name').value.trim(),
        title: document.getElementById('contact-title').value.trim(),
        department: document.getElementById('contact-department').value.trim(),
        company: document.getElementById('contact-company').value.trim(),
        email: document.getElementById('contact-email').value.trim(),
        phone: document.getElementById('contact-phone').value.trim(),
        office_phone: document.getElementById('contact-office-phone').value.trim(),
        mobile_phone: document.getElementById('contact-mobile-phone').value.trim(),
        zoom_id: document.getElementById('contact-zoom-id').value.trim(),
        note: document.getElementById('contact-note').value.trim(),
        profile_id: profileValue ? profileValue : null
    };
    if (!data.first_name && !data.last_name) { showNotification('Name required'); return; }
    if (existingId) {
        await fetch(`/api/contacts/${existingId}`, {method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data)});
    } else {
        await fetch('/api/contacts', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data)});
    }
    hideModal('contact-edit-modal');
    await loadContacts();
    renderContactsList();
    showNotification(existingId ? 'Contact updated' : 'Contact added');
}

async function importContactsPrompt() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const text = await file.text();
        try {
            let data = JSON.parse(text);
            if (!Array.isArray(data)) data = data.contacts || [];
            const resp = await fetch('/api/contacts/import', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data)});
            const result = await resp.json();
            await loadContacts();
            renderContactsList();
            showNotification(`Imported ${result.added} contacts (${result.total} total)`);
        } catch (err) {
            showNotification('Invalid JSON file');
        }
    };
    input.click();
}

// ─── Template Profiles Management ───

let allProfiles = [];

async function loadProfiles() {
    try {
        const cfg = await (await fetch('/api/config')).json();
        allProfiles = cfg.template_profiles || [];
    } catch (e) {
        allProfiles = [];
    }
}

function openProfilesModal() {
    renderProfilesList();
    showModal('profiles-modal');
}

function renderProfilesList() {
    const container = document.getElementById('profiles-list');
    if (allProfiles.length === 0) {
        container.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-secondary);">No profiles yet.</div>';
        return;
    }
    container.innerHTML = '';
    allProfiles.forEach(p => {
        const row = document.createElement('div');
        row.className = 'contact-row';
        const defaultBadge = p.is_default ? '<span style="background:#4CAF50;color:white;padding:2px 6px;border-radius:4px;font-size:11px;margin-left:8px;">DEFAULT</span>' : '';
        const enabledTemplates = [];
        if (p.email_enabled) enabledTemplates.push('<i class="fas fa-envelope"></i> Email');
        if (p.phone_enabled) enabledTemplates.push('<i class="fas fa-phone"></i> Phone');
        if (p.zoom_enabled) enabledTemplates.push('<i class="fas fa-video"></i> Zoom');
        row.innerHTML = `
            <div class="contact-info">
                <div class="name">${escapeHtml(p.name)}${defaultBadge}</div>
                <div class="detail">${enabledTemplates.join(' · ')}</div>
            </div>
            <div class="contact-actions">
                <button class="btn-secondary" style="padding:4px 8px;" data-edit="${p.id}"><i class="fas fa-pen"></i></button>
                ${!p.is_default ? `<button class="btn-secondary" style="padding:4px 8px;" data-delete="${p.id}"><i class="fas fa-trash"></i></button>` : ''}
            </div>
        `;
        row.querySelector('[data-edit]').addEventListener('click', () => openProfileEdit(p));
        const deleteBtn = row.querySelector('[data-delete]');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', async () => {
                if (!confirm(`Delete profile "${p.name}"?`)) return;
                allProfiles = allProfiles.filter(prof => prof.id !== p.id);
                await saveProfiles();
                renderProfilesList();
            });
        }
        container.appendChild(row);
    });
}

function openProfileEdit(profile) {
    document.getElementById('profile-edit-title').textContent = profile ? 'Edit Profile' : 'Add Profile';
    const nameField = document.getElementById('profile-name');
    nameField.value = profile ? profile.name : '';
    nameField.dataset.existing = profile ? profile.id : '';

    document.getElementById('profile-name-template').value = profile ? (profile.name_template || '') : '{{first_name}} {{last_name}}';

    document.getElementById('profile-email-template').value = profile ? (profile.email_template || '') : 'mailto:{{email}}';
    document.getElementById('profile-email-enabled').checked = profile ? (profile.email_enabled !== false) : true;

    document.getElementById('profile-phone-template').value = profile ? (profile.phone_template || '') : 'tel:{{phone}}';
    document.getElementById('profile-phone-enabled').checked = profile ? (profile.phone_enabled !== false) : true;

    document.getElementById('profile-zoom-template').value = profile ? (profile.zoom_template || '') : 'https://zoom.us/j/{{zoom_id}}';
    document.getElementById('profile-zoom-enabled').checked = profile ? (profile.zoom_enabled !== false) : true;

    document.getElementById('profile-is-default').checked = profile ? (profile.is_default === true) : false;

    showModal('profile-edit-modal');
    setTimeout(() => nameField.focus(), 0);
}

async function saveProfileFromModal() {
    const existingId = document.getElementById('profile-name').dataset.existing;
    const name = document.getElementById('profile-name').value.trim();
    if (!name) {
        showNotification('Profile name required');
        return;
    }

    const newProfile = {
        id: existingId || 'profile_' + Date.now(),
        name: name,
        name_template: document.getElementById('profile-name-template').value.trim() || '{{first_name}} {{last_name}}',
        email_template: document.getElementById('profile-email-template').value.trim(),
        email_enabled: document.getElementById('profile-email-enabled').checked,
        phone_template: document.getElementById('profile-phone-template').value.trim(),
        phone_enabled: document.getElementById('profile-phone-enabled').checked,
        zoom_template: document.getElementById('profile-zoom-template').value.trim(),
        zoom_enabled: document.getElementById('profile-zoom-enabled').checked,
        is_default: document.getElementById('profile-is-default').checked
    };

    // If setting as default, remove default flag from others
    if (newProfile.is_default) {
        allProfiles.forEach(p => p.is_default = false);
    }

    if (existingId) {
        const idx = allProfiles.findIndex(p => p.id === existingId);
        if (idx >= 0) allProfiles[idx] = newProfile;
    } else {
        allProfiles.push(newProfile);
    }

    await saveProfiles();
    hideModal('profile-edit-modal');
    renderProfilesList();
    showNotification(existingId ? 'Profile updated' : 'Profile added');
}

async function saveProfiles() {
    const cfg = await (await fetch('/api/config')).json();
    cfg.template_profiles = allProfiles;
    await fetch('/api/config', {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(cfg)
    });
}

// ─── @ Mention Autocomplete ───

function setupMentionAutocomplete() {
    const editor = document.getElementById('editor');
    const dropdown = document.getElementById('mention-dropdown');
    let mentionStart = -1;
    let activeIndex = 0;
    let filtered = [];

    function closeMention() {
        dropdown.style.display = 'none';
        mentionStart = -1;
        filtered = [];
        activeIndex = 0;
    }

    function renderMentionDropdown() {
        dropdown.innerHTML = '';
        filtered.forEach((c, i) => {
            const item = document.createElement('div');
            item.className = 'mention-item' + (i === activeIndex ? ' active' : '');
            item.innerHTML = `
                <span class="mention-name">${escapeHtml(c.first_name)} ${escapeHtml(c.last_name)}</span>
                <span class="mention-detail">${escapeHtml(c.email || '')}${c.company ? ' · ' + escapeHtml(c.company) : ''}</span>
            `;
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                insertMention(c);
            });
            dropdown.appendChild(item);
        });
    }

    function insertMention(contact) {
        // Find the profile for this contact
        const profile = allProfiles.find(p => p.id === contact.profile_id) ||
                       allProfiles.find(p => p.is_default) ||
                       allProfiles[0];

        // Helper function to substitute variables in templates
        function substitute(template) {
            if (!template) return '';
            return template
                .replace(/\{\{first_name\}\}/g, contact.first_name || '')
                .replace(/\{\{last_name\}\}/g, contact.last_name || '')
                .replace(/\{\{email\}\}/g, contact.email || '')
                .replace(/\{\{phone\}\}/g, contact.phone || '')
                .replace(/\{\{zoom_id\}\}/g, contact.zoom_id || '')
                .replace(/\{\{company\}\}/g, contact.company || '')
                .replace(/\{\{id\}\}/g, contact.id || '');
        }

        // Build contact name using profile's name template
        const nameTemplate = profile && profile.name_template ? profile.name_template : '{{first_name}} {{last_name}}';
        const contactName = substitute(nameTemplate);

        // Build the mention text with icons for enabled templates
        let mentionText = contactName;

        if (profile) {
            const icons = [];

            if (profile.email_enabled && contact.email) {
                const url = substitute(profile.email_template);
                icons.push(`[<i class="fas fa-envelope"></i>](${url})`);
            }

            if (profile.phone_enabled && contact.phone) {
                const url = substitute(profile.phone_template);
                icons.push(`[<i class="fas fa-phone"></i>](${url})`);
            }

            if (profile.zoom_enabled && contact.zoom_id) {
                const url = substitute(profile.zoom_template);
                icons.push(`[<i class="fas fa-video"></i>](${url})`);
            }

            if (icons.length > 0) {
                mentionText += ' ' + icons.join(' ');
            }
        }

        const text = editor.value;
        const before = text.substring(0, mentionStart);
        const after = text.substring(editor.selectionStart);
        editor.value = before + mentionText + after;
        const newPos = before.length + mentionText.length;
        editor.selectionStart = editor.selectionEnd = newPos;
        editor.focus();
        closeMention();
    }

    function positionDropdown() {
        // Approximate position near cursor
        const rect = editor.getBoundingClientRect();
        const lineHeight = 20;
        const text = editor.value.substring(0, editor.selectionStart);
        const lines = text.split('\n');
        const currentLine = lines.length - 1;
        const scrollTop = editor.scrollTop;
        const top = rect.top + (currentLine * lineHeight) - scrollTop + lineHeight + 4;
        const col = lines[lines.length - 1].length;
        const left = rect.left + Math.min(col * 8, rect.width - 260);
        dropdown.style.top = Math.min(top, rect.bottom - 40) + 'px';
        dropdown.style.left = Math.max(left, rect.left) + 'px';
    }

    editor.addEventListener('input', () => {
        const pos = editor.selectionStart;
        const text = editor.value;

        // Find @ trigger
        let atPos = -1;
        for (let i = pos - 1; i >= 0; i--) {
            if (text[i] === '@') { atPos = i; break; }
            if (text[i] === ' ' || text[i] === '\n') break;
        }

        if (atPos >= 0) {
            const query = text.substring(atPos + 1, pos).toLowerCase();
            filtered = allContacts.filter(c => {
                const full = ((c.first_name || '') + ' ' + (c.last_name || '') + ' ' + (c.email || '') + ' ' + (c.company || '') + ' ' + (c.note || '')).toLowerCase();
                return full.includes(query);
            }).slice(0, 8);

            if (filtered.length > 0) {
                mentionStart = atPos;
                activeIndex = 0;
                positionDropdown();
                renderMentionDropdown();
                dropdown.style.display = 'block';
            } else {
                closeMention();
            }
        } else {
            closeMention();
        }
    });

    editor.addEventListener('keydown', (e) => {
        if (dropdown.style.display === 'none') return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            activeIndex = (activeIndex + 1) % filtered.length;
            renderMentionDropdown();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            activeIndex = (activeIndex - 1 + filtered.length) % filtered.length;
            renderMentionDropdown();
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            if (filtered.length > 0) {
                e.preventDefault();
                insertMention(filtered[activeIndex]);
            }
        } else if (e.key === 'Escape') {
            closeMention();
        }
    });

    editor.addEventListener('blur', () => {
        setTimeout(closeMention, 200);
    });
}

// Wikilink autocomplete — triggered by [[
function setupLinkAutocomplete() {
    const editor = document.getElementById('editor');
    const dropdown = document.getElementById('link-dropdown');
    let linkStart = -1;
    let activeIndex = 0;
    let filtered = [];
    let allNotes = [];

    async function fetchNoteList() {
        const resp = await fetch('/api/tree');
        const tree = await resp.json();
        allNotes = [];
        function flatten(items, prefix) {
            for (const item of items) {
                if (item.type === 'file') {
                    const path = item.path.replace(/\.md$/, '');
                    const title = item.title || item.name.replace(/\.md$/, '');
                    allNotes.push({ path, title, name: item.name });
                } else if (item.type === 'folder' && item.children) {
                    flatten(item.children, (prefix ? prefix + '/' : '') + item.name);
                }
            }
        }
        flatten(tree, '');
    }

    // Refresh note list periodically and on init
    fetchNoteList();
    setInterval(fetchNoteList, 30000);

    function closeLink() {
        dropdown.style.display = 'none';
        linkStart = -1;
        filtered = [];
        activeIndex = 0;
    }

    function renderDropdown() {
        dropdown.innerHTML = '';
        filtered.forEach((n, i) => {
            const item = document.createElement('div');
            item.className = 'mention-item' + (i === activeIndex ? ' active' : '');
            item.innerHTML = `
                <span class="mention-name">${escapeHtml(n.title)}</span>
                <span class="mention-detail">${escapeHtml(n.path)}</span>
            `;
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                insertLink(n);
            });
            dropdown.appendChild(item);
        });
    }

    function insertLink(note) {
        const text = editor.value;
        const before = text.substring(0, linkStart);
        const after = text.substring(editor.selectionStart);
        // Use path for unambiguous links (handles duplicate filenames in different folders)
        const link = `[[${note.path}]]`;
        editor.value = before + link + after;
        const newPos = before.length + link.length;
        editor.selectionStart = editor.selectionEnd = newPos;
        editor.focus();
        closeLink();
    }

    function positionDropdown() {
        const rect = editor.getBoundingClientRect();
        const lineHeight = 20;
        const text = editor.value.substring(0, editor.selectionStart);
        const lines = text.split('\n');
        const currentLine = lines.length - 1;
        const scrollTop = editor.scrollTop;
        const top = rect.top + (currentLine * lineHeight) - scrollTop + lineHeight + 4;
        const col = lines[lines.length - 1].length;
        const left = rect.left + Math.min(col * 8, rect.width - 300);
        dropdown.style.top = Math.min(top, rect.bottom - 40) + 'px';
        dropdown.style.left = Math.max(left, rect.left) + 'px';
    }

    editor.addEventListener('input', () => {
        if (dropdown.style.display === 'block') {
            // Already tracking — update filter
        }
        const pos = editor.selectionStart;
        const text = editor.value;

        // Look back for [[ trigger
        let bracketPos = -1;
        for (let i = pos - 1; i >= 1; i--) {
            if (text[i] === '\n') break;
            if (text[i - 1] === '[' && text[i] === '[') {
                bracketPos = i - 1;
                break;
            }
            // If we hit ]], abort
            if (text[i] === ']' && i + 1 < text.length && text[i + 1] === ']') break;
        }

        if (bracketPos >= 0) {
            const query = text.substring(bracketPos + 2, pos).toLowerCase();
            filtered = allNotes.filter(n => {
                return n.title.toLowerCase().includes(query) || n.path.toLowerCase().includes(query);
            }).slice(0, 8);

            if (filtered.length > 0) {
                linkStart = bracketPos;
                activeIndex = 0;
                positionDropdown();
                renderDropdown();
                dropdown.style.display = 'block';
            } else {
                closeLink();
            }
        } else {
            closeLink();
        }
    });

    editor.addEventListener('keydown', (e) => {
        if (dropdown.style.display === 'none') return;
        // Don't intercept if mention dropdown is active
        if (document.getElementById('mention-dropdown').style.display !== 'none') return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            activeIndex = (activeIndex + 1) % filtered.length;
            renderDropdown();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            activeIndex = (activeIndex - 1 + filtered.length) % filtered.length;
            renderDropdown();
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            if (filtered.length > 0) {
                e.preventDefault();
                insertLink(filtered[activeIndex]);
            }
        } else if (e.key === 'Escape') {
            closeLink();
        }
    });

    editor.addEventListener('blur', () => {
        setTimeout(closeLink, 200);
    });
}

async function openFrontmatterPreview() {
    if (!currentNote) return;
    const resp = await fetch(`/api/note/${currentNote}`);
    const note = await resp.json();
    const { fm } = stripFrontmatter(note.content || '');
    const pre = document.getElementById('frontmatter-view');
    pre.textContent = fm ? fm : '---\n# No frontmatter\n---';
    showModal('frontmatter-modal');
}

function toggleFrontmatter() {
    // Disabled: frontmatter is managed by backend and not editable in the editor
    return;
}

async function saveTags() {
    if (!currentNote) return;
    
    const response = await fetch(`/api/note/${currentNote}/tags`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: currentNoteTags })
    });
    
    if (response.ok) {
        loadTags();
        showNotification('Tags updated');
    }
}

// Save current note (keep for compatibility, redirect to new function)
async function saveNote(isAutoSave = false) {
    return saveNoteUpdated(isAutoSave);
}

// Create new note
async function createNote(title, tags, folder, template, customFilename) {
    const payload = { title, tags, folder, template };
    if (customFilename) payload.filename = customFilename;
    const response = await fetch('/api/note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    
    const result = await response.json();
    
    if (result.success) {
        wikilinkMap = null; // Invalidate cache
        loadTree();
        loadNote(result.path, true); // Force edit mode for new notes
        showNotification('Note created');
    }
}

// Create new folder
async function createFolder(name, parent) {
    const response = await fetch('/api/folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, parent })
    });
    
    const result = await response.json();
    
    if (result.success) {
        loadTree();
        showNotification('Folder created');
    }
}

// Create daily note
async function createDailyNote() {
    const response = await fetch('/api/daily', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    });
    
    const result = await response.json();
    
    if (result.success) {
        loadTree();
        loadNote(result.path, true); // Force edit mode for new daily notes
        showNotification('Daily note created');
    }
}

// Create planner note (prompt for Daily or Weekly)
async function createPlannerNote(type) {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');

    if (type === 'weekly') {
        // ISO week number
        const tmp = new Date(Date.UTC(yyyy, now.getMonth(), now.getDate()));
        const dayNum = tmp.getUTCDay() || 7;
        tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(),0,1));
        const weekNo = Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
        const ww = String(weekNo).padStart(2, '0');
        const title = `Week ${yyyy}-W${ww} Planner`;
        const customFilename = `planner-${yyyy}-W${ww}`;
        const folder = 'weekly';
        const tags = ['planner','weekly'];
        const template = 'weekly-planner';
        await createNote(title, tags, folder, template, customFilename);
    } else {
        const title = `Daily Planner ${yyyy}-${mm}-${dd}`;
        const customFilename = `daily-planner-${yyyy}-${mm}-${dd}`;
        const folder = 'daily';
        const tags = ['planner','daily'];
        const template = 'daily-planner';
        await createNote(title, tags, folder, template, customFilename);
    }
}

// Create meeting note using 'meeting' template
async function createMeetingNote(meetingName = '') {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const datestamp = `${yyyy}-${mm}-${dd}-${hh}${min}`;
    const name = meetingName.trim();
    // Title in frontmatter is just the meeting name (or "Meeting" if blank)
    const title = name || 'Meeting';
    // Filename: meeting-YYYY-MMDD HHMM-slugified-name
    const nameSlug = name ? '-' + name.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/[\s]+/g, '-') : '';
    const customFilename = `meeting-${datestamp}${nameSlug}`;
    const folder = 'meetings';
    const tags = [];
    const template = 'meeting';
    await createNote(title, tags, folder, template, customFilename);
}

// Search notes
async function searchNotes(query, tag) {
    const params = new URLSearchParams();
    if (query) params.append('q', query);
    if (tag) params.append('tag', tag);
    
    const response = await fetch(`/api/search?${params}`);
    const results = await response.json();
    
    // Render search results in tree
    const container = document.getElementById('file-tree');
    container.innerHTML = '';
    
    if (results.length === 0) {
        container.innerHTML = '<div style="padding: 16px; color: #888;">No results found</div>';
        return;
    }
    
    results.forEach(result => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'tree-item';
        itemDiv.innerHTML = `<i class="fas fa-file-alt"></i> ${result.title}`;
        itemDiv.addEventListener('click', () => loadNote(result.path));
        container.appendChild(itemDiv);
    });
}

// Load tags for filter
async function loadTags() {
    const response = await fetch('/api/tags');
    const tags = await response.json();
    
    const select = document.getElementById('tag-filter');
    select.innerHTML = '<option value="__all__">All Tags</option>';
    
    Object.keys(tags).sort().forEach(tag => {
        const option = document.createElement('option');
        option.value = tag;
        option.textContent = `${tag} (${tags[tag]})`;
        select.appendChild(option);
    });
}

// Load templates
async function loadTemplates() {
    const response = await fetch('/api/templates');
    const templates = await response.json();
    
    const select = document.getElementById('modal-template');
    select.innerHTML = '<option value="">None</option>';
    
    templates.forEach(template => {
        const option = document.createElement('option');
        option.value = template;
        option.textContent = template;
        select.appendChild(option);
    });
}

// Toggle preview mode
function togglePreview() {
    const editorContainer = document.getElementById('drop-zone');
    const previewContainer = document.getElementById('preview');
    const previewBtn = document.getElementById('preview-toggle');
    const editor = document.getElementById('editor');
    
    // Cycle: edit -> split -> preview -> edit
    // Button shows the NEXT mode
    if (previewMode === 'edit') {
        previewMode = 'split';
        editorContainer.classList.add('split-view');
        previewBtn.innerHTML = '<i class="fas fa-eye"></i>';
        previewBtn.title = 'Preview (Ctrl+P)';
    } else if (previewMode === 'split') {
        previewMode = 'preview';
        editorContainer.classList.remove('split-view');
        editorContainer.classList.add('preview-only');
        previewBtn.innerHTML = '<i class="fas fa-edit"></i>';
        previewBtn.title = 'Edit Mode (Ctrl+P)';
    } else {
        previewMode = 'edit';
        editorContainer.classList.remove('preview-only');
        previewBtn.innerHTML = '<i class="fas fa-columns"></i>';
        previewBtn.title = 'Split View (Ctrl+P)';
    }
    
    // Render markdown in preview
    if (previewMode !== 'edit') {
        renderPreview();
    }
}

// Render markdown preview
let lastEditorScrollRatio = 0;
let suppressPreviewScroll = false;

// --- Section-based scroll sync ---
// Cached section map: array of { es: editorScrollTop, ps: previewScrollTop } anchor points.
// Maps editor.scrollTop values directly to preview.scrollTop values.
// Rebuilt only when preview content changes (in renderPreview).
let cachedSectionMap = null;
let scrollSyncRAF = null;

// Measure the pixel offset of each heading line in the textarea using a mirror div.
// This accounts for word wrapping, unlike lineIndex * avgLineHeight.
function measureEditorLineOffsets(editor, headingLines) {
    const text = editor.value;
    const lines = text.split('\n');

    // Create a hidden div mirroring the textarea's styling
    const mirror = document.createElement('div');
    const cs = getComputedStyle(editor);
    mirror.style.position = 'absolute';
    mirror.style.top = '-9999px';
    mirror.style.left = '-9999px';
    mirror.style.visibility = 'hidden';
    mirror.style.height = 'auto';
    mirror.style.overflow = 'hidden';
    // Copy all properties that affect text layout
    mirror.style.width = cs.width;
    mirror.style.font = cs.font;
    mirror.style.letterSpacing = cs.letterSpacing;
    mirror.style.wordSpacing = cs.wordSpacing;
    mirror.style.lineHeight = cs.lineHeight;
    mirror.style.padding = cs.padding;
    mirror.style.border = cs.border;
    mirror.style.boxSizing = cs.boxSizing;
    mirror.style.tabSize = cs.tabSize;
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.wordWrap = 'break-word';
    mirror.style.overflowWrap = 'break-word';
    document.body.appendChild(mirror);

    const offsets = [];
    for (const lineIdx of headingLines) {
        // Put text up to the heading line into the mirror, then a marker span
        const textBefore = lines.slice(0, lineIdx).join('\n');
        mirror.textContent = '';
        const pre = document.createTextNode(textBefore + (lineIdx > 0 ? '\n' : ''));
        const marker = document.createElement('span');
        marker.textContent = '\u200b';
        mirror.appendChild(pre);
        mirror.appendChild(marker);
        offsets.push(marker.offsetTop);
    }

    document.body.removeChild(mirror);
    return offsets;
}

// Rebuild the cached section map. Call after renderPreview() finishes layout.
// Anchors headings AND code fence boundaries for accurate sync through code blocks.
function rebuildSectionMap() {
    const editor = document.getElementById('editor');
    const preview = document.getElementById('preview');
    if (!editor || !preview) { cachedSectionMap = null; return; }

    const text = editor.value || '';
    const lines = text.split('\n');
    const maxEditor = Math.max(1, editor.scrollHeight - editor.clientHeight);
    const maxPreview = Math.max(1, preview.scrollHeight - preview.clientHeight);

    // --- Collect anchor lines from the editor ---
    // Each anchor: { line, type, index }
    // type: 'heading', 'code-start', 'code-end'
    const anchors = [];
    let headingIdx = 0;
    let codeBlockIdx = 0;
    let inCodeBlock = false;

    for (let i = 0; i < lines.length; i++) {
        if (/^```/.test(lines[i])) {
            if (!inCodeBlock) {
                anchors.push({ line: i, type: 'code-start', index: codeBlockIdx });
                inCodeBlock = true;
            } else {
                anchors.push({ line: i, type: 'code-end', index: codeBlockIdx });
                codeBlockIdx++;
                inCodeBlock = false;
            }
        } else if (!inCodeBlock && /^#{1,6}\s/.test(lines[i])) {
            anchors.push({ line: i, type: 'heading', index: headingIdx });
            headingIdx++;
        }
    }

    // --- Collect corresponding preview elements ---
    const previewHeadings = Array.from(preview.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    const previewCodeBlocks = Array.from(preview.querySelectorAll('pre'));

    // --- Measure editor pixel offsets for all anchor lines ---
    const anchorLines = anchors.map(a => a.line);
    const editorOffsets = measureEditorLineOffsets(editor, anchorLines);

    // --- Build the map ---
    const containerRect = preview.getBoundingClientRect();
    const curScrollTop = preview.scrollTop;
    const map = [{ es: 0, ps: 0 }];

    for (let i = 0; i < anchors.length; i++) {
        const a = anchors[i];
        const es = editorOffsets[i];
        let ps = null;

        if (a.type === 'heading') {
            const el = previewHeadings[a.index];
            if (!el) continue;
            const r = el.getBoundingClientRect();
            ps = r.top - containerRect.top + curScrollTop;
        } else if (a.type === 'code-start') {
            const el = previewCodeBlocks[a.index];
            if (!el) continue;
            const r = el.getBoundingClientRect();
            ps = r.top - containerRect.top + curScrollTop;
        } else if (a.type === 'code-end') {
            const el = previewCodeBlocks[a.index];
            if (!el) continue;
            const r = el.getBoundingClientRect();
            ps = r.bottom - containerRect.top + curScrollTop;
        }

        if (ps === null) continue;

        // Only add if it advances beyond the previous anchor
        if (es > map[map.length - 1].es + 1) {
            map.push({ es: Math.min(es, maxEditor), ps: Math.min(ps, maxPreview) });
        }
    }

    // End at (maxEditor, maxPreview) — both panels at bottom
    map.push({ es: maxEditor, ps: maxPreview });

    cachedSectionMap = map;
}

function handleEditorScrollSync() {
    if (previewMode !== 'split') return;
    if (scrollSyncRAF) return;
    scrollSyncRAF = requestAnimationFrame(() => {
        scrollSyncRAF = null;
        doEditorScrollSync();
    });
}

function doEditorScrollSync() {
    const editor = document.getElementById('editor');
    const preview = document.getElementById('preview');
    if (!editor || !preview) return;

    const maxEditor = Math.max(1, editor.scrollHeight - editor.clientHeight);
    const maxPreview = Math.max(1, preview.scrollHeight - preview.clientHeight);
    const es = editor.scrollTop;
    lastEditorScrollRatio = es / maxEditor;

    const map = cachedSectionMap;
    if (!map || map.length < 3) {
        // No headings — fall back to ratio sync
        suppressPreviewScroll = true;
        preview.scrollTop = (es / maxEditor) * maxPreview;
        setTimeout(() => suppressPreviewScroll = false, 10);
        return;
    }

    // Find the two anchors bracketing the current editor.scrollTop
    let idx = 0;
    for (let i = 0; i < map.length - 1; i++) {
        if (es >= map[i].es) idx = i;
        else break;
    }

    const a = map[idx];
    const b = map[idx + 1];

    // Linear interpolation between the two anchors
    const span = b.es - a.es;
    const t = span > 1 ? (es - a.es) / span : 0;
    const targetPS = a.ps + t * (b.ps - a.ps);

    suppressPreviewScroll = true;
    preview.scrollTop = Math.max(0, Math.min(maxPreview, targetPS));
    setTimeout(() => suppressPreviewScroll = false, 10);
}

function renderPreview() {
    let content = document.getElementById('editor').value;
    const preview = document.getElementById('preview');
    
    // Strip frontmatter only if it's visible in the editor
    if (showFrontmatter) {
        const { body } = stripFrontmatter(content);
        content = body;
    }

    // Convert wikilinks to HTML before markdown rendering
    content = content.replace(/\[\[([^\]]+)\]\]/g, (match, noteName) => {
        return `<a href="#" class="wikilink" data-note="${noteName}">${noteName}</a>`;
    });

    // Process footnotes
    const footnotes = {};
    // Extract footnote definitions: [^id]: text
    content = content.replace(/^\[\^(\w+)\]:\s*(.+)$/gm, (match, id, text) => {
        footnotes[id] = text;
        return ''; // remove definition from body
    });
    // Replace footnote references: [^id] → superscript link
    content = content.replace(/\[\^(\w+)\]/g, (match, id) => {
        return `<sup class="footnote-ref"><a href="#fn-${id}" id="fnref-${id}">${id}</a></sup>`;
    });
    // Build footnotes section if any exist
    let footnotesHtml = '';
    const fnKeys = Object.keys(footnotes);
    if (fnKeys.length > 0) {
        footnotesHtml = '<hr class="footnotes-sep"><section class="footnotes"><ol class="footnotes-list">';
        fnKeys.forEach(id => {
            footnotesHtml += `<li id="fn-${id}" class="footnote-item"><p>${footnotes[id]} <a href="#fnref-${id}" class="footnote-backref">↩</a></p></li>`;
        });
        footnotesHtml += '</ol></section>';
    }
    
    try {
        // Handle both old and new marked.js API
        if (typeof marked === 'function') {
            const html = marked(content);
            preview.innerHTML = html;
            preview.querySelectorAll('li').forEach(li => {
                const el = li.firstElementChild;
                if (el && el.tagName === 'INPUT' && el.type === 'checkbox') {
                    li.style.listStyle = 'none';
                }
            });
        } else if (typeof marked === 'object' && typeof marked.parse === 'function') {
            const html = marked.parse(content);
            preview.innerHTML = html;
            preview.querySelectorAll('li').forEach(li => {
                const el = li.firstElementChild;
                if (el && el.tagName === 'INPUT' && el.type === 'checkbox') {
                    li.style.listStyle = 'none';
                }
            });
        } else {
            preview.innerHTML = '<div style="padding: 20px; color: #ff6b6b; background: #2d2d30; border-radius: 4px;">⚠️ Markdown library not loaded properly</div>';
        }
        
        // Resolve relative paths for images and links
        resolveRelativePaths(preview);
        
        // Render mermaid diagrams
        if (typeof mermaid !== 'undefined') {
            preview.querySelectorAll('code.language-mermaid').forEach((block, i) => {
                const pre = block.parentElement;
                const div = document.createElement('div');
                div.className = 'mermaid';
                div.textContent = block.textContent;
                pre.replaceWith(div);
            });
            (async () => {
                try { await mermaid.run({ nodes: preview.querySelectorAll('.mermaid') }); } catch(e) { console.warn('Mermaid:', e); }
                addMermaidCopyButtons(preview);
            })();
        }

        // Syntax highlight remaining code blocks with highlight.js
        applyHljs(preview);

        // Rebuild section map and re-sync scroll position
        if (previewMode === 'split') {
            rebuildSectionMap();
            doEditorScrollSync();
            // Also rebuild after images finish loading (they shift layout)
            preview.querySelectorAll('img').forEach(img => {
                if (!img.complete) {
                    img.addEventListener('load', () => { rebuildSectionMap(); }, { once: true });
                }
            });
        }
    } catch (error) {
        preview.innerHTML = '<div style="padding: 20px; color: #ff6b6b; background: #2d2d30; border-radius: 4px;">⚠️ Error rendering markdown:<br>' + error.message + '</div>';
        console.error('Preview render error:', error);
    }
}

// Handle in-page anchor clicks in preview (for TOC links)
function setupPreviewAnchorLinks() {
    const preview = document.getElementById('preview');
    preview.addEventListener('click', (e) => {
        const link = e.target.closest('a');
        if (!link) return;
        const href = link.getAttribute('href');
        if (href && href.startsWith('#')) {
            e.preventDefault();
            const target = preview.querySelector(href);
            if (target) target.scrollIntoView({ behavior: 'smooth' });
        }
    });
}

// Draggable split divider
function setupSplitDivider() {
    const divider = document.getElementById('split-divider');
    const container = document.getElementById('drop-zone');
    const editor = document.getElementById('editor');
    if (!divider || !container || !editor) return;

    let dragging = false;

    divider.addEventListener('mousedown', (e) => {
        e.preventDefault();
        dragging = true;
        divider.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const pct = Math.max(20, Math.min(80, (x / rect.width) * 100));
        editor.style.width = pct + '%';
    });

    document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        divider.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        // Rebuild scroll sync map since editor width changed (affects word wrap)
        if (previewMode === 'split') {
            rebuildSectionMap();
        }
    });
}

// Setup event listeners
function setupEventListeners() {
    // Preview toggle button
    document.getElementById('preview-toggle').addEventListener('click', togglePreview);
    
    // Update preview on editor change when in split/preview mode
    const editorEl = document.getElementById('editor');
    editorEl.addEventListener('input', () => {
        if (previewMode !== 'edit') {
            renderPreview();
        }
    });

    // Paste image from clipboard
    editorEl.addEventListener('paste', handleImagePaste);

    // Sync preview scroll with editor scroll (split view)
    editorEl.addEventListener('scroll', handleEditorScrollSync);

    // Draggable split divider
    setupSplitDivider();

    // Rename button
    document.getElementById('rename-btn').addEventListener('click', renameNote);
    
    // Theme toggle
    document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
    
    // Frontmatter toggle
    const fmToggleBtn = document.getElementById('frontmatter-toggle');
    if (fmToggleBtn) {
        fmToggleBtn.style.display = 'none';
        // Frontmatter editing disabled; no listener
    }
    
    // Full-screen toggle
    const fullscreenBtn = document.getElementById('fullscreen-toggle');
    if (fullscreenBtn) fullscreenBtn.addEventListener('click', toggleFullscreen);
    
    // Sidebar collapse toggle
    document.getElementById('sidebar-collapse').addEventListener('click', toggleSidebar);
    document.getElementById('home-btn').addEventListener('click', goHome);
    
    // Close mobile sidebar when clicking outside
    document.addEventListener('click', (e) => {
        const sidebar = document.querySelector('.sidebar');
        const actionBar = document.querySelector('.action-bar');
        
        if (window.innerWidth <= 768 && 
            sidebar.classList.contains('mobile-open') &&
            !sidebar.contains(e.target) &&
            !actionBar.contains(e.target)) {
            sidebar.classList.remove('mobile-open');
            const btn = document.getElementById('sidebar-collapse');
            if (btn) btn.textContent = '☰';
        }
    });
    
    // Vault select/create
    initVaultSelect();
    document.getElementById('create-vault').addEventListener('click', () => {
        document.getElementById('modal-vault-name').value = '';
        showModal('new-vault-modal');
        setTimeout(()=>document.getElementById('modal-vault-name').focus(),0);
    });
    document.getElementById('create-vault-btn').addEventListener('click', createVaultFromModal);
    document.getElementById('cancel-vault-btn').addEventListener('click', () => hideModal('new-vault-modal'));
    document.getElementById('modal-vault-name').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); createVaultFromModal(); }
    });
    document.getElementById('delete-vault').addEventListener('click', deleteCurrentVault);
    const cdvb = document.getElementById('confirm-delete-vault-btn');
    if (cdvb) cdvb.addEventListener('click', confirmDeleteVault);
    const cancelDvb = document.getElementById('cancel-delete-vault-btn');
    if (cancelDvb) cancelDvb.addEventListener('click', () => hideModal('delete-vault-modal'));
    document.getElementById('export-vault').addEventListener('click', () => {
        window.location.href = '/api/vaults/export';
    });

    // Delete folder modal
    const confirmDeleteFolderBtn = document.getElementById('confirm-delete-folder-btn');
    if (confirmDeleteFolderBtn) confirmDeleteFolderBtn.addEventListener('click', confirmDeleteFolder);
    const cancelDeleteFolderBtn = document.getElementById('cancel-delete-folder-btn');
    if (cancelDeleteFolderBtn) cancelDeleteFolderBtn.addEventListener('click', () => hideModal('delete-folder-modal'));

    // Manage templates
    document.getElementById('manage-templates').addEventListener('click', openTemplatesModal);
    document.getElementById('new-template-btn').addEventListener('click', createNewTemplate);
    document.getElementById('save-template-btn').addEventListener('click', saveTemplate);
    document.getElementById('delete-template-btn').addEventListener('click', deleteTemplate);
    document.getElementById('close-templates-btn').addEventListener('click', () => {
        hideModal('templates-modal');
        currentTemplate = null;
        document.getElementById('template-editor-empty').style.display = 'flex';
        document.getElementById('template-editor-content').style.display = 'none';
    });
    
    // Todos dashboard
    document.getElementById('todos-btn').addEventListener('click', openTodosModal);
    document.getElementById('close-todos-btn').addEventListener('click', () => {
        hideModal('todos-modal');
    });

    // Share button
    document.getElementById('share-btn').addEventListener('click', () => {
        if (!currentNote) return;
        showModal('share-modal');
    });
    document.getElementById('close-share-btn').addEventListener('click', () => hideModal('share-modal'));

    // LLM UI buttons
    const llmBtn = document.getElementById('llm-btn');
    if (llmBtn) llmBtn.addEventListener('click', openLlmModal);
    const llmClose = document.getElementById('llm-close-btn');
    if (llmClose) llmClose.addEventListener('click', () => hideModal('llm-modal'));
    const llmRun = document.getElementById('llm-run-btn');
    if (llmRun) llmRun.addEventListener('click', runLlm);

    document.getElementById('share-print').addEventListener('click', shareViaPrint);
    document.getElementById('share-email').addEventListener('click', shareViaEmail);
    document.getElementById('share-copy').addEventListener('click', shareViaCopyMarkdown);
    document.getElementById('share-copy-html').addEventListener('click', shareViaCopyHtml);

    // LLM (optional)
    initLlmUi();
    document.getElementById('share-copy-link').addEventListener('click', shareViaCopyLink);

    // Contacts
    document.getElementById('contacts-btn').addEventListener('click', openContactsModal);
    document.getElementById('close-contacts-btn').addEventListener('click', () => hideModal('contacts-modal'));
    document.getElementById('add-contact-btn').addEventListener('click', () => openContactEdit(null));
    document.getElementById('import-contacts-btn').addEventListener('click', importContactsPrompt);
    document.getElementById('save-contact-btn').addEventListener('click', saveContactFromModal);
    document.getElementById('cancel-contact-btn').addEventListener('click', () => hideModal('contact-edit-modal'));
    document.getElementById('contacts-search').addEventListener('input', (e) => {
        renderContactsList(e.target.value);
    });

    // Template Profiles
    document.getElementById('manage-profiles-btn').addEventListener('click', openProfilesModal);
    document.getElementById('close-profiles-btn').addEventListener('click', () => hideModal('profiles-modal'));
    document.getElementById('add-profile-btn').addEventListener('click', () => openProfileEdit(null));
    document.getElementById('save-profile-btn').addEventListener('click', saveProfileFromModal);
    document.getElementById('cancel-profile-btn').addEventListener('click', () => hideModal('profile-edit-modal'));

    // @ mention autocomplete
    setupMentionAutocomplete();
    setupLinkAutocomplete();
    setupPreviewAnchorLinks();

    // Frontmatter preview (read-only)
    document.getElementById('frontmatter-preview').addEventListener('click', openFrontmatterPreview);
    document.getElementById('close-frontmatter-btn').addEventListener('click', () => hideModal('frontmatter-modal'));

    // Image preview modal
    const closeImagePreviewBtn = document.getElementById('close-image-preview-btn');
    if (closeImagePreviewBtn) {
        closeImagePreviewBtn.addEventListener('click', () => hideModal('image-preview-modal'));
    }
    const copyImageMarkdownBtn = document.getElementById('copy-image-markdown-btn');
    if (copyImageMarkdownBtn) {
        copyImageMarkdownBtn.addEventListener('click', () => {
            const modal = document.getElementById('image-preview-modal');
            const url = modal.dataset.imageUrl;
            const name = modal.dataset.imageName;
            const md = `![${name}](${url})`;
            navigator.clipboard.writeText(md).then(() => showNotification('Image markdown copied to clipboard'));
        });
    }

    // Tags management
    document.getElementById('tags-btn').addEventListener('click', openTagsModal);
    document.getElementById('close-tags-btn').addEventListener('click', () => {
        hideModal('tags-modal');
    });
    document.getElementById('add-tag-modal-btn').addEventListener('click', addTagFromModal);
    document.getElementById('tags-modal-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addTagFromModal();
        }
    });
    
    // Star note button
    document.getElementById('star-btn').addEventListener('click', toggleStarNote);
    
    // Extract modal
    document.getElementById('extract-btn').addEventListener('click', openExtractModal);
    document.getElementById('splash-extract').addEventListener('click', openExtractModal);
    
    // Graph view
    document.getElementById('graph-btn').addEventListener('click', openGraphView);
    document.getElementById('close-graph-btn').addEventListener('click', () => hideModal('graph-modal'));
    
    // Calendar view
    document.getElementById('calendar-btn').addEventListener('click', openCalendarView);
    document.getElementById('close-calendar-btn').addEventListener('click', () => hideModal('calendar-modal'));
    document.getElementById('calendar-prev').addEventListener('click', () => navigateCalendar(-1));
    document.getElementById('calendar-next').addEventListener('click', () => navigateCalendar(1));
    document.getElementById('calendar-today').addEventListener('click', () => {
        calendarDate = new Date();
        renderCalendar();
    });
    document.getElementById('close-extract-btn').addEventListener('click', () => {
        hideModal('extract-modal');
        document.getElementById('extract-result-container').style.display = 'none';
    });
    document.getElementById('extract-run-btn').addEventListener('click', runExtract);
    document.getElementById('extract-copy-btn').addEventListener('click', () => {
        const textarea = document.getElementById('extract-result');
        textarea.select();
        document.execCommand('copy');
        showNotification('Copied to clipboard');
    });
    
    // Table dimension modal
    document.getElementById('create-table-btn').addEventListener('click', () => {
        const rows = parseInt(document.getElementById('table-rows').value) || 3;
        const cols = parseInt(document.getElementById('table-cols').value) || 3;
        const editor = document.getElementById('editor');
        
        if (rows > 0 && cols > 0) {
            insertMarkdownTable(rows, cols, editor);
            hideModal('table-modal');
        }
    });
    document.getElementById('cancel-table-btn').addEventListener('click', () => hideModal('table-modal'));
    
    // Mermaid diagram picker
    document.getElementById('mermaid-btn').addEventListener('click', () => showModal('mermaid-modal'));
    document.getElementById('cancel-mermaid-btn').addEventListener('click', () => hideModal('mermaid-modal'));
    document.querySelectorAll('.mermaid-type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const type = btn.dataset.type;
            const template = mermaidTemplates[type];
            if (template) {
                const editor = document.getElementById('editor');
                insertTextAtCursor(editor, '\n' + template + '\n');
                hideModal('mermaid-modal');
            }
        });
    });
    
    // Upload modal
    document.getElementById('upload-btn').addEventListener('click', openUploadModal);
    document.getElementById('cancel-upload-btn').addEventListener('click', () => hideModal('upload-modal'));
    document.getElementById('upload-input').addEventListener('change', updateUploadPreview);
    document.getElementById('upload-confirm-btn').addEventListener('click', performUpload);
    document.getElementById('table-rows').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('create-table-btn').click();
        }
    });
    document.getElementById('table-cols').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('create-table-btn').click();
        }
    });
    
    // Delete modal
    document.getElementById('confirm-delete-btn').addEventListener('click', confirmDeleteNote);
    document.getElementById('cancel-delete-btn').addEventListener('click', () => hideModal('delete-modal'));
    
    // Rename modal
    document.getElementById('confirm-rename-btn').addEventListener('click', confirmRenameNote);
    document.getElementById('cancel-rename-btn').addEventListener('click', () => hideModal('rename-modal'));
    document.getElementById('rename-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('confirm-rename-btn').click();
        }
    });
    
    // Meeting modal
    document.getElementById('create-meeting-btn').addEventListener('click', () => {
        const name = document.getElementById('meeting-name-input').value;
        hideModal('meeting-modal');
        createMeetingNote(name);
    });
    document.getElementById('cancel-meeting-btn').addEventListener('click', () => hideModal('meeting-modal'));
    document.getElementById('meeting-name-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('create-meeting-btn').click();
        }
    });
    
    // Planner modal
    document.getElementById('planner-daily-btn').addEventListener('click', () => {
        hideModal('planner-modal');
        createPlannerNote('daily');
    });
    document.getElementById('planner-weekly-btn').addEventListener('click', () => {
        hideModal('planner-modal');
        createPlannerNote('weekly');
    });
    document.getElementById('cancel-planner-btn').addEventListener('click', () => hideModal('planner-modal'));
    
    // Auto-save on Ctrl+S
    document.getElementById('editor').addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 's') {
            e.preventDefault();
            saveNote();
        }
    });
    
    // New note button
    document.getElementById('new-note').addEventListener('click', () => {
        document.getElementById('modal-folder').value = currentFolder;
        showModal('new-note-modal');
    });
    
    // New folder button
    document.getElementById('new-folder').addEventListener('click', () => {
        document.getElementById('modal-parent-folder').value = currentFolder;
        showModal('new-folder-modal');
    });
    
    // Daily note button
    document.getElementById('daily-note').addEventListener('click', createDailyNote);

    // Meeting note button
    document.getElementById('meeting-note').addEventListener('click', () => {
        document.getElementById('meeting-name-input').value = '';
        showModal('meeting-modal');
        setTimeout(() => document.getElementById('meeting-name-input').focus(), 0);
    });
    const plannerBtn = document.getElementById('planner-note');
    if (plannerBtn) plannerBtn.addEventListener('click', () => showModal('planner-modal'));
    
    // Create note modal
    // Enter key in new note modal triggers create
    document.getElementById('modal-note-title').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); document.getElementById('create-note-btn').click(); }
    });
    document.getElementById('modal-note-tags').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); document.getElementById('create-note-btn').click(); }
    });

    document.getElementById('create-note-btn').addEventListener('click', () => {
        const title = document.getElementById('modal-note-title').value;
        const tags = document.getElementById('modal-note-tags').value.split(',').map(t => t.trim()).filter(t => t);
        const folder = document.getElementById('modal-folder').value;
        const template = document.getElementById('modal-template').value;
        
        if (title) {
            createNote(title, tags, folder, template);
            hideModal('new-note-modal');
            document.getElementById('modal-note-title').value = '';
            document.getElementById('modal-note-tags').value = '';
        }
    });
    
    // Cancel note modal
    document.getElementById('cancel-note-btn').addEventListener('click', () => {
        hideModal('new-note-modal');
    });
    
    // Create folder modal
    document.getElementById('create-folder-btn').addEventListener('click', () => {
        const name = document.getElementById('modal-folder-name').value;
        const parent = document.getElementById('modal-parent-folder').value;
        
        if (name) {
            createFolder(name, parent);
            hideModal('new-folder-modal');
            document.getElementById('modal-folder-name').value = '';
        }
    });
    
    // Enter key to create folder
    document.getElementById('modal-folder-name').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('create-folder-btn').click();
        }
    });
    
    // Cancel folder modal
    document.getElementById('cancel-folder-btn').addEventListener('click', () => {
        hideModal('new-folder-modal');
    });
    
    // Search
    // Search button opens modal
    document.getElementById('search-btn').addEventListener('click', () => {
        showModal('search-modal');
        setTimeout(() => document.getElementById('search-modal-input').focus(), 0);
    });
    
    // Search modal - search button
    document.getElementById('search-modal-btn').addEventListener('click', () => {
        const query = document.getElementById('search-modal-input').value;
        if (query) {
            searchNotes(query, '');
            hideModal('search-modal');
            openMobileSidebar();
        }
    });

    // Search modal - Enter key
    document.getElementById('search-modal-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const query = document.getElementById('search-modal-input').value;
            if (query) {
                searchNotes(query, '');
                hideModal('search-modal');
                openMobileSidebar();
            }
        }
    });
    
    // Search modal - clear button
    document.getElementById('clear-search-modal-btn').addEventListener('click', () => {
        document.getElementById('search-modal-input').value = '';
        document.getElementById('tag-filter').value = '';
        loadTree();
        hideModal('search-modal');
    });
    
    // Search modal - cancel button
    document.getElementById('cancel-search-btn').addEventListener('click', () => {
        hideModal('search-modal');
    });
    
    // Tag filter
    document.getElementById('tag-filter').addEventListener('change', async (e) => {
        const tag = e.target.value;
        if (tag && tag !== '__all__') {
            await searchNotes('', tag);
        } else {
            // Reset to full tree
            e.target.value = '__all__';
            const container = document.getElementById('file-tree');
            container.innerHTML = '';
            await loadTree();
        }
    });
}

// Tree drag and drop handlers
let draggedItem = null;

function handleDragStart(e) {
    draggedItem = e.target;
    e.target.style.opacity = '0.5';
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', e.target.dataset.path);
}

function handleDragEnd(e) {
    e.target.style.opacity = '1';
}

function handleDragOver(e) {
    if (e.preventDefault) {
        e.preventDefault();
    }
    e.dataTransfer.dropEffect = 'move';
    const folder = e.target.closest('.tree-folder');
    if (folder) folder.classList.add('drag-over');
    return false;
}

function handleDragLeave(e) {
    const folder = e.target.closest('.tree-folder');
    if (folder) folder.classList.remove('drag-over');
}

async function handleDrop(e) {
    if (e.stopPropagation) {
        e.stopPropagation();
    }
    e.preventDefault();
    
    const targetFolder = e.target.closest('.tree-folder');
    if (!targetFolder) return false;
    targetFolder.classList.remove('drag-over');
    
    if (draggedItem && draggedItem !== targetFolder) {
        const sourcePath = draggedItem.dataset.path;
        const sourceType = draggedItem.dataset.type;
        const targetPath = targetFolder.dataset.path;
        
        // Check if dropping folder into itself
        if (sourceType === 'folder' && targetPath.startsWith(sourcePath + '/')) {
            showNotification('Cannot move folder into itself');
            return false;
        }
        
        // Choose API endpoint based on source type
        const endpoint = sourceType === 'folder' ? '/api/move-folder' : '/api/move';
        
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                source: sourcePath,
                target: targetPath
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification(`Moved to ${targetPath || 'root'}`);
            loadTree();
            
            // If the moved file was currently open, update the current path
            if (sourceType === 'file' && currentNote === sourcePath) {
                currentNote = result.path;
            }
        } else {
            showNotification(`Error: ${result.error}`);
        }
    }
    
    return false;
}

// Setup drag and drop
function setupDragAndDrop() {
    const dropZone = document.getElementById('drop-zone');
    
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });
    
    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });
    
    dropZone.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        
        const files = e.dataTransfer.files;
        
        for (let file of files) {
            if (file.name.endsWith('.md') || file.name.endsWith('.txt')) {
                const formData = new FormData();
                formData.append('file', file);
                formData.append('folder', currentFolder);
                
                const response = await fetch('/api/upload', {
                    method: 'POST',
                    body: formData
                });
                
                const result = await response.json();
                
                if (result.success) {
                    loadTree();
                    showNotification(`Uploaded: ${file.name}`);
                }
            }
        }
    });
}

// Modal helpers
function showModal(id) {
    document.getElementById(id).classList.add('show');
}

function hideModal(id) {
    document.getElementById(id).classList.remove('show');
}

// Image preview modal
function openImagePreview(url, name, path) {
    console.log('openImagePreview called:', url, name, path);
    const modal = document.getElementById('image-preview-modal');
    const img = document.getElementById('image-preview-img');
    const title = document.getElementById('image-preview-title');
    const modalContent = document.getElementById('image-modal-content');
    const imageContainer = document.getElementById('image-container');

    console.log('Elements found:', { modal: !!modal, img: !!img, title: !!title, modalContent: !!modalContent, imageContainer: !!imageContainer });

    if (!modal || !img || !title || !modalContent || !imageContainer) {
        console.error('Modal elements not found:', { modal, img, title, modalContent, imageContainer });
        return;
    }

    title.textContent = name;

    // Store path for markdown copy
    modal.dataset.imagePath = path;
    modal.dataset.imageUrl = url;
    modal.dataset.imageName = name;

    // Reset styles
    modalContent.style.width = 'auto';
    imageContainer.style.width = 'auto';
    imageContainer.style.height = 'auto';
    img.style.width = 'auto';
    img.style.height = 'auto';

    // Load image and adjust container
    img.onload = function() {
        const imgWidth = img.naturalWidth;
        const imgHeight = img.naturalHeight;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Calculate max dimensions (leaving room for header/buttons)
        const maxWidth = Math.floor(viewportWidth * 0.85);
        const maxHeight = Math.floor(viewportHeight * 0.7);

        // Scale if needed
        if (imgWidth > maxWidth || imgHeight > maxHeight) {
            const scale = Math.min(maxWidth / imgWidth, maxHeight / imgHeight);
            img.style.width = `${Math.floor(imgWidth * scale)}px`;
            img.style.height = `${Math.floor(imgHeight * scale)}px`;
        } else {
            // Use natural size for small images
            img.style.width = `${imgWidth}px`;
            img.style.height = `${imgHeight}px`;
        }

        // Let modal content wrap the image
        modalContent.style.width = 'fit-content';
    };

    img.src = url;
    img.alt = name;

    showModal('image-preview-modal');
}

// Notification helper - toast notification
function showNotification(message, persistent = false) {
    const existing = document.querySelector('.toast-notification');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 10);
    
    if (!persistent) {
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 2000);
    }
    
    return toast; // Return reference for manual dismissal
}

function hideNotification(toast) {
    if (!toast) {
        const existing = document.querySelector('.toast-notification');
        if (existing) toast = existing;
    }
    if (toast && toast.parentNode) {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }
}

// Auto-save functionality
let autoSaveListenerAttached = false;
function setupAutoSave() {
    if (autoSaveListenerAttached) return;
    autoSaveListenerAttached = true;
    document.getElementById('editor').addEventListener('input', () => {
        if (!currentNote) return;
        
        if (autoSaveTimeout) {
            clearTimeout(autoSaveTimeout);
        }
        
        autoSaveTimeout = setTimeout(() => {
            saveNote(true);
        }, 2000); // Auto-save after 2 seconds of inactivity
    });
}

function setSaveStatus(status) {
    // Legacy — now using toast notifications
}

// Update save function to support auto-save
async function saveNoteUpdated(isAutoSave = false) {
    if (!currentNote) return;
    
    let content = document.getElementById('editor').value;
    
    // Prepend stored frontmatter (editor never contains it)
    if (currentNoteFrontmatter) {
        content = currentNoteFrontmatter + '\n\n' + content;
    }
    
    try {
        const response = await fetch(`/api/note/${currentNote}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });
        
        if (response.ok) {
            if (isAutoSave) {
                showNotification('Auto-saved');
            } else {
                showNotification('Note saved');
            }
        } else {
            showNotification('Save failed');
        }
    } catch (e) {
        showNotification('Save failed: ' + e.message);
    }
}

// Delete note
let pendingDeleteNote = null;

function deleteNote() {
    if (!currentNote) return;
    pendingDeleteNote = null; // Clear any context menu delete
    const noteName = document.getElementById('note-title').textContent || 'this note';
    document.getElementById('delete-note-name').textContent = noteName;
    showModal('delete-modal');
}

function showFileContextMenu(e, filePath, fileName) {
    console.log('showFileContextMenu called:', filePath, fileName);
    pendingDeleteNote = { path: filePath, name: fileName };
    const displayName = fileName.replace(/\.md$/, '');
    document.getElementById('delete-note-name').textContent = displayName;
    showModal('delete-modal');
}

async function confirmDeleteNote() {
    hideModal('delete-modal');
    // Use pendingDeleteNote if from context menu, otherwise use currentNote
    const toRemove = pendingDeleteNote ? pendingDeleteNote.path : currentNote;
    if (!toRemove) return;

    const response = await fetch(`/api/note/${toRemove}`, {
        method: 'DELETE'
    });
    
    if (response.ok) {
        wikilinkMap = null; // Invalidate cache
        showNotification('Note deleted');

        // Only clear editor if the deleted note was currently open
        const wasCurrentNote = (toRemove === currentNote);

        if (wasCurrentNote) {
            currentNote = null;
            currentNoteTags = [];
            currentNoteFrontmatter = '';
            document.getElementById('note-title').textContent = 'Select a note...';
            document.getElementById('tags-display').innerHTML = '';
            document.getElementById('editor').value = '';
            document.getElementById('editor').disabled = true;
            document.getElementById('tags-btn').disabled = true;
            const fmToggle = document.getElementById('frontmatter-toggle');
            if (fmToggle) fmToggle.disabled = true;
            document.getElementById('preview-toggle').disabled = true;
            document.getElementById('rename-btn').disabled = true;
            document.getElementById('share-btn').disabled = true;
            document.getElementById('frontmatter-preview').disabled = true;
            updateBreadcrumbs();
            // Clear preview and show splash to avoid leftover content rendering
            const preview = document.getElementById('preview');
            if (preview) preview.innerHTML = '';
            showSplash(true);
            // Reset preview state for next open
            previewMode = 'preview';
            const editorContainer = document.getElementById('drop-zone');
            if (editorContainer) {
                editorContainer.classList.remove('split-view');
                editorContainer.classList.add('preview-only');
            }
        }

        loadTree();
        removeFromRecent(toRemove);
        pendingDeleteNote = null;
    }
}

// Delete folder
let pendingDeleteFolder = null;

function showFolderContextMenu(e, folderPath, folderName) {
    console.log('showFolderContextMenu called:', folderPath, folderName);
    // For now, directly show delete confirmation modal
    // In the future, could show a proper context menu with multiple options
    pendingDeleteFolder = { path: folderPath, name: folderName };
    document.getElementById('delete-folder-name').textContent = folderName;
    showModal('delete-folder-modal');
}

async function confirmDeleteFolder() {
    if (!pendingDeleteFolder) {
        hideModal('delete-folder-modal');
        return;
    }

    const folderPath = pendingDeleteFolder.path;
    hideModal('delete-folder-modal');

    try {
        const response = await fetch(`/api/folder/${folderPath}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            showNotification('Folder deleted');
            // If the currently open note was inside the deleted folder, reset to splash
            if (currentNote && currentNote.startsWith(folderPath + '/')) {
                currentNote = null;
                showSplash(true);
            }
            await loadTree();
            pendingDeleteFolder = null;
        } else {
            const error = await response.json();
            showNotification(error.error || 'Failed to delete folder', true);
        }
    } catch (e) {
        showNotification('Failed to delete folder: ' + e.message, true);
    }
}

// Rename note
function renameNote() {
    if (!currentNote) return;
    document.getElementById('rename-input').value = document.getElementById('note-title').textContent;
    showModal('rename-modal');
    setTimeout(() => {
        const input = document.getElementById('rename-input');
        input.focus();
        input.select();
    }, 0);
}

async function confirmRenameNote() {
    const newName = document.getElementById('rename-input').value.trim();
    if (!newName) return;
    hideModal('rename-modal');
    
    const response = await fetch('/api/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            old_path: currentNote,
            new_name: newName
        })
    });
    
    const result = await response.json();
    
    if (result.success) {
        wikilinkMap = null; // Invalidate cache
        showNotification('Note renamed');
        currentNote = result.path;
        document.getElementById('note-title').textContent = newName;
        loadTree();
        updateBreadcrumbs();
        updateRecentFile(result.path, newName);
    } else {
        alert(result.error);
    }
}

// Recent files management
function addToRecent(path, title) {
    // Remove if already exists
    recentFiles = recentFiles.filter(f => f.path !== path);
    
    // Add to front
    recentFiles.unshift({ path, title });
    
    // Keep only last 10
    recentFiles = recentFiles.slice(0, 5);
    
    localStorage.setItem('grove-recent', JSON.stringify(recentFiles));
    loadRecentFiles();
}

function removeFromRecent(path) {
    recentFiles = recentFiles.filter(f => f.path !== path);
    localStorage.setItem('grove-recent', JSON.stringify(recentFiles));
    loadRecentFiles();
}

function updateRecentFile(path, title) {
    const file = recentFiles.find(f => f.path === path);
    if (file) {
        file.title = title;
        localStorage.setItem('grove-recent', JSON.stringify(recentFiles));
        loadRecentFiles();
    }
}

function loadRecentFiles() {
    const container = document.getElementById('recent-list');
    container.innerHTML = '';
    
    if (recentFiles.length === 0) {
        container.innerHTML = '<div style="font-size: 12px; color: #888; padding: 4px 8px;">No recent files</div>';
        return;
    }
    
    recentFiles.forEach(file => {
        const item = document.createElement('div');
        item.className = 'recent-item';
        item.textContent = file.title;
        item.addEventListener('click', () => {
            loadNote(file.path);
            closeMobileMenu();
        });
        container.appendChild(item);
    });
}

// Breadcrumbs
function updateBreadcrumbs() {
    const breadcrumbs = document.getElementById('breadcrumbs');
    if (!currentNote) {
        breadcrumbs.innerHTML = '<span class="save-status" id="save-status"></span>';
        showSplash(true);
        return;
    }
    
    const parts = currentNote.split('/');
    let html = '<div class="breadcrumb-path">';
    
    parts.forEach((part, index) => {
        if (index > 0) {
            html += '<span class="breadcrumb-sep">/</span>';
        }
        html += `<span>${part}</span>`;
    });
    
    html += '</div><span class="save-status" id="save-status"></span>';
    breadcrumbs.innerHTML = html;
    showSplash(false);
}

// Splash visibility toggle
async function loadSplashStats() {
    try {
        // Get tree to count files and folders
        const response = await fetch('/api/tree');
        const tree = await response.json();
        
        let fileCount = 0;
        let folderCount = 0;
        
        function countItems(items) {
            for (const item of items) {
                if (item.type === 'folder') {
                    folderCount++;
                    if (item.children) countItems(item.children);
                } else if (item.type === 'file') {
                    fileCount++;
                }
            }
        }
        countItems(tree);
        
        document.getElementById('stat-files').textContent = fileCount;
        document.getElementById('stat-folders').textContent = folderCount;
        document.getElementById('stat-recent').textContent = recentFiles.length;
        
        // Populate recent files list
        const listEl = document.getElementById('splash-recent-list');
        const containerEl = document.getElementById('splash-recent-container');
        
        if (recentFiles.length === 0) {
            containerEl.style.display = 'none';
        } else {
            containerEl.style.display = 'block';
            listEl.innerHTML = '';
            
            for (const recent of recentFiles.slice(0, 5)) {
                const item = document.createElement('div');
                item.className = 'splash-recent-item';
                item.innerHTML = `
                    <i class="fas fa-file-alt"></i>
                    <div class="recent-info">
                        <div class="recent-name">${escapeHtml(recent.title || recent.path)}</div>
                        <div class="recent-modified">${recent.path}</div>
                    </div>
                    <i class="fas fa-chevron-right recent-arrow"></i>
                `;
                item.addEventListener('click', () => {
                    loadNote(recent.path);
                });
                listEl.appendChild(item);
            }
        }
    } catch (error) {
        console.error('Failed to load splash stats:', error);
    }
}

function showSplash(show) {
    const splash = document.getElementById('splash');
    const editorHeader = document.querySelector('.editor-header');
    const toolbar = document.getElementById('markdown-toolbar');
    const editorContainer = document.querySelector('.editor-container');
    if (!splash || !editorHeader || !toolbar || !editorContainer) return;
    splash.style.display = show ? 'flex' : 'none';
    editorHeader.style.display = show ? 'none' : 'flex';
    toolbar.style.display = show ? 'none' : 'flex';
    editorContainer.style.display = show ? 'none' : 'block';
    
    // Load stats when showing splash
    if (show) {
        loadSplashStats();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const sn = document.getElementById('splash-new-note');
    if (sn) sn.addEventListener('click', () => document.getElementById('new-note').click());
    const sd = document.getElementById('splash-daily-note');
    if (sd) sd.addEventListener('click', () => document.getElementById('daily-note').click());
    const st = document.getElementById('splash-templates');
    if (st) st.addEventListener('click', () => document.getElementById('manage-templates').click());
    const sm = document.getElementById('splash-meeting');
    if (sm) sm.addEventListener('click', () => document.getElementById('meeting-note').click());
    const sp = document.getElementById('splash-planner');
    if (sp) sp.addEventListener('click', () => document.getElementById('planner-note').click());
    const std = document.getElementById('splash-todos');
    if (std) std.addEventListener('click', () => document.getElementById('todos-btn').click());
    const sc = document.getElementById('splash-contacts');
    if (sc) sc.addEventListener('click', () => document.getElementById('contacts-btn').click());
    const sr = document.getElementById('splash-readme');
    if (sr) sr.addEventListener('click', () => loadNote('README.md'));
    if (!currentNote) showSplash(true);
});

// Clickable wikilinks in preview
function makeWikilinksClickable() {
    const preview = document.getElementById('preview');
    
    // Add click handlers to wikilinks (already converted before markdown render)
    preview.querySelectorAll('.wikilink').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const noteName = e.target.dataset.note;
            searchAndLoadNote(noteName);
        });
    });
}

async function searchAndLoadNote(noteName) {
    try {
        // Load wikilink map if not cached
        if (!wikilinkMap) {
            const response = await fetch('/api/wikilink-map');
            if (!response.ok) {
                throw new Error(`Failed to load wikilink map: ${response.status}`);
            }
            wikilinkMap = await response.json();
            console.log('Wikilink map loaded:', Object.keys(wikilinkMap).length, 'notes');
        }
        
        // Try exact match (case-insensitive)
        const normalizedName = noteName.toLowerCase().trim();
        const path = wikilinkMap[normalizedName];
        
        console.log('Resolving wikilink:', noteName, '→', path);
        
        if (path) {
            loadNote(path);
        } else {
            console.warn('Wikilink not found in map. Available keys:', Object.keys(wikilinkMap).slice(0, 10));
            showNotification(`Note "${noteName}" not found`);
        }
    } catch (error) {
        console.error('Failed to resolve wikilink:', error);
        showNotification(`Failed to load note "${noteName}"`);
    }
}

function applyHljsTheme(isLight) {
    const dark  = document.getElementById('hljs-theme-dark');
    const light = document.getElementById('hljs-theme-light');
    if (dark)  dark.disabled  = isLight;
    if (light) light.disabled = !isLight;
}

// Theme toggle
function toggleTheme() {
    document.body.classList.toggle('light-theme');
    const isLight = document.body.classList.contains('light-theme');
    localStorage.setItem('grove-theme', isLight ? 'light' : 'dark');

    const icon = document.querySelector('#theme-toggle i');
    icon.className = isLight ? 'fas fa-sun' : 'fas fa-moon';
    applyHljsTheme(isLight);
    if (typeof mermaid !== 'undefined') {
        mermaid.initialize({ startOnLoad: false, theme: isLight ? 'default' : 'dark' });
    }
    renderPreview();
}

function loadTheme() {
    const theme = localStorage.getItem('grove-theme') || 'dark';
    const isLight = theme === 'light';
    if (isLight) {
        document.body.classList.add('light-theme');
        document.querySelector('#theme-toggle i').className = 'fas fa-sun';
    }
    applyHljsTheme(isLight);
}

// Full-screen toggle
function toggleFullscreen() {
    document.body.classList.toggle('fullscreen');
    const icon = document.querySelector('#fullscreen-toggle i');
    const isFullscreen = document.body.classList.contains('fullscreen');
    icon.className = isFullscreen ? 'fas fa-compress' : 'fas fa-expand';
}

function closeMobileMenu() {
    if (window.innerWidth > 768) return;
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;
    sidebar.classList.remove('mobile-open');
    const btn = document.getElementById('sidebar-collapse');
    if (btn) btn.textContent = '☰';
    const editor = document.getElementById('editor');
    if (editor) editor.focus();
}

function openMobileSidebar() {
    if (window.innerWidth > 768) return;
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;
    sidebar.classList.add('mobile-open');
    const btn = document.getElementById('sidebar-collapse');
    if (btn) btn.textContent = '✕';
}

function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const btn = document.getElementById('sidebar-collapse');
    
    // On mobile, toggle mobile-open class; on desktop, toggle collapsed class
    if (window.innerWidth <= 768) {
        const isOpen = sidebar.classList.toggle('mobile-open');
        if (btn) btn.textContent = isOpen ? '✕' : '☰';
    } else {
        const isCollapsed = sidebar.classList.toggle('collapsed');
        if (btn) btn.textContent = isCollapsed ? '☰' : '✕';
    }
}

function goHome() {
    // Navigate to root
    window.location.href = '/';
}

// Keyboard shortcuts
// Markdown toolbar
function setupMarkdownToolbar() {
    document.getElementById('markdown-toolbar').addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        
        const action = btn.dataset.action;
        if (!action) return;
        
        const editor = document.getElementById('editor');
        if (editor.disabled) return;
        
        applyMarkdownAction(action, editor);
    });
}

// Apply a line prefix (bullet, number, checkbox) to selected lines, or toggle it off.
function showLinkModal(editor, start, end, selected) {
    const textInput = document.getElementById('link-modal-text');
    const urlInput = document.getElementById('link-modal-url');
    textInput.value = selected || '';
    urlInput.value = '';
    showModal('link-modal');
    // Focus URL if text is pre-filled from selection, otherwise focus text
    setTimeout(() => (selected ? urlInput : textInput).focus(), 50);

    function insertLink() {
        cleanup();
        const linkText = textInput.value || 'link text';
        const linkUrl = urlInput.value || 'url';
        const replacement = '[' + linkText + '](' + linkUrl + ')';
        editor.value = editor.value.substring(0, start) + replacement + editor.value.substring(end);
        const cursorPos = start + replacement.length;
        editor.selectionStart = cursorPos;
        editor.selectionEnd = cursorPos;
        editor.focus();
        editor.dispatchEvent(new Event('input'));
    }

    function cancel() {
        cleanup();
        editor.focus();
    }

    function onKeydown(e) {
        if (e.key === 'Enter') { e.preventDefault(); insertLink(); }
        if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    }

    function cleanup() {
        hideModal('link-modal');
        document.getElementById('link-modal-insert').removeEventListener('click', insertLink);
        document.getElementById('link-modal-cancel').removeEventListener('click', cancel);
        textInput.removeEventListener('keydown', onKeydown);
        urlInput.removeEventListener('keydown', onKeydown);
    }

    document.getElementById('link-modal-insert').addEventListener('click', insertLink);
    document.getElementById('link-modal-cancel').addEventListener('click', cancel);
    textInput.addEventListener('keydown', onKeydown);
    urlInput.addEventListener('keydown', onKeydown);
}

function applyLinePrefix(action, editor, start, end, text) {
    // Expand selection to full lines
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = end === text.length || text[end] === '\n' ? end : text.indexOf('\n', end);
    const actualEnd = lineEnd === -1 ? text.length : lineEnd;

    const selectedText = text.substring(lineStart, actualEnd);
    const lines = selectedText.split('\n');

    // Determine the prefix pattern for this action
    const prefixPatterns = {
        'ul':       /^- /,
        'ol':       /^\d+\. /,
        'checkbox': /^- \[[ x]\] /
    };
    const pattern = prefixPatterns[action];

    // Check if ALL non-empty lines already have the prefix (toggle off)
    const nonEmpty = lines.filter(l => l.trim().length > 0);
    const allHavePrefix = nonEmpty.length > 0 && nonEmpty.every(l => pattern.test(l));

    let result;
    if (allHavePrefix) {
        // Remove prefix from each line
        result = lines.map(l => l.replace(pattern, '')).join('\n');
    } else {
        // Add prefix to each non-empty line
        result = lines.map((l, i) => {
            if (l.trim().length === 0) return l;
            // Remove existing list prefixes before adding new one
            const cleaned = l.replace(/^(- \[[ x]\] |- |\d+\. )/, '');
            if (action === 'ul') return '- ' + cleaned;
            if (action === 'ol') return (i + 1) + '. ' + cleaned;
            if (action === 'checkbox') return '- [ ] ' + cleaned;
            return l;
        }).join('\n');
    }

    editor.value = text.substring(0, lineStart) + result + text.substring(actualEnd);
    editor.selectionStart = lineStart;
    editor.selectionEnd = lineStart + result.length;
    editor.focus();
    editor.dispatchEvent(new Event('input'));
}

function applyMarkdownAction(action, editor) {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const text = editor.value;
    const selected = text.substring(start, end);
    
    let before = '', after = '', insert = '';
    let cursorOffset = 0;
    
    switch (action) {
        case 'bold':
            before = '**'; after = '**';
            insert = selected || 'bold text';
            break;
        case 'italic':
            before = '_'; after = '_';
            insert = selected || 'italic text';
            break;
        case 'strike':
            before = '~~'; after = '~~';
            insert = selected || 'strikethrough';
            break;
        case 'h1':
            before = getLinePrefix(text, start) + '# '; after = '';
            insert = selected || 'Heading 1';
            break;
        case 'h2':
            before = getLinePrefix(text, start) + '## '; after = '';
            insert = selected || 'Heading 2';
            break;
        case 'h3':
            before = getLinePrefix(text, start) + '### '; after = '';
            insert = selected || 'Heading 3';
            break;
        case 'ul':
        case 'ol':
        case 'checkbox':
            applyLinePrefix(action, editor, start, end, text);
            return;
        case 'link':
            showLinkModal(editor, start, end, selected);
            return;
        case 'image':
            // Trigger file upload dialog
            uploadImageForEditor(editor);
            return; // Don't insert placeholder
        case 'code':
            before = '`'; after = '`';
            insert = selected || 'code';
            break;
        case 'codeblock':
            before = getLinePrefix(text, start) + '```\n'; after = '\n```';
            insert = selected || 'code';
            break;
        case 'quote':
            before = getLinePrefix(text, start) + '> '; after = '';
            insert = selected || 'quote';
            break;
        case 'hr':
            before = getLinePrefix(text, start); after = '';
            insert = '---';
            break;
        case 'wikilink':
            before = '[['; after = ']]';
            insert = selected || 'note name';
            break;
        case 'toc':
            insertTableOfContents(editor);
            return;
        case 'table':
            showTableModal(editor);
            return;
    }
    
    const replacement = before + insert + after;
    editor.value = text.substring(0, start) + replacement + text.substring(end);
    
    // Position cursor
    const newCursorPos = start + before.length + insert.length;
    editor.selectionStart = start + before.length;
    editor.selectionEnd = newCursorPos;
    editor.focus();
    
    // Trigger auto-save
    editor.dispatchEvent(new Event('input'));
}

// Insert Table of Contents based on headings in the note
function insertTableOfContents(editor) {
    const text = editor.value;
    const lines = text.split('\n');
    const tocLines = ['## Table of Contents', ''];

    for (const line of lines) {
        const match = line.match(/^(#{2,4})\s+(.+)/);
        if (!match) continue;
        const level = match[1].length; // 2=h2, 3=h3, 4=h4
        const title = match[2].replace(/\{#.*?\}\s*$/, '').trim();
        if (title.toLowerCase() === 'table of contents') continue;
        const slug = title.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
        const indent = '  '.repeat(level - 2);
        tocLines.push(`${indent}- [${title}](#${slug})`);
    }

    if (tocLines.length <= 2) {
        showNotification('No headings found (H2-H4)');
        return;
    }

    tocLines.push('');
    const toc = tocLines.join('\n');

    // Replace existing TOC or insert at cursor
    const tocStart = text.indexOf('## Table of Contents');
    if (tocStart !== -1) {
        // Find end of existing TOC (next heading or double newline after list ends)
        let tocEnd = tocStart;
        const restLines = text.substring(tocStart).split('\n');
        let i = 1; // skip the TOC heading line
        while (i < restLines.length) {
            const l = restLines[i].trim();
            if (l === '' || l.startsWith('- [') || l.startsWith('  - [') || l.startsWith('    - [')) {
                i++;
            } else {
                break;
            }
        }
        tocEnd = tocStart + restLines.slice(0, i).join('\n').length;
        editor.value = text.substring(0, tocStart) + toc + text.substring(tocEnd);
    } else {
        // Insert at cursor position
        const pos = editor.selectionStart;
        editor.value = text.substring(0, pos) + toc + text.substring(pos);
    }

    editor.dispatchEvent(new Event('input'));
    showNotification('Table of Contents inserted');
}

// Show table dimension modal
function showTableModal(editor) {
    showModal('table-modal');
    
    const rowsInput = document.getElementById('table-rows');
    const colsInput = document.getElementById('table-cols');
    
    // Reset to defaults
    rowsInput.value = 3;
    colsInput.value = 3;
    setTimeout(() => rowsInput.focus(), 0);
}

// Generate and insert markdown table
function insertMarkdownTable(rows, cols, editor) {
    let table = '';
    
    // Header row
    const headers = Array(cols).fill('').map((_, i) => `Column ${i + 1}`);
    table += '| ' + headers.join(' | ') + ' |\n';
    
    // Separator row
    table += '| ' + Array(cols).fill('---').join(' | ') + ' |\n';
    
    // Data rows
    for (let i = 0; i < rows - 1; i++) {
        table += '| ' + Array(cols).fill('').join(' | ') + ' |\n';
    }
    
    // Insert at cursor position
    const pos = editor.selectionStart;
    const text = editor.value;
    const prefix = getLinePrefix(text, pos);
    
    editor.value = text.substring(0, pos) + prefix + table + text.substring(pos);
    
    // Position cursor at first header cell
    const newPos = pos + prefix.length + 2; // after "| "
    editor.selectionStart = newPos;
    editor.selectionEnd = newPos + headers[0].length;
    editor.focus();
    
    editor.dispatchEvent(new Event('input'));
    showNotification(`Table (${rows}×${cols}) inserted`);
}

// Get prefix needed to start at beginning of current line
function getLinePrefix(text, pos) {
    const lineStart = text.lastIndexOf('\n', pos - 1);
    const currentPos = pos;
    
    // If we're at the start of a line already, just return empty
    if (lineStart === pos - 1 || pos === 0) return '';
    
    // Otherwise add a newline to start fresh
    return '\n';
}

// Star/Unstar note
async function toggleStarNote() {
    if (!currentNote) return;
    
    const response = await fetch(`/api/note/${currentNote}/star`, {
        method: 'POST'
    });
    
    const result = await response.json();
    
    if (result.success) {
        updateStarButton(result.starred);
        showNotification(result.starred ? 'Note starred' : 'Note unstarred');
        loadTree(); // Refresh tree to show/hide star icons
    } else {
        showNotification('Error toggling star');
    }
}

function updateStarButton(starred) {
    const starBtn = document.getElementById('star-btn');
    const icon = starBtn.querySelector('i');
    if (starred) {
        icon.className = 'fas fa-star'; // Filled star
        starBtn.style.color = 'gold';
    } else {
        icon.className = 'far fa-star'; // Outline star
        starBtn.style.color = '';
    }
}

// Mermaid diagram templates
const mermaidTemplates = {
    flowchart: `\`\`\`mermaid
flowchart TD
    A[Start] --> B{Decision?}
    B -->|Yes| C[Do something]
    B -->|No| D[Do something else]
    C --> E[End]
    D --> E
\`\`\``,
    sequence: `\`\`\`mermaid
sequenceDiagram
    participant Alice
    participant Bob
    participant Charlie
    Alice->>Bob: Hello Bob
    Bob->>Charlie: Hello Charlie
    Charlie-->>Bob: Hi Bob
    Bob-->>Alice: Hi Alice
    Alice->>Bob: How are you?
    Bob->>Alice: Great!
\`\`\``,
    class: `\`\`\`mermaid
classDiagram
    class Animal {
        +String name
        +int age
        +makeSound()
    }
    class Dog {
        +String breed
        +fetch()
    }
    class Cat {
        +String color
        +purr()
    }
    Animal <|-- Dog
    Animal <|-- Cat
\`\`\``,
    state: `\`\`\`mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Processing : Submit
    Processing --> Success : Valid
    Processing --> Error : Invalid
    Error --> Idle : Retry
    Success --> [*]
\`\`\``,
    er: `\`\`\`mermaid
erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE-ITEM : contains
    CUSTOMER {
        string name
        string email
        int id
    }
    ORDER {
        int id
        date created
        string status
    }
    LINE-ITEM {
        int quantity
        float price
        string product
    }
\`\`\``,
    journey: `\`\`\`mermaid
journey
    title My Working Day
    section Morning
        Wake up: 3: Me
        Breakfast: 4: Me
        Commute: 2: Me, Bus
    section Work
        Meetings: 3: Me, Team
        Coding: 5: Me
        Lunch: 4: Me, Coworker
    section Evening
        Commute home: 2: Me
        Dinner: 5: Me, Family
        Relax: 5: Me
\`\`\``,
    gantt: `\`\`\`mermaid
gantt
    title Project Timeline
    dateFormat YYYY-MM-DD
    section Planning
        Requirements    :a1, 2026-01-01, 7d
        Design          :a2, after a1, 5d
    section Development
        Backend         :b1, after a2, 14d
        Frontend        :b2, after a2, 14d
    section Testing
        QA              :c1, after b1, 7d
        UAT             :c2, after c1, 5d
    section Launch
        Deploy          :d1, after c2, 2d
\`\`\``,
    pie: `\`\`\`mermaid
pie title Project Time Distribution
    "Development" : 40
    "Testing" : 20
    "Meetings" : 15
    "Documentation" : 10
    "Planning" : 10
    "Other" : 5
\`\`\``,
    requirement: `\`\`\`mermaid
requirementDiagram
    requirement user_auth {
        id: REQ-001
        text: Users must authenticate before accessing the system
        risk: high
        verifymethod: test
    }
    requirement data_encrypt {
        id: REQ-002
        text: All data must be encrypted at rest
        risk: medium
        verifymethod: inspection
    }
    element app_server {
        type: software
    }
    app_server - satisfies -> user_auth
    app_server - satisfies -> data_encrypt
\`\`\``,
    c4context: `\`\`\`mermaid
C4Context
    title System Context Diagram
    Person(user, "User", "A user of the system")
    System(system, "My System", "The main application")
    System_Ext(email, "Email Service", "Sends emails")
    System_Ext(db, "Database", "Stores data")
    Rel(user, system, "Uses")
    Rel(system, email, "Sends notifications")
    Rel(system, db, "Reads/writes data")
\`\`\``,
    c4container: `\`\`\`mermaid
C4Container
    title Container Diagram
    Person(user, "User", "End user of the system")
    System_Boundary(boundary, "My System") {
        Container(web, "Web App", "React", "Delivers the frontend")
        Container(api, "API Server", "Node.js", "Handles business logic")
        ContainerDb(db, "Database", "PostgreSQL", "Stores application data")
        Container(cache, "Cache", "Redis", "Session and data cache")
    }
    Rel(user, web, "Uses", "HTTPS")
    Rel(web, api, "Calls", "JSON/HTTPS")
    Rel(api, db, "Reads/writes", "SQL")
    Rel(api, cache, "Reads/writes", "TCP")
\`\`\``,
    c4component: `\`\`\`mermaid
C4Component
    title Component Diagram - API Server
    Container_Boundary(api, "API Server") {
        Component(auth, "Auth Module", "Express middleware", "Handles authentication")
        Component(users, "User Service", "Node.js", "Manages user accounts")
        Component(orders, "Order Service", "Node.js", "Processes orders")
        Component(notify, "Notification Service", "Node.js", "Sends alerts")
    }
    ContainerDb(db, "Database", "PostgreSQL")
    Container_Ext(email, "Email Provider", "SendGrid")
    Rel(auth, users, "Validates")
    Rel(orders, db, "Reads/writes")
    Rel(users, db, "Reads/writes")
    Rel(notify, email, "Sends via")
\`\`\``,
    c4deployment: `\`\`\`mermaid
C4Deployment
    title Deployment Diagram - Production
    Deployment_Node(aws, "AWS", "Cloud") {
        Deployment_Node(vpc, "VPC") {
            Deployment_Node(ecs, "ECS Cluster") {
                Container(api, "API Server", "Node.js")
                Container(web, "Web App", "React")
            }
            Deployment_Node(rds, "RDS") {
                ContainerDb(db, "Database", "PostgreSQL")
            }
        }
        Deployment_Node(cdn, "CloudFront") {
            Container(static, "Static Assets", "S3")
        }
    }
    Rel(web, api, "Calls", "HTTPS")
    Rel(api, db, "Reads/writes", "SQL")
\`\`\``
};

// Upload modal
async function openUploadModal() {
    const folderSelect = document.getElementById('upload-folder');
    
    // Fetch folders
    try {
        const response = await fetch('/api/folders');
        const folders = await response.json();
        
        folderSelect.innerHTML = '<option value="">/ (root)</option>';
        folders.forEach(folder => {
            const option = document.createElement('option');
            option.value = folder;
            option.textContent = '/' + folder;
            folderSelect.appendChild(option);
        });
    } catch (e) {
        console.error('Failed to load folders:', e);
    }
    
    // Reset
    document.getElementById('upload-input').value = '';
    document.getElementById('upload-preview').innerHTML = '';
    document.getElementById('upload-confirm-btn').disabled = true;
    document.getElementById('upload-confirm-btn').style.display = '';
    
    showModal('upload-modal');
}

function updateUploadPreview() {
    const input = document.getElementById('upload-input');
    const preview = document.getElementById('upload-preview');
    const confirmBtn = document.getElementById('upload-confirm-btn');
    
    if (input.files.length === 0) {
        preview.innerHTML = '';
        confirmBtn.disabled = true;
        return;
    }
    
    const items = [];
    for (const file of input.files) {
        items.push(`<div><i class="fas fa-file-alt"></i> ${file.name} (${(file.size / 1024).toFixed(1)} KB)</div>`);
    }
    preview.innerHTML = items.join('');
    confirmBtn.disabled = false;
}

async function performUpload() {
    const input = document.getElementById('upload-input');
    const folder = document.getElementById('upload-folder').value;
    const confirmBtn = document.getElementById('upload-confirm-btn');
    const preview = document.getElementById('upload-preview');
    
    if (input.files.length === 0) return;
    
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';
    
    const formData = new FormData();
    formData.append('folder', folder);
    for (const file of input.files) {
        formData.append('files', file);
    }
    
    try {
        const response = await fetch('/api/upload/bulk', {
            method: 'POST',
            body: formData
        });
        const result = await response.json();
        
        if (result.uploaded && result.uploaded.length > 0) {
            await loadTree();

            // Generate markdown references for uploaded files
            // Use relative path if in same folder as current note, otherwise full path
            const currentDir = currentNote ? currentNote.split('/').slice(0, -1).join('/') : '';
            const refs = result.uploaded.map(path => {
                const filename = path.split('/').pop();
                const name = filename.replace(/\.[^.]+$/, '');
                const ext = path.split('.').pop().toLowerCase();
                const fileDir = path.split('/').slice(0, -1).join('/');
                const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext);

                // Use relative path if same directory
                const ref = (fileDir === currentDir) ? filename : `/api/file/${path}`;

                if (isImage) {
                    return `![${name}](${ref})`;
                } else {
                    return `[${name}](${ref})`;
                }
            });

            // Copy markdown references to clipboard
            try {
                await navigator.clipboard.writeText(refs.join('\n'));
                showNotification(`Uploaded ${result.uploaded.length} file(s) - markdown copied to clipboard`);
            } catch (e) {
                showNotification(`Uploaded ${result.uploaded.length} file(s)`);
            }

            // Close the modal
            hideModal('upload-modal');
        } else {
            hideModal('upload-modal');
        }
        
        if (result.errors && result.errors.length > 0) {
            showNotification(`Errors: ${result.errors.join(', ')}`, 'error');
        }
    } catch (e) {
        showNotification('Upload failed: ' + e.message, 'error');
    } finally {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = '<i class="fas fa-upload"></i> Upload';
    }
}

// Extract modal
async function openExtractModal() {
    // Populate tag filter
    const tagSelect = document.getElementById('extract-tag');
    const response = await fetch('/api/tags');
    const tags = await response.json();
    
    tagSelect.innerHTML = '<option value="">All tags</option>';
    Object.keys(tags).sort().forEach(tag => {
        const option = document.createElement('option');
        option.value = tag;
        option.textContent = `${tag} (${tags[tag]})`;
        tagSelect.appendChild(option);
    });
    
    // Reset form
    document.getElementById('extract-months').value = 'all';
    document.querySelector('input[name="extract-scope"][value="starred"]').checked = true;
    document.querySelectorAll('.extract-type').forEach(cb => cb.checked = false);
    document.getElementById('extract-tag').value = '';
    document.getElementById('extract-result-container').style.display = 'none';
    
    showModal('extract-modal');
}

async function runExtract() {
    const months = document.getElementById('extract-months').value;
    const starred = document.querySelector('input[name="extract-scope"]:checked').value === 'starred' ? 'true' : 'false';
    const types = Array.from(document.querySelectorAll('.extract-type:checked')).map(cb => cb.value).join(',');
    const tag = document.getElementById('extract-tag').value;
    
    const params = new URLSearchParams({
        months,
        starred,
    });
    
    if (types) params.append('type', types);
    if (tag) params.append('tag', tag);
    
    const response = await fetch(`/api/extract?${params}`);
    const markdown = await response.text();
    
    // Count notes from the markdown
    const noteCount = (markdown.match(/^## /gm) || []).length - 1; // -1 for header
    
    document.getElementById('extract-result').value = markdown;
    document.getElementById('extract-note-count').textContent = `${noteCount} notes extracted`;
    document.getElementById('extract-result-container').style.display = 'block';
}

function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Ctrl+S or Cmd+S - Save
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            saveNoteUpdated();
        }
        
        // Ctrl+B - Bold
        if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
            e.preventDefault();
            applyMarkdownAction('bold', document.getElementById('editor'));
        }
        
        // Ctrl+I - Italic
        if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
            e.preventDefault();
            applyMarkdownAction('italic', document.getElementById('editor'));
        }
        
        // Ctrl+L - Link
        if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
            e.preventDefault();
            applyMarkdownAction('link', document.getElementById('editor'));
        }
        
        // Ctrl+N or Cmd+N - New note
        if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
            e.preventDefault();
            document.getElementById('new-note').click();
        }
        
        // Ctrl+P or Cmd+P - Toggle preview
        if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
            e.preventDefault();
            if (!document.getElementById('preview-toggle').disabled) {
                togglePreview();
            }
        }

        // Ctrl+E or Cmd+E - Switch to Edit mode immediately
        if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
            e.preventDefault();
            const editorContainer = document.getElementById('drop-zone');
            const previewBtn = document.getElementById('preview-toggle');
            previewMode = 'edit';
            editorContainer.classList.remove('split-view', 'preview-only');
            if (previewBtn) {
                previewBtn.innerHTML = '<i class="fas fa-columns"></i>';
                previewBtn.title = 'Split View (Ctrl+P)';
            }
            const editor = document.getElementById('editor');
            if (editor && !editor.disabled) editor.focus();
        }
        
        // Ctrl+K or Cmd+K - Open search modal
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            showModal('search-modal');
            setTimeout(() => document.getElementById('search-modal-input').focus(), 0);
        }
        
        // Ctrl+M - New meeting note
        if ((e.ctrlKey || e.metaKey) && e.key === 'm') {
            e.preventDefault();
            document.getElementById('meeting-note').click();
        }
        
        // Ctrl+D - New daily note
        if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
            e.preventDefault();
            createDailyNote();
        }
        
        // Ctrl+C (without Cmd) - Open contacts modal (only when nothing is selected)
        if (e.ctrlKey && !e.metaKey && e.key === 'c') {
            const tag = e.target.tagName;
            const hasSelection = (tag === 'INPUT' || tag === 'TEXTAREA')
                ? (e.target.selectionEnd - e.target.selectionStart) > 0
                : window.getSelection().toString().length > 0;
            if (!hasSelection) {
                e.preventDefault();
                openContactsModal();
            }
        }

        // F2 - Rename
        if (e.key === 'F2' && currentNote) {
            e.preventDefault();
            renameNote();
        }
        
        // Delete - Delete note
        if (e.key === 'Delete' && currentNote && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
            e.preventDefault();
            deleteNote();
        }
        
        // F11 - Full screen
        if (e.key === 'F11') {
            e.preventDefault();
            toggleFullscreen();
        }
        
        // Escape - Exit fullscreen
        if (e.key === 'Escape' && document.body.classList.contains('fullscreen')) {
            e.preventDefault();
            toggleFullscreen();
        }
    });
}

// Update render preview to make wikilinks clickable
const originalRenderPreview = renderPreview;
renderPreview = function() {
    originalRenderPreview();
    makeWikilinksClickable();
};

// Template management
let currentTemplate = null;
let allTemplates = [];

async function loadTemplatesModal() {
    const response = await fetch('/api/templates');
    allTemplates = await response.json();
    
    const container = document.getElementById('templates-list-items');
    container.innerHTML = '';
    
    if (allTemplates.length === 0) {
        container.innerHTML = '<div style="font-size: 12px; color: #888; padding: 8px;">No templates yet</div>';
        return;
    }
    
    allTemplates.forEach(template => {
        const item = document.createElement('div');
        item.className = 'template-list-item';
        item.textContent = template.name;
        item.addEventListener('click', () => loadTemplateForEdit(template.name));
        container.appendChild(item);
    });
}

async function loadTemplateForEdit(templateName) {
    const response = await fetch(`/api/template/${templateName}`);
    const template = await response.json();
    
    currentTemplate = templateName;
    
    // Show editor
    document.getElementById('template-editor-empty').style.display = 'none';
    document.getElementById('template-editor-content').style.display = 'flex';
    
    // Update UI
    document.getElementById('template-editor-title').textContent = templateName;
    document.getElementById('template-editor-textarea').value = template.content;
    
    // Highlight active template
    document.querySelectorAll('.template-list-item').forEach(item => {
        item.classList.remove('active');
        if (item.textContent === templateName) {
            item.classList.add('active');
        }
    });
}

async function saveTemplate() {
    if (!currentTemplate) return;
    
    const content = document.getElementById('template-editor-textarea').value;
    
    const response = await fetch(`/api/template/${currentTemplate}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
    });
    
    if (response.ok) {
        showNotification('Template saved');
    }
}

async function createNewTemplate() {
    const name = prompt('Enter template name:');
    if (!name) return;
    
    const response = await fetch('/api/template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: name,
            // Templates are body-only; Grove manages frontmatter
            content: `# {{title}}\n\n`
        })
    });
    
    const result = await response.json();
    
    if (result.success) {
        showNotification('Template created');
        loadTemplatesModal();
        loadTemplateForEdit(result.name);
        loadTemplates(); // Reload template dropdown
    } else {
        alert(result.error);
    }
}

async function deleteTemplate() {
    if (!currentTemplate) return;
    
    if (!confirm(`Delete template "${currentTemplate}"?`)) return;
    
    const response = await fetch(`/api/template/${currentTemplate}`, {
        method: 'DELETE'
    });
    
    if (response.ok) {
        showNotification('Template deleted');
        currentTemplate = null;
        document.getElementById('template-editor-empty').style.display = 'flex';
        document.getElementById('template-editor-content').style.display = 'none';
        loadTemplatesModal();
        loadTemplates(); // Reload template dropdown
    }
}

function openTemplatesModal() {
    loadTemplatesModal();
    showModal('templates-modal');
}

// Update loadTemplates to work with new API format
async function loadTemplatesUpdated() {
    const response = await fetch('/api/templates');
    const templates = await response.json();
    
    const select = document.getElementById('modal-template');
    select.innerHTML = '<option value="">None</option>';
    
    templates.forEach(template => {
        const option = document.createElement('option');
        option.value = template.name;
        option.textContent = template.name;
        select.appendChild(option);
    });
}

// Override old loadTemplates
loadTemplates = loadTemplatesUpdated;

let allTodos = [];

async function loadTodos() {
    const response = await fetch('/api/todos');
    allTodos = await response.json();
    renderTodos();
}

function renderTodos() {
    const incompleteContainer = document.getElementById('todos-incomplete-list');
    const completeContainer = document.getElementById('todos-complete-list');
    
    incompleteContainer.innerHTML = '';
    completeContainer.innerHTML = '';
    
    if (allTodos.length === 0) {
        incompleteContainer.innerHTML = `
            <div class="todos-empty">
                <p>No tasks yet</p>
                <code>- [ ] Task to do</code>
            </div>
        `;
        updateTodosStats();
        return;
    }
    
    const incomplete = allTodos.filter(t => !t.completed);
    const complete = allTodos.filter(t => t.completed);
    
    function buildTodoEl(todo) {
        const todoEl = document.createElement('div');
        todoEl.className = `todo-item ${todo.completed ? 'complete' : 'incomplete'}`;
        todoEl.innerHTML = `
            <input type="checkbox" class="todo-checkbox" ${todo.completed ? 'checked' : ''} 
                   data-path="${todo.path}" data-line="${todo.line}">
            <div class="todo-content">
                <div class="todo-text">${escapeHtml(todo.text)}</div>
                <div class="todo-meta">
                    <i class="fas fa-file-alt"></i>
                    <a href="#" class="todo-note-link" data-path="${todo.path}">${escapeHtml(todo.note)}</a>
                </div>
            </div>
        `;
        
        todoEl.querySelector('.todo-checkbox').addEventListener('change', async () => {
            await toggleTodo(todo.path, todo.line);
            await loadTodos();
        });
        
        todoEl.querySelector('.todo-note-link').addEventListener('click', (e) => {
            e.preventDefault();
            hideModal('todos-modal');
            loadNote(todo.path);
        });
        
        return todoEl;
    }
    
    incomplete.forEach(t => incompleteContainer.appendChild(buildTodoEl(t)));
    complete.forEach(t => completeContainer.appendChild(buildTodoEl(t)));
    
    if (incomplete.length === 0) {
        incompleteContainer.innerHTML = '<div class="todos-empty"><p>All done! 🎉</p></div>';
    }
    if (complete.length === 0) {
        completeContainer.innerHTML = '<div class="todos-empty"><p>Nothing completed yet</p></div>';
    }
    
    updateTodosStats();
}

function updateTodosStats() {
    const incomplete = allTodos.filter(t => !t.completed).length;
    const complete = allTodos.filter(t => t.completed).length;
    const total = allTodos.length;
    
    document.getElementById('todos-count').textContent = `${total} ${total === 1 ? 'task' : 'tasks'}`;
    document.getElementById('todos-incomplete').textContent = `${incomplete} incomplete`;
    document.getElementById('todos-complete').textContent = `${complete} complete`;
}

async function toggleTodo(path, lineNum) {
    const response = await fetch('/api/toggle-todo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, line: lineNum })
    });
    
    if (response.ok) {
        // If the note is currently open, reload it to show the change
        if (currentNote === path) {
            await loadNote(path);
        }
    } else {
        const error = await response.json();
        showNotification(`Error: ${error.error}`);
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function openTodosModal() {
    loadTodos();
    showModal('todos-modal');
}

// ─── Backlinks ───

async function loadBacklinks(notePath) {
    try {
        const response = await fetch(`/api/backlinks/${notePath}`);
        const data = await response.json();
        
        const panel = document.getElementById('backlinks-panel');
        const countEl = document.getElementById('backlinks-count');
        const listEl = document.getElementById('backlinks-list');
        
        if (data.count === 0) {
            panel.style.display = 'none';
            return;
        }
        
        panel.style.display = 'flex';
        countEl.textContent = data.count;
        listEl.innerHTML = '';
        
        data.backlinks.forEach(link => {
            const item = document.createElement('span');
            item.className = 'backlink-item';
            item.textContent = link.title;
            item.title = `Click to open ${link.title}`;
            item.addEventListener('click', () => {
                loadNote(link.path);
            });
            listEl.appendChild(item);
        });
    } catch (error) {
        console.error('Failed to load backlinks:', error);
        document.getElementById('backlinks-panel').style.display = 'none';
    }
}

// ─── Calendar View ───

let calendarDate = new Date();
let calendarData = {};

async function openCalendarView() {
    showModal('calendar-modal');
    calendarDate = new Date();
    
    try {
        const response = await fetch('/api/calendar');
        calendarData = await response.json();
        renderCalendar();
    } catch (error) {
        console.error('Failed to load calendar data:', error);
        showNotification('Failed to load calendar');
    }
}

function navigateCalendar(direction) {
    calendarDate.setMonth(calendarDate.getMonth() + direction);
    renderCalendar();
}

function renderCalendar() {
    const grid = document.getElementById('calendar-grid');
    const titleEl = document.getElementById('calendar-title');
    
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    
    // Update title
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                        'July', 'August', 'September', 'October', 'November', 'December'];
    titleEl.textContent = `${monthNames[month]} ${year}`;
    
    // Clear grid
    grid.innerHTML = '';
    
    // Add day headers
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    dayNames.forEach(day => {
        const header = document.createElement('div');
        header.className = 'calendar-header';
        header.textContent = day;
        grid.appendChild(header);
    });
    
    // Get first day of month and number of days
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startDayOfWeek = firstDay.getDay();
    
    // Get today for highlighting
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    
    // Add empty cells for days before first of month
    const prevMonth = new Date(year, month, 0);
    const daysInPrevMonth = prevMonth.getDate();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
        const dayNum = daysInPrevMonth - i;
        const dateStr = formatDateStr(year, month - 1, dayNum);
        const cell = createDayCell(dayNum, dateStr, true);
        grid.appendChild(cell);
    }
    
    // Add days of current month
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = formatDateStr(year, month, day);
        const isToday = dateStr === todayStr;
        const cell = createDayCell(day, dateStr, false, isToday);
        grid.appendChild(cell);
    }
    
    // Add empty cells for days after end of month
    const totalCells = startDayOfWeek + daysInMonth;
    const remainingCells = (7 - (totalCells % 7)) % 7;
    for (let i = 1; i <= remainingCells; i++) {
        const dateStr = formatDateStr(year, month + 1, i);
        const cell = createDayCell(i, dateStr, true);
        grid.appendChild(cell);
    }
}

function formatDateStr(year, month, day) {
    // Handle month overflow/underflow
    const date = new Date(year, month, day);
    return date.toISOString().split('T')[0];
}

function createDayCell(dayNum, dateStr, isOtherMonth, isToday = false) {
    const cell = document.createElement('div');
    cell.className = 'calendar-day';
    if (isOtherMonth) cell.classList.add('other-month');
    if (isToday) cell.classList.add('today');
    
    const notes = calendarData[dateStr] || [];
    if (notes.length > 0) cell.classList.add('has-notes');
    
    // Day number
    const numEl = document.createElement('span');
    numEl.className = 'day-number';
    numEl.textContent = dayNum;
    cell.appendChild(numEl);
    
    // Dots for note types
    if (notes.length > 0) {
        const dotsEl = document.createElement('div');
        dotsEl.className = 'day-dots';
        
        const types = [...new Set(notes.map(n => n.type))];
        types.slice(0, 3).forEach(type => {
            const dot = document.createElement('span');
            dot.className = `day-dot ${type}`;
            dotsEl.appendChild(dot);
        });
        
        cell.appendChild(dotsEl);
    }
    
    // Click handler
    cell.addEventListener('click', () => {
        if (notes.length === 1) {
            // Single note - open directly
            hideModal('calendar-modal');
            loadNote(notes[0].path);
        } else if (notes.length > 1) {
            // Multiple notes - show picker
            showCalendarNotePicker(dateStr, notes);
        } else {
            // No notes - create daily note for that date
            hideModal('calendar-modal');
            createDailyNoteForDate(dateStr);
        }
    });
    
    // Tooltip
    if (notes.length > 0) {
        cell.title = notes.map(n => n.title).join('\n');
    } else {
        cell.title = 'Click to create daily note';
    }
    
    return cell;
}

function showCalendarNotePicker(dateStr, notes) {
    const picker = document.createElement('div');
    picker.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 8px; padding: 16px; z-index: 2000; min-width: 200px;';
    
    const title = document.createElement('h3');
    title.style.cssText = 'margin: 0 0 12px 0; font-size: 14px;';
    title.textContent = `Notes for ${dateStr}`;
    picker.appendChild(title);
    
    notes.forEach(note => {
        const btn = document.createElement('button');
        btn.className = 'btn-secondary';
        btn.style.cssText = 'width: 100%; margin-bottom: 8px; text-align: left;';
        btn.innerHTML = `<span class="day-dot ${note.type}" style="display: inline-block; margin-right: 8px;"></span>${note.title}`;
        btn.addEventListener('click', () => {
            document.body.removeChild(picker);
            hideModal('calendar-modal');
            loadNote(note.path);
        });
        picker.appendChild(btn);
    });
    
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn-secondary';
    cancelBtn.style.cssText = 'width: 100%;';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => document.body.removeChild(picker));
    picker.appendChild(cancelBtn);
    
    document.body.appendChild(picker);
}

async function createDailyNoteForDate(dateStr) {
    const response = await fetch('/api/daily', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: dateStr })
    });
    
    const result = await response.json();
    
    if (result.success) {
        wikilinkMap = null;
        loadTree();
        loadNote(result.path, true);
        showNotification('Daily note created');
    } else {
        // Note might already exist, try to load it
        const dailyPath = `daily/${dateStr}.md`;
        loadNote(dailyPath);
    }
}

// ─── Graph View ───

let graphNetwork = null;

async function openGraphView() {
    showModal('graph-modal');
    
    try {
        const response = await fetch('/api/graph');
        const data = await response.json();
        
        renderGraph(data);
    } catch (error) {
        console.error('Failed to load graph data:', error);
        showNotification('Failed to load graph');
    }
}

function renderGraph(data) {
    const container = document.getElementById('graph-container');
    
    // Detect theme
    const isDarkMode = !document.body.classList.contains('light-theme');
    
    // Theme-aware colors
    const nodeColor = isDarkMode ? '#888' : '#4a4a4a';
    const labelColor = isDarkMode ? '#e0e0e0' : '#333';
    const edgeColor = isDarkMode ? '#555' : '#999';
    const highlightColor = '#2c5aa0';
    
    // Prepare nodes with clean, minimal styling
    const nodes = new vis.DataSet(data.nodes.map(n => ({
        id: n.id,
        label: n.label,
        title: n.title,
        shape: 'dot',
        size: 6,
        color: {
            background: nodeColor,
            border: nodeColor,
            highlight: {
                background: highlightColor,
                border: highlightColor
            }
        },
        font: {
            color: labelColor,
            size: 13,
            face: 'system-ui, -apple-system, sans-serif'
        }
    })));
    
    // Prepare edges with thin, subtle lines
    const edges = new vis.DataSet(data.edges.map(e => ({
        from: e.from,
        to: e.to,
        arrows: {
            to: {
                enabled: true,
                scaleFactor: 0.5
            }
        },
        color: {
            color: edgeColor,
            highlight: highlightColor
        },
        width: 1,
        smooth: {
            type: 'continuous'
        }
    })));
    
    const graphData = {
        nodes: nodes,
        edges: edges
    };
    
    const options = {
        physics: {
            stabilization: {
                iterations: 300,
                fit: true
            },
            barnesHut: {
                gravitationalConstant: -3000,
                springLength: 200,
                springConstant: 0.03,
                damping: 0.5
            }
        },
        interaction: {
            hover: true,
            tooltipDelay: 100,
            hideEdgesOnDrag: true,
            hideEdgesOnZoom: false
        },
        layout: {
            improvedLayout: true
        }
    };
    
    // Create network
    if (graphNetwork) {
        graphNetwork.destroy();
    }
    graphNetwork = new vis.Network(container, graphData, options);
    
    // Handle node click
    graphNetwork.on('click', function(params) {
        if (params.nodes.length > 0) {
            const nodeId = params.nodes[0];
            hideModal('graph-modal');
            loadNote(nodeId);
        }
    });
}

