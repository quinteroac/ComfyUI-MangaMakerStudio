import { analysisInstruction } from './page-analysis.js';
import { api } from '../../scripts/api.js';
import { uuid, el, button, iconButton, field, request, assetUrl, download, chooseFile, sizeControls } from './client.js';
import { sizeSettings, sizeLabel } from './size.js';
import { options, defaultAttention, initialSettings, buildPrompt, composePrompt, promptSections, referencePrompt, parsePrompt, referencePresets, refinementPresets, textGeneratorDefaults, textInstruction } from './prompts.js';
import { newPage, normalizePage, PageEditor } from './editor.js';
import { modelFields, globalModels, inheritModels, applyPreset, savedPreset } from './models.js';
import { openDrawing } from './drawing.js';

const spaces = { references: 'References', panels: 'Panels', refine: 'Refinement', design: 'Page layout', finish: 'Finishing' };
const engines = { krea: 'Krea2', krea_edit: 'Krea2 Edit', qwen: 'Qwen Image 2.1' };
const textTasks = { enhance: 'Enhance section', describe: 'Create reference prompt' };
const clone = x => structuredClone(x);

export class Studio {
    constructor() {
        this.observers = []; this.views = new Map(); this.abort = new AbortController(); this.active = localStorage.getItem('mm-space') || 'references';
        this.busy = new Set(); this.progress = new Map(); this.saving = Promise.resolve(); this.galleryRefresh = new Map(); this.referenceRefresh = new Map();
        this.assetMenu = null;
        document.addEventListener('pointerdown', e => { if (this.assetMenu && !this.assetMenu.parentElement.contains(e.target)) this.closeAssetMenu(); }, { signal: this.abort.signal });
        this.dialog = el('dialog', { class: 'mm-studio', lang: 'en', 'aria-label': 'Manga Maker Studio' });
        this.header = el('header', { class: 'mm-header' }); this.nav = el('nav', { class: 'mm-nav', 'aria-label': 'Workspaces' });
        this.body = el('main', { class: 'mm-body' }); this.error = el('div', { class: 'mm-error', role: 'alert', hidden: true });
        this.status = el('footer', { class: 'mm-status', role: 'status' });
        this.dialog.append(this.header, this.nav, this.error, this.body, this.status); document.body.append(this.dialog);
        this.dialog.addEventListener('cancel', e => { e.preventDefault(); this.close(); });
        this.dialog.showModal(); this.load().catch(e => this.fail(e));
        for (const name of ['execution_start', 'progress', 'execution_error', 'execution_interrupted', 'execution_success', 'status', 'manga_maker_error']) api.addEventListener(name, e => this.event(name, e.detail), { signal: this.abort.signal });
    }
    fail(error) {
        this.error.hidden = false; this.error.replaceChildren(el('span', { text: error.message || String(error) }), button('Dismiss message', () => this.error.hidden = true));
    }
    async action(fn) { try { return await fn(); } catch (e) { this.fail(e); } }
    async load() {
        [this.settings, this.projects, this.defs, this.fonts, this.catalog] = await Promise.all([request('/settings'), request('/projects'), api.getNodeDefs(), request('/fonts'), request('/models')]);
        globalModels(this.settings, this.catalog); this.pendingDownloads = new Set(); this.downloadPanels = new Set();
        for (const [engine, state] of Object.entries(this.catalog.downloads)) if (['queued', 'downloading'].includes(state.state)) this.pendingDownloads.add(engine);
        if (this.abort.signal.aborted) return;
        this.renderHeader(); this.renderNav();
        const id = localStorage.getItem('mm-project');
        if (this.projects.some(p => p.id === id)) await this.open(id);
        else this.empty();
        this.timer = setInterval(() => this.poll(), 2000);
    }
    renderHeader() {
        const select = el('select', { 'aria-label': 'Active project', onchange: e => this.action(() => this.open(e.target.value)) }, el('option', { value: '', text: 'Select a project', disabled: true }), ...this.projects.map(p => el('option', { value: p.id, text: p.name })));
        select.value = this.project?.id || '';
        this.header.replaceChildren(el('div', { class: 'mm-brand' }, el('strong', { text: 'Manga Maker' }), el('span', { text: 'STUDIO' })), select,
            iconButton('Projects', 'folder', () => this.projectManager()), iconButton('Settings', 'settings', () => this.globalSettings()),
            iconButton('Back to ComfyUI', 'back', () => this.close(), { class: 'mm-icon-button mm-close' }));
    }
    renderNav() {
        this.nav.replaceChildren(...Object.entries(spaces).map(([key, title]) => button(title, () => this.switch(key), { 'aria-current': this.active === key ? 'page' : 'false' })));
    }
    empty() { this.body.replaceChildren(el('div', { class: 'mm-empty' }, el('h1', { text: 'Your manga starts here' }), el('p', { text: 'Create a project to store references, panels, and pages on your computer.' }), button('Create project', () => this.createProject(), { class: 'mm-primary' }))); }
    async open(id) {
        if (!id) return;
        await this.flush();
        this.resetViews();
        const project = await request(`/projects/${id}`);
        if (this.abort.signal.aborted) return;
        this.project = project; localStorage.setItem('mm-project', id); this.renderHeader(); this.switch(this.active); this.jobs();
    }
    closeAssetMenu() { if (this.assetMenu?.matches(':popover-open')) this.assetMenu.hidePopover(); this.assetMenu = null; }
    resetViews() { this.closeAssetMenu(); this.observers.forEach(o => o.disconnect()); this.observers = []; this.editor?.destroy(); this.editor = null; this.views.clear(); this.galleryRefresh.clear(); this.referenceRefresh.clear(); this.body.replaceChildren(); }
    state(space = this.active) { return this.project.workspace[space] ||= { engine: space === 'finish' ? 'qwen' : 'krea', selection: [], references: [], source: '', search: '', sort: 'newest', filter: 'all', page: 0 }; }
    config(space = this.active, engine = this.state(space).engine) {
        const scope = `${space}:${engine}`;
        const config = this.project.config[scope] ||= { ...initialSettings(engine), ...clone(this.settings.defaults[scope] || {}) };
        Object.assign(config, sizeSettings(config.width && config.height ? { width: config.width, height: config.height } : config));
        delete config.width; delete config.height;
        return inheritModels(config, this.settings.models[engine], engine);
    }
    switch(space) {
        this.active = spaces[space] ? space : 'references'; localStorage.setItem('mm-space', this.active); this.renderNav();
        if (!this.project) return this.empty();
        for (const view of this.views.values()) view.hidden = true;
        let view = this.views.get(this.active);
        if (!view) {
            view = el('section', { class: `mm-workspace mm-${this.active}` }); this.views.set(this.active, view); this.body.append(view);
            if (this.active === 'design') this.design(view);
            else if (this.active === 'refine') this.refine(view);
            else if (this.active === 'finish') this.finish(view);
            else this.generateView(view, this.active);
        }
        view.hidden = false;
        if (this.active === 'design') this.editor?.fit(); this.jobs();
    }
    rebuild(space) { const current = this.views.get(space); current?.remove(); this.views.delete(space); this.galleryRefresh.delete(space); this.referenceRefresh.delete(space); if (this.active === space) this.switch(space); }
    saveSoon() {
        clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => this.flush(), 450);
        if (this.status.dataset.save !== 'pending') this.status.dataset.save = 'pending';
    }
    flush() {
        clearTimeout(this.saveTimer);
        if (!this.project) return this.saving;
        const id = this.project.id;
        const patch = clone({ config: this.project.config, presets: this.project.presets, layouts: this.project.layouts, workspace: this.project.workspace });
        this.saving = this.saving.catch(() => {}).then(() => request(`/projects/${id}`, patch, 'PUT')).then(() => { this.status.dataset.save = 'saved'; }).catch(error => { this.fail(new Error(`Could not save: ${error.message}`)); throw error; });
        return this.saving;
    }
    async close() {
        try { await this.flush(); } catch { return; }
        clearInterval(this.timer); clearTimeout(this.saveTimer); this.abort.abort(); this.resetViews(); this.dialog.close(); this.dialog.remove();
        this.onClose?.();
    }
    modal(title, content) {
        const dialog = el('dialog', { class: 'mm-modal', 'aria-label': title }, el('h2', { text: title }), content);
        dialog.append(button('Close', () => dialog.close())); dialog.addEventListener('close', () => dialog.remove()); this.dialog.append(dialog); dialog.showModal(); return dialog;
    }
    ask(title, value, fn) {
        const input = el('input', { value, required: true, 'aria-label': title });
        const actions = el('div', { class: 'mm-dialog-actions' }, el('button', { type: 'submit', text: 'Save', class: 'mm-primary' }));
        const form = el('form', { class: 'mm-name-form', onsubmit: e => { e.preventDefault(); this.action(async () => { await fn(input.value); dialog.close(); }); } }, input, actions);
        const dialog = this.modal(title, form); actions.prepend(dialog.querySelector(':scope > button')); input.focus();
    }
    clonePreset(presets, name, save) {
        this.ask('Copy preset name', `${name} · copy`, copyName => {
            copyName = copyName.trim();
            if (!copyName || Object.hasOwn(presets, copyName)) throw new Error('Choose a new preset name.');
            save(copyName, clone(presets[name])); this.saveSoon();
        });
    }
    confirm(title, fn) {
        const dialog = this.modal(title, el('div', {}, el('p', { text: 'Confirm this operation. Removed assets can be recovered using the Trash filter.' }), button('Confirm', () => this.action(async () => { await fn(); dialog.close(); }), { class: 'mm-danger' })));
    }
    createProject(onCreated) { this.ask('Project name', 'New manga', async name => { const p = await request('/projects', { name }, 'POST'); this.projects = await request('/projects'); await this.open(p.id); onCreated?.(); }); }
    projectManager() {
        const list = el('div', { class: 'mm-project-list' });
        for (const p of this.projects) list.append(el('div', { class: 'mm-project-row' }, el('strong', { text: p.name }), el('div', { class: 'mm-project-actions', role: 'group', 'aria-label': `Actions for ${p.name}` }, button('Open', () => this.action(async () => { await this.open(p.id); dialog.close(); })),
            button('Rename', () => this.ask('Rename project', p.name, async name => { await request(`/projects/${p.id}`, { name }, 'PUT'); this.projects = await request('/projects'); if (this.project?.id === p.id) this.project.name = name; this.renderHeader(); dialog.close(); this.projectManager(); })),
            button('Duplicate', () => this.ask('Copy name', `${p.name} · copy`, async name => { const copy = await request(`/projects/${p.id}/duplicate`, { name }, 'POST'); this.projects = await request('/projects'); await this.open(copy.id); dialog.close(); })))));
        if (!this.projects.length) list.append(el('p', { class: 'mm-project-empty', text: 'No projects yet. Create one to get started.' }));
        const dialog = this.modal('Projects', list); dialog.classList.add('mm-project-dialog');
        dialog.append(el('div', { class: 'mm-dialog-actions mm-project-footer' }, dialog.querySelector(':scope > button'), button('Create project', () => this.createProject(() => dialog.close()), { class: 'mm-primary' })));
    }
    globalSettings() {
        const value = clone(this.settings); this.globalDraft = value;
        const root = el('input', { value: value.root, oninput: e => value.root = e.target.value });
        const form = el('div', { class: 'mm-settings' }, field('Project root folder', root, 'To relocate projects, wait for the queue to finish, move the complete folders, and select the new root folder.'));
        const text = value.text_generator = { ...textGeneratorDefaults, ...value.text_generator };
        const textControls = el('div');
        const renderText = () => {
            textControls.replaceChildren(el('h3', { text: 'Global text generator' }),
                this.picker('Text generator CLIP', options(this.defs, 'CLIPLoader', 'clip_name'), text.encoder, v => text.encoder = v),
                this.picker('Text generator CLIP type', options(this.defs, 'CLIPLoader', 'type'), text.encoder_type, v => text.encoder_type = v),
                this.picker('Text generator device', options(this.defs, 'CLIPLoader', 'device'), text.encoder_device, v => text.encoder_device = v),
                field('Text length · tokens', el('input', { type: 'number', min: 1, max: 32768, value: text.max_length, onchange: e => text.max_length = Number(e.target.value) })),
                el('small', { text: 'Use an encoder that supports text generation; describing references also requires vision. Shared across projects and engines. Requires TextGenerate and SaveText.' }));
        }; renderText(); form.append(textControls);
        const engineSelect = el('select', { 'aria-label': 'Global model engine' }, ...Object.entries(engines).map(([value, text]) => el('option', { value, text })));
        if (this.project && engines[this.state().engine]) engineSelect.value = this.state().engine;
        const controls = el('div'); const render = () => {
            controls.replaceChildren(); const engine = engineSelect.value;
            this.modelControls(controls, value.models[engine], engine, () => {}, true, 'references', render);
        };
        engineSelect.onchange = render; render();
        this.globalModelRender = render;
        form.append(el('p', { text: 'One model configuration per engine, shared across references, panels, refinement and finishing. Individual fields and presets override only the values they define.' }), field('Global model engine', engineSelect), controls,
            button('Export global settings', () => download('manga-maker-config.json', value)), button('Import global settings', () => chooseFile('.json', files => this.action(async () => {
                const imported = JSON.parse(await files[0].text()); if (!imported.presets || (!imported.models && !imported.defaults)) throw new Error('Invalid settings file');
                value.defaults = imported.defaults || {}; value.models = imported.models || {}; globalModels(value, this.catalog); value.presets = imported.presets; Object.assign(text, textGeneratorDefaults, imported.text_generator || {}); renderText(); render();
            }))), button('Export project settings', () => download('manga-project-settings.json', { config: this.project?.config || {}, presets: this.project?.presets || {}, layouts: this.project?.layouts || {} })),
            button('Import project settings', () => chooseFile('.json', files => this.action(async () => {
                if (!this.project) throw new Error('Open a project'); const imported = JSON.parse(await files[0].text());
                this.confirm('Replace project settings and presets', async () => { for (const key of ['config', 'presets', 'layouts']) if (imported[key]) this.project[key] = imported[key]; await this.flush(); this.resetViews(); this.switch(this.active); });
            }))), button('Refresh models and nodes', () => this.action(async () => { this.defs = await api.getNodeDefs(); this.catalog = await request('/models'); renderText(); render(); })),
            button('Save global settings', () => this.action(async () => { let savedBeforeMove = true;
                try { await this.flush(); } catch (error) { if (value.root === this.settings.root) throw error; savedBeforeMove = false; }
                this.settings = await request('/settings', value, 'POST'); this.projects = await request('/projects');
                if (!this.projects.some(p => p.id === this.project?.id)) {
                    if (this.project && !savedBeforeMove) throw new Error('The new root folder does not contain the active project. Changes remain in memory; select the folder containing the relocated project.');
                    this.project = null; this.resetViews(); this.empty();
                } else await this.flush();
                this.error.hidden = true; this.resetViews(); this.renderHeader(); this.switch(this.active); dialog.close(); }), { class: 'mm-primary' }));
        const dialog = this.modal('Global settings', form);
        dialog.addEventListener('close', () => { this.globalDraft = null; this.globalModelRender = null; });
    }
    picker(label, list, current, change, help = '') {
        const input = el('input', { 'aria-label': label, value: current || '', list: `mm-${uuid()}`, placeholder: 'Search and select…', onchange: e => change(e.target.value), class: current && !list.includes(current) ? 'mm-missing' : '' });
        const data = el('datalist', { id: input.list?.id || input.getAttribute('list') }, ...list.map(value => el('option', { value })));
        return field(label, el('div', {}, input, data), current && !list.includes(current) ? `Missing selection: ${current}` : help);
    }
    modelControls(host, cfg, engine, changed, expanded = false, space = this.active, restoreView = () => this.rebuild(space)) {
        const technical = el('details', { open: expanded }, el('summary', { text: 'Models and advanced settings' }));
        const set = key => value => { cfg[key] = value; if (!expanded) (cfg.model_overrides ||= {})[key] = value; changed(); };
        if (!expanded) technical.append(el('small', { text: 'Empty model fields inherit the global engine configuration. Changes here affect only this operation.' }));
        const encoderType = this.picker('Encoder loading type', options(this.defs, 'CLIPLoader', 'type'), cfg.encoder_type, set('encoder_type'));
        technical.append(this.picker('Diffusion model', options(this.defs, 'UNETLoader', 'unet_name'), cfg.model, set('model')),
            this.picker('Text encoder', options(this.defs, 'CLIPLoader', 'clip_name'), cfg.encoder, set('encoder')),
            encoderType,
            this.picker('VAE', options(this.defs, 'VAELoader', 'vae_name'), cfg.vae, set('vae')));
        if (engine === 'krea_edit' && space !== 'sketch') technical.append(this.picker('Identity Edit LoRA', options(this.defs, 'LoraLoaderModelOnly', 'lora_name'), cfg.identity_lora, set('identity_lora')));
        if (engine === 'krea' || engine === 'krea_edit') {
            const adapter = this.picker('Bridge / adapter', options(this.defs, 'Krea2Qwen8BAdapter', 'adapter_name'), cfg.adapter, set('adapter')); adapter.hidden = cfg.encoding !== 'bridge';
            const encoding = el('select', { 'aria-label': 'Conditioning path', onchange: e => { set('encoding')(e.target.value); set('encoder_type')(cfg.encoding === 'bridge' ? 'stable_diffusion' : 'krea2'); encoderType.querySelector('input').value = cfg.encoder_type; adapter.hidden = cfg.encoding !== 'bridge'; } }, el('option', { value: 'bridge', text: 'Qwen-VL 8B + bridge' }), el('option', { value: 'native', text: 'Native Krea2 encoder' })); encoding.value = cfg.encoding;
            technical.append(field('Conditioning path', encoding), adapter);
            const edit = el('details', {}, el('summary', { text: 'Krea2 editing · references' }));
            for (const [label, key, step] of [['Last reference / subject fidelity', 'ref_boost', 0.01], ['Earlier references / scene fidelity', 'ref_boost_a', 0.01], ['Maximum grounding dimension · px', 'grounding_px', 64]]) {
                edit.append(field(label, el('input', { type: 'number', value: cfg[key] ?? (key === 'grounding_px' ? 768 : 1), step, onchange: e => set(key)(Number(e.target.value)) })));
            }
            edit.append(this.picker('Reference fit', options(this.defs, 'Krea2EditModelPatch', 'fit_mode'), cfg.fit_mode || 'fit', set('fit_mode')),
                field('Grounding system prompt · optional', el('textarea', { value: cfg.grounding_system_prompt || '', oninput: e => set('grounding_system_prompt')(e.target.value) })));
            if (space !== 'refine') technical.append(edit);
        }
        technical.append(this.picker('Weight precision', options(this.defs, 'UNETLoader', 'weight_dtype'), cfg.weight_dtype, set('weight_dtype')),
            this.picker('Encoder device', options(this.defs, 'CLIPLoader', 'device'), cfg.encoder_device, set('encoder_device')));
        if (this.defs.ModelAttentionBackend) technical.append(this.picker(engine === 'qwen' ? 'Attention · leave empty for ComfyUI default' : 'Attention backend', options(this.defs, 'ModelAttentionBackend', 'attention'), cfg.attention || defaultAttention(this.defs, engine), set('attention')));
        if (engine === 'qwen' && this.defs.QwenImage21Cache) technical.append(this.picker('Cache device', options(this.defs, 'QwenImage21Cache', 'device'), cfg.cache_device, set('cache_device')), this.picker('Cache precision', options(this.defs, 'QwenImage21Cache', 'dtype'), cfg.cache_dtype, set('cache_dtype')));
        technical.append(button('Refresh lists', () => this.action(async () => { this.defs = await api.getNodeDefs(); this.catalog = await request('/models'); restoreView(); })));
        if (!expanded) technical.append(button('Use global model configuration', () => this.action(async () => {
            this.settings = await request('/settings');
            globalModels(this.settings, this.catalog); cfg.model_overrides = {}; inheritModels(cfg, this.settings.models[engine], engine);
            changed(); restoreView();
        })));
        if (space !== 'sketch') this.officialModelControls(technical, engine);
        host.append(technical);
        if (!expanded) this.loraControls(host, cfg, changed, this.project.presets, `${space}:${engine}`);
        if (expanded) this.samplingControls(host, cfg, engine, changed, space, true);
    }
    officialModelControls(host, engine) {
        const panel = el('div', { class: 'mm-official-models' }); host.append(panel);
        const render = () => {
            const profile = this.catalog.profiles[engine], state = this.catalog.downloads[engine];
            const missing = this.catalog.artifacts.filter(a => profile.artifacts.includes(a.id) && !a.installed);
            const active = state && ['queued', 'downloading'].includes(state.state);
            panel.replaceChildren(el('h4', { text: 'Official model setup' }), el('a', { text: 'Workflow / recommended settings', href: profile.workflow, target: '_blank', rel: 'noopener noreferrer' }),
                el('p', { text: missing.length ? `Missing official weights: ${missing.map(a => `${a.filename} (${(a.size / 1e9).toFixed(2)} GB)`).join(', ')}. Downloads start only when you click the button.` : 'All official weights are installed.' }),
                state ? el('p', { role: 'status', text: state.state === 'error' ? `Download failed: ${state.error}` : active ? `${state.state} · ${state.filename || profile.name} · ${(state.received / 1e9).toFixed(2)} / ${(state.total / 1e9).toFixed(2)} GB` : 'Download complete.' }) : null,
                missing.length ? button('Download missing official weights', () => this.action(async () => {
                    this.catalog.downloads[engine] = await request('/models/download', { engine }, 'POST'); this.pendingDownloads.add(engine); render();
                }), { disabled: !!active }) : button('Use official models and recommended sampling', () => this.action(async () => { await this.useOfficialModels(engine); this.resetViews(); this.switch(this.active); render(); })));
        };
        render(); this.downloadPanels.add({ panel, render });
    }
    async useOfficialModels(engine) {
        const settings = await request('/settings'); globalModels(settings, this.catalog);
        const values = clone(this.catalog.profiles[engine].settings);
        for (const artifact of this.catalog.artifacts) for (const key of ['model', 'encoder', 'vae', 'identity_lora']) if (values[key] === artifact.filename && artifact.installed) values[key] = artifact.installed;
        Object.assign(settings.models[engine], values);
        this.settings = await request('/settings', settings, 'POST'); this.defs = await api.getNodeDefs();
        if (this.globalDraft) { this.globalDraft.models[engine] = clone(this.settings.models[engine]); this.globalModelRender(); }
        this.status.textContent = `${engines[engine]} · Official models and recommended sampling applied globally`;
    }
    async pollDownloads() {
        if (this.downloadPolling || !this.pendingDownloads.size) return;
        this.downloadPolling = true;
        try {
            this.catalog = await request('/models');
            for (const engine of this.pendingDownloads) {
                const state = this.catalog.downloads[engine]?.state;
                if (state === 'complete') {
                    await this.useOfficialModels(engine); this.pendingDownloads.delete(engine);
                    this.resetViews(); this.switch(this.active);
                } else if (state === 'error') this.pendingDownloads.delete(engine);
            }
            for (const view of this.downloadPanels) if (view.panel.isConnected) view.render(); else this.downloadPanels.delete(view);
        } catch (error) { this.fail(error); }
        finally { this.downloadPolling = false; }
    }
    loraControls(host, cfg, changed, presetStore = this.project.presets, scope = `${this.active}:${cfg.engine}`) {
        cfg.loras ||= [];
        const details = el('details', {}, el('summary', { text: `LoRAs · ${cfg.loras.filter(l => l.enabled).length} enabled` }));
        const rows = el('div'); const refresh = () => {
            details.querySelector('summary').textContent = `LoRAs · ${cfg.loras.filter(l => l.enabled).length} enabled`;
            rows.replaceChildren(...cfg.loras.map((l, index) => el('div', { class: 'mm-lora' },
                field('Enabled', el('input', { type: 'checkbox', checked: l.enabled, onchange: e => { l.enabled = e.target.checked; changed(); refresh(); } })),
                this.picker('LoRA file', options(this.defs, 'LoraLoader', 'lora_name'), l.name, value => { l.name = value; changed(); }),
                field('Model strength', el('input', { type: 'number', value: l.model, step: 0.05, onchange: e => { l.model = Number(e.target.value); changed(); } })),
                scope.endsWith(':krea_edit') ? null : field('Encoder strength', el('input', { type: 'number', value: l.clip, step: 0.05, onchange: e => { l.clip = Number(e.target.value); changed(); } })),
                button('↑', () => { if (index) { [cfg.loras[index - 1], cfg.loras[index]] = [l, cfg.loras[index - 1]]; changed(); refresh(); } }, { 'aria-label': 'Move LoRA up' }),
                button('↓', () => { if (index < cfg.loras.length - 1) { [cfg.loras[index + 1], cfg.loras[index]] = [l, cfg.loras[index + 1]]; changed(); refresh(); } }, { 'aria-label': 'Move LoRA down' }),
                button('Remove', () => { cfg.loras.splice(index, 1); changed(); refresh(); }))));
        }; refresh();
        details.append(rows, button('Add LoRA', () => { cfg.loras.push({ enabled: true, name: '', model: 1, clip: 1 }); changed(); refresh(); }),
            button('Save LoRA preset', () => this.ask('LoRA preset name', '', name => { const key = scope; (presetStore[key] ||= {})[`LoRAs · ${name}`] = { loras: clone(cfg.loras) }; this.saveSoon(); })),
            button('Load LoRA preset', () => {
                const presets = { ...(this.settings.presets[scope] || {}), ...(presetStore[scope] || {}) };
                const list = el('div');
                const render = () => list.replaceChildren(...Object.entries(presets).filter(([, v]) => v.loras).map(([name, value]) => el('div', { class: 'mm-row' },
                    button(name, () => { cfg.loras = clone(value.loras); changed(); refresh(); }),
                    iconButton(`Clone LoRA preset ${name}`, 'copy', () => this.clonePreset(presets, name, (copyName, copy) => {
                        (presetStore[scope] ||= {})[copyName] = copy; presets[copyName] = copy; render();
                    })))));
                render(); this.modal('LoRA presets', list);
            }), el('small', { text: 'Applied to the sampler model in this order. A registered selection does not guarantee checkpoint compatibility.' })); host.append(details);
    }
    samplingControls(host, cfg, engine, changed, space, global = false) {
        const group = el('details', {}, el('summary', { text: 'Sampling' }));
        const set = (key, value) => { cfg[key] = value; if (!global && modelFields.includes(key)) (cfg.model_overrides ||= {})[key] = value; changed(); };
        for (const [label, key, step] of [['Steps', 'steps', 1], ...(engine === 'qwen' || engine === 'krea_edit' ? [['CFG', 'cfg', 0.1]] : []), ...(engine === 'krea' && space === 'refine' ? [['Denoise', 'denoise', 0.01]] : [])]) {
            group.append(field(label, el('input', { type: 'number', value: cfg[key], step, onchange: e => set(key, Number(e.target.value)) })));
        }
        if (engine === 'krea' || engine === 'krea_edit') group.append(field('Shift', el('input', { type: 'number', 'aria-label': 'Shift', value: cfg.shift ?? '', step: 0.01,
            placeholder: 'Model default', onchange: e => { const value = e.target.value; if (!value || Number.isFinite(Number(value))) set('shift', value === '' ? '' : Number(value)); } }),
            'Empty uses the model default, or the global Shift when configured.'));
        if (engine === 'krea_edit' && !global) {
            const denoise = field('Denoise', el('input', { type: 'number', 'aria-label': 'Denoise', value: cfg.denoise, min: 0, max: 1, step: 0.05,
                onchange: e => { const value = Number(e.target.value); if (Number.isFinite(value)) set('denoise', value); } }), 'Lower values preserve more of the initial latent image.');
            denoise.classList.add('mm-edit-denoise'); denoise.hidden = space !== 'sketch' && !cfg.latent_reference; group.append(denoise);
        }
        group.append(this.picker('Sampler', options(this.defs, 'KSampler', 'sampler_name'), cfg.sampler, value => set('sampler', value)),
            this.picker('Scheduler', options(this.defs, 'KSampler', 'scheduler'), cfg.scheduler, value => set('scheduler', value)));
        if (engine === 'qwen' && !global) group.append(field('Negative prompt', el('textarea', { value: cfg.negative, oninput: e => { cfg.negative = e.target.value; changed(); } })));
        host.append(group);
    }
    presetChanged(space, host = this.views.get(space)) {
        const state = this.state(space);
        if (state.preset && !state.preset_modified) {
            state.preset_modified = true;
            const select = host?.querySelector('[aria-label="Prompt and settings preset"]');
            if (select?.value === state.preset) select.selectedOptions[0].textContent = `${state.preset} · Modified`;
        }
        this.saveSoon();
    }
    presets(host, space, cfg, builtins = {}, refresh = () => this.rebuild(space)) {
        const key = `${space}:${cfg.engine}`; const named = { ...builtins, ...(this.settings.presets[key] || {}), ...(this.project.presets[key] || {}) };
        const select = el('select', { 'aria-label': 'Prompt and settings preset', onchange: e => {
            if (!e.target.value) { this.state(space).preset = ''; this.state(space).preset_modified = false; this.saveSoon(); refresh(); return; }
            const preset = named[e.target.value];
            const value = builtins[e.target.value] === preset ? { ...preset, prompt_sections: { ...cfg.prompt_sections, ...preset.prompt_sections,
                ...(space === 'references' && cfg.prompt_sections?.style?.trim() ? { style: cfg.prompt_sections.style } : {}),
                ...(cfg.engine === 'krea_edit' ? { task: 'IMAGE_EDIT' } : {}) } } : preset;
            applyPreset(cfg, value); inheritModels(cfg, this.settings.models[cfg.engine], cfg.engine);
            this.state(space).preset = e.target.value; this.state(space).preset_modified = false; this.saveSoon(); refresh();
        } }, el('option', { value: '', text: 'Preset…' }), ...Object.keys(named).map(name => el('option', { value: name, text: name })));
        select.value = this.state(space).preset || '';
        if (select.value && this.state(space).preset_modified) select.selectedOptions[0].textContent = `${select.value} · Modified`;
        host.append(field('Preset · changing settings creates a variant', select), iconButton('Save settings as preset', 'save', () => this.ask('Preset name', this.state(space).preset || '', name => { (this.project.presets[key] ||= {})[name] = savedPreset(cfg); this.state(space).preset = name; this.state(space).preset_modified = false; this.saveSoon(); refresh(); })),
            iconButton('Clone preset', 'copy', () => this.clonePreset(named, select.value, (name, value) => {
                if (builtins[select.value] === named[select.value] && cfg.engine === 'krea_edit') value.prompt_sections.task = 'IMAGE_EDIT';
                (this.project.presets[key] ||= {})[name] = value; this.state(space).preset = name; refresh();
            }), { disabled: !select.value }),
            iconButton('Export presets', 'download', () => download(`manga-${key.replace(':', '-')}-presets.json`, { scope: key, presets: named })), iconButton('Import presets', 'upload', () => chooseFile('.json', files => this.action(async () => {
                const imported = JSON.parse(await files[0].text()); if (imported.scope !== key || !imported.presets) throw new Error('This preset belongs to a different operation or engine');
                this.project.presets[key] = { ...(this.project.presets[key] || {}), ...imported.presets }; this.saveSoon(); refresh();
            }))));
    }
    engineSelect(host, space) {
        const state = this.state(space);
        const select = el('select', { 'aria-label': 'Engine', onchange: e => { state.engine = e.target.value; this.saveSoon(); this.rebuild(space); } }, el('option', { value: 'krea', text: 'Krea2' }),
            ...(['references', 'panels'].includes(space) ? [el('option', { value: 'krea_edit', text: 'Krea2 · edit' })] : []), el('option', { value: 'qwen', text: 'Qwen Image 2.1' })); select.value = state.engine;
        host.append(field('Engine', select));
    }
    essentials(host, cfg, space, editing = false) {
        const changed = () => this.presetChanged(space);
        this.promptControls(host, cfg, changed, editing || cfg.engine === 'krea_edit', space);
        host.append(el('div', { class: 'mm-size-controls' })); this.resolutionControls(host, cfg, space, editing);
        host.append(field('Seed', el('input', { type: 'number', value: cfg.seed, min: 0, step: 1, onchange: e => { cfg.seed = Number(e.target.value); changed(); } })), field('Random seed for each generation', el('input', { type: 'checkbox', checked: cfg.random_seed, onchange: e => { cfg.random_seed = e.target.checked; changed(); } })));
        this.samplingControls(host, cfg, cfg.engine, changed, space); this.modelControls(host, cfg, cfg.engine, changed, false, space);
    }
    promptControls(host, cfg, changed, editing = false, space) {
        const sections = cfg.prompt_sections ||= {};
        const preview = el('textarea', { class: 'mm-prompt-preview', readOnly: true, 'aria-label': 'Combined prompt' });
        let previewTimer;
        const combined = el('details', { class: 'mm-prompt-combined', ontoggle: () => {
            clearTimeout(previewTimer);
            if (combined.open) preview.value = composePrompt(cfg);
        } }, el('summary', { text: 'Show combined prompt' }), preview);
        const update = () => {
            changed();
            clearTimeout(previewTimer);
            if (combined.open) previewTimer = setTimeout(() => {
                if (combined.isConnected && combined.open) preview.value = composePrompt(cfg);
            }, 150);
        };
        const group = el('details', { class: 'mm-prompt-sections', open: true }, el('summary', { text: 'Structured prompt' }),
            el('small', { text: 'Edit only the sections you want to change. Empty fields are omitted; other sections retain their content.' }));
        const taskList = `mm-task-${uuid()}`;
        const enhanceField = (input, key, label) => space ? el('div', { class: 'mm-prompt-field' }, input,
            iconButton(`Enhance ${label}`, 'sparkles', () => this.action(() => this.run('enhance', space, null, key)),
                { 'data-run': 'enhance', title: 'Enhance this field with the global text generator' })) : input;
        const task = el('input', { value: sections.task || '', list: taskList, placeholder: 'TEXT_TO_IMAGE', oninput: e => { sections.task = e.target.value; update(); } });
        group.append(field('TASK', task),
            el('datalist', { id: taskList }, ...['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'IMAGE_EDIT', 'REFINE', 'REDESIGN'].map(value => el('option', { value }))));
        for (const [key, tag] of promptSections) {
            const status = el('small', { text: sections[key]?.trim() ? 'Filled' : 'Empty' });
            const input = el('textarea', { value: sections[key] || '', rows: 3, 'aria-label': tag, oninput: e => {
                sections[key] = e.target.value;
                const text = e.target.value.trim() ? 'Filled' : 'Empty';
                if (status.textContent !== text) status.textContent = text;
                update();
            } });
            group.append(el('details', { class: 'mm-prompt-section' }, el('summary', {}, el('span', { text: tag }), status), enhanceField(input, key, tag)));
        }
        const free = el('textarea', { class: 'mm-prompt', value: cfg.prompt || '', placeholder: editing ? 'Additional instructions or a complete editing prompt…' : 'Additional text or any prompt outside this format…', oninput: e => { cfg.prompt = e.target.value; update(); } });
        group.querySelector('summary').append(iconButton('Clear prompt', 'clear', e => {
            e.preventDefault(); e.stopPropagation();
            for (const key of Object.keys(sections)) delete sections[key];
            cfg.prompt = ''; free.value = ''; preview.value = '';
            for (const input of group.querySelectorAll('input, textarea')) input.value = '';
            for (const status of group.querySelectorAll('.mm-prompt-section summary small')) status.textContent = 'Empty';
            clearTimeout(previewTimer); changed();
        }, { class: 'mm-icon-button mm-prompt-clear', title: 'Clear TASK, all sections, and the free prompt' }));
        host.append(group, field('Free prompt', enhanceField(free, 'free', 'free prompt')), combined);
    }
    downloadImageAction(asset) {
        return iconButton('Download image', 'download', () => {
            this.closeAssetMenu();
            el('a', { href: assetUrl(this.project.id, asset.id) + '?original=1', download: '' }).click();
        }, { role: 'menuitem', class: 'mm-menu-item', disabled: !!asset.missing }, true);
    }
    referencePromptAction(asset, space) {
        const available = !!referencePrompt(asset);
        return iconButton('Use image prompt', 'pencil', () => {
            this.closeAssetMenu();
            const saved = referencePrompt(asset);
            if (!saved) return;
            Object.assign(this.config(space), saved);
            this.presetChanged(space); this.rebuild(space);
        }, { role: 'menuitem', class: 'mm-menu-item', disabled: !available,
            title: available ? 'Fill the sections and free prompt for this operation' : 'This image has no recoverable prompt' }, true);
    }
    describeReferenceAction(asset, space) {
        return iconButton('Create prompt from image', 'sparkles', () => {
            this.closeAssetMenu(); this.action(() => this.run('describe', space, asset.id));
        }, { role: 'menuitem', class: 'mm-menu-item', 'data-run': 'describe', 'data-text-source': asset.id,
            disabled: asset.deleted || asset.missing || !this.textGeneratorAvailable(),
            title: 'Analyze this reference with the global CLIP and create a structured prompt' }, true);
    }
    textGeneratorAvailable() {
        const config = { ...textGeneratorDefaults, ...this.settings.text_generator };
        return !!this.defs.TextGenerate && !!this.defs.SaveText && options(this.defs, 'CLIPLoader', 'clip_name').includes(config.encoder)
            && options(this.defs, 'CLIPLoader', 'type').includes(config.encoder_type);
    }
    resolutionControls(host, cfg, space, editing = false) {
        const box = host.querySelector('.mm-size-controls');
        const latent = cfg.engine === 'krea_edit' && cfg.references.includes(cfg.latent_reference) ? cfg.latent_reference : null;
        const id = editing ? this.state(space).source : latent || cfg.references[0];
        const source = this.project.assets.find(a => a.id === id);
        const inherited = !!source && cfg.size_mode !== 'manual';
        const changed = () => this.presetChanged(space);
        const mode = el('select', { 'aria-label': 'Output size', onchange: e => { cfg.size_mode = e.target.value; changed(); this.resolutionControls(host, cfg, space, editing); } },
            el('option', { value: 'original', text: 'Inherit from original image', disabled: !source }), el('option', { value: 'manual', text: 'Manual · AR and MP' }));
        mode.value = inherited ? 'original' : 'manual';
        box.replaceChildren(field('Output size', mode), sizeControls(inherited ? source : cfg, size => { Object.assign(cfg, size, { size_mode: 'manual' }); changed(); }, inherited),
            el('small', { text: inherited ? `Inherited from ${source.name}${editing ? '.' : latent ? ', the initial latent reference.' : ', the first reference.'}` : source && (cfg.engine === 'qwen' || editing || latent) ? 'The image is resized to the selected AR and MP with a centered crop; the original file is preserved.' : 'Select the aspect ratio and resolution in megapixels.' }));
    }
    references(host, space, cfg) {
        const box = el('details', { open: true }, el('summary', { text: 'Connected visual references' }));
        const list = el('div', { class: 'mm-reference-strip' });
        const latent = cfg.engine === 'krea_edit' ? el('select', { 'aria-label': 'Initial latent image', onchange: e => {
            cfg.latent_reference = e.target.value; this.presetChanged(space); refresh();
        } }) : null;
        const refresh = () => {
            if (latent) {
                if (cfg.latent_reference && !cfg.references.includes(cfg.latent_reference)) { cfg.latent_reference = ''; this.saveSoon(); }
                latent.replaceChildren(el('option', { value: '', text: 'None · empty latent' }), ...cfg.references.map((id, i) => el('option', { value: id, text: `${i + 1}. ${this.project.assets.find(a => a.id === id)?.name || 'Missing'}` })));
                latent.value = cfg.latent_reference || '';
                host.querySelector('.mm-edit-denoise').hidden = !cfg.latent_reference;
            }
            this.resolutionControls(host, cfg, space);
            list.replaceChildren(...cfg.references.map((id, i) => {
                const a = this.project.assets.find(a => a.id === id);
                const card = el('div', { 'data-asset-id': id }, el('img', { src: assetUrl(this.project.id, id, true), alt: a?.name || 'Missing', loading: 'lazy' }),
                    el('small', { text: `${i + 1}. ${a?.name || 'Missing'}${a?.deleted ? ' · Trash' : a?.missing ? ' · Missing file' : ''}` }),
                    a?.deleted ? iconButton('Restore reference', 'restore', () => this.action(async () => {
                        await this.patchAssets({ [id]: { deleted: false } }); this.galleryRefresh.forEach(render => render());
                    })) : null, button('↑', () => { if (i) { [cfg.references[i - 1], cfg.references[i]] = [id, cfg.references[i - 1]]; this.presetChanged(space); } refresh(); }),
                    button('Remove', () => { cfg.references.splice(i, 1); this.presetChanged(space); refresh(); }));
                if (a) {
                    const actions = el('div', { id: `mm-reference-menu-${space}-${id}`, class: 'mm-asset-menu', popover: 'manual', role: 'menu', 'aria-label': `Actions for ${a.name}` }, this.downloadImageAction(a), this.referencePromptAction(a, space));
                    if (a.kind === 'references') actions.append(this.describeReferenceAction(a, space));
                    this.assetContextMenu(card, actions);
                }
                return card;
            }));
        }; refresh(); this.referenceRefresh.set(space, refresh);
        box.append(list, latent ? field('Initial latent image', latent, 'Select one connected image to enable Denoise in Sampling.') : null, button('Choose references', () => {
            const items = this.project.assets.filter(a => !a.deleted && !a.missing);
            const picker = el('div', { class: 'mm-asset-picker' });
            const update = () => { for (const b of picker.children) b.disabled = cfg.engine !== 'qwen' && cfg.references.length >= 4 && !cfg.references.includes(b.dataset.assetId); };
            picker.append(...items.map(a => this.assetPickerItem(a, () => {
                if (!cfg.references.includes(a.id) && (cfg.engine === 'qwen' || cfg.references.length < 4)) { cfg.references.push(a.id); this.presetChanged(space); }
                refresh(); update(); this.jobs();
            }))); update(); this.modal('Connect references', picker);
        }));
        box.append(el('small', { text: cfg.engine === 'qwen' ? 'Qwen: images are connected to the vision encoder and VAE. Inherit the size of the first reference or set AR and MP manually.' : 'Krea2 Edit: connect one to four references in order. For scene/subject edits, place the scene first and the subject last. Use compatible editing models and LoRAs. The 8B bridge requires a vision encoder and was trained with text.' }));
        host.append(box);
    }
    assetPickerItem(a, action) { const b = button('', action, { 'data-asset-id': a.id }); b.append(el('img', { src: assetUrl(this.project.id, a.id, true), alt: a.name, loading: 'lazy' }), el('span', { text: `${a.name} · ${a.kind}` })); return b; }
    controlLayout(view, controls, space) {
        const state = this.state(space); controls.hidden = !!state.controlsCollapsed;
        if (state.controlWidth) controls.style.width = `${state.controlWidth}px`;
        view.prepend(button('Controls', () => { controls.hidden = !controls.hidden; state.controlsCollapsed = controls.hidden; this.saveSoon(); }, { class: 'mm-controls-toggle', 'aria-label': 'Show or hide controls' }));
        const observer = new ResizeObserver(entries => { const width = Math.round(controls.getBoundingClientRect().width); if (width > 100 && state.controlWidth !== width) { state.controlWidth = width; this.saveSoon(); } });
        observer.observe(controls); this.observers.push(observer);
    }
    generateView(view, space) {
        const controls = el('aside', { class: 'mm-controls' });
        this.engineSelect(controls, space);
        const cfg = this.config(space); cfg.engine = this.state(space).engine;
        controls.append(el('h2', { text: space === 'references' ? 'Create references' : 'Generate panels' }));
        this.presets(controls, space, cfg, space === 'references' ? referencePresets : {});
        this.essentials(controls, cfg, space); this.references(controls, space, cfg);
        controls.append(button(cfg.engine === 'krea_edit' ? space === 'references' ? 'Edit reference' : 'Edit panel' : space === 'references' ? 'Generate reference' : 'Generate panel', () => this.action(() => this.run(space)), { class: 'mm-primary', 'data-run': space }));
        const gallery = el('section', { class: 'mm-gallery-area' }); view.append(controls, gallery); this.gallery(gallery, space === 'references' ? 'references' : 'panels', space); this.controlLayout(view, controls, space);
    }
    sourcePicker(host, space, kind, onchange) {
        const label = kind === 'pages' ? 'Original page' : kind === 'panels' ? 'Original panel' : 'Original image';
        const state = this.state(space); const select = el('select', { 'aria-label': label, onchange: e => { state.source = e.target.value; state.result = ''; this.saveSoon(); onchange(); } }, el('option', { value: '', text: 'Select original…' }),
            ...this.project.assets.filter(a => (!kind || a.kind === kind) && !a.deleted).map(a => el('option', { value: a.id, text: `${kind ? '' : `${a.kind === 'pages' ? 'Pages' : spaces[a.kind]} · `}${a.name} · v${a.version}${a.missing ? ' · Missing' : ''}` })));
        select.value = state.source; host.append(field(label, select));
    }
    refine(view) {
        const space = 'refine', controls = el('aside', { class: 'mm-controls' }), preview = el('section', { class: 'mm-preview-area' });
        this.engineSelect(controls, space); const cfg = this.config(space); cfg.engine = this.state(space).engine;
        controls.append(el('h2', { text: cfg.engine === 'krea' ? 'Krea2 · img2img' : 'Qwen · instruction editing' }));
        this.sourcePicker(controls, space, null, () => this.rebuild(space)); this.presets(controls, space, cfg, refinementPresets); this.essentials(controls, cfg, space, true);
        controls.append(el('small', { text: 'Refine references, panels, or pages. Results are saved as new versions in the original category.' }), button('Refine image', () => this.action(() => this.run(space)), { class: 'mm-primary', 'data-run': space }));
        view.append(controls, preview); this.controlLayout(view, controls, space); this.comparison(preview, space);
        const gallery = el('div', { class: 'mm-result-gallery' }); preview.append(gallery);
        const source = this.project.assets.find(a => a.id === this.state(space).source);
        this.gallery(gallery, source?.kind || 'panels', space, true);
    }
    comparison(host, space) {
        host.querySelector('.mm-comparison')?.remove();
        const state = this.state(space), source = this.project.assets.find(a => a.id === state.source), result = this.project.assets.find(a => a.id === state.result);
        const shell = el('div', { class: 'mm-comparison' });
        if (!source) shell.append(el('div', { class: 'mm-empty', text: 'Select an original image from your project.' }));
        else {
            const images = el('div', { class: 'mm-compare-images' }, el('figure', {}, el('figcaption', { text: 'Original' }), el('img', { src: assetUrl(this.project.id, source.id), alt: source.name })));
            if (result) images.append(el('figure', {}, el('figcaption', { text: 'Result' }), el('img', { src: assetUrl(this.project.id, result.id), alt: result.name })));
            shell.append(images);
            if (result) {
                const slider = el('input', { type: 'range', min: 0, max: 100, value: 50, 'aria-label': 'Before and after comparison', oninput: e => overlay.style.clipPath = `inset(0 ${100 - Number(e.target.value)}% 0 0)` });
                const overlay = el('img', { src: assetUrl(this.project.id, result.id), alt: 'After', class: 'mm-compare-overlay' });
                const sliding = el('div', { class: 'mm-sliding', hidden: true }, el('img', { src: assetUrl(this.project.id, source.id), alt: 'Before' }), overlay);
                overlay.style.clipPath = 'inset(0 50% 0 0)'; shell.append(button('Split view / slider', () => { sliding.hidden = !sliding.hidden; images.hidden = !images.hidden; slider.hidden = sliding.hidden; }), sliding, slider); slider.hidden = true;
            }
        }
        host.prepend(shell);
    }
    finish(view) {
        const space = 'finish', cfg = this.config(space, 'qwen'); cfg.engine = 'qwen'; this.state(space).engine = 'qwen';
        const controls = el('aside', { class: 'mm-controls' }), preview = el('section', { class: 'mm-preview-area' }); controls.append(el('h2', { text: 'Finishing · Qwen' }));
        this.sourcePicker(controls, space, 'pages', () => { this.resolutionControls(controls, cfg, space, true); this.comparison(preview, space); });
        const mode = el('select', { 'aria-label': 'Operation', onchange: e => { cfg.finish_mode = e.target.value; analysisInput.value = analysisInstruction(cfg); this.saveSoon(); } }, el('option', { value: 'refine', text: 'Refine while preserving composition' }), el('option', { value: 'redesign', text: 'Redesign composition' })); mode.value = cfg.finish_mode;
        controls.append(field('Operation', mode));
        const analysisInput = el('textarea', { value: analysisInstruction(cfg), oninput: e => { (cfg.analysis_prompts ||= {})[cfg.finish_mode || 'refine'] = e.target.value; this.saveSoon(); } });
        const analyze = el('details', {}, el('summary', { text: 'Visual analysis · Generate Text' }));
        analyze.append(this.picker('Vision analysis encoder', options(this.defs, 'CLIPLoader', 'clip_name'), cfg.analysis_encoder, v => { cfg.analysis_encoder = v; cfg.model_overrides.analysis_encoder = v; this.saveSoon(); }),
            this.picker('Analysis encoder type', options(this.defs, 'CLIPLoader', 'type'), cfg.analysis_encoder_type, v => { cfg.analysis_encoder_type = v; cfg.model_overrides.analysis_encoder_type = v; this.saveSoon(); }),
            field('Analysis instruction', analysisInput),
            button('Restore default instruction', () => { delete cfg.analysis_prompts?.[cfg.finish_mode || 'refine']; analysisInput.value = analysisInstruction(cfg); this.saveSoon(); }),
            field('Maximum length · tokens', el('input', { type: 'number', value: cfg.max_length, min: 1, max: 32768, onchange: e => { cfg.max_length = Number(e.target.value); this.saveSoon(); } })),
            button('Analyze and propose instruction', () => this.action(() => this.run('analysis')), { 'data-run': 'analysis' }), el('small', { text: 'The proposal appears below for review. Analysis does not start finishing.' }));
        controls.append(analyze); this.presets(controls, space, cfg); this.essentials(controls, cfg, space, true);
        controls.append(button('Run finishing', () => this.action(() => this.run('finish')), { class: 'mm-primary', 'data-run': 'finish' }));
        view.append(controls, preview); this.controlLayout(view, controls, space); this.comparison(preview, space); const gallery = el('div', { class: 'mm-result-gallery' }); preview.append(gallery); this.gallery(gallery, 'pages', space, true);
    }
    assetContextMenu(card, actions) {
        actions.tabIndex = -1;
        const trigger = iconButton('Image actions', 'more', e => openMenu(e), { class: 'mm-icon-button mm-asset-trigger', 'aria-haspopup': 'menu', 'aria-controls': actions.id, 'aria-expanded': 'false' });
        const openMenu = e => {
            e.preventDefault();
            if (actions.matches(':popover-open')) { this.closeAssetMenu(); return; }
            this.closeAssetMenu(); trigger.focus({ preventScroll: true }); actions.showPopover(); this.assetMenu = actions;
            const anchor = trigger.getBoundingClientRect(), menu = actions.getBoundingClientRect();
            const x = e.type === 'contextmenu' ? e.clientX : anchor.right - menu.width;
            const y = e.type === 'contextmenu' ? e.clientY : anchor.bottom + 4;
            actions.style.left = `${Math.max(8, Math.min(x, innerWidth - menu.width - 8))}px`;
            actions.style.top = `${Math.max(8, Math.min(y, innerHeight - menu.height - 8))}px`;
            (actions.querySelector('button:not(:disabled)') || actions).focus({ preventScroll: true });
        };
        actions.addEventListener('toggle', e => { trigger.setAttribute('aria-expanded', String(e.newState === 'open')); if (e.newState === 'closed' && this.assetMenu === actions) this.assetMenu = null; });
        actions.addEventListener('keydown', e => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeAssetMenu(); trigger.focus({ preventScroll: true }); }
            if (e.key === 'Tab') this.closeAssetMenu();
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
            e.preventDefault(); const items = [...actions.querySelectorAll('button:not(:disabled)')], index = items.indexOf(document.activeElement);
            if (!items.length) return;
            items[e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
        });
        card.addEventListener('contextmenu', openMenu);
        card.append(trigger, actions);
    }
    gallery(host, kind, space, compact = false) {
        const state = this.state(space); const bar = el('div', { class: 'mm-gallery-toolbar' }), grid = el('div', { class: 'mm-gallery-grid' }), pager = el('div', { class: 'mm-row' });
        const render = () => {
            let assets = this.project.assets.filter(a => a.kind === kind && (state.filter === 'trash' ? a.deleted : !a.deleted));
            const term = (state.search || '').toLowerCase(); assets = assets.filter(a => `${a.name} ${(a.tags || []).join(' ')}`.toLowerCase().includes(term));
            if (state.filter === 'originals') assets = assets.filter(a => !a.parent);
            if (state.filter === 'versions') assets = assets.filter(a => a.parent);
            if (state.filter === 'missing') assets = assets.filter(a => a.missing);
            assets.sort(state.sort === 'name' ? (a, b) => a.name.localeCompare(b.name) : state.sort === 'oldest' ? (a, b) => a.created - b.created : state.sort === 'order' ? (a, b) => (a.order || 0) - (b.order || 0) : (a, b) => b.created - a.created);
            const totalPages = Math.max(1, Math.ceil(assets.length / 48)); state.page = Math.min(state.page || 0, totalPages - 1);
            grid.replaceChildren(...assets.slice(state.page * 48, (state.page + 1) * 48).map(a => {
                const checkbox = el('input', { type: 'checkbox', checked: state.selection.includes(a.id), 'aria-label': `Select ${a.name}`, onchange: e => {
                    state.selection = e.target.checked ? [...new Set([...state.selection, a.id])] : state.selection.filter(id => id !== a.id); this.saveSoon(); render();
                } });
                const image = el('img', { src: assetUrl(this.project.id, a.id, true), alt: a.name, loading: 'lazy', decoding: 'async', draggable: false });
                const preview = button('', () => this.preview(a)); preview.className = 'mm-thumbnail'; preview.append(image);
                const card = el('article', { class: `mm-asset ${state.selection.includes(a.id) ? 'mm-selected' : ''}`, draggable: a.kind === 'panels', ondragstart: e => { e.dataTransfer.setData('application/x-manga-asset', a.id); e.dataTransfer.effectAllowed = 'copy'; } },
                    checkbox, preview, el('strong', { text: a.name, title: a.name }), el('small', { text: `${sizeLabel(a)} · ${a.parent ? 'Version' : 'Original'} ${a.version}${a.missing ? ' · Missing file' : ''}` }));
                const actions = el('div', { id: `mm-menu-${space}-${a.id}`, class: 'mm-asset-menu', popover: 'manual', role: 'menu', 'aria-label': `Actions for ${a.name}` });
                const addAction = (label, name, action, danger = false) => actions.append(iconButton(label, name, () => { this.closeAssetMenu(); action(); }, { role: 'menuitem', class: `mm-menu-item${danger ? ' mm-danger' : ''}` }, true));
                actions.append(this.downloadImageAction(a));
                addAction('Rename', 'pencil', () => this.ask('Image name', a.name, async name => { await this.patchAssets({ [a.id]: { name } }); render(); }));
                addAction('Settings', 'info', () => this.assetSettings(a));
                if (space !== 'design') actions.append(this.referencePromptAction(a, space));
                if (a.kind === 'references') actions.append(this.describeReferenceAction(a, space));
                if (!a.deleted) {
                    if (['references', 'panels'].includes(a.kind)) addAction('Draw with Klecks', 'pencil', () => openDrawing(this, a.kind, a));
                    if (['references', 'panels'].includes(a.kind)) addAction('Edit with Krea2', 'pencil', () => {
                        this.state(a.kind).engine = 'krea_edit'; this.config(a.kind, 'krea_edit').references = [a.id];
                        this.rebuild(a.kind); this.switch(a.kind); this.saveSoon();
                    });
                    if (space === 'design') addAction('Place', 'place', () => { if (!this.editor?.panel) this.editor.addPanel(); this.editor.change(() => this.editor.panel.asset = a.id); this.editor.loadImages(); });
                    else if (space === 'refine' || space === 'finish') { addAction('Original', 'image', () => { state.source = a.id; state.result = ''; this.saveSoon(); this.rebuild(space); }); addAction('Result', 'check', () => { state.result = a.id; this.saveSoon(); this.comparison(host.parentElement, space); }); }
                    else addAction('Use as reference', 'link', () => {
                        const cfg = this.config(space);
                        if (!cfg.references.includes(a.id)) {
                            if (cfg.engine !== 'qwen' && cfg.references.length >= 4) { this.fail(new Error('Krea2 supports up to four references. Remove one before adding another.')); return; }
                            cfg.references.push(a.id); this.presetChanged(space);
                        }
                        this.saveSoon(); this.rebuild(space);
                    });
                    if (space !== 'refine') addAction('Refine', 'wand', () => { const refine = this.state('refine'); refine.source = a.id; refine.result = ''; this.rebuild('refine'); this.switch('refine'); this.saveSoon(); });
                    if (a.kind === 'pages' && space !== 'finish') addAction('Finishing', 'sparkles', () => { this.state('finish').source = a.id; this.rebuild('finish'); this.switch('finish'); this.saveSoon(); });
                }
                addAction(a.deleted ? 'Restore' : 'Delete', a.deleted ? 'restore' : 'trash', () => {
                    const update = async () => {
                        await this.patchAssets({ [a.id]: { deleted: !a.deleted } });
                        state.selection = state.selection.filter(id => id !== a.id);
                        for (const refresh of this.galleryRefresh.values()) refresh();
                    };
                    if (a.deleted) this.action(update); else this.confirm(`Delete image · ${a.name}`, update);
                }, !a.deleted);
                card.dataset.assetId = a.id; this.assetContextMenu(card, actions); return card;
            }));
            if (!assets.length) grid.append(el('div', { class: 'mm-empty', text: 'This gallery is empty. Import images or generate your first result.' }));
            pager.replaceChildren(iconButton('Previous', 'left', () => { state.page--; render(); this.saveSoon(); }, { disabled: state.page === 0 }), el('span', { text: `${state.page + 1} / ${totalPages} · ${assets.length} images · ${state.selection.length} selected` }), iconButton('Next', 'right', () => { state.page++; render(); this.saveSoon(); }, { disabled: state.page >= totalPages - 1 }));
        };
        bar.append(el('h2', { text: spaces[kind] || 'Pages' }), iconButton('Import images', 'upload', () => this.importImages(kind)),
            ['references', 'panels'].includes(kind) ? iconButton(kind === 'references' ? 'Draw reference' : 'Draw panel', 'pencil', () => openDrawing(this, kind)) : null,
            el('input', { type: 'search', placeholder: 'Search by name or tag…', value: state.search, 'aria-label': 'Search images', oninput: e => { state.search = e.target.value; state.page = 0; render(); this.saveSoon(); } }));
        for (const [key, label, values] of [['sort', 'Sort', { newest: 'Newest first', oldest: 'Oldest first', name: 'Name', order: 'Manual order' }], ['filter', 'Filter', { all: 'All', originals: 'Originals', versions: 'Versions', missing: 'Missing', trash: 'Trash' }]]) {
            const select = el('select', { 'aria-label': label, onchange: e => { state[key] = e.target.value; state.page = 0; render(); this.saveSoon(); } }, ...Object.entries(values).map(([value, text]) => el('option', { value, text }))); select.value = state[key]; bar.append(select);
        }
        const multi = el('details', {}, el('summary', { text: 'Selection actions' }),
            iconButton('Select visible', 'check', () => { state.selection = [...grid.querySelectorAll('article')].map(card => card.dataset.assetId); render(); this.saveSoon(); }),
            iconButton('Clear selection', 'clear', () => { state.selection = []; render(); this.saveSoon(); }),
            iconButton('Remove selected', 'trash', () => this.confirm('Remove selected images', async () => { await this.patchAssets(Object.fromEntries(state.selection.map(id => [id, { deleted: true }]))); state.selection = []; render(); })),
            iconButton('Restore selected', 'restore', () => this.action(async () => { await this.patchAssets(Object.fromEntries(state.selection.map(id => [id, { deleted: false }]))); render(); })),
            iconButton('Assign selection order', 'order', () => this.action(async () => { await this.patchAssets(Object.fromEntries(state.selection.map((id, i) => [id, { order: i }]))); state.sort = 'order'; render(); })),
            iconButton('Tag selected', 'tags', () => this.ask('Comma-separated tags', '', async value => { await this.patchAssets(Object.fromEntries(state.selection.map(id => [id, { tags: value.split(',').map(x => x.trim()).filter(Boolean) }]))); render(); })));
        bar.append(multi, iconButton('Collapse gallery', 'collapse', () => { grid.hidden = !grid.hidden; pager.hidden = grid.hidden; state.collapsed = grid.hidden; this.saveSoon(); }));
        grid.hidden = !!state.collapsed; pager.hidden = grid.hidden;
        host.append(bar, grid, pager); render(); this.galleryRefresh.set(space, render);
        host.addEventListener('scroll', () => { state.scroll = host.scrollTop; this.saveSoon(); }, { passive: true, signal: this.abort.signal }); host.scrollTop = state.scroll || 0;
    }
    async patchAssets(changes) {
        const id = this.project.id; const result = await request(`/projects/${id}/assets`, changes, 'PATCH');
        if (id === this.project.id) { this.project.assets = result.assets; this.referenceRefresh.forEach(refresh => refresh()); }
        this.saveSoon();
    }
    importImages(kind) {
        chooseFile('image/*', files => this.action(async () => {
            const project = this.project.id;
            for (const file of files) { const form = new FormData(); form.append('image', file); form.append('kind', kind); await request(`/projects/${project}/import`, form, 'POST'); }
            if (this.project?.id === project) { const data = await request(`/projects/${project}`); this.project.assets = data.assets; this.galleryRefresh.get(this.active)?.(); if (['refine', 'finish'].includes(this.active)) this.rebuild(this.active); }
        }), true);
    }
    preview(asset) {
        this.modal(asset.name, el('div', { class: 'mm-lightbox' }, el('img', { src: assetUrl(this.project.id, asset.id), alt: asset.name }),
            el('p', { text: `${asset.kind} · ${sizeLabel(asset)} · version ${asset.version}` }),
            el('a', { href: assetUrl(this.project.id, asset.id) + '?original=1', text: 'Download original file', download: '' })));
    }
    assetSettings(asset) {
        const info = asset.metadata?.settings;
        const content = el('div', {}, el('pre', { text: JSON.stringify(asset.metadata, null, 2) }));
        if (info && asset.metadata.operation !== 'analysis') content.append(button('Restore settings for this operation', () => {
            const operation = ['references', 'panels', 'refine', 'finish'].includes(asset.metadata.operation) ? asset.metadata.operation : this.active;
            const engine = asset.metadata.engine || info.engine; this.project.config[`${operation}:${engine}`] = { ...clone(info), random_seed: false }; this.state(operation).engine = engine;
            this.rebuild(operation); this.switch(operation); this.saveSoon();
        }));
        content.append(button('Export metadata', () => download('manga-result-settings.json', asset.metadata))); this.modal('Result settings', content);
    }
    async design(view) {
        const state = this.state('design');
        state.pages ||= [newPage()]; state.currentPage ||= state.pages[0].id;
        const controls = el('div', { class: 'mm-design-top' }), rail = el('aside', { class: 'mm-design-gallery' }), editorHost = el('section', { class: 'mm-editor' });
        state.galleryVisible ??= window.innerWidth > 650; rail.hidden = !state.galleryVisible; rail.classList.toggle('mm-gallery-open', state.galleryVisible);
        controls.append(iconButton('Gallery', 'image', () => { state.galleryVisible = !state.galleryVisible; rail.hidden = !state.galleryVisible; rail.classList.toggle('mm-gallery-open', state.galleryVisible); this.saveSoon(); }));
        const pageSelect = el('select', { 'aria-label': 'Active layout', onchange: e => { state.currentPage = e.target.value; this.saveSoon(); this.editor?.destroy(); this.editor = new PageEditor(this, editorHost, state.pages.find(p => p.id === state.currentPage)); } });
        const update = () => { pageSelect.replaceChildren(...state.pages.map(p => el('option', { value: p.id, text: p.name }))); pageSelect.value = state.currentPage; };
        update(); controls.append(pageSelect, iconButton('New page', 'plus', () => { const page = newPage(); page.name = `Page ${state.pages.length + 1}`; state.pages.push(page); state.currentPage = page.id; update(); pageSelect.onchange({ target: pageSelect }); }),
            iconButton('Duplicate page', 'copy', () => { const page = clone(this.editor.page); page.id = uuid(); page.name += ' · copy'; state.pages.push(page); state.currentPage = page.id; update(); pageSelect.onchange({ target: pageSelect }); }),
            iconButton('Delete layout', 'trash', () => this.confirm('Delete page layout', () => { const removed = state.pages.find(p => p.id === state.currentPage); (state.deletedPages ||= []).push(removed); state.pages = state.pages.filter(p => p.id !== state.currentPage); if (!state.pages.length) state.pages.push(newPage()); state.currentPage = state.pages[0].id; update(); pageSelect.onchange({ target: pageSelect }); })),
            iconButton('Restore deleted layout', 'restore', () => { const page = state.deletedPages?.pop(); if (page) { state.pages.push(page); state.currentPage = page.id; update(); pageSelect.onchange({ target: pageSelect }); } }),
            iconButton('Save layout preset', 'save', () => this.ask('Layout name', this.editor.page.name, name => { this.project.layouts[name] = clone(this.editor.page); this.saveSoon(); fillPresets(); })),
            iconButton('Export layout', 'download', () => download('manga-layout.json', this.editor.page)), iconButton('Import layout', 'upload', () => chooseFile('.json', files => this.action(async () => {
                const layout = JSON.parse(await files[0].text()); this.validateLayout(layout);
                this.confirm('Replace the geometry of this page', () => { this.editor.change(() => { Object.assign(this.editor.page, normalizePage(layout), { id: this.editor.page.id }); }); this.editor.loadImages(); this.editor.fit(); });
            }))), button('Export composition to pages/', () => this.action(async () => {
                const project = this.project.id, editor = this.editor; const page = clone(editor.page); const blob = await editor.export();
                const form = new FormData(); form.append('image', blob, `${page.name}.png`); form.append('kind', 'pages'); form.append('name', page.name);
                form.append('sources', JSON.stringify(page.panels.map(p => p.asset).filter(Boolean))); form.append('metadata', JSON.stringify({ operation: 'composition', layout: page }));
                const prior = this.project.assets.filter(a => a.metadata?.layout?.id === page.id && !a.deleted).sort((a, b) => b.created - a.created)[0]; if (prior) form.append('parent', prior.id);
                const asset = await request(`/projects/${project}/import`, form, 'POST');
                if (this.project.id === project) { this.project.assets.push(asset); this.state('finish').source = asset.id; this.rebuild('finish'); }
                this.status.textContent = `Composition saved: ${page.name}`;
            }), { class: 'mm-primary' }));
        const presets = el('select', { 'aria-label': 'Layout presets', onchange: e => {
            const layout = this.project.layouts[e.target.value]; cloneLayout.disabled = !layout; if (!layout) return;
            this.confirm('Apply layout and replace panels', () => this.editor.applyPreset(layout));
        } });
        const fillPresets = () => { presets.replaceChildren(el('option', { value: '', text: 'Free layout / presets…' }), ...Object.keys(this.project.layouts).map(name => el('option', { value: name, text: name }))); cloneLayout.disabled = true; };
        const cloneLayout = iconButton('Clone layout preset', 'copy', () => this.clonePreset(this.project.layouts, presets.value, (name, layout) => {
            layout.name = name; this.project.layouts[name] = layout; fillPresets(); presets.value = name; cloneLayout.disabled = false;
        }), { disabled: true });
        fillPresets(); controls.append(presets, cloneLayout, iconButton('Import PanelComposer presets', 'upload', () => this.action(async () => {
            const response = await api.fetchApi('/panelcomposer/all_layouts'); if (!response.ok) throw new Error('PanelComposer is unavailable; use free layout or import a JSON layout.');
            const data = await response.json(); for (const [key, layout] of Object.entries(data)) { this.validateLayout(layout); this.project.layouts[`PanelComposer · ${layout.label || key}`] = clone(layout); }
            this.saveSoon(); fillPresets();
        })));
        view.append(controls, el('div', { class: 'mm-design-body' }, rail, editorHost)); this.gallery(rail, 'panels', 'design');
        this.editor = new PageEditor(this, editorHost, state.pages.find(p => p.id === state.currentPage) || state.pages[0]); this.saveSoon();
    }
    validateLayout(layout) {
        if (!Array.isArray(layout.panels) || layout.panels.some(p => !Array.isArray(p.polygon) || p.polygon.length < 3 || p.polygon.some(pt => !Array.isArray(pt) || pt.length !== 2 || !pt.every(Number.isFinite)))) throw new Error('Invalid layout: polygons must have finite coordinates.');
    }
    async run(operation, space = operation === 'analysis' ? 'finish' : operation, assetId = null, section = null, dialogue = null) {
        const textTask = operation in textTasks;
        const project = this.project, state = this.state(space), engine = textTask ? 'text' : operation === 'analysis' ? 'qwen' : state.engine;
        const key = `${project.id}:${operation}`; if (this.busy.has(key)) return;
        this.busy.add(key); this.jobs(); this.error.hidden = true;
        let jobId;
        try {
            const cfg = textTask ? { ...textGeneratorDefaults, ...clone(this.settings.text_generator || {}) } : clone(this.config(space, engine)); cfg.engine = engine;
            if (dialogue) {
                if (!dialogue.text.trim()) throw new Error('Enter dialogue text before enhancing it.');
                cfg.instruction = `Improve this manga dialogue or thought text for clarity, natural phrasing and concision. Preserve its original language, meaning, speaker voice, names and tone. Do not invent story details or turn it into an image prompt. Return only the improved dialogue, without tags, quotation marks, markdown fences or explanations.\n\nText to improve:\n${dialogue.text}`;
            } else if (textTask) cfg.instruction = textInstruction(operation, this.config(space), section);
            if (cfg.random_seed) cfg.seed = Math.floor(Math.random() * 2 ** 48);
            let ids = textTask ? operation === 'describe' ? [assetId] : [] : ['refine', 'finish', 'analysis'].includes(operation) ? [state.source].filter(Boolean) : cfg.references;
            if (['refine', 'finish', 'analysis'].includes(operation) && !ids.length) throw new Error('Select the original.');
            const unavailable = ids.find(id => !project.assets.some(a => a.id === id && !a.missing && !a.deleted));
            if (unavailable) {
                const asset = project.assets.find(a => a.id === unavailable);
                throw new Error(asset?.deleted ? `Selected image "${asset.name}" is in Trash. Restore it or remove it from the connected references.`
                    : `Selected image "${asset?.name || unavailable}" is missing. Reimport it and select it again, or remove it from the connected references.`);
            }
            delete cfg.latent_reference_index;
            if (engine === 'krea_edit' && cfg.latent_reference) {
                cfg.latent_reference_index = ids.indexOf(cfg.latent_reference);
                if (cfg.latent_reference_index < 0) throw new Error('Choose a connected reference as the initial latent image.');
            }
            if (!textTask && ids.length && cfg.size_mode !== 'manual') {
                Object.assign(cfg, sizeSettings(project.assets.find(a => a.id === (cfg.latent_reference_index != null ? ids[cfg.latent_reference_index] : ids[0]))), { size_mode: 'original' });
            }
            const paths = await request(`/projects/${project.id}/stage`, { assets: ids }, 'POST');
            jobId = uuid(); const built = buildPrompt(this.defs, operation, engine, cfg, paths, jobId);
            const kind = textTask ? 'references' : operation === 'refine' ? project.assets.find(a => a.id === ids[0]).kind : operation === 'references' ? 'references' : ['finish', 'analysis'].includes(operation) ? 'pages' : 'panels';
            const job = { id: jobId, operation, engine, kind, settings: cfg, prompt: built.graph, output_node: built.outputNode,
                parent: ['refine', 'finish'].includes(operation) || (engine === 'krea_edit' && project.assets.find(a => a.id === ids[0]).kind === kind) ? ids[0] : null, sources: ids,
                ...(textTask ? { space, target_engine: state.engine, section } : {}),
                ...(dialogue ? { dialogue_target: { page: dialogue.page, bubble: dialogue.bubble } } : {}),
                name: `${spaces[space]} · ${new Date().toLocaleString('en-US')}` };
            await this.flush();
            const registered = await request(`/projects/${project.id}/jobs`, job, 'POST'); project.jobs.push(registered);
            const response = await api.fetchApi('/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
                prompt_id: jobId, client_id: api.clientId, prompt: built.graph,
                extra_data: { manga_maker: { project: project.id, operation, job: jobId } },
            }) });
            const result = await response.json();
            if (!response.ok) throw new Error(JSON.stringify(result.node_errors || result.error || result));
            if (result.prompt_id !== jobId) throw new Error('The server did not preserve the execution identifier.');
            registered.state = 'queued'; this.jobs();
        } catch (error) {
            if (jobId && project.jobs.some(j => j.id === jobId)) { await request(`/projects/${project.id}/jobs/${jobId}`, { error: error.message }, 'PATCH'); const job = project.jobs.find(j => j.id === jobId); job.state = 'error'; job.error = error.message; }
            throw new Error(`${textTasks[operation] || spaces[space]} · ${engine}: ${error.message}`);
        } finally { this.busy.delete(key); this.jobs(); }
    }
    textResult(job) {
        const result = el('textarea', { value: job.text || '', 'aria-label': 'Generator proposal', class: 'mm-prompt-preview' });
        const error = el('small', { role: 'alert' });
        const dialog = this.modal(job.dialogue_target ? 'Enhance dialogue' : textTasks[job.operation], el('div', {},
            el('p', { text: job.operation === 'enhance' ? `Proposal for ${job.section === 'free' ? 'Free prompt' : job.section}. Only that field will be replaced.` : 'Prompt created from the reference. Review it before applying.' }), result, error,
            button('Apply proposal', () => {
                if (job.dialogue_target) {
                    const page = this.project.workspace.design.pages.find(p => p.id === job.dialogue_target.page);
                    const bubble = page?.bubbles.find(b => b.id === job.dialogue_target.bubble);
                    if (!bubble) { error.textContent = 'The original dialogue box has been deleted.'; return; }
                    if (this.editor?.page === page) this.editor.change(() => bubble.text = result.value);
                    else { bubble.text = result.value; this.saveSoon(); }
                    dialog.close(); return;
                }
                const cfg = this.config(job.space, job.target_engine);
                if (job.operation === 'enhance') {
                    if (job.section === 'free') cfg.prompt = result.value;
                    else (cfg.prompt_sections ||= {})[job.section] = result.value;
                } else {
                    const parsed = parsePrompt(result.value);
                    if (!parsed) { error.textContent = 'The text contains no recognized sections. Edit it before applying.'; return; }
                    Object.assign(cfg, parsed);
                }
                this.presetChanged(job.space); this.rebuild(job.space); dialog.close();
            }, { class: 'mm-primary' })));
    }
    event(name, detail) {
        if (name === 'manga_maker_error' && detail.project === this.project?.id) this.fail(new Error(detail.error));
        if (name === 'execution_start') this.executing = detail.prompt_id;
        if (name === 'progress') { const id = detail.prompt_id || this.executing; if (id) this.progress.set(id, `${detail.value} / ${detail.max}`); }
        if (['execution_error', 'execution_interrupted', 'execution_success'].includes(name)) this.poll();
        this.jobs();
    }
    async poll() {
        await this.pollDownloads();
        if (!this.project || this.polling || this.abort.signal.aborted) return;
        const project = this.project; this.polling = true;
        try {
            const data = await request(`/projects/${project.id}`);
            if (this.project !== project || this.abort.signal.aborted) return;
            const added = JSON.stringify(data.assets.map(a => [a.id,a.missing,a.deleted,a.name,a.metadata?.description_prompt])) !== JSON.stringify(project.assets.map(a => [a.id,a.missing,a.deleted,a.name,a.metadata?.description_prompt]));
            for (const job of data.jobs) {
                const prior = project.jobs.find(j => j.id === job.id);
                if (job.state === 'error' && prior?.state !== 'error') this.fail(new Error(`${textTasks[job.operation] || (job.operation === 'sketch' ? 'Sketch to Art' : job.operation === 'manga' ? 'Art to Manga Panel' : spaces[job.operation === 'analysis' ? 'finish' : job.operation])} · ${job.engine}: ${typeof job.error === 'string' ? job.error : JSON.stringify(job.error)}`));
                if (job.state === 'complete' && prior?.state !== 'complete') {
                    const space = job.operation === 'analysis' ? 'finish' : job.operation;
                    if (job.operation in textTasks) this.textResult(job);
                    else if (job.operation === 'analysis') { this.config('finish', 'qwen').prompt = job.text || ''; this.rebuild('finish'); }
                    else if (['refine', 'finish'].includes(space) && job.results?.length) this.state(space).result = job.results[0];
                    this.saveSoon();
                }
            }
            project.jobs = data.jobs; project.assets = data.assets;
            if (added) {
                this.referenceRefresh.forEach(refresh => refresh());
                this.galleryRefresh.forEach(refresh => refresh());
                for (const space of ['refine', 'finish']) { const view = this.views.get(space); if (view) this.comparison(view.querySelector('.mm-preview-area'), space); }
            }
            this.jobs();
        } catch (e) { this.fail(e); } finally { this.polling = false; }
    }
    async cancelJob(job, projectId) {
        const key = `cancel:${projectId}:${job.id}`;
        if (this.busy.has(key) || job.cancel_requested) return;
        this.busy.add(key); this.jobs();
        try {
            for (const [path, body] of [['/queue', { delete: [job.id] }], ['/interrupt', { prompt_id: job.id }]]) {
                const response = await api.fetchApi(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
                if (!response.ok) throw new Error('Could not cancel generation. Please try again.');
            }
            const updated = await request(`/projects/${projectId}/jobs/${job.id}`, { cancel_requested: true }, 'PATCH');
            Object.assign(job, updated);
            if (this.project?.id === projectId) await this.poll();
        } finally { this.busy.delete(key); this.jobs(); }
    }
    jobs() {
        if (!this.project) return;
        const relevant = this.project.jobs.filter(j => (j.space || (j.operation === 'analysis' ? 'finish' : j.operation)) === this.active);
        const active = relevant.filter(j => ['registered', 'queued', 'running'].includes(j.state));
        const labels = { registered: 'Preparing', queued: 'Queued', running: 'Running', complete: 'Completed', error: 'Error', cancelled: 'Cancelled' };
        this.status.replaceChildren(el('span', { text: `${this.project.name} · ${spaces[this.active]} · ${active.length} active jobs` }),
            ...[...active, ...relevant.filter(j => !active.includes(j)).slice(-4)].map(j => el('div', { class: 'mm-job', role: 'group', 'aria-label': j.name }, button(`${j.cancel_requested && active.includes(j) ? 'Cancelling' : labels[j.state]} · ${j.engine}${j.state === 'running' && this.progress.has(j.id) ? ` · ${this.progress.get(j.id)}` : ''}`, () => {
                if (j.operation in textTasks && j.state === 'complete') { this.textResult(j); return; }
                const details = el('div', {}, el('p', { text: `${j.name} · ${j.id}` }), el('pre', { text: j.error ? JSON.stringify(j.error, null, 2) : j.text || JSON.stringify(j.settings, null, 2) }));
                if (['queued', 'running'].includes(j.state)) details.append(button('Cancel generation', () => this.action(() => this.cancelJob(j, this.project.id)), { disabled: !!j.cancel_requested }));
                this.modal('Operation', details);
            }), ['queued', 'running'].includes(j.state) ? iconButton(`Cancel generation ${j.id}`, 'clear', () => this.action(() => this.cancelJob(j, this.project.id)),
                { 'data-cancel-job': j.id, title: j.state === 'running' ? 'Cancel running generation' : 'Cancel queued generation', disabled: !!j.cancel_requested || this.busy.has(`cancel:${this.project.id}:${j.id}`) }) : null)));
        for (const b of this.dialog.querySelectorAll('[data-run]')) b.disabled = this.busy.has(`${this.project.id}:${b.dataset.run}`)
            || (['references', 'panels'].includes(b.dataset.run) && this.state(b.dataset.run).engine === 'krea_edit' && (this.config(b.dataset.run).references.length < 1 || this.config(b.dataset.run).references.length > 4))
            || (b.dataset.run in textTasks && (!this.textGeneratorAvailable() || this.project.jobs.some(j => j.operation === b.dataset.run && ['registered', 'queued', 'running'].includes(j.state))))
            || (b.dataset.run === 'describe' && !this.project.assets.some(a => a.id === b.dataset.textSource && !a.deleted && !a.missing));
    }
}
