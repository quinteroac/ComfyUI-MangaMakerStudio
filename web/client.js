import { api } from '../../scripts/api.js';
import { aspectRatios, imageDimensions, sizeSettings } from './size.js';

export function uuid() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function request(path, body, method = 'GET') {
    const result = await api.fetchApi(`/manga-maker${path}`, {
        method, ...(body instanceof FormData ? { body } : body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    if (!result.ok) {
        let data;
        try { data = await result.json(); } catch { throw new Error(`Server: ${result.status}. Restart ComfyUI to load Manga Maker Studio when no jobs are active.`); }
        throw new Error(data.error || JSON.stringify(data));
    }
    return result.json();
}
export function assetUrl(project, asset, thumb = false) {
    return api.apiURL(`/manga-maker/projects/${project}/assets/${asset}${thumb ? '?thumb=1' : ''}`);
}
export function download(name, data) {
    const blob = data instanceof Blob ? data : new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
        else if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key in node && key !== 'list') node[key] = value;
        else node.setAttribute(key, value);
    }
    node.append(...children.flat().filter(x => x != null)); return node;
}
export const button = (text, action, attrs = {}) => el('button', { type: 'button', text, onclick: action, ...attrs });
const iconPaths = {
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    folder: 'M3 7V5h6l2 2h10v12H3Z',
    settings: 'M4 7h16M4 17h16M8 4v6M16 14v6',
    back: 'M20 12H4m6-6-6 6 6 6',
    upload: 'M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5',
    download: 'M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5',
    save: 'M3 3h15l3 3v15H3ZM7 3v6h10V3M7 21v-8h10v8',
    plus: 'M12 4v16M4 12h16',
    copy: 'M7 7h14v14H7ZM3 17V3h14',
    clear: 'm6 6 12 12M6 18 18 6',
    tags: 'M3 3h8l10 10-8 8L3 11ZM7 7h.01',
    order: 'M8 6h13M8 12h13M8 18h13M3 4v4m-1 2h2l-2 4h2m-2 2h2v4H2',
    pencil: 'm4 16 12-12 4 4L8 20H4Zm9-9 4 4',
    info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 11v6m0-10h.01',
    trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
    restore: 'M3 10a9 9 0 1 1 2 8M3 4v6h6',
    link: 'm10 14 4-4M8 16l-2 2a4 4 0 0 1-6-6l4-4m12 0 2-2a4 4 0 0 1 6 6l-4 4',
    wand: 'm4 18 10-10 4 4L8 22ZM5 3v6M2 6h6m10-5v4m-2-2h4',
    sparkles: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4m-2-2h4',
    image: 'M3 3h18v18H3Zm0 14 5-5 4 4 4-6 5 7M8 7h.01',
    check: 'm5 12 4 4L19 6',
    place: 'M3 3h13v13H3Zm0 10 4-4 4 4 5-6m3 7v8m-4-4h8',
    left: 'm15 5-7 7 7 7',
    right: 'm9 5 7 7-7 7',
    collapse: 'm5 9 7-5 7 5M5 18l7-5 7 5',
    pointer: 'M5 3v17l5-5 4 7 4-2-4-7h7Z',
    rectangle: 'M3 5h18v14H3Z',
    polygon: 'm4 5 15-2 3 14-12 5-8-9Z',
    vertices: 'M5 5h14v14H5ZM3 3h4v4H3Zm14 0h4v4h-4ZM3 17h4v4H3Zm14 0h4v4h-4Z',
    crop: 'M7 2v15h15M2 7h15v15',
    hand: 'M8 12V5a2 2 0 0 1 4 0v7-9a2 2 0 0 1 4 0v9-7a2 2 0 0 1 4 0v9c0 5-2 8-7 8-3 0-5-2-7-5l-3-5a2 2 0 0 1 3-2l2 2',
    undo: 'M4 10h10a6 6 0 0 1 0 12M4 10l6-6m-6 6 6 6',
    redo: 'M20 10H10a6 6 0 0 0 0 12m10-12-6-6m6 6-6 6',
    fit: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',
    center: 'M12 2v20M2 12h20M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
    speech: 'M21 10a9 7 0 0 1-9 7H7l-4 4 1-7a7 7 0 0 1-1-4 9 7 0 0 1 18 0Z',
    thought: 'M7 5a4 4 0 0 1 7-2 4 4 0 0 1 6 4 4 4 0 0 1-1 7 4 4 0 0 1-7 2 4 4 0 0 1-7-2 4 4 0 0 1 2-9ZM6 19a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM2 23h.01',
    orientation: 'M8 3H3v5m0-5 5 5m8 13h5v-5m0 5-5-5M9 6h9v12H9Z',
    up: 'm6 15 6-6 6 6',
    down: 'm6 9 6 6 6-6',
    dice: 'M4 4h16v16H4ZM8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01',
    sidebar: 'M3 4h18v16H3ZM9 4v16',
};
export function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': name === 'more' ? 4 : 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'mm-icon' })) svg.setAttribute(key, value);
    const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', iconPaths[name]); svg.append(path); return svg;
}
export function iconButton(label, name, action, attrs = {}, showLabel = false) {
    const node = button('', action, { class: 'mm-icon-button', 'aria-label': label, title: label, ...attrs });
    node.append(icon(name)); if (showLabel) node.append(el('span', { text: label })); return node;
}
export const field = (label, input, help = '') => el('label', { class: 'mm-field' }, el('span', { text: label }), input, help ? el('small', { text: help }) : null);
export function sizeControls(value, changed, disabled = false) {
    const size = sizeSettings(value);
    let aspect = size.aspect_ratio;
    const update = () => {
        const next = { aspect_ratio: aspect, megapixels: Number(mp.value) };
        try { imageDimensions(next); } catch (error) { mp.setCustomValidity(error.message); mp.reportValidity(); return; }
        for (const node of ratios.children) node.setAttribute('aria-pressed', String(node.dataset.ratio === aspect));
        mp.setCustomValidity(''); changed(next);
    };
    const ratios = el('div', { class: 'mm-aspect-grid', role: 'group', 'aria-label': 'Aspect ratio' },
        ...[...new Set([...aspectRatios, aspect])].map(value => {
            const [x, y] = value.split(':').map(Number), longest = Math.max(x, y);
            const label = value === '210:297' ? 'A4 · portrait' : value === '297:210' ? 'A4 · landscape' : value;
            const node = button('', () => { aspect = value; update(); }, { class: 'mm-aspect-button', disabled, 'data-ratio': value, 'aria-label': label, title: label, 'aria-pressed': String(value === aspect) });
            node.append(el('span', { class: 'mm-aspect-icon', 'aria-hidden': 'true' }, el('span', { style: `width:${28 * x / longest}px;height:${28 * y / longest}px` })), el('span', { text: label.startsWith('A4') ? value === '210:297' ? 'A4 ↕' : 'A4 ↔' : value }));
            return node;
        }));
    const mp = el('input', { type: 'number', 'aria-label': 'Resolution · MP', 'data-size': 'megapixels', disabled, value: size.megapixels, min: 0.000001, step: 'any', onchange: update });
    return el('div', { class: 'mm-resolution' }, el('fieldset', { class: 'mm-aspect-field' }, el('legend', { text: 'Aspect ratio' }), ratios), field('Resolution · MP', mp));
}
export function chooseFile(accept, action, multiple = false) {
    const input = el('input', { type: 'file', accept, multiple });
    input.onchange = () => action([...input.files]); input.click();
}
