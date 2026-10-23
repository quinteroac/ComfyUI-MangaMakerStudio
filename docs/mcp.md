# MCP server

[Documentation](README.md) · [Project README](../README.md)

`mcp/server.mjs` is a stdio [MCP](https://modelcontextprotocol.io) server that lets an agent read your projects and write their story. It needs Node.js 22 or newer and has no dependencies. It talks only to the ComfyUI server in `MANGA_MAKER_URL` (default `http://127.0.0.1:8188`); include any deployment prefix in that URL. ComfyUI must be running with this version of the plugin loaded.

## Setup

Claude Code:

```sh
claude mcp add manga-maker -e MANGA_MAKER_URL=http://127.0.0.1:8188 -- node /path/to/ComfyUI/custom_nodes/ComfyUI-MangaMakerStudio/mcp/server.mjs
```

Other clients use the same command and environment in their MCP configuration. If ComfyUI uses HTTPS with a local certificate authority, use the `https://` URL and set `NODE_EXTRA_CA_CERTS` to that authority's certificate; do not disable certificate checks.

## Tools

| Tool | Effect |
| --- | --- |
| `list_projects`, `get_project` | Projects, revision, asset counts, page layouts, active jobs and story size |
| `list_assets`, `view_asset` | Image list and an image (320 px thumbnail unless `thumbnail` is false) |
| `get_story` | `summary` (the Story assistant's context), `markdown` (exported script) or `json` (with the character, chapter and page ids used as `target`) |
| `story_*` | The Story assistant's quick actions: `logline`, `character`, `cast`, `develop`, `appearance`, `outline`, `chapters`, `pages`, `page`, `dialogue`. Each takes a `proposal` with the same schema the local assistant fills |

Story tools validate the proposal and apply it exactly as **Apply to story** does. `outline` replaces every act and beat; `page` and `dialogue` replace the panels of the target page. There is no undo; duplicate the project first if you want a copy.

## Concurrent edits

Every project has a `revision` that increases when its story, settings, presets or workspace change. Saves that send an older revision are rejected with 409, so Studio and the MCP server never overwrite each other. The MCP server re-reads and retries; an open Studio window reloads the project within two seconds and shows a notice. Unsaved edits made in Studio during that window are discarded.
