localStorage.setItem('klecks-language', 'en');
const send = (type, data = {}) => parent.postMessage({ type, ...data }, location.origin);
let editor, saving = false, aiBusy = false, submitSuccess, submitError, canvasRevision = 0, strokeActive = false;

async function save() {
    if (!editor || saving) return;
    if (aiBusy) { submitError?.(); submitSuccess = submitError = null; send('manga-drawing-error', { error: 'Wait for Sketch to Art or cancel it before saving.' }); return; }
    saving = true; document.documentElement.inert = true;
    send('manga-drawing-saving');
    try {
        const png = await editor.getPNG(), psd = await editor.getPSD();
        send('manga-drawing-save', { png, psd });
    } catch (error) {
        saving = false; document.documentElement.inert = false; submitError?.(); submitSuccess = submitError = null;
        send('manga-drawing-error', { error: error.message || String(error) });
    }
}

window.addEventListener('message', async event => {
    if (event.source !== parent || event.origin !== location.origin) return;
    const data = event.data;
    if (data?.type === 'manga-drawing-init' && !editor) {
        editor = new Klecks({ embedUrl: new URL('klecks/', location.href).href, onReady: () => send('manga-drawing-opened'),
            onStrokeStart: () => { strokeActive = true; canvasRevision++; send('manga-drawing-changed'); },
            onStrokeEnd: () => { strokeActive = false; send('manga-drawing-stroke-end'); }, onSubmit: (success, error) => {
            submitSuccess = success; submitError = error; save();
        } });
        try {
            let project;
            if (data.psdUrl) {
                const response = await fetch(data.psdUrl); if (!response.ok) throw new Error('Could not load the layered drawing.');
                project = await editor.readPSD(await response.arrayBuffer());
            } else if (data.imageUrl) {
                const image = new Image(); image.src = data.imageUrl; await image.decode();
                const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
                canvas.getContext('2d').drawImage(image, 0, 0);
                project = { width: canvas.width, height: canvas.height, layers: [{ name: 'Original', opacity: 1, image: canvas }, { name: 'Drawing', opacity: 1, image: { fill: 'transparent' } }] };
            } else {
                project = { width: data.width, height: data.height, layers: [{ name: 'Background', opacity: 1, image: { fill: '#ffffff' } }, { name: 'Drawing', opacity: 1, image: { fill: 'transparent' } }] };
            }
            editor.openProject(project);
        } catch (error) {
            editor.initError(error.message || 'Could not open the drawing.');
            send('manga-drawing-error', { error: error.message || 'Could not open the drawing.' });
        }
    } else if (data?.type === 'manga-drawing-guide-region') {
        if (editor) editor.setGuideRegion(data.region);
    } else if (data?.type === 'manga-drawing-ai-busy') aiBusy = !!data.busy;
    else if (data?.type === 'manga-drawing-snapshot') {
        try {
            if (!editor || saving) throw new Error('The editor is busy saving.');
            if (strokeActive) throw new Error('Finish the stroke before generating.');
            const revision = `${canvasRevision}:${editor.getRevision()}`; const png = await editor.getPNG(); send('manga-drawing-snapshot-result', { token: data.token, revision, png });
        } catch (error) { send('manga-drawing-ai-error', { token: data.token, error: error.message || String(error) }); }
    } else if (data?.type === 'manga-drawing-apply-art') {
        try {
            if (!editor || saving) throw new Error('The editor is busy saving.');
            if (strokeActive || data.revision !== `${canvasRevision}:${editor.getRevision()}`) { send('manga-drawing-art-stale', { token: data.token }); return; }
            saving = true; document.documentElement.inert = true;
            const r = data.region;
            if (![r.x, r.y, r.width, r.height].every(Number.isInteger) || r.x < 0 || r.y < 0 || r.width < 1 || r.height < 1) throw new Error('The selected region no longer fits the canvas.');
            const image = new Image(); image.src = data.imageUrl; await image.decode();
            const crop = document.createElement('canvas'); crop.width = r.width; crop.height = r.height;
            const ctx = crop.getContext('2d'); ctx.drawImage(image, 0, 0, r.width, r.height);
            const pixels = ctx.getImageData(0, 0, r.width, r.height), feather = Math.max(0, Number(data.feather) || 0);
            let maskPixels, clearMask;
            if (data.mask instanceof Blob) {
                const bitmap = await createImageBitmap(data.mask);
                clearMask = document.createElement('canvas'); clearMask.width = r.width; clearMask.height = r.height;
                const maskCtx = clearMask.getContext('2d'); maskCtx.drawImage(bitmap, 0, 0, r.width, r.height); bitmap.close();
                const original = maskCtx.getImageData(0, 0, r.width, r.height);
                if (feather) {
                    const softened = document.createElement('canvas'); softened.width = r.width; softened.height = r.height;
                    const softCtx = softened.getContext('2d'); softCtx.filter = `blur(${feather}px)`; softCtx.drawImage(clearMask, 0, 0);
                    const blurred = softCtx.getImageData(0, 0, r.width, r.height).data;
                    for (let i = 3; i < original.data.length; i += 4) original.data[i] *= blurred[i] / 255;
                    maskCtx.putImageData(original, 0, 0);
                }
                maskPixels = original.data;
            }
            const opacity = Math.max(0, Math.min(1, Number(data.opacity ?? 100) / 100));
            for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) {
                const edge = feather ? Math.min(1, (x + 0.5) / feather, (r.width - x - 0.5) / feather, (y + 0.5) / feather, (r.height - y - 0.5) / feather) : 1;
                const index = (y * r.width + x) * 4 + 3;
                pixels.data[index] *= (maskPixels ? maskPixels[index] / 255 : edge) * opacity;
            }
            ctx.putImageData(pixels, 0, 0);
            editor.applyLayer({ name: data.layerName, image: crop, region: r, mask: clearMask });
            send('manga-drawing-changed', { source: 'ai' }); send('manga-drawing-art-applied', { token: data.token });
        } catch (error) { send('manga-drawing-ai-error', { token: data.token, error: error.message || String(error) }); }
        finally { saving = false; document.documentElement.inert = false; }
    } else if (data?.type === 'manga-drawing-export') await save();
    else if (data?.type === 'manga-drawing-saved') {
        saving = false; document.documentElement.inert = false; submitSuccess?.(); submitSuccess = submitError = null;
    } else if (data?.type === 'manga-drawing-save-failed') {
        saving = false; document.documentElement.inert = false; submitError?.(); submitSuccess = submitError = null;
    }
});
document.addEventListener('pointerdown', event => {
    if (editor && event.target instanceof HTMLCanvasElement) send('manga-drawing-dirty');
}, true);
document.addEventListener('change', () => { if (editor) send('manga-drawing-dirty'); });
send('manga-drawing-ready');
