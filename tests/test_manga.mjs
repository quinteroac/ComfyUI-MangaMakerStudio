import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mangaDefaults, buildMangaPrompt } from '../web/manga-prompt.js';
import { initialSettings, options } from '../web/prompts.js';

const defs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const cfg = { ...initialSettings('qwen'), ...mangaDefaults,
    model: options(defs, 'UNETLoader', 'unet_name')[0], encoder: options(defs, 'CLIPLoader', 'clip_name')[0], vae: options(defs, 'VAELoader', 'vae_name')[0] };
const graphs = [];
for (const mode of ['lite', 'qwen']) for (const pen_lines of [false, true]) {
    const built = buildMangaPrompt(defs, { ...cfg, mode, pen_lines }, 'art.png');
    const nodes = Object.values(built.graph);
    assert.equal(nodes.some(n => n.class_type === 'UNETLoader'), mode === 'qwen');
    assert.equal(nodes.some(n => n.class_type === 'MangaLevels'), mode === 'lite');
    assert.equal(nodes.some(n => n.class_type === 'Manga2Anime_LineArt_Preprocessor'), pen_lines);
    assert.equal(nodes.some(n => n.class_type === 'SaveImage'), false);
    assert.equal(built.graph[built.outputNode].class_type, 'PreviewImage');
    const finish = nodes.find(n => n.class_type === 'MangaFinish');
    assert.equal(finish.inputs.screen_lines, 250);
    assert.equal(!!finish.inputs.pen_lines, pen_lines);
    const panel = nodes.find(n => n.class_type === 'MangaPanel');
    assert.equal(built.graph[panel.inputs.image[0]].class_type, 'MangaFinish');
    if (mode === 'qwen') {
        const sample = nodes.find(n => n.class_type === 'SamplerCustomAdvanced');
        assert.equal(built.graph[sample.inputs.latent_image[0]].class_type, 'TextEncodeQwenImage21');
        assert.equal(sample.inputs.latent_image[1], 2);
        assert.equal(nodes.find(n => n.class_type === 'ManualSigmas').inputs.sigmas, mangaDefaults.sigmas);
    }
    graphs.push({ ...built, op: 'manga', count: mode === 'qwen' ? 1 : 0 });
}
const missing = { ...defs }; delete missing.MangaFinish;
assert.throws(() => buildMangaPrompt(missing, cfg, 'art.png'), /ComfyUI-MangaScreen/);
delete missing.Manga2Anime_LineArt_Preprocessor;
assert.throws(() => buildMangaPrompt(missing, { ...cfg, pen_lines: true }, 'art.png'), /comfyui_controlnet_aux/);
if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(graphs));
console.log('Manga graphs passed: Lite/Qwen, optional pen lines, source latent, workflow sigmas, panel chain, preview and missing dependencies.');
