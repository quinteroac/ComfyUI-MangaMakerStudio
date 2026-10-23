# Configuration, models and presets

[Documentation](README.md) · [Project README](../README.md)

Configure a model family globally, then override individual fields only when an operation needs a different model or sampling setup. Project content, operation settings and global model settings have different lifetimes.

An agent can also apply and verify these settings using the included [manga-maker-setup skill](agent-setup.md), with access to your ComfyUI environment.

## Where settings apply

| Scope | What belongs here | When to use it |
| --- | --- | --- |
| **Settings → Global model engine** | Compatible model, text encoder, encoder type, VAE and default sampling for Krea2, Krea2 Edit or Qwen | A shared starting configuration across workspaces and projects |
| **Models and advanced settings** in an operation | Explicit model and sampling overrides, conditioning path and engine-specific options | A particular reference, panel, refinement or drawing workflow |
| **Prompt and settings preset** | Reusable prompt sections and operation settings, including explicit overrides | Returning to a known creative setup without replacing global defaults |
| **Settings → Global text generator** | Encoder, loading type, device and output length for text/vision tasks | Prompt enhancement, image descriptions, dialogue and analysis |

An installed filename is not enough to establish compatibility: the diffusion model, encoder loading type, VAE and any LoRAs must belong to a supported combination. Node packages and weights are listed in [Installation](installation.md).

## Global configuration and downloads

**Sampling → Shift** adjusts the sampling shift for Krea2 and Krea2 Edit, including refinement. The default is **1.15**. An empty individual field inherits the engine's global Shift; if the Settings field is also empty, the model's own value is used. Presets can store an individual value or inherit the global value. An explicit shift is fixed and independent of resolution.

In **Settings → Global model engine**, configure **Krea2**, **Krea2 Edit**, **Qwen Image 2.1**, **Moss** and **Anima** once. Values are shared across operations that support each engine; the page analysis encoder inherits the engine's encoder unless individually overridden. The text generator keeps its separate global CLIP.

Fields changed in the inference interface override only that value. **Use global model configuration** clears these individual overrides. Presets store explicit overrides: missing, empty or null model fields inherit the current global value without carrying over overrides from a previous preset. A preset with explicit values keeps them even when the global configuration changes. Previous per-operation global configurations are consolidated by engine; existing individual selections and project prompts/LoRAs are preserved.

**Official model setup** shows missing weights and their sizes. **Download missing official weights** starts a download only when clicked, shows progress and allows retries after errors. Installed files are reused, including registered ComfyUI subfolders; new weights are written to their registered directories. Partial files are not exposed as models, and size and SHA-256 are verified before the final rename.

| Engine | Downloadable weights | Sampling applied on completion |
| --- | --- | --- |
| Krea2 Turbo | `krea2_turbo_fp8_scaled.safetensors`, `qwen3vl_4b_fp8_scaled.safetensors`, `qwen_image_vae.safetensors` | 8 steps, CFG 1, Euler, Simple |
| Krea2 Edit | The same official Turbo weights + `krea2_identity_edit_v1_2.safetensors` | 8 steps, CFG 1, Euler, Simple; Identity at strength 1 |
| Qwen Image 2.1 | `qwen_image_2.1_int8_convrot.safetensors`, `qwen3vl_8b_int8_convrot.safetensors`, `qwen_image_2.1_vae_bf16.safetensors` | 25 steps, CFG 1, Euler, Simple |

**moss** and **anima** use installed weights from the local workflows `moss-base-8-steps-lora.json` and `Anima_SetGet_Organizado.json`; they do not offer automatic downloads. **Use workflow models and sampling** restores their global model and sampling settings. Both default to 8 steps, CFG 1, ER SDE and Simple.

Moss uses `moss/moss_image_sft_int8_convrot.safetensors`, `moss/qwen3.5_9b_int8_convrot.safetensors` with loading type **moss_image**, `flux2-vae.safetensors` and `moss/lora.safetensors` at strength 1. The **Eight-step LoRA** field supports global inheritance and individual/preset overrides; an enabled entry for the same file overrides its strength without applying it twice. Additional LoRAs affect only the model. Negative conditioning is zeroed.

Anima uses `anima/anima-turbo-v1.0-int8-convrot.safetensors`, `qwen_3_06b_base.safetensors` with loading type **qwen_image**, and `wan_2.1_vae.safetensors`. It uses standard text encoding for both prompts, with the workflow's editable negative prompt. Set/Get routing is replaced by direct connections; the aspect-ratio helper is replaced by Studio's AR/MP controls. Neither engine requires those UI helper nodes or external workflow files at runtime.

The bundled catalog pins revisions and hashes from [Comfy-Org/Krea-2](https://huggingface.co/Comfy-Org/Krea-2) and [Comfy-Org/Qwen-Image-2.1](https://huggingface.co/Comfy-Org/Qwen-Image-2.1), based on the official [Krea2 Turbo](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_krea2_turbo_t2i.json), [Qwen T2I](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_qwen_image_2_1_t2i.json) and [Qwen Edit](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_qwen_image_2_1_image_edit.json) workflows. Qwen uses the template's 25 steps; its comment distinguishes this setting from the original pipeline's recommendation of 40–50 steps. Krea Edit uses its [author's](https://huggingface.co/conradlocke/krea2-identity-edit) recommendation of 8–12 steps; there is no official Comfy-Org workflow for this community LoRA. It is the only downloadable LoRA exception; styles, accelerators and additional enhancer encoders are not downloaded.

When a download completes, the recommended models and parameters are saved on the server as the engine's global configuration, even if the browser has closed. The interface updates inherited fields when reopened or when completion is detected. Explicit preset values and individual overrides are respected. **Use official models and recommended sampling** applies these values when all weights are already installed. The catalog and prompt construction are bundled with the plugin: no workflow files or runtime metadata downloads are required.

## Selecting an engine

| Task | Useful starting point | Configuration that matters |
| --- | --- | --- |
| Generate a new reference or panel | Krea2 or Qwen | Model family, structured prompt, output aspect ratio and MP |
| Preserve identity while editing references | Krea2 · edit | Source order, Identity Edit LoRA, fidelity and initial latent |
| Turn a sketch into rendered art | Sketch to Art in Klecks | Separate Sketch/Turbo LoRAs, denoise, region and layer blending |
| Add manga tones without redrawing | Art to Manga Panel → Manga-Lite | Input levels, screen lines, black/white points and paper/frame |
| Redraw painted art before adding tones | Art to Manga Panel → QWEN-Manga | Compatible Qwen Image 2.1 Turbo weights, instruction and sigma schedule |
| Improve a prompt or analyze an image | Global text generator | Text-generation support; vision support for image inputs |

The regular Qwen download profile uses the non-Turbo model and its own sampling defaults. QWEN-Manga expects compatible **Turbo** weights and uses its editable sigma schedule; select these separately under its model controls.

- **Krea2:** the Krea2 encoder loaded as **krea2** and a VAE compatible with the checkpoint.
- **Krea2 editing and visual references:** grounded encoding of one to four images, VAEEncode for each source, `Krea2EditModelPatch`, zeroed negative conditioning and KSampler. The output latent is also connected to `target_latent` to preprocess references before sampling. This uses the final workflow's design, not the Ostris patch.
- **Krea2 refinement:** VAEEncode of the original and denoising through the existing sampler. It does not use additional references or offer masks.
- **Qwen:** native `TextEncodeQwenImage21` and `QwenImage21Cache` nodes, a **qwen_image** encoder and compatible model/VAE. References connect to the visual encoder and VAE. The first reference determines size; `resolution=0` avoids additional scaling except for the node's adjustment to multiples of 32. The installed version's number of sockets is respected.
- **Analysis:** `TextGenerate`, `CLIPLoader` and `SaveText`; select an encoder with vision and text generation support. The diffusion model is not loaded.

The extension cannot infer every incompatibility between checkpoints, encoders, VAEs and LoRAs. Errors and metadata preserve the operation context, prompt, models, seeds and LoRAs. If an engine is unavailable, importing, projects and page layout remain available.

## Prompts and presets

**Structured prompt** provides TASK, Subject, Appearance, Pose, Expression, Composition, Environment, Lighting and Style for Krea2 and Qwen. Only nonempty fields are included, followed by **Free prompt**, which also accepts a complete prompt. **Show combined prompt** displays the resulting text. Each field is stored in settings and presets; editing one section preserves the others. The **Clear prompt** button next to the heading clears TASK, all eight sections and the free field.

Editing prompt fields or settings keeps the selected preset visible with **Modified**. Changes affect the current operation; **Save settings as preset** saves them under the selected name or a new name. Choosing a preset again applies its stored values.

The **Clone preset** icon copies the selected References, Panels, Refinement or Finishing preset under a new name, including bundled and global presets. Copies are saved in the project without changing the original or fixing inherited model values. **Clone layout preset** is also available in Page layout, and each **LoRA presets** entry has a copy icon.

The six bundled **References** presets (Character, Expressions, Poses, Clothing, Objects and Environments) and five **Refinement** presets (General, Background, Hands, Face and Color → Manga) fill **TASK** and the relevant prompt sections. Sections not changed by a preset keep their content. For references, **Style** preserves an existing style and suggests a neutral full-color illustration only when empty; the free field is cleared to avoid conflicting old instructions. Empty sections are omitted from the final prompt. Reference presets use `TEXT_TO_IMAGE`, or `IMAGE_EDIT` with Krea2 Edit; refinement presets use `IMAGE_EDIT`. They do not specify models, encoders, VAEs, sampling or LoRAs, so these inherit the engine's global configuration.

## Text and vision configuration

In **Settings → Global text generator**, select the CLIP, loading type, device and output length. This configuration is shared across projects, operations and engines; the encoder must support text generation and, for image analysis, vision. The **Enhance** button inside each section and the free field proposes an improvement to that field using the complete prompt as context. It does not change other sections. **Create prompt from image**, in a reference menu, analyzes the image and produces TASK and the eight sections to help reproduce it. Both results are reviewed before applying them; they do not generate images. The description is saved in the asset's metadata for **Use image prompt**, even if you close the Studio while it runs. Results can also be recovered from operation history.

Text proposals are reviewed before application. A configured text generator does not automatically generate or finish images.

## Output size and framing

Size is selected through **Aspect ratio** and **Resolution · MP** (1 MP = 1,000,000 pixels). **Output size** offers **Inherit from original** (the first reference during generation) or **Manual · AR and MP**. Inherit displays the original dimensions with controls disabled; Manual enables them and preserves manual settings when switching modes. For Qwen and Krea2 img2img refinement, Manual adjusts the image before encoding it, using a centered crop. With the Krea2 · edit engine, all complete references are preserved and adjustment is handled by the patch according to `fit_mode`, using the output AR and MP. Original files are preserved. Qwen rounds dimensions to multiples of 32; generation without references uses multiples of 8. Pages are exported in whole pixels. Previous size settings are converted to MP when opened.

Resolution controls the number of output pixels; the page editor's image fit and zoom control how an existing image is framed inside a panel. These are separate choices. Drawing conversion also has its own working resolution and returns a layer to the original canvas.

See [Drawing](drawing.md) for the settings that affect sketch and manga conversion, and [Projects and storage](projects.md) for migration and persistence.
