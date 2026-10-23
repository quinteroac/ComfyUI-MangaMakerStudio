import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pageAnalysisInstructions } from '../web/page-analysis.js';
import { buildPrompt, initialSettings, options, composePrompt, referencePrompt, parsePrompt, referencePresets, refinementPresets, promptSections, textInstruction, textGeneratorDefaults } from '../web/prompts.js';

const defs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const [presets, task] of [[referencePresets, 'TEXT_TO_IMAGE'], [refinementPresets, 'IMAGE_EDIT']]) {
    for (const preset of Object.values(presets)) {
        assert.equal(preset.prompt, ''); assert.equal(preset.prompt_sections.task, task);
        assert(Object.keys(preset.prompt_sections).every(key => key === 'task' || promptSections.some(([name]) => name === key)));
        assert.deepEqual(parsePrompt(composePrompt(preset)), preset);
        assert(!Object.keys(preset).some(key => ['model', 'encoder', 'vae', 'steps', 'loras'].includes(key)));
    }
}
const configs = {};
for (const engine of ['krea', 'qwen']) {
    const cfg = initialSettings(engine);
    cfg.model = options(defs, 'UNETLoader', 'unet_name')[0]; cfg.encoder = options(defs, 'CLIPLoader', 'clip_name')[0]; cfg.vae = options(defs, 'VAELoader', 'vae_name')[0];
    cfg.analysis_encoder = cfg.encoder;
    const loras = options(defs, 'LoraLoader', 'lora_name');
    cfg.loras = [{ name: loras[0], enabled: true, model: .7, clip: .2 }, { name: loras[1], enabled: false, model: .9, clip: .3 }, { name: loras[2] || loras[0], enabled: true, model: .4, clip: .1 }];
    configs[engine] = cfg;
}
const jobs = [];
{
    const cfg = { ...configs.krea,
        identity_lora: options(defs, 'LoraLoaderModelOnly', 'lora_name')[2], shift: 1.15, denoise: .3, steps: 1, cfg: 1 };
    const built = buildPrompt(defs, 'sketch', 'krea_edit', cfg, ['sketch.png'], crypto.randomUUID());
    const nodes = Object.values(built.graph), patch = nodes.find(n => n.class_type === 'Krea2EditModelPatch');
    const sampler = nodes.find(n => n.class_type === 'KSampler');
    const grounded = nodes.find(n => n.class_type === 'Krea2EditGroundedEncode');
    assert.deepEqual(patch.inputs.source_image, grounded.inputs.image);
    assert.equal(built.graph[patch.inputs.source_image[0]].class_type, 'LoadImage');
    assert.deepEqual(built.graph[patch.inputs.source_latent[0]].inputs.pixels, patch.inputs.source_image);
    assert.deepEqual(sampler.inputs.latent_image, patch.inputs.source_latent);
    assert.deepEqual(patch.inputs.target_latent, sampler.inputs.latent_image);
    assert.equal(sampler.inputs.denoise, .3); assert.equal(sampler.inputs.steps, 1);
    const shift = built.graph[sampler.inputs.model[0]]; assert.equal(shift.class_type, 'ModelSamplingFlux');
    assert.equal(shift.inputs.base_shift, 1.15); assert.equal(shift.inputs.max_shift, 1.15);
    assert.equal(built.graph[shift.inputs.model[0]].class_type, 'Krea2EditModelPatch');
    assert.equal(nodes.filter(n => n.class_type === 'LoraLoaderModelOnly').length, 2);
    assert(!nodes.some(n => n.class_type === 'EmptyImage' || n.class_type === 'LatentMultiply'));
    assert.equal(built.graph[built.outputNode].class_type, 'PreviewImage');
    jobs.push({ engine: 'krea_edit', op: 'sketch', count: 1, ...built });
}

for (const count of [2, 4]) for (let index = 0; index < count; index++) for (const mode of ['original', 'manual']) {
    const config = { ...configs.krea, engine: 'krea_edit',
        latent_reference_index: index, size_mode: mode, aspect_ratio: '9:16', megapixels: 1.5, denoise: 0.4 };
    const paths = ['scene.png', 'subject.png', 'third.png', 'fourth.png'].slice(0, count);
    const built = buildPrompt(defs, 'panels', 'krea_edit', config, paths, crypto.randomUUID());
    const sampler = Object.values(built.graph).find(n => n.class_type === 'KSampler');
    const patch = Object.values(built.graph).find(n => n.class_type === 'Krea2EditModelPatch');
    assert.equal(sampler.inputs.denoise, .4); assert.deepEqual(patch.inputs.target_latent, sampler.inputs.latent_image);
    assert(!Object.values(built.graph).some(n => n.class_type === 'EmptyImage' || n.class_type === 'LatentMultiply'));
    const encoded = built.graph[sampler.inputs.latent_image[0]]; assert.equal(encoded.class_type, 'VAEEncode');
    let pixels = encoded.inputs.pixels; const resized = built.graph[pixels[0]];
    if (mode === 'manual') {
        assert.equal(resized.class_type, 'ImageScale'); assert.equal(resized.inputs.width, 920); assert.equal(resized.inputs.height, 1632);
        pixels = resized.inputs.image;
    } else assert.deepEqual(sampler.inputs.latent_image, patch.inputs[['source_latent', 'source_latent_b', 'source_latent_c', 'source_latent_d'][index]]);
    assert.equal(built.graph[pixels[0]].inputs.image, paths[index]);
    assert.equal(built.graph[patch.inputs.source_image[0]].inputs.image, 'scene.png');
    assert.equal(built.graph[patch.inputs.source_image_b[0]].inputs.image, 'subject.png');
    jobs.push({ engine: 'krea_edit', op: 'panels', count, ...built });
}
assert.throws(() => buildPrompt(defs, 'references', 'krea_edit', { ...configs.krea, latent_reference_index: 1 }, ['scene.png'], crypto.randomUUID()), /not connected/);
for (const [engine, operation, images] of [
    ['krea', 'references', []], ['krea', 'panels', []], ['krea', 'refine', ['source.png']],
    ['krea', 'references', ['source.png']], ['krea_edit', 'references', ['source.png']], ['krea_edit', 'panels', ['source.png']],
]) {
    const config = { ...configs.krea, shift: 2.35 };
    const built = buildPrompt(defs, operation, engine, config, images, crypto.randomUUID());
    const shift = Object.entries(built.graph).find(([, n]) => n.class_type === 'ModelSamplingFlux');
    assert.equal(shift[1].inputs.base_shift, 2.35); assert.equal(shift[1].inputs.max_shift, 2.35);
    const sampler = Object.values(built.graph).find(n => n.class_type === 'KSampler' || n.class_type === 'BasicGuider');
    let model = sampler.inputs.model;
    while (model[0] !== shift[0]) model = built.graph[model[0]].inputs.model;
    const scheduler = Object.values(built.graph).find(n => n.class_type === 'BasicScheduler');
    if (scheduler) assert.deepEqual(scheduler.inputs.model, sampler.inputs.model);
    const inherited = buildPrompt(defs, operation, engine, { ...config, shift: '' }, images, crypto.randomUUID());
    assert(!Object.values(inherited.graph).some(n => n.class_type === 'ModelSamplingFlux'));
    jobs.push({ engine, op: operation, count: images.length, ...built });
}
assert(!Object.values(buildPrompt(defs, 'references', 'qwen', { ...configs.qwen, shift: 2.35 }, [], crypto.randomUUID()).graph).some(n => n.class_type === 'ModelSamplingFlux'));
for (const task of ['enhance', 'describe']) {
    const context = { prompt_sections: { subject: 'A character.', style: 'Manga.' }, prompt: 'Keep the costume.' };
    const instruction = textInstruction(task, context, 'subject');
    const config = { ...textGeneratorDefaults, encoder: configs.krea.encoder, instruction };
    const built = buildPrompt(defs, task, 'text', config, task === 'describe' ? ['reference.png'] : [], crypto.randomUUID());
    const text = Object.values(built.graph).find(n => n.class_type === 'TextGenerate');
    assert.equal(text.inputs.prompt, instruction);
    assert.equal(!!text.inputs.image, task === 'describe');
    assert(!Object.values(built.graph).some(n => ['UNETLoader', 'VAELoader', 'KSampler'].includes(n.class_type)));
    if (task === 'enhance') { assert(instruction.includes('Improve only the Subject')); assert(instruction.includes('[Style] Manga.')); }
    jobs.push({ engine: 'text', op: task, count: task === 'describe' ? 1 : 0, ...built });
}
assert.equal(referencePrompt({ kind: 'references', metadata: { description_prompt: '[Subject] Imported character.\n\n[Style] Manga.' } }).prompt_sections.subject, 'Imported character.');
assert.equal(parsePrompt('No recognizable sections.'), null);
const sections = { task: 'TEXT_TO_IMAGE', subject: 'One adult woman on a couch.', appearance: 'Blue eyes and a black dress.', pose: 'Seated, looking forward.', lighting: '  \n ', style: 'Anime illustration.' };
const free = 'Keep the costume consistent.';
const reference = { kind: 'references', metadata: { settings: { prompt_sections: sections, prompt: free } } };
const restored = referencePrompt(reference);
assert.equal(restored.prompt_sections.subject, sections.subject);
assert.equal(restored.prompt, free);
restored.prompt_sections.subject = 'Changed';
assert.equal(reference.metadata.settings.prompt_sections.subject, sections.subject);
for (const asset of [{ kind: 'references' }, { ...reference, deleted: true }, { ...reference, missing: true }]) assert.equal(referencePrompt(asset), null);
assert.deepEqual(referencePrompt({ kind: 'references', metadata: { settings: { prompt: 'Extra instruction.\n\n[TASK: TEXT_TO_IMAGE]\n\n[Subject] A character.\nWith long hair.\n\n[Style] Manga.' } } }), { prompt_sections: { task: 'TEXT_TO_IMAGE', subject: 'A character.\nWith long hair.', style: 'Manga.' }, prompt: 'Extra instruction.' });
for (const kind of ['references', 'panels', 'pages']) {
    assert.deepEqual(referencePrompt({ ...reference, kind }), referencePrompt(reference));
    assert.deepEqual(referencePrompt({ kind, metadata: { settings: { prompt: 'An unstructured prompt.' } } }), { prompt_sections: {}, prompt: 'An unstructured prompt.' });
}
assert.deepEqual(referencePrompt({ kind: 'references', metadata: { settings: { prompt: '[TASK: IMAGE_EDIT]\nFree instructions.' } } }), { prompt_sections: { task: 'IMAGE_EDIT' }, prompt: 'Free instructions.' });
const expected = '[TASK: TEXT_TO_IMAGE]\n\n[Subject] One adult woman on a couch.\n\n[Appearance] Blue eyes and a black dress.\n\n[Pose] Seated, looking forward.\n\n[Style] Anime illustration.\n\nKeep the costume consistent.';
assert.equal(composePrompt({ prompt_sections: sections, prompt: free }), expected);
assert.equal(composePrompt({ prompt_sections: { lighting: '  ' }, prompt: '  free prompt\n' }), '  free prompt\n');
assert.equal(composePrompt({ prompt_sections: {}, prompt: '' }), '');
assert.equal(composePrompt({ prompt_sections: { ...sections, pose: 'Standing.' }, prompt: free }), expected.replace('Seated, looking forward.', 'Standing.'));
for (const engine of ['krea', 'qwen']) {
    const config = { ...configs[engine], prompt_sections: sections, prompt: free };
    const built = buildPrompt(defs, 'references', engine, config, [], crypto.randomUUID());
    const type = engine === 'qwen' ? 'TextEncodeQwenImage21' : 'CLIPTextEncode';
    const encoder = Object.values(built.graph).find(n => n.class_type === type);
    assert.equal(encoder.inputs[engine === 'qwen' ? 'prompt' : 'text'], expected);
    assert.equal(config.prompt, free); assert.equal(config.prompt_sections, sections);
    jobs.push({ engine, op: 'references', count: 0, ...built });
}
const finish = buildPrompt(defs, 'finish', 'qwen', { ...configs.qwen, prompt_sections: sections, prompt: free }, ['page.png'], crypto.randomUUID());
assert.equal(Object.values(finish.graph).find(n => n.class_type === 'TextEncodeQwenImage21').inputs.prompt, expected);
jobs.push({ engine: 'qwen', op: 'finish', count: 1, ...finish });
for (const engine of ['krea', 'qwen']) {
    for (const op of ['references', 'panels', 'refine', ...(engine === 'qwen' ? ['finish'] : [])]) {
        for (const count of [0, 1, engine === 'qwen' ? 7 : 2]) {
            if (op === 'refine' && !count || op === 'finish' && !count) continue;
            const images = Array.from({ length: count }, (_, i) => `ref-${i}.png`);
            const built = buildPrompt(defs, op, engine, configs[engine], images, crypto.randomUUID());
            const nodes = Object.values(built.graph); const loras = Object.entries(built.graph).filter(([, n]) => n.class_type === 'LoraLoader');
            assert.equal(loras.length, 2); assert.deepEqual(loras[1][1].inputs.model, [loras[0][0], 0]);
            const sampler = nodes.find(n => n.class_type === (engine === 'krea' && !(count && op !== 'refine') ? 'BasicGuider' : 'KSampler'));
            let model = sampler.inputs.model;
            while (built.graph[model[0]].class_type !== 'LoraLoader') model = built.graph[model[0]].inputs.model;
            assert.deepEqual(model, [loras[1][0], 0]);
            assert.equal(nodes.filter(n => n.class_type === 'SaveImage').length, 1);
            assert.equal(nodes.filter(n => n.class_type === 'LoadImage').length, count);
            if (engine === 'qwen') {
                const encoding = nodes.find(n => n.class_type === 'TextEncodeQwenImage21');
                assert.equal(Object.keys(encoding.inputs).filter(k => k.startsWith('images.')).length, count);
                assert.equal(encoding.inputs.resolution, 0);
                if (count) assert.equal(built.graph[sampler.inputs.latent_image[0]].class_type, 'TextEncodeQwenImage21');
            } else if (count && op !== 'refine') {
                assert(nodes.some(n => n.class_type === 'Krea2EditModelPatch'));
                assert(!nodes.some(n => n.class_type.includes('Ostris')));
                assert.equal(Object.keys(nodes.find(n => n.class_type === 'Krea2EditGroundedEncode').inputs).filter(k => /^image(_b)?$/.test(k)).length, count);
            }
            jobs.push({ engine, op, count, ...built });
        }
    }
}
for (const operation of ['references', 'panels']) for (const count of [1, 2, 3, 4]) {
    const cfg = { ...configs.krea, ...initialSettings('krea_edit'), model: configs.krea.model, encoder: configs.krea.encoder, vae: configs.krea.vae,
        loras: configs.krea.loras,
        prompt_sections: sections, prompt: free, ref_boost: 1.3, ref_boost_a: 0.8, fit_mode: 'fit', grounding_px: 768 };
    const built = buildPrompt(defs, operation, 'krea_edit', cfg, ['scene.png', 'subject.png', 'third.png', 'fourth.png'].slice(0, count), crypto.randomUUID());
    const graph = built.graph, nodes = Object.values(graph);
    const patch = nodes.find(n => n.class_type === 'Krea2EditModelPatch');
    const sampler = nodes.find(n => n.class_type === 'KSampler');
    const grounded = nodes.find(n => n.class_type === 'Krea2EditGroundedEncode');
    assert.equal(grounded.inputs.prompt, expected);
    assert.equal(graph[grounded.inputs.image[0]].inputs.image, 'scene.png');
    assert.equal(!!grounded.inputs.image_b, count >= 2);
    assert.deepEqual(patch.inputs.target_latent, sampler.inputs.latent_image);
    assert.deepEqual(patch.inputs.source_image, grounded.inputs.image);
    assert.equal(graph[patch.inputs.source_latent[0]].class_type, 'VAEEncode');
    assert.equal(!!patch.inputs.source_latent_b, count >= 2);
    if (count >= 2) { assert.deepEqual(patch.inputs.source_image_b, grounded.inputs.image_b); assert.equal(graph[grounded.inputs.image_b[0]].inputs.image, 'subject.png'); }
    for (const [i, suffix] of ['', '_b', '_c', '_d'].entries()) {
        assert.equal(!!grounded.inputs[`image${suffix}`], i < count);
        assert.equal(!!patch.inputs[`source_latent${suffix}`], i < count);
        if (i >= count) continue;
        assert.deepEqual(patch.inputs[`source_image${suffix}`], grounded.inputs[`image${suffix}`]);
        assert.deepEqual(graph[patch.inputs[`source_latent${suffix}`][0]].inputs.pixels, grounded.inputs[`image${suffix}`]);
        assert.equal(graph[grounded.inputs[`image${suffix}`][0]].inputs.image, ['scene.png', 'subject.png', 'third.png', 'fourth.png'][i]);
    }
    assert.equal(patch.inputs.ref_boost, 1.3); assert.equal(patch.inputs.ref_boost_a, 0.8);
    assert.equal(sampler.inputs.denoise, 1); assert.equal(sampler.inputs.steps, 4);
    assert.equal(graph[sampler.inputs.negative[0]].class_type, 'ConditioningZeroOut');
    const loras = Object.entries(graph).filter(([, n]) => n.class_type === 'LoraLoaderModelOnly');
    assert.equal(loras.length, 2); assert.deepEqual(loras[1][1].inputs.model, [loras[0][0], 0]);
    const shifted = graph[patch.inputs.model[0]];
    assert.equal(shifted.class_type, 'ModelSamplingFlux');
    assert.equal(shifted.inputs.max_shift, 1.15); assert.equal(shifted.inputs.base_shift, 1.15);
    const attention = graph[shifted.inputs.model[0]];
    assert.equal(attention.class_type, 'ModelAttentionBackend');
    assert.deepEqual(attention.inputs.model, [loras[1][0], 0]);
    assert(!nodes.some(n => n.class_type.includes('Ostris') || n.class_type === 'LoraLoader'));
    jobs.push({ engine: 'krea_edit', op: operation, count, ...built });
}
for (const count of [0, 5]) assert.throws(() => buildPrompt(defs, 'references', 'krea_edit', configs.krea, Array(count).fill('image.png'), crypto.randomUUID()), /at least one|up to four/);
for (const duplicate of [false, true]) {
    const identity = options(defs, 'LoraLoaderModelOnly', 'lora_name')[0];
    const cfg = { ...configs.krea, identity_lora: identity, loras: duplicate ? [{ name: identity, enabled: true, model: .6 }] : [] };
    const built = buildPrompt(defs, 'panels', 'krea_edit', cfg, ['original.png'], crypto.randomUUID());
    const loras = Object.entries(built.graph).filter(([, n]) => n.class_type === 'LoraLoaderModelOnly');
    assert.equal(loras.length, 1); assert.equal(loras[0][1].inputs.lora_name, identity); assert.equal(loras[0][1].inputs.strength_model, duplicate ? .6 : 1);
    const shifted = built.graph[Object.values(built.graph).find(n => n.class_type === 'Krea2EditModelPatch').inputs.model[0]];
    assert.equal(shifted.class_type, 'ModelSamplingFlux');
    const attention = built.graph[shifted.inputs.model[0]];
    assert.equal(attention.class_type, 'ModelAttentionBackend'); assert.deepEqual(attention.inputs.model, [loras[0][0], 0]);
    jobs.push({ engine: 'krea_edit', op: 'panels', count: 1, ...built });
}
assert(pageAnalysisInstructions.refine.includes("Refine image 1 while preserving the user's exact layout"));
assert(pageAnalysisInstructions.redesign.includes('Finish image 1 as a professional manga page'));
assert.notEqual(pageAnalysisInstructions.refine, pageAnalysisInstructions.redesign);
for (const finish_mode of ['refine', 'redesign']) {
    const built = buildPrompt(defs, 'analysis', 'qwen', { ...configs.qwen, finish_mode, analysis_prompt: 'Old generic instruction' }, ['page.png'], crypto.randomUUID());
    assert.equal(Object.values(built.graph).find(n => n.class_type === 'TextGenerate').inputs.prompt, pageAnalysisInstructions[finish_mode]);
}
const analysis = buildPrompt(defs, 'analysis', 'qwen', configs.qwen, ['page.png'], crypto.randomUUID());
for (const [engine, operations] of [['qwen', ['references', 'panels', 'refine', 'finish']], ['krea', ['refine']]]) {
    for (const op of operations) for (const mode of ['original', 'manual']) {
        const config = { ...configs[engine], size_mode: mode, aspect_ratio: '9:16', megapixels: 1.5 };
        const built = buildPrompt(defs, op, engine, config, ['original.png', ...(engine === 'qwen' ? ['second.png'] : [])], crypto.randomUUID());
        const scale = Object.entries(built.graph).find(([, n]) => n.class_type === 'ImageScale');
        assert.equal(!!scale, mode === 'manual');
        if (scale) {
            assert.equal(scale[1].inputs.width, engine === 'qwen' ? 928 : 920);
            assert.equal(scale[1].inputs.height, 1632);
            assert.equal(scale[1].inputs.crop, 'center');
            assert.equal(built.graph[scale[1].inputs.image[0]].inputs.image, 'original.png');
            const consumer = Object.values(built.graph).find(n => n.class_type === (engine === 'qwen' ? 'TextEncodeQwenImage21' : 'VAEEncode'));
            assert.deepEqual(consumer.inputs[engine === 'qwen' ? 'images.image_1' : 'pixels'], [scale[0], 0]);
            if (engine === 'qwen') assert.equal(built.graph[consumer.inputs['images.image_2'][0]].inputs.image, 'second.png');
        }
        jobs.push({ engine, op, count: engine === 'qwen' ? 2 : 1, ...built });
    }
}
for (const [size, expected] of [[{ aspect_ratio: '9:16', megapixels: 1.5 }, [920, 1632]], [{ aspect_ratio: '16:9', megapixels: 1.5 }, [1632, 920]], [{ width: 1024, height: 1536 }, [1024, 1536]]]) {
    const config = { ...configs.krea, ...size };
    if (size.width) { delete config.aspect_ratio; delete config.megapixels; }
    const built = buildPrompt(defs, 'panels', 'krea', config, [], crypto.randomUUID());
    const image = Object.values(built.graph).find(n => n.class_type === 'EmptyImage');
    assert.deepEqual([image.inputs.width, image.inputs.height], expected);
}
assert(!Object.values(analysis.graph).some(n => n.class_type === 'UNETLoader'));
assert.equal(Object.values(analysis.graph).find(n => n.class_type === 'TextGenerate').inputs.sampling_mode, 'off');
assert.equal(Object.values(analysis.graph).filter(n => n.class_type === 'SaveText').length, 1);
assert.throws(() => buildPrompt({}, 'panels', 'krea', configs.krea, [], crypto.randomUUID()), /Missing node/);
assert.throws(() => buildPrompt(defs, 'panels', 'krea', { ...configs.krea, model: 'missing' }, [], crypto.randomUUID()), /missing or unregistered selection/);
for (const job of jobs) {
    assert(!Object.values(job.graph).some(node => node.class_type === 'FluxKontextImageScale'));
    const attention = Object.entries(job.graph).filter(([, node]) => node.class_type === 'ModelAttentionBackend');
    if (job.engine === 'qwen') { assert.equal(attention.length, 0); continue; }
    if (!Object.values(job.graph).some(node => node.class_type === 'UNETLoader')) continue;
    assert.equal(attention.length, 1);
    assert.equal(attention[0][1].inputs.attention, 'comfy kitchen attention');
    assert(['LoraLoader', 'LoraLoaderModelOnly', 'UNETLoader'].includes(job.graph[attention[0][1].inputs.model[0]].class_type));
}
for (const engine of ['krea', 'krea_edit']) {
    const config = { ...configs.krea };
    const paths = engine === 'krea_edit' ? ['source.png'] : [];
    for (const [schema, attention] of [[defs, 'pytorch attention'], [{ ...defs, ModelAttentionBackend: { ...defs.ModelAttentionBackend, input: { required: { model: ['MODEL'], attention: [['pytorch attention']] } } } }, '']]) {
        const built = buildPrompt(schema, 'references', engine, { ...config, attention }, paths, crypto.randomUUID());
        assert.equal(Object.values(built.graph).find(node => node.class_type === 'ModelAttentionBackend').inputs.attention, 'pytorch attention');
    }
}
fs.writeFileSync('/tmp/manga-built-prompts.json', JSON.stringify([...jobs, { engine: 'qwen', op: 'analysis', count: 1, ...analysis }]));
console.log(`${jobs.length + 1} rutas: LoRAs conectadas, referencias reales, análisis aislado, resultados únicos y errores de dependencias.`);
