"""MDVault Web - Markdown vault manager web application."""

from flask import Flask, render_template, request, jsonify, send_file
from pathlib import Path
import os
import json
import re
import uuid
from datetime import datetime

app = Flask(__name__)

CONFIG_DIR = Path(__file__).parent / ".grove"
CONFIG_DIR.mkdir(exist_ok=True)
CONFIG_PATH = CONFIG_DIR / "config.json"

# Vault resolution
VAULTS_ROOT = Path(__file__).parent / "vaults"
VAULTS_ROOT.mkdir(exist_ok=True)

DEFAULT_VAULT_PATH = Path(__file__).parent / "vault"  # legacy single-vault path
DEFAULT_VAULT_PATH.mkdir(exist_ok=True)


def get_active_vault_path():
    """Return the Path to the active vault directory."""
    if CONFIG_PATH.exists():
        try:
            cfg = json.loads(CONFIG_PATH.read_text() or '{}')
            name = cfg.get('active_vault', 'vault')
        except Exception:
            name = 'vault'
    else:
        name = 'vault'
    if name == 'vault':
        return DEFAULT_VAULT_PATH
    return VAULTS_ROOT / name

# Initialize globals, refreshed on each request as well
VAULT_PATH = get_active_vault_path()
VAULT_PATH.mkdir(exist_ok=True)
TEMPLATES_PATH = VAULT_PATH / ".templates"
TEMPLATES_PATH.mkdir(exist_ok=True)

@app.before_request
def _refresh_active_vault():
    global VAULT_PATH, TEMPLATES_PATH
    VAULT_PATH = get_active_vault_path()
    VAULT_PATH.mkdir(exist_ok=True)
    TEMPLATES_PATH = VAULT_PATH / ".templates"
    TEMPLATES_PATH.mkdir(exist_ok=True)


def get_vault_structure(base_path=None):
    """Get the vault directory structure as a tree."""
    if base_path is None:
        base_path = VAULT_PATH
    
    structure = []
    
    try:
        items = sorted(base_path.iterdir(), key=lambda x: (not x.is_dir(), x.name))
        for item in items:
            if item.name.startswith('.'):
                continue
            
            if item.is_dir():
                structure.append({
                    'name': item.name,
                    'path': str(item.relative_to(VAULT_PATH)),
                    'type': 'folder',
                    'children': get_vault_structure(item)
                })
            elif item.suffix == '.md':
                structure.append({
                    'name': item.stem,
                    'path': str(item.relative_to(VAULT_PATH)),
                    'type': 'file'
                })
            elif item.is_file():
                structure.append({
                    'name': item.name,
                    'path': str(item.relative_to(VAULT_PATH)),
                    'type': 'asset'
                })
    except PermissionError:
        pass
    
    return structure


def extract_frontmatter(content):
    """Extract YAML frontmatter from markdown content."""
    fm_match = re.match(r'^---\n(.*?)\n---\n(.*)', content, re.DOTALL)
    if not fm_match:
        return {}, content
    
    fm_text = fm_match.group(1)
    body = fm_match.group(2)
    
    frontmatter = {}
    
    title_match = re.search(r'title:\s*(.+)', fm_text)
    if title_match:
        frontmatter['title'] = title_match.group(1).strip()
    
    # Try YAML array format first (tags:\n  - tag1\n  - tag2)
    tags_match = re.search(r'tags:\s*\n((?:\s*-\s*.+\n?)+)', fm_text)
    if tags_match:
        frontmatter['tags'] = [t.strip('- ').strip() for t in tags_match.group(1).split('\n') if t.strip()]
    else:
        # Try comma-separated format (tags: tag1, tag2)
        tags_match = re.search(r'tags:\s*([^\n]+)', fm_text)
        if tags_match:
            tags_str = tags_match.group(1).strip()
            frontmatter['tags'] = [t.strip() for t in tags_str.split(',') if t.strip()]
        else:
            frontmatter['tags'] = []
    
    return frontmatter, body


def build_frontmatter(title, tags, doc_type=None):
    """Build YAML frontmatter."""
    fm = "---\n"
    fm += f"title: {title}\n"
    fm += f"created: {datetime.now().isoformat()}\n"
    if doc_type:
        fm += f"type: {doc_type}\n"
    if tags:
        fm += "tags:\n"
        for tag in tags:
            fm += f"  - {tag}\n"
    fm += "---\n\n"
    return fm


@app.route('/')
def index():
    """Render the main application."""
    return render_template('index.html')


@app.route('/api/tree')
def get_tree():
    """Get the vault directory tree."""
    return jsonify(get_vault_structure())

# Vault management APIs
@app.route('/api/vaults', methods=['GET'])
def list_vaults():
    """List available vaults and the active one."""
    active = str(VAULT_PATH)
    # names include legacy 'vault' plus folders under vaults/
    names = ['vault'] + [p.name for p in VAULTS_ROOT.iterdir() if p.is_dir()]
    return jsonify({
        'active': 'vault' if VAULT_PATH == DEFAULT_VAULT_PATH else (VAULT_PATH.name),
        'vaults': sorted(list(set(names)))
    })

@app.route('/api/vaults/create', methods=['POST'])
def create_vault():
    data = request.json or {}
    name = data.get('name', '').strip()
    if not name:
        return jsonify({'error': 'name required'}), 400
    if name == 'vault':
        path = DEFAULT_VAULT_PATH
    else:
        path = VAULTS_ROOT / name
    if path.exists():
        return jsonify({'error': 'vault already exists'}), 400
    path.mkdir(parents=True, exist_ok=True)
    tpl_dir = path / '.templates'
    tpl_dir.mkdir(exist_ok=True)
    # Copy standard templates from default vault
    src_tpl = DEFAULT_VAULT_PATH / '.templates'
    if src_tpl.exists():
        for tpl_file in src_tpl.iterdir():
            if tpl_file.is_file() and tpl_file.suffix == '.md':
                (tpl_dir / tpl_file.name).write_text(tpl_file.read_text())
    # Seed with a welcome README
    readme = path / 'README.md'
    readme.write_text(f"""---
title: Welcome to {name}
created: {datetime.now().isoformat()}
type: note
tags:
  - grove
---

# Welcome to your "{name}" vault 🌲

This is your new Grove vault. Here's a quick guide to get started.

## Creating Notes

- Click the **📄 New Note** button in the sidebar toolbar
- Choose a title, optional tags, and a template
- Or click **📅 Daily Note** for a quick daily log

## Templates

Grove ships with standard templates. Click the **📋 Templates** button to manage them.

| Template | Type | Use for |
|----------|------|---------|
| meeting | Meeting notes | Attendees, agenda, action items |
| decision | Decision records | Context, options, rationale |
| research | Research notes | Hypothesis, findings, references |
| reflection | Reflections | What happened, lessons learned |
| daily | Daily logs | Notes, tasks, links |

Templates are **body-only** — Grove manages all frontmatter automatically.

## Document Types

Every note gets a `type` in its frontmatter:
- **note** — default when no template is used
- **meeting, decision, research, reflection** — matches the template
- **daily** — for daily notes

View frontmatter with the **📜 Frontmatter Preview** button (read-only).

## Contacts & @ Mentions

Click the **📒 Contacts** button to add people. Then type `@` in any note to search and insert a contact link.

Each contact has a configurable template (e.g., `http://phone.google.com/{{{{id}}}}`) with placeholders: `{{{{id}}}}`, `{{{{first_name}}}}`, `{{{{last_name}}}}`, `{{{{email}}}}`, `{{{{company}}}}`.

## Images & Attachments

- **Paste** an image from clipboard (Ctrl+V) — auto-uploads to `attachments/`
- **Upload** via the image toolbar button
- **Reference**: `![alt text](/api/file/attachments/photo.png)`
- Click any image in the file tree to copy its markdown reference

## Sharing

Click the **📤 Share** button to:
- Print / Save as PDF
- Email the note
- Copy as Markdown or HTML

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+S` | Save |
| `Ctrl+N` | New note |
| `Ctrl+P` | Toggle preview |
| `Ctrl+K` | Search |
| `Ctrl+B` | Bold |
| `Ctrl+I` | Italic |
| `Ctrl+L` | Link |
| `Ctrl+V` | Paste image |
| `F2` | Rename |
| `F11` | Fullscreen |
| `@` | Contact autocomplete |

## Tips

- **Tags** — use the 🏷️ button to tag notes for filtering
- **Todos** — use `- [ ] task` for checkboxes, view all in the ✅ Todo Dashboard
- **Wikilinks** — use `[[Note Name]]` to link between notes
- **Search** — Ctrl+K to search by title or content

Happy writing! 🌿
""")
    return jsonify({'success': True})

@app.route('/api/vaults/export')
def export_vault():
    """Export the active vault as a ZIP file."""
    import zipfile
    import io
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        for f in VAULT_PATH.rglob('*'):
            if f.is_file():
                arcname = str(f.relative_to(VAULT_PATH))
                zf.write(f, arcname)
    buf.seek(0)
    vault_name = 'vault' if VAULT_PATH == DEFAULT_VAULT_PATH else VAULT_PATH.name
    return send_file(buf, mimetype='application/zip', as_attachment=True,
                     download_name=f'grove-{vault_name}-{datetime.now().strftime("%Y%m%d")}.zip')

@app.route('/api/vaults/delete', methods=['POST'])
def delete_vault():
    import shutil
    data = request.json or {}
    name = data.get('name')
    if not name:
        return jsonify({'error': 'name required'}), 400
    if name == 'vault':
        return jsonify({'error': 'Cannot delete default vault'}), 400
    path = VAULTS_ROOT / name
    if not path.exists():
        return jsonify({'error': 'Vault not found'}), 404
    shutil.rmtree(path)
    # If we just deleted the active vault, switch back to default
    cfg = {}
    if CONFIG_PATH.exists():
        try:
            cfg = json.loads(CONFIG_PATH.read_text() or '{}')
        except Exception:
            pass
    if cfg.get('active_vault') == name:
        cfg['active_vault'] = 'vault'
        CONFIG_PATH.write_text(json.dumps(cfg))
    return jsonify({'success': True})

@app.route('/api/vaults/switch', methods=['POST'])
def switch_vault():
    data = request.json or {}
    name = data.get('name')
    if not name:
        return jsonify({'error': 'name required'}), 400
    if name == 'vault':
        path = DEFAULT_VAULT_PATH
    else:
        path = VAULTS_ROOT / name
    if not path.exists():
        return jsonify({'error': 'vault not found'}), 404
    # write config
    cfg = {'active_vault': name}
    CONFIG_PATH.write_text(json.dumps(cfg))
    return jsonify({'success': True})


@app.route('/api/note/<path:note_path>')
def get_note(note_path):
    """Get a note's content."""
    file_path = VAULT_PATH / note_path
    
    if not file_path.exists() or not file_path.suffix == '.md':
        return jsonify({'error': 'Note not found'}), 404
    
    content = file_path.read_text()
    fm, body = extract_frontmatter(content)
    
    return jsonify({
        'path': note_path,
        'title': fm.get('title', file_path.stem),
        'tags': fm.get('tags', []),
        'content': content,
        'body': body
    })


@app.route('/api/note/<path:note_path>', methods=['PUT'])
def save_note(note_path):
    """Save a note's content. Frontmatter is preserved/managed; auto-add slug ids to H2/H3."""
    data = request.json
    content = data.get('content', '')

    file_path = VAULT_PATH / note_path
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(content)
    
    return jsonify({'success': True, 'path': note_path})


@app.route('/api/note/<path:note_path>/tags', methods=['PUT'])
def update_note_tags(note_path):
    """Update a note's tags."""
    data = request.json
    tags = data.get('tags', [])
    
    file_path = VAULT_PATH / note_path
    if not file_path.exists():
        return jsonify({'success': False, 'error': 'Note not found'}), 404
    
    content = file_path.read_text()
    
    # Update or add frontmatter
    if content.startswith('---'):
        # Parse existing frontmatter
        parts = content.split('---', 2)
        if len(parts) >= 3:
            frontmatter = parts[1]
            body = parts[2]
            
            # Remove old tags (both single-line and YAML array format)
            lines = frontmatter.split('\n')
            new_lines = []
            skip_next = False
            
            for i, line in enumerate(lines):
                # Skip lines that are part of tags array
                if skip_next and line.strip().startswith('-'):
                    continue
                else:
                    skip_next = False
                
                # Check if this is the tags: line
                if line.strip().startswith('tags:'):
                    # Check if it's array format (next line starts with -)
                    if i + 1 < len(lines) and lines[i + 1].strip().startswith('-'):
                        skip_next = True
                    # Skip this line either way
                    continue
                
                new_lines.append(line)
            
            # Add new tags in YAML array format
            if tags:
                # Find where to insert (after title/created, skip empty lines)
                insert_idx = 1  # Start after first newline
                for i in range(1, len(new_lines)):
                    line = new_lines[i].strip()
                    if line.startswith('created:'):
                        insert_idx = i + 1
                        break
                    elif line.startswith('title:'):
                        insert_idx = i + 1
                
                new_lines.insert(insert_idx, 'tags:')
                for j, tag in enumerate(tags):
                    new_lines.insert(insert_idx + 1 + j, f'  - {tag}')
            
            # Ensure frontmatter ends with newline
            frontmatter_content = '\n'.join(new_lines)
            if not frontmatter_content.endswith('\n'):
                frontmatter_content += '\n'
            
            content = f"---{frontmatter_content}---{body}"
    else:
        # Add frontmatter
        if tags:
            frontmatter = "---\ntags:\n"
            for tag in tags:
                frontmatter += f"  - {tag}\n"
            frontmatter += "---\n"
            content = frontmatter + content
    
    file_path.write_text(content)
    return jsonify({'success': True})


@app.route('/api/note/<path:note_path>/rename', methods=['PUT'])
def rename_note_title(note_path):
    """Rename a note (change title in frontmatter and filename)."""
    data = request.json
    new_name = data.get('name', '').strip()
    
    if not new_name:
        return jsonify({'success': False, 'error': 'Name required'}), 400
    
    file_path = VAULT_PATH / note_path
    if not file_path.exists():
        return jsonify({'success': False, 'error': 'Note not found'}), 404
    
    # Sanitize new filename
    new_filename = re.sub(r'[^\w\s-]', '', new_name).strip().replace(' ', '-').lower()
    new_filename = re.sub(r'[-\s]+', '-', new_filename) + '.md'
    
    new_path = file_path.parent / new_filename
    
    # Update content title in frontmatter if exists
    content = file_path.read_text()
    if content.startswith('---'):
        parts = content.split('---', 2)
        if len(parts) >= 3:
            frontmatter = parts[1]
            body = parts[2]
            
            lines = frontmatter.split('\n')
            lines = [line if not line.strip().startswith('title:') else f"title: {new_name}" for line in lines]
            
            # Add title if not exists
            if not any(line.strip().startswith('title:') for line in lines):
                lines.insert(0, f"title: {new_name}")
            
            frontmatter = '\n'.join(lines)
            content = f"---{frontmatter}---{body}"
    
    # Rename file
    if new_path != file_path:
        if new_path.exists():
            return jsonify({'success': False, 'error': 'File already exists'}), 400
        file_path.rename(new_path)
    else:
        file_path.write_text(content)
    
    return jsonify({'success': True, 'path': str(new_path.relative_to(VAULT_PATH))})


@app.route('/api/note', methods=['POST'])
def create_note():
    """Create a new note."""
    data = request.json
    title = data.get('title', 'Untitled')
    folder = data.get('folder', '')
    tags = data.get('tags', [])
    template = data.get('template', None)
    
    # Sanitize filename
    filename = re.sub(r'[^\w\s-]', '', title).strip().replace(' ', '-').lower()
    filename = re.sub(r'[-\s]+', '-', filename)
    
    # Determine path
    if folder:
        file_path = VAULT_PATH / folder / f"{filename}.md"
    else:
        file_path = VAULT_PATH / f"{filename}.md"
    
    file_path.parent.mkdir(parents=True, exist_ok=True)
    
    # Build content
    allowed_types = {"decision","research","execution","reflection","meeting"}
    # Default type is 'note' only when no template is selected
    doc_type = None
    if not template:
        doc_type = 'note'
    elif template.lower() in allowed_types:
        doc_type = template.lower()

    if template:
        template_path = TEMPLATES_PATH / f"{template}.md"
        if template_path.exists():
            tpl = template_path.read_text()
            # Replace placeholders, then strip any frontmatter the template might have
            tpl = tpl.replace('{{title}}', title)
            tpl = tpl.replace('{{date}}', datetime.now().strftime('%Y-%m-%d'))
            m = re.match(r'^---\n[\s\S]*?\n---\n([\s\S]*)$', tpl)
            body_from_tpl = m.group(1) if m else tpl
            content = build_frontmatter(title, tags, doc_type) + body_from_tpl
        else:
            content = build_frontmatter(title, tags, doc_type) + f"# {title}\n\n"
    else:
        content = build_frontmatter(title, tags, doc_type) + f"# {title}\n\n"
    
    file_path.write_text(content)
    
    return jsonify({
        'success': True,
        'path': str(file_path.relative_to(VAULT_PATH))
    })


@app.route('/api/folder', methods=['POST'])
def create_folder():
    """Create a new folder."""
    data = request.json
    name = data.get('name', 'New Folder')
    parent = data.get('parent', '')
    
    # Sanitize folder name
    folder_name = re.sub(r'[^\w\s-]', '', name).strip().replace(' ', '-').lower()
    
    if parent:
        folder_path = VAULT_PATH / parent / folder_name
    else:
        folder_path = VAULT_PATH / folder_name
    
    folder_path.mkdir(parents=True, exist_ok=True)
    
    return jsonify({
        'success': True,
        'path': str(folder_path.relative_to(VAULT_PATH))
    })


@app.route('/api/daily', methods=['POST'])
def create_daily():
    """Create today's daily note using 'daily' template if present."""
    today = datetime.now().strftime('%Y-%m-%d')
    daily_folder = VAULT_PATH / 'daily'
    daily_folder.mkdir(exist_ok=True)
    
    file_path = daily_folder / f"{today}.md"
    
    if not file_path.exists():
        # Prefer a body-only template at .templates/daily.md
        body = None
        tpl = TEMPLATES_PATH / 'daily.md'
        if tpl.exists():
            body = tpl.read_text()
            # Replace placeholders
            body = body.replace('{{title}}', today).replace('{{date}}', today)
        if body is None:
            body = f"# {today}\n\n## Notes\n\n## Tasks\n\n- [ ] \n\n## Links\n\n"
        fm = build_frontmatter(today, ['daily'], 'daily')
        file_path.write_text(fm + body)
    
    return jsonify({
        'success': True,
        'path': str(file_path.relative_to(VAULT_PATH))
    })


@app.route('/api/search')
def search_notes():
    """Search notes by name or tags."""
    query = request.args.get('q', '').lower()
    tag_filter = request.args.get('tag', '').lower()
    
    results = []
    
    for md_file in VAULT_PATH.rglob('*.md'):
        if md_file.name.startswith('.'):
            continue
        
        content = md_file.read_text()
        fm, body = extract_frontmatter(content)
        
        title = fm.get('title', md_file.stem)
        tags = fm.get('tags', [])
        
        # Filter by query
        if query and query not in title.lower() and query not in content.lower():
            continue
        
        # Filter by tag
        if tag_filter and tag_filter not in [t.lower() for t in tags]:
            continue
        
        results.append({
            'path': str(md_file.relative_to(VAULT_PATH)),
            'title': title,
            'tags': tags
        })
    
    return jsonify(results)


@app.route('/api/tags')
def get_tags():
    """Get all tags in the vault."""
    tag_counts = {}
    
    for md_file in VAULT_PATH.rglob('*.md'):
        if md_file.name.startswith('.'):
            continue
        
        content = md_file.read_text()
        fm, _ = extract_frontmatter(content)
        
        for tag in fm.get('tags', []):
            tag_counts[tag] = tag_counts.get(tag, 0) + 1
    
    return jsonify(tag_counts)


@app.route('/api/templates')
def get_templates():
    """Get available templates."""
    templates = []
    for template_file in TEMPLATES_PATH.glob('*.md'):
        templates.append({
            'name': template_file.stem,
            'path': str(template_file.relative_to(VAULT_PATH))
        })
    return jsonify(templates)


@app.route('/api/template/<template_name>')
def get_template(template_name):
    """Get a template's content."""
    template_path = TEMPLATES_PATH / f"{template_name}.md"
    
    if not template_path.exists():
        return jsonify({'error': 'Template not found'}), 404
    
    content = template_path.read_text()
    
    return jsonify({
        'name': template_name,
        'content': content
    })


@app.route('/api/template', methods=['POST'])
def create_template():
    """Create a new template."""
    data = request.json
    name = data.get('name')
    content = data.get('content', '')
    
    if not name:
        return jsonify({'error': 'Template name required'}), 400
    
    # Sanitize name
    filename = re.sub(r'[^\w\s-]', '', name).strip().replace(' ', '-').lower()
    template_path = TEMPLATES_PATH / f"{filename}.md"
    
    if template_path.exists():
        return jsonify({'error': 'Template already exists'}), 400
    
    template_path.write_text(content)
    
    return jsonify({
        'success': True,
        'name': filename
    })


@app.route('/api/template/<template_name>', methods=['PUT'])
def update_template(template_name):
    """Update a template's content."""
    data = request.json
    content = data.get('content', '')
    
    template_path = TEMPLATES_PATH / f"{template_name}.md"
    
    if not template_path.exists():
        return jsonify({'error': 'Template not found'}), 404
    
    template_path.write_text(content)
    
    return jsonify({'success': True})


@app.route('/api/template/<template_name>', methods=['DELETE'])
def delete_template(template_name):
    """Delete a template."""
    template_path = TEMPLATES_PATH / f"{template_name}.md"
    
    if not template_path.exists():
        return jsonify({'error': 'Template not found'}), 404
    
    template_path.unlink()
    
    return jsonify({'success': True})


@app.route('/api/move', methods=['POST'])
def move_note():
    """Move a note to a different folder."""
    data = request.json
    source_path = data.get('source')
    target_folder = data.get('target', '')
    
    if not source_path:
        return jsonify({'error': 'Source path required'}), 400
    
    source_file = VAULT_PATH / source_path
    
    if not source_file.exists():
        return jsonify({'error': 'Source file not found'}), 404
    
    # Build target path
    filename = source_file.name
    if target_folder:
        target_file = VAULT_PATH / target_folder / filename
    else:
        target_file = VAULT_PATH / filename
    
    # Don't move if source and target are the same
    if source_file == target_file:
        return jsonify({'success': True, 'path': str(target_file.relative_to(VAULT_PATH))})
    
    # Check if target already exists
    if target_file.exists():
        return jsonify({'error': 'File already exists in target folder'}), 400
    
    # Create target directory if needed
    target_file.parent.mkdir(parents=True, exist_ok=True)
    
    # Move the file
    source_file.rename(target_file)
    
    return jsonify({
        'success': True,
        'path': str(target_file.relative_to(VAULT_PATH))
    })


@app.route('/api/note/<path:note_path>', methods=['DELETE'])
def delete_note(note_path):
    """Delete a note."""
    file_path = VAULT_PATH / note_path
    
    if not file_path.exists():
        return jsonify({'error': 'Note not found'}), 404
    
    file_path.unlink()
    
    return jsonify({'success': True})


@app.route('/api/rename', methods=['POST'])
def rename_note():
    """Rename a note."""
    data = request.json
    old_path = data.get('old_path')
    new_name = data.get('new_name')
    
    if not old_path or not new_name:
        return jsonify({'error': 'Old path and new name required'}), 400
    
    old_file = VAULT_PATH / old_path
    
    if not old_file.exists():
        return jsonify({'error': 'Note not found'}), 404
    
    # Sanitize new filename
    new_filename = re.sub(r'[^\w\s-]', '', new_name).strip().replace(' ', '-').lower()
    new_filename = re.sub(r'[-\s]+', '-', new_filename)
    
    if not new_filename.endswith('.md'):
        new_filename += '.md'
    
    # Keep same folder
    new_file = old_file.parent / new_filename
    
    if new_file.exists() and new_file != old_file:
        return jsonify({'error': 'A note with that name already exists'}), 400
    
    # Update title in frontmatter
    content = old_file.read_text()
    content = re.sub(r'title:.*', f'title: {new_name}', content)
    
    old_file.rename(new_file)
    new_file.write_text(content)
    
    return jsonify({
        'success': True,
        'path': str(new_file.relative_to(VAULT_PATH))
    })


@app.route('/api/move-folder', methods=['POST'])
def move_folder():
    """Move a folder to another location."""
    data = request.json
    source_path = data.get('source')
    target_path = data.get('target', '')
    
    if not source_path:
        return jsonify({'error': 'Source path required'}), 400
    
    source_folder = VAULT_PATH / source_path
    
    if not source_folder.exists() or not source_folder.is_dir():
        return jsonify({'error': 'Source folder not found'}), 404
    
    # Prevent moving into itself or its children
    if target_path.startswith(source_path + '/') or target_path == source_path:
        return jsonify({'error': 'Cannot move folder into itself'}), 400
    
    # Build target path
    folder_name = source_folder.name
    if target_path:
        target_folder = VAULT_PATH / target_path / folder_name
    else:
        target_folder = VAULT_PATH / folder_name
    
    # Check if target already exists
    if target_folder.exists():
        return jsonify({'error': 'Folder already exists in target location'}), 400
    
    # Create parent directory if needed
    target_folder.parent.mkdir(parents=True, exist_ok=True)
    
    # Move the folder
    source_folder.rename(target_folder)
    
    return jsonify({
        'success': True,
        'path': str(target_folder.relative_to(VAULT_PATH))
    })


@app.route('/api/todos')
def get_todos():
    """Get all todos from all notes."""
    todos = []
    
    for md_file in VAULT_PATH.rglob('*.md'):
        if md_file.name.startswith('.'):
            continue
        
        content = md_file.read_text()
        fm, body = extract_frontmatter(content)
        
        title = fm.get('title', md_file.stem)
        path = str(md_file.relative_to(VAULT_PATH))
        
        # Find all checkbox items
        lines = content.split('\n')
        for line_num, line in enumerate(lines):
            # Match unchecked: allow optional leading dash for backward compatibility
            unchecked = re.search(r'^(\s*)(?:-\s+)?\[\s\]\s+(.+)', line)
            if unchecked:
                todos.append({
                    'note': title,
                    'path': path,
                    'line': line_num,
                    'text': unchecked.group(2).strip(),
                    'completed': False,
                    'indent': len(unchecked.group(1))
                })
            
            # Match checked: allow optional leading dash for backward compatibility
            checked = re.search(r'^(\s*)(?:-\s+)?\[[xX]\]\s+(.+)', line)
            if checked:
                todos.append({
                    'note': title,
                    'path': path,
                    'line': line_num,
                    'text': checked.group(2).strip(),
                    'completed': True,
                    'indent': len(checked.group(1))
                })
    
    return jsonify(todos)


@app.route('/api/toggle-todo', methods=['POST'])
def toggle_todo():
    """Toggle a todo checkbox."""
    data = request.json
    path = data.get('path')
    line_num = data.get('line')
    
    if path is None or line_num is None:
        return jsonify({'error': 'Path and line number required'}), 400
    
    file_path = VAULT_PATH / path
    
    if not file_path.exists():
        return jsonify({'error': 'Note not found'}), 404
    
    content = file_path.read_text()
    lines = content.split('\n')
    
    if line_num >= len(lines):
        return jsonify({'error': 'Invalid line number'}), 400
    
    line = lines[line_num]
    
    # Toggle checkbox (supports with or without leading dash)
    if re.search(r'\[\s\]', line):
        # Unchecked -> Checked
        lines[line_num] = re.sub(r'\[\s\]', '[x]', line)
    elif re.search(r'\[[xX]\]', line):
        # Checked -> Unchecked
        lines[line_num] = re.sub(r'\[[xX]\]', '[ ]', line)
    else:
        return jsonify({'error': 'Not a valid checkbox line'}), 400
    
    # Write back
    file_path.write_text('\n'.join(lines))
    
    return jsonify({'success': True})

# Contacts import/export for name consistency
def _grove_config():
    """Read .grove/config.json for the active vault."""
    cfg_path = VAULT_PATH / '.grove' / 'config.json'
    if cfg_path.exists():
        try:
            return json.loads(cfg_path.read_text())
        except Exception:
            return {}
    return {}

def _save_grove_config(cfg):
    grove_dir = VAULT_PATH / '.grove'
    grove_dir.mkdir(exist_ok=True)
    (grove_dir / 'config.json').write_text(json.dumps(cfg, indent=2))

def _default_contact_template():
    return _grove_config().get('default_contact_template', '[{{first_name}} {{last_name}}](mailto:{{email}})')

@app.route('/api/config', methods=['GET'])
def get_grove_config():
    return jsonify(_grove_config())

@app.route('/api/config', methods=['PUT'])
def update_grove_config():
    data = request.json or {}
    cfg = _grove_config()
    cfg.update(data)
    _save_grove_config(cfg)
    return jsonify({'success': True, 'config': cfg})

def _contacts_path():
    grove_dir = VAULT_PATH / '.grove'
    grove_dir.mkdir(exist_ok=True)
    return grove_dir / 'contacts.json'

def _read_contacts():
    p = _contacts_path()
    if not p.exists():
        return []
    try:
        return json.loads(p.read_text())
    except Exception:
        return []

def _write_contacts(contacts):
    _contacts_path().write_text(json.dumps(contacts, indent=2))

@app.route('/api/contacts', methods=['GET'])
def get_contacts():
    return jsonify(_read_contacts())

@app.route('/api/contacts', methods=['POST'])
def add_contact():
    """Add a new contact."""
    data = request.json or {}
    contacts = _read_contacts()
    # Auto-generate id if missing
    cid = data.get('id') or str(len(contacts) + 1)
    contact = {
        'id': cid,
        'first_name': data.get('first_name', ''),
        'last_name': data.get('last_name', ''),
        'email': data.get('email', ''),
        'company': data.get('company', ''),
        'template': data.get('template', _default_contact_template())
    }
    contacts.append(contact)
    _write_contacts(contacts)
    return jsonify({'success': True, 'contact': contact})

@app.route('/api/contacts/<contact_id>', methods=['PUT'])
def update_contact(contact_id):
    """Update an existing contact."""
    data = request.json or {}
    contacts = _read_contacts()
    for c in contacts:
        if str(c.get('id')) == str(contact_id):
            for field in ['id', 'first_name', 'last_name', 'email', 'company', 'template']:
                if field in data and data[field] is not None:
                    c[field] = data[field]
            _write_contacts(contacts)
            return jsonify({'success': True, 'contact': c})
    return jsonify({'error': 'Contact not found'}), 404

@app.route('/api/contacts/<contact_id>', methods=['DELETE'])
def delete_contact(contact_id):
    """Delete a contact."""
    contacts = _read_contacts()
    new_contacts = [c for c in contacts if str(c.get('id')) != str(contact_id)]
    if len(new_contacts) == len(contacts):
        return jsonify({'error': 'Contact not found'}), 404
    _write_contacts(new_contacts)
    return jsonify({'success': True})

@app.route('/api/contacts/import', methods=['POST'])
def import_contacts():
    """Bulk import contacts (JSON array)."""
    data = request.json or []
    if not isinstance(data, list):
        data = data.get('contacts', [])
    contacts = _read_contacts()
    existing_ids = {str(c.get('id')) for c in contacts}
    added = 0
    for item in data:
        cid = item.get('id') or str(len(contacts) + added + 1)
        if str(cid) not in existing_ids:
            contacts.append({
                'id': cid,
                'first_name': item.get('first_name', ''),
                'last_name': item.get('last_name', ''),
                'email': item.get('email', ''),
                'company': item.get('company', ''),
                'template': item.get('template', _default_contact_template())
            })
            existing_ids.add(str(cid))
            added += 1
    _write_contacts(contacts)
    return jsonify({'success': True, 'added': added, 'total': len(contacts)})


# ─── File serving (images, attachments) ───

ALLOWED_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.pdf', '.mp3', '.mp4', '.wav'}

@app.route('/api/file/<path:file_path>')
def serve_file(file_path):
    """Serve any file from the vault (images, attachments, etc.)."""
    full_path = VAULT_PATH / file_path
    if not full_path.exists() or not full_path.is_file():
        return jsonify({'error': 'File not found'}), 404
    # Security: ensure path is within vault
    try:
        full_path.resolve().relative_to(VAULT_PATH.resolve())
    except ValueError:
        return jsonify({'error': 'Access denied'}), 403
    return send_file(full_path)

@app.route('/api/upload', methods=['POST'])
def upload_file():
    """Upload a file to the vault. Supports multipart form or JSON base64."""
    # Determine target folder
    folder = request.form.get('folder', request.args.get('folder', 'attachments'))
    target_dir = VAULT_PATH / folder
    target_dir.mkdir(parents=True, exist_ok=True)

    if 'file' in request.files:
        f = request.files['file']
        if not f.filename:
            return jsonify({'error': 'No file selected'}), 400
        ext = Path(f.filename).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            return jsonify({'error': f'File type {ext} not allowed'}), 400
        # Sanitize filename, add uuid prefix to avoid collisions
        safe_name = re.sub(r'[^\w\s.-]', '', f.filename).strip()
        if not safe_name:
            safe_name = str(uuid.uuid4())[:8] + ext
        file_path = target_dir / safe_name
        # Avoid overwrite
        if file_path.exists():
            stem = file_path.stem
            file_path = target_dir / f"{stem}-{uuid.uuid4().hex[:6]}{ext}"
        f.save(str(file_path))
    else:
        return jsonify({'error': 'No file provided'}), 400

    rel_path = str(file_path.relative_to(VAULT_PATH))
    return jsonify({
        'success': True,
        'path': rel_path,
        'url': f'/api/file/{rel_path}',
        'markdown': f'![{file_path.stem}](/api/file/{rel_path})'
    })

@app.route('/api/upload/paste', methods=['POST'])
def upload_paste():
    """Upload an image from clipboard paste (base64 data)."""
    import base64
    data = request.json or {}
    b64 = data.get('data', '')
    filename = data.get('filename', f'paste-{uuid.uuid4().hex[:8]}.png')
    folder = data.get('folder', 'attachments')

    if not b64:
        return jsonify({'error': 'No data'}), 400

    # Strip data URL prefix if present
    if ',' in b64:
        b64 = b64.split(',', 1)[1]

    target_dir = VAULT_PATH / folder
    target_dir.mkdir(parents=True, exist_ok=True)
    file_path = target_dir / filename
    if file_path.exists():
        stem = file_path.stem
        ext = file_path.suffix
        file_path = target_dir / f"{stem}-{uuid.uuid4().hex[:6]}{ext}"

    file_path.write_bytes(base64.b64decode(b64))
    rel_path = str(file_path.relative_to(VAULT_PATH))
    return jsonify({
        'success': True,
        'path': rel_path,
        'url': f'/api/file/{rel_path}',
        'markdown': f'![{file_path.stem}](/api/file/{rel_path})'
    })


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
