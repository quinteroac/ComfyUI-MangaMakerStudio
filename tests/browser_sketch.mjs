import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { options } from '../web/prompts.js';

const require = createRequire(import.meta.url), { chromium } = require(process.argv[2]);
const root = path.resolve(import.meta.dirname, '..');
const fixture = spawn(process.argv[3], [path.join(root, 'tests/browser_backend.py')], { stdio: ['ignore', 'pipe', 'pipe'] });
fixture.stderr.on('data', b => process.stderr.write(b));
const [chunk] = await once(fixture.stdout, 'data'), backend = JSON.parse(chunk.toString());
const defs = JSON.parse(await fs.readFile(process.argv[4] || '/tmp/manga-object-info.json', 'utf8'));
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const queued = [], uploads = [], cancellations = []; let hold = false;
try {
    if (process.argv[4]) await page.route(/\/(?:api\/)?object_info(?:\?.*)?$/, route => route.fulfill({ json: defs }));
    await page.addInitScript(({ project }) => { localStorage.setItem('mm-project', project); localStorage.setItem('mm-space', 'panels'); }, { project: backend.project });
    await page.route('**/extensions/ComfyUI-MangaMakerStudio/**', async route => {
        const name = new URL(route.request().url()).pathname.split('/').at(-1);
        await route.fulfill({ body: await fs.readFile(path.join(root, 'web', name)), contentType: name.endsWith('.css') ? 'text/css' : 'application/javascript' });
    });
    await page.route(/\/extensions\/?(?:\?.*)?$/, async route => {
        const response = await route.fetch(), list = await response.json();
        if (!list.includes('/extensions/ComfyUI-MangaMakerStudio/extension.js')) list.push('/extensions/ComfyUI-MangaMakerStudio/extension.js');
        await route.fulfill({ json: list });
    });
    await page.route(/\/(?:api\/)?manga-maker\//, async route => {
        const url = new URL(route.request().url()), pathname = url.pathname.replace(/^\/api\//, '/');
        // ComfyUI serves every response with COEP; the Klecks iframe is blocked inside the Studio page without it.
        const response = await route.fetch({ url: backend.url + pathname + url.search });
        await route.fulfill({ response, headers: { ...response.headers(), 'cross-origin-embedder-policy': 'credentialless' } });
    });
    await page.route(/\/(?:api\/)?upload\/image$/, async route => {
        const response = await route.fetch({ url: `${backend.url}/test/upload` }); const uploaded = await response.json(); uploads.push(uploaded);
        await route.fulfill({ json: uploaded });
    });
    await page.route(/\/(?:api\/)?view\?/, async route => {
        await route.fulfill({ response: await route.fetch({ url: `${backend.url}/test/view${new URL(route.request().url()).search}` }) });
    });
    await page.route(/\/(?:api\/)?(?:queue|interrupt)$/, async route => {
        if (route.request().method() !== 'POST') return route.fallback();
        const endpoint = new URL(route.request().url()).pathname.split('/').at(-1), body = route.request().postDataJSON(); cancellations.push({ endpoint, body });
        const response = await fetch(`${backend.url}/test/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        await route.fulfill({ json: await response.json() });
    });
    await page.route(/\/(?:api\/)?prompt$/, async route => {
        const body = route.request().postDataJSON(); queued.push(body);
        const response = await fetch(`${backend.url}/test/${hold ? 'enqueue' : 'complete'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        await route.fulfill({ json: await response.json() });
        // Studio jobs are polled; the Manga-Lite live preview waits for ComfyUI's completion event instead.
        if (!body.extra_data && !hold) await page.evaluate(id => window.comfyAPI.api.api.dispatchCustomEvent('execution_success', { prompt_id: id }), body.prompt_id);
    });
    await page.route(/\/(?:api\/)?history\/[\w-]+$/, async route => {
        await route.fulfill({ response: await route.fetch({ url: `${backend.url}/test/history/${new URL(route.request().url()).pathname.split('/').at(-1)}` }) });
    });
    await page.goto(process.env.COMFY_URL || 'http://127.0.0.1:8188', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.comfyAPI?.app?.app?.graph && window.comfyAPI.app.app.extensions.some(e => e.name === 'MangaMaker.Studio'));
    const graphBefore = await page.evaluate(() => {
        const app = window.comfyAPI.app.app, graph = app.graph.serialize();
        app.extensions.find(e => e.name === 'MangaMaker.Studio').commands[0].function(); return graph;
    });
    const studio = page.locator('.mm-studio'); await studio.waitFor();
    const segment = (scope, label) => scope.getByRole('radiogroup', { name: label, exact: true });
    const choose = (scope, label, value) => segment(scope, label).locator(`input[value="${value}"]`).check();
    const chosen = (scope, label) => segment(scope, label).locator('input:checked').inputValue();
    await studio.getByRole('button', { name: 'Draw panel', exact: true }).click();
    const setup = studio.getByRole('dialog', { name: 'New panel drawing', exact: true });
    await setup.getByLabel('Drawing name', { exact: true }).fill('AI panel sketch');
    await setup.getByLabel('Resolution · MP', { exact: true }).fill('0.065536');
    await setup.getByRole('button', { name: 'Start drawing', exact: true }).click();
    const dialog = studio.getByRole('dialog', { name: 'Draw panel · Klecks', exact: true });
    const controls = dialog.getByRole('complementary', { name: 'Sketch to Art controls', exact: true });
    const frame = await (await dialog.locator('iframe').elementHandle()).contentFrame();
    await frame.locator('.g-root:not(.top-overlay)').waitFor();
    await controls.getByRole('button', { name: 'Generate Sketch to Art', exact: true }).waitFor();
    await controls.locator('summary').filter({ hasText: 'Models and advanced settings' }).click();
    for (const [label, node, key] of [['Diffusion model', 'UNETLoader', 'unet_name'], ['Text encoder', 'CLIPLoader', 'clip_name'], ['VAE', 'VAELoader', 'vae_name']]) {
        await controls.getByLabel(label, { exact: true }).fill(options(defs, node, key)[0]);
    }
    assert.equal(await controls.getByLabel('Identity Edit LoRA', { exact: true }).count(), 0);
    const loras = controls.locator('details').filter({ has: page.getByRole('button', { name: 'Add LoRA', exact: true, includeHidden: true }) });
    await loras.locator('summary').click();
    for (const index of [0, 1]) await loras.getByLabel('LoRA file', { exact: true }).nth(index).fill(options(defs, 'LoraLoaderModelOnly', 'lora_name')[index]);
    await controls.locator('summary').filter({ hasText: /^Sampling$/ }).click();
    await controls.getByLabel('Denoise', { exact: true }).fill('0.45'); await controls.getByLabel('Denoise', { exact: true }).press('Tab');
    const regionPreview = controls.getByLabel('Sketch region preview', { exact: true });
    await regionPreview.scrollIntoViewIfNeeded();
    const previewBox = await regionPreview.boundingBox();
    const previewBorder = await regionPreview.evaluate(canvas => parseFloat(getComputedStyle(canvas).borderLeftWidth));
    const previewSize = previewBox.width - 2 * previewBorder;
    await page.mouse.move(previewBox.x + previewBorder + previewSize / 8, previewBox.y + previewBorder + previewSize / 8);
    await page.mouse.down();
    await page.mouse.move(previewBox.x + previewBorder + previewSize / 2, previewBox.y + previewBorder + previewSize / 2, { steps: 5 });
    await page.mouse.up();
    assert.equal(await chosen(controls, 'Drawing area'), 'region');
    for (const [label, value] of [['X', '32'], ['Y', '32'], ['Region width', '96'], ['Region height', '96']]) {
        assert.equal(await controls.getByLabel(label, { exact: true }).inputValue(), value);
    }
    const initial = await frame.evaluate(async () => {
        const bitmap = await createImageBitmap(await editor.getPNG()), canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close(); return { width: canvas.width, height: canvas.height, pixels: [...ctx.getImageData(0, 0, canvas.width, canvas.height).data] };
    });
    assert.equal(initial.width, 256); assert.equal(initial.height, 256);
    const viewPixels = () => frame.evaluate(() => {
        const canvas = [...document.querySelectorAll('canvas')].sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height)[0];
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let blue = 0;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === 53 && pixels[i + 1] === 132 && pixels[i + 2] === 255) blue++;
        return blue;
    });
    await page.waitForTimeout(100);
    assert(await viewPixels() > 0, 'Region guides must be visible on the drawing canvas');
    const revisionWithGuides = await frame.evaluate(() => editor.getRevision());
    await choose(controls, 'Drawing area', 'canvas');
    await page.waitForTimeout(100);
    assert.equal(await viewPixels(), 0, 'Whole canvas hides region guides');
    const pngWithoutGuides = await frame.evaluate(async () => [...new Uint8Array(await (await editor.getPNG()).arrayBuffer())]);
    await choose(controls, 'Drawing area', 'region');
    await page.waitForTimeout(100);
    assert(await viewPixels() > 0);
    assert.equal(await frame.evaluate(() => editor.getRevision()), revisionWithGuides, 'Guides do not change undo history');
    const pngWithGuides = await frame.evaluate(async () => [...new Uint8Array(await (await editor.getPNG()).arrayBuffer())]);
    assert.deepEqual(pngWithGuides, pngWithoutGuides, 'Guides are excluded from image exports and inference snapshots');

    await controls.locator('summary').filter({ hasText: /^Prompt$/ }).click();
    await controls.locator('.mm-prompt-section > summary').filter({ hasText: /^Subject/ }).click();
    await controls.getByLabel('Subject', { exact: true }).fill('A traveler crossing a bridge');
    const editorRevisionBeforePreset = await frame.evaluate(() => editor.getRevision());
    await controls.getByRole('button', { name: 'Save settings as preset', exact: true }).click();
    const presetDialog = studio.getByRole('dialog', { name: 'Preset name', exact: true });
    await presetDialog.getByRole('textbox').fill('Bridge sketch');
    await presetDialog.getByRole('button', { name: 'Save', exact: true }).click(); await presetDialog.waitFor({ state: 'detached' });
    const presetSelect = controls.getByLabel('Prompt and settings preset', { exact: true });
    assert.equal(await presetSelect.inputValue(), 'Bridge sketch');
    await controls.locator('.mm-prompt-section > summary').filter({ hasText: /^Subject/ }).click();
    await controls.getByLabel('Subject', { exact: true }).fill('Modified subject');
    assert.equal(await presetSelect.inputValue(), 'Bridge sketch');
    assert.equal(await presetSelect.locator('option:checked').textContent(), 'Bridge sketch · Modified');
    await controls.locator('summary').filter({ hasText: /^Sampling$/ }).click();
    await controls.getByLabel('Denoise', { exact: true }).fill('0.8'); await controls.getByLabel('Denoise', { exact: true }).press('Tab');
    await presetSelect.selectOption('Bridge sketch');
    assert.equal(await controls.getByLabel('Subject', { exact: true }).inputValue(), 'A traveler crossing a bridge');
    await controls.locator('summary').filter({ hasText: /^Sampling$/ }).click();
    assert.equal(await controls.getByLabel('Denoise', { exact: true }).inputValue(), '0.45');
    assert.equal(await frame.evaluate(() => editor.getRevision()), editorRevisionBeforePreset, 'Loading a preset keeps the drawing intact');
    assert.equal(await controls.getByLabel('Realtime on stroke release', { exact: true }).isChecked(), false);
    await controls.getByRole('button', { name: 'Clone preset', exact: true }).click();
    const cloneDialog = studio.getByRole('dialog', { name: 'Copy preset name', exact: true });
    await cloneDialog.getByRole('textbox').fill('Bridge sketch copy');
    await cloneDialog.getByRole('button', { name: 'Save', exact: true }).click(); await cloneDialog.waitFor({ state: 'detached' });
    assert.equal(await presetSelect.inputValue(), 'Bridge sketch copy');
    await page.waitForTimeout(700);
    const storedPresets = (await (await fetch(`${backend.url}/manga-maker/projects/${backend.project}`)).json()).presets['sketch_panels:krea_edit'];
    assert.equal(storedPresets['Bridge sketch'].prompt_sections.subject, 'A traveler crossing a bridge');
    assert.deepEqual(storedPresets['Bridge sketch'].region, { x: 32, y: 32, width: 96, height: 96 });
    assert.equal(storedPresets['Bridge sketch'].model_overrides.steps, 1);
    assert.equal(storedPresets['Bridge sketch'].loras.length, 2);
    assert.deepEqual(storedPresets['Bridge sketch copy'], storedPresets['Bridge sketch']);
    await controls.getByRole('button', { name: 'Generate Sketch to Art', exact: true }).click();
    await controls.getByText('AI layer added · Save to project to preserve it.', { exact: true }).waitFor({ timeout: 30000 });
    assert.equal(queued.length, 1); assert.equal(uploads.length, 1); assert.equal(uploads[0].width, 96); assert.equal(uploads[0].height, 96);
    const sampler = Object.values(queued[0].prompt).find(n => n.class_type === 'KSampler'); assert.equal(sampler.inputs.steps, 1); assert.equal(sampler.inputs.denoise, .45);
    const blended = await frame.evaluate(async () => {
        const project = await editor.readPSD(await (await editor.getPSD()).arrayBuffer());
        const bitmap = await createImageBitmap(await editor.getPNG()), canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close();
        return { layers: project.layers.map(layer => layer.name), pixels: [...ctx.getImageData(0, 0, canvas.width, canvas.height).data] };
    });
    assert.equal(blended.layers.length, 3); assert(blended.layers.at(-1).startsWith('Sketch to Art'));
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
        if (x >= 32 && x < 128 && y >= 32 && y < 128) continue;
        const index = (y * 256 + x) * 4; assert.deepEqual(blended.pixels.slice(index, index + 4), initial.pixels.slice(index, index + 4));
    }
    const center = (80 * 256 + 80) * 4, edge = (32 * 256 + 32) * 4;
    assert.deepEqual(blended.pixels.slice(center, center + 3), [193, 216, 203]);
    assert(blended.pixels[edge] > blended.pixels[center]);
    await dialog.locator('iframe').focus(); await page.keyboard.press('Control+z');
    const undoPixels = await frame.evaluate(async () => {
        const bitmap = await createImageBitmap(await editor.getPNG()), canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close(); return [...ctx.getImageData(0, 0, canvas.width, canvas.height).data];
    });
    assert.deepEqual(undoPixels, initial.pixels);
    await page.keyboard.press('Control+y');
    const redoLayerCount = await frame.evaluate(async () => (await editor.readPSD(await (await editor.getPSD()).arrayBuffer())).layers.length); assert.equal(redoLayerCount, 3);
    const projectAfterManual = await (await fetch(`${backend.url}/manga-maker/projects/${backend.project}`)).json(); assert.equal(projectAfterManual.assets.length, 8);
    const cdp = await page.context().newCDPSession(page); let penPoint;
    const releasePen = () => cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', pointerType: 'pen', button: 'left', buttons: 0, x: penPoint.x, y: penPoint.y, force: 0 });
    const stroke = async (release = true, pen = false) => {
        const index = await frame.locator('canvas').evaluateAll(canvases => canvases.map((c, i) => ({ i, area: c.getBoundingClientRect().width * c.getBoundingClientRect().height })).sort((a, b) => b.area - a.area)[0].i);
        const box = await frame.locator('canvas').nth(index).boundingBox();
        if (pen) {
            const start = { x: box.x + box.width * .45, y: box.y + box.height * .5 }; penPoint = { x: box.x + box.width * .55, y: start.y };
            await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', pointerType: 'pen', x: start.x, y: start.y, button: 'none', buttons: 0 });
            await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', pointerType: 'pen', ...start, button: 'left', buttons: 1, force: .7 });
            await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', pointerType: 'pen', ...penPoint, button: 'left', buttons: 1, force: .7 });
            if (release) await releasePen(); return;
        }
        await page.mouse.move(box.x + box.width * .45, box.y + box.height * .5); await page.mouse.down();
        await page.mouse.move(box.x + box.width * .55, box.y + box.height * .5, { steps: 10 });
        if (release) await page.mouse.up();
    };
    hold = true; await controls.getByLabel('Realtime on stroke release', { exact: true }).check();
    await stroke(false, true); await page.waitForTimeout(100); assert.equal(queued.length, 1); await releasePen();
    await page.waitForFunction(() => document.querySelector('.mm-sketch-controls [role=status]').textContent.includes('queued'));
    for (let attempt = 0; queued.length < 2 && attempt < 100; attempt++) await page.waitForTimeout(50);
    assert.equal(queued.length, 2);
    await stroke(); await page.waitForTimeout(200); assert.equal(queued.length, 2);
    await fetch(`${backend.url}/test/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(queued[1]) });
    for (let attempt = 0; queued.length < 3 && attempt < 100; attempt++) await page.waitForTimeout(50);
    assert.equal(queued.length, 3);
    const beforeLatest = await frame.evaluate(async () => {
        const bitmap = await createImageBitmap(await editor.getPNG()), canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close(); return [...ctx.getImageData(0, 0, canvas.width, canvas.height).data];
    });
    await fetch(`${backend.url}/test/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(queued[2]) });
    await controls.getByText('AI layer added · Save to project to preserve it.', { exact: true }).waitFor();
    const afterLatest = await frame.evaluate(async () => {
        const bitmap = await createImageBitmap(await editor.getPNG()), canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close(); return [...ctx.getImageData(0, 0, canvas.width, canvas.height).data];
    });
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
        if (x >= 32 && x < 128 && y >= 32 && y < 128) continue;
        const index = (y * 256 + x) * 4; assert.deepEqual(afterLatest.slice(index, index + 4), beforeLatest.slice(index, index + 4));
    }
    const layers = await frame.evaluate(async () => (await editor.readPSD(await (await editor.getPSD()).arrayBuffer())).layers.length); assert.equal(layers, 3);
    await stroke(); for (let attempt = 0; queued.length < 4 && attempt < 100; attempt++) await page.waitForTimeout(50); assert.equal(queued.length, 4);
    await controls.getByLabel('Realtime on stroke release', { exact: true }).uncheck();
    await controls.getByRole('button', { name: 'Cancel generation', exact: true }).click();
    await controls.getByText('Generation cancelled.', { exact: true }).waitFor();
    assert(cancellations.some(call => call.endpoint === 'queue' && call.body.delete.includes(queued[3].prompt_id)));
    hold = false;
    await choose(controls, 'Drawing area', 'canvas');
    await controls.locator('summary').filter({ hasText: /^Layer blending$/ }).click();
    await controls.getByLabel('Edge feather · px', { exact: true }).fill('0');
    await controls.getByLabel('Blend opacity · %', { exact: true }).fill('50'); await controls.getByLabel('Blend opacity · %', { exact: true }).press('Tab');
    await controls.getByRole('button', { name: 'Generate Sketch to Art', exact: true }).click();
    await controls.getByText('AI layer added · Save to project to preserve it.', { exact: true }).waitFor();
    assert.equal(queued.length, 5); assert.equal(uploads.at(-1).width, 256); assert.equal(uploads.at(-1).height, 256);
    const opacityPixel = await frame.evaluate(async () => {
        const image = await createImageBitmap(await editor.getPNG()), canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); image.close(); return [...ctx.getImageData(0, 0, 1, 1).data];
    });
    assert.deepEqual(opacityPixel, [224, 235, 229, 255]);
    const drawingPixels = () => frame.evaluate(async () => {
        const image = await createImageBitmap(await editor.getPNG()), canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); image.close(); return [...ctx.getImageData(0, 0, canvas.width, canvas.height).data];
    });
    const beforeMask = await drawingPixels();
    await controls.getByLabel('Blend opacity · %', { exact: true }).fill('100'); await controls.getByLabel('Blend opacity · %', { exact: true }).press('Tab');
    await controls.locator('summary').filter({ hasText: /^Crop and stitch mask$/ }).click();
    await choose(controls, 'Preview tool', 'paint');
    await controls.getByLabel('Mask brush size · px', { exact: true }).fill('64');
    const maskStroke = async (from, to) => {
        await regionPreview.scrollIntoViewIfNeeded();
        const box = await regionPreview.boundingBox();
        const point = ([x, y]) => ({ x: box.x + previewBorder + x / 256 * (box.width - 2 * previewBorder), y: box.y + previewBorder + y / 256 * (box.height - 2 * previewBorder) });
        const start = point(from), end = point(to);
        await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 10 }); await page.mouse.up();
    };
    await maskStroke([64, 96], [192, 96]);
    assert.equal(await controls.getByLabel('Use stitch mask', { exact: true }).isChecked(), true);
    await choose(controls, 'Preview tool', 'erase');
    await controls.getByLabel('Mask brush size · px', { exact: true }).fill('32');
    await maskStroke([128, 96], [128, 96]);
    assert.equal(await chosen(controls, 'Drawing area'), 'region');
    await controls.getByRole('button', { name: 'Generate Sketch to Art', exact: true }).click();
    await controls.getByText('AI layer added · Save to project to preserve it.', { exact: true }).waitFor();
    assert.equal(queued.length, 6);
    assert(uploads.at(-1).width < 256 && uploads.at(-1).height < 256, 'Crop follows mask bounds');
    const afterMask = await drawingPixels();
    const pixelAt = (pixels, x, y) => pixels.slice((y * 256 + x) * 4, (y * 256 + x) * 4 + 4);
    assert.deepEqual(pixelAt(afterMask, 64, 96), [193, 216, 203, 255]);
    for (const [x, y] of [[0, 0], [128, 96], [32, 64], [255, 255]]) assert.deepEqual(pixelAt(afterMask, x, y), pixelAt(beforeMask, x, y), 'Outside mask and erased holes preserve existing AI pixels');
    await dialog.locator('iframe').focus(); await page.keyboard.press('Control+z'); assert.deepEqual(await drawingPixels(), beforeMask);
    await page.keyboard.press('Control+y'); assert.deepEqual(await drawingPixels(), afterMask);
    await controls.getByLabel('Edge feather · px', { exact: true }).fill('8'); await controls.getByLabel('Edge feather · px', { exact: true }).press('Tab');
    await controls.getByRole('button', { name: 'Generate Sketch to Art', exact: true }).click();
    await controls.getByText('AI layer added · Save to project to preserve it.', { exact: true }).waitFor();
    const featheredMask = await drawingPixels();
    assert.deepEqual(pixelAt(featheredMask, 128, 96), pixelAt(beforeMask, 128, 96), 'Mask feather does not bleed into protected holes');
    assert.equal(await frame.evaluate(async () => (await editor.readPSD(await (await editor.getPSD()).arrayBuffer())).layers.length), 3);
    await choose(controls, 'Drawing area', 'canvas');
    assert.equal(await controls.getByLabel('Use stitch mask', { exact: true }).isChecked(), false, 'Whole canvas disables the previous regional mask');
    assert.equal(await chosen(controls, 'Preview tool'), 'region');
    await controls.getByLabel('Edge feather · px', { exact: true }).fill('0'); await controls.getByLabel('Edge feather · px', { exact: true }).press('Tab');
    await controls.getByRole('button', { name: 'Generate Sketch to Art', exact: true }).click();
    await controls.getByText('AI layer added · Save to project to preserve it.', { exact: true }).waitFor();
    assert.equal(uploads.at(-1).width, 256); assert.equal(uploads.at(-1).height, 256);
    assert.equal(await chosen(controls, 'Drawing area'), 'canvas', 'Mask bounds must not switch back to regional inference');
    const wholeAfterMask = await drawingPixels();
    assert.deepEqual(pixelAt(wholeAfterMask, 0, 0), [193, 216, 203, 255], 'Full-canvas generation visibly replaces previously protected areas');
    await controls.getByLabel('Use stitch mask', { exact: true }).check();
    await controls.getByRole('button', { name: 'Clear mask', exact: true }).click();
    assert.equal(await controls.getByLabel('Use stitch mask', { exact: true }).isChecked(), false, 'Clearing the mask cannot leave an invisible stitch enabled');
    if (process.argv[4]) {
        await choose(controls, 'Drawing workflow', 'manga');
        const manga = dialog.getByRole('complementary', { name: 'Art to Manga Panel controls', exact: true });
        assert.equal(await manga.getByLabel('Manga workflow', { exact: true }).inputValue(), 'lite');
        assert.equal(await manga.getByLabel('Realtime on stroke release', { exact: true }).isVisible(), false);
        await manga.getByRole('button', { name: 'Generate Art to Manga Panel', exact: true }).click();
        await manga.getByText('AI layer added · Save to project to preserve it.', { exact: true }).waitFor();
        const lite = Object.values(queued.at(-1).prompt);
        assert(lite.some(n => n.class_type === 'MangaLevels'));
        assert(!lite.some(n => n.class_type === 'UNETLoader'));
        const layers = () => frame.evaluate(async () => (await editor.readPSD(await (await editor.getPSD()).arrayBuffer())).layers.map(l => l.name));
        assert.equal((await layers()).length, 4); assert((await layers()).at(-1).startsWith('Art to Manga Panel'));
        const mangaPixels = await drawingPixels();
        assert.deepEqual(pixelAt(mangaPixels, 0, 0), [255, 255, 255, 255], 'Panel fits without stretching');
        assert.deepEqual(pixelAt(mangaPixels, 128, 128), [193, 216, 203, 255]);
        await dialog.locator('iframe').focus(); await page.keyboard.press('Control+z');
        assert.deepEqual(await drawingPixels(), wholeAfterMask);
        await page.keyboard.press('Control+y'); assert.deepEqual(await drawingPixels(), mangaPixels);
        const queuedBefore = queued.length, uploadsBefore = uploads.length;
        await frame.evaluate(() => { const set = editor.setPreviewImage.bind(editor); window.previews = []; editor.setPreviewImage = preview => { window.previews.push(preview && preview.region); set(preview); }; });
        await manga.getByLabel('Live preview on canvas', { exact: true }).check();
        await frame.waitForFunction(() => window.previews.some(Boolean));
        assert.deepEqual((await frame.evaluate(() => window.previews.filter(Boolean).at(-1))), { x: 0, y: 0, width: 256, height: 256 });
        assert.equal(queued.length, queuedBefore + 1); assert.equal(uploads.length, uploadsBefore + 1);
        assert(!queued.at(-1).extra_data && Object.values(queued.at(-1).prompt).some(n => n.class_type === 'MangaLevels'));
        await manga.getByLabel('Gamma', { exact: true }).fill('2'); await manga.getByLabel('Gamma', { exact: true }).press('Tab');
        for (let i = 0; i < 100 && queued.length < queuedBefore + 2; i++) await page.waitForTimeout(50);
        assert.equal(Object.values(queued.at(-1).prompt).find(n => n.class_type === 'MangaLevels').inputs.gamma, 2);
        assert.equal(uploads.length, uploadsBefore + 1, 'An unchanged drawing is not uploaded again');
        assert.equal((await layers()).length, 4, 'Live preview does not add layers');
        await manga.getByLabel('Live preview on canvas', { exact: true }).uncheck();
        // The bridge receives postMessage asynchronously, so wait for the overlay to clear instead of reading it once.
        await frame.waitForFunction(() => window.previews.at(-1) === null, null, { timeout: 5000 }).catch(() => assert.fail('Turning the preview off clears the canvas overlay'));
        await manga.getByLabel('Manga workflow', { exact: true }).selectOption('qwen');
        await manga.locator('summary').filter({ hasText: 'Models and advanced settings' }).click();
        for (const [label, node, key] of [['Diffusion model', 'UNETLoader', 'unet_name'], ['Text encoder', 'CLIPLoader', 'clip_name'], ['VAE', 'VAELoader', 'vae_name']]) {
            await manga.getByLabel(label, { exact: true }).fill(options(defs, node, key)[0]);
            await manga.getByLabel(label, { exact: true }).press('Tab');
        }
        await manga.getByRole('button', { name: 'Generate Art to Manga Panel', exact: true }).click();
        await manga.getByText('AI layer added · Save to project to preserve it.', { exact: true }).waitFor();
        const full = Object.values(queued.at(-1).prompt);
        assert(full.some(n => n.class_type === 'ManualSigmas')); assert(full.some(n => n.class_type === 'MangaFinish'));
        assert.equal((await layers()).length, 4, 'Manga updates its own layer');
        await choose(manga, 'Drawing workflow', 'sketch');
        assert.equal(await controls.getByLabel('Denoise', { exact: true }).inputValue(), '0.45');
        await choose(controls, 'Drawing workflow', 'bbox');
        const bbox = dialog.getByRole('complementary', { name: 'BBox to Image controls', exact: true });
        assert.equal(await bbox.getByLabel('Sketch region preview', { exact: true }).isVisible(), false);
        await page.waitForTimeout(100);
        assert.equal(await viewPixels(), 0, 'BBox to Image hides the sketch region guide');
        await bbox.locator('summary').filter({ hasText: 'Models and advanced settings' }).click();
        for (const [label, node, key] of [['Diffusion model', 'UNETLoader', 'unet_name'], ['Text encoder', 'CLIPLoader', 'clip_name'], ['VAE', 'VAELoader', 'vae_name'], ['Eight-step LoRA', 'LoraLoaderModelOnly', 'lora_name']]) {
            await bbox.getByLabel(label, { exact: true }).fill(options(defs, node, key)[0]);
            await bbox.getByLabel(label, { exact: true }).press('Tab');
        }
        const pngBeforeBoxes = await frame.evaluate(async () => [...new Uint8Array(await (await editor.getPNG()).arrayBuffer())]);
        const revisionBeforeBoxes = await frame.evaluate(() => editor.getRevision()), uploadsBeforeBoxes = uploads.length;
        await bbox.getByLabel('Draw boxes on canvas', { exact: true }).check();
        await frame.waitForFunction(() => boxTool);
        const index = await frame.locator('canvas').evaluateAll(canvases => canvases.map((c, i) => ({ i, area: c.getBoundingClientRect().width * c.getBoundingClientRect().height })).sort((a, b) => b.area - a.area)[0].i);
        const view = await frame.locator('canvas').nth(index).boundingBox();
        await page.mouse.move(view.x + view.width / 2 - 40, view.y + view.height / 2 - 40); await page.mouse.down();
        await page.mouse.move(view.x + view.width / 2 + 40, view.y + view.height / 2 + 40, { steps: 5 }); await page.mouse.up();
        await bbox.getByLabel('Box 1 description', { exact: true }).waitFor();
        await page.waitForTimeout(100);
        assert(await viewPixels() > 0, 'Drawn boxes are visible on the drawing canvas');
        assert.equal(await frame.evaluate(() => editor.getRevision()), revisionBeforeBoxes, 'Boxes do not change undo history');
        assert.deepEqual(await frame.evaluate(async () => [...new Uint8Array(await (await editor.getPNG()).arrayBuffer())]), pngBeforeBoxes, 'Boxes are excluded from exports');
        await frame.evaluate(() => { const set = editor.setGuideBoxes.bind(editor); editor.setGuideBoxes = boxes => { window.guides = boxes; set(boxes); }; });
        const guides = (condition, arg) => frame.waitForFunction(condition, arg).then(() => frame.evaluate(() => window.guides));
        await page.keyboard.press('Control+z');
        await bbox.getByText('No boxes yet. Enable Draw boxes on canvas and drag on the drawing.', { exact: true }).waitFor();
        await page.keyboard.press('Control+y');
        const [first] = await guides(() => window.guides?.length === 1);
        const drag = async (from, to) => {
            await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 5 }); await page.mouse.up();
        };
        const centerX = view.x + view.width / 2, centerY = view.y + view.height / 2;
        await drag({ x: centerX, y: centerY - 40 }, { x: centerX + 20, y: centerY - 40 });
        const [moved] = await guides(x => window.guides[0].x !== x, first.x);
        assert(moved.x > first.x); assert.equal(moved.y, first.y); assert.equal(moved.width, first.width, 'Dragging an edge moves the box');
        await drag({ x: centerX + 60, y: centerY + 40 }, { x: centerX + 80, y: centerY + 60 });
        const [resized] = await guides(width => window.guides[0].width !== width, moved.width);
        assert.equal(resized.x, moved.x); assert(resized.width > moved.width && resized.height > moved.height, 'Dragging a corner resizes the box');
        await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
        assert.deepEqual((await guides(x => window.guides[0].x === x, first.x))[0], first, 'Undo restores moved and resized boxes');
        assert.equal(await frame.evaluate(() => editor.getRevision()), revisionBeforeBoxes, 'Box undo does not touch the drawing history');
        await drag({ x: centerX + 60, y: centerY + 60 }, { x: centerX + 100, y: centerY + 100 });
        const [, second] = await guides(() => window.guides.length === 2);
        assert.equal(first.color, '#3584ff'); assert.equal(second.color, '#e01b9b', 'New boxes get the next unused color');
        await page.keyboard.press('Control+z'); await guides(() => window.guides.length === 1);
        await bbox.getByLabel('Box 1 color', { exact: true }).fill('#2ec27e');
        assert.equal((await guides(() => window.guides[0].color === '#2ec27e'))[0].label, '1 · Object');
        await bbox.getByLabel('Box 1 type', { exact: true }).selectOption('character');
        await bbox.getByLabel('Box 1 description', { exact: true }).fill('A girl with fennec ears');
        await bbox.getByLabel('Draw boxes on canvas', { exact: true }).uncheck();
        await bbox.getByRole('button', { name: 'Generate BBox to Image', exact: true }).click();
        await bbox.getByText('AI layer added · Save to project to preserve it.', { exact: true }).waitFor();
        const graph = Object.values(queued.at(-1).prompt);
        const layout = graph.find(n => n.class_type === 'MOSSImageLayoutPrompt'), [drawn] = graph.find(n => n.class_type === 'CreateBoundingBoxes').inputs.editor_state.__value__;
        assert.equal(layout.inputs.character_boxes, '1'); assert.equal(drawn.metadata.desc, 'A girl with fennec ears');
        assert.deepEqual(drawn.metadata.palette, [], 'Box colors are not sent to the model');
        assert(Math.abs(drawn.x + drawn.width / 2 - layout.inputs.width / 2) < layout.inputs.width * .05 && drawn.width > 0, 'Canvas drag maps to drawing coordinates');
        assert.equal(uploads.length, uploadsBeforeBoxes, 'BBox to Image does not upload the drawing');
        const layerNames = await frame.evaluate(async () => (await editor.readPSD(await (await editor.getPSD()).arrayBuffer())).layers.map(l => l.name));
        assert.equal(layerNames.length, 5); assert(layerNames.at(-1).startsWith('BBox to Image'));
        await page.waitForTimeout(700);
        assert.equal((await (await fetch(`${backend.url}/manga-maker/projects/${backend.project}`)).json()).workspace.bbox_panels.boxes.length, 1);
        assert.equal(await bbox.getByLabel('BBox engine', { exact: true }).inputValue(), 'moss');
        await bbox.getByLabel('BBox engine', { exact: true }).selectOption('qwen');
        assert.equal(await bbox.getByLabel('Box 1 description', { exact: true }).inputValue(), 'A girl with fennec ears', 'Boxes are shared by every engine');
        await bbox.locator('summary').filter({ hasText: 'Models and advanced settings' }).click();
        for (const [label, node, key] of [['Diffusion model', 'UNETLoader', 'unet_name'], ['Text encoder', 'CLIPLoader', 'clip_name'], ['VAE', 'VAELoader', 'vae_name']]) {
            await bbox.getByLabel(label, { exact: true }).fill(options(defs, node, key)[0]);
            await bbox.getByLabel(label, { exact: true }).press('Tab');
        }
        await bbox.getByRole('button', { name: 'Generate BBox to Image', exact: true }).click();
        await bbox.getByText('AI layer added · Save to project to preserve it.', { exact: true }).waitFor();
        const qwen = queued.at(-1).prompt, layoutId = Object.keys(qwen).find(id => qwen[id].class_type === 'MOSSImageLayoutPrompt');
        assert.deepEqual(Object.values(qwen).find(n => n.class_type === 'TextEncodeQwenImage21').inputs.prompt, [layoutId, 0], 'Qwen receives the MOSS layout prompt');
        assert.equal(Object.values(qwen).find(n => n.class_type === 'CreateBoundingBoxes').inputs.editor_state.__value__[0].metadata.desc, 'A girl with fennec ears');
        assert.equal((await frame.evaluate(async () => (await editor.readPSD(await (await editor.getPSD()).arrayBuffer())).layers.length)), 5, 'Each engine updates the same BBox layer');
        await bbox.getByLabel('BBox engine', { exact: true }).selectOption('moss');
        await choose(bbox, 'Drawing workflow', 'sketch');
    }
    await dialog.getByRole('button', { name: 'Save to project', exact: true }).click();
    await dialog.getByText('Saved to project · Layers preserved', { exact: true }).waitFor();
    const saved = await (await fetch(`${backend.url}/manga-maker/projects/${backend.project}`)).json();
    assert.equal(saved.assets.length, 9); const asset = saved.assets.find(a => a.name === 'AI panel sketch'); assert(asset.metadata.drawing_document);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await studio.getByRole('button', { name: 'Back to ComfyUI', exact: true }).click();
    const graphAfter = await page.evaluate(() => window.comfyAPI.app.app.graph.serialize());
    delete graphBefore.extra.k2cf_state_id; delete graphAfter.extra.k2cf_state_id; assert.deepEqual(graphAfter, graphBefore);
    assert.deepEqual(errors, []);
    if (process.argv[4]) console.log('Art to Manga Panel passed: Lite/Qwen graphs, editable layer reuse, preserved aspect ratio, undo/redo and independent Sketch settings.');
    if (process.argv[4]) console.log('BBox to Image passed: boxes drawn, moved, resized, colored and undone on the Klecks canvas, excluded from drawing history and exports, MOSS layout prompt for MOSS and Qwen without uploads, shared boxes, editable layer and saved boxes.');
    console.log('Sketch to Art passed: mask crop/stitch, protected holes, repeated masked layer updates and native undo,  whole-canvas/region pixels, feather and 50% opacity, editable reused layer with native undo/redo, sampler settings, release-only pen realtime, one job at a time, stale result skipped, targeted cancel, layered save and unchanged Comfy graph.');
} catch (error) {
    await page.screenshot({ path: '/tmp/manga-sketch-error.png' }); console.error((await page.locator('.mm-studio').innerText().catch(() => 'Studio closed')).slice(-9000), errors); throw error;
} finally {
    await page.unrouteAll({ behavior: 'wait' }); await browser.close(); fixture.kill();
}
