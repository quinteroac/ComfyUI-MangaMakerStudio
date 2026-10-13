import { api } from '../../scripts/api.js';
import { el, button, field, request, assetUrl, sizeControls } from './client.js';
import { imageDimensions, sizeSettings } from './size.js';

export function openDrawing(studio, kind, source = null) {
    if (!source) {
        const size = sizeSettings(studio.config(kind)), name = el('input', { value: kind === 'references' ? 'Reference sketch' : 'Panel sketch', 'aria-label': 'Drawing name' });
        const dialog = studio.modal(kind === 'references' ? 'New reference drawing' : 'New panel drawing', el('div', {}, field('Drawing name', name),
            sizeControls(size, value => Object.assign(size, value)), button('Start drawing', () => {
                dialog.close(); drawingEditor(studio, kind, null, name.value, imageDimensions(size));
            }, { class: 'mm-primary' })));
    } else drawingEditor(studio, kind, source, source.name, { width: source.width, height: source.height });
}

function drawingEditor(studio, kind, source, drawingName, size) {
    const project = studio.project.id;
    const iframe = el('iframe', { title: 'Klecks drawing editor', sandbox: 'allow-scripts allow-same-origin allow-downloads', class: 'mm-drawing-frame' });
    const name = el('input', { value: drawingName, 'aria-label': 'Drawing name' }), status = el('small', { role: 'status', text: 'Loading Klecks…' });
    const send = (type, data = {}) => iframe.contentWindow.postMessage({ type, ...data }, location.origin);
    const save = button('Save to project', () => { exporting = true; save.disabled = true; status.textContent = 'Saving drawing…'; send('manga-drawing-export'); }, { disabled: true, class: 'mm-primary' });
    const dialog = studio.modal(kind === 'references' ? 'Draw reference · Klecks' : 'Draw panel · Klecks', el('div', { class: 'mm-drawing-body' },
        el('div', { class: 'mm-toolbar' }, field('Drawing name', name), save, status), iframe));
    dialog.classList.add('mm-drawing-dialog');
    let parent = source?.id || null, saving = false, exporting = false, opened = false, dirty = false;
    const close = () => {
        if (saving || exporting) return;
        if (!dirty) { dialog.close(); return; }
        const discard = studio.modal('Discard unsaved drawing?', el('div', {}, el('p', { text: 'Changes since the last save will be discarded.' }),
            button('Discard changes', () => { discard.close(); dialog.close(); }, { class: 'mm-danger' })));
    };
    dialog.querySelector(':scope > button:last-child').replaceWith(button('Close', close));
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    const abort = new AbortController();
    window.addEventListener('message', async event => {
        if (event.source !== iframe.contentWindow || event.origin !== location.origin || !event.data?.type?.startsWith('manga-drawing-')) return;
        const data = event.data;
        if (data.type === 'manga-drawing-ready') send('manga-drawing-init', { ...size,
            ...(source?.metadata?.drawing_document ? { psdUrl: api.apiURL(`/manga-maker/projects/${project}/assets/${source.id}/drawing`) } : source ? { imageUrl: assetUrl(project, source.id) } : {}) });
        else if (data.type === 'manga-drawing-opened') { opened = true; status.textContent = 'Draw with Klecks, then save to your project.'; save.disabled = false; }
        else if (data.type === 'manga-drawing-changed') dirty = true;
        else if (data.type === 'manga-drawing-saving') { exporting = true; save.disabled = true; status.textContent = 'Saving drawing…'; }
        else if (data.type === 'manga-drawing-error') { exporting = false; status.textContent = data.error; save.disabled = !opened; }
        else if (data.type === 'manga-drawing-save' && !saving) {
            exporting = false; saving = true; save.disabled = true;
            try {
                if (!(data.png instanceof Blob) || !(data.psd instanceof Blob)) throw new Error('The editor did not provide PNG and PSD files.');
                const form = new FormData(); form.append('image', data.png, 'drawing.png'); form.append('document', data.psd, 'drawing.psd');
                form.append('kind', kind); form.append('name', name.value || drawingName); if (parent) form.append('parent', parent);
                const asset = await request(`/projects/${project}/drawings`, form, 'POST'); parent = asset.id;
                if (studio.project?.id === project) {
                    const latest = await request(`/projects/${project}`); studio.project.assets = latest.assets;
                    studio.galleryRefresh.forEach(refresh => refresh());
                }
                dirty = false; status.textContent = 'Saved to project · Layers preserved'; send('manga-drawing-saved');
            } catch (error) { status.textContent = `Could not save drawing: ${error.message}`; send('manga-drawing-save-failed'); }
            finally { saving = false; save.disabled = false; }
        }
    }, { signal: abort.signal });
    dialog.addEventListener('close', () => abort.abort());
    iframe.src = api.apiURL('/manga-maker/drawing/index.html');
}
