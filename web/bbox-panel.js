import { el, button, iconButton, field } from './client.js';
import { slider, toggle, seed } from './controls.js';

const boxTypes = [['object', 'Object'], ['character', 'Character'], ['text', 'Text']];
// Colors only tell boxes apart on the canvas; they are not sent to the model as a palette.
const boxColors = ['#3584ff', '#e01b9b', '#2ec27e', '#e5a50a', '#9141ac', '#e66100', '#00a3a3', '#c01c28'];
const boxColor = (box, i) => box.color || boxColors[i % boxColors.length];
const engines = [['moss', 'MOSS-Image · trained on this layout'], ['krea', 'Krea2'], ['qwen', 'Qwen Image 2.1'], ['anima', 'Anima']];

// Boxes are stored as fractions of the canvas so they survive canvas resizing; Klecks receives them in canvas pixels.
// They belong to the workspace and are shared by every engine, while each engine keeps its own prompt and model settings.
export function bboxControls(studio, kind, send, dimensions, changed) {
    const scope = `bbox_${kind}`, fresh = !studio.project.workspace[scope], state = studio.state(scope);
    if (fresh) state.engine = 'moss';
    state.boxes ||= [];
    let cfg = studio.config(scope, state.engine);
    const element = el('div');
    const drawing = el('input', { type: 'checkbox', 'aria-label': 'Draw boxes on canvas', onchange: () => send('manga-drawing-box-tool', { enabled: drawing.checked }) });
    const list = el('div', { class: 'mm-bbox-list' });
    const update = () => { changed(); studio.presetChanged(scope, element); };
    // Box undo stays in this editor session; text edits use the fields' own undo.
    const undone = [], redone = [];
    const undoButton = iconButton('Undo box change', 'undo', () => step(undone, redone), { disabled: true });
    const redoButton = iconButton('Redo box change', 'redo', () => step(redone, undone), { disabled: true });
    function edit(change) {
        undone.push(structuredClone(state.boxes)); redone.length = 0;
        change(); changed(); sync(); renderList();
    }
    function step(from, to) {
        if (!from.length) return;
        to.push(structuredClone(state.boxes)); state.boxes = from.pop();
        changed(); sync(); renderList();
    }
    function sync() {
        const size = dimensions();
        if (size) send('manga-drawing-guide-boxes', { boxes: state.boxes.map((box, i) => ({ x: Math.round(box.x * size.width), y: Math.round(box.y * size.height),
            width: Math.round(box.width * size.width), height: Math.round(box.height * size.height),
            label: `${i + 1} · ${boxTypes.find(([type]) => type === box.type)[1]}`, color: boxColor(box, i) })) });
    }
    function renderList() {
        list.replaceChildren(...state.boxes.map((box, i) => {
            const type = el('select', { 'aria-label': `Box ${i + 1} type`, onchange: e => edit(() => { state.boxes[i].type = e.target.value; }) },
                ...boxTypes.map(([value, text]) => el('option', { value, text })));
            type.value = box.type;
            const color = el('input', { type: 'color', value: boxColor(box, i), 'aria-label': `Box ${i + 1} color`, onchange: e => edit(() => { state.boxes[i].color = e.target.value; }) });
            return el('fieldset', { class: 'mm-bbox-item', style: `--mm-box-color: ${boxColor(box, i)}` }, el('legend', { text: `Box ${i + 1}` }),
                el('div', { class: 'mm-row' }, field('Type', type), field('Color', color),
                    iconButton(`Move box ${i + 1} up`, 'left', () => edit(() => { [state.boxes[i - 1], state.boxes[i]] = [state.boxes[i], state.boxes[i - 1]]; }), { disabled: !i }),
                    iconButton(`Move box ${i + 1} down`, 'right', () => edit(() => { [state.boxes[i + 1], state.boxes[i]] = [state.boxes[i], state.boxes[i + 1]]; }), { disabled: i === state.boxes.length - 1 }),
                    iconButton(`Remove box ${i + 1}`, 'clear', () => edit(() => { state.boxes.splice(i, 1); }))),
                ...box.type === 'text' ? [field('Rendered text', el('input', { value: box.text || '', 'aria-label': `Box ${i + 1} rendered text`, oninput: e => { box.text = e.target.value; changed(); } }))] : [],
                field('Description', el('textarea', { value: box.desc || '', rows: 2, 'aria-label': `Box ${i + 1} description`, oninput: e => { box.desc = e.target.value; changed(); } })));
        }));
        if (!state.boxes.length) list.append(el('small', { text: 'No boxes yet. Enable Draw boxes on canvas and drag on the drawing.' }));
        undoButton.disabled = !undone.length; redoButton.disabled = !redone.length;
    }
    function render() {
        element.replaceChildren();
        const engine = el('select', { 'aria-label': 'BBox engine', onchange: e => {
            state.engine = e.target.value; cfg = studio.config(scope, state.engine); changed(); render();
        } }, ...engines.map(([value, text]) => el('option', { value, text })));
        engine.value = state.engine;
        const presets = el('div', { class: 'mm-row' }); studio.presets(presets, scope, cfg, {}, () => { changed(); render(); });
        const missing = ['CreateBoundingBoxes', 'MOSSImageLayoutPrompt'].filter(type => !studio.defs[type]);
        const prompt = el('details', { open: true }, el('summary', { text: 'Scene prompt' })); studio.promptControls(prompt, cfg, update);
        const sampling = el('div'); studio.samplingControls(sampling, cfg, state.engine, update, scope); sampling.append(seed('Seed', cfg, update));
        element.append(field('Engine', engine), presets, ...missing.length ? [el('small', { text: `Missing ${missing.join(' and ')}. Update ComfyUI, then refresh lists.` })] : [],
            el('small', { text: 'Generates the whole canvas from the scene prompt and the boxes, written in the MOSS-Image layout format. MOSS-Image is trained on it; other engines receive it as prompt text. Put background boxes first and foreground boxes last; the drawing itself is not sent to the model.' }),
            toggle('Draw boxes on canvas', drawing), el('small', { text: 'Drag a corner to resize a box and its edge or label to move it. While drawing boxes, Ctrl+Z and Ctrl+Y undo and redo box changes.' }), list,
            el('div', { class: 'mm-row' }, button('Clear boxes', () => edit(() => { state.boxes = []; })), undoButton, redoButton), prompt,
            slider('Working resolution · MP', el('input', { type: 'number', 'aria-label': 'Working resolution · MP', value: cfg.megapixels, step: 0.1, onchange: e => { cfg.megapixels = Number(e.target.value); update(); } }), [0.25, 4]),
            sampling);
        studio.modelControls(element, cfg, state.engine, update, false, scope, render);
        renderList();
    }
    render();
    return { get cfg() { return cfg; }, get boxes() { return state.boxes; }, element, sync,
        place(box, index) {
            const size = dimensions(), rect = { x: box.x / size.width, y: box.y / size.height, width: box.width / size.width, height: box.height / size.height };
            // Focus stays in Klecks so Ctrl+Z can undo an accidental box right away.
            edit(() => {
                if (index < state.boxes.length) { Object.assign(state.boxes[index], rect); return; }
                const used = state.boxes.map(boxColor);
                state.boxes.push({ ...rect, type: 'object', desc: '', text: '', color: boxColors.find(value => !used.includes(value)) || boxColors[state.boxes.length % boxColors.length] });
            });
        },
        undo: () => step(undone, redone),
        redo: () => step(redone, undone),
        stopDrawing() { drawing.checked = false; },
        hide() { drawing.checked = false; send('manga-drawing-box-tool', { enabled: false }); send('manga-drawing-guide-boxes', { boxes: [] }); },
    };
}
