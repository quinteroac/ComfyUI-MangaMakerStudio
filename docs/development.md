# Development and validation

[Documentation](README.md) · [Project README](../README.md)

## Bundled Klecks editor

Paths in this section are relative to the repository root.

The embed is bundled in `drawing/klecks/`, outside ComfyUI's JavaScript extension directory, and loads only when the drawing editor is opened. Drawing needs no CDN, account, separate server or external connection. Its MIT license, dependency and font credits, and upstream revision are included with the assets. The build uses TypeScript and Parcel; `ag-psd`, `buffer`, `polygon-clipping` and `transformation-matrix` are compiled into the bundle. Node/npm are development tools for rebuilding Klecks, not requirements for using the plugin. The integration uses the embed's public `openProject`, `readPSD`, `getPNG`, `getPSD` and `onSubmit` APIs. The bundled local patch adds `applyLayer`, `getRevision`, `onReady`, native stroke callbacks, display-only guides and a box tool (`setGuideBoxes`, `setBoxTool`, `onBoxDrawn`, `onBoxToolEnd`); it updates layers through Klecks' own canvas/history operations. To reproduce the build, apply `drawing/klecks-sketch.patch` to the revision in `UPSTREAM.json` before running its listed build commands.

## Validation

Inspected environment: ComfyUI 0.39.0 and frontend 1.55.14. Uses `app.registerExtension`, the public sidebar and commands, DOM dialogs and the existing API; it does not replace the central area through private APIs.

- Storage and route tests: isolation, versions, originals, duplication, relocation, containment and results associated with the correct project.
- Story and assistant tests: story actions, context, script layouts, GGUF catalog and projector pairing, streamed answers, history, keep-loaded reuse and release before workflows. Route tests use a fake inference worker; no model is loaded.
- Prompt tests: Krea/Qwen paths, actual reference connections, LoRA chains reaching the sampler, separate analysis and missing dependencies. Installed V3 schemas were checked without loading models.
- Browser tests: references, panels, refinement, composition, analysis and finishing with the real frontend and isolated storage. Only the generative queue is simulated; models are not loaded. Pixel-identical export, reopening, light/dark themes, a small window and an unchanged ComfyUI graph.

```sh
# Run these commands from the ComfyUI directory:
python -m unittest discover -s custom_nodes/ComfyUI-MangaMakerStudio/tests -v
node --experimental-default-type=module custom_nodes/ComfyUI-MangaMakerStudio/tests/test_models.mjs
node --experimental-default-type=module custom_nodes/ComfyUI-MangaMakerStudio/tests/test_story.mjs
node custom_nodes/ComfyUI-MangaMakerStudio/tests/test_mcp.mjs
node --experimental-default-type=module custom_nodes/ComfyUI-MangaMakerStudio/tests/test_prompts.mjs /path/object_info.json
node --experimental-default-type=module custom_nodes/ComfyUI-MangaMakerStudio/tests/test_manga.mjs /path/object_info.json /tmp/manga-screen-graphs.json
python custom_nodes/ComfyUI-MangaMakerStudio/tests/check_schemas.py /path/object_info.json /tmp/manga-built-prompts.json
# Install Playwright separately for browser development; it is not a product dependency:
CHROMIUM_PATH=/path/chromium node --experimental-default-type=module custom_nodes/ComfyUI-MangaMakerStudio/tests/browser.mjs /path/playwright /path/python
CHROMIUM_PATH=/path/chromium node --experimental-default-type=module custom_nodes/ComfyUI-MangaMakerStudio/tests/browser_sketch.mjs /path/playwright /path/python
CHROMIUM_PATH=/path/chromium node --experimental-default-type=module custom_nodes/ComfyUI-MangaMakerStudio/tests/browser_story.mjs /path/playwright /path/python
```

Sources checked against the installed code: [extensions](https://docs.comfy.org/custom-nodes/js/javascript_overview), [sidebar](https://docs.comfy.org/custom-nodes/js/javascript_sidebar_tabs), [server](https://docs.comfy.org/development/comfyui-server/comms_routes) and [frontend development](https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/docs/extensions/development.md).

The detailed dated validation record is kept in [VALIDATION.md](../VALIDATION.md). The browser fixtures use isolated temporary storage and simulated generation outputs. They are also the source of the documentation screenshots; no production project data is shown.

For `test_manga.mjs`, collect `object_info.json` from a server with MangaScreen installed; enable ControlNet Auxiliary Preprocessors to validate the optional lineart branch. Passing that schema file as a final argument to `browser_sketch.mjs` also exercises both manga modes through the simulated queue.
