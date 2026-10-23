# Studio API and settings contracts

Read this when inspecting a running server or configuring it through HTTP. All paths are relative to the **confirmed ComfyUI server URL**, including any deployment prefix. Use the deployment's existing authentication through available tools; do not weaken authentication or open a public listener for setup. These are local server calls, not a hosted Manga Maker service.

## Inventory and activation

| Request | Use |
| --- | --- |
| `GET /object_info` | Loaded node schemas and registered model/encoder/VAE/LoRA filenames |
| `GET /queue` | `queue_running` and `queue_pending`; both must be empty before an idle restart |
| `GET /manga-maker/settings` | Current global configuration |
| `GET /manga-maker/models` | Catalog `profiles`, `artifacts`, installed weight paths and download state; does not start downloads |
| `GET /manga-maker/assistant` | Story assistant: `available` (llama-cpp-python installed), `defaults`, GGUF `models` with compatible `projectors`, scan `errors`, and whether a model is `loaded`. Settings live under `assistant` in `/manga-maker/settings` |
| `POST /manga-maker/settings` | Persist settings; see replacement semantics below |

If `/object_info` responds but Studio routes return 404, check plugin path, startup import errors and whether its Python code was loaded after installation. Do not POST to a missing route or create replacement server code. A stopped server cannot reveal its loaded schemas; inspect configuration/startup logs and defer live verification until it starts.

Schemas may advertise combos as a list in the first input slot or as `COMBO` with an `options` list in the metadata slot. Inspect both `required` and `optional` inputs. Use full registered filenames, including subfolders. Optional cache/attention nodes and enum values vary by installation.

## Settings shape and preservation

Global configuration is stored in the active ComfyUI user directory as `manga-maker-settings.json`; do not assume a fixed absolute user path. Its top-level fields are:

```json
{
  "root": "/absolute/path/to/manga-maker-projects",
  "defaults": {},
  "models": {},
  "presets": {},
  "text_generator": {}
}
```

`models` contains engine profiles keyed by `krea`, `krea_edit`, and `qwen`. Relevant fields include `model`, `encoder`, `encoder_type`, `vae`, `weight_dtype`, `encoder_device`, sampling values and engine-specific fields. Use the checkout's `web/prompts.js` (`initialSettings`), `web/models.js`, catalog profiles and installed schemas rather than creating a new configuration format. Krea uses encoder type `krea2`.

The backend preserves omitted top-level fields, but submitted `models`, `defaults`, `presets` or `text_generator` maps replace the corresponding stored maps. For example, `{"models":{"qwen":{"model":"new.safetensors"}}}` would discard other engines and other stored Qwen fields. Read, deep-copy and merge the requested fields first. Preserve unspecified fields, including numeric zeros and user-selected device/precision settings.

A safe request sequence for a user-requested change is:

```python
# Pseudocode: use the confirmed server and its existing authenticated client.
before = get_json('/manga-maker/settings')
save_backup(before)  # local backup outside published repository content
models = deepcopy(before.get('models', {}))
profile = models.setdefault('qwen', {})
profile.update(validated_user_requested_fields)
# Re-read before saving if discovery or user decisions took time; re-merge on changes.
post_json('/manga-maker/settings', {'models': models})
after = get_json('/manga-maker/settings')
# Compare all settings with before, allowing only requested profile changes.
```

The plugin uses registered user storage and validates the project root. Do not change `root` to complete model selection. Moving projects requires their complete folders and stable identifiers, as described in repository `docs/projects.md`.

Project configuration stores operation settings under `config`, such as `panels:krea_edit`, `sketch_panels:krea_edit` and `manga_panels:qwen`, with corresponding `references` scopes. `model_overrides` takes priority over global model fields. QWEN-Manga and Manga-Lite use the manga operation's `mode` field; do not create a new global `manga_lite` model engine. Prefer Studio's controls for per-project changes. Read its current project API and file format before automating those changes; do not overwrite a live browser session's unsaved state.

## Downloads and verification

For an explicitly authorized official model download, Studio uses `POST /manga-maker/models/download` with `{"engine":"krea"}`, `{"engine":"krea_edit"}` or `{"engine":"qwen"}`. Inspect the catalog first: each profile may include several large files. Poll `GET /manga-maker/models` and inspect `downloads[engine].state`; a successful POST is not completion. States include `queued`, `downloading`, `complete` and `error`. Download states can include `filename`, `received`, `total` and `error`; wait for `complete` and read configuration back before reporting success.

Completion applies the profile's recommended settings globally. Existing operation overrides still win. The `qwen` profile is regular Qwen, not QWEN-Manga Turbo; Sketch LoRAs and optional annotator weights are separate. Do not invoke this endpoint for an inventory-only request.

Schema/UI checks do not load weights or establish image quality. Report actual inference separately from package installation, registered schemas and settings read-back.
