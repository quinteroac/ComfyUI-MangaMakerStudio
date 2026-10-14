import { api } from '../../scripts/api.js';
import { el, button, field, request, uuid } from './client.js';
import { buildPrompt, options } from './prompts.js';
import { inheritModels } from './models.js';

export function sketchControls(studio, kind, project, send, busyChanged) {
    const scope = `sketch_${kind}`; const existing = studio.project.config[`${scope}:krea_edit`];
    const cfg = studio.config(scope, 'krea_edit'); cfg.engine = 'krea_edit';
    if (!existing) {
        Object.assign(cfg.model_overrides, { steps: 1, cfg: 1, sampler: 'euler', scheduler: 'simple', shift: 1.15, grounding_px: 0 });
        Object.assign(cfg, { denoise: 0.3, seed: 0, random_seed: false, region_mode: 'canvas', feather: 16, blend_opacity: 100 });
        const sourcePrompt = studio.config(kind);
        cfg.prompt = sourcePrompt.prompt || '';
        cfg.prompt_sections = { ...structuredClone(sourcePrompt.prompt_sections || {}), task: 'IMAGE_EDIT' };
        cfg.prompt_sections.composition ||= 'Preserve the sketch composition, pose, proportions and intended shapes.';
        cfg.prompt_sections.style ||= kind === 'references' ? 'Neutral full-color illustration with clean details and consistent rendering.' : 'Finished manga illustration with clean, expressive linework and consistent shading.';
        const installed = options(studio.defs, 'LoraLoaderModelOnly', 'lora_name');
        cfg.loras = ['krea2/krea2_turbo_2step_rank_64_lora_comfyui.safetensors', 'krea2/sketch_krea_2_identity_edit_r64_512_continue_8000.safetensors'].map(name => ({
            name: installed.find(path => path.split('/').at(-1) === name.split('/').at(-1)) || name, enabled: true, model: 1, clip: 0,
        }));
        inheritModels(cfg, studio.settings.models.krea_edit, 'krea_edit'); studio.saveSoon();
    }
    let ready = false, disposed = false, revision = 0, active = null, job = null, pending = false, stopping = false, polling = false;
    let dimensions, previewImage, drag; const layerName = `Sketch to Art · ${uuid().slice(0, 8)}`;
    const status = el('small', { role: 'status', text: 'Generate the canvas or a selected region as a new AI layer.' });
    const canvas = el('canvas', { class: 'mm-sketch-preview', width: 320, height: 200, 'aria-label': 'Sketch region preview', 'aria-describedby': 'mm-sketch-region-help', tabIndex: 0 });
    const realtime = el('input', { type: 'checkbox', 'aria-label': 'Realtime on stroke release', onchange: () => {
        pending = false; status.textContent = realtime.checked ? 'Realtime enabled · Generate after releasing a stroke.' : 'Realtime paused.';
    } });
    const changed = () => { revision++; studio.presetChanged(scope, element); };
    const generate = button('Generate Sketch to Art', () => start(), { class: 'mm-primary', disabled: true });
    const cancel = button('Cancel generation', () => stop(), { disabled: true });
    const preview = button('Update region preview', () => { if (!active) send('manga-drawing-snapshot', { token: 'preview' }); }, { disabled: true });
    const regionMode = el('select', { 'aria-label': 'Drawing area', onchange: event => { cfg.region_mode = event.target.value; changed(); paintPreview(); } },
        el('option', { value: 'canvas', text: 'Whole canvas' }), el('option', { value: 'region', text: 'Selected region' })); regionMode.value = cfg.region_mode || 'canvas';
    const coordinates = el('div', { class: 'mm-sketch-coordinates' }); const inputs = {};
    for (const [key, label] of [['x', 'X'], ['y', 'Y'], ['width', 'Region width'], ['height', 'Region height']]) {
        inputs[key] = el('input', { type: 'number', 'aria-label': label, step: 1, value: cfg.region?.[key] ?? 0, onchange: () => {
            cfg.region ||= {}; cfg.region[key] = Number(inputs[key].value); changed(); paintPreview();
        } }); coordinates.append(field(label, inputs[key]));
    }
    const presets = el('div', { class: 'mm-row' });
    const blend = el('details');
    const prompt = el('details');
    const sampling = el('div');
    const models = el('div');
    const renderModels = () => { models.replaceChildren(); studio.modelControls(models, cfg, 'krea_edit', changed, false, 'sketch', renderModels); };
    function renderSettings() {
        presets.replaceChildren(); studio.presets(presets, scope, cfg, {}, () => { revision++; renderSettings(); paintPreview(); });
        regionMode.value = cfg.region_mode || 'canvas';
        for (const key of Object.keys(inputs)) inputs[key].value = cfg.region?.[key] ?? 0;
        blend.replaceChildren(el('summary', { text: 'Layer blending' }));
        for (const [key, label] of [['feather', 'Edge feather · px'], ['blend_opacity', 'Blend opacity · %']]) blend.append(field(label,
            el('input', { type: 'number', 'aria-label': label, value: cfg[key] ?? (key === 'feather' ? 16 : 100), step: 1, onchange: event => { cfg[key] = Number(event.target.value); changed(); } })));
        prompt.replaceChildren(el('summary', { text: 'Prompt' })); studio.promptControls(prompt, cfg, changed, true);
        sampling.replaceChildren(); studio.samplingControls(sampling, cfg, 'krea_edit', changed, 'sketch');
        sampling.append(field('Seed', el('input', { type: 'number', 'aria-label': 'Sketch seed', value: cfg.seed, step: 1, onchange: event => { cfg.seed = Number(event.target.value); changed(); } })),
            field('Random seed', el('input', { type: 'checkbox', checked: cfg.random_seed, onchange: event => { cfg.random_seed = event.target.checked; changed(); } })));
        renderModels();
    }
    const element = el('aside', { class: 'mm-sketch-controls', 'aria-label': 'Sketch to Art controls' }, el('h3', { text: 'Sketch to Art' }), presets,
        field('Drawing area', regionMode), el('small', { id: 'mm-sketch-region-help', text: 'Drag with the left mouse button on the preview to select the generation region. Choose Whole canvas to reset.' }), canvas, coordinates, preview, blend, prompt, sampling, models,
        field('Realtime on stroke release', realtime), el('div', { class: 'mm-toolbar' }, generate, cancel), status);
    renderSettings();
    function update() { generate.disabled = !ready || !!active; preview.disabled = !ready || !!active; cancel.disabled = !active || stopping; busyChanged(); }
    function region() {
        if (!dimensions) throw new Error('Update the canvas preview before selecting a region.');
        if (cfg.region_mode !== 'region') return { x: 0, y: 0, ...dimensions };
        const value = cfg.region || {};
        const x = Math.max(0, Math.min(dimensions.width - 1, Math.round(Number(value.x) || 0)));
        const y = Math.max(0, Math.min(dimensions.height - 1, Math.round(Number(value.y) || 0)));
        return { x, y, width: Math.max(1, Math.min(dimensions.width - x, Math.round(Number(value.width) || dimensions.width))),
            height: Math.max(1, Math.min(dimensions.height - y, Math.round(Number(value.height) || dimensions.height))) };
    }
    function paintPreview() {
        coordinates.hidden = cfg.region_mode !== 'region';
        if (!previewImage) return;
        send('manga-drawing-guide-region', { region: cfg.region_mode === 'region' ? region() : null });
        const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(previewImage, 0, 0, canvas.width, canvas.height);
        if (cfg.region_mode === 'region') {
            const r = region(), scale = canvas.width / dimensions.width;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
            ctx.beginPath(); ctx.rect(0, 0, canvas.width, canvas.height); ctx.rect(r.x * scale, r.y * scale, r.width * scale, r.height * scale); ctx.fill('evenodd');
            ctx.strokeStyle = '#3584ff'; ctx.lineWidth = 2; ctx.strokeRect(r.x * scale, r.y * scale, r.width * scale, r.height * scale);
        }
    }
    const position = event => {
        const box = canvas.getBoundingClientRect();
        return { x: Math.round(Math.max(0, Math.min(1, (event.clientX - box.left - canvas.clientLeft) / canvas.clientWidth)) * dimensions.width),
            y: Math.round(Math.max(0, Math.min(1, (event.clientY - box.top - canvas.clientTop) / canvas.clientHeight)) * dimensions.height) };
    };
    canvas.addEventListener('pointerdown', event => {
        if (!dimensions || active || event.button !== 0) return;
        event.preventDefault();
        drag = position(event); canvas.setPointerCapture(event.pointerId); cfg.region_mode = 'region'; regionMode.value = 'region';
    });
    canvas.addEventListener('pointermove', event => {
        if (!drag) return;
        const end = position(event); cfg.region = { x: Math.min(drag.x, end.x), y: Math.min(drag.y, end.y), width: Math.abs(end.x - drag.x), height: Math.abs(end.y - drag.y) };
        for (const key of Object.keys(inputs)) inputs[key].value = cfg.region[key]; paintPreview();
    });
    canvas.addEventListener('pointerup', () => { if (drag) { drag = null; changed(); paintPreview(); } });
    canvas.addEventListener('pointercancel', () => { drag = null; });
    function finish(message) {
        if (active) request(`/projects/${project}/drawing-inputs/${active.token}`, undefined, 'DELETE').catch(error => studio.fail(error));
        active = null; job = null; stopping = false; status.textContent = message; update();
        if (!disposed && realtime.checked && pending) { pending = false; start(); }
    }
    function start() {
        if (disposed || !ready) return;
        if (active) { pending = true; return; }
        stopping = false; pending = false; active = { token: uuid(), revision, settings: structuredClone(cfg) };
        status.textContent = 'Capturing drawing…'; update(); send('manga-drawing-snapshot', { token: active.token });
    }
    async function stop() {
        pending = false; stopping = true; update();
        if (job && ['queued', 'running'].includes(job.state)) {
            try { await studio.cancelJob(job, project); } catch (error) { status.textContent = error.message; stopping = false; update(); }
        }
    }
    async function submit(data) {
        const ticket = active;
        try {
            if (!ticket || data.token !== ticket.token) return;
            if (stopping || disposed) { finish('Generation cancelled.'); return; }
            if (ticket.revision !== revision) { finish('Drawing changed · Waiting for the latest stroke.'); return; }
            ticket.frameRevision = data.revision; ticket.region = region(); const r = ticket.region;
            const image = await createImageBitmap(data.png), crop = document.createElement('canvas'); crop.width = r.width; crop.height = r.height;
            crop.getContext('2d').drawImage(image, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height); image.close();
            const blob = await new Promise(resolve => crop.toBlob(resolve, 'image/png'));
            const form = new FormData(); form.append('image', blob, `${ticket.token}.png`); form.append('type', 'temp'); form.append('subfolder', `manga-maker-drawing/${project}`);
            status.textContent = 'Uploading the drawing region…';
            const response = await api.fetchApi('/upload/image', { method: 'POST', body: form }); const uploaded = await response.json();
            if (!response.ok) throw new Error(uploaded.error || 'Could not stage the drawing region.');
            if (stopping || disposed || ticket.revision !== revision) { finish('Drawing changed · Waiting for the latest stroke.'); return; }
            const settings = ticket.settings;
            if (settings.random_seed) settings.seed = Math.floor(Math.random() * 2 ** 48);
            const imagePath = `${uploaded.subfolder ? uploaded.subfolder + '/' : ''}${uploaded.name} [${uploaded.type}]`;
            const built = buildPrompt(studio.defs, 'sketch', 'krea_edit', settings, [imagePath], ticket.token);
            await studio.flush();
            job = await request(`/projects/${project}/jobs`, { id: ticket.token, operation: 'sketch', engine: 'krea_edit', kind, space: kind,
                name: 'Sketch to Art', settings: { ...settings, region: r }, prompt: built.graph, output_node: built.outputNode, sources: [] }, 'POST');
            if (studio.project?.id === project) { studio.project.jobs.push(job); studio.jobs(); }
            if (stopping || disposed) {
                await request(`/projects/${project}/jobs/${job.id}`, { state: 'cancelled', error: 'Cancelled before submission.' }, 'PATCH'); finish('Generation cancelled.'); return;
            }
            status.textContent = 'Sketch to Art queued…';
            const queued = await api.fetchApi('/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
                prompt_id: job.id, client_id: api.clientId, prompt: built.graph, extra_data: { manga_maker: { project, operation: 'sketch', job: job.id } },
            }) });
            const result = await queued.json();
            if (!queued.ok || result.prompt_id !== job.id) throw new Error(JSON.stringify(result.node_errors || result.error || result));
            job.state = 'queued';
            if (stopping || disposed) await studio.cancelJob(job, project);
            poll();
        } catch (error) {
            if (job) await request(`/projects/${project}/jobs/${job.id}`, { error: error.message }, 'PATCH').catch(() => {});
            finish(`Sketch to Art failed: ${error.message}`);
        }
    }
    async function poll() {
        if (polling) return; polling = true;
        try {
            while (job && !disposed) {
                const current = await request(`/projects/${project}/jobs/${job.id}`);
                Object.assign(job, current);
                if (job.state === 'complete') {
                    if (stopping) { finish('Generation cancelled.'); break; }
                    if (active.revision !== revision) { finish('Skipped an older result · Latest drawing preserved.'); break; }
                    status.textContent = 'Blending the result into a new layer…'; active.applying = true;
                    send('manga-drawing-apply-art', { token: active.token, imageUrl: api.apiURL('/view?' + new URLSearchParams(job.drawing_output)),
                        region: active.region, layerName, revision: active.frameRevision, feather: active.settings.feather, opacity: active.settings.blend_opacity }); break;
                }
                if (job.state === 'error' || job.state === 'cancelled') { if (job.state === 'cancelled') pending = false; finish(job.state === 'error' ? `Sketch to Art failed: ${JSON.stringify(job.error)}` : 'Generation cancelled.'); break; }
                status.textContent = job.state === 'running' ? 'Generating Sketch to Art…' : 'Sketch to Art queued…';
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        } catch (error) { finish(`Sketch to Art failed: ${error.message}`); }
        finally { polling = false; if (job && !active?.applying && !disposed) poll(); }
    }
    async function handle(data) {
        if (data.type === 'manga-drawing-opened') { ready = true; update(); send('manga-drawing-snapshot', { token: 'preview' }); }
        else if (data.type === 'manga-drawing-changed' && data.source !== 'ai') revision++;
        else if (data.type === 'manga-drawing-stroke-end' && realtime.checked) start();
        else if (data.type === 'manga-drawing-snapshot-result') {
            if (!(data.png instanceof Blob)) return;
            const image = await createImageBitmap(data.png); if (disposed) { image.close(); return; } dimensions = { width: image.width, height: image.height };
            previewImage?.close(); previewImage = image; canvas.width = Math.max(1, Math.min(320, Math.round(220 * dimensions.width / dimensions.height))); canvas.height = Math.max(1, Math.round(canvas.width * dimensions.height / dimensions.width));
            if (!cfg.region) cfg.region = { x: 0, y: 0, ...dimensions };
            for (const key of Object.keys(inputs)) inputs[key].value = cfg.region[key]; paintPreview();
            if (data.token !== 'preview') submit(data);
        } else if (data.type === 'manga-drawing-art-applied' && data.token === active?.token) {
            const refresh = !pending; finish('AI layer added · Save to project to preserve it.');
            if (refresh) send('manga-drawing-snapshot', { token: 'preview' });
        } else if (data.type === 'manga-drawing-art-stale' && data.token === active?.token) finish('Skipped an older result · Latest drawing preserved.');
        else if (data.type === 'manga-drawing-ai-error') {
            if (data.token === 'preview') status.textContent = data.error;
            else if (data.token === active?.token) finish(`Sketch to Art failed: ${data.error}`);
        }
    }
    return { element, handle, get busy() { return !!active; }, dispose() {
        disposed = true; pending = false; previewImage?.close(); stop();
    } };
}
