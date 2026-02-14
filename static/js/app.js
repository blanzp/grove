// Grove - Markdown Notes App

let currentNote = null;
let currentFolder = '';
let previewMode = 'edit'; // 'edit', 'split', 'preview'
let autoSaveTimeout = null;
let recentFiles = JSON.parse(localStorage.getItem('grove-recent') || '[]').slice(0, 5);
let allContacts = [];
let defaultContactTemplate = '[{{first_name}} {{last_name}}](mailto:{{email}})';

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    // Configure marked for proper fenced code handling
    if (typeof marked !== 'undefined') {
        try {
            if (typeof marked.setOptions === 'function') {
                marked.setOptions({
                    gfm: true,
                    breaks: false,
                    headerIds: true,
                    mangle: false,
                    smartLists: true,
                });
            }
        } catch (e) { /* ignore */ }
    }

    initVaultSelect();
    loadContacts();

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

async function deleteCurrentVault() {
    const sel = document.getElementById('vault-select');
    const name = sel.value;
    if (name === 'vault') {
        showNotification('Cannot delete the default vault');
        return;
    }
    if (!confirm(`Are you sure you want to permanently delete the "${name}" vault and ALL its notes?`)) return;
    if (!confirm(`This cannot be undone. Type-to-confirm: delete "${name}"?`)) return;
    const resp = await fetch('/api/vaults/delete', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name})});
    if (resp.ok) {
        localStorage.setItem('grove-recent', '[]');
        location.reload();
    } else {
        const err = await resp.json();
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
        } else if (item.type === 'asset') {
            const ext = (item.name.split('.').pop() || '').toLowerCase();
            const iconMap = {png:'fa-image',jpg:'fa-image',jpeg:'fa-image',gif:'fa-image',webp:'fa-image',svg:'fa-image',pdf:'fa-file-pdf',mp3:'fa-file-audio',mp4:'fa-file-video',wav:'fa-file-audio'};
            const icon = iconMap[ext] || 'fa-file';
            itemDiv.innerHTML = `<i class="fas ${icon}"></i> ${item.name}`;
            itemDiv.style.opacity = '0.8';
            itemDiv.addEventListener('click', () => {
                // Open asset in new tab or copy path
                const url = `/api/file/${item.path}`;
                if (['png','jpg','jpeg','gif','webp','svg'].includes(ext)) {
                    // Copy markdown image ref
                    const md = `![${item.name}](${url})`;
                    navigator.clipboard.writeText(md).then(() => showNotification('Image markdown copied'));
                } else {
                    window.open(url, '_blank');
                }
            });
        } else {
            itemDiv.innerHTML = `<i class="fas fa-file-alt"></i> ${item.name}`;
            itemDiv.setAttribute('draggable', 'true');
            itemDiv.addEventListener('click', () => {
                loadNote(item.path);
                closeMobileMenu();
            });
            
            // Make files draggable
            itemDiv.addEventListener('dragstart', handleDragStart);
            itemDiv.addEventListener('dragend', handleDragEnd);
        }
        
        container.appendChild(itemDiv);
        
        // Render children for folders
        if (item.type === 'folder' && item.children && item.children.length > 0) {
            const childContainer = document.createElement('div');
            childContainer.className = 'tree-children';
            renderTree(item.children, childContainer, level + 1);
            container.appendChild(childContainer);
        }
    });
}

// Load a note
let currentNoteTags = [];
let currentNoteFrontmatter = '';
let showFrontmatter = false;

async function loadNote(path) {
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
    
    // Default to preview mode when opening a note
    previewMode = 'preview';
    showFrontmatter = false;
    const editorContainer = document.getElementById('drop-zone');
    editorContainer.classList.remove('split-view');
    editorContainer.classList.add('preview-only');
    document.getElementById('preview-toggle').innerHTML = '<i class="fas fa-edit"></i>';
    document.getElementById('preview-toggle').title = 'Edit Mode (Ctrl+P)';
    
    document.getElementById('note-title').textContent = note.title;
    renderTagsDisplay();
    document.getElementById('editor').value = content;
    document.getElementById('editor').disabled = false;
    document.getElementById('tags-btn').disabled = false;
    const fmToggle = document.getElementById('frontmatter-toggle');
    if (fmToggle) fmToggle.disabled = true;
    document.getElementById('preview-toggle').disabled = false;
    document.getElementById('delete-btn').disabled = false;
    document.getElementById('rename-btn').disabled = false;
    document.getElementById('share-btn').disabled = false;
    document.getElementById('frontmatter-preview').disabled = false;
    
    // Render preview (default mode)
    renderPreview();
    
    // Add to recent files
    addToRecent(path, note.title);
    
    // Update breadcrumbs
    updateBreadcrumbs();
    
    // Setup auto-save for this note
    setupAutoSave();
    
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

function shareViaEmail() {
    hideModal('share-modal');
    const { title, body } = getRenderedHtml();
    const mailto = 'mailto:?subject=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(body);
    window.open(mailto);
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

async function shareViaCopyHtml() {
    hideModal('share-modal');
    const { html } = getRenderedHtml();
    try {
        await navigator.clipboard.write([
            new ClipboardItem({
                'text/html': new Blob([html], { type: 'text/html' }),
                'text/plain': new Blob([html], { type: 'text/plain' })
            })
        ]);
        showNotification('HTML copied to clipboard');
    } catch (e) {
        // Fallback
        try { await navigator.clipboard.writeText(html); showNotification('HTML copied as text'); }
        catch (e2) { showNotification('Copy failed'); }
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
    renderContactsList();
    showModal('contacts-modal');
}

function renderContactsList() {
    const container = document.getElementById('contacts-list');
    if (allContacts.length === 0) {
        container.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-secondary);">No contacts yet.</div>';
        return;
    }
    container.innerHTML = '';
    allContacts.forEach(c => {
        const row = document.createElement('div');
        row.className = 'contact-row';
        row.innerHTML = `
            <div class="contact-info">
                <div class="name">${escapeHtml(c.first_name)} ${escapeHtml(c.last_name)}</div>
                <div class="detail">${escapeHtml(c.id || '')}${c.email ? ' · ' + escapeHtml(c.email) : ''}${c.company ? ' · ' + escapeHtml(c.company) : ''}</div>
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

function openContactEdit(contact) {
    document.getElementById('contact-edit-title').textContent = contact ? 'Edit Contact' : 'Add Contact';
    const idField = document.getElementById('contact-edit-id');
    idField.value = contact ? contact.id : '';
    idField.dataset.existing = contact ? contact.id : '';
    document.getElementById('contact-first-name').value = contact ? contact.first_name : '';
    document.getElementById('contact-last-name').value = contact ? contact.last_name : '';
    document.getElementById('contact-email').value = contact ? contact.email : '';
    document.getElementById('contact-company').value = contact ? contact.company : '';
    document.getElementById('contact-template').value = contact ? contact.template : defaultContactTemplate;
    showModal('contact-edit-modal');
    setTimeout(() => document.getElementById('contact-first-name').focus(), 0);
}

async function saveContactFromModal() {
    const existingId = document.getElementById('contact-edit-id').dataset.existing;
    const newId = document.getElementById('contact-edit-id').value.trim();
    const data = {
        id: newId || undefined,
        first_name: document.getElementById('contact-first-name').value.trim(),
        last_name: document.getElementById('contact-last-name').value.trim(),
        email: document.getElementById('contact-email').value.trim(),
        company: document.getElementById('contact-company').value.trim(),
        template: document.getElementById('contact-template').value.trim() || defaultContactTemplate
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
    showNotification(id ? 'Contact updated' : 'Contact added');
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
        let tpl = contact.template || '[{{first_name}} {{last_name}}](mailto:{{email}})';
        tpl = tpl.replace(/\{\{first_name\}\}/g, contact.first_name || '');
        tpl = tpl.replace(/\{\{last_name\}\}/g, contact.last_name || '');
        tpl = tpl.replace(/\{\{email\}\}/g, contact.email || '');
        tpl = tpl.replace(/\{\{company\}\}/g, contact.company || '');
        tpl = tpl.replace(/\{\{id\}\}/g, contact.id || '');

        const text = editor.value;
        const before = text.substring(0, mentionStart);
        const after = text.substring(editor.selectionStart);
        editor.value = before + tpl + after;
        const newPos = before.length + tpl.length;
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
                const full = ((c.first_name || '') + ' ' + (c.last_name || '') + ' ' + (c.email || '') + ' ' + (c.company || '')).toLowerCase();
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
        const link = `[[${note.title}]]`;
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
        loadTree();
        loadNote(result.path);
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
        loadNote(result.path);
        showNotification('Daily note created');
    }
}

// Create meeting note using 'meeting' template
async function createMeetingNote() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const datestamp = `${yyyy}-${mm}${dd} ${hh}${min}`;
    const name = prompt('Meeting name:', '');
    if (name === null) return; // cancelled
    const meetingName = name.trim();
    // Title in frontmatter is just the meeting name (or "Meeting" if blank)
    const title = meetingName || 'Meeting';
    // Filename: meeting-YYYY-MMDD HHMM-slugified-name
    const nameSlug = meetingName ? '-' + meetingName.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/[\s]+/g, '-') : '';
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
    select.innerHTML = '<option value="">All Tags</option>';
    
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

function handleEditorScrollSync() {
    if (previewMode === 'split') {
        const editor = document.getElementById('editor');
        const preview = document.getElementById('preview');
        const maxEditor = Math.max(1, editor.scrollHeight - editor.clientHeight);
        lastEditorScrollRatio = editor.scrollTop / maxEditor;
        const maxPrev = Math.max(1, preview.scrollHeight - preview.clientHeight);
        suppressPreviewScroll = true;
        preview.scrollTop = lastEditorScrollRatio * maxPrev;
        // small timeout to avoid feedback loops if we later add reverse sync
        setTimeout(() => suppressPreviewScroll = false, 10);
    }
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
        
        // After rendering, if in split mode, preserve approximate scroll position
        if (previewMode === 'split') {
            const maxPrev = Math.max(1, preview.scrollHeight - preview.clientHeight);
            preview.scrollTop = lastEditorScrollRatio * maxPrev;
        }
    } catch (error) {
        preview.innerHTML = '<div style="padding: 20px; color: #ff6b6b; background: #2d2d30; border-radius: 4px;">⚠️ Error rendering markdown:<br>' + error.message + '</div>';
        console.error('Preview render error:', error);
    }
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
    
    // Delete button
    document.getElementById('delete-btn').addEventListener('click', deleteNote);
    
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
    document.getElementById('fullscreen-toggle').addEventListener('click', toggleFullscreen);
    
    // Sidebar collapse toggle
    document.getElementById('sidebar-collapse').addEventListener('click', toggleSidebar);
    document.getElementById('sidebar-expand').addEventListener('click', toggleSidebar);
    
    // Mobile menu (header + floating)
    document.getElementById('mobile-menu-btn').addEventListener('click', toggleMobileMenu);
    const fab = document.getElementById('mobile-menu-fab');
    if (fab) fab.addEventListener('click', toggleMobileMenu);
    
    // Hide floating button when sidebar is open
    const sidebar = document.querySelector('.sidebar');
    const updateFab = () => {
        if (!fab) return;
        const isOpen = sidebar.classList.contains('mobile-open');
        fab.style.display = (window.innerWidth <= 768 && !isOpen) ? 'inline-flex' : 'none';
    };
    updateFab();
    
    // Recompute on resize/focus/blur (iOS virtual keyboard changes viewport)
    ['resize','focus','blur'].forEach(ev => window.addEventListener(ev, updateFab));
    
    // Close mobile menu when clicking outside sidebar
    document.addEventListener('click', (e) => {
        const sidebar = document.querySelector('.sidebar');
        const mobileMenuBtn = document.getElementById('mobile-menu-btn');
        const fabBtn = document.getElementById('mobile-menu-fab');
        
        const clickOnMenuBtn = (btn) => btn && (e.target === btn || btn.contains(e.target));
        
        if (window.innerWidth <= 768 && 
            sidebar.classList.contains('mobile-open') &&
            !sidebar.contains(e.target) && 
            !clickOnMenuBtn(mobileMenuBtn) &&
            !clickOnMenuBtn(fabBtn)) {
            closeMobileMenu();
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
    document.getElementById('delete-vault').addEventListener('click', deleteCurrentVault);
    document.getElementById('export-vault').addEventListener('click', () => {
        window.location.href = '/api/vaults/export';
    });

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
    document.getElementById('share-print').addEventListener('click', shareViaPrint);
    document.getElementById('share-email').addEventListener('click', shareViaEmail);
    document.getElementById('share-copy').addEventListener('click', shareViaCopyMarkdown);
    document.getElementById('share-copy-html').addEventListener('click', shareViaCopyHtml);

    // Contacts
    document.getElementById('contacts-btn').addEventListener('click', openContactsModal);
    document.getElementById('close-contacts-btn').addEventListener('click', () => hideModal('contacts-modal'));
    document.getElementById('add-contact-btn').addEventListener('click', () => openContactEdit(null));
    document.getElementById('import-contacts-btn').addEventListener('click', importContactsPrompt);
    document.getElementById('save-contact-btn').addEventListener('click', saveContactFromModal);
    document.getElementById('cancel-contact-btn').addEventListener('click', () => hideModal('contact-edit-modal'));

    // @ mention autocomplete
    setupMentionAutocomplete();
    setupLinkAutocomplete();

    // Frontmatter preview (read-only)
    document.getElementById('frontmatter-preview').addEventListener('click', openFrontmatterPreview);
    document.getElementById('close-frontmatter-btn').addEventListener('click', () => hideModal('frontmatter-modal'));
    
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
    document.getElementById('meeting-note').addEventListener('click', createMeetingNote);
    
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
    
    // Cancel folder modal
    document.getElementById('cancel-folder-btn').addEventListener('click', () => {
        hideModal('new-folder-modal');
    });
    
    // Search
    document.getElementById('search-btn').addEventListener('click', () => {
        const query = document.getElementById('search-input').value;
        if (query) {
            searchNotes(query, '');
            document.getElementById('clear-search-btn').style.display = 'block';
        }
    });
    
    document.getElementById('search-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const query = document.getElementById('search-input').value;
            if (query) {
                searchNotes(query, '');
                document.getElementById('clear-search-btn').style.display = 'block';
            }
        }
    });
    
    // Clear search button
    document.getElementById('clear-search-btn').addEventListener('click', () => {
        document.getElementById('search-input').value = '';
        document.getElementById('clear-search-btn').style.display = 'none';
        document.getElementById('tag-filter').value = '';
        loadTree();
    });
    
    // Show clear button as user types
    document.getElementById('search-input').addEventListener('input', (e) => {
        if (e.target.value === '') {
            document.getElementById('clear-search-btn').style.display = 'none';
            loadTree();
        } else {
            document.getElementById('clear-search-btn').style.display = 'block';
        }
    });
    
    // Tag filter
    document.getElementById('tag-filter').addEventListener('change', (e) => {
        const tag = e.target.value;
        if (tag) {
            searchNotes('', tag);
            document.getElementById('clear-search-btn').style.display = 'block';
        } else {
            document.getElementById('clear-search-btn').style.display = 'none';
            loadTree();
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
    e.target.closest('.tree-folder').classList.add('drag-over');
    return false;
}

function handleDragLeave(e) {
    e.target.closest('.tree-folder').classList.remove('drag-over');
}

async function handleDrop(e) {
    if (e.stopPropagation) {
        e.stopPropagation();
    }
    e.preventDefault();
    
    const targetFolder = e.target.closest('.tree-folder');
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

// Notification helper - toast notification
function showNotification(message) {
    const existing = document.querySelector('.toast-notification');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 2000);
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
async function deleteNote() {
    if (!currentNote) return;
    
    if (!confirm('Are you sure you want to delete this note?')) return;
    
    const toRemove = currentNote; // capture before clearing
    const response = await fetch(`/api/note/${toRemove}`, {
        method: 'DELETE'
    });
    
    if (response.ok) {
        showNotification('Note deleted');
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
        document.getElementById('delete-btn').disabled = true;
        document.getElementById('rename-btn').disabled = true;
        document.getElementById('share-btn').disabled = true;
        document.getElementById('frontmatter-preview').disabled = true;
        loadTree();
        removeFromRecent(toRemove);
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
}

// Rename note
async function renameNote() {
    if (!currentNote) return;
    
    const newName = prompt('Enter new note name:', document.getElementById('note-title').textContent);
    if (!newName) return;
    
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
    const response = await fetch(`/api/search?q=${encodeURIComponent(noteName)}`);
    const results = await response.json();
    
    // Prefer exact title match
    const exact = results.find(r => r.title.toLowerCase() === noteName.toLowerCase());
    if (exact) {
        loadNote(exact.path);
    } else if (results.length > 0) {
        // Try filename match (stem without extension)
        const byFilename = results.find(r => {
            const stem = r.path.split('/').pop().replace('.md', '');
            return stem.toLowerCase() === noteName.toLowerCase().replace(/\s+/g, '-');
        });
        loadNote(byFilename ? byFilename.path : results[0].path);
    } else {
        showNotification(`Note "${noteName}" not found`);
    }
}

// Theme toggle
function toggleTheme() {
    document.body.classList.toggle('light-theme');
    const isLight = document.body.classList.contains('light-theme');
    localStorage.setItem('grove-theme', isLight ? 'light' : 'dark');
    
    const icon = document.querySelector('#theme-toggle i');
    icon.className = isLight ? 'fas fa-sun' : 'fas fa-moon';
}

function loadTheme() {
    const theme = localStorage.getItem('grove-theme') || 'dark';
    if (theme === 'light') {
        document.body.classList.add('light-theme');
        document.querySelector('#theme-toggle i').className = 'fas fa-sun';
    }
}

// Full-screen toggle
function toggleFullscreen() {
    document.body.classList.toggle('fullscreen');
    const icon = document.querySelector('#fullscreen-toggle i');
    const isFullscreen = document.body.classList.contains('fullscreen');
    icon.className = isFullscreen ? 'fas fa-compress' : 'fas fa-expand';
}

function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const collapseIcon = document.querySelector('#sidebar-collapse i');
    const expandBtn = document.getElementById('sidebar-expand');
    const isCollapsed = sidebar.classList.toggle('collapsed');
    if (collapseIcon) {
        collapseIcon.className = isCollapsed ? 'fas fa-chevron-right' : 'fas fa-chevron-left';
    }
    expandBtn.style.display = isCollapsed ? 'flex' : 'none';
}

function toggleMobileMenu() {
    const sidebar = document.querySelector('.sidebar');
    sidebar.classList.toggle('mobile-open');
    // Update FAB visibility
    const fab = document.getElementById('mobile-menu-fab');
    if (fab && window.innerWidth <= 768) {
        fab.style.display = sidebar.classList.contains('mobile-open') ? 'none' : 'inline-flex';
    }
}

function closeMobileMenu() {
    const sidebar = document.querySelector('.sidebar');
    sidebar.classList.remove('mobile-open');
    const fab = document.getElementById('mobile-menu-fab');
    if (fab && window.innerWidth <= 768) fab.style.display = 'inline-flex';
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
            before = getLinePrefix(text, start) + '- '; after = '';
            insert = selected || 'list item';
            break;
        case 'ol':
            before = getLinePrefix(text, start) + '1. '; after = '';
            insert = selected || 'list item';
            break;
        case 'checkbox':
            // Insert with leading dash; preview will hide bullets for task items
            before = getLinePrefix(text, start) + '- [ ] '; after = '';
            insert = selected || 'task';
            break;
        case 'link':
            if (selected) {
                before = '['; after = '](url)';
                insert = selected;
            } else {
                insert = '[link text](url)';
            }
            break;
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

// Get prefix needed to start at beginning of current line
function getLinePrefix(text, pos) {
    const lineStart = text.lastIndexOf('\n', pos - 1);
    const currentPos = pos;
    
    // If we're at the start of a line already, just return empty
    if (lineStart === pos - 1 || pos === 0) return '';
    
    // Otherwise add a newline to start fresh
    return '\n';
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
        
        // Ctrl+K or Cmd+K - Focus search
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            document.getElementById('search-input').focus();
        }
        
        // Ctrl+M - New meeting note
        if ((e.ctrlKey || e.metaKey) && e.key === 'm') {
            e.preventDefault();
            createMeetingNote();
        }
        
        // Ctrl+D - New daily note
        if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
            e.preventDefault();
            createDailyNote();
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

