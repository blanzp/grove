// MDVault Web - Frontend JavaScript

let currentNote = null;
let currentFolder = '';
let previewMode = 'edit'; // 'edit', 'split', 'preview'

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    loadTree();
    loadTags();
    loadTemplates();
    setupEventListeners();
    setupDragAndDrop();
});

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
        
        if (item.type === 'folder') {
            itemDiv.classList.add('tree-folder');
            itemDiv.innerHTML = `<i class="fas fa-folder"></i> ${item.name}`;
            itemDiv.addEventListener('click', (e) => {
                e.stopPropagation();
                currentFolder = item.path;
                // Show children
                if (item.children && item.children.length > 0) {
                    const childContainer = document.createElement('div');
                    childContainer.className = 'tree-children';
                    renderTree(item.children, childContainer, level + 1);
                    itemDiv.after(childContainer);
                }
            });
        } else {
            itemDiv.innerHTML = `<i class="fas fa-file-alt"></i> ${item.name}`;
            itemDiv.addEventListener('click', () => loadNote(item.path));
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
    document.getElementById('save-btn').disabled = false;
    document.getElementById('preview-toggle').disabled = false;
    
    // Highlight active note
    document.querySelectorAll('.tree-item').forEach(item => {
        item.classList.remove('active');
        if (item.textContent.trim().replace(/^\s*[\w-]+\s*/, '') === note.title) {
            item.classList.add('active');
        }
    });
}

// Save current note
async function saveNote() {
    if (!currentNote) return;
    
    const content = document.getElementById('editor').value;
    
    const response = await fetch(`/api/note/${currentNote}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
    });
    
    if (response.ok) {
        showNotification('Note saved successfully');
    }
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
    const content = document.getElementById('editor').value;
    const preview = document.getElementById('preview');
    preview.innerHTML = marked.parse(content);
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
    
    // Save button
    document.getElementById('save-btn').addEventListener('click', saveNote);
    
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
