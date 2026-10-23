---
name: manga-maker-setup
description: Install, configure, or diagnose Manga Maker Studio in an existing ComfyUI installation, including feature-specific custom nodes, model selection and settings inheritance. Use for agent-assisted setup of this plugin, not general ComfyUI administration or artwork generation.
---

# Manga Maker Studio setup

Make the user's requested Studio features usable in their actual ComfyUI installation. Work within their existing authorization for installation and configuration; this skill does not authorize model downloads, restarts, generation or changes to unrelated software by itself.

## Establish the target

Discover the ComfyUI checkout or installation, its active Python executable, server URL and Manga Maker Studio checkout from the workspace, running process or available ComfyUI tools. Do not assume port 8188, a `.venv` name, Unix paths, or that terminal `python` runs the server. Portable installations may use embedded Python. If multiple plausible installations remain, ask which one to configure before changing either.

Identify the requested features from the task. If the user only asks for basic setup, configure projects, drawing and page layout first and report AI options; do not interpret it as installing every model family. Reuse installed models, user-selected paths and existing settings. Ask only for missing choices that materially affect installation, storage, downloads or compatibility.

Locate the repository's `docs/installation.md` and `docs/configuration.md`; read the sections for the chosen features. They remain authoritative for package URLs and configuration behavior. A copied skill does not contain the plugin: locate or clone `https://github.com/quinteroac/ComfyUI-MangaMakerStudio` as part of an authorized plugin installation. Read `docs/drawing.md` for Sketch to Art or manga conversion. Do not resolve repository docs relative to the skill's parent if the skill was installed elsewhere.

## Inspect before changing

Inspect local changes before updating an existing checkout. Preserve them; do not reset, overwrite, switch branches, update ComfyUI core or upgrade unrelated nodes to make setup easier. Install missing feature dependencies alongside the plugin, not inside its directory, and use the same Python environment as ComfyUI for their declared requirements. Do not clone another copy over an existing installation.

When the server is available, inspect `/object_info`, `/queue`, `/manga-maker/settings` and, for model setup, `/manga-maker/models` on the confirmed server. Existing ComfyUI connectors may provide equivalent inventory. Read [API and settings contracts](references/api.md) before HTTP configuration or interpreting missing routes.

Distinguish missing packages, packages installed but not yet loaded, missing node versions, missing registered filenames and incompatible model families. Installing weights cannot fix a missing custom node. Do not infer weight compatibility solely from a filename substring.

## Choose the smallest working setup

| Requested feature | Setup decisions |
| --- | --- |
| Projects, importing, Klecks drawing, page layout/export | Studio plus ComfyUI's existing aiohttp/Pillow; Klecks is bundled. No diffusion weights or npm build. |
| Manga-Lite | MangaScreen and its requirements. No diffusion model. Pen extraction stays off unless requested. |
| QWEN-Manga | MangaScreen, native Qwen Image 2.1 encoding/sampling, compatible **Turbo** diffusion weights, encoder and VAE. Its sigma schedule differs from regular Qwen generation. |
| Krea2 Edit / Sketch to Art | `comfyui-krea2edit`, compatible Krea model/encoder/VAE, and the operation's LoRAs. Sketch uses separate Turbo/Sketch LoRAs; it does not automatically add the regular Identity Edit LoRA. |
| Pen extraction | `comfyui_controlnet_aux`, `Manga2Anime_LineArt_Preprocessor` and annotator weights. First use may download missing weights; keep it off for offline/no-download setup unless weights exist. |
| Qwen generation / finishing | Native `TextEncodeQwenImage21`, compatible model, `qwen_image` encoder and VAE. Cache is optional. |
| Text enhancement / image analysis | Native `TextGenerate`, `SaveText`, and a separately configured global text generator. Image tasks need vision support. |
| Imported PanelComposer presets | PanelComposer is optional; Studio has its own renderer. |

Separate node installation from weight acquisition. Reuse registered filenames and subfolders reported by the installed schemas. For authorized official downloads use Studio's catalog-backed setup, which verifies size/hash; do not auto-download the entire catalog. Its regular Qwen profile supplies non-Turbo weights and does not satisfy QWEN-Manga's Turbo requirement. Retain user-selected compatible alternatives. For missing Sketch/Turbo LoRAs, use a source actually supplied or verified for those artifacts; do not substitute an unrelated LoRA.

## Apply configuration without losing user data

Prefer the live Studio settings UI or its API. Back up existing settings before writing. Global `models` keys are `krea`, `krea_edit` and `qwen`; text/vision helpers use `text_generator`. Preserve project root, presets, other engines and existing operation overrides. Read current settings immediately before applying a narrowly merged change; the settings API replaces submitted nested maps rather than patching their individual entries.

Global values are inherited unless an operation or preset has explicit `model_overrides`. If an old selection persists, inspect that operation instead of repeatedly rewriting globals. Clear only the overrides the user asked to reset. Do not replace project configuration, layouts, sources or asset metadata to change an engine default.

Validate model/encoder/VAE choices and enum values against the running `/object_info`. Krea uses encoder type `krea2`; Qwen uses `qwen_image`. Keep reference order and existing LoRA order/strengths. Configure the global text generator separately from diffusion engines when requested.

A reload refreshes UI assets; new Python routes and custom node packages need a ComfyUI restart. Check the queue immediately beforehand. Restart only the confirmed target when idle and within the user's authorization, preserving its launch configuration. Do not interrupt active work. If a restart is unavailable or must wait, finish independent work and report that activation remains pending. Refresh node/model lists after activation.

## Verify and report

Read settings back and check that only intended fields changed. Confirm requested node classes and selected registered resources; verify the plugin opens through its sidebar/menu when browser access is available. An offline file edit or installed package is not proof that the running server loaded it.

For a reversible UI check, use temporary project data if the user permits creating it. Do not submit a diffusion prompt, enable realtime, invoke annotator downloads or load large models merely to prove setup. Run actual inference only when requested/authorized and distinguish it from schema/UI validation.

Report the target installation, features ready to use, selected model families, installed packages, settings changed, checks performed and any specific remaining dependency or activation step. Distinguish configured, loaded, and actually inference-tested states. Never claim a feature works from an unexecuted plan.
