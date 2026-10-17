# Projects, assets and storage

[Documentation](README.md) · [Project README](../README.md)

**Projects** opens, creates, renames and duplicates projects. A project groups its references, panels, pages, layouts, drawing documents, presets and generation history. Global engine settings remain shared; project-specific instructions and overrides stay with the project.

## Galleries and versions

Importing brings an existing image into References or Panels. **Delete** moves an asset to **Trash**; **Restore** recovers it. **Missing file** means the recorded file cannot be found on disk. Connected references retain their positions when restored from Trash.

Saving over a drawing or refining an asset creates a new version and preserves the original. Drawing documents include a PNG for the composed image and a PSD for the editable layers. Gallery sorting, search and selection help organize the project; galleries display up to 48 thumbnails per page.

## Storage and migration

The initial root is `manga-maker-projects/` under ComfyUI's user directory. **Settings** lets you change it. Each project folder contains `references/`, `panels/`, `pages/` and `project.json`, with relative paths, assets, versions, layouts, presets and jobs. The `manga-maker-settings.json` file in the user directory stores global settings.

Explicit operation or preset fields take priority; other fields inherit the engine's global model configuration, resolved again when the configuration is used. Additional LoRA lists remain independent per operation, including order and model/encoder strengths; Krea2 Edit uses model strength only. Configuration and presets can be imported/exported as JSON.

To move a project, wait for the queue to finish, move **its complete folder while preserving its identifier**, and select the new root. To migrate all projects, move every complete folder. Do not change paths inside `project.json`. Paths escaping the root, including symbolic links, are rejected. Imported originals are preserved byte for byte alongside a normalized PNG copy and WebP thumbnails. Removing images is reversible through **Trash**.

## Jobs and cancellation

Each job is recorded before submission to `/prompt`, with a UUID accepted by the installed server. Results are collected from the original queue's history and imported into the source project even if you switch projects or close the Studio. ComfyUI history is still required to collect results; an error is reported if it is deleted before collection. The × button in the bottom panel cancels a queued or running job by its ID without interrupting other jobs. The status shows “Cancelling” until cancellation is confirmed; if generation has already completed, its results are preserved.

Drawing generation and manga conversion return previews to the open Klecks session. Save the drawing to preserve those layers in the project. Closing a project or drawing is not a substitute for saving unsaved canvas edits.

## Recovering common problems

| Symptom | What to check |
| --- | --- |
| A node is reported missing | Install the package listed in [Installation](installation.md), restart when idle and refresh lists |
| A model selection is missing or unregistered | Confirm its registered ComfyUI location, refresh lists and select the file again |
| Image analysis or prompt enhancement fails | Verify the global text generator; image tasks need a vision-capable encoder |
| A reference is marked Trash | Restore it from the connected-reference controls or the Trash gallery |
| A reference is marked Missing file | Recover the file or reconnect an available asset |
| A drawing result is skipped | The canvas changed after capture; generate from the current drawing |
| A layout's font changes after migration | Install the same font file on the destination installation |
| A job no longer appears in queue/history | Preserve ComfyUI history until collection; check server history and rerun if needed |

Generation quality depends on the selected weights and instructions. For Krea2 edits, check reference order, fidelity and initial latent before changing unrelated global settings.
