import { el, field, icon, iconButton, uuid } from './client.js';

// Searchable list for model files and other long registries; groups entries by folder.
export function combo(label, list, current, change, help = '') {
    const id = `mm-${uuid()}`; let committed = current || '', active = -1, items = [];
    const input = el('input', { value: committed, role: 'combobox', 'aria-label': label, 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': id,
        autocomplete: 'off', spellcheck: false, placeholder: 'Search and select…' });
    const listbox = el('div', { id, class: 'mm-combo-list', role: 'listbox', popover: 'manual' });
    const note = el('small', { text: current && !list.includes(current) ? `Missing selection: ${current}` : help, hidden: !(current && !list.includes(current)) && !help });
    const clear = el('button', { type: 'button', class: 'mm-combo-button', tabIndex: -1, 'aria-label': `Clear ${label}`, title: 'Clear', onpointerdown: e => e.preventDefault(), onclick: () => { commit(''); input.focus(); } }, icon('clear'));
    const expand = el('button', { type: 'button', class: 'mm-combo-button', tabIndex: -1, 'aria-hidden': 'true', onpointerdown: e => e.preventDefault(), onclick: () => { input.focus(); if (listbox.matches(':popover-open')) close(); else open(true); } }, icon('down'));
    // Only the border tracks validity live; changing the note's height on blur would move the button being clicked.
    const mark = () => { input.classList.toggle('mm-missing', !!committed && !list.includes(committed)); clear.hidden = !input.value; };
    const commit = value => { input.value = committed = value; close(); mark(); change(value); };
    const highlight = index => {
        active = index; const options = listbox.querySelectorAll('[role=option]');
        options.forEach((option, i) => option.classList.toggle('mm-active', i === index));
        if (options[index]) { input.setAttribute('aria-activedescendant', options[index].id); options[index].scrollIntoView({ block: 'nearest' }); }
    };
    const onScroll = e => { if (!listbox.contains(e.target)) close(); };
    function close() {
        if (listbox.matches(':popover-open')) listbox.hidePopover();
        input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); removeEventListener('scroll', onScroll, true);
    }
    function open(all) {
        const terms = all ? [] : input.value.toLowerCase().split(/\s+/).filter(Boolean);
        items = list.filter(value => terms.every(term => value.toLowerCase().includes(term)));
        if (!items.length || (!all && items.includes(input.value))) return close();
        const groups = new Map();
        for (const value of items) {
            const cut = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
            const folder = value.slice(0, Math.max(0, cut)); if (!groups.has(folder)) groups.set(folder, []);
            groups.get(folder).push([value, value.slice(cut + 1)]);
        }
        items = [...groups.values()].flat().map(([value]) => value);
        let index = 0;
        listbox.replaceChildren(...[...groups].flatMap(([folder, entries]) => [...folder ? [el('div', { class: 'mm-combo-group', role: 'presentation', text: folder })] : [],
            ...entries.map(([value, name]) => el('div', { id: `${id}-${index++}`, role: 'option', class: 'mm-combo-option', title: value, 'aria-selected': String(value === committed),
                onpointerdown: e => { e.preventDefault(); commit(value); }, onpointermove: () => highlight(items.indexOf(value)) }, el('span', { text: name })))]));
        if (!listbox.matches(':popover-open')) listbox.showPopover();
        input.setAttribute('aria-expanded', 'true'); addEventListener('scroll', onScroll, true);
        const box = input.getBoundingClientRect(), below = innerHeight - box.bottom - 12, above = box.top - 12;
        listbox.style.minWidth = `${box.width}px`; listbox.style.left = `${Math.max(8, Math.min(box.left, innerWidth - listbox.offsetWidth - 8))}px`;
        listbox.style.maxHeight = `${Math.min(320, Math.max(below, above))}px`;
        listbox.style.top = below >= Math.min(220, listbox.offsetHeight) || below >= above ? `${box.bottom + 4}px` : `${box.top - 4 - listbox.offsetHeight}px`;
        highlight(Math.max(0, items.indexOf(committed)));
    }
    input.addEventListener('input', () => { clear.hidden = !input.value; open(false); });
    input.addEventListener('change', () => commit(input.value));
    input.addEventListener('blur', close);
    input.addEventListener('keydown', e => {
        const opened = listbox.matches(':popover-open');
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault(); if (!opened) return open(true);
            highlight((active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
        } else if (e.key === 'Enter' && opened && items[active]) { e.preventDefault(); commit(items[active]); }
        else if (e.key === 'Escape' && opened) { e.preventDefault(); e.stopPropagation(); close(); }
    });
    mark();
    return el('label', { class: 'mm-field' }, el('span', { text: label }), el('div', { class: 'mm-combo' }, input, clear, expand, listbox), note);
}

// Radio group styled as a segmented control; `value` mirrors a select for callers that set it programmatically.
export function segmented(label, values, current, change) {
    const name = `mm-${uuid()}`;
    const group = el('fieldset', { class: 'mm-field mm-segmented-field', role: 'radiogroup', 'aria-label': label }, el('legend', { text: label }),
        el('div', { class: 'mm-segmented' }, ...values.map(([value, text, symbol, disabled]) => el('label', { title: text },
            el('input', { type: 'radio', name, value, checked: value === current, disabled: !!disabled, onchange: () => change(value) }), symbol ? icon(symbol) : null, el('span', { text })))));
    Object.defineProperty(group, 'value', {
        get: () => group.querySelector('input:checked')?.value ?? '',
        set: value => { for (const input of group.querySelectorAll('input')) input.checked = input.value === value; },
    });
    return group;
}

// Range companion for a number input; the number input keeps the label, validation and change handler.
export function slider(label, input, [min, max], help = '') {
    const range = el('input', { type: 'range', min, max, step: input.step || 'any', value: input.value, tabIndex: -1, 'aria-hidden': 'true' });
    range.addEventListener('input', () => { input.value = range.value; });
    range.addEventListener('change', () => input.dispatchEvent(new Event('change')));
    for (const name of ['input', 'change']) input.addEventListener(name, () => { range.value = input.value; });
    return field(label, el('div', { class: 'mm-slider' }, input, range), help);
}

export const toggle = (label, input, help = '') => (input.setAttribute('role', 'switch'), el('label', { class: 'mm-toggle' }, input, el('span', { text: label }), help ? el('small', { text: help }) : null));

export function seed(label, cfg, changed, randomLabel = 'Random seed') {
    const input = el('input', { type: 'number', min: 0, step: 1, value: cfg.seed, onchange: e => { cfg.seed = Number(e.target.value); changed(); } });
    return el('div', { class: 'mm-seed' }, field(label, el('div', { class: 'mm-row' }, input,
        iconButton('New random seed', 'dice', () => { input.value = cfg.seed = Math.floor(Math.random() * 2 ** 48); changed(); }))),
        toggle(randomLabel, el('input', { type: 'checkbox', checked: cfg.random_seed, onchange: e => { cfg.random_seed = e.target.checked; changed(); } })));
}

// Drag or arrow-key handle that sets the width of the adjacent panel; `invert` is for panels on the right side.
export function resizer(target, label, invert = false) {
    const handle = el('div', { class: 'mm-resizer', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': label, tabIndex: 0 });
    const resize = width => { target.style.width = `${Math.round(width)}px`; };
    handle.addEventListener('pointerdown', e => {
        if (e.button) return;
        e.preventDefault(); handle.setPointerCapture(e.pointerId);
        const start = e.clientX, width = target.getBoundingClientRect().width;
        handle.onpointermove = move => resize(width + (move.clientX - start) * (invert ? -1 : 1));
    });
    handle.addEventListener('lostpointercapture', () => { handle.onpointermove = null; });
    handle.addEventListener('keydown', e => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault(); resize(target.getBoundingClientRect().width + (e.key === 'ArrowRight' ? 16 : -16) * (invert ? -1 : 1));
    });
    return handle;
}

export const summarize = (details, text) => { details.querySelector(':scope > summary').dataset.summary = text; };
