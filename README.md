# 🌲 Grove

A beautiful, lightweight markdown notes app with a VS Code-inspired interface. Organize your thoughts in a personal knowledge grove.

![Grove](static/grove-logo.png)

## Features

### 📝 Editor
- **Markdown editor** with live preview (edit, split, or preview mode)
- **Markdown toolbar** — Bold, italic, headings, lists, checkboxes, links, images, code blocks, blockquotes, wikilinks
- **Auto-save** with 2-second debounce — never lose work
- **Frontmatter toggle** — show/hide YAML frontmatter in the editor
- **Wikilinks** — clickable `[[note]]` links to navigate between notes

### 📂 File Management
- **File tree** sidebar with folder navigation
- **Drag & drop** files and folders to reorganize
- **Import** — drop `.md` or `.txt` files to import into your vault
- **Recent files** panel for quick access
- **Search** by note name or content
- **Create, rename, delete** notes and folders

### 🏷️ Organization
- **Tag management** — add/remove tags via modal, stored as YAML frontmatter
- **Tag filter** — filter notes by tag from the sidebar dropdown
- **Daily notes** — one-click daily log creation in `daily/` folder
- **Templates** — create, edit, and delete note templates from the UI
- **Todo dashboard** — scan all notes for checkboxes, toggle completion, click to navigate to source note

### 🎨 Appearance
- **Soft green theme** — dark and light modes
- **Theme toggle** — switch between dark and light with one click
- **Fullscreen mode** — distraction-free writing (F11 or Escape to exit)
- **Collapsible sidebar** — more room for writing
- **Mobile responsive** — hamburger menu, touch-friendly buttons, works on iPhone/Android

### ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+S` | Save note |
| `Ctrl+N` | New note |
| `Ctrl+P` | Toggle preview |
| `Ctrl+K` | Focus search |
| `Ctrl+B` | Bold |
| `Ctrl+I` | Italic |
| `Ctrl+L` | Insert link |
| `F2` | Rename note |
| `Delete` | Delete note |
| `F11` | Toggle fullscreen |
| `Escape` | Exit fullscreen |

## Installation

### Prerequisites
- Python 3.8+
- pip

### Quick Start

```bash
# Clone the repository
git clone https://github.com/blanzp/mdvault-web.git
cd mdvault-web

# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # Linux/Mac
# or: venv\Scripts\activate  # Windows

# Install dependencies
pip install -r requirements.txt

# Run the app
python app.py
```

The app starts at **http://localhost:5000**

### Running on a Network

By default, Grove binds to `0.0.0.0:5000`, so it's accessible from other devices on your network. Open `http://<your-ip>:5000` on your phone or tablet.

## Usage

### Creating Notes
1. Click the **📄 file icon** in the sidebar toolbar
2. Enter a title, optional tags, and select a template
3. Click **Create**

### Daily Notes
Click the **📅 calendar icon** to create today's note in the `daily/` folder. Uses the daily template if one exists.

### Templates
Manage templates from the **📋 template icon** in the sidebar toolbar.

**Template placeholders:**
- `{{title}}` — Note title
- `{{date}}` — Current date (ISO format)

**Example template** (`vault/.templates/meeting.md`):
```markdown
---
title: {{title}}
created: {{date}}
tags:
  - meeting
---

# {{title}}

## Attendees

## Agenda

## Notes

## Action Items

- [ ] 
```

### Todo Dashboard
Click the **✅ tasks icon** to see all checkboxes across your vault. Toggle completion directly from the dashboard — changes sync back to the source note.

### Tag Management
Click the **🏷️ Tags** button when viewing a note to add or remove tags. Tags are stored in the note's YAML frontmatter.

### Markdown Toolbar
The formatting toolbar sits above the editor. Select text and click a button to wrap it, or click to insert a placeholder. Especially useful on mobile.

### Search
- `Ctrl+K` to focus the search bar
- Type and press Enter to search
- Use the tag dropdown to filter by tag
- Click the **✕** button to clear search

## File Structure

```
grove/
├── app.py                  # Flask backend
├── requirements.txt        # Python dependencies
├── vault/                  # Your markdown notes
│   ├── .templates/         # Note templates
│   └── daily/              # Daily notes
├── static/
│   ├── css/
│   │   ├── style.css       # Main styles + CSS variables
│   │   └── theme.css       # Theme-specific overrides
│   ├── js/
│   │   └── app.js          # Frontend application
│   ├── grove-logo.png      # App logo
│   ├── favicon.ico         # Browser favicon
│   └── apple-touch-icon.png
└── templates/
    └── index.html          # Main HTML template
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tree` | Get vault directory tree |
| `GET` | `/api/note/<path>` | Get note content + metadata |
| `PUT` | `/api/note/<path>` | Save note content |
| `POST` | `/api/note` | Create new note |
| `DELETE` | `/api/note/<path>` | Delete a note |
| `PUT` | `/api/note/<path>/tags` | Update note tags |
| `PUT` | `/api/note/<path>/rename` | Rename a note |
| `POST` | `/api/folder` | Create new folder |
| `POST` | `/api/daily` | Create daily note |
| `POST` | `/api/move` | Move a file |
| `POST` | `/api/move-folder` | Move a folder |
| `POST` | `/api/rename` | Rename a file |
| `GET` | `/api/search?q=<query>&tag=<tag>` | Search notes |
| `GET` | `/api/tags` | Get all tags with counts |
| `GET` | `/api/templates` | List templates |
| `POST` | `/api/template` | Create/update template |
| `DELETE` | `/api/template/<name>` | Delete template |
| `GET` | `/api/todos` | Get all checkboxes across vault |
| `POST` | `/api/toggle-todo` | Toggle a checkbox |
| `POST` | `/api/upload` | Upload file via drag & drop |

## Tech Stack

- **Backend:** Flask (Python)
- **Frontend:** Vanilla JavaScript (no frameworks)
- **Markdown Rendering:** [Marked.js](https://marked.js.org/) v4.3.0
- **Icons:** [Font Awesome](https://fontawesome.com/) 6.4.0
- **Styling:** CSS custom properties for theming

## License

MIT
