# Manga Maker Studio

**Version:** 0.2.0-alpha.

Manga Maker Studio extends ComfyUI with a workspace for creating manga: organize references and panels in projects, generate images with Krea2, Qwen, Moss or Anima, edit with Krea2 or Qwen, draw with Klecks, and compose pages with custom panel shapes and dialogue. Open **Manga Maker Studio** from the sidebar or the **Manga Maker** menu while keeping your ComfyUI graph intact.

## What you can do

- Organize references, panels and pages with preserved originals and versions.
- Generate and refine art with Krea2, Krea2 Edit or Qwen Image 2.1.
- Draw in Klecks with editable layers and PSD saving, render drafts with **Sketch to Art**, and convert illustrations with **Art to Manga Panel**.
- Compose pages with rectangular or polygonal panels, speech/thought bubbles, local fonts and PNG export.

## Installation

```sh
# Run from your ComfyUI directory:
git clone https://github.com/quinteroac/ComfyUI-MangaMakerStudio.git custom_nodes/ComfyUI-MangaMakerStudio
```

Restart ComfyUI when no jobs are active and reload the browser. Drawing, project management and page layout use the bundled editor and ComfyUI's existing Python dependencies. AI features require compatible models and, for some operations, separate custom nodes.

**Required packages depend on the feature:** [comfyui-krea2edit](https://github.com/lbouaraba/comfyui-krea2edit) for Krea2 Edit and Sketch to Art; [ComfyUI-MangaScreen](https://github.com/ashukae/ComfyUI-MangaScreen) for Art to Manga Panel; [comfyui_controlnet_aux](https://github.com/Fannovel16/comfyui_controlnet_aux) for optional pen extraction. [PanelComposer](https://github.com/INuBq8/ComfyUI-PanelComposer) is optional for its layout presets. See [Installation and dependencies](docs/installation.md) for exact nodes, weights and supported paths.

## Set up with an agent

You can ask a compatible agent to install and configure the plugin using the included [manga-maker-setup skill](skills/manga-maker-setup/SKILL.md). It helps discover your ComfyUI environment, install the custom nodes needed for your chosen features, reuse compatible weights and preserve existing settings.

Ask the agent to read `skills/manga-maker-setup/SKILL.md`, or invoke `$manga-maker-setup` after registering the skill with your agent. See [Agent-assisted setup](docs/agent-setup.md) for usage, example requests and access requirements. The skill does not itself grant machine access or authorize downloads, restarts or inference.

## Documentation

The [documentation index](docs/README.md) links to guides by topic:

| Guide | Contents |
| --- | --- |
| [Agent-assisted setup](docs/agent-setup.md) | Use the included skill to install, configure or diagnose the plugin |
| [Configuration](docs/configuration.md) | Models, downloads, overrides, presets and text/vision configuration |
| [Using Studio](docs/usage.md) | References, panels, refinement and finishing |
| [Drawing and manga conversion](docs/drawing.md) | Klecks, Sketch to Art, Art to Manga Panel and masks |
| [Page layout](docs/page-layout.md) | Panels, framing, dialogue, fonts and export |
| [Projects and storage](docs/projects.md) | Saving, versions, migration and troubleshooting |
| [Development and validation](docs/development.md) | Build details and tests |

## Credits

The drawing editor is [Klecks by bitbof](https://github.com/bitbof/klecks). Art to Manga Panel adapts [MangaScreen by ashukae](https://github.com/ashukae/ComfyUI-MangaScreen). Krea2 editing uses [comfyui-krea2edit](https://github.com/lbouaraba/comfyui-krea2edit), and page layouts can import [PanelComposer](https://github.com/INuBq8/ComfyUI-PanelComposer) presets. See [Credits and attribution](docs/credits.md) for all project links, workflow sources and license notices.
