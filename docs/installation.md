# Installation and dependencies

[Documentation](README.md) · [Project README](../README.md)

Prefer to use an agent? The included [setup skill and agent guide](agent-setup.md) support feature-specific installation and configuration.

## Installing the plugin

Clone the plugin into an existing ComfyUI installation:

```sh
# Run from your ComfyUI directory:
git clone https://github.com/quinteroac/ComfyUI-MangaMakerStudio.git custom_nodes/ComfyUI-MangaMakerStudio
```

The package lives in `custom_nodes/ComfyUI-MangaMakerStudio`. When there are no active jobs, restart ComfyUI and reload the browser. Project management, page layout and drawing use aiohttp and Pillow included with ComfyUI, plus a bundled Klecks build. Generation and image conversion require the node packages and model weights listed under [Node dependencies](installation.md#node-dependencies); install only those needed for the features you use. It does not modify ComfyUI core. Studio's guided weight downloads from Hugging Face start only when you click **Download missing official weights**; opening the Studio or checking models does not initiate external connections.

Open **Manga Maker Studio** from the sidebar or **Manga Maker** menu. The workspace uses the same ComfyUI server and queue as the graph editor. No separate server, account or npm installation is required to use Studio.

## Node dependencies

Managing projects, importing images, drawing with Klecks, editing pages and exporting them requires no additional node packages. Install the following packages under `ComfyUI/custom_nodes` for the relevant generation or conversion features. Model weights are separate from node packages.

| Feature | Dependencies |
| --- | --- |
| Qwen: generation, editing and finishing | ComfyUI with the native `TextEncodeQwenImage21` node. `QwenImage21Cache` is optional and used when available. |
| Krea2 Edit and visual references | [comfyui-krea2edit](https://github.com/lbouaraba/comfyui-krea2edit): `Krea2EditModelPatch` and `Krea2EditGroundedEncode`, with a `krea2` encoder and vision weights. |
| Krea2 | ComfyUI with `krea2` encoder support in `CLIPLoader`. |
| Sketch to Art in Klecks | The Krea2 Edit package listed above; native VAE, sampling and image nodes. Sketch/Turbo LoRA weights are selected separately. |
| Art to Manga Panel · Manga-Lite | [ComfyUI-MangaScreen](https://github.com/ashukae/ComfyUI-MangaScreen): `MangaLevels`, `MangaFinish` and `MangaPanel`. Requires `opencv-python` and `numpy`; no diffusion model is needed. |
| Art to Manga Panel · QWEN-Manga | [ComfyUI-MangaScreen](https://github.com/ashukae/ComfyUI-MangaScreen): `MangaFinish` and `MangaPanel`; native ComfyUI `TextEncodeQwenImage21`, `ManualSigmas` and sampling nodes; compatible Qwen Image 2.1 Turbo model, encoder and VAE. `QwenImage21Cache` is optional. |
| Art to Manga Panel · Extract pen lines | [comfyui_controlnet_aux](https://github.com/Fannovel16/comfyui_controlnet_aux): `Manga2Anime_LineArt_Preprocessor` and its Manga Lineart weights. Optional in both manga workflows and disabled initially. |
| Importing PanelComposer presets | [ComfyUI-PanelComposer](https://github.com/INuBq8/ComfyUI-PanelComposer), optional for discovering its installed presets. Studio renders and exports layouts with its own editor. |
| Page analysis | Native `TextGenerate` and `SaveText` nodes, plus `CLIPLoader`. |
| Enhancing fields and creating reference prompts | Native `TextGenerate`, `SaveText` and `CLIPLoader` nodes; uses the CLIP configured in the global text generator. Reference analysis requires an encoder with vision. |

For **Art to Manga Panel**, install MangaScreen and its Python requirements in the same Python environment that runs ComfyUI:

```sh
# Run from your ComfyUI directory:
git clone https://github.com/ashukae/ComfyUI-MangaScreen.git custom_nodes/ComfyUI-MangaScreen
python -m pip install -r custom_nodes/ComfyUI-MangaScreen/requirements.txt
```

For **Krea2 Edit** and **Sketch to Art**, install [comfyui-krea2edit](https://github.com/lbouaraba/comfyui-krea2edit#installation) and its compatible weights. For optional pen extraction, follow the [ControlNet Auxiliary Preprocessors installation instructions](https://github.com/Fannovel16/comfyui_controlnet_aux#installation). Use the Python executable of your ComfyUI environment, including its embedded Python when applicable. Restart ComfyUI when no jobs are active, reload the browser and use **Refresh lists**.

The upstream MangaScreen comparison node and the original workflows' utility nodes are not required by Studio's built-in graphs.

Generation also uses ComfyUI's standard loading, sampling, VAE and image nodes; LoRAs use `LoraLoader`, or `LoraLoaderModelOnly` for Krea2 Edit. The AR/MP selector creates an empty latent through the selected VAE; it does not require YAP-Utilities' `IllustriousAspectRatio`. All Krea2 and Krea2 Edit image flows, including Sketch to Art and refinement, use the native `ModelAttentionBackend` node before the sampling/edit patches. The default is `comfy kitchen attention`, matching the Sketch to Art workflow; installations that do not expose it use `pytorch attention`. Select another backend in global model settings or an individual preset to override it. Qwen adds this node only when an explicit backend is selected. If a node is missing, the operation reports its name; other features remain available. After installing or enabling a package, restart ComfyUI when no jobs are active and use **Refresh lists**.

Model, encoder and VAE files are separate requirements from nodes. Guided downloads cover the official weights in the catalog in [Configuration](configuration.md#global-configuration-and-downloads); other LoRAs must be installed manually. Downloading weights does not install or update node packages.

## Choosing what to install

For drawing and page composition, the plugin and its bundled Klecks editor are sufficient. Add MangaScreen for Manga-Lite without loading a diffusion model. Add Krea2Edit and compatible Krea weights for Sketch to Art, or a compatible Qwen model family for Qwen editing and finishing. Pen extraction is a separate optional dependency.

After installation, see [Configuration](configuration.md) for model selection and [Using Studio](usage.md) for the workspaces.
