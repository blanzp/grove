"""MDVault Web - Markdown vault manager web application."""

from flask import Flask, render_template, request, jsonify, send_file
from pathlib import Path
import os
import json
import re
import uuid
from datetime import datetime

app = Flask(__name__)

# Serve OpenAPI spec for IDE integrations (Copilot, etc.)
from flask import send_from_directory
PROJECT_ROOT = Path(__file__).parent

# ─── LLM Config Helpers ───

def _llm_config():
    cfg = {
        'enabled': os.environ.get('GROVE_LLM_ENABLED', 'false').lower() == 'true',
        'provider': os.environ.get('GROVE_LLM_PROVIDER', 'openai').lower(),
        'endpoint': os.environ.get('GROVE_LLM_ENDPOINT', ''),
        'api_key': os.environ.get('GROVE_LLM_API_KEY', ''),
        'model': os.environ.get('GROVE_LLM_MODEL', ''),
        'max_tokens': int(os.environ.get('GROVE_LLM_MAX_TOKENS', '800') or '800'),
        'temperature': float(os.environ.get('GROVE_LLM_TEMPERATURE', '0.3') or '0.3'),
    }
    # Effective enablement: require API key for openai-like providers
    eff_enabled = cfg['enabled'] and (cfg['provider'] == 'ollama' or bool(cfg['api_key'])) and bool(cfg['endpoint']) and bool(cfg['model'])
    cfg['effective'] = eff_enabled
    return cfg

@app.route('/api/llm/status')
def llm_status():
    cfg = _llm_config()
    # Never return api_key
    return jsonify({
        'enabled': cfg['enabled'],
        'effective': cfg['effective'],
        'provider': cfg['provider'],
        'needs_api_key': cfg['provider'] != 'ollama' and not bool(os.environ.get('GROVE_LLM_API_KEY', '')),
    })

@app.route('/api/llm', methods=['POST'])
def llm_generate():
    import urllib.request, urllib.error, ssl
    cfg = _llm_config()
    if not cfg['enabled']:
        return jsonify({'error': 'LLM disabled (set GROVE_LLM_ENABLED=true)'}), 403
    if not cfg['effective']:
        return jsonify({'error': 'LLM not configured (endpoint/model/api key)'}), 403
    data = request.json or {}
    prompt = (data.get('prompt') or '').strip()
    selection = (data.get('selection') or '').strip()
    # Build final prompt: prefer selection if provided, else prompt only; simple concat when both
    final_prompt = prompt
    if selection:
        final_prompt = f"Selection:\n{selection}\n\nInstruction:\n{prompt}" if prompt else selection
    if not final_prompt:
        return jsonify({'error': 'prompt required'}), 400

    try:
        if cfg['provider'] == 'ollama':
            url = cfg['endpoint'].rstrip('/') + '/api/generate'
            payload = {
                'model': cfg['model'],
                'prompt': final_prompt,
                'options': {
                    'temperature': cfg['temperature']
                }
            }
            req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers={'Content-Type': 'application/json'})
        elif cfg['provider'] == 'anthropic':
            # Anthropic Messages API
            url = cfg['endpoint'].rstrip('/') + '/v1/messages'
            payload = {
                'model': cfg['model'],
                'max_tokens': cfg['max_tokens'],
                'temperature': cfg['temperature'],
                'messages': [
                    { 'role': 'user', 'content': final_prompt }
                ]
            }
            req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers={
                'Content-Type': 'application/json',
                'x-api-key': cfg['api_key'],
                'anthropic-version': '2023-06-01'
            })
        else:
            # OpenAI-compatible chat completions
            url = cfg['endpoint'].rstrip('/') + '/v1/chat/completions'
            payload = {
                'model': cfg['model'],
                'messages': [
                    { 'role': 'system', 'content': 'You are a concise writing assistant for markdown notes.' },
                    { 'role': 'user', 'content': final_prompt }
                ],
                'temperature': cfg['temperature'],
                'max_tokens': cfg['max_tokens']
            }
            req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers={
                'Content-Type': 'application/json',
                'Authorization': f"Bearer {cfg['api_key']}"
            })
        # 20s timeout; basic TLS context
        ctx = ssl.create_default_context()
        with urllib.request.urlopen(req, timeout=20, context=ctx) as resp:
            txt = resp.read().decode('utf-8')
        # Parse response
        out_text = ''
        try:
            obj = json.loads(txt)
            if cfg['provider'] == 'ollama':
                out_text = obj.get('response', '')
            elif cfg['provider'] == 'anthropic':
                # Messages API returns content array
                parts = obj.get('content', [])
                if parts and isinstance(parts, list):
                    # Text parts have {'type':'text','text':...}
                    out_text = ''.join(p.get('text','') for p in parts if isinstance(p, dict))
                else:
                    out_text = txt
            else:
                ch = obj.get('choices', [{}])[0]
                msg = ch.get('message', {})
                out_text = msg.get('content', '')
        except Exception:
            out_text = txt
        return jsonify({'text': out_text.strip(), 'model': cfg['model']})
    except urllib.error.HTTPError as e:
        return jsonify({'error': f'HTTP {e.code}'}), 502
    except Exception as ex:
        return jsonify({'error': 'LLM request failed'}), 502

@app.route('/openapi.yaml')
def serve_openapi():
    try:
        return send_from_directory(str(PROJECT_ROOT), 'openapi.yaml', mimetype='application/yaml')
    except Exception:
        return jsonify({'error': 'openapi.yaml not found'}), 404

# Global config under user's home directory
GROVE_HOME = Path.home() / ".grove"
GROVE_HOME.mkdir(exist_ok=True)
CONFIG_DIR = GROVE_HOME
CONFIG_PATH = CONFIG_DIR / "config.json"

# Vaults live under ~/.grove/vaults
VAULTS_ROOT = GROVE_HOME / "vaults"
VAULTS_ROOT.mkdir(parents=True, exist_ok=True)

# Project-level seed vault acts as a template for new vaults
PROJECT_SEED_VAULT = Path(__file__).parent / "default-vault"
# Backward-compat: fall back to legacy 'vault' if default-vault not present
LEGACY_SEED_VAULT = Path(__file__).parent / "vault"


def _seed_vault(path: Path):
    """Initialize a vault with README and standard templates if missing."""
    seed = PROJECT_SEED_VAULT if PROJECT_SEED_VAULT.exists() else LEGACY_SEED_VAULT
    # Templates
    tpl_dir = path / '.templates'
    tpl_dir.mkdir(parents=True, exist_ok=True)
    if seed.exists():
        seed_tpl = seed / '.templates'
        if seed_tpl.exists():
            for f in seed_tpl.glob('*.md'):
                target = tpl_dir / f.name
                if not target.exists():
                    target.write_text(f.read_text())
    # README creation is handled by create_vault() for new vaults


def get_active_vault_path():
    """Return the Path to the active vault directory under ~/.grove/vaults."""
    # Default to a 'default' vault name
    name = 'default'
    if CONFIG_PATH.exists():
        try:
            cfg = json.loads(CONFIG_PATH.read_text() or '{}')
            name = cfg.get('active_vault', 'default')
        except Exception:
            name = 'default'
    path = VAULTS_ROOT / name
    path.mkdir(parents=True, exist_ok=True)
    # Ensure templates dir exists and seed vault
    _seed_vault(path)
    return path

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
                # Check if note is starred (read first few lines for efficiency)
                starred = False
                try:
                    with item.open('r') as f:
                        first_lines = ''.join([f.readline() for _ in range(10)])
                        if re.search(r'starred:\s*true', first_lines):
                            starred = True
                except Exception:
                    pass
                
                structure.append({
                    'name': item.stem,
                    'path': str(item.relative_to(VAULT_PATH)),
                    'type': 'file',
                    'starred': starred
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
        # Try inline format: tags: [tag1, tag2] or tags: tag1, tag2
        tags_match = re.search(r'tags:\s*([^\n]+)', fm_text)
        if tags_match:
            tags_str = tags_match.group(1).strip()
            # Strip YAML inline array brackets
            tags_str = tags_str.strip('[]')
            frontmatter['tags'] = [t.strip() for t in tags_str.split(',') if t.strip()]
        else:
            frontmatter['tags'] = []
    
    return frontmatter, body


def extract_wikilinks(content):
    """Extract wikilinks ([[note name]]) from markdown content."""
    # Find all [[...]] patterns
    pattern = r'\[\[([^\]]+)\]\]'
    matches = re.findall(pattern, content)
    # Normalize: strip whitespace, convert to lowercase for matching
    return [m.strip() for m in matches]


def get_note_title(note_path):
    """Get the title of a note from its frontmatter or filename."""
    try:
        file_path = VAULT_PATH / note_path
        if not file_path.exists():
            return file_path.stem
        content = file_path.read_text()
        fm, _ = extract_frontmatter(content)
        return fm.get('title', file_path.stem)
    except Exception:
        return Path(note_path).stem


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
    """List available vaults under ~/.grove/vaults and the active one."""
    names = [p.name for p in VAULTS_ROOT.iterdir() if p.is_dir()]
    if not names:
        # Ensure a default vault exists
        (VAULTS_ROOT / 'default').mkdir(parents=True, exist_ok=True)
        names = ['default']
    active = VAULT_PATH.name
    return jsonify({
        'active': active,
        'vaults': sorted(list(set(names)))
    })

@app.route('/api/vaults/create', methods=['POST'])
def create_vault():
    data = request.json or {}
    name = data.get('name', '').strip()
    if not name:
        return jsonify({'error': 'name required'}), 400
    path = VAULTS_ROOT / name
    if path.exists():
        return jsonify({'error': 'vault already exists'}), 400
    path.mkdir(parents=True, exist_ok=True)
    # Seed vault with templates
    _seed_vault(path)
    # Create welcome README
    readme = path / 'README.md'
    print(f"[DEBUG] Creating README at: {readme}")
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
| `Ctrl+M` | New meeting |
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
    print(f"[DEBUG] README created, exists={readme.exists()}")
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
    vault_name = VAULT_PATH.name
    return send_file(buf, mimetype='application/zip', as_attachment=True,
                     download_name=f'grove-{vault_name}-{datetime.now().strftime("%Y%m%d")}.zip')

@app.route('/api/vaults/delete', methods=['POST'])
def delete_vault():
    import shutil
    data = request.json or {}
    name = data.get('name')
    if not name:
        return jsonify({'error': 'name required'}), 400
    path = VAULTS_ROOT / name
    if not path.exists():
        return jsonify({'error': 'Vault not found'}), 404
    shutil.rmtree(path)
    # If we just deleted the active vault, switch back to 'default'
    cfg = {}
    if CONFIG_PATH.exists():
        try:
            cfg = json.loads(CONFIG_PATH.read_text() or '{}')
        except Exception:
            pass
    if cfg.get('active_vault') == name:
        cfg['active_vault'] = 'default'
        CONFIG_PATH.write_text(json.dumps(cfg))
    return jsonify({'success': True})

@app.route('/api/vaults/switch', methods=['POST'])
def switch_vault():
    data = request.json or {}
    name = data.get('name')
    if not name:
        return jsonify({'error': 'name required'}), 400
    path = VAULTS_ROOT / name
    if not path.exists():
        return jsonify({'error': 'vault not found'}), 404
    # Ensure it's seeded
    _seed_vault(path)
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
    
    # Check if starred in frontmatter
    starred = False
    if content.startswith('---'):
        fm_text = content.split('---', 2)[1] if len(content.split('---', 2)) >= 3 else ''
        if re.search(r'starred:\s*true', fm_text):
            starred = True
    
    return jsonify({
        'path': note_path,
        'title': fm.get('title', file_path.stem),
        'tags': fm.get('tags', []),
        'content': content,
        'body': body,
        'starred': starred
    })


@app.route('/api/note/<path:note_path>/star', methods=['POST'])
def toggle_star(note_path):
    """Toggle star status of a note."""
    file_path = VAULT_PATH / note_path
    
    if not file_path.exists():
        return jsonify({'success': False, 'error': 'Note not found'}), 404
    
    content = file_path.read_text()
    
    # Check current starred status
    starred = False
    if content.startswith('---'):
        fm_text = content.split('---', 2)[1] if len(content.split('---', 2)) >= 3 else ''
        if re.search(r'starred:\s*true', fm_text):
            starred = True
    
    # Toggle it
    new_value = 'false' if starred else 'true'
    updated_content = _update_frontmatter_field(content, 'starred', new_value)
    file_path.write_text(updated_content)
    
    return jsonify({'success': True, 'starred': not starred})


## save_note is defined at the bottom with updated timestamp support


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
    custom_filename = data.get('filename', None)
    
    # Use custom filename if provided, otherwise slugify the title
    if custom_filename:
        filename = re.sub(r'[^\w\s-]', '', custom_filename).strip()
        filename = re.sub(r'[\s]+', '-', filename)
    else:
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
    """Create a daily note using 'daily' template if present."""
    # Support optional date parameter for creating notes on specific dates
    data = request.get_json(silent=True) or {}
    date_str = data.get('date', datetime.now().strftime('%Y-%m-%d'))
    
    daily_folder = VAULT_PATH / 'daily'
    daily_folder.mkdir(exist_ok=True)
    
    file_path = daily_folder / f"{date_str}.md"
    
    if not file_path.exists():
        # Prefer a body-only template at .templates/daily.md
        body = None
        tpl = TEMPLATES_PATH / 'daily.md'
        if tpl.exists():
            body = tpl.read_text()
            # Replace placeholders
            body = body.replace('{{title}}', date_str).replace('{{date}}', date_str)
        if body is None:
            body = f"# {date_str}\n\n## Notes\n\n## Tasks\n\n- [ ] \n\n## Links\n\n"
        fm = build_frontmatter(date_str, ['daily'], 'daily')
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
        # Exclude templates folder from search
        rel_parts = md_file.relative_to(VAULT_PATH).parts
        if '.templates' in rel_parts:
            continue
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


@app.route('/api/backlinks/<path:note_path>')
def get_backlinks(note_path):
    """Get all notes that link to this note."""
    file_path = VAULT_PATH / note_path
    
    if not file_path.exists():
        return jsonify({'error': 'Note not found'}), 404
    
    # Get the title and filename of the current note
    current_title = get_note_title(note_path)
    filename_stem = file_path.stem
    path_without_ext = note_path.rsplit('.md', 1)[0]
    
    # Build a set of possible link targets (title, filename, path, and variations)
    link_targets = {
        current_title.lower(),
        filename_stem.lower(),
        filename_stem.lower().replace('-', ' '),
        path_without_ext.lower(),
        path_without_ext.lower().replace('-', ' ')
    }
    
    backlinks = []
    
    # Search all notes for wikilinks to this note
    for md_file in VAULT_PATH.rglob('*.md'):
        # Skip templates and hidden files
        rel_parts = md_file.relative_to(VAULT_PATH).parts
        if '.templates' in rel_parts or md_file.name.startswith('.'):
            continue
        
        # Skip self
        if md_file == file_path:
            continue
        
        try:
            content = md_file.read_text()
            wikilinks = extract_wikilinks(content)
            
            # Check if any wikilink matches this note's title or filename
            for link in wikilinks:
                if link.lower() in link_targets:
                    note_title = get_note_title(str(md_file.relative_to(VAULT_PATH)))
                    backlinks.append({
                        'path': str(md_file.relative_to(VAULT_PATH)),
                        'title': note_title
                    })
                    break
        except Exception:
            continue
    
    return jsonify({
        'note': note_path,
        'title': current_title,
        'backlinks': backlinks,
        'count': len(backlinks)
    })


@app.route('/api/wikilink-map')
def get_wikilink_map():
    """Get a map of note titles and filenames to paths for wikilink resolution."""
    title_map = {}
    
    for md_file in VAULT_PATH.rglob('*.md'):
        rel_parts = md_file.relative_to(VAULT_PATH).parts
        if '.templates' in rel_parts or md_file.name.startswith('.'):
            continue
        
        try:
            rel_path = str(md_file.relative_to(VAULT_PATH))
            title = get_note_title(rel_path)
            filename_stem = md_file.stem  # filename without .md extension
            path_without_ext = rel_path.rsplit('.md', 1)[0]  # e.g., "research/README"
            
            # Map title, filename stem, and path (all lowercase) to path
            title_map[title.lower()] = rel_path
            title_map[filename_stem.lower()] = rel_path
            title_map[filename_stem.lower().replace('-', ' ')] = rel_path
            
            # Map full path without extension for disambiguation (e.g., [[research/README]])
            title_map[path_without_ext.lower()] = rel_path
            title_map[path_without_ext.lower().replace('-', ' ')] = rel_path
        except Exception:
            continue
    
    return jsonify(title_map)


@app.route('/api/graph')
def get_graph():
    """Get graph data for all notes and their connections."""
    nodes = []
    edges = []
    
    # Build a map of title (lowercase) -> note path for link resolution
    title_to_path = {}
    
    # First pass: collect all notes as nodes
    for md_file in VAULT_PATH.rglob('*.md'):
        rel_parts = md_file.relative_to(VAULT_PATH).parts
        if '.templates' in rel_parts or md_file.name.startswith('.'):
            continue
        
        try:
            rel_path = str(md_file.relative_to(VAULT_PATH))
            title = get_note_title(rel_path)
            
            content = md_file.read_text()
            fm, _ = extract_frontmatter(content)
            tags = fm.get('tags', [])
            
            nodes.append({
                'id': rel_path,
                'label': title,
                'title': title,  # For tooltip
                'tags': tags
            })
            
            # Map title, filename stem, path, and variations for link resolution
            filename_stem = md_file.stem
            path_without_ext = rel_path.rsplit('.md', 1)[0]
            
            title_to_path[title.lower()] = rel_path
            title_to_path[filename_stem.lower()] = rel_path
            title_to_path[filename_stem.lower().replace('-', ' ')] = rel_path
            title_to_path[path_without_ext.lower()] = rel_path
            title_to_path[path_without_ext.lower().replace('-', ' ')] = rel_path
        except Exception:
            continue
    
    # Second pass: extract wikilinks and build edges
    for md_file in VAULT_PATH.rglob('*.md'):
        rel_parts = md_file.relative_to(VAULT_PATH).parts
        if '.templates' in rel_parts or md_file.name.startswith('.'):
            continue
        
        try:
            rel_path = str(md_file.relative_to(VAULT_PATH))
            content = md_file.read_text()
            wikilinks = extract_wikilinks(content)
            
            for link in wikilinks:
                # Try to resolve the wikilink to a note path
                target_path = title_to_path.get(link.lower())
                if target_path:
                    edges.append({
                        'from': rel_path,
                        'to': target_path
                    })
        except Exception:
            continue
    
    return jsonify({
        'nodes': nodes,
        'edges': edges
    })


@app.route('/api/calendar')
def get_calendar_data():
    """Get all dated notes for calendar view."""
    import re
    
    # Pattern to extract dates from filenames
    date_pattern = re.compile(r'(\d{4}-\d{2}-\d{2})')
    week_pattern = re.compile(r'(\d{4})-W(\d{2})')
    
    dated_notes = {}  # date string -> list of notes
    
    for md_file in VAULT_PATH.rglob('*.md'):
        rel_parts = md_file.relative_to(VAULT_PATH).parts
        if '.templates' in rel_parts or md_file.name.startswith('.'):
            continue
        
        try:
            rel_path = str(md_file.relative_to(VAULT_PATH))
            filename = md_file.stem
            title = get_note_title(rel_path)
            
            # Determine note type based on path/filename
            note_type = 'note'
            if 'daily/' in rel_path or filename.startswith('daily-planner'):
                note_type = 'daily'
            elif 'meeting' in rel_path.lower() or filename.startswith('meeting-'):
                note_type = 'meeting'
            elif 'planner' in filename.lower():
                note_type = 'planner'
            
            # Extract date from filename
            date_match = date_pattern.search(filename)
            if date_match:
                date_str = date_match.group(1)
                if date_str not in dated_notes:
                    dated_notes[date_str] = []
                dated_notes[date_str].append({
                    'path': rel_path,
                    'title': title,
                    'type': note_type
                })
            
            # Handle weekly planners - add to first day of week
            week_match = week_pattern.search(filename)
            if week_match and not date_match:
                year = int(week_match.group(1))
                week = int(week_match.group(2))
                # Get Monday of that week
                from datetime import datetime, timedelta
                jan4 = datetime(year, 1, 4)
                start_of_week1 = jan4 - timedelta(days=jan4.weekday())
                monday = start_of_week1 + timedelta(weeks=week-1)
                date_str = monday.strftime('%Y-%m-%d')
                if date_str not in dated_notes:
                    dated_notes[date_str] = []
                dated_notes[date_str].append({
                    'path': rel_path,
                    'title': title,
                    'type': 'planner'
                })
        except Exception:
            continue
    
    return jsonify(dated_notes)


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
        # Exclude templates folder from todo scan
        rel_parts = md_file.relative_to(VAULT_PATH).parts
        if '.templates' in rel_parts:
            continue
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


# ─── JSONL Export (full + incremental) ───

@app.route('/api/folders')
def list_folders():
    """List all folders in the vault for upload destination selection."""
    folders = []
    for item in VAULT_PATH.rglob('*'):
        if item.is_dir() and not item.name.startswith('.'):
            rel = item.relative_to(VAULT_PATH)
            if not any(part.startswith('.') for part in rel.parts):
                folders.append(str(rel))
    folders.sort()
    return jsonify(folders)


@app.route('/api/upload/bulk', methods=['POST'])
def upload_bulk():
    """Upload multiple files to a specified folder."""
    folder = request.form.get('folder', '')
    target_dir = VAULT_PATH / folder if folder else VAULT_PATH
    target_dir.mkdir(parents=True, exist_ok=True)
    
    files = request.files.getlist('files')
    if not files:
        return jsonify({'error': 'No files provided'}), 400
    
    uploaded = []
    errors = []
    
    for f in files:
        if not f.filename:
            continue
        
        # Sanitize filename but keep original extension
        original_name = f.filename
        safe_name = re.sub(r'[^\w\s.-]', '', original_name).strip()
        if not safe_name:
            ext = Path(original_name).suffix or '.bin'
            safe_name = str(uuid.uuid4())[:8] + ext
        
        file_path = target_dir / safe_name
        # Avoid overwrite
        if file_path.exists():
            stem = file_path.stem
            ext = file_path.suffix
            file_path = target_dir / f"{stem}-{uuid.uuid4().hex[:6]}{ext}"
        
        try:
            # Save binary for non-text files, text for text files
            ext = file_path.suffix.lower()
            if ext in ['.md', '.markdown', '.txt', '.json', '.yaml', '.yml', '.csv']:
                content = f.read().decode('utf-8')
                file_path.write_text(content, encoding='utf-8')
            else:
                file_path.write_bytes(f.read())
            rel_path = str(file_path.relative_to(VAULT_PATH))
            uploaded.append(rel_path)
        except Exception as e:
            errors.append(f'{f.filename}: {str(e)}')
    
    return jsonify({
        'success': len(errors) == 0,
        'uploaded': uploaded,
        'errors': errors
    })


@app.route('/api/export')
def export_notes():
    """Export vault notes as JSONL. Supports format=jsonl (default) and since= for incremental.
    
    Query params:
        format: 'jsonl' (default) or 'json'
        since:  ISO timestamp — only export notes modified after this time
    """
    fmt = request.args.get('format', 'jsonl')
    since_str = request.args.get('since', None)
    since_ts = None
    if since_str:
        try:
            since_ts = datetime.fromisoformat(since_str).timestamp()
        except ValueError:
            return jsonify({'error': f'Invalid since timestamp: {since_str}'}), 400

    notes = []
    for md_file in VAULT_PATH.rglob('*.md'):
        if md_file.name.startswith('.'):
            continue
        # Skip files in hidden directories (e.g. .templates)
        rel = md_file.relative_to(VAULT_PATH)
        if any(part.startswith('.') for part in rel.parts):
            continue

        # Incremental: skip files not modified since the given timestamp
        if since_ts is not None:
            mtime = md_file.stat().st_mtime
            if mtime < since_ts:
                continue

        content = md_file.read_text()
        fm, body = extract_frontmatter(content)
        path = str(rel)
        mtime_iso = datetime.fromtimestamp(md_file.stat().st_mtime).isoformat()

        note = {
            'path': path,
            'title': fm.get('title', md_file.stem),
            'type': fm.get('type', 'note') if 'type' in (content.split('---')[1] if content.startswith('---') else '') else 'note',
            'tags': fm.get('tags', []),
            'created': fm.get('created', ''),
            'modified': mtime_iso,
            'body': body.strip(),
        }

        # Extract type from frontmatter text directly
        if content.startswith('---'):
            fm_text = content.split('---', 2)[1] if len(content.split('---', 2)) >= 3 else ''
            type_match = re.search(r'type:\s*(\S+)', fm_text)
            if type_match:
                note['type'] = type_match.group(1)

        notes.append(note)

    if fmt == 'json':
        return jsonify(notes)

    # JSONL format
    lines = [json.dumps(n, ensure_ascii=False) for n in notes]
    return app.response_class(
        '\n'.join(lines) + '\n',
        mimetype='application/x-ndjson',
        headers={'Content-Disposition': 'attachment; filename=grove-export.jsonl'}
    )


@app.route('/api/extract')
def extract_notes():
    """Extract notes based on time range, starred status, type, and tags.
    
    Query params:
        months: integer (1, 3, 6, 12) or "all" (default: "all")
        starred: "true" or "false" (default: "true")
        type: comma-separated types to filter (optional)
        tag: tag to filter (optional)
    """
    from datetime import timedelta
    
    months_param = request.args.get('months', 'all')
    starred_only = request.args.get('starred', 'true').lower() == 'true'
    type_filter = request.args.get('type', '').strip()
    tag_filter = request.args.get('tag', '').strip()
    
    # Calculate time threshold
    now = datetime.now()
    threshold = None
    if months_param != 'all':
        try:
            months = int(months_param)
            threshold = now - timedelta(days=months * 30)
        except ValueError:
            return jsonify({'error': 'Invalid months parameter'}), 400
    
    # Parse type filter
    types = [t.strip() for t in type_filter.split(',') if t.strip()] if type_filter else []
    
    matching_notes = []
    
    for md_file in VAULT_PATH.rglob('*.md'):
        if md_file.name.startswith('.'):
            continue
        rel = md_file.relative_to(VAULT_PATH)
        if any(part.startswith('.') for part in rel.parts):
            continue
        
        try:
            content = md_file.read_text()
            fm_text = ''
            body = content
            
            if content.startswith('---'):
                parts = content.split('---', 2)
                if len(parts) >= 3:
                    fm_text = parts[1]
                    body = parts[2]
            
            # Check starred status
            is_starred = bool(re.search(r'starred:\s*true', fm_text))
            if starred_only and not is_starred:
                continue
            
            # Check type filter
            if types:
                type_match = re.search(r'type:\s*(\S+)', fm_text)
                note_type = type_match.group(1) if type_match else 'note'
                if note_type not in types:
                    continue
            
            # Check tag filter
            if tag_filter:
                tags_match = re.search(r'tags:\s*\n((?:\s*-\s*.+\n?)+)', fm_text)
                note_tags = []
                if tags_match:
                    note_tags = [t.strip('- ').strip() for t in tags_match.group(1).split('\n') if t.strip()]
                if tag_filter not in note_tags:
                    continue
            
            # Check time range (created OR updated)
            matches_time = True
            if threshold:
                created_match = re.search(r'created:\s*(.+)', fm_text)
                updated_match = re.search(r'updated:\s*(.+)', fm_text)
                
                created_dt = None
                updated_dt = None
                
                if created_match:
                    try:
                        created_dt = datetime.fromisoformat(created_match.group(1).strip())
                    except ValueError:
                        pass
                
                if updated_match:
                    try:
                        updated_dt = datetime.fromisoformat(updated_match.group(1).strip())
                    except ValueError:
                        pass
                
                # Fall back to file mtime if updated not in frontmatter
                if not updated_dt:
                    updated_dt = datetime.fromtimestamp(md_file.stat().st_mtime)
                
                # Match if EITHER created OR updated is within range
                matches_time = False
                if created_dt and created_dt >= threshold:
                    matches_time = True
                if updated_dt and updated_dt >= threshold:
                    matches_time = True
            
            if not matches_time:
                continue
            
            # Extract metadata
            title_match = re.search(r'title:\s*(.+)', fm_text)
            title = title_match.group(1).strip() if title_match else md_file.stem
            
            type_match = re.search(r'type:\s*(\S+)', fm_text)
            note_type = type_match.group(1) if type_match else 'note'
            
            created_match = re.search(r'created:\s*(.+)', fm_text)
            created_str = created_match.group(1).strip()[:10] if created_match else ''
            
            matching_notes.append({
                'title': title,
                'type': note_type,
                'created': created_str,
                'body': body.strip()
            })
        
        except Exception:
            continue
    
    # Build markdown output
    if months_param == 'all':
        time_desc = 'All time'
    else:
        start_date = threshold.strftime('%b %Y') if threshold else ''
        end_date = now.strftime('%b %Y')
        time_desc = f'Last {months_param} month{"s" if int(months_param) > 1 else ""} ({start_date} – {end_date})'
    
    scope_desc = 'Starred only' if starred_only else 'All notes'
    type_desc = f'Types: {", ".join(types)}' if types else ''
    
    output = f'# Extract: {time_desc}\n'
    output += f'## {len(matching_notes)} notes'
    if type_desc:
        output += f' | {type_desc}'
    output += f' | {scope_desc}\n\n'
    
    for note in matching_notes:
        output += '---\n'
        output += f'## {note["title"]}\n'
        output += f'*{note["type"]} · {note["created"]}*\n\n'
        output += note['body'] + '\n\n'
    
    return app.response_class(
        output,
        mimetype='text/markdown',
        headers={'Content-Disposition': 'attachment; filename=grove-extract.md'}
    )


def _update_frontmatter_field(content: str, field: str, value: str) -> str:
    """Add or update a single field in existing frontmatter."""
    if not content.startswith('---'):
        return content
    parts = content.split('---', 2)
    if len(parts) < 3:
        return content
    fm_text = parts[1]
    body = parts[2]

    pattern = re.compile(rf'^{field}:\s*.*$', re.MULTILINE)
    if pattern.search(fm_text):
        fm_text = pattern.sub(f'{field}: {value}', fm_text)
    else:
        fm_text = fm_text.rstrip('\n') + f'\n{field}: {value}\n'

    return f'---{fm_text}---{body}'


@app.route('/api/note/<path:note_path>', methods=['PUT'])
def save_note(note_path):
    """Save a note's content. Adds updated timestamp to frontmatter."""
    data = request.json
    content = data.get('content', '')

    file_path = VAULT_PATH / note_path
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(content)

    # Add updated timestamp
    saved_content = file_path.read_text()
    if saved_content.startswith('---'):
        saved_content = _update_frontmatter_field(saved_content, 'updated', datetime.now().isoformat())
        file_path.write_text(saved_content)

    return jsonify({'success': True, 'path': note_path})


if __name__ == '__main__':
    import os
    port = int(os.environ.get('GROVE_PORT', '5000'))
    host = os.environ.get('GROVE_HOST', '127.0.0.1')
    app.run(debug=False, host=host, port=port)
