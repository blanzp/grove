# <img src="/static/grove-logo.png" alt="Grove" width="64"> Grove

A self-hosted markdown knowledge base that runs anywhere Python does — no cloud, no admin privileges, no data leaves your machine.

Beautiful, lightweight, VS Code-inspired. Organize your thoughts in a personal knowledge grove.

## Table of Contents

- [Features](#features)
- [Supported Markdown](#supported-markdown)
- [Installation](#installation)
- [Usage](#usage)
  - [Creating Notes](#creating-notes)
  - [Daily Notes](#daily-notes)
  - [Meeting Notes](#meeting-notes)
  - [Planner](#planner-daily--weekly)
  - [Templates](#templates)
  - [Frontmatter](#frontmatter)
  - [Contacts](#contacts)
  - [Multi-Vault](#multi-vault)
  - [Images & Attachments](#images--attachments)
  - [Todo Dashboard](#todo-dashboard)
  - [Search](#search)
  - [Footnotes](#footnotes)
  - [Table of Contents](#table-of-contents-1)
- [Extracting Notes for LLM Summaries](#extracting-notes-for-llm-summaries)
- [LLM Assist Configuration](#llm-assist-configuration)
- [Configuration](#configuration)
- [MCP Server](#mcp-server)
- [File Structure](#file-structure)
- [API](#api)
- [Tech Stack](#tech-stack)
- [License](#license)

## Features

### 📝 Editor
- **Markdown editor** with live preview (edit, split, or preview mode)
- **Markdown toolbar** — Bold, italic, headings, lists, checkboxes, links, images, code blocks, blockquotes, wikilinks, TOC, **tables**
- **Table generator** — toolbar button opens dimension picker to insert markdown tables
- **Auto-save** with 2-second debounce — never lose work
- **Frontmatter preview** — read-only view of YAML frontmatter (managed by Grove)
- **Wikilinks** — clickable `[[note]]` links to navigate between notes (type `[[` for typeahead)
- **Path-based wikilinks** — use `[[folder/note]]` to disambiguate notes with the same name in different folders
- **Footnotes** — standard `[^1]` refs with `[^1]: text` definitions, rendered with back-links
- **Table of Contents** — toolbar button scans headings and inserts a linked TOC; re-click to update
- **Image paste** — paste images from clipboard directly into the editor
- **Image upload** — upload via toolbar button or drag & drop
- **Slash commands** — type `/` at start of line for inline shortcuts (date, time, code block, table, mermaid, headings, etc.)
- **Code block copy button** — hover over any code block in preview to reveal a copy button
- **New notes open in edit mode** — start writing immediately after creation

### 📂 File Management
- **File tree** sidebar with folder navigation — shows all files (markdown, images, PDFs, etc.)
- **Drag & drop** files and folders to reorganize
- **Import** — drop `.md` or `.txt` files to import into your vault
- **Recent files** panel (collapsed by default) for quick access
- **Search modal** — full-text search across note contents with `#tag` filtering, context snippets with highlighted matches (Ctrl+K)
- **Inline search bar** — search notes with unified #tag filtering in sidebar
- **Create, rename, delete** notes and folders
- **Right-click context menu** — delete files, folders, and images via right-click
- **Image preview** — click images in tree to open preview modal with proper sizing
- **Asset files** — images, PDFs, audio/video shown with type-specific icons
- **Vault selector** — at bottom of sidebar for switching between vaults

### 🏷️ Organization
- **Tag management** — add/remove tags via modal, stored as YAML frontmatter
- **Tag filter** — filter notes by tag from the sidebar dropdown
- **Daily notes** — one-click daily log creation using customizable template
- **Templates** — create, edit, and delete body-only note templates (Grove manages frontmatter)
- **Document types** — auto-set `type` in frontmatter based on template (`note`, `meeting`, `decision`, `research`, `reflection`, `execution`, `daily`)
- **Starred notes** — ⭐ toggle in editor; starred icon shows in the file tree
- **Interactive checkboxes** — click checkboxes in preview to toggle completion (syncs to source markdown)
- **Todo dashboard** — scan all notes for checkboxes, toggle completion, click to navigate to source note (excludes `.templates/`)

### 🔗 Graph View & Backlinks
- **Backlinks panel** — shows all notes that link to the current note; click to navigate
- **Interactive graph view** — visualize your knowledge network with connected nodes
- **Click to navigate** — click any node in the graph to open that note
- **Theme-aware** — graph colors adapt to dark/light mode
- **Wikilink detection** — automatically detects `[[wikilinks]]` to build connections

### 👥 Contacts
- **Contact management** — full CRUD with fields: ID, first name, last name, email, phone, office phone, mobile phone, zoom ID, company, title, department, note
- **@ mention autocomplete** — type `@` in the editor to search and insert contacts
- **Template profiles** — create multiple contact templates with customizable name format, email, phone, and zoom URL patterns
- **Smart icons** — Font Awesome icons (📧 email, 📞 phone, 🎥 zoom) appear as clickable links in mentions
- **Profile-based rendering** — each contact uses its selected profile to format mentions with available contact methods
- **Template substitution** — placeholders: `{{id}}`, `{{first_name}}`, `{{last_name}}`, `{{email}}`, `{{phone}}`, `{{zoom_id}}`, `{{company}}`
- **Search & filter** — search contacts by name, email, phone, company, or zoom ID
- **Import contacts** — bulk import from JSON file
- **Visual indicators** — contacts list shows icons for available contact methods

### 🗄️ Multi-Vault
- **Multiple vaults** — create and switch between vaults (e.g., personal, work)
- **Vault selector** — dropdown in the sidebar toolbar
- **Per-vault config** — each vault has its own `.grove/config.json`
- **Per-vault templates** — each vault has its own `.templates/` directory
- **Per-vault contacts** — each vault has its own `.grove/contacts.json`

### 📤 Share
- **Print / Save as PDF** — clean, formatted print view
- **Email** — opens mail client with formatted HTML content auto-copied to clipboard (paste with Cmd+V)
- **Copy as Markdown** — raw markdown to clipboard
- **Copy as HTML** — rendered HTML to clipboard (paste into Gmail, Docs, etc.)
- **Copy link** — copy a deep link to the current note

### 🖼️ Images & Attachments
- **Paste from clipboard** — Ctrl+V an image, auto-uploads to `attachments/`
- **Toolbar upload** — click the image icon to pick files, auto-closes modal and copies markdown to clipboard
- **Image preview modal** — click images in tree to view with proper sizing and copy markdown reference
- **File serving** — `GET /api/file/<path>` serves any file from the vault
- **Right-click delete** — delete images directly from tree via context menu
- **Supported formats** — PNG, JPG, JPEG, GIF, WEBP, SVG, PDF, MP3, MP4, WAV

### 🤖 LLM Assist (Optional)
- **In-editor AI** — select text and run prompts against it (rewrite, summarize, expand, etc.)
- **Model selector** — choose from configured models via dropdown
- **Insert modes** — insert LLM output below selection, replace selection, or at cursor
- **Multi-provider** — supports OpenAI-compatible APIs, Anthropic, and Ollama
- **Privacy-first** — disabled by default, no data leaves your machine unless you configure an external endpoint

### 🎨 Appearance
- **Soft green theme** — dark and light modes with CSS variables
- **Theme toggle** — top-right button to switch between dark and light
- **Fullscreen mode** — distraction-free writing (Ctrl+F or Escape to exit)
- **Collapsible sidebar** — more room for writing
- **Welcome splash** — quick actions when no note is selected
- **Mobile responsive** — hamburger menu, touch-friendly buttons, works on iPhone/Android

### ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+S` | Save note |
| `Ctrl+D` | New daily note |
| `Ctrl+/` | Command Palette |
| `Ctrl+P` | Toggle preview (edit → split → preview) |
| `Ctrl+E` | Switch to edit mode |
| `Ctrl+O` | Quick switcher (open note by name) |
| `Ctrl+K` | Search notes (full-text with #tag filtering) |
| `Ctrl+B` | Bold |
| `Ctrl+I` | Italic |
| `Ctrl+L` | Insert link |
| `Ctrl+M` | New meeting note |
| `Ctrl+C` | Open contacts (when no text selected) |
| `Ctrl+V` | Paste image from clipboard |
| `Ctrl+X` | Delete note (when not in text field) |
| `Ctrl+F` | Toggle fullscreen |
| `Escape` | Exit fullscreen |
| `@` | Trigger contact autocomplete |
| `[[` | Trigger wikilink autocomplete |
| `/` | Trigger slash commands (at start of line) |

## Supported Markdown

Grove uses [Marked.js](https://marked.js.org/) v4.3.0 with GitHub Flavored Markdown (GFM) enabled. All rendering happens client-side in the browser.

### Standard Markdown

| Syntax | Renders as |
|--------|------------|
| `# Heading 1` through `#### Heading 4` | Headings (H1–H4) |
| `**bold**` | **bold** |
| `*italic*` or `_italic_` | *italic* |
| `~~strikethrough~~` | ~~strikethrough~~ |
| `- item` or `* item` | Unordered list |
| `1. item` | Ordered list |
| `> quote` | Blockquote |
| `` `inline code` `` | `inline code` |
| ` ``` ` fenced block ` ``` ` | Code block |
| `[text](url)` | Hyperlink |
| `![alt](url)` | Image |
| `---` | Horizontal rule |

### GFM (GitHub Flavored Markdown)

| Syntax | Renders as |
|--------|------------|
| `\| col \| col \|` | Tables (with header row) |
| `- [ ] task` | Unchecked checkbox |
| `- [x] task` | Checked checkbox |
| `~~deleted~~` | Strikethrough |
| `https://example.com` | Auto-linked URL |

### Grove Extensions

| Syntax | Renders as |
|--------|------------|
| `[[note name]]` | Clickable wikilink (with typeahead) |
| `[^1]` + `[^1]: text` | Footnote with back-link |
| `@name` | Contact mention (autocomplete in editor) |
| `/command` | Slash commands (date, time, code, table, mermaid, etc.) |
| TOC button | Generates linked Table of Contents from H2–H4 |
| ` ```mermaid ` | Mermaid diagrams (flowcharts, sequence, Gantt, pie, ER, git graphs) |
| ` ```js `, ` ```python `, etc. | Syntax-highlighted code blocks (Highlight.js, lazy-loaded) |

### HTML Passthrough

Marked.js passes raw HTML through to the preview. These all work:

| HTML | Use case |
|------|----------|
| `<details><summary>Click</summary>Hidden</details>` | Collapsible section |
| `<kbd>Ctrl</kbd>` | Keyboard key styling |
| `<mark>highlighted</mark>` | Highlighted text |
| `<sup>super</sup>` / `<sub>sub</sub>` | Superscript / subscript |
| `<br>` | Line break |
| `<iframe>`, `<video>`, `<audio>` | Embedded media |

### Not Currently Supported

| Feature | Notes |
|---------|-------|
| LaTeX / Math | `$x^2$` renders as plain text |
| Admonitions / Callouts | Obsidian-style `> [!note]` not supported |
| Multi-paragraph footnotes | Single-line footnote bodies only |

## Installation

### Prerequisites
- Python 3.8+
- pip

### Quick Start

```bash
# Clone the repository
git clone https://github.com/blanzp/grove.git
cd grove

# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate  # Linux/Mac
# or: .venv\Scripts\activate  # Windows

# Install dependencies
pip install -r requirements.txt

# Run the app
python app.py
```

The app starts at **http://localhost:5000**

Your notes are stored at `~/.grove/vaults/` (e.g., `/home/you/.grove/vaults/default/`). Global config lives at `~/.grove/config.json`.

### Running on a Network

By default, Grove binds to `127.0.0.1:5000` (localhost only). To make it accessible from other devices on your network:

```bash
GROVE_HOST=0.0.0.0 python app.py
```

Then open `http://<your-ip>:5000` on your phone or tablet.

### Accessing from Mobile via Tailscale

[Tailscale](https://tailscale.com/) lets you securely access Grove from your phone without exposing it to the public internet. Grove stays bound to `127.0.0.1` and Tailscale handles authentication.

1. **Install Tailscale** on your server and mobile device ([tailscale.com/download](https://tailscale.com/download))
2. **Start Grove** normally (defaults to `127.0.0.1:5000`):
   ```bash
   python app.py
   ```
3. **Expose via Tailscale Serve:**
   ```bash
   tailscale serve 5000
   ```
   This proxies your machine's Tailscale HTTPS address to localhost:5000, accessible only to devices on your tailnet.
4. **Open Grove** on your phone at `https://<machine-name>.<tailnet>.ts.net`

To stop serving:
```bash
tailscale serve 5000 off
```

### Optional: Run as a systemd service (Linux)

Create `/etc/systemd/system/grove.service`:

```
[Unit]
Description=Grove - Markdown Notes App
After=network.target

[Service]
Type=simple
User=<your-username>
WorkingDirectory=/path/to/grove
ExecStart=/path/to/grove/.venv/bin/python app.py
Restart=always
RestartSec=2
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
```

Reload and start:

```
sudo systemctl daemon-reload
sudo systemctl enable --now grove
```

## Usage

### Creating Notes
1. Click the **📄 file icon** in the sidebar toolbar
2. Enter a title, optional tags, and select a template
3. Click **Create**

Notes without a template get `type: note`. Notes created from a template get the matching type (e.g., `type: meeting`).

### Daily Notes
Click the **📅 calendar icon** to create today's note in the `daily/` folder. Uses `vault/.templates/daily.md` if it exists, with `type: daily` in frontmatter.

### Meeting Notes
Click the **🤝 handshake icon** to create a meeting note using the meeting template. You'll be prompted for a meeting name.

- **Filename format:** `meeting-YYYY-MMDD HHMM-my-meeting-name.md` (e.g., `meeting-2026-0214 1430-q1-planning.md`)
- **Title (frontmatter):** `My Meeting Name`

### Planner (Daily & Weekly)
Click the **📆 calendar-alt icon** to open the planner modal and select:
- **Daily Planner**: `daily-planner-YYYY-MM-DD.md` (tags: `planner, daily`)
- **Weekly Planner**: `planner-YYYY-Www.md` using ISO week (tags: `planner, weekly`)

### Templates
Manage templates from the **📋 template icon** in the sidebar toolbar.

Templates are **body-only** — Grove manages all frontmatter (title, created, type, tags).

**Template placeholders:**
- `{{title}}` — Note title
- `{{date}}` — Current date (ISO format)

**Standard templates included:**
- `meeting` — Attendees, Agenda, Notes, Action Items
- `decision` — Context, Options, Decision, Rationale, Consequences
- `research` — Question/Hypothesis, Background, Findings, References
- `reflection` — What happened, What went well, What could be better, Lessons learned
- `daily-planner`, `weekly-planner` — structured planners with time blocks and goals

### Frontmatter
Grove exclusively manages YAML frontmatter. You cannot edit it directly — use the **📜 scroll icon** to preview it read-only. Frontmatter includes:

- `title` — Note title
- `created` — ISO timestamp
- `updated` — ISO timestamp (auto-updated on save)
- `type` — Document type (note, meeting, decision, research, reflection, execution, daily)
- `tags` — YAML array of tags
- `starred` — `true|false` (toggled from the ⭐ button)

### Contacts
Click the **📒 address book icon** to manage contacts.

**Fields:** ID, first name, last name, email, phone, office phone, mobile phone, zoom ID, company, title, department, note, profile selection

**Template Profiles:** Create custom templates for how contacts are rendered. Each profile has:
- **Name template** — format for displaying the name (e.g., `{{first_name}} {{last_name}}`)
- **Email template** — URL pattern (e.g., `mailto:{{email}}`)
- **Phone template** — URL pattern (e.g., `tel:{{phone}}`)
- **Zoom template** — URL pattern (e.g., `https://zoom.us/j/{{zoom_id}}`)
- **Enable/disable** — toggle which methods appear in mentions

**@ Autocomplete:** Type `@` in the editor and start typing. Arrow keys to navigate, Enter/Tab to insert. The contact renders using its profile with Font Awesome icons for available methods.

**Example mention:**
```
Paul Blanz [<i class="fas fa-envelope"></i>](mailto:paul@example.com) [<i class="fas fa-phone"></i>](tel:+1234567890) [<i class="fas fa-video"></i>](https://zoom.us/j/123456)
```

**Search & filter:** Search bar at top of contacts modal filters by name, email, phone, company, or zoom ID in real-time.

**Template placeholders:** `{{id}}`, `{{first_name}}`, `{{last_name}}`, `{{email}}`, `{{phone}}`, `{{zoom_id}}`, `{{company}}`

**Profile management:** Click "Manage Profiles" to create, edit, or delete template profiles. Set one as default for new contacts.

**Bulk import:** Click "Import JSON" and upload a file:
```json
[
  {
    "id": "12345",
    "first_name": "Jane",
    "last_name": "Smith",
    "email": "jane@example.com",
    "phone": "+1234567890",
    "zoom_id": "123456789",
    "company": "Acme",
    "profile_id": "default"
  }
]
```

### Multi-Vault
Use the **vault selector** dropdown in the sidebar toolbar to switch vaults. Click the **folder+ icon** next to it to create a new vault.

Vaults are stored under `~/.grove/vaults/<name>/`. Global config at `~/.grove/config.json` controls the active vault.

### Images & Attachments
- **Paste:** Ctrl+V an image from clipboard — auto-uploads to `attachments/`
- **Toolbar:** Click the image icon → pick a file → uploads and inserts markdown
- **Reference:** `![alt text](/api/file/attachments/photo.png)`
- **Tree:** Click an image in the file tree to copy its markdown reference

### Todo Dashboard
Click the **✅ tasks icon** to see all checkboxes across your vault. Toggle completion directly from the dashboard — changes sync back to the source note.

- Two-column layout: Incomplete (left) and Complete (right)
- Checkboxes use standard markdown format: `- [ ] Task` / `- [x] Done`
- Excludes `.templates/` from scans

**Preview checkboxes:** You can also click checkboxes directly in the preview pane to toggle them. The change saves to the source file and refreshes the note automatically.

### Search
- `Ctrl+K` to focus the search bar
- Type and press Enter to search
- Use the tag dropdown to filter by tag
- Click the **✕** button to clear search
- Excludes `.templates/` from search

### Footnotes
Grove supports standard Markdown footnotes in preview:

```
This needs a citation[^1].

[^1]: Source or explanation goes here.
```

- Inserts superscripted refs in the body with a footnotes section at the bottom
- Includes ↩ back-links from each footnote to its reference
- Currently supports single-line footnote bodies

### Table of Contents
Click the **📋 TOC button** in the markdown toolbar to generate a Table of Contents:

- Scans H2–H4 headings in the current note
- Inserts a linked bullet list at the cursor position
- Click again to update the existing TOC in place
- In preview, clicking a TOC link smooth-scrolls to that heading

## Extracting Notes for LLM Summaries

Grove is designed to work seamlessly with LLMs. Use the Extract feature to generate a clean markdown document you can paste into any AI assistant.

### Using the UI
1. Click **Extract** (sidebar toolbar or splash screen)
2. Pick time range: Last 1/3/6/12 months or All time
3. Scope: **Starred only** (default) or All notes
4. Optional filters: type (meeting/daily/decision/research/reflection/note) and tag
5. Click **Extract** → **Copy** to clipboard
6. Paste into your LLM of choice

### Using the API
```
GET /api/extract?months=3&starred=true&type=meeting,decision&tag=project-x
```
Returns concatenated markdown with title/date headers and bodies only.

### Sample Prompts

**Executive summary:**
> "You are my operations analyst. Summarize the following notes as an executive weekly summary. Prioritize decisions, risks, blockers, deadlines, and action items with owners. Group by week, then by project. Keep it under 300 words. Output sections: Overview, Decisions, Risks/Blockers, Upcoming, Action Items."

**Meeting recap:**
> "Produce a 5-bullet recap of each meeting below, plus a consolidated action list with owners and due dates."

**Project status:**
> "Based on these notes, generate a project status report. Include: progress vs plan, key milestones hit, open risks, and recommended next steps."

### Tips
- ⭐ Star important notes to keep extracts focused
- For large date ranges, run multiple extracts (e.g., per month) to avoid token limits
- Use type filters to extract just meetings, decisions, or research separately
- The JSONL export (`GET /api/export?format=jsonl`) is better for programmatic LLM pipelines

## LLM Assist Configuration

LLM Assist is disabled by default. Enable it by setting environment variables:

```bash
# Required
GROVE_LLM_ENABLED=true
GROVE_LLM_ENDPOINT=https://api.openai.com   # or http://localhost:11434 for Ollama
GROVE_LLM_MODEL=gpt-4o                       # default model
GROVE_LLM_API_KEY=sk-...                      # not needed for Ollama

# Optional
GROVE_LLM_PROVIDER=openai                    # openai (default), anthropic, or ollama
GROVE_LLM_MODELS=gpt-4o,gpt-4o-mini,o1      # comma-separated model list for selector
GROVE_LLM_MAX_TOKENS=800                      # max response tokens
GROVE_LLM_TEMPERATURE=0.3                     # response temperature
```

### Supported Providers

| Provider | `GROVE_LLM_PROVIDER` | `GROVE_LLM_ENDPOINT` | API Key |
|----------|---------------------|----------------------|---------|
| OpenAI | `openai` | `https://api.openai.com` | Required |
| Anthropic | `anthropic` | `https://api.anthropic.com` | Required |
| Ollama (local) | `ollama` | `http://localhost:11434` | Not needed |
| Any OpenAI-compatible | `openai` | Your endpoint URL | Depends |

### Usage

1. Select text in the editor (optional)
2. Click the **🤖 robot icon** or use the toolbar
3. Enter a prompt (e.g., "Summarize", "Rewrite to be concise", "Translate to Spanish")
4. Choose insert mode: **Below selection**, **Replace selection**, or **At cursor**
5. Select a model from the dropdown (if multiple configured)
6. Click **Run**

The system prompt instructs the LLM to respond in valid markdown format.

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GROVE_HOST` | `127.0.0.1` | Bind address (`0.0.0.0` for network access) |
| `GROVE_PORT` | `5000` | Server port |

### Per-Vault Config (`vault/.grove/config.json`)
```json
{
  "default_contact_template": "[{{first_name}} {{last_name}}](mailto:{{email}})"
}
```

### Global Config (`~/.grove/config.json`)
```json
{
  "active_vault": "default"
}
```

## MCP Server

Grove includes an MCP (Model Context Protocol) server that lets LLM clients like Claude Desktop and Claude Code search, read, and create notes in your vault.

The MCP server runs as a separate process and communicates with Grove's REST API over HTTP — it can run on the same machine or a different host.

### Setup

```bash
# Install dependencies (includes mcp package)
pip install -r requirements.txt
```

### Configuration

Set the `GROVE_URL` environment variable to point to your running Grove server:

```bash
# Default (same machine)
export GROVE_URL=http://localhost:5000

# Remote Grove server
export GROVE_URL=http://192.168.1.5:5000
```

### Claude Desktop

Add this to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "grove": {
      "command": "python",
      "args": ["/path/to/grove/mcp_server.py"],
      "env": {
        "GROVE_URL": "http://localhost:5000"
      }
    }
  }
}
```

### Claude Code

Add this to `.mcp.json` in your project or home directory:

```json
{
  "mcpServers": {
    "grove": {
      "command": "python",
      "args": ["/path/to/grove/mcp_server.py"],
      "env": {
        "GROVE_URL": "http://localhost:5000"
      }
    }
  }
}
```

### GitHub Copilot (VS Code)

Add this to `.vscode/mcp.json` in your workspace:

```json
{
  "servers": {
    "grove": {
      "command": "python",
      "args": ["/path/to/grove/mcp_server.py"],
      "env": {
        "GROVE_URL": "http://localhost:5000"
      }
    }
  }
}
```

### OpenAI Codex CLI

Add this to `~/.codex/config.toml` (global) or `.codex/config.toml` (project-scoped):

```toml
[mcp_servers.grove]
command = "python"
args = ["/path/to/grove/mcp_server.py"]

[mcp_servers.grove.env]
GROVE_URL = "http://localhost:5000"
```

### Available Tools

| Tool | Description |
|------|-------------|
| `search_notes` | Search notes by text query and/or tag |
| `read_note` | Read a note's full content and metadata |
| `create_note` | Create a new note with title, content, folder, and tags |
| `list_notes` | List all notes in the active vault |
| `get_tags` | Get all tags with their note counts |

### Resources

| URI | Description |
|-----|-------------|
| `grove://notes` | List of all notes in the active vault |
| `grove://note/{path}` | Individual note content and metadata |

### Testing

```bash
# 1. Start Grove
python app.py

# 2. Test with MCP Inspector
npx @modelcontextprotocol/inspector python mcp_server.py
```

**Note:** The Grove Flask server must be running for the MCP server to work.

## File Structure

```
grove/
├── app.py                  # Flask backend
├── mcp_server.py           # MCP server (proxies Grove API)
├── requirements.txt        # Python dependencies
├── openapi.yaml            # OpenAPI 3.0 spec
├── default-vault/          # Seed files for new vaults
│   ├── .grove/
│   │   └── config.json
│   └── .templates/
│       ├── meeting.md
│       ├── decision.md
│       ├── research.md
│       ├── reflection.md
│       ├── daily.md
│       ├── daily-planner.md
│       └── weekly-planner.md
├── static/
│   ├── css/
│   │   ├── style.css       # Main styles + CSS variables
│   │   └── theme.css       # Theme-specific overrides
│   ├── js/
│   │   └── app.js          # Frontend application
│   ├── grove-logo.png      # App logo
│   └── favicon.ico         # Browser favicon
└── templates/
    └── index.html          # Main HTML template
```

Vault data (created at runtime):
```
~/.grove/
├── config.json             # Global config (active vault name)
└── vaults/
    ├── default/            # Default vault
    │   ├── .grove/
    │   │   ├── config.json     # Per-vault config
    │   │   └── contacts.json   # Contacts database
    │   ├── .templates/         # Note templates
    │   ├── attachments/        # Uploaded images & files
    │   ├── daily/              # Daily notes
    │   ├── meetings/           # Meeting notes
    │   ├── planning/           # Planner notes
    │   └── README.md
    └── work/               # Additional vaults
        └── ...
```

## API

Full OpenAPI 3.0 spec: [`openapi.yaml`](openapi.yaml) — browse in [Swagger Editor](https://editor.swagger.io)

| Method | Endpoint | Description |
|--------|----------|-------------|
| **Notes** | | |
| `GET` | `/api/tree` | Get vault directory tree (all files) |
| `GET` | `/api/note/<path>` | Get note content + metadata (includes `starred`) |
| `PUT` | `/api/note/<path>` | Save note content (adds `updated` timestamp) |
| `POST` | `/api/note` | Create new note (with optional template) |
| `DELETE` | `/api/note/<path>` | Delete a note |
| `PUT` | `/api/note/<path>/tags` | Update note tags |
| `PUT` | `/api/note/<path>/rename` | Rename a note |
| `POST` | `/api/note/<path>/star` | Toggle `starred` in frontmatter |
| **Folders** | | |
| `POST` | `/api/folder` | Create new folder |
| `GET` | `/api/folders` | List all folders in vault |
| `DELETE` | `/api/folder/<path>` | Delete a folder and contents |
| `POST` | `/api/move` | Move a file |
| `POST` | `/api/move-folder` | Move a folder |
| `POST` | `/api/rename` | Rename a file |
| **Daily & Templates** | | |
| `POST` | `/api/daily` | Create daily note |
| `GET` | `/api/templates` | List templates |
| `POST` | `/api/template` | Create template |
| `PUT` | `/api/template/<name>` | Update template |
| `DELETE` | `/api/template/<name>` | Delete template |
| **Search & Tags** | | |
| `GET` | `/api/search?q=<query>&tag=<tag>` | Search notes (excludes `.templates/`) |
| `GET` | `/api/tags` | Get all tags with counts |
| **Todos** | | |
| `GET` | `/api/todos` | Get all checkboxes (excludes `.templates/`) |
| `POST` | `/api/toggle-todo` | Toggle a checkbox |
| **Files & Images** | | |
| `GET` | `/api/file/<path>` | Serve any file from vault |
| `POST` | `/api/upload` | Upload file (multipart form) |
| `POST` | `/api/upload/bulk` | Upload multiple files |
| `POST` | `/api/upload/paste` | Upload pasted image (base64) |
| **Contacts** | | |
| `GET` | `/api/contacts` | List all contacts |
| `POST` | `/api/contacts` | Add a contact |
| `PUT` | `/api/contacts/<id>` | Update a contact |
| `DELETE` | `/api/contacts/<id>` | Delete a contact |
| `POST` | `/api/contacts/import` | Bulk import contacts (JSON array) |
| **Vaults** | | |
| `GET` | `/api/vaults` | List vaults + active vault |
| `POST` | `/api/vaults/create` | Create new vault |
| `POST` | `/api/vaults/switch` | Switch active vault |
| `POST` | `/api/vaults/delete` | Delete a vault |
| `GET` | `/api/vaults/export` | Export active vault as ZIP |
| **Graph & Backlinks** | | |
| `GET` | `/api/backlinks/<path>` | Get notes linking to this note |
| `GET` | `/api/graph` | Get graph data (nodes + edges) |
| `GET` | `/api/wikilink-map` | Get title/filename → path mapping |
| `GET` | `/api/calendar` | Get dated notes for calendar view |
| **Config** | | |
| `GET` | `/api/config` | Get per-vault config |
| `PUT` | `/api/config` | Update per-vault config |
| **LLM** | | |
| `GET` | `/api/llm/status` | LLM config status (enabled, provider, models) |
| `POST` | `/api/llm` | Generate LLM response (`prompt`, `selection`, `model`) |
| **Export** | | |
| `GET` | `/api/export?format=jsonl&since=<ISO>` | Export vault notes (JSONL/JSON; incremental via `since`) |
| `GET` | `/api/extract?months=<n\|all>&starred=<bool>&type=a,b&tag=x` | Concatenate notes for LLM input |

## Tech Stack

- **Backend:** Flask (Python) — single dependency
- **Frontend:** Vanilla JavaScript (no frameworks)
- **Markdown Rendering:** [Marked.js](https://marked.js.org/) v4.3.0 (GFM enabled)
- **Syntax Highlighting:** [Highlight.js](https://highlightjs.org/) (lazy-loaded)
- **Diagrams:** [Mermaid.js](https://mermaid.js.org/) v10 (flowcharts, sequence, Gantt, pie, ER, C4, etc.)
- **Graph View:** [Vis.js Network](https://visjs.github.io/vis-network/)
- **Icons:** [Font Awesome](https://fontawesome.com/) 6.4.0
- **Styling:** CSS custom properties for theming
- **Storage:** Flat markdown files — no database

## License

MIT
