import { api } from '../../scripts/api.js';
import { el, button, iconButton, field, assetUrl, request } from './client.js';
import { slider, toggle } from './controls.js';
import { actions, modules, systemPrompt, readable } from './story-data.js';

const usable = (project, ids) => ids.filter(id => project.assets.some(a => a.id === id && !a.deleted && !a.missing));

// Settings section for the Story assistant; `value` is the global settings draft.
export async function assistantSettings(host, value, fail) {
    const state = await request('/assistant');
    const cfg = value.assistant = { ...state.defaults, ...value.assistant };
    const render = () => {
        const model = state.models.find(m => m.name === cfg.model);
        const select = (label, items, current, change, empty) => field(label, el('select', { onchange: e => { change(e.target.value); render(); } },
            el('option', { value: '', text: empty }), ...items.map(([value, text]) => el('option', { value, text, selected: value === current }))));
        const number = (label, key, range, attrs = {}, help = '') => slider(label, el('input', { type: 'number', value: cfg[key], ...attrs, onchange: e => { if (Number.isFinite(Number(e.target.value))) cfg[key] = Number(e.target.value); } }), range, help);
        host.replaceChildren(
            state.available ? null : el('p', { class: 'mm-warning', text: 'llama-cpp-python is not installed in ComfyUI\'s Python environment. Install it to use the Story assistant.' }),
            el('small', { text: 'Local GGUF language models from models/LLM. Before each answer, ComfyUI models are unloaded; the assistant runs in its own process so its memory is released when it ends.' }),
            select('Language model', state.models.map(m => [m.name, `${m.label} · ${m.name}${m.context_length ? ` · ${m.context_length} ctx` : ''}`]), cfg.model, v => { cfg.model = v; if (!state.models.find(m => m.name === v)?.projectors.includes(cfg.projector)) cfg.projector = ''; }, state.models.length ? 'Select a GGUF model…' : 'No GGUF models found in models/LLM'),
            toggle('Vision · read reference images and pages', el('input', { type: 'checkbox', checked: cfg.vision, onchange: e => { cfg.vision = e.target.checked; render(); } })),
            cfg.vision ? select('Vision projector (mmproj)', (model?.projectors || []).map(name => [name, name]), cfg.projector, v => cfg.projector = v, model?.projectors.length ? 'Text only' : 'No compatible projector') : null,
            toggle('Keep model loaded', el('input', { type: 'checkbox', checked: cfg.keep_loaded, onchange: e => { cfg.keep_loaded = e.target.checked; } }),
                'Off: memory is released after every message. On: the model stays loaded between messages and is released automatically before any ComfyUI workflow runs.'),
            number('Context · tokens', 'n_ctx', [2048, 65536], { min: 512, step: 512 }, 'Conversation history, story context and the answer must fit in this window.'),
            number('GPU layers', 'n_gpu_layers', [-1, 128], { min: -1, step: 1 }, '-1 offloads every layer to the GPU; 0 runs on the CPU.'),
            number('Temperature', 'temperature', [0, 2], { min: 0, step: 0.05 }), number('Maximum answer · tokens', 'max_tokens', [128, 8192], { min: 16, step: 64 }),
            model?.thinking ? toggle('Thinking', el('input', { type: 'checkbox', checked: cfg.thinking, onchange: e => { cfg.thinking = e.target.checked; } }), 'Structured proposals always disable thinking.') : null,
            state.loaded ? button('Release loaded model', async () => { try { await request('/assistant/release', {}, 'POST'); state.loaded = false; render(); } catch (error) { fail(error); } }) : null,
            ...state.errors.map(error => el('small', { class: 'mm-warning', text: error })));
    };
    render();
}

export class Assistant {
    constructor(view, host) {
        this.view = view; this.studio = view.studio; this.host = host; this.chats = {}; this.drafts = {}; this.attachments = {}; this.applied = new Map(); this.pending = null;
        this.load().catch(error => this.studio.fail(error));
    }
    get project() { return this.studio.project; }
    get config() { return this.studio.settings.assistant || {}; }
    get vision() {
        const model = this.state?.models.find(m => m.name === this.config.model);
        return !!(this.config.vision ?? true) && !!this.config.projector && !!model?.projectors.includes(this.config.projector);
    }
    async load() {
        const project = this.project.id;
        const [chats, state] = await Promise.all([request(`/projects/${project}/assistant`), request('/assistant')]);
        if (project !== this.project?.id) return;
        this.chats = chats; this.state = state; this.render();
    }
    destroy() { this.controller?.abort(); }
    reason(action) {
        if (!this.state?.available) return 'Install llama-cpp-python to use the assistant.';
        if (!this.state.models.some(m => m.name === this.config.model)) return 'Select a GGUF language model in Settings.';
        if (action?.target && !this.view.ui[action.target]) return `Select a ${action.target} first.`;
        if (action?.vision && !this.vision) return 'Enable vision and select a compatible projector in Settings.';
        if (action?.vision && !usable(this.project, action.images(this.view.story, this.view.ui[action.target])).length) return 'Link reference images to this character first.';
        return '';
    }
    render() {
        const module = this.view.module, messages = this.chats[module] || [], busy = !!this.pending;
        const header = el('header', { class: 'mm-assistant-header' }, el('h2', { text: `Assistant · ${modules[module]}` }),
            this.state?.loaded ? iconButton('Release loaded model', 'restore', () => this.release(), { disabled: busy, title: 'The model is kept loaded. Release its memory now.' }) : null,
            iconButton('Clear conversation', 'trash', () => this.clear(module), { disabled: busy || !messages.length }));
        const quick = el('div', { class: 'mm-assistant-actions' }, ...Object.entries(actions).filter(([, a]) => a.module === module).map(([kind, action]) => {
            const reason = this.reason(action);
            return button(action.label, () => this.run(kind), { disabled: busy || !!reason, title: reason || action.label });
        }));
        this.list = el('div', { class: 'mm-assistant-messages', 'aria-live': 'polite' }, ...messages.map(m => this.message(m)));
        if (!messages.length && !busy) this.list.append(el('p', { class: 'mm-assistant-empty', text: this.reason() || 'Ask about this module or use a quick action. Proposals appear here for review before they change your story.' }));
        if (busy && this.pending.module === module) {
            this.streamText = el('div', { class: 'mm-message-text', text: this.pending.answer });
            this.streamStatus = el('small', { text: [this.pending.status, this.pending.context].filter(Boolean).join(' · ') });
            this.list.append(this.message({ role: 'user', text: this.pending.text, images: this.pending.images }), el('article', { class: 'mm-message mm-message-assistant mm-message-pending' }, this.streamStatus, this.streamText));
        }
        const input = el('textarea', { value: this.drafts[module] || '', rows: 3, placeholder: 'Ask the assistant… Enter sends, Shift+Enter adds a line', 'aria-label': 'Message to the assistant',
            oninput: e => this.drafts[module] = e.target.value,
            onkeydown: e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.chat(); } } });
        const attached = this.attachments[module] ||= [];
        const composer = el('div', { class: 'mm-assistant-composer' },
            attached.length ? el('div', { class: 'mm-assistant-attachments' }, ...attached.map(id => el('div', {}, el('img', { src: assetUrl(this.project.id, id, true), alt: '' }),
                iconButton('Remove image', 'clear', () => { attached.splice(attached.indexOf(id), 1); this.render(); })))) : null,
            input, el('div', { class: 'mm-row' }, iconButton('Attach project images', 'image', () => this.attach(module), { disabled: busy || !this.vision, title: this.vision ? 'Attach project images' : 'Enable vision in Settings to attach images' }),
                busy ? button('Stop', () => this.cancel(), { class: 'mm-danger' }) : button('Send', () => this.chat(), { class: 'mm-primary', disabled: !!this.reason() })));
        this.host.replaceChildren(header, quick, this.list, composer);
        this.list.scrollTop = this.list.scrollHeight;
    }
    message(m) {
        const node = el('article', { class: `mm-message mm-message-${m.role}` });
        if (m.images?.length) node.append(el('div', { class: 'mm-assistant-attachments' }, ...m.images.map(id => el('img', { src: assetUrl(this.project.id, id, true), alt: '' }))));
        if (m.role === 'assistant' && m.action && actions[m.action.kind]) return this.proposal(node, m);
        node.append(el('div', { class: 'mm-message-text', text: m.text }));
        if (m.role === 'assistant') node.append(el('div', { class: 'mm-row' }, iconButton('Copy', 'copy', () => navigator.clipboard.writeText(m.text))));
        return node;
    }
    proposal(node, m) {
        const action = actions[m.action.kind];
        let data;
        try { data = JSON.parse(m.text); } catch { node.append(el('strong', { text: action.label }), el('div', { class: 'mm-message-text', text: m.text }), el('small', { class: 'mm-warning', text: 'The answer is not valid JSON and cannot be applied.' })); return node; }
        const applied = this.applied.has(m.id);
        const apply = button('Apply to story', () => {
            const before = structuredClone(this.view.story);
            try { action.apply(this.view.story, data, m.action.target); } catch (error) { this.studio.fail(error); return; }
            this.applied.set(m.id, before); this.view.changed(); this.view.render();
        }, { class: 'mm-primary', hidden: applied });
        const undo = button('Undo', () => {
            const story = this.view.story; for (const key of Object.keys(story)) delete story[key]; Object.assign(story, this.applied.get(m.id));
            this.applied.delete(m.id); this.view.changed(); this.view.render();
        }, { hidden: !applied });
        node.classList.add('mm-proposal');
        node.append(el('strong', { text: action.label }), el('pre', { class: 'mm-message-text', text: readable(data) }), el('div', { class: 'mm-row' }, apply, undo,
            iconButton('Copy JSON', 'copy', () => navigator.clipboard.writeText(JSON.stringify(data, null, 2)))));
        return node;
    }
    attach(module) {
        const attached = this.attachments[module];
        const picker = el('div', { class: 'mm-asset-picker' }, ...this.project.assets.filter(a => !a.deleted && !a.missing).map(a => this.studio.assetPickerItem(a, () => {
            if (!attached.includes(a.id)) attached.push(a.id);
            this.render();
        })));
        this.studio.modal('Attach images to the message', picker);
    }
    chat() {
        const module = this.view.module, text = (this.drafts[module] || '').trim();
        if (!text || this.pending) return;
        this.send({ text, prompt: text, images: [...this.attachments[module]] }, () => { this.drafts[module] = ''; this.attachments[module] = []; });
    }
    run(kind) {
        const action = actions[kind], target = action.target ? this.view.ui[action.target] : null;
        try {
            this.send({ text: action.label, prompt: action.prompt(this.view.story, target), schema: action.schema, action: { kind, target },
                images: action.vision ? usable(this.project, action.images(this.view.story, target)) : [] });
        } catch (error) { this.studio.fail(error); }
    }
    async send(body, sent = () => {}) {
        const project = this.project.id, module = this.view.module;
        this.pending = { module, text: body.text, images: body.images, answer: '', status: 'Starting…', context: '' };
        this.controller = new AbortController(); this.render();
        try {
            await this.studio.flush();
            const response = await api.fetchApi(`/manga-maker/projects/${project}/assistant`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: this.controller.signal,
                body: JSON.stringify({ module, system: systemPrompt(this.view.story, module, this.view.ui), ...body }) });
            if (!response.ok) { let data = {}; try { data = await response.json(); } catch {} throw new Error(data.error || `Server: ${response.status}`); }
            const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
            let buffer = '';
            for (;;) {
                const { value, done } = await reader.read();
                if (done) { if (!this.pending.finished) throw new Error('The assistant stopped without an answer. Try again.'); break; }
                buffer += value;
                for (let end; (end = buffer.indexOf('\n')) >= 0; buffer = buffer.slice(end + 1)) if (buffer.slice(0, end).trim()) this.event(JSON.parse(buffer.slice(0, end)), project, module, sent);
            }
        } catch (error) {
            if (error.name !== 'AbortError') this.studio.fail(new Error(`Assistant: ${error.message}`));
        } finally {
            this.pending = null; this.controller = null;
            if (this.project?.id === project) this.render();
        }
    }
    event(event, project, module, sent) {
        const pending = this.pending;
        if (event.type === 'status') pending.status = event.message;
        else if (event.type === 'context') pending.context = `${event.input_tokens} / ${event.context_size} tokens`;
        else if (event.type === 'loaded') this.state.loaded = true;
        else if (event.type === 'delta') { pending.answer += event.text; if (this.streamText?.isConnected) { this.streamText.textContent = pending.answer; this.list.scrollTop = this.list.scrollHeight; } return; }
        else if (event.type === 'cancelled') { pending.finished = true; this.studio.notify('Assistant cancelled · memory released'); }
        else if (event.type === 'complete') { pending.finished = true; this.state.loaded = event.loaded; if (this.project?.id === project) (this.chats[module] ||= []).push(...event.messages); sent(); }
        else if (event.type === 'error') { this.state.loaded = event.loaded; throw new Error(event.message); }
        if (this.streamStatus?.isConnected) this.streamStatus.textContent = [pending.status, pending.context].filter(Boolean).join(' · ');
    }
    async cancel() {
        try { await request('/assistant/cancel', {}, 'POST'); } catch (error) { this.controller?.abort(); this.studio.fail(error); }
    }
    async release() {
        try { await request('/assistant/release', {}, 'POST'); this.state.loaded = false; this.render(); } catch (error) { this.studio.fail(error); }
    }
    clear(module) {
        const dialog = this.studio.modal('Clear conversation', el('p', { text: `Remove the ${modules[module]} conversation? Your story content is not changed.` }),
            button('Cancel', () => dialog.close()), button('Clear', async () => {
                try { this.chats = await request(`/projects/${this.project.id}/assistant/${module}`, undefined, 'DELETE'); dialog.close(); this.render(); } catch (error) { this.studio.fail(error); }
            }, { class: 'mm-danger' }));
    }
}
