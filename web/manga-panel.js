import { api } from '../../scripts/api.js';
import { el, field } from './client.js';
import { options } from './prompts.js';

import { mangaDefaults } from './manga-prompt.js';
import { slider, toggle, seed } from './controls.js';

const ranges = { megapixels: [0.25, 8], black: [0, 1], white: [0, 1], gamma: [0.1, 3], screen_lines: [60, 400], white_point: [0, 1], black_point: [0, 1], light_tone: [0, 1], dark_tone: [0, 1],
    gradation: [0, 3], white_lines: [0, 1], pen_threshold: [0, 1], resolution: [512, 2048], crop_x: [0, 1], crop_y: [0, 1], border: [0, 40], margin: [0, 200], ink: [0, 1] };

export function mangaControls(studio, kind, changed) {
    const scope = `manga_${kind}`, existing = studio.project.config[`${scope}:qwen`];
    const cfg = studio.config(scope, 'qwen'); cfg.engine = 'qwen';
    if (!existing) { Object.assign(cfg, structuredClone(mangaDefaults), { seed: 1, random_seed: false }); studio.saveSoon(); }
    const element = el('div');
    function render() {
        element.replaceChildren();
        const update = () => { changed(); studio.presetChanged(scope, element); };
        const presets = el('div', { class: 'mm-row' }); studio.presets(presets, scope, cfg, {}, () => { changed(); render(); }); element.append(presets);
        const select = (label, key, values, rerender = false) => {
            const input = el('select', { 'aria-label': label, onchange: e => { cfg[key] = e.target.value; update(); if (rerender) render(); } }, ...values.map(([value, text]) => el('option', { value, text })));
            input.value = cfg[key]; return field(label, input);
        };
        const number = (label, key, step = 0.01) => slider(label, el('input', { type: 'number', 'aria-label': label, value: cfg[key], step, onchange: e => { cfg[key] = Number(e.target.value); update(); } }), ranges[key]);
        element.append(select('Manga workflow', 'mode', [['lite', 'Manga-Lite · without edit model'], ['qwen', 'QWEN-Manga · Qwen Image 2.1 Turbo']], true),
            el('small', { text: 'Requires ComfyUI-MangaScreen. Optional Manga Lineart requires comfyui_controlnet_aux and its weights. Install dependencies separately, restart ComfyUI, then refresh lists.' }),
            number('Working resolution · MP', 'megapixels', 0.1));
        if (cfg.mode === 'lite') {
            for (const [key, label] of [['black', 'Input black'], ['white', 'Input white'], ['gamma', 'Gamma']]) element.append(number(label, key));
        } else {
            element.append(field('Manga edit instruction', el('textarea', { value: cfg.instruction, oninput: e => { cfg.instruction = e.target.value; update(); } })),
                seed('Manga seed', cfg, update),
                select('Manga sampler', 'sampler', options(studio.defs, 'KSamplerSelect', 'sampler_name').map(v => [v, v])),
                field('Sampling sigmas', el('input', { value: cfg.sigmas, onchange: e => { cfg.sigmas = e.target.value; update(); } })));
            studio.modelControls(element, cfg, 'qwen', update, false, scope, render);
        }
        const finish = el('details', {}, el('summary', { text: 'Screentones and ink' }));
        for (const [key, label] of [['screen_lines', 'Screen lines'], ['white_point', 'Paper white point'], ['black_point', 'Solid black point'], ['light_tone', 'Light tone'], ['dark_tone', 'Dark tone'], ['gradation', 'Gradation'], ['white_lines', 'White lines in black'], ['pen_threshold', 'Pen threshold']]) finish.append(number(label, key, key === 'screen_lines' ? 10 : 0.01));
        finish.append(toggle('Extract pen lines · Manga Lineart', el('input', { type: 'checkbox', checked: cfg.pen_lines, onchange: e => { cfg.pen_lines = e.target.checked; update(); } })), number('Lineart resolution · px', 'resolution', 64));
        const panel = el('details', {}, el('summary', { text: 'Panel frame and paper' }), select('Panel shape', 'frame', ['original', '4:3 wide', '16:9 wide', '3:4 tall', '1:1'].map(v => [v, v])), select('Paper', 'paper', ['white', 'off-white', 'cream'].map(v => [v, v])));
        for (const [key, label, step] of [['crop_x', 'Crop X', 0.05], ['crop_y', 'Crop Y', 0.05], ['border', 'Panel border · px at 1024', 1], ['margin', 'Paper margin · px at 1024', 1], ['ink', 'Printed ink', 0.05]]) panel.append(number(label, key, step));
        element.append(finish, panel);
        if (cfg.mode === 'lite') element.append(el('button', { type: 'button', text: 'Refresh lists', onclick: () => studio.action(async () => { studio.defs = await api.getNodeDefs(); render(); }) }));
    }
    render(); return { cfg, element };
}
