"""
Grove MCP Server — Expose Grove vault data to MCP clients.

Proxies Grove's REST API over HTTP so it can run on a different host.
Configure via GROVE_URL env variable (default: http://localhost:5000).
Requires the Grove Flask server to be running.
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
        "Use these tools to search, read, create, and list notes in the active vault."
    ),
)


# ── Helpers ──────────────────────────────────────────────────────────────────


def _grove_get(endpoint: str) -> dict | list:
    """GET request to the Grove API. Returns parsed JSON."""
    url = f"{GROVE_URL}{endpoint}"
    req = urllib.request.Request(url)
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


def _grove_post(endpoint: str, data: dict) -> dict:
    """POST request with JSON body to the Grove API. Returns parsed JSON."""
    return _grove_request(endpoint, data, method="POST")


def _grove_put(endpoint: str, data: dict) -> dict:
    """PUT request with JSON body to the Grove API. Returns parsed JSON."""
    return _grove_request(endpoint, data, method="PUT")


def _grove_request(endpoint: str, data: dict, method: str = "POST") -> dict:
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


def _flatten_tree(nodes: list, prefix: str = "") -> list[dict]:
    """Flatten the nested vault tree into a flat list of files."""
    items = []
    for node in nodes:
        if node["type"] == "folder":
            items.extend(_flatten_tree(node.get("children", []), node["path"]))
        elif node["type"] == "file":
            items.append({"name": node["name"], "path": node["path"]})
    return items


# ── MCP Tools ────────────────────────────────────────────────────────────────


@mcp.tool()
def search_notes(query: str = "", tag: str = "") -> str:
    """Search notes by text and/or tag.

    Args:
        query: Text to search for in note titles and content.
        tag: Filter results to notes with this tag.

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
    results = _grove_get(endpoint)
    return json.dumps(results, indent=2)


@mcp.tool()
def read_note(path: str) -> str:
    """Read a note's full content and metadata.

    Args:
        path: Relative path to the note (e.g. 'daily/2024-01-15.md').

    Returns:
        JSON object with path, title, tags, content, body, and starred status.
    """
    encoded = urllib.parse.quote(path, safe="")
    result = _grove_get(f"/api/note/{encoded}")
    return json.dumps(result, indent=2)


@mcp.tool()
def create_note(
    title: str,
    content: str = "",
    folder: str = "",
    tags: list[str] | None = None,
) -> str:
    """Create a new note in the vault.

    Args:
        title: Note title.
        content: Optional markdown body (Grove adds frontmatter automatically).
        folder: Optional subfolder to place the note in.
        tags: Optional list of tags.

    Returns:
        JSON object with success status and path of the created note.
    """
    data: dict = {"title": title}
    if folder:
        data["folder"] = folder
    if tags:
        data["tags"] = tags
    result = _grove_post("/api/note", data)

    # If content was provided, PUT it into the newly created note
    if content and result.get("success") and result.get("path"):
        path = result["path"]
        encoded = urllib.parse.quote(path, safe="")
        note = _grove_get(f"/api/note/{encoded}")
        existing = note.get("content", "")
        full_content = existing.rstrip("\n") + "\n" + content + "\n"
        _grove_put(f"/api/note/{path}", {"content": full_content})

    return json.dumps(result, indent=2)


@mcp.tool()
def list_notes() -> str:
    """List all notes in the active vault.

    Returns:
        JSON array of notes with name and path.
    """
    tree = _grove_get("/api/tree")
    if isinstance(tree, dict) and "error" in tree:
        return json.dumps(tree, indent=2)
    notes = _flatten_tree(tree)
    return json.dumps(notes, indent=2)


@mcp.tool()
def get_tags() -> str:
    """Get all tags in the vault with their note counts.

    Returns:
        JSON object mapping tag names to counts.
    """
    result = _grove_get("/api/tags")
    return json.dumps(result, indent=2)


# ── MCP Resources ────────────────────────────────────────────────────────────


@mcp.resource("grove://notes")
def resource_notes() -> str:
    """List of all notes in the active vault."""
    tree = _grove_get("/api/tree")
    if isinstance(tree, dict) and "error" in tree:
        return json.dumps(tree, indent=2)
    notes = _flatten_tree(tree)
    return json.dumps(notes, indent=2)


@mcp.resource("grove://note/{path}")
def resource_note(path: str) -> str:
    """Content of an individual note."""
    encoded = urllib.parse.quote(path, safe="")
    result = _grove_get(f"/api/note/{encoded}")
    return json.dumps(result, indent=2)


# ── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    mcp.run(transport="stdio")
