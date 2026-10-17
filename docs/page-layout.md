# Page layout, dialogue and export

[Documentation](README.md) · [Project README](../README.md)

A layout stores geometry and references to panel assets. It is separate from the source images, so one panel can be framed differently in different pages without changing the original.

## Panels and composition

Use **Page layout** to add panels, import compatible PanelComposer presets, and place images by dragging a panel from the gallery or using **Place**. The selected panel's controls edit its shape, framing and appearance. Fit controls decide whether an image stays entirely visible or fills its panel; zoom and offset adjust the composition within that shape.

Rectangular and polygonal panels without the workflow's panel-count limit. Editable movement, resizing, vertices, duplication, reading order and layers, contain/cover fit, image zoom and offset, background, borders, gaps and guides. Empty panels are shown explicitly.

The canvas uses the same renderer for preview and export, with stored geometry and framing. PanelComposer presets are reused and copied into the project; the Studio's interactive renderer allows individual framing that the installed compositor does not expose. Exported layouts are stored as JSON.

## Dialogue and thought bubbles

In **Page layout**, **Add speech bubble** and **Add thought bubble** add text over panels. **Bubble style** offers oval speech, thought cloud, rectangular box, rounded box and exclamation styles. Bubbles can be moved and resized with the mouse, duplicated, deleted, and included in undo/redo. The right panel lets you edit text, font, size, colors, layer and tail; **Show border** hides or shows the border without losing its width. **Fill opacity · %** adjusts background and tail transparency without fading the text or border; at 0% with the border disabled, only text remains. **Enhance dialogue**, next to the text field, uses the global CLIP from Settings to improve dialogue or thoughts while preserving language, meaning and voice. The proposal is reviewed before applying it to the original bubble and can be undone; a configured text generator is required. Text wraps to fit the available space. Bubbles are saved with the layout and included in exported PNGs.

A bubble belongs to the page layout. Its text, tail, fill, border and layer can be edited independently from the image beneath it. Use a transparent fill and no border when the intended result is plain caption text.

## Fonts

**Font** includes Sans serif, Serif, Monospace, Handwritten and Display, using local browser/system fonts. **Install font…** lets you add TTF, OTF, WOFF or WOFF2 files from your computer. They are validated in the browser and saved under `manga-maker-fonts/` in ComfyUI's user directory, available across projects. Fonts are not downloaded. When moving layouts to another installation, install the same font files there: the identifier depends on file content, allowing the typeface to be recovered. Export waits for the fonts in use to load.

## Layout presets and export

Layout presets preserve reusable panel geometry. **Clone layout preset** creates an editable copy rather than changing the original preset. PanelComposer supplies optional imported layouts; Studio performs its own interactive rendering and export.

Export renders the composed page into the project's `pages/` assets. It includes panel framing, bubbles and loaded fonts, and excludes editing guides. Layout JSON keeps the editable arrangement; a PNG is the rendered page. Keep the project and its source assets when you need to return to editing later.

## Shortcuts

| Action | Shortcut |
| --- | --- |
| Delete selected item | **Delete** |
| Undo | **Ctrl/Cmd Z** |
| Redo | **Ctrl/Cmd Y** or **Ctrl/Cmd Shift Z** |
| Close a polygon | **Enter** |
| Cancel the current action | **Esc** |
| Zoom | **Ctrl + mouse wheel** |

Typing inside text fields is not intercepted. A completed drag forms a single undo operation.
