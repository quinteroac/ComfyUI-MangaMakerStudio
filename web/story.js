import { el, button, iconButton, field, assetUrl, download } from './client.js';
import { resizer } from './controls.js';
import { newPage, normalizePage } from './editor.js';
import { referencePresets } from './prompts.js';
import { Assistant } from './assistant.js';
import { modules, characterFields, shots, shotPrompts, lineTypes, templates, structure, normalizeStory, findPage, layoutFromScript, scriptMarkdown,
    newAct, newBeat, newCharacter, newChapter, newScriptPage, newPanel, newLine } from './story-data.js';

const move = (list, index, offset) => { const target = index + offset; if (target >= 0 && target < list.length) [list[index], list[target]] = [list[target], list[index]]; };

function wrap(ctx, text, width) {
    const lines = [];
    for (const paragraph of text.split('\n')) {
        let line = '';
        for (const word of paragraph.split(/\s+/).filter(Boolean)) {
            if (line && ctx.measureText(`${line} ${word}`).width > width) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
        }
        lines.push(line);
    }
    return lines;
}

export class StoryStudio {
    constructor(studio, view) {
        this.studio = studio; this.view = view;
        this.story = normalizeStory(studio.project.story ||= {});
        this.ui = studio.project.workspace.story ||= { module: 'logline' };
        this.tabs = el('nav', { class: 'mm-story-tabs', 'aria-label': 'Story modules' });
        this.main = el('section', { class: 'mm-story-main' }); this.side = el('aside', { class: 'mm-assistant' });
        if (this.ui.assistantWidth) this.side.style.width = `${this.ui.assistantWidth}px`;
        this.side.hidden = !!this.ui.assistantHidden;
        const handle = resizer(this.side, 'Resize assistant', true); handle.hidden = this.side.hidden;
        this.toggle = iconButton('Show or hide assistant', 'sidebar', () => {
            this.side.hidden = handle.hidden = this.ui.assistantHidden = !this.side.hidden; this.toggle.setAttribute('aria-pressed', String(!this.side.hidden)); this.changed();
        }, { 'aria-pressed': String(!this.side.hidden) });
        view.append(el('div', { class: 'mm-story-body' }, this.tabs, this.main), handle, this.side);
        const observer = new ResizeObserver(() => { const width = Math.round(this.side.getBoundingClientRect().width); if (width > 100 && this.ui.assistantWidth !== width) { this.ui.assistantWidth = width; this.changed(); } });
        observer.observe(this.side); studio.observers.push(observer);
        this.assistant = new Assistant(this, this.side);
        this.render();
    }
    get module() { return modules[this.ui.module] ? this.ui.module : 'logline'; }
    changed() { this.studio.saveSoon(); }
    destroy() { this.assistant.destroy(); }
    render() {
        this.tabs.replaceChildren(...Object.entries(modules).map(([key, title]) => button(title, () => { this.ui.module = key; this.changed(); this.render(); }, { 'aria-current': String(this.module === key) })),
            el('span', { class: 'mm-story-spacer' }), this.toggle);
        const scroll = this.main.scrollTop;
        this.main.replaceChildren(); this.main.className = `mm-story-main mm-story-${this.module}`;
        this[this.module]();
        this.main.scrollTop = scroll;
        this.assistant.render();
    }
    input(owner, key, label, rows = 0, attrs = {}) {
        const input = el(rows ? 'textarea' : 'input', { value: owner[key] || '', ...(rows ? { rows } : {}), 'aria-label': label, ...attrs, oninput: e => { owner[key] = e.target.value; this.changed(); attrs.oninput?.(e); } });
        return field(label, input);
    }
    pick(title, kinds, chosen) {
        const picker = el('div', { class: 'mm-asset-picker' }, ...this.studio.project.assets.filter(a => kinds.includes(a.kind) && !a.deleted && !a.missing)
            .map(a => this.studio.assetPickerItem(a, () => { chosen(a.id); dialog.close(); this.changed(); this.render(); })));
        if (!picker.children.length) picker.append(el('p', { text: 'No available images. Generate or import them first.' }));
        const dialog = this.studio.modal(title, picker);
    }
    thumb(id, label, actions, large = false) {
        const asset = this.studio.project.assets.find(a => a.id === id);
        const image = asset && !asset.missing ? button('', () => this.studio.preview(asset), { class: 'mm-story-thumb-image', 'aria-label': `Preview ${asset.name}`, title: asset.name }) : el('span', { class: 'mm-story-thumb-image', text: asset ? 'Missing file' : 'Removed' });
        if (asset && !asset.missing) image.append(el('img', { src: assetUrl(this.studio.project.id, id, !large), alt: asset.name, loading: 'lazy' }));
        return el('figure', { class: `mm-story-thumb${large ? ' mm-story-thumb-large' : ''}` }, image,
            el('figcaption', { text: `${label}${asset ? ` · ${asset.name}` : ''}${asset?.deleted ? ' · Trash' : ''}`, title: asset?.name || '' }), el('div', { class: 'mm-row' }, ...actions));
    }
    replace(title, text, action, label = 'Replace') {
        const dialog = this.studio.modal(title, el('p', { text }), button('Cancel', () => dialog.close()), button(label, () => { dialog.close(); action(); }, { class: 'mm-danger' }));
    }
    chips(story, selected, changed) {
        if (!story.characters.length) return el('small', { text: 'Create characters to link them here.' });
        return el('div', { class: 'mm-chips', role: 'group', 'aria-label': 'Characters' }, ...story.characters.map(c => button(c.name || 'Unnamed', () => {
            const index = selected.indexOf(c.id); if (index >= 0) selected.splice(index, 1); else selected.push(c.id); changed();
        }, { 'aria-pressed': String(selected.includes(c.id)) })));
    }
    logline() {
        const l = this.story.logline;
        this.main.append(el('h2', { text: 'Logline' }), el('small', { text: 'The premise of your manga: what it is, who it follows and why it matters.' }),
            this.input(l, 'title', 'Title'), el('div', { class: 'mm-story-grid3' }, this.input(l, 'genre', 'Genre'), this.input(l, 'tone', 'Tone'), this.input(l, 'audience', 'Audience')),
            this.input(l, 'logline', 'Logline', 3, { placeholder: 'When [inciting incident], a [protagonist] must [goal] before [stakes]…' }),
            this.input(l, 'synopsis', 'Synopsis', 12), this.input(l, 'themes', 'Themes', 3));
    }
    characters() {
        const cast = this.story.characters, selected = cast.find(c => c.id === this.ui.character);
        const grid = el('div', { class: 'mm-character-grid' }, ...cast.map(c => {
            const card = button('', () => { this.ui.character = c.id; this.changed(); this.render(); }, { class: 'mm-character-card', 'aria-pressed': String(c.id === this.ui.character) });
            const portrait = this.studio.project.assets.find(a => a.id === c.portrait && !a.missing);
            card.append(portrait ? el('img', { src: assetUrl(this.studio.project.id, portrait.id, true), alt: '' }) : el('span', { class: 'mm-character-initial', text: (c.name || '?')[0].toUpperCase() }),
                el('strong', { text: c.name || 'Unnamed' }), el('small', { text: c.role || 'No role yet' }));
            return card;
        }), iconButton('New character', 'plus', () => { const c = newCharacter(); c.name = `Character ${cast.length + 1}`; cast.push(c); this.ui.character = c.id; this.changed(); this.render(); }, { class: 'mm-icon-button mm-character-add' }, true));
        this.main.append(el('h2', { text: 'Characters' }), grid);
        if (!selected) { this.main.append(el('p', { class: 'mm-story-hint', text: cast.length ? 'Select a card to edit it.' : 'Create your first character card.' })); return; }
        const index = cast.indexOf(selected);
        const editor = el('section', { class: 'mm-character-editor' }, el('div', { class: 'mm-row mm-story-toolbar' }, el('h3', { text: selected.name || 'Unnamed' }),
            iconButton('Move card left', 'left', () => { move(cast, index, -1); this.changed(); this.render(); }, { disabled: !index }),
            iconButton('Move card right', 'right', () => { move(cast, index, 1); this.changed(); this.render(); }, { disabled: index === cast.length - 1 }),
            iconButton('Generate reference sheet', 'sparkles', () => this.toReferences(selected), { title: 'Prepare a character sheet prompt in References' }, true),
            iconButton('Export card', 'download', () => this.studio.action(() => this.exportCard(selected)), {}, true),
            iconButton('Delete character', 'trash', () => this.replace('Delete character', `Delete ${selected.name || 'this character'}? Images stay in the project.`, () => {
                cast.splice(index, 1); for (const act of this.story.plot.acts) for (const beat of act.beats) beat.characters = beat.characters.filter(id => id !== selected.id);
                for (const chapter of this.story.script.chapters) for (const page of chapter.pages) for (const panel of page.panels) panel.characters = panel.characters.filter(id => id !== selected.id);
                this.ui.character = null; this.changed(); this.render();
            }, 'Delete'), { class: 'mm-icon-button mm-danger' })));
        const images = el('div', { class: 'mm-story-images' },
            selected.portrait ? this.thumb(selected.portrait, 'Portrait', [iconButton('Remove', 'clear', () => { selected.portrait = null; this.changed(); this.render(); }, { 'aria-label': 'Remove portrait' }, true)]) : null,
            ...selected.references.map((id, i) => this.thumb(id, `Reference ${i + 1}`, [iconButton('Unlink', 'clear', () => { selected.references.splice(i, 1); this.changed(); this.render(); }, { 'aria-label': `Unlink reference ${i + 1}` }, true)])),
            el('div', { class: 'mm-story-image-actions' }, button(selected.portrait ? 'Change portrait' : 'Choose portrait', () => this.pick('Character portrait', ['references', 'panels'], id => selected.portrait = id)),
                button('Link reference image', () => this.pick('Link reference image', ['references'], id => { if (!selected.references.includes(id)) selected.references.push(id); }))));
        const fields = characterFields.map(([key, label]) => this.input(selected, key, label, ['name', 'role', 'age'].includes(key) ? 0 : key === 'visual_prompt' ? 6 : 5,
            key === 'name' ? { oninput: e => { editor.querySelector('h3').textContent = e.target.value || 'Unnamed'; grid.children[index].querySelector('strong').textContent = e.target.value || 'Unnamed'; } } : {}));
        editor.append(images, el('div', { class: 'mm-story-grid3' }, ...fields.slice(0, 3)), el('div', { class: 'mm-character-fields' }, ...fields.slice(3)));
        this.main.append(editor);
    }
    plot() {
        const plot = this.story.plot;
        const template = el('select', { 'aria-label': 'Structure template' }, ...Object.entries(templates).map(([value, t]) => el('option', { value, text: t.label, selected: value === plot.template })));
        this.main.append(el('h2', { text: 'Plot & Structure' }), el('div', { class: 'mm-row mm-story-toolbar' }, field('Structure', template),
            button('Apply template', () => this.replace('Apply structure template', 'Replace every act and beat with the selected template?', () => { plot.template = template.value; plot.acts = structure(template.value); this.changed(); this.render(); }, 'Apply')),
            iconButton('Add act', 'plus', () => { plot.acts.push(newAct(`Act ${plot.acts.length + 1}`)); this.changed(); this.render(); }, {}, true)));
        template.onchange = () => { plot.template = template.value; this.changed(); this.assistant.render(); };
        this.main.append(el('div', { class: 'mm-plot-acts' }, ...plot.acts.map((act, a) => el('section', { class: 'mm-plot-act' },
            el('div', { class: 'mm-row' }, el('input', { value: act.title, 'aria-label': 'Act title', class: 'mm-plot-title', oninput: e => { act.title = e.target.value; this.changed(); } }),
                iconButton('Move act left', 'left', () => { move(plot.acts, a, -1); this.changed(); this.render(); }, { disabled: !a }),
                iconButton('Move act right', 'right', () => { move(plot.acts, a, 1); this.changed(); this.render(); }, { disabled: a === plot.acts.length - 1 }),
                iconButton('Delete act', 'trash', () => this.replace('Delete act', `Delete ${act.title || 'this act'} and its beats?`, () => { plot.acts.splice(a, 1); this.changed(); this.render(); }, 'Delete'), { class: 'mm-icon-button mm-danger' })),
            this.input(act, 'summary', 'Act summary', 2),
            ...act.beats.map((beat, b) => el('article', { class: 'mm-plot-beat' }, el('div', { class: 'mm-row' },
                el('input', { value: beat.title, 'aria-label': 'Beat title', placeholder: 'Beat', oninput: e => { beat.title = e.target.value; this.changed(); } }),
                iconButton('Move beat up', 'up', () => { move(act.beats, b, -1); this.changed(); this.render(); }, { disabled: !b }),
                iconButton('Move beat down', 'down', () => { move(act.beats, b, 1); this.changed(); this.render(); }, { disabled: b === act.beats.length - 1 }),
                iconButton('Delete beat', 'clear', () => { act.beats.splice(b, 1); this.changed(); this.render(); })),
                el('textarea', { value: beat.summary, rows: 3, 'aria-label': 'Beat summary', placeholder: 'What happens…', oninput: e => { beat.summary = e.target.value; this.changed(); } }),
                this.chips(this.story, beat.characters, () => { this.changed(); this.render(); }))),
            iconButton('Add beat', 'plus', () => { act.beats.push(newBeat()); this.changed(); this.render(); }, {}, true)))));
    }
    script() {
        const chapters = this.story.script.chapters, { chapter: pageChapter, page } = findPage(this.story, this.ui.page);
        const chapter = chapters.find(c => c.id === this.ui.chapter) || pageChapter;
        const select = (c, p = null) => { this.ui.chapter = c.id; this.ui.page = p?.id || null; this.changed(); this.render(); };
        const outline = el('nav', { class: 'mm-script-outline', 'aria-label': 'Script outline' }, el('div', { class: 'mm-row' },
            iconButton('Add chapter', 'plus', () => { const c = newChapter(chapters.length + 1); chapters.push(c); select(c); }, {}, true),
            iconButton('Export script', 'download', () => download(`${this.story.logline.title.trim() || 'manga'}-script.md`, new Blob([scriptMarkdown(this.story)], { type: 'text/markdown' })))),
            ...chapters.map(c => el('div', { class: 'mm-script-chapter' }, button(c.title || 'Untitled chapter', () => select(c), { 'aria-pressed': String(c === chapter && !page) }),
                ...c.pages.map((p, i) => button(`${i + 1}. ${p.title} · ${p.panels.length}`, () => select(c, p), { class: 'mm-script-page', 'aria-pressed': String(p === page) })))));
        if (!chapters.length) outline.append(el('small', { text: 'Add a chapter, or ask the assistant to plan chapters from the plot.' }));
        const body = el('div', { class: 'mm-script-body' });
        if (page) this.scriptPage(body, pageChapter, page);
        else if (chapter) {
            const index = chapters.indexOf(chapter);
            body.append(el('div', { class: 'mm-row mm-story-toolbar' }, el('h2', { text: chapter.title || 'Untitled chapter' }),
                iconButton('Move chapter up', 'up', () => { move(chapters, index, -1); this.changed(); this.render(); }, { disabled: !index }),
                iconButton('Move chapter down', 'down', () => { move(chapters, index, 1); this.changed(); this.render(); }, { disabled: index === chapters.length - 1 }),
                iconButton('Add page', 'plus', () => { const p = newScriptPage(chapter.pages.length + 1); chapter.pages.push(p); select(chapter, p); }, {}, true),
                iconButton('Delete chapter', 'trash', () => this.replace('Delete chapter', `Delete ${chapter.title} and its ${chapter.pages.length} pages? Page layouts already created are kept.`, () => {
                    chapters.splice(index, 1); this.ui.chapter = this.ui.page = null; this.changed(); this.render();
                }, 'Delete'), { class: 'mm-icon-button mm-danger' })),
                this.input(chapter, 'title', 'Chapter title', 0, { oninput: e => { body.querySelector('h2').textContent = e.target.value; } }), this.input(chapter, 'summary', 'Chapter summary', 8));
        } else body.append(el('p', { class: 'mm-story-hint', text: 'Select a chapter or page from the outline.' }));
        this.main.append(el('div', { class: 'mm-script' }, outline, body));
    }
    scriptPage(body, chapter, page) {
        const index = chapter.pages.indexOf(page), speakers = `mm-speakers-${page.id}`;
        body.append(el('datalist', { id: speakers }, ...this.story.characters.map(c => el('option', { value: c.name }))),
            el('div', { class: 'mm-row mm-story-toolbar' }, el('h2', { text: `${chapter.title} · ${page.title}` }),
                iconButton('Move page up', 'up', () => { move(chapter.pages, index, -1); this.changed(); this.render(); }, { disabled: !index }),
                iconButton('Move page down', 'down', () => { move(chapter.pages, index, 1); this.changed(); this.render(); }, { disabled: index === chapter.pages.length - 1 }),
                iconButton(page.layout ? 'Update page layout' : 'Create page layout', 'place', () => this.toLayout(page), { class: 'mm-icon-button mm-primary', title: 'Build panels and dialogue bubbles in Page layout' }, true),
                iconButton('Delete page', 'trash', () => this.replace('Delete page', `Delete ${page.title}? Its page layout is kept.`, () => { chapter.pages.splice(index, 1); this.ui.page = null; this.changed(); this.render(); }, 'Delete'), { class: 'mm-icon-button mm-danger' })),
            el('div', { class: 'mm-story-grid2' }, this.input(page, 'title', 'Page title'), this.input(page, 'notes', 'Page notes', 1)));
        page.panels.forEach((panel, p) => {
            const shot = el('select', { 'aria-label': 'Shot', onchange: e => { panel.shot = e.target.value; this.changed(); } }, ...Object.entries(shots).map(([value, text]) => el('option', { value, text, selected: value === panel.shot })));
            body.append(el('article', { class: 'mm-script-panel' }, el('div', { class: 'mm-row' }, el('strong', { text: `Panel ${p + 1}` }), shot,
                iconButton('Move panel up', 'up', () => { move(page.panels, p, -1); this.changed(); this.render(); }, { disabled: !p }),
                iconButton('Move panel down', 'down', () => { move(page.panels, p, 1); this.changed(); this.render(); }, { disabled: p === page.panels.length - 1 }),
                iconButton('Send to Panels', 'sparkles', () => this.toPanels(panel), { title: 'Prepare the panel prompt and character references in Panels' }, true),
                iconButton('Delete panel', 'trash', () => { page.panels.splice(p, 1); this.changed(); this.render(); }, { class: 'mm-icon-button mm-danger' })),
                el('div', { class: 'mm-script-panel-body' }, el('div', {}, this.input(panel, 'description', 'Visual description', 3), this.chips(this.story, panel.characters, () => { this.changed(); this.render(); })),
                    panel.asset ? this.thumb(panel.asset, 'Panel image', [button('Change', () => this.pick('Link panel image', ['panels'], id => panel.asset = id)),
                        iconButton('Unlink', 'clear', () => { panel.asset = null; this.changed(); this.render(); }, { 'aria-label': 'Unlink panel image' }, true)], true)
                        : button('Link panel image', () => this.pick('Link panel image', ['panels'], id => panel.asset = id), { class: 'mm-story-link' })),
                ...panel.lines.map((line, l) => el('div', { class: 'mm-script-line' },
                    el('select', { 'aria-label': 'Line type', onchange: e => { line.type = e.target.value; this.changed(); this.render(); } }, ...Object.entries(lineTypes).map(([value, text]) => el('option', { value, text, selected: value === line.type }))),
                    ['caption', 'sfx'].includes(line.type) ? el('span') : el('input', { value: line.speaker, list: speakers, 'aria-label': 'Speaker', placeholder: 'Speaker', oninput: e => { line.speaker = e.target.value; this.changed(); } }),
                    el('textarea', { value: line.text, rows: 1, 'aria-label': 'Line text', placeholder: line.type === 'sfx' ? 'Sound effect' : 'Text', oninput: e => { line.text = e.target.value; this.changed(); } }),
                    iconButton('Delete line', 'clear', () => { panel.lines.splice(l, 1); this.changed(); this.render(); }))),
                el('div', { class: 'mm-row' }, ...Object.entries(lineTypes).map(([type, text]) => button(`+ ${text}`, () => { panel.lines.push(newLine(type)); this.changed(); this.render(); })))));
        });
        body.append(iconButton('Add panel', 'plus', () => { page.panels.push(newPanel()); this.changed(); this.render(); }, {}, true));
    }
    available(id) { return this.studio.project.assets.some(a => a.id === id && !a.deleted && !a.missing); }
    toReferences(c) {
        const engine = this.studio.state('references').engine, cfg = this.studio.config('references'), style = cfg.prompt_sections?.style?.trim();
        cfg.prompt_sections = { ...referencePresets.Character.prompt_sections, ...(engine === 'krea_edit' ? { task: 'IMAGE_EDIT' } : {}), subject: [c.name, c.role].filter(Boolean).join(', '),
            appearance: c.visual_prompt.trim() || c.appearance, ...(style ? { style } : {}) };
        cfg.prompt = '';
        this.studio.presetChanged('references'); this.studio.rebuild('references'); this.studio.switch('references');
        this.studio.notify(`Character sheet prompt ready for ${c.name || 'the character'}. Generate it, then link the image to the card.`);
    }
    toPanels(panel) {
        const engine = this.studio.state('panels').engine, cfg = this.studio.config('panels'), style = cfg.prompt_sections?.style?.trim();
        const cast = panel.characters.map(id => this.story.characters.find(c => c.id === id)).filter(Boolean);
        cfg.prompt_sections = { task: engine === 'krea_edit' ? 'IMAGE_EDIT' : 'TEXT_TO_IMAGE', subject: panel.description, appearance: cast.map(c => `${c.name}: ${c.visual_prompt.trim() || c.appearance}`).join('\n'),
            composition: shotPrompts[panel.shot], ...(style ? { style } : {}) };
        cfg.prompt = '';
        const references = cast.map(c => [c.portrait, ...c.references].find(id => this.available(id))).filter(Boolean);
        if (!['moss', 'anima'].includes(engine) && references.length) cfg.references = engine === 'qwen' ? references : references.slice(0, 4);
        this.studio.presetChanged('panels'); this.studio.rebuild('panels'); this.studio.switch('panels');
        this.studio.notify('Panel prompt ready. Generate it, then link the image to the script panel.');
    }
    toLayout(page) {
        const design = this.studio.state('design'); design.pages ||= [newPage()];
        const target = design.pages.find(p => p.id === page.layout);
        const apply = () => {
            const layout = normalizePage(layoutFromScript(page, target?.reading || 'rtl'));
            if (target) Object.assign(target, { name: layout.name, panels: layout.panels, bubbles: layout.bubbles });
            else { design.pages.push(layout); page.layout = layout.id; }
            design.currentPage = page.layout;
            this.studio.editor?.destroy(); this.studio.editor = null; this.changed(); this.studio.rebuild('design'); this.studio.switch('design');
        };
        if (target) this.replace('Update page layout', `Replace the panels and bubbles of the layout "${target.name}" with this page's script?`, apply);
        else apply();
    }
    async exportCard(c) {
        const canvas = el('canvas', { width: 1400, height: 900 }), ctx = canvas.getContext('2d'), asset = [c.portrait, ...c.references].find(id => this.available(id));
        ctx.fillStyle = '#f6f3ec'; ctx.fillRect(0, 0, 1400, 900); ctx.fillStyle = '#111111'; ctx.fillRect(0, 0, 1400, 12);
        if (asset) {
            const image = new Image(); image.src = assetUrl(this.studio.project.id, asset); await image.decode();
            const scale = Math.max(520 / image.naturalWidth, 820 / image.naturalHeight);
            ctx.save(); ctx.beginPath(); ctx.rect(40, 50, 520, 810); ctx.clip();
            ctx.drawImage(image, 40 + (520 - image.naturalWidth * scale) / 2, 50 + (810 - image.naturalHeight * scale) / 2, image.naturalWidth * scale, image.naturalHeight * scale); ctx.restore();
        } else { ctx.fillStyle = '#ddd8cc'; ctx.fillRect(40, 50, 520, 810); }
        ctx.strokeStyle = '#111111'; ctx.lineWidth = 4; ctx.strokeRect(40, 50, 520, 810);
        ctx.fillStyle = '#111111'; ctx.font = 'bold 64px sans-serif'; ctx.fillText(c.name || 'Unnamed', 610, 120, 750);
        ctx.font = '30px sans-serif'; ctx.fillStyle = '#555555'; ctx.fillText([c.role, c.age].filter(Boolean).join(' · '), 610, 165, 750);
        let y = 225;
        for (const [key, label] of characterFields.filter(([key]) => ['personality', 'goal', 'conflict', 'arc', 'voice', 'appearance'].includes(key) && c[key].trim())) {
            if (y > 840) break;
            ctx.font = 'bold 22px sans-serif'; ctx.fillStyle = '#316bd5'; ctx.fillText(label.toUpperCase(), 610, y); y += 32;
            ctx.font = '24px sans-serif'; ctx.fillStyle = '#222222';
            for (const line of wrap(ctx, c[key].trim(), 750).slice(0, 4)) { if (y > 860) break; ctx.fillText(line, 610, y); y += 32; }
            y += 14;
        }
        const blob = await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not export the character card')), 'image/png'));
        download(`${c.name || 'character'}-card.png`, blob);
    }
}
