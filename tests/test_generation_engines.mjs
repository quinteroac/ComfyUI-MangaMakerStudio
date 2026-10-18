import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPrompt, initialSettings, composePrompt, options } from '../web/prompts.js';
import { globalModels, inheritModels, applyPreset, savedPreset } from '../web/models.js';

const defs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const catalog = JSON.parse(fs.readFileSync(new URL('../model-catalog.json', import.meta.url)));
const settings = {}; globalModels(settings, catalog);
const jobs = [];
for (const engine of ['moss', 'anima']) for (const op of ['references', 'panels']) {
    const cfg = inheritModels({ ...initialSettings(engine), prompt_sections: { subject: 'A manga character.' }, aspect_ratio: '9:16' }, settings.models[engine], engine);
    const built = buildPrompt(defs, op, engine, cfg, [], `${engine}-${op}`);
    const nodes = Object.values(built.graph), sampler = nodes.find(n => n.class_type === 'KSampler');
    assert.equal(sampler.inputs.steps, 8); assert.equal(sampler.inputs.cfg, 1);
    assert.equal(sampler.inputs.sampler_name, 'er_sde'); assert.equal(sampler.inputs.scheduler, 'simple'); assert.equal(sampler.inputs.denoise, 1);
    assert.equal(built.graph[sampler.inputs.positive[0]].inputs.text, composePrompt(cfg));
    const negative = built.graph[sampler.inputs.negative[0]];
    assert.equal(negative.class_type, engine === 'moss' ? 'ConditioningZeroOut' : 'CLIPTextEncode');
    if (engine === 'moss') assert.deepEqual(negative.inputs.conditioning, sampler.inputs.positive);
    else assert.equal(negative.inputs.text, cfg.negative);
    const latent = built.graph[sampler.inputs.latent_image[0]];
    assert.equal(latent.class_type, engine === 'moss' ? 'EmptyFlux2LatentImage' : 'EmptyLatentImage');
    assert(latent.inputs.width < latent.inputs.height);
    assert(!nodes.some(n => ['TextEncodeQwenImage21', 'QwenImage21Cache', 'ModelSamplingFlux', 'SetNode', 'GetNode'].includes(n.class_type)));
    assert.equal(built.graph[built.outputNode].class_type, 'SaveImage');
    assert.throws(() => buildPrompt(defs, op, engine, cfg, ['source.png'], 'invalid'), /generates from text/);
    assert.throws(() => buildPrompt(defs, op, engine, { ...cfg, model: 'missing.safetensors' }, [], 'invalid'), /missing or unregistered/);
    jobs.push({ engine, op, count: 0, ...built });
    const extra = options(defs, 'LoraLoaderModelOnly', 'lora_name').find(name => name !== cfg.accelerator_lora);
    cfg.loras = [{ name: extra, model: .4, clip: .8, enabled: true }, { name: extra, model: .9, enabled: false }];
    if (engine === 'moss') cfg.loras.push({ name: cfg.accelerator_lora, model: .7, enabled: true });
    const chained = buildPrompt(defs, op, engine, cfg, [], 'loras');
    const loras = Object.values(chained.graph).filter(n => n.class_type === 'LoraLoaderModelOnly');
    assert.equal(loras.length, engine === 'moss' ? 2 : 1);
    assert.equal(loras.at(-1).inputs.strength_model, .4);
    if (engine === 'moss') { assert.equal(loras[0].inputs.lora_name, cfg.accelerator_lora); assert.equal(loras[0].inputs.strength_model, .7); }
    assert(!Object.values(chained.graph).some(n => n.class_type === 'LoraLoader'));
    jobs.push({ engine, op, count: 0, ...chained });
    applyPreset(cfg, { steps: 6, accelerator_lora: 'custom.safetensors' }); inheritModels(cfg, settings.models[engine], engine);
    assert.equal(cfg.steps, 6); assert.equal(savedPreset(cfg).model_overrides.accelerator_lora, 'custom.safetensors');
    applyPreset(cfg, { prompt: 'New prompt' }); inheritModels(cfg, settings.models[engine], engine);
    assert.equal(cfg.steps, 8); assert.equal(cfg.accelerator_lora, settings.models[engine].accelerator_lora || '');
}
fs.writeFileSync('/tmp/manga-generation-engines-graphs.json', JSON.stringify(jobs));
console.log(`${jobs.length} Moss/Anima graphs passed: workflow sampling, conditioning, latent types, LoRA order, overrides and model errors.`);
