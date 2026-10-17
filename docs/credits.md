# Credits and attribution

[Documentation](README.md) · [Project README](../README.md)

Manga Maker Studio integrates the following projects and workflows. Credit belongs to their authors and contributors; linked projects and model weights retain their respective licenses.

| Project / authors | Contribution used by Studio |
| --- | --- |
| [ComfyUI](https://github.com/Comfy-Org/ComfyUI), [ComfyUI frontend](https://github.com/Comfy-Org/ComfyUI_frontend) and their contributors | Execution server, model loading, native nodes, queue/history APIs and the extension interface. |
| [Klecks — bitbof](https://github.com/bitbof/klecks) | Bundled painting editor, brushes, layers, PSD support and native history. The embed is locally patched for Studio integration. Its [MIT license](../drawing/klecks/LICENSE.txt), dependency/font credits and [upstream revision/build record](../drawing/klecks/UPSTREAM.json) are included in the repository. |
| [ComfyUI-MangaScreen — ashukae](https://github.com/ashukae/ComfyUI-MangaScreen) | Manga Levels, Manga Finish and Manga Panel; the [Manga-Lite](https://github.com/ashukae/ComfyUI-MangaScreen/blob/main/workflows/Manga-Lite.json) and [QWEN-Manga](https://github.com/ashukae/ComfyUI-MangaScreen/blob/main/workflows/QWEN-Manga.json) pipelines adapted for Art to Manga Panel. MangaScreen is a separate MIT-licensed dependency. |
| [comfyui-krea2edit — lbouaraba / conradlocke](https://github.com/lbouaraba/comfyui-krea2edit) and [Krea2 Identity Edit](https://huggingface.co/conradlocke/krea2-identity-edit) | Grounded encoding and the source-latent patch used for Krea2 editing and Sketch to Art; the compatible Identity Edit LoRA used by the regular Krea2 Edit configuration. |
| [ControlNet Auxiliary Preprocessors — Fannovel16 and contributors](https://github.com/Fannovel16/comfyui_controlnet_aux) | Optional Manga Lineart extraction via `Manga2Anime_LineArt_Preprocessor`, based on Li et al., *Deep Extraction of Manga Structural Lines*, SIGGRAPH 2017. |
| [ComfyUI-PanelComposer — INuBq8](https://github.com/INuBq8/ComfyUI-PanelComposer) | Compatible panel-layout presets imported by Studio's page editor. |
| [Krea 2 — Krea AI](https://github.com/krea-ai/krea-2), [Qwen-Image — Qwen team](https://github.com/QwenLM/Qwen-Image) and [Comfy-Org workflow templates](https://github.com/Comfy-Org/workflow_templates) | Model families and official generation/editing workflow references. The exact downloadable weight sources and sampling references are listed under [Global configuration and downloads](configuration.md#global-configuration-and-downloads). |

Klecks also bundles third-party libraries and fonts; their upstream notices are preserved in `drawing/klecks/`. Custom node packages and model weights are installed separately and are not relicensed by this project.
