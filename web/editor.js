import { api } from '../../scripts/api.js';
import { uuid, el, button, iconButton, field, assetUrl, sizeControls, chooseFile, request } from './client.js';
import { imageDimensions, sizeSettings } from './size.js';

const newBubble = (type = 'speech') => ({ id: uuid(), type, x: 0.12, y: 0.12, w: 0.28, h: 0.12, z: 0,
    text: '', fontSize: 40, font: 'sans-serif', fill: '#ffffff', fillOpacity: 1, color: '#111111', stroke: '#111111', border: 3, borderEnabled: true, tail: true, tailX: 0.3, tailY: 1.3 });
export const newPage = () => ({ id: uuid(), name: 'Page 1', aspect_ratio: '2:3', megapixels: 3.84, width: 1600, height: 2400, background: '#ffffff', borderColor: '#111111',
    border: 4, gutter: 12, reading: 'rtl', panels: [], bubbles: [], guidesX: [0.5], guidesY: [0.5], snap: true });
export function normalizePage(value) {
    const page = { ...newPage(), ...structuredClone(value) };
    Object.assign(page, sizeSettings(value?.width || value?.aspect_ratio ? value : page));
    page.panels = page.panels.map((p, i) => ({ id: uuid(), order: i + 1, z: i, asset: null, fit: 'cover', zoom: 1, dx: 0, dy: 0, ...p }));
    page.bubbles = (page.bubbles || []).map((b, i) => ({ ...newBubble(), z: i, ...b }));
    return page;
}
const clone = value => structuredClone(value);
const bounds = polygon => {
    const x = polygon.map(p => p[0]), y = polygon.map(p => p[1]);
    return [Math.min(...x), Math.min(...y), Math.max(...x), Math.max(...y)];
};
const inPolygon = (point, polygon) => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [x, y] = polygon[i], [a, b] = polygon[j];
        if ((y > point[1]) !== (b > point[1]) && point[0] < (a - x) * (point[1] - y) / (b - y) + x) inside = !inside;
    }
    return inside;
};
function path(ctx, polygon, width, height) {
    ctx.beginPath(); polygon.forEach(([x, y], index) => index ? ctx.lineTo(x * width, y * height) : ctx.moveTo(x * width, y * height)); ctx.closePath();
}

function bubbleText(ctx, text, width) {
    const lines = [];
    for (const paragraph of text.split('\n')) {
        let line = '';
        for (const word of paragraph.split(/\s+/).filter(Boolean)) {
            if (line && ctx.measureText(`${line} ${word}`).width <= width) { line += ` ${word}`; continue; }
            if (line) { lines.push(line); line = ''; }
            for (const char of word) {
                if (line && ctx.measureText(line + char).width > width) { lines.push(line); line = ''; }
                line += char;
            }
        }
        lines.push(line);
    }
    return lines;
}

function renderBubble(ctx, bubble, page) {
    const x = bubble.x * page.width, y = bubble.y * page.height, w = Math.max(1, bubble.w * page.width), h = Math.max(1, bubble.h * page.height);
    const cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2;
    const tx = x + bubble.tailX * w, ty = y + bubble.tailY * h;
    const angle = Math.atan2((ty - cy) / ry, (tx - cx) / rx);
    const tail = bubble.tail && !['caption', 'rounded'].includes(bubble.type) && Math.hypot((tx - cx) / rx, (ty - cy) / ry) > 1;
    const border = bubble.borderEnabled ? Math.max(0, bubble.border) : 0;
    ctx.save(); ctx.fillStyle = bubble.fill; ctx.strokeStyle = bubble.stroke; ctx.lineWidth = border || 1;
    const alpha = ctx.globalAlpha, fillAlpha = alpha * Math.max(0, Math.min(1, bubble.fillOpacity ?? 1));
    ctx.beginPath();
    if (bubble.type === 'caption') ctx.rect(x, y, w, h);
    else if (bubble.type === 'rounded') ctx.roundRect(x, y, w, h, Math.min(w, h) * 0.15);
    else if (bubble.type === 'shout') {
        for (let i = 0; i <= 48; i++) {
            const a = (tail ? angle + 0.18 : 0) + (2 * Math.PI - (tail ? 0.36 : 0)) * i / 48, r = i % 2 ? 0.87 : 1;
            const px = cx + rx * r * Math.cos(a), py = cy + ry * r * Math.sin(a);
            if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        }
        if (tail) ctx.lineTo(tx, ty);
        ctx.closePath();
    } else if (bubble.type === 'thought') {
        for (let i = 0; i <= 144; i++) {
            const a = i * Math.PI / 72, r = 1 + 0.055 * Math.cos(a * 12);
            const px = cx + rx * r * Math.cos(a), py = cy + ry * r * Math.sin(a);
            if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        }
        ctx.closePath();
    } else {
        ctx.ellipse(cx, cy, rx, ry, 0, tail ? angle + 0.18 : 0, tail ? angle + 2 * Math.PI - 0.18 : 2 * Math.PI);
        if (tail) ctx.lineTo(tx, ty);
        ctx.closePath();
    }
    ctx.globalAlpha = fillAlpha; ctx.fill(); ctx.globalAlpha = alpha; if (border) ctx.stroke();
    if (bubble.type === 'thought' && tail) {
        const ax = cx + rx * Math.cos(angle), ay = cy + ry * Math.sin(angle);
        for (const [t, size] of [[0.35, 0.065], [0.7, 0.045], [1, 0.025]]) {
            ctx.beginPath(); ctx.arc(ax + (tx - ax) * t, ay + (ty - ay) * t, Math.min(w, h) * size, 0, 2 * Math.PI);
            ctx.globalAlpha = fillAlpha; ctx.fill(); ctx.globalAlpha = alpha; if (border) ctx.stroke();
        }
    }
    const rectangular = ['caption', 'rounded'].includes(bubble.type);
    const textWidth = w * (rectangular ? 0.85 : 0.68), textHeight = h * (rectangular ? 0.85 : 0.65);
    let fontSize = Math.max(1, bubble.fontSize), lines;
    do {
        ctx.font = `${fontSize}px ${bubble.font}`;
        lines = bubbleText(ctx, bubble.text, textWidth);
        if (lines.length * fontSize * 1.2 <= textHeight || fontSize <= 1) break;
        fontSize = Math.max(1, Math.min(fontSize * 0.9, textHeight / (lines.length * 1.2)));
    } while (true);
    ctx.fillStyle = bubble.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    lines.forEach((line, i) => ctx.fillText(line, cx, cy + (i - (lines.length - 1) / 2) * fontSize * 1.2));
    ctx.restore();
}

export function renderPage(canvas, page, images, decorations = null) {
    canvas.width = page.width; canvas.height = page.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = page.background; ctx.fillRect(0, 0, page.width, page.height);
    for (const panel of [...page.panels].sort((a, b) => a.z - b.z)) {
        const [x, y, right, bottom] = bounds(panel.polygon);
        const left = x * page.width, top = y * page.height, w = (right - x) * page.width, h = (bottom - y) * page.height;
        ctx.save(); path(ctx, panel.polygon, page.width, page.height); ctx.clip();
        ctx.fillStyle = page.background; ctx.fillRect(left, top, w, h);
        const image = images.get(panel.asset);
        if (image?.complete && image.naturalWidth) {
            const scale = (panel.fit === 'contain' ? Math.min(w / image.naturalWidth, h / image.naturalHeight) : Math.max(w / image.naturalWidth, h / image.naturalHeight)) * panel.zoom;
            const iw = image.naturalWidth * scale, ih = image.naturalHeight * scale;
            ctx.drawImage(image, left + (w - iw) / 2 + panel.dx * w, top + (h - ih) / 2 + panel.dy * h, iw, ih);
        } else {
            ctx.fillStyle = '#e6e6e6'; ctx.fillRect(left, top, w, h);
            ctx.fillStyle = '#444444'; ctx.font = `${Math.max(18, Math.min(w / 12, 48))}px sans-serif`; ctx.textAlign = 'center';
            ctx.fillText(`Panel ${panel.order} · ${panel.asset ? 'Missing image' : 'No image'}`, left + w / 2, top + h / 2, w * 0.9);
        }
        ctx.restore();
        if (page.gutter) { path(ctx, panel.polygon, page.width, page.height); ctx.strokeStyle = page.background; ctx.lineWidth = page.gutter; ctx.stroke(); }
        if (page.border) { path(ctx, panel.polygon, page.width, page.height); ctx.strokeStyle = page.borderColor; ctx.lineWidth = page.border; ctx.stroke(); }
    }
    for (const bubble of [...(page.bubbles || [])].sort((a, b) => a.z - b.z)) renderBubble(ctx, bubble, page);
    if (!decorations) return;
    const { selected, mode, draft } = decorations;
    ctx.strokeStyle = '#498cff'; ctx.lineWidth = Math.max(2, page.width / 600);
    ctx.setLineDash([page.width / 150, page.width / 150]);
    for (const x of page.guidesX) { ctx.beginPath(); ctx.moveTo(x * page.width, 0); ctx.lineTo(x * page.width, page.height); ctx.stroke(); }
    for (const y of page.guidesY) { ctx.beginPath(); ctx.moveTo(0, y * page.height); ctx.lineTo(page.width, y * page.height); ctx.stroke(); }
    ctx.setLineDash([]);
    const panel = page.panels.find(p => p.id === selected);
    if (panel) {
        path(ctx, panel.polygon, page.width, page.height); ctx.strokeStyle = '#1478ff'; ctx.lineWidth = Math.max(4, page.width / 300); ctx.stroke();
        const b = bounds(panel.polygon);
        for (const [x, y] of mode === 'vertices' ? panel.polygon : [[b[2], b[3]]]) {
            ctx.fillStyle = '#1478ff'; const s = page.width / 85; ctx.fillRect(x * page.width - s / 2, y * page.height - s / 2, s, s);
        }
    }
    const bubble = page.bubbles?.find(b => b.id === selected);
    if (bubble) {
        ctx.strokeStyle = '#1478ff'; ctx.lineWidth = Math.max(2, page.width / 600);
        ctx.strokeRect(bubble.x * page.width, bubble.y * page.height, bubble.w * page.width, bubble.h * page.height);
        const s = page.width / 85; ctx.fillStyle = '#1478ff';
        ctx.fillRect((bubble.x + bubble.w) * page.width - s / 2, (bubble.y + bubble.h) * page.height - s / 2, s, s);
    }
    if (draft?.length) { path(ctx, draft, page.width, page.height); ctx.stroke(); }
}

export class PageEditor {
    constructor(studio, host, page) {
        this.studio = studio; this.host = host; Object.assign(page, normalizePage(page)); this.page = page; this.images = new Map(); this.abort = new AbortController();
        this.undo = []; this.redo = []; this.mode = 'select'; this.selected = null; this.zoom = 0.3; this.draft = [];
        this.build(); this.loadImages().catch(error => this.studio.fail(error));
    }
    get panel() { return this.page.panels.find(p => p.id === this.selected); }
    get bubble() { return this.page.bubbles.find(b => b.id === this.selected); }
    setMode(mode) { this.mode = mode; this.draft = []; this.toolbar.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode))); this.draw(); }
    async loadImages() {
        const project = this.studio.project.id;
        await this.loadFonts();
        await Promise.all(this.page.panels.filter(p => p.asset && !this.images.has(p.asset)).map(p => new Promise(resolve => {
            const image = new Image(); this.images.set(p.asset, image);
            const done = () => { this.abort.signal.removeEventListener('abort', done); resolve(); };
            this.abort.signal.addEventListener('abort', done, { once: true }); image.onload = image.onerror = done; image.src = assetUrl(project, p.asset);
        })));
        if (!this.abort.signal.aborted) this.draw();
    }
    async loadFonts() {
        for (const family of new Set(this.page.bubbles.map(b => b.font))) {
            if (!family.startsWith('MangaFont_')) continue;
            if ([...document.fonts].some(font => font.family === family && font.status === 'loaded')) continue;
            const font = this.studio.fonts.find(font => font.family === family);
            if (!font) throw new Error('A font used by this page is missing. Install the original font file or choose another font.');
            const face = new FontFace(family, `url("${api.apiURL(`/manga-maker/fonts/${font.id}`)}")`);
            try { await face.load(); } catch { throw new Error(`Could not load font ${font.name}. Install a valid font file or choose another font.`); }
            document.fonts.add(face);
        }
    }
    build() {
        this.host.replaceChildren();
        this.toolbar = el('div', { class: 'mm-toolbar', role: 'toolbar', 'aria-label': 'Page tools' });
        for (const [mode, text, symbol] of [['select', 'Select', 'pointer'], ['rect', 'Rectangle', 'rectangle'], ['polygon', 'Polygon', 'polygon'], ['vertices', 'Vertices', 'vertices'], ['crop', 'Image framing', 'crop'], ['pan', 'Pan canvas', 'hand']]) {
            const b = iconButton(text, symbol, () => this.setMode(mode), { 'data-mode': mode, 'aria-pressed': String(mode === this.mode) });
            this.toolbar.append(b);
        }
        this.undoButton = iconButton('↶ Undo', 'undo', () => this.history(-1)); this.redoButton = iconButton('↷ Redo', 'redo', () => this.history(1));
        this.toolbar.append(iconButton('Add speech bubble', 'speech', () => this.addBubble('speech')), iconButton('Add thought bubble', 'thought', () => this.addBubble('thought')),
            this.undoButton, this.redoButton, iconButton('Fit page', 'fit', () => this.fit()), button('100 %', () => this.scale(1)), iconButton('Center', 'center', () => this.center()));
        this.viewport = el('div', { class: 'mm-canvas-viewport', tabIndex: 0, 'aria-label': 'Editor. Delete: remove. Control Z: undo. Control Y: redo. Enter: finish polygon. Escape: cancel.' });
        this.canvas = el('canvas', { class: 'mm-page-canvas' }); this.viewport.append(this.canvas);
        this.properties = el('aside', { class: 'mm-editor-properties' });
        this.host.append(this.toolbar, el('div', { class: 'mm-editor-body' }, this.viewport, this.properties), el('small', { text: 'Drag images into a panel · Delete removes · Ctrl Z / Ctrl Y · Enter finishes polygon · Esc cancels · Ctrl + wheel: zoom', class: 'mm-help' }));
        const listen = (name, fn) => this.viewport.addEventListener(name, fn, { signal: this.abort.signal });
        listen('pointerdown', e => this.down(e)); listen('pointermove', e => this.move(e)); listen('pointerup', e => this.up(e));
        listen('pointercancel', () => this.cancel()); listen('dblclick', () => { if (this.mode === 'polygon') this.finishPolygon(); });
        listen('keydown', e => {
            if (e.target !== this.viewport && e.target !== this.canvas) return;
            if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) { e.preventDefault(); e.stopPropagation(); this.history(e.key.toLowerCase() === 'y' || e.shiftKey ? 1 : -1); }
            if (e.key === 'Delete' && (this.panel || this.bubble)) { e.preventDefault(); e.stopPropagation(); this.remove(); }
            if (e.key === 'Enter') { e.stopPropagation(); this.finishPolygon(); }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.cancel(); }
        });
        this.viewport.addEventListener('wheel', e => { if (e.ctrlKey) { e.preventDefault(); this.scale(this.zoom * (e.deltaY < 0 ? 1.1 : 0.9)); } }, { signal: this.abort.signal, passive: false });
        listen('dragover', e => e.preventDefault()); listen('drop', e => {
            e.preventDefault(); const id = e.dataTransfer.getData('application/x-manga-asset');
            if (!this.studio.project.assets.some(a => a.id === id && a.kind === 'panels')) return;
            const p = this.hit(this.point(e)); if (p) { this.selected = p.id; this.change(() => p.asset = id); this.loadImages(); }
        });
        this.props(); this.fit();
    }
    point(e) { const rect = this.canvas.getBoundingClientRect(); return [(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height]; }
    snap(point) {
        if (!this.page.snap) return point;
        return point.map((v, i) => { const guide = [0, 1, ...(i ? this.page.guidesY : this.page.guidesX)].find(g => Math.abs(g - v) < 8 / (this.page[i ? 'height' : 'width'] * this.zoom)); return guide ?? v; });
    }
    hit(point) { return [...this.page.panels].sort((a, b) => b.z - a.z).find(p => inPolygon(point, p.polygon)); }
    down(e) {
        if (e.target !== this.canvas || e.button !== 0) return;
        this.viewport.focus(); this.viewport.setPointerCapture(e.pointerId);
        const start = this.snap(this.point(e));
        if (this.mode === 'pan') { this.drag = { start: [e.clientX, e.clientY], scroll: [this.viewport.scrollLeft, this.viewport.scrollTop] }; return; }
        if (this.mode === 'polygon') { this.draft.push(start); this.draw(); return; }
        if (this.mode === 'rect') { this.drag = { start, before: clone(this.page) }; this.draft = [start, start, start, start]; return; }
        if (this.mode === 'select') {
            const selected = this.bubble;
            const resize = selected && Math.hypot((selected.x + selected.w - start[0]) * this.page.width, (selected.y + selected.h - start[1]) * this.page.height) < 15 / this.zoom;
            const bubble = resize ? selected : [...this.page.bubbles].sort((a, b) => b.z - a.z).find(b => start[0] >= b.x && start[0] <= b.x + b.w && start[1] >= b.y && start[1] <= b.y + b.h);
            if (bubble) {
                this.selected = bubble.id; this.props(); this.draw();
                this.drag = { start, before: clone(this.page), bubble: clone(bubble), resize }; return;
            }
        }
        const p = this.hit(start);
        if (this.panel && this.mode === 'vertices') {
            const vertex = this.panel.polygon.findIndex(v => Math.hypot((v[0] - start[0]) * this.page.width, (v[1] - start[1]) * this.page.height) < 14 / this.zoom);
            if (vertex >= 0) { this.drag = { start, before: clone(this.page), vertex, panel: clone(this.panel) }; return; }
        }
        if (this.panel && this.mode === 'select') {
            const b = bounds(this.panel.polygon);
            if (Math.hypot((b[2] - start[0]) * this.page.width, (b[3] - start[1]) * this.page.height) < 15 / this.zoom) {
                this.drag = { start, before: clone(this.page), resize: true, panel: clone(this.panel) }; return;
            }
        }
        this.selected = p?.id || null; this.props(); this.draw();
        if (p) this.drag = { start, before: clone(this.page), panel: clone(p) };
    }
    move(e) {
        if (!this.drag) return;
        if (this.mode === 'pan') { this.viewport.scrollLeft = this.drag.scroll[0] - (e.clientX - this.drag.start[0]); this.viewport.scrollTop = this.drag.scroll[1] - (e.clientY - this.drag.start[1]); return; }
        const pt = this.snap(this.point(e)), [x, y] = this.drag.start;
        if (this.drag.bubble) {
            const b = this.bubble, original = this.drag.bubble;
            if (this.drag.resize) { b.w = Math.max(0.005, pt[0] - original.x); b.h = Math.max(0.005, pt[1] - original.y); }
            else { b.x = original.x + pt[0] - x; b.y = original.y + pt[1] - y; }
            this.draw(); return;
        }
        if (this.mode === 'rect') { this.draft = [[x, y], [pt[0], y], pt, [x, pt[1]]]; this.draw(); return; }
        const p = this.panel, original = this.drag.panel;
        if (!p) return;
        if (this.mode === 'crop') { const b = bounds(p.polygon); p.dx = original.dx + (pt[0] - x) / (b[2] - b[0]); p.dy = original.dy + (pt[1] - y) / (b[3] - b[1]); }
        else if (this.drag.vertex !== undefined) p.polygon[this.drag.vertex] = pt;
        else if (this.drag.resize) {
            const [a, b, c, d] = bounds(original.polygon);
            p.polygon = original.polygon.map(([u, v]) => [a + (u - a) * Math.max(0.005, pt[0] - a) / (c - a), b + (v - b) * Math.max(0.005, pt[1] - b) / (d - b)]);
        } else p.polygon = original.polygon.map(([a, b]) => [a + pt[0] - x, b + pt[1] - y]);
        this.draw();
    }
    up() {
        if (!this.drag) return;
        if (this.mode === 'rect') {
            const [a, b, c, d] = bounds(this.draft);
            if (c - a > 0.005 && d - b > 0.005) this.addPanel(clone(this.draft), false);
            this.draft = [];
        }
        if (this.drag.before && JSON.stringify(this.drag.before) !== JSON.stringify(this.page)) this.commit(this.drag.before);
        this.drag = null; this.props(); this.draw();
    }
    cancel() {
        if (this.drag?.before) Object.assign(this.page, this.drag.before);
        this.drag = null; this.draft = []; this.props(); this.draw();
    }
    finishPolygon() {
        if (this.draft.length < 3) return;
        this.addPanel(clone(this.draft)); this.draft = []; this.draw();
    }
    addPanel(polygon = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.4], [0.1, 0.4]], save = true) {
        const action = () => {
            const panel = { id: uuid(), polygon, asset: null, order: this.page.panels.length + 1, z: Math.max(0, ...this.page.panels.map(p => p.z)) + 1,
                fit: 'cover', zoom: 1, dx: 0, dy: 0 };
            this.page.panels.push(panel); this.selected = panel.id;
        };
        if (save) this.change(action); else action();
    }
    addBubble(type) {
        this.setMode('select');
        this.change(() => {
            const bubble = { ...newBubble(type), z: Math.max(0, ...this.page.bubbles.map(b => b.z)) + 1 };
            this.page.bubbles.push(bubble); this.selected = bubble.id;
        });
    }
    commit(before) { this.undo.push(before); if (this.undo.length > 100) this.undo.shift(); this.redo = []; this.studio.saveSoon(); }
    change(action, refresh = true) { const before = clone(this.page); action(); this.commit(before); if (refresh) this.props(); else this.syncGeometryFields(); this.draw(); }
    history(direction) {
        const from = direction < 0 ? this.undo : this.redo, to = direction < 0 ? this.redo : this.undo;
        if (!from.length) return;
        to.push(clone(this.page)); Object.assign(this.page, from.pop()); this.selected = null;
        this.studio.saveSoon(); this.props(); this.loadImages(); this.draw();
    }
    remove() { if (!this.panel && !this.bubble) return; this.change(() => { const key = this.bubble ? 'bubbles' : 'panels'; this.page[key] = this.page[key].filter(p => p.id !== this.selected); this.selected = null; }); }
    duplicate() {
        if (this.bubble) { const b = clone(this.bubble); this.change(() => { b.id = uuid(); b.z = Math.max(...this.page.bubbles.map(b => b.z)) + 1; b.x += 0.02; b.y += 0.02; this.page.bubbles.push(b); this.selected = b.id; }); return; }
        if (!this.panel) return; const p = clone(this.panel); this.change(() => { p.id = uuid(); p.z = Math.max(...this.page.panels.map(p => p.z)) + 1; p.order = this.page.panels.length + 1; p.polygon = p.polygon.map(([x, y]) => [x + 0.02, y + 0.02]); this.page.panels.push(p); this.selected = p.id; });
    }
    applyPreset(preset) {
        this.change(() => {
            this.page.panels = preset.panels.map((p, i) => ({ id: uuid(), polygon: clone(p.polygon), order: p.order || i + 1, z: i,
                asset: null, fit: 'cover', zoom: 1, dx: 0, dy: 0 })); this.selected = null;
            if (preset.bubbles) this.page.bubbles = normalizePage(preset).bubbles.map(b => ({ ...b, id: uuid() }));
        });
    }
    props() {
        this.properties.replaceChildren(el('h3', { text: 'Page' }));
        const input = (label, key, type = 'number', owner = this.page, attrs = {}) => field(label, el('input', { type, value: owner[key], ...attrs,
            onchange: e => { if (type === 'number' && !Number.isFinite(Number(e.target.value))) return; this.change(() => { owner[key] = type === 'number' ? Number(e.target.value) : e.target.value; }, false); } }));
        this.properties.append(input('Name', 'name', 'text'), sizeControls(this.page, size => { this.change(() => Object.assign(this.page, size, imageDimensions(size, 1)), false); this.fit(); }),
            iconButton('Change orientation', 'orientation', () => { this.change(() => { [this.page.width, this.page.height] = [this.page.height, this.page.width]; this.page.aspect_ratio = this.page.aspect_ratio.split(':').reverse().join(':'); }); this.fit(); }),
            input('Background', 'background', 'color'), input('Border · px', 'border'), input('Border color', 'borderColor', 'color'), input('Gutter · px', 'gutter'));
        const reading = el('select', { onchange: e => this.change(() => this.page.reading = e.target.value) }, el('option', { value: 'rtl', text: 'Right → left' }), el('option', { value: 'ltr', text: 'Left → right' })); reading.value = this.page.reading;
        this.properties.append(field('Reading direction', reading), button('Sort by reading order', () => this.change(() => {
            const sorted = [...this.page.panels].sort((a, b) => {
                const aa = bounds(a.polygon), bb = bounds(b.polygon);
                return Math.abs(aa[1] - bb[1]) > 0.05 ? aa[1] - bb[1] : (aa[0] - bb[0]) * (this.page.reading === 'rtl' ? -1 : 1);
            }); sorted.forEach((p, i) => p.order = i + 1);
        })), field('Snap to guides', el('input', { type: 'checkbox', checked: this.page.snap, onchange: e => this.change(() => this.page.snap = e.target.checked) })));
        for (const [label, key] of [['Vertical guides · %', 'guidesX'], ['Horizontal guides · %', 'guidesY']]) this.properties.append(field(label, el('input', { value: this.page[key].map(x => +(x * 100).toFixed(2)).join(', '), onchange: e => this.change(() => this.page[key] = e.target.value.split(',').filter(x => x.trim()).map(x => Number(x.trim()) / 100).filter(Number.isFinite), false) })));
        this.properties.append(iconButton('Add panel', 'plus', () => this.addPanel()));
        const p = this.panel;
        if (p) {
            this.properties.append(el('h3', { text: `Panel ${p.order}` }), input('Reading order', 'order', 'number', p), input('Layer', 'z', 'number', p));
            const assign = el('select', { onchange: e => { this.change(() => p.asset = e.target.value || null); this.loadImages(); } }, el('option', { value: '', text: 'No image' }),
                ...this.studio.project.assets.filter(a => a.kind === 'panels' && !a.deleted).map(a => el('option', { value: a.id, text: a.name })));
            assign.value = p.asset || ''; this.properties.append(field('Panel', assign));
            const fit = el('select', { onchange: e => this.change(() => p.fit = e.target.value) }, el('option', { value: 'cover', text: 'Cover' }), el('option', { value: 'contain', text: 'Contain' })); fit.value = p.fit;
            this.properties.append(field('Image fit', fit), input('Image zoom', 'zoom', 'number', p, { step: 0.05, min: 0.05 }), input('X offset', 'dx', 'number', p, { step: 0.05 }), input('Y offset', 'dy', 'number', p, { step: 0.05 }));
            const b = bounds(p.polygon);
            for (const [label, index] of [['X · %', 0], ['Y · %', 1], ['Width · %', 2], ['Height · %', 3]]) {
                const value = (index < 2 ? b[index] : b[index] - b[index - 2]) * 100;
                this.properties.append(field(label, el('input', { type: 'number', 'data-bounds': index, value: +value.toFixed(2), step: 0.5, onchange: e => this.change(() => {
                    const b = bounds(p.polygon), v = Number(e.target.value) / 100;
                    p.polygon = p.polygon.map(pt => {
                        const point = [...pt], axis = index % 2;
                        point[axis] = index < 2 ? pt[axis] + v - b[axis] : b[axis] + (pt[axis] - b[axis]) * v / (b[axis + 2] - b[axis]); return point;
                    });
                }, false) })));
            }
            p.polygon.forEach((vertex, i) => {
                this.properties.append(field(`Vertex ${i + 1} · X,Y %`, el('input', { 'data-vertex-index': i, value: vertex.map(v => +(v * 100).toFixed(2)).join(', '), onchange: e => {
                    const point = e.target.value.split(',').map(v => Number(v) / 100);
                    if (point.length === 2 && point.every(Number.isFinite)) this.change(() => p.polygon[i] = point, false);
                } })));
            });
            this.properties.append(button('Add vertex', () => this.change(() => { const a = p.polygon[0], b = p.polygon[1]; p.polygon.splice(1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]); })), button('Remove last vertex', () => { if (p.polygon.length > 3) this.change(() => p.polygon.pop()); }), iconButton('Duplicate panel', 'copy', () => this.duplicate()), iconButton('Delete panel', 'trash', () => this.remove()));
        }
        const bubble = this.bubble;
        if (bubble) {
            const styles = [['speech', 'Oval dialogue'], ['thought', 'Thought cloud'], ['caption', 'Rectangular caption'], ['rounded', 'Rounded box'], ['shout', 'Shout balloon']];
            const style = el('select', { 'aria-label': 'Bubble style', onchange: e => this.change(() => bubble.type = e.target.value) }, ...styles.map(([value, text]) => el('option', { value, text }))); style.value = bubble.type;
            const font = el('select', { 'aria-label': 'Font', onchange: e => { this.change(() => bubble.font = e.target.value); this.loadImages().catch(error => this.studio.fail(error)); } },
                ...[['sans-serif', 'Sans serif'], ['serif', 'Serif'], ['monospace', 'Monospace'], ['cursive', 'Handwritten'], ['fantasy', 'Display']].map(([value, text]) => el('option', { value, text })),
                ...this.studio.fonts.map(font => el('option', { value: font.family, text: font.name }))); font.value = bubble.font;
            let textBefore;
            const text = el('textarea', { value: bubble.text, rows: 4, 'aria-label': 'Bubble text', placeholder: 'Enter dialogue or thoughts…',
                onfocus: () => textBefore = clone(this.page),
                oninput: e => { bubble.text = e.target.value; this.studio.saveSoon(); this.draw(); },
                onchange: () => { this.commit(textBefore); this.draw(); } });
            this.properties.append(el('h3', { text: 'Dialogue / thought box' }), field('Bubble style', style), field('Bubble text', el('div', { class: 'mm-prompt-field' }, text,
                iconButton('Enhance dialogue', 'sparkles', () => this.studio.action(() => this.studio.run('enhance', 'design', null, 'dialogue', { page: this.page.id, bubble: bubble.id, text: bubble.text })),
                    { 'data-run': 'enhance', disabled: !this.studio.textGeneratorAvailable(), title: 'Enhance dialogue with the global text generator' }))), field('Font', font),
                button('Install font…', () => chooseFile('.ttf,.otf,.woff,.woff2', files => this.studio.action(async () => {
                    const file = files[0]; await new FontFace('MangaFontValidation', await file.arrayBuffer()).load();
                    const form = new FormData(); form.append('font', file);
                    const installed = await request('/fonts', form, 'POST'); this.studio.fonts = await request('/fonts');
                    this.change(() => bubble.font = installed.family); await this.loadImages();
                }))),
                input('Font size · px', 'fontSize', 'number', bubble, { min: 1 }), el('small', { text: 'Text wraps and shrinks automatically to fit the box.' }),
                input('Layer', 'z', 'number', bubble), input('Fill color', 'fill', 'color', bubble),
                field('Fill opacity · %', el('input', { type: 'number', value: (bubble.fillOpacity ?? 1) * 100, min: 0, max: 100, step: 5,
                    onchange: e => { const value = Number(e.target.value) / 100; if (Number.isFinite(value)) this.change(() => bubble.fillOpacity = Math.max(0, Math.min(1, value)), false); } })),
                input('Text color', 'color', 'color', bubble),
                field('Show border', el('input', { type: 'checkbox', checked: bubble.borderEnabled, onchange: e => this.change(() => bubble.borderEnabled = e.target.checked) })),
                input('Bubble border · px', 'border', 'number', bubble, { min: 0 }), input('Bubble border color', 'stroke', 'color', bubble));
            for (const [label, key] of [['Bubble X · %', 'x'], ['Bubble Y · %', 'y'], ['Bubble width · %', 'w'], ['Bubble height · %', 'h']]) {
                this.properties.append(field(label, el('input', { type: 'number', value: +(bubble[key] * 100).toFixed(2), step: 0.5, ...(['w', 'h'].includes(key) ? { min: 0.5 } : {}),
                    onchange: e => { const value = Number(e.target.value) / 100; if (Number.isFinite(value)) this.change(() => bubble[key] = ['w', 'h'].includes(key) ? Math.max(0.005, value) : value, false); } })));
            }
            if (!['caption', 'rounded'].includes(bubble.type)) {
                this.properties.append(field('Show tail', el('input', { type: 'checkbox', checked: bubble.tail, onchange: e => this.change(() => bubble.tail = e.target.checked) })));
                for (const [label, key] of [['Tail X · % of box', 'tailX'], ['Tail Y · % of box', 'tailY']]) this.properties.append(field(label,
                    el('input', { type: 'number', value: bubble[key] * 100, step: 5, onchange: e => { const value = Number(e.target.value) / 100; if (Number.isFinite(value)) this.change(() => bubble[key] = value, false); } })));
            }
            this.properties.append(iconButton('Duplicate bubble', 'copy', () => this.duplicate()), iconButton('Delete bubble', 'trash', () => this.remove()));
        }
        this.properties.append(el('h3', { text: 'Panels · select' }), ...[...this.page.panels].sort((a, b) => a.order - b.order).map(p => button(`${p.order}. ${p.asset ? this.studio.project.assets.find(a => a.id === p.asset)?.name || 'Missing' : 'No image'}`, () => { this.selected = p.id; this.props(); this.draw(); })));
        this.properties.append(el('h3', { text: 'Bubbles · select' }), el('div', { class: 'mm-bubble-list' }, ...[...this.page.bubbles].sort((a, b) => a.z - b.z).map((b, i) => button(`${i + 1}. ${b.type} · ${b.text.slice(0, 30)}`, () => { this.setMode('select'); this.selected = b.id; this.props(); this.draw(); }, { 'data-bubble-id': b.id }))));
    }
    syncGeometryFields() {
        const p = this.panel; if (!p) return;
        const b = bounds(p.polygon);
        for (const input of this.properties.querySelectorAll('[data-bounds]')) {
            const i = Number(input.dataset.bounds); input.value = +((i < 2 ? b[i] : b[i] - b[i - 2]) * 100).toFixed(2);
        }
        for (const input of this.properties.querySelectorAll('[data-vertex-index]')) input.value = p.polygon[Number(input.dataset.vertexIndex)].map(v => +(v * 100).toFixed(2)).join(', ');
    }
    scale(value) { this.zoom = Math.max(0.03, Math.min(3, value)); this.canvas.style.width = `${this.page.width * this.zoom}px`; this.canvas.style.height = `${this.page.height * this.zoom}px`; this.draw(); }
    fit() { requestAnimationFrame(() => { if (!this.abort.signal.aborted) { this.scale(Math.min((this.viewport.clientWidth - 64) / this.page.width, (this.viewport.clientHeight - 64) / this.page.height)); this.center(); } }); }
    center() { this.viewport.scrollLeft = Math.max(0, (this.viewport.scrollWidth - this.viewport.clientWidth) / 2); this.viewport.scrollTop = Math.max(0, (this.viewport.scrollHeight - this.viewport.clientHeight) / 2); }
    draw() {
        if (this.frame) return;
        this.frame = requestAnimationFrame(() => {
            this.frame = null; if (this.abort.signal.aborted) return;
            renderPage(this.canvas, this.page, this.images, { selected: this.selected, mode: this.mode, draft: this.draft });
            this.canvas.style.width = `${this.page.width * this.zoom}px`; this.canvas.style.height = `${this.page.height * this.zoom}px`;
            this.undoButton.disabled = !this.undo.length; this.redoButton.disabled = !this.redo.length;
        });
    }
    async export() {
        await this.loadImages();
        const canvas = document.createElement('canvas'); renderPage(canvas, this.page, this.images);
        return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not export composition')), 'image/png'));
    }
    destroy() { this.abort.abort(); if (this.frame) cancelAnimationFrame(this.frame); this.images.forEach(im => { im.onload = im.onerror = null; im.src = ''; }); this.images.clear(); }
}
