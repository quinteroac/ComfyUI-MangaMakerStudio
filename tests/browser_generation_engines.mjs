import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url), { chromium } = require(process.argv[2]);
const root = path.resolve(import.meta.dirname, '..');
const fixture = spawn(process.argv[3], [path.join(root, 'tests/browser_backend.py')], { stdio: ['ignore', 'pipe', 'pipe'] });
fixture.stderr.on('data', b => process.stderr.write(b));
const [chunk] = await once(fixture.stdout, 'data'), backend = JSON.parse(chunk.toString());
const defs = JSON.parse(await fs.readFile(process.argv[4] || '/tmp/manga-object-info.json', 'utf8'));
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const queued = [];
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
        await route.fulfill({ response: await route.fetch({ url: backend.url + pathname + url.search }) });
    });
    await page.route(/\/(?:api\/)?prompt$/, async route => {
        const body = route.request().postDataJSON(); queued.push(body);
        const response = await fetch(`${backend.url}/test/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        await route.fulfill({ json: await response.json() });
    });
    await page.goto(process.env.COMFY_URL || 'http://127.0.0.1:8188', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.comfyAPI?.app?.app?.graph && window.comfyAPI.app.app.extensions.some(e => e.name === 'MangaMaker.Studio'));
    await page.waitForTimeout(2500);
    const graphBefore = await page.evaluate(() => {
        const app = window.comfyAPI.app.app, graph = app.graph.serialize();
        app.extensions.find(e => e.name === 'MangaMaker.Studio').commands[0].function(); return graph;
    });
    const studio = page.locator('.mm-studio'); await studio.waitFor();
    for (const space of ['references', 'panels']) {
        await studio.getByRole('button', { name: space === 'references' ? 'References' : 'Panels', exact: true }).click();
        const view = studio.locator(`.mm-${space}`);
        for (const engine of ['moss', 'anima']) {
            await view.getByLabel('Engine', { exact: true }).selectOption(engine);
            assert.equal(await view.getByText('Connected visual references', { exact: true }).count(), 0);
            await view.locator('summary').filter({ hasText: /^Models and advanced settings$/ }).click();
            assert.equal(await view.getByLabel('Encoder loading type', { exact: true }).inputValue(), engine === 'moss' ? 'moss_image' : 'qwen_image');
            assert.equal(await view.getByRole('button', { name: 'Download missing official weights', exact: true }).count(), 0);
            if (engine === 'moss') assert.equal(await view.getByLabel('Eight-step LoRA', { exact: true }).inputValue(), 'moss/lora.safetensors');
            await view.locator('summary').filter({ hasText: /^Sampling$/ }).click();
            if (engine === 'anima') assert((await view.getByLabel('Negative prompt', { exact: true }).inputValue()).includes('worst quality'));
            await view.getByLabel('Resolution · MP', { exact: true }).fill('0.5');
            await view.getByLabel('Resolution · MP', { exact: true }).press('Tab');
            const before = queued.length;
            await view.getByRole('button', { name: space === 'references' ? 'Generate reference' : 'Generate panel', exact: true }).click();
            await page.waitForTimeout(1000);
            assert.equal(queued.length, before + 1, await studio.locator('.mm-error').textContent());
            const nodes = Object.values(queued.at(-1).prompt);
            const sampler = nodes.find(n => n.class_type === 'KSampler');
            assert.equal(sampler.inputs.steps, 8); assert.equal(sampler.inputs.cfg, 1); assert.equal(sampler.inputs.sampler_name, 'er_sde');
            assert(nodes.some(n => n.class_type === (engine === 'moss' ? 'EmptyFlux2LatentImage' : 'EmptyLatentImage')));
            await page.waitForTimeout(2200);
        }
    }
    assert.deepEqual(await page.evaluate(() => window.comfyAPI.app.app.graph.serialize()), graphBefore);
    assert.deepEqual(errors, []);
    console.log('Moss and Anima: selection, inherited settings, negative prompt, AR/MP and four simulated generations passed; open graph unchanged.');
} finally { await page.unrouteAll({ behavior: 'wait' }); await browser.close(); fixture.kill(); }
