localStorage.setItem('klecks-language', 'en');
const send = (type, data = {}) => parent.postMessage({ type, ...data }, location.origin);
let editor, saving = false, submitSuccess, submitError;

async function save() {
    if (!editor || saving) return;
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
        editor = new Klecks({ embedUrl: new URL('klecks/', location.href).href, onSubmit: (success, error) => {
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
            send('manga-drawing-opened');
        } catch (error) {
            editor.initError(error.message || 'Could not open the drawing.');
            send('manga-drawing-error', { error: error.message || 'Could not open the drawing.' });
        }
    } else if (data?.type === 'manga-drawing-export') await save();
    else if (data?.type === 'manga-drawing-saved') {
        saving = false; document.documentElement.inert = false; submitSuccess?.(); submitSuccess = submitError = null;
    } else if (data?.type === 'manga-drawing-save-failed') {
        saving = false; document.documentElement.inert = false; submitError?.(); submitSuccess = submitError = null;
    }
});
document.addEventListener('pointerdown', event => { if (editor && event.target instanceof HTMLCanvasElement) send('manga-drawing-changed'); });
document.addEventListener('change', () => { if (editor) send('manga-drawing-changed'); });
send('manga-drawing-ready');
