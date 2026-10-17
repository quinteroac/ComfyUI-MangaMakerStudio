# Manga Maker Studio

**Version:** 0.1.1-alpha.

Manga Maker Studio extends ComfyUI with a workspace for creating manga: organize references and panels in projects, generate and edit images with Krea2 or Qwen, draw with Klecks, and compose pages with custom panel shapes and dialogue. Open **Manga Maker Studio** from the sidebar or the **Manga Maker** menu while keeping your ComfyUI graph intact.

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

## Documentation

The [documentation index](docs/README.md) links to guides by topic:

| Guide | Contents |
| --- | --- |
| [Configuration](docs/configuration.md) | Models, downloads, overrides, presets and text/vision configuration |
| [Using Studio](docs/usage.md) | References, panels, refinement and finishing |
| [Drawing and manga conversion](docs/drawing.md) | Klecks, Sketch to Art, Art to Manga Panel and masks |
| [Page layout](docs/page-layout.md) | Panels, framing, dialogue, fonts and export |
| [Projects and storage](docs/projects.md) | Saving, versions, migration and troubleshooting |
| [Development and validation](docs/development.md) | Build details and tests |

## Credits

The drawing editor is [Klecks by bitbof](https://github.com/bitbof/klecks). Art to Manga Panel adapts [MangaScreen by ashukae](https://github.com/ashukae/ComfyUI-MangaScreen). Krea2 editing uses [comfyui-krea2edit](https://github.com/lbouaraba/comfyui-krea2edit), and page layouts can import [PanelComposer](https://github.com/INuBq8/ComfyUI-PanelComposer) presets. See [Credits and attribution](docs/credits.md) for all project links, workflow sources and license notices.
