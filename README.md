# MDVault Web

A web-based markdown vault manager with a clean VS Code-inspired interface.

## Features

- 📂 **File Tree Navigation** - Browse folders and notes in left sidebar
- ✍️ **Markdown Editor** - Edit notes with syntax highlighting
- 🏷️ **Tagging System** - Organize with tags and filter by tag
- 🔍 **Search** - Find notes by name or content
- 📅 **Daily Notes** - Quick daily log creation
- 📋 **Templates** - Create notes from templates
- 🎯 **Drag & Drop** - Drop markdown files to import
- 💾 **Auto-save** - Ctrl+S to save quickly

## Installation

```bash
# Install dependencies
pip install -r requirements.txt

# Run the app
python app.py
```

The app will start on `http://localhost:5000`

## Usage

### Creating Notes

1. Click the **file icon** in the toolbar to create a new note
2. Enter title and optional tags
3. Select a template (optional)
4. Click **Create**

### Creating Folders

1. Click the **folder+ icon** in the toolbar
2. Enter folder name
3. Click **Create**

### Daily Notes

Click the **calendar icon** to create today's daily note in the `daily/` folder.

### Searching

- Type in the search bar and press Enter or click search
- Filter by tag using the dropdown below search
- Clear search to return to full tree view

### Drag & Drop

Drag `.md` or `.txt` files into the editor area to import them into your vault.

### Templates

Place template files in `vault/.templates/` with placeholders:
- `{{title}}` - Note title
- `{{date}}` - Current date

Example template (`vault/.templates/meeting.md`):

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

## Keyboard Shortcuts

- `Ctrl+S` - Save current note

## File Structure

```
mdvault-web/
├── app.py              # Flask backend
├── requirements.txt    # Python dependencies
├── vault/              # Your markdown notes
│   ├── .templates/     # Note templates
│   └── daily/          # Daily notes
├── static/
│   ├── css/
│   │   └── style.css
│   └── js/
│       └── app.js
└── templates/
    └── index.html
```

## API Endpoints

- `GET /api/tree` - Get vault directory tree
- `GET /api/note/<path>` - Get note content
- `PUT /api/note/<path>` - Save note content
- `POST /api/note` - Create new note
- `POST /api/folder` - Create new folder
- `POST /api/daily` - Create daily note
- `GET /api/search?q=<query>&tag=<tag>` - Search notes
- `GET /api/tags` - Get all tags with counts
- `GET /api/templates` - Get available templates
- `POST /api/upload` - Upload file via drag & drop

## Technologies

- **Backend**: Flask (Python)
- **Frontend**: Vanilla JavaScript
- **UI**: Custom CSS (VS Code-inspired dark theme)
- **Markdown**: Marked.js
- **Icons**: Font Awesome

## License

MIT
