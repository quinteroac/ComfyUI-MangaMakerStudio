# Agent-assisted installation and configuration

[Documentation](README.md) · [Project README](../README.md)

An agent with access to your ComfyUI environment can install Manga Maker Studio, identify the dependencies needed for your chosen features, select existing compatible weights and configure the plugin. The repository includes the reusable [manga-maker-setup skill](../skills/manga-maker-setup/SKILL.md) for this work.

The skill supplies plugin-specific instructions; it is not an installer that runs automatically. Your agent still needs the appropriate filesystem, process and local server access. A chat without access to your machine can explain setup, but cannot apply or verify local changes.

## Using the skill

If your agent accepts a skill file directly, ask it to read `skills/manga-maker-setup/SKILL.md` from this checkout and use it for the setup request. It can read the [API reference](../skills/manga-maker-setup/references/api.md) when needed. If the plugin has not been cloned, give the agent the [repository URL](https://github.com/quinteroac/ComfyUI-MangaMakerStudio) and ask it to inspect the included skill as part of installation.

For agents with a skill library, install or copy the complete `skills/manga-maker-setup/` folder into the directory supported by that agent. Keep `SKILL.md`, `references/` and `agents/` together. The folder includes standard skill frontmatter and optional UI metadata; its instructions do not depend on a particular MCP connector. Skill registration and discovery depend on the agent you use. Copying the skill does not install the ComfyUI plugin itself.

When the skill is registered and your agent supports named invocation, use `$manga-maker-setup`. Otherwise, refer to its file path explicitly. The skill finds the plugin's checkout and reads its documentation there, so it can also be used from a separately installed skill folder.

## What to tell your agent

Useful context includes the ComfyUI location, server URL if already running, the features you want, model files you already have, and whether downloads or an idle restart are allowed. You do not need to understand every advanced setting before asking for help; the agent can inspect the installation and identify the relevant choices.

Example requests:

> Use `$manga-maker-setup` to configure Manga Maker Studio in my existing ComfyUI installation for projects, Klecks drawing and page layout. Reuse existing settings and do not download models.

> Read `skills/manga-maker-setup/SKILL.md` and configure Art to Manga Panel with Manga-Lite. Install MangaScreen if missing, keep pen extraction disabled and leave my existing model settings intact. Restart the confirmed ComfyUI instance only when its queue is idle.

> Use `$manga-maker-setup` to configure Sketch to Art using my installed Krea weights and LoRAs. Check the required nodes and encoder type. Report any missing weights before downloading them, and do not run inference.

> Use `$manga-maker-setup` to diagnose my QWEN-Manga configuration. Reuse my installed Turbo weights and verify the model, encoder, VAE and loaded node schemas without changing other engines or generating an image.

## What the agent configures

| Area | Expected behavior |
| --- | --- |
| Target environment | Identify the intended ComfyUI installation, Python runtime and server rather than assuming a path or port |
| Dependencies | Install only packages needed for the requested features; distinguish custom nodes from model weights |
| Existing configuration | Preserve projects, root folder, presets, other engines and operation overrides; back up settings before writing |
| Models and encoders | Reuse registered resources, match encoder types and distinguish regular Qwen from QWEN-Manga Turbo |
| Optional features | Keep the separate local Qwen8B bridge, pen extraction and its annotator downloads within the requested scope |
| Activation | Check the queue and preserve the server's launch configuration for an authorized idle restart |
| Verification | Read settings back, inspect loaded schemas and check the UI when available; identify what still needs activation or weights |

An agent can use Studio's UI, local HTTP API, shell access or available ComfyUI tools. The skill includes the settings API's replacement semantics to prevent a partial model update from discarding another engine's configuration. It is a setup guide, not a new public service or an agent endpoint added to ComfyUI.

## Understanding the result

Ask for a report of the target installation, installed packages, settings changed, selected weights, checks performed and any remaining work. Installed files, loaded nodes and completed inference are different verification levels. The skill does not submit generation jobs or download weights merely to demonstrate that a configuration exists.

For manual setup, use [Installation](installation.md) and [Configuration](configuration.md). For dependency authors and project sources, see [Credits and attribution](credits.md).
