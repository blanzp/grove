// MDVault Web - Frontend JavaScript

let currentNote = null;
let currentFolder = '';
let previewMode = 'edit'; // 'edit', 'split', 'preview'
let autoSaveTimeout = null;
let recentFiles = JSON.parse(localStorage.getItem('mdvault-recent') || '[]');

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    loadTree();
    loadTags();
    loadTemplates();
    loadRecentFiles();
    setupEventListeners();
    setupDragAndDrop();
    setupTreeDragAndDrop();
    setupKeyboardShortcuts();
    loadTheme();
});

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
                
                // Move to root
                const response = await fetch('/api/move', {
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
                    
                    if (currentNote === sourcePath) {
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
            
            // Make folders drop targets
            itemDiv.addEventListener('dragover', handleDragOver);
            itemDiv.addEventListener('dragleave', handleDragLeave);
            itemDiv.addEventListener('drop', handleDrop);
        } else {
            itemDiv.innerHTML = `<i class="fas fa-file-alt"></i> ${item.name}`;
            itemDiv.setAttribute('draggable', 'true');
            itemDiv.addEventListener('click', () => loadNote(item.path));
            
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
async function loadNote(path) {
    const response = await fetch(`/api/note/${path}`);
    const note = await response.json();
    
    currentNote = path;
    
    // Reset preview mode
    previewMode = 'edit';
    const editorContainer = document.getElementById('drop-zone');
    editorContainer.classList.remove('split-view', 'preview-only');
    document.getElementById('preview-toggle').innerHTML = '<i class="fas fa-eye"></i> Preview';
    
    document.getElementById('note-title').value = note.title;
    document.getElementById('note-title').disabled = false;
    document.getElementById('tags-input').value = note.tags.join(', ');
    document.getElementById('tags-input').disabled = false;
    document.getElementById('editor').value = note.content;
    document.getElementById('editor').disabled = false;
    document.getElementById('preview-toggle').disabled = false;
    document.getElementById('delete-btn').disabled = false;
    document.getElementById('rename-btn').disabled = false;
    
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

// Save current note (keep for compatibility, redirect to new function)
async function saveNote(isAutoSave = false) {
    return saveNoteUpdated(isAutoSave);
}

// Create new note
async function createNote(title, tags, folder, template) {
    const response = await fetch('/api/note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, tags, folder, template })
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
    
    // Cycle through modes: edit -> split -> preview -> edit
    if (previewMode === 'edit') {
        previewMode = 'split';
        editorContainer.classList.add('split-view');
        previewBtn.innerHTML = '<i class="fas fa-columns"></i> Split';
    } else if (previewMode === 'split') {
        previewMode = 'preview';
        editorContainer.classList.remove('split-view');
        editorContainer.classList.add('preview-only');
        previewBtn.innerHTML = '<i class="fas fa-edit"></i> Edit';
    } else {
        previewMode = 'edit';
        editorContainer.classList.remove('preview-only');
        previewBtn.innerHTML = '<i class="fas fa-eye"></i> Preview';
    }
    
    // Render markdown in preview
    if (previewMode !== 'edit') {
        renderPreview();
    }
}

// Render markdown preview
function renderPreview() {
    let content = document.getElementById('editor').value;
    const preview = document.getElementById('preview');
    
    // Strip frontmatter (YAML between --- markers)
    content = content.replace(/^---\n.*?\n---\n/s, '');
    
    try {
        // Handle both old and new marked.js API
        if (typeof marked === 'function') {
            const html = marked(content);
            preview.innerHTML = html;
        } else if (typeof marked === 'object' && typeof marked.parse === 'function') {
            const html = marked.parse(content);
            preview.innerHTML = html;
        } else {
            preview.innerHTML = '<div style="padding: 20px; color: #ff6b6b; background: #2d2d30; border-radius: 4px;">⚠️ Markdown library not loaded properly</div>';
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
    document.getElementById('editor').addEventListener('input', () => {
        if (previewMode !== 'edit') {
            renderPreview();
        }
    });
    
    // Delete button
    document.getElementById('delete-btn').addEventListener('click', deleteNote);
    
    // Rename button
    document.getElementById('rename-btn').addEventListener('click', renameNote);
    
    // Theme toggle
    document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
    
    // Full-screen toggle
    document.getElementById('fullscreen-toggle').addEventListener('click', toggleFullscreen);
    
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
    
    // Create note modal
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
        searchNotes(query, '');
    });
    
    document.getElementById('search-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const query = document.getElementById('search-input').value;
            searchNotes(query, '');
        }
    });
    
    // Clear search and reload tree
    document.getElementById('search-input').addEventListener('input', (e) => {
        if (e.target.value === '') {
            loadTree();
        }
    });
    
    // Tag filter
    document.getElementById('tag-filter').addEventListener('change', (e) => {
        const tag = e.target.value;
        if (tag) {
            searchNotes('', tag);
        } else {
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
        const targetPath = targetFolder.dataset.path;
        
        // Move the file
        const response = await fetch('/api/move', {
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
            if (currentNote === sourcePath) {
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

// Notification helper
function showNotification(message) {
    // Simple console notification for now
    console.log(message);
    // Could add a toast notification system here
}

// Auto-save functionality
function setupAutoSave() {
    document.getElementById('editor').addEventListener('input', () => {
        setSaveStatus('saving');
        
        if (autoSaveTimeout) {
            clearTimeout(autoSaveTimeout);
        }
        
        autoSaveTimeout = setTimeout(() => {
            saveNote(true);
        }, 2000); // Auto-save after 2 seconds of inactivity
    });
}

function setSaveStatus(status) {
    const statusEl = document.getElementById('save-status');
    if (status === 'saving') {
        statusEl.textContent = 'Saving...';
        statusEl.className = 'save-status saving';
    } else if (status === 'saved') {
        statusEl.textContent = 'Saved';
        statusEl.className = 'save-status saved';
        setTimeout(() => {
            statusEl.textContent = '';
        }, 2000);
    }
}

// Update save function to support auto-save
async function saveNoteUpdated(isAutoSave = false) {
    if (!currentNote) return;
    
    const content = document.getElementById('editor').value;
    
    if (!isAutoSave) {
        setSaveStatus('saving');
    }
    
    const response = await fetch(`/api/note/${currentNote}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
    });
    
    if (response.ok) {
        setSaveStatus('saved');
        if (!isAutoSave) {
            showNotification('Note saved');
        }
    }
}

// Delete note
async function deleteNote() {
    if (!currentNote) return;
    
    if (!confirm('Are you sure you want to delete this note?')) return;
    
    const response = await fetch(`/api/note/${currentNote}`, {
        method: 'DELETE'
    });
    
    if (response.ok) {
        showNotification('Note deleted');
        currentNote = null;
        document.getElementById('note-title').value = '';
        document.getElementById('note-title').disabled = true;
        document.getElementById('tags-input').value = '';
        document.getElementById('tags-input').disabled = true;
        document.getElementById('editor').value = '';
        document.getElementById('editor').disabled = true;
        document.getElementById('save-btn').disabled = true;
        document.getElementById('preview-toggle').disabled = true;
        document.getElementById('delete-btn').disabled = true;
        document.getElementById('rename-btn').disabled = true;
        loadTree();
        removeFromRecent(currentNote);
    }
}

// Rename note
async function renameNote() {
    if (!currentNote) return;
    
    const newName = prompt('Enter new note name:', document.getElementById('note-title').value);
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
        document.getElementById('note-title').value = newName;
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
    recentFiles = recentFiles.slice(0, 10);
    
    localStorage.setItem('mdvault-recent', JSON.stringify(recentFiles));
    loadRecentFiles();
}

function removeFromRecent(path) {
    recentFiles = recentFiles.filter(f => f.path !== path);
    localStorage.setItem('mdvault-recent', JSON.stringify(recentFiles));
    loadRecentFiles();
}

function updateRecentFile(path, title) {
    const file = recentFiles.find(f => f.path === path);
    if (file) {
        file.title = title;
        localStorage.setItem('mdvault-recent', JSON.stringify(recentFiles));
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
        item.addEventListener('click', () => loadNote(file.path));
        container.appendChild(item);
    });
}

// Breadcrumbs
function updateBreadcrumbs() {
    const breadcrumbs = document.getElementById('breadcrumbs');
    if (!currentNote) {
        breadcrumbs.innerHTML = '<span class="save-status" id="save-status"></span>';
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
}

// Clickable wikilinks in preview
function makeWikilinksClickable() {
    const preview = document.getElementById('preview');
    const content = preview.innerHTML;
    
    // Replace [[note-name]] with clickable links
    const withLinks = content.replace(/\[\[([^\]]+)\]\]/g, (match, noteName) => {
        return `<a href="#" class="wikilink" data-note="${noteName}">${noteName}</a>`;
    });
    
    preview.innerHTML = withLinks;
    
    // Add click handlers
    preview.querySelectorAll('.wikilink').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const noteName = e.target.dataset.note;
            // Try to find and load the note
            searchAndLoadNote(noteName);
        });
    });
}

async function searchAndLoadNote(noteName) {
    const response = await fetch(`/api/search?q=${encodeURIComponent(noteName)}`);
    const results = await response.json();
    
    if (results.length > 0) {
        loadNote(results[0].path);
    } else {
        showNotification(`Note "${noteName}" not found`);
    }
}

// Theme toggle
function toggleTheme() {
    document.body.classList.toggle('light-theme');
    const isLight = document.body.classList.contains('light-theme');
    localStorage.setItem('mdvault-theme', isLight ? 'light' : 'dark');
    
    const icon = document.querySelector('#theme-toggle i');
    icon.className = isLight ? 'fas fa-sun' : 'fas fa-moon';
}

function loadTheme() {
    const theme = localStorage.getItem('mdvault-theme') || 'dark';
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

// Keyboard shortcuts
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Ctrl+S or Cmd+S - Save
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            saveNoteUpdated();
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
        
        // Ctrl+K or Cmd+K - Focus search
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            document.getElementById('search-input').focus();
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
    });
}

// Update render preview to make wikilinks clickable
const originalRenderPreview = renderPreview;
renderPreview = function() {
    originalRenderPreview();
    makeWikilinksClickable();
};
