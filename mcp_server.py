"""
Grove MCP Server — Expose Grove vault data to MCP clients.

Proxies Grove's REST API over HTTP so it can run on a different host.
Configure via GROVE_URL env variable (default: http://localhost:5000).
Requires the Grove Flask server to be running.

Every tool accepts an optional `vault` parameter to target a specific vault
without affecting the active vault used by the UI. When omitted, the server's
active vault is used.
"""

import json
import os
import urllib.request
import urllib.error
import urllib.parse
from mcp.server.fastmcp import FastMCP

GROVE_URL = os.environ.get("GROVE_URL", "http://localhost:5000").rstrip("/")

mcp = FastMCP(
    "Grove",
    instructions=(
        "Grove is a self-hosted markdown knowledge base. "
        "Use these tools to manage notes, folders, templates, contacts, "
        "todos, vaults, and more. Pass the `vault` parameter to target a "
        "specific vault without affecting the UI's active vault.\n\n"
        "Notes use markdown with YAML frontmatter (managed by Grove automatically). "
        "You can link between notes using wikilinks: [[Note Title]] or [[folder/note]]. "
        "Wikilinks resolve by title, filename, or path (case-insensitive). "
        "Use #tags in frontmatter for categorization. "
        "Checkboxes (- [ ] task) are tracked as todos across the vault. "
        "Mermaid diagrams are supported in fenced code blocks (```mermaid).\n\n"
        "Templates are reusable note skeletons stored in the vault's .templates/ folder. "
        "Built-in templates: daily, daily-planner, weekly-planner, meeting, decision, "
        "research, reflection. Pass a template name to create_note to pre-fill the note "
        "body. Templates support {{title}} and {{date}} placeholders. "
        "Use list_templates and get_template to discover available templates.\n\n"
        "Search uses hybrid keyword + semantic matching when GROVE_SEMANTIC_SEARCH=true "
        "is set on the server. Semantic search finds conceptually related notes even when "
        "exact keywords don't match. Results are ranked by relevance score."
    ),
)


# ── Helpers ──────────────────────────────────────────────────────────────────


def _v(endpoint: str, vault: str = "") -> str:
    """Append ?vault=name to an endpoint if vault is specified."""
    if not vault:
        return endpoint
    sep = "&" if "?" in endpoint else "?"
    return f"{endpoint}{sep}vault={urllib.parse.quote(vault, safe='')}"


def _grove_get(endpoint: str) -> dict | list | str:
    """GET request to the Grove API. Returns parsed JSON."""
    url = f"{GROVE_URL}{endpoint}"
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req) as resp:
            ct = resp.headers.get("Content-Type", "")
            body = resp.read().decode()
            if "json" in ct:
                return json.loads(body)
            return body
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            return {"error": f"HTTP {e.code}: {body}"}
    except urllib.error.URLError as e:
        return {"error": f"Cannot reach Grove at {GROVE_URL}: {e.reason}"}


def _grove_request(endpoint: str, data: dict | list, method: str = "POST") -> dict:
    """Send a JSON request to the Grove API. Returns parsed JSON."""
    url = f"{GROVE_URL}{endpoint}"
    payload = json.dumps(data).encode()
    req = urllib.request.Request(url, data=payload, method=method)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            return {"error": f"HTTP {e.code}: {body}"}
    except urllib.error.URLError as e:
        return {"error": f"Cannot reach Grove at {GROVE_URL}: {e.reason}"}


def _grove_post(endpoint: str, data: dict | list) -> dict:
    return _grove_request(endpoint, data, method="POST")


def _grove_put(endpoint: str, data: dict) -> dict:
    return _grove_request(endpoint, data, method="PUT")


def _grove_delete(endpoint: str) -> dict:
    """DELETE request to the Grove API. Returns parsed JSON."""
    url = f"{GROVE_URL}{endpoint}"
    req = urllib.request.Request(url, method="DELETE")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            return {"error": f"HTTP {e.code}: {body}"}
    except urllib.error.URLError as e:
        return {"error": f"Cannot reach Grove at {GROVE_URL}: {e.reason}"}


def _flatten_tree(nodes: list, prefix: str = "") -> list[dict]:
    """Flatten the nested vault tree into a flat list of files."""
    items = []
    for node in nodes:
        if node["type"] == "folder":
            items.extend(_flatten_tree(node.get("children", []), node["path"]))
        elif node["type"] == "file":
            items.append({"name": node["name"], "path": node["path"]})
    return items


def _json(data) -> str:
    return json.dumps(data, indent=2)


# ── Notes ────────────────────────────────────────────────────────────────────


@mcp.tool()
def search_notes(query: str = "", tag: str = "", vault: str = "") -> str:
    """Search notes by text and/or tag.

    Args:
        query: Text to search for in note titles and content.
        tag: Filter results to notes with this tag.
        vault: Target vault name (default: active vault).

    Returns:
        JSON array of matching notes with path, title, and tags.
    """
    params = {}
    if query:
        params["q"] = query
    if tag:
        params["tag"] = tag
    qs = urllib.parse.urlencode(params)
    endpoint = f"/api/search?{qs}" if qs else "/api/search"
    return _json(_grove_get(_v(endpoint, vault)))


@mcp.tool()
def read_note(path: str, vault: str = "") -> str:
    """Read a note's full content and metadata.

    Args:
        path: Relative path to the note (e.g. 'daily/2024-01-15.md').
        vault: Target vault name (default: active vault).

    Returns:
        JSON object with path, title, tags, content, body, and starred status.
    """
    encoded = urllib.parse.quote(path, safe="")
    return _json(_grove_get(_v(f"/api/note/{encoded}", vault)))


@mcp.tool()
def create_note(
    title: str,
    content: str = "",
    folder: str = "",
    tags: list[str] | None = None,
    template: str = "",
    filename: str = "",
    vault: str = "",
) -> str:
    """Create a new note in the vault.

    Use [[Note Title]] wikilinks in content to link to other notes.
    Use - [ ] for todo items. Grove adds frontmatter automatically.

    Args:
        title: Note title.
        content: Optional markdown body.
        folder: Optional subfolder to place the note in.
        tags: Optional list of tags.
        template: Optional template name to use (e.g. 'meeting', 'decision').
        filename: Optional custom filename (without .md extension).
        vault: Target vault name (default: active vault).

    Returns:
        JSON object with success status and path of the created note.
    """
    data: dict = {"title": title}
    if folder:
        data["folder"] = folder
    if tags:
        data["tags"] = tags
    if template:
        data["template"] = template
    if filename:
        data["filename"] = filename
    result = _grove_post(_v("/api/note", vault), data)

    if content and result.get("success") and result.get("path"):
        note_path = result["path"]
        encoded = urllib.parse.quote(note_path, safe="")
        note = _grove_get(_v(f"/api/note/{encoded}", vault))
        existing = note.get("content", "")
        full_content = existing.rstrip("\n") + "\n" + content + "\n"
        _grove_put(_v(f"/api/note/{note_path}", vault), {"content": full_content})

    return _json(result)


@mcp.tool()
def update_note(path: str, content: str, vault: str = "") -> str:
    """Update a note's content.

    Use [[Note Title]] wikilinks to link between notes.
    Use - [ ] for todo items and - [x] for completed todos.

    Args:
        path: Relative path to the note (e.g. 'daily/2024-01-15.md').
        content: Full note content including frontmatter.
        vault: Target vault name (default: active vault).

    Returns:
        JSON object with success status and path.
    """
    return _json(_grove_put(_v(f"/api/note/{path}", vault), {"content": content}))


@mcp.tool()
def delete_note(path: str, vault: str = "") -> str:
    """Delete a note from the vault.

    Args:
        path: Relative path to the note to delete.
        vault: Target vault name (default: active vault).

    Returns:
        JSON object with success status.
    """
    encoded = urllib.parse.quote(path, safe="")
    return _json(_grove_delete(_v(f"/api/note/{encoded}", vault)))


@mcp.tool()
def rename_note(path: str, new_name: str, vault: str = "") -> str:
    """Rename a note (updates filename and title in frontmatter).

    Args:
        path: Current relative path to the note.
        new_name: New name for the note (without .md extension).
        vault: Target vault name (default: active vault).

    Returns:
        JSON object with success status and new path.
    """
    encoded = urllib.parse.quote(path, safe="")
    return _json(_grove_put(_v(f"/api/note/{encoded}/rename", vault), {"name": new_name}))


@mcp.tool()
def move_note(source: str, target: str = "", vault: str = "") -> str:
    """Move a note to a different folder.

    Args:
        source: Source file path.
        target: Target folder path (empty string for vault root).
        vault: Target vault name (default: active vault).

    Returns:
        JSON object with success status and new path.
    """
    return _json(_grove_post(_v("/api/move", vault), {"source": source, "target": target}))


@mcp.tool()
def toggle_star(path: str, vault: str = "") -> str:
    """Toggle the starred status of a note.

    Args:
        path: Relative path to the note.
        vault: Target vault name (default: active vault).

    Returns:
        JSON object with success status and new starred boolean.
    """
    encoded = urllib.parse.quote(path, safe="")
    return _json(_grove_post(_v(f"/api/note/{encoded}/star", vault), {}))


@mcp.tool()
def update_tags(path: str, tags: list[str], vault: str = "") -> str:
    """Update the tags on a note.

    Args:
        path: Relative path to the note.
        tags: New list of tags to set.
        vault: Target vault name (default: active vault).

    Returns:
        JSON object with success status.
    """
    encoded = urllib.parse.quote(path, safe="")
    return _json(_grove_put(_v(f"/api/note/{encoded}/tags", vault), {"tags": tags}))


@mcp.tool()
def list_notes(vault: str = "") -> str:
    """List all notes in the vault.

    Args:
        vault: Target vault name (default: active vault).

    Returns:
        JSON array of notes with name and path.
    """
    tree = _grove_get(_v("/api/tree", vault))
    if isinstance(tree, dict) and "error" in tree:
        return _json(tree)
    return _json(_flatten_tree(tree))


@mcp.tool()
def get_tree(vault: str = "") -> str:
    """Get the full vault directory tree including folders and assets.

    Args:
        vault: Target vault name (default: active vault).

    Returns:
        JSON array of TreeItem objects with nested children.
    """
    return _json(_grove_get(_v("/api/tree", vault)))


# ── Folders ──────────────────────────────────────────────────────────────────


@mcp.tool()
def list_folders(vault: str = "") -> str:
    """List all folders in the vault.

    Args:
        vault: Target vault name (default: active vault).

    Returns:
        JSON array of folder path strings.
    """
    return _json(_grove_get(_v("/api/folders", vault)))


@mcp.tool()
def create_folder(name: str, parent: str = "", vault: str = "") -> str:
    """Create a new folder in the vault.

    Args:
        name: Folder name.
        parent: Optional parent folder path.
        vault: Target vault name (default: active vault).

    Returns:
        JSON object with success status and path.
    """
    data: dict = {"name": name}
    if parent:
        data["parent"] = parent
    return _json(_grove_post(_v("/api/folder", vault), data))


@mcp.tool()
def delete_folder(path: str, vault: str = "") -> str:
    """Delete a folder from the vault.

    Args:
        path: Folder path relative to vault root.
        vault: Target vault name (default: active vault).

    Returns:
        JSON object with success status.
    """
    encoded = urllib.parse.quote(path, safe="")
    return _json(_grove_delete(_v(f"/api/folder/{encoded}", vault)))


@mcp.tool()
def move_folder(source: str, target: str = "", vault: str = "") -> str:
    """Move a folder to another location.

    Args:
        source: Source folder path.
        target: Target parent folder path (empty string for vault root).
        vault: Target vault name (default: active vault).

    Returns:
        JSON object with success status and new path.
    """
    return _json(_grove_post(_v("/api/move-folder", vault), {"source": source, "target": target}))


@mcp.tool()
def rename_file(old_path: str, new_name: str, vault: str = "") -> str:
    """Rename a file.

    Args:
        old_path: Current path of the file.
        new_name: New name for the file.
        vault: Target vault name (default: active vault).

    Returns:
        JSON object with success status and new path.
    """
    return _json(_grove_post(_v("/api/rename", vault), {"old_path": old_path, "new_name": new_name}))


@mcp.tool()
def rename_folder(path: str, name: str, vault: str = "") -> str:
    """Rename a folder in place.

    Args:
        path: Current folder path relative to vault root.
        name: New folder name.
        vault: Target vault name (default: active vault).

    Returns:
        JSON object with success status and new path.
    """
    return _json(_grove_post(_v("/api/rename-folder", vault), {"path": path, "name": name}))


# ── Search & Tags ────────────────────────────────────────────────────────────


@mcp.tool()
def get_tags(vault: str = "") -> str:
    """Get all tags in the vault with their note counts.

    Args:
        vault: Target vault name (default: active vault).

    Returns:
        JSON object mapping tag names to counts.
    """
    return _json(_grove_get(_v("/api/tags", vault)))


# ── Graph & Links ────────────────────────────────────────────────────────────


@mcp.tool()
def get_backlinks(path: str, vault: str = "") -> str:
    """Get all notes that link to a given note via wikilinks.

    Args:
        path: Note path relative to vault root.
        vault: Target vault name (default: active vault).

    Returns:
        JSON object with note info, backlinks array, and count.
    """
    encoded = urllib.parse.quote(path, safe="")
    return _json(_grove_get(_v(f"/api/backlinks/{encoded}", vault)))


@mcp.tool()
def get_graph(vault: str = "") -> str:
    """Get the full note graph (nodes and wikilink edges) for visualization.

    Args:
        vault: Target vault name (default: active vault).

    Returns:
        JSON object with nodes array and edges array.
    """
    return _json(_grove_get(_v("/api/graph", vault)))


@mcp.tool()
def get_wikilink_map(vault: str = "") -> str:
    """Get the wikilink resolution map (title/name to file path).

    Args:
        vault: Target vault name (default: active vault).

    Returns:
        JSON object mapping lowercased titles/filenames to vault-relative paths.
    """
    return _json(_grove_get(_v("/api/wikilink-map", vault)))


# ── Templates ────────────────────────────────────────────────────────────────


@mcp.tool()
def list_templates(vault: str = "") -> str:
    """List all note templates.

    Args:
        vault: Target vault name (default: active vault).

    Returns:
        JSON array of templates with name and path.
    """
    return _json(_grove_get(_v("/api/templates", vault)))


@mcp.tool()
def get_template(name: str, vault: str = "") -> str:
    """Get a template's content.

    Args:
        name: Template name (e.g. 'meeting', 'decision').
        vault: Target vault name (default: active vault).

    Returns:
        JSON object with name and content.
    """
    encoded = urllib.parse.quote(name, safe="")
    return _json(_grove_get(_v(f"/api/template/{encoded}", vault)))


@mcp.tool()
def create_template(name: str, content: str = "", vault: str = "") -> str:
    """Create a new note template.

    Args:
        name: Template name.
        content: Optional template body content.
        vault: Target vault name (default: active vault).

    Returns:
        JSON object with success status and name.
    """
    data: dict = {"name": name}
    if content:
        data["content"] = content
    return _json(_grove_post(_v("/api/template", vault), data))


@mcp.tool()
def update_template(name: str, content: str, vault: str = "") -> str:
    """Update an existing template's content.

    Args:
        name: Template name.
        content: New template content.
        vault: Target vault name (default: active vault).

    Returns:
        JSON object with success status.
    """
    encoded = urllib.parse.quote(name, safe="")
    return _json(_grove_put(_v(f"/api/template/{encoded}", vault), {"content": content}))


@mcp.tool()
def delete_template(name: str, vault: str = "") -> str:
    """Delete a template.

    Args:
        name: Template name to delete.
        vault: Target vault name (default: active vault).

    Returns:
        JSON object with success status.
    """
    encoded = urllib.parse.quote(name, safe="")
    return _json(_grove_delete(_v(f"/api/template/{encoded}", vault)))


# ── Daily & Meeting ──────────────────────────────────────────────────────────


@mcp.tool()
def create_daily_note(vault: str = "") -> str:
    """Create today's daily note (or return existing one).

    Args:
        vault: Target vault name (default: active vault).

    Returns:
        JSON object with success status and path.
    """
    return _json(_grove_post(_v("/api/daily", vault), {}))


# ── Todos ────────────────────────────────────────────────────────────────────


@mcp.tool()
def list_todos(vault: str = "") -> str:
    """Get all todos (checkboxes) across the vault.

    Args:
        vault: Target vault name (default: active vault).

    Returns:
        JSON array of todo items with note, path, line, text, completed, indent.
    """
    return _json(_grove_get(_v("/api/todos", vault)))


@mcp.tool()
def toggle_todo(path: str, line: int, vault: str = "") -> str:
    """Toggle a checkbox item in a note.

    Args:
        path: Note path containing the todo.
        line: Line number of the checkbox (0-indexed).
        vault: Target vault name (default: active vault).

    Returns:
        JSON object with success status.
    """
    return _json(_grove_post(_v("/api/toggle-todo", vault), {"path": path, "line": line}))


# ── Contacts ─────────────────────────────────────────────────────────────────


@mcp.tool()
def list_contacts(vault: str = "") -> str:
    """List all contacts in the vault.

    Args:
        vault: Target vault name (default: active vault).

    Returns:
        JSON array of contact objects.
    """
    return _json(_grove_get(_v("/api/contacts", vault)))


@mcp.tool()
def create_contact(
    first_name: str = "",
    last_name: str = "",
    email: str = "",
    phone: str = "",
    company: str = "",
    title: str = "",
    department: str = "",
    office_phone: str = "",
    mobile_phone: str = "",
    zoom_id: str = "",
    note: str = "",
    vault: str = "",
) -> str:
    """Create a new contact.

    Args:
        first_name: First name.
        last_name: Last name.
        email: Email address.
        phone: Phone number.
        company: Company name.
        title: Job title.
        department: Department.
        office_phone: Office phone number.
        mobile_phone: Mobile phone number.
        zoom_id: Zoom personal meeting ID.
        note: Free-form notes about the contact.
        vault: Target vault name (default: active vault).

    Returns:
        JSON object with success status and contact data.
    """
    data = {k: v for k, v in {
        "first_name": first_name, "last_name": last_name,
        "email": email, "phone": phone, "company": company,
        "title": title, "department": department,
        "office_phone": office_phone, "mobile_phone": mobile_phone,
        "zoom_id": zoom_id, "note": note,
    }.items() if v}
    return _json(_grove_post(_v("/api/contacts", vault), data))


@mcp.tool()
def update_contact(
    id: str,
    first_name: str = "",
    last_name: str = "",
    email: str = "",
    phone: str = "",
    company: str = "",
    title: str = "",
    department: str = "",
    office_phone: str = "",
    mobile_phone: str = "",
    zoom_id: str = "",
    note: str = "",
    vault: str = "",
) -> str:
    """Update an existing contact. Only provided fields are updated.

    Args:
        id: Contact ID.
        first_name: First name.
        last_name: Last name.
        email: Email address.
        phone: Phone number.
        company: Company name.
        title: Job title.
        department: Department.
        office_phone: Office phone number.
        mobile_phone: Mobile phone number.
        zoom_id: Zoom personal meeting ID.
        note: Free-form notes about the contact.
        vault: Target vault name (default: active vault).

    Returns:
        JSON object with success status.
    """
    data = {k: v for k, v in {
        "first_name": first_name, "last_name": last_name,
        "email": email, "phone": phone, "company": company,
        "title": title, "department": department,
        "office_phone": office_phone, "mobile_phone": mobile_phone,
        "zoom_id": zoom_id, "note": note,
    }.items() if v}
    return _json(_grove_put(_v(f"/api/contacts/{id}", vault), data))


@mcp.tool()
def delete_contact(id: str, vault: str = "") -> str:
    """Delete a contact.

    Args:
        id: Contact ID to delete.
        vault: Target vault name (default: active vault).

    Returns:
        JSON object with success status.
    """
    return _json(_grove_delete(_v(f"/api/contacts/{id}", vault)))


@mcp.tool()
def import_contacts(contacts: list[dict], vault: str = "") -> str:
    """Bulk import contacts.

    Args:
        contacts: Array of contact objects to import. Each can have:
                  first_name, last_name, email, phone, company, title, etc.
        vault: Target vault name (default: active vault).

    Returns:
        JSON object with success, added count, and total count.
    """
    return _json(_grove_post(_v("/api/contacts/import", vault), contacts))


# ── Vaults ───────────────────────────────────────────────────────────────────


@mcp.tool()
def list_vaults() -> str:
    """List all vaults and the active vault.

    Returns:
        JSON object with active vault name and array of vault names.
    """
    return _json(_grove_get("/api/vaults"))


@mcp.tool()
def create_vault(name: str) -> str:
    """Create a new vault.

    Args:
        name: Name for the new vault.

    Returns:
        JSON object with success status.
    """
    return _json(_grove_post("/api/vaults/create", {"name": name}))


@mcp.tool()
def switch_vault(name: str) -> str:
    """Switch the active vault (affects the UI).

    Args:
        name: Name of the vault to switch to.

    Returns:
        JSON object with success status.
    """
    return _json(_grove_post("/api/vaults/switch", {"name": name}))


@mcp.tool()
def delete_vault(name: str) -> str:
    """Delete a vault and all its contents.

    Args:
        name: Name of the vault to delete.

    Returns:
        JSON object with success status.
    """
    return _json(_grove_post("/api/vaults/delete", {"name": name}))


# ── Config ───────────────────────────────────────────────────────────────────


@mcp.tool()
def get_config(vault: str = "") -> str:
    """Get the per-vault configuration.

    Args:
        vault: Target vault name (default: active vault).

    Returns:
        JSON object with vault configuration.
    """
    return _json(_grove_get(_v("/api/config", vault)))


@mcp.tool()
def update_config(config: dict, vault: str = "") -> str:
    """Update the per-vault configuration.

    Args:
        config: Configuration object to merge into existing config.
        vault: Target vault name (default: active vault).

    Returns:
        JSON object with success status and updated config.
    """
    return _json(_grove_put(_v("/api/config", vault), config))


# ── Calendar ─────────────────────────────────────────────────────────────────


@mcp.tool()
def get_calendar(vault: str = "") -> str:
    """Get calendar data — notes grouped by date.

    Args:
        vault: Target vault name (default: active vault).

    Returns:
        JSON object mapping date strings to arrays of note objects.
    """
    return _json(_grove_get(_v("/api/calendar", vault)))


# ── Export ───────────────────────────────────────────────────────────────────


@mcp.tool()
def export_notes(format: str = "json", since: str = "", vault: str = "") -> str:
    """Export vault notes as JSON or JSONL.

    Args:
        format: Output format — 'json' or 'jsonl'.
        since: Optional ISO timestamp — only export notes modified after this time.
        vault: Target vault name (default: active vault).

    Returns:
        Exported notes data.
    """
    params = {"format": format}
    if since:
        params["since"] = since
    qs = urllib.parse.urlencode(params)
    result = _grove_get(_v(f"/api/export?{qs}", vault))
    if isinstance(result, str):
        return result
    return _json(result)


@mcp.tool()
def extract_notes(
    months: str = "all",
    starred: str = "true",
    type: str = "",
    tag: str = "",
    vault: str = "",
) -> str:
    """Extract notes as concatenated markdown with metadata headers.

    Args:
        months: Time range — '1', '3', '6', '12', or 'all'.
        starred: Filter by starred status — 'true' or 'false'.
        type: Comma-separated note types (e.g. 'meeting,decision').
        tag: Filter by tag.
        vault: Target vault name (default: active vault).

    Returns:
        Concatenated markdown text.
    """
    params: dict = {"months": months, "starred": starred}
    if type:
        params["type"] = type
    if tag:
        params["tag"] = tag
    qs = urllib.parse.urlencode(params)
    result = _grove_get(_v(f"/api/extract?{qs}", vault))
    if isinstance(result, str):
        return result
    return _json(result)


# ── MCP Resources ────────────────────────────────────────────────────────────


@mcp.resource("grove://notes")
def resource_notes() -> str:
    """List of all notes in the active vault."""
    tree = _grove_get("/api/tree")
    if isinstance(tree, dict) and "error" in tree:
        return _json(tree)
    return _json(_flatten_tree(tree))


@mcp.resource("grove://note/{path}")
def resource_note(path: str) -> str:
    """Content of an individual note."""
    encoded = urllib.parse.quote(path, safe="")
    return _json(_grove_get(f"/api/note/{encoded}"))


# ── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    mcp.run(transport="stdio")
