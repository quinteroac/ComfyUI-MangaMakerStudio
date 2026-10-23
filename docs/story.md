# Story Studio and assistant

[Documentation](README.md) · [Project README](../README.md)

**Story** is the writing workspace. It has four modules and a local writing assistant. The story is saved with the project in `project.json` (`story`), so it is duplicated and migrated with the project.

## Modules

| Module | Contents |
| --- | --- |
| **Logline** | Title, genre, tone, audience, logline, synopsis and themes |
| **Characters** | Character cards with role, age, appearance, personality, goal, conflict, arc, voice, relationships, visual prompt and notes. A card can have a portrait and linked reference images from the project |
| **Plot & Structure** | Acts and beats from a template (Three acts, Kishōtenketsu, Save the Cat or Free structure). Beats can be linked to characters |
| **Script Editor** | Chapters → pages → panels. Each panel has a shot, a visual description, characters, an optional panel image and lines of dialogue, thought, caption or SFX |

**Apply template** replaces every act and beat. **Export script** downloads the chapters and pages as Markdown. **Export card** renders a character card as a PNG.

## From story to images and pages

- **Generate reference sheet** (Characters) fills the References prompt with the Character preset, the card's name and its visual prompt (or appearance). Generate the image there, then link it to the card with **Link reference image** or **Choose portrait**.
- **Send to Panels** (Script) fills the Panels prompt with the panel description, the characters' visual prompts and the shot. For engines that take references, the first available portrait or reference image of each character is connected (up to four, except Qwen). Link the generated image back with **Link panel image**.
- **Create page layout** (Script) creates a Page layout with one panel per script panel, in reading order, and a bubble for each line: dialogue → oval, thought → cloud, caption → box, SFX → shout. Linked panel images are placed in their panels. **Update page layout** replaces the panels and bubbles of the linked layout; other layout settings are kept.

## Assistant

The assistant panel on the right follows the active module. Each module has its own conversation, stored in `story-chat.json` in the project folder. The current story (logline, cast, plot, script and the selected character, chapter or page) is sent as context with every message.

**Quick actions** ask for a structured proposal: logline and synopsis, a new character, supporting cast, developing the selected character, describing a character from its images, a plot outline, chapters from the plot, pages for the selected chapter, the full script of the selected page or a dialogue pass. The answer is constrained to a JSON schema and shown for review. **Apply to story** writes it; **Undo** restores the story as it was before applying. Free chat messages are not applied automatically; use **Copy**.

### Settings

Configure it in **Settings → Story assistant**:

| Setting | Effect |
| --- | --- |
| Language model | A GGUF file from `models/LLM` (or other folders registered as `LLM`) |
| Vision | Enables images in messages and **Describe from reference images**. Requires a compatible projector (`mmproj`); only projectors that match the model's architecture and embedding size are listed |
| Keep model loaded | Off by default: the model is loaded for each message and released when the answer ends. On: the model stays loaded between messages and is released automatically before any ComfyUI workflow is queued, or with **Release loaded model** |
| Context, GPU layers, temperature, maximum answer | Passed to llama.cpp. `-1` GPU layers offloads all layers; `0` runs on the CPU |
| Thinking | Shown when the model template supports it. Structured proposals always disable it |

### Memory behavior

The assistant needs [llama-cpp-python](https://github.com/abetlen/llama-cpp-python) installed in ComfyUI's Python environment; without it the rest of Story still works. It runs in a separate process. Before a model is loaded, ComfyUI's loaded models are unloaded and its cache is cleared. When the process ends, after each answer or on cancel, all of its RAM and VRAM is released. The assistant does not start while a workflow is running or queued, and workflows cannot be queued while it is answering.

If the history no longer fits in the context window, the request fails with the token count; clear the module's conversation or increase Context. Nothing is dropped silently. Running out of memory while loading reports a clear error; reduce Context or GPU layers, or pick a smaller model.
