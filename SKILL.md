---
name: grove-api
description: Read, write, search, star, and extract notes from a Grove markdown vault via its REST API. Use when the agent needs persistent memory, note-taking, knowledge management, meeting logs, or to extract notes for LLM summarization.
---

# Grove API Skill

Integrate your AI agent with [Grove](https://github.com/blanzp/grove) — a self-hosted markdown knowledge base with zero external dependencies.

## Setup

```bash
# Check if Grove is running
curl -s http://localhost:5000/api/vaults

# If not running, clone and start:
git clone https://github.com/blanzp/grove.git
cd grove
python -m venv .venv && source .venv/bin/activate
pip install flask
python app.py
```

Or install as a systemd service (Linux):
```bash
bash scripts/install.sh --systemd
```

Default: `http://localhost:5000` (loopback only for security).

## Configuration

| Variable | Default | Description |
|---|---|---|
| `GROVE_HOST` | `127.0.0.1` | Bind address. Set `0.0.0.0` for LAN access |
| `GROVE_PORT` | `5000` | Port number |

For secure remote access, use [Tailscale Serve](https://tailscale.com/kb/1242/tailscale-serve):
```bash
tailscale serve --bg 5000
```

## API Quick Reference

Base URL: `http://localhost:5000` (or set `GROVE_URL` env var)

### Vault Management

```bash
# List vaults and active vault
curl "$GROVE/api/vaults"

# Create vault
curl -X POST "$GROVE/api/vaults/create" \
  -H 'Content-Type: application/json' \
  -d '{"name":"work"}'

# Switch active vault
curl -X POST "$GROVE/api/vaults/switch" \
  -H 'Content-Type: application/json' \
  -d '{"name":"work"}'

# Export vault as ZIP backup
curl "$GROVE/api/vaults/export" -o vault.zip
```

### Notes — CRUD

```bash
# List vault file tree
curl "$GROVE/api/tree"

# Get a note (returns JSON with content, tags, frontmatter)
curl "$GROVE/api/note/daily/2026-02-15.md"

# Create a note
curl -X POST "$GROVE/api/note" \
  -H 'Content-Type: application/json' \
  -d '{"title":"My Note","tags":["tag1","tag2"],"folder":"research","template":"","filename":""}'

# Save/update note content
curl -X PUT "$GROVE/api/note/research/my-note.md" \
  -H 'Content-Type: application/json' \
  -d '{"content":"---\ntitle: My Note\ntags:\n  - tag1\n---\n\n# My Note\n\nContent here."}'

# Delete a note
curl -X DELETE "$GROVE/api/note/research/my-note.md"

# Rename a note
curl -X POST "$GROVE/api/rename" \
  -H 'Content-Type: application/json' \
  -d '{"path":"old-name.md","name":"new-name"}'

# Move a note to another folder
curl -X POST "$GROVE/api/move" \
  -H 'Content-Type: application/json' \
  -d '{"source":"my-note.md","destination":"archive/my-note.md"}'
```

### Daily, Meeting & Planner Notes

```bash
# Create today's daily note
curl -X POST "$GROVE/api/daily"

# Create meeting note
curl -X POST "$GROVE/api/note" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Q1 Planning","tags":["meeting"],"folder":"meetings","template":"meeting"}'

# Create daily planner
curl -X POST "$GROVE/api/note" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Daily Planner","tags":["planner"],"folder":"planning","template":"daily-planner"}'

# Create weekly planner
curl -X POST "$GROVE/api/note" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Weekly Planner","tags":["planner"],"folder":"planning","template":"weekly-planner"}'
```

### Star & Tags

```bash
# Toggle star on a note
curl -X POST "$GROVE/api/note/important-note.md/star"

# Update tags
curl -X PUT "$GROVE/api/note/my-note.md/tags" \
  -H 'Content-Type: application/json' \
  -d '{"tags":["project-x","meeting"]}'

# Get all tags with counts
curl "$GROVE/api/tags"
```

### Search

```bash
# Search by content
curl "$GROVE/api/search?q=budget"

# Search by tag
curl "$GROVE/api/search?tag=meeting"

# Search by content + tag
curl "$GROVE/api/search?q=planning&tag=project-x"
```

### Backlinks & Graph

```bash
# Get backlinks for a note
curl "$GROVE/api/backlinks/research/my-note.md"

# Get full graph data (nodes + edges from wikilinks)
curl "$GROVE/api/graph"

# Get wikilink map (for autocomplete)
curl "$GROVE/api/wikilink-map"
```

### Extract (LLM-Ready Output)

Extract concatenated markdown — ideal for feeding into an LLM for summarization.

```bash
# Starred notes from last 3 months
curl "$GROVE/api/extract?months=3"

# All notes, filtered by type and tag
curl "$GROVE/api/extract?months=6&starred=false&type=meeting,decision&tag=project-x"

# Everything in the vault
curl "$GROVE/api/extract?months=all&starred=false"
```

### Export (JSONL for Pipelines)

```bash
# Full vault as JSONL
curl "$GROVE/api/export?format=jsonl"

# Incremental export (notes modified since timestamp)
curl "$GROVE/api/export?format=jsonl&since=2026-02-01T00:00:00"
```

### Upload Files

```bash
# Upload a single file
curl -X POST "$GROVE/api/upload" \
  -F "file=@image.png" -F "folder=attachments"

# Bulk upload multiple files
curl -X POST "$GROVE/api/upload/bulk" \
  -F "files=@note1.md" -F "files=@note2.md" -F "folder=imported"

# List folders (for upload target selection)
curl "$GROVE/api/folders"
```

### Contacts

```bash
# List contacts
curl "$GROVE/api/contacts"

# Add contact
curl -X POST "$GROVE/api/contacts" \
  -H 'Content-Type: application/json' \
  -d '{"first_name":"Jane","last_name":"Smith","email":"jane@example.com","company":"Acme"}'
```

### Todos

```bash
# Get all todos across vault
curl "$GROVE/api/todos"

# Toggle a todo checkbox
curl -X POST "$GROVE/api/toggle-todo" \
  -H 'Content-Type: application/json' \
  -d '{"path":"daily/2026-02-16.md","line":5}'
```

### Calendar

```bash
# Get calendar data for a month (notes by date)
curl "$GROVE/api/calendar?year=2026&month=2"
```

## Frontmatter

Grove auto-manages frontmatter. When creating notes, it generates:
- `title`, `created`, `type`, `tags`, `updated`, `starred`

Tags support multiple formats:
```yaml
# YAML list
tags:
  - tag1
  - tag2

# Inline array
tags: [tag1, tag2]

# Comma-separated
tags: tag1, tag2
```

## Built-in Templates

Every vault includes these templates:
- `meeting` — Attendees, Agenda, Notes, Action Items
- `decision` — Context, Options, Decision, Rationale
- `research` — Question, Background, Findings, References
- `reflection` — What happened, What went well, Lessons
- `daily-planner` — Big 3, Time Blocks, Tasks, EOD Review
- `weekly-planner` — Week Goals, Deliverables, Calendar, Friday Review
- `daily` — Daily note with tasks and journal sections

## Agent Integration Patterns

### Persistent Memory
Use Grove as your agent's long-term memory. Save decisions, context, and learnings as notes. Star important ones. Use extract to recall context.

### Meeting Workflow
1. `POST /api/note` with meeting template before meeting
2. `PUT /api/note/<path>` to update with notes
3. `POST /api/note/<path>/star` if key decisions made
4. `GET /api/extract?type=meeting&months=1` for monthly summary

### Knowledge Pipeline
1. Agent saves research/findings to Grove daily
2. Stars key documents
3. Weekly: extract starred → summarize with LLM → save summary back
4. Monthly: extract all → generate report

### Save a Web Link as a Note
```bash
# Fetch page content, then save to Grove
curl -X POST "$GROVE/api/note" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Article Title","tags":["research","saved-link"],"folder":"research"}'
# Then PUT the content with the URL and summary
```
