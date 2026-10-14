import { analysisInstruction } from './page-analysis.js';
import { imageDimensions } from './size.js';

export const promptSections = [['subject', 'Subject'], ['appearance', 'Appearance'], ['pose', 'Pose'], ['expression', 'Expression'], ['composition', 'Composition'], ['environment', 'Environment'], ['lighting', 'Lighting'], ['style', 'Style']];
const referenceStyle = 'Neutral full-color reference illustration with natural colors, clear details and consistent rendering.';

export const referencePresets = {
    Character: { prompt: '', prompt_sections: {
        task: 'TEXT_TO_IMAGE',
        pose: 'Neutral standing pose with relaxed arms, showing the full body clearly.',
        expression: 'Neutral expression, consistent across views.',
        composition: 'Character reference sheet with front and side views at the same scale. Keep facial features, hairstyle, body proportions, clothing and accessories consistent across all views.',
        environment: 'Plain neutral background without distracting objects.',
        lighting: 'Even lighting that clearly reveals anatomy and costume details.',
        style: referenceStyle,
    } },
    Expressions: { prompt: '', prompt_sections: {
        task: 'TEXT_TO_IMAGE',
        pose: 'Consistent head angle and portrait framing across expressions.',
        expression: 'Distinct, readable emotions: neutral, happy, sad, angry, surprised and worried. Preserve facial identity in every expression.',
        composition: 'Expression reference sheet arranged as evenly spaced close-up portraits of the same character.',
        environment: 'Plain neutral background without distracting objects.',
        style: referenceStyle,
    } },
    Poses: { prompt: '', prompt_sections: {
        task: 'TEXT_TO_IMAGE',
        pose: 'Varied full-body poses with clear anatomy, balanced proportions and readable silhouettes. Preserve the same character identity and costume.',
        composition: 'Full-body pose reference sheet with separated figures, complete limbs and enough space to read each silhouette.',
        environment: 'Plain neutral background without distracting objects.',
        style: referenceStyle,
    } },
    Clothing: { prompt: '', prompt_sections: {
        task: 'TEXT_TO_IMAGE',
        pose: 'Neutral stance that clearly displays the outfit.',
        composition: 'Costume reference sheet with front and back views and close-ups of important fabric, fastenings and accessory details. Keep the outfit consistent across views.',
        environment: 'Plain neutral background without distracting objects.',
        lighting: 'Even lighting that reveals fabric construction, texture and folds.',
        style: referenceStyle,
    } },
    Objects: { prompt: '', prompt_sections: {
        task: 'TEXT_TO_IMAGE',
        composition: 'Object reference sheet with several clearly separated angles. Preserve the same shape, proportions, materials and identifying details in every view.',
        environment: 'Plain neutral background without distracting objects.',
        lighting: 'Clear lighting that reveals the object geometry and material details.',
        style: referenceStyle,
    } },
    Environments: { prompt: '', prompt_sections: {
        task: 'TEXT_TO_IMAGE',
        composition: 'Wide environment reference with readable perspective, coherent scale and clear foreground, middle ground and background. Show architectural and spatial details useful for consistent manga backgrounds.',
        style: referenceStyle,
    } },
};

export const refinementPresets = {
    General: { prompt: '', prompt_sections: {
        task: 'IMAGE_EDIT',
        appearance: 'Correct visible anatomical and proportion errors while preserving the original subjects, identities, hairstyles, clothing and accessories.',
        pose: 'Preserve the original poses and actions.',
        composition: 'Preserve the original framing, camera angle and composition. For a page, preserve panel boundaries and reading order.',
        style: 'Improve linework, rendering clarity and visual consistency while preserving the original artistic style.',
    } },
    Background: { prompt: '', prompt_sections: {
        task: 'IMAGE_EDIT',
        environment: 'Refine only the existing background: correct perspective and improve environmental detail without changing foreground subjects, objects or the scene content.',
        composition: 'Preserve framing, camera angle and foreground placement. For a page, preserve panel boundaries and reading order.',
    } },
    Hands: { prompt: '', prompt_sections: {
        task: 'IMAGE_EDIT',
        appearance: 'Correct only visible hand anatomy, finger structure and proportions. Preserve identity, clothing and all other image details.',
        pose: 'Preserve the existing hand gestures, contact with objects and overall body pose.',
    } },
    Face: { prompt: '', prompt_sections: {
        task: 'IMAGE_EDIT',
        appearance: 'Refine only facial anatomy and feature alignment while preserving the original facial identity, hairstyle and all other image details.',
        expression: 'Preserve the original emotion, gaze direction and expression while making them clearer.',
    } },
    'Color → Manga': { prompt: '', prompt_sections: {
        task: 'IMAGE_EDIT',
        composition: 'Preserve all subjects, actions, framing and scene content. For a page, preserve panel boundaries and reading order.',
        style: 'Convert the original image to black-and-white manga with clean ink lines, screentones, controlled blacks and readable silhouettes. Preserve fine details and visual hierarchy.',
    } },
};

export function referencePrompt(asset) {
    if (asset.deleted || asset.missing) return null;
    const settings = asset.metadata?.settings || {};
    const sections = {};
    for (const key of ['task', ...promptSections.map(([key]) => key)]) {
        const value = settings.prompt_sections?.[key];
        if (typeof value === 'string' && value.trim()) sections[key] = value;
    }
    const prompt = typeof settings.prompt === 'string' ? settings.prompt : '';
    if (Object.keys(sections).length) return { prompt_sections: sections, prompt };
    if (prompt.trim()) return parsePrompt(prompt) || { prompt_sections: {}, prompt };
    return parsePrompt(asset.metadata?.description_prompt || '');
}

export function parsePrompt(prompt) {
    const sections = {};
    const tags = [...prompt.matchAll(/^\s*\[(TASK\s*:\s*([^\]\n]+)|Subject|Appearance|Pose|Expression|Composition|Environment|Lighting|Style)\][ \t]*/gim)];
    const free = tags.length ? [prompt.slice(0, tags[0].index).trim()] : [];
    for (const [index, tag] of tags.entries()) {
        const key = tag[2] ? 'task' : tag[1].toLowerCase();
        const body = prompt.slice(tag.index + tag[0].length, tags[index + 1]?.index ?? prompt.length).trim();
        const value = tag[2]?.trim() || body;
        if (tag[2] && body) free.push(body);
        if (value) sections[key] = sections[key] ? `${sections[key]}\n\n${value}` : value;
    }
    return Object.keys(sections).length ? { prompt_sections: sections, prompt: free.filter(Boolean).join('\n\n') } : null;
}

export function composePrompt(config) {
    const sections = config.prompt_sections || {};
    const parts = [];
    if (sections.task?.trim()) parts.push(`[TASK: ${sections.task.trim()}]`);
    for (const [key, tag] of promptSections) {
        const value = sections[key]?.trim();
        if (value) parts.push(`[${tag}] ${value}`);
    }
    if (!parts.length) return config.prompt || '';
    if (config.prompt?.trim()) parts.push(config.prompt.trim());
    return parts.join('\n\n');
}

export function options(defs, node, field) {
    const input = defs[node]?.input;
    const spec = input?.required?.[field] || input?.optional?.[field];
    return Array.isArray(spec?.[0]) ? spec[0] : spec?.[1]?.options || [];
}

export function defaultAttention(defs, engine) {
    if (engine !== 'krea' && engine !== 'krea_edit') return '';
    return options(defs, 'ModelAttentionBackend', 'attention').includes('comfy kitchen attention') ? 'comfy kitchen attention' : 'pytorch attention';
}

export const textGeneratorDefaults = { encoder: '', encoder_type: 'stable_diffusion', encoder_device: 'default', max_length: 1024 };

export function textInstruction(task, config, section) {
    const format = 'Return only an image prompt in this format: [TASK: TEXT_TO_IMAGE], then [Subject], [Appearance], [Pose], [Expression], [Composition], [Environment], [Lighting], [Style]. Put each tag and its content on a separate paragraph. Omit empty sections. Do not use markdown fences or explanations.';
    if (task === 'describe') return `Describe the supplied image precisely so an image generator can recreate it. Include visible identity, clothing, pose, expression, framing, environment, lighting, art style and legible text. Do not invent details that are not visible. ${format}`;
    const name = section === 'free' ? 'free prompt' : promptSections.find(([key]) => key === section)[1];
    const value = section === 'free' ? config.prompt : config.prompt_sections?.[section] || '';
    return `Improve only the ${name} section for clarity and useful visual detail. Preserve its meaning, identity, exact text and constraints. Use the full prompt as context to avoid contradictions. Do not change other sections or invent unrelated details. Return only the improved content of this section, without tags, markdown fences or explanations.\n\nFull prompt context:\n${composePrompt(config)}\n\nSection to improve (${name}):\n${value}`;
}

export const initialSettings = (engine) => ({
    engine, model: '', encoder: '', vae: '', adapter: '', encoder_type: engine === 'qwen' ? 'qwen_image' : 'stable_diffusion',
    encoding: 'bridge', weight_dtype: 'default', encoder_device: 'default', prompt: '', prompt_sections: {}, negative: '',
    aspect_ratio: '1:1', megapixels: 1, seed: 0, random_seed: true, steps: engine === 'qwen' ? 8 : 12,
    cfg: 1, sampler: 'euler', scheduler: engine === 'qwen' ? 'beta' : 'simple', denoise: 0.65,
    attention: '', cache_device: 'auto', cache_dtype: 'default',
    ref_boost: 1, ref_boost_a: 1, fit_mode: 'fit', grounding_px: 768, grounding_system_prompt: '',
    references: [], loras: [], max_length: 512, analysis_prompts: {},
    analysis_encoder: '', analysis_encoder_type: 'stable_diffusion', finish_mode: 'refine',
    ...(engine === 'krea_edit' ? { encoding: 'native', encoder_type: 'krea2', steps: 4, latent_reference: '' } : {}),
    ...(['krea', 'krea_edit'].includes(engine) ? { shift: 1.15 } : {}),
});

export function buildPrompt(defs, operation, engine, config, imagePaths, jobId) {
    if (engine === 'krea_edit' && !imagePaths.length) throw new Error('Krea2 editing requires at least one reference image.');
    const sketch = operation === 'sketch' && engine === 'krea_edit';
    const isKrea = engine === 'krea' || engine === 'krea_edit';
    const kreaEditing = isKrea && imagePaths.length > 0 && operation !== 'refine';
    if (kreaEditing && imagePaths.length > 4) throw new Error('Krea2 editing supports up to four reference images.');
    const graph = {};
    let count = 0;
    const add = (type, inputs) => {
        if (!defs[type]) throw new Error(`Missing node ${type}. Install or enable its dependency and refresh the lists.`);
        const id = String(++count);
        graph[id] = { class_type: type, inputs };
        return [id, 0];
    };
    const check = (node, input, value, label) => {
        if (!defs[node]) throw new Error(`Missing node ${node}. Install or enable its dependency and refresh the lists.`);
        if (!value || !options(defs, node, input).includes(value)) throw new Error(`${label}: missing or unregistered selection (${value || 'not selected'}).`);
        return value;
    };
    const load = (name, type) => add('CLIPLoader', {
        clip_name: check('CLIPLoader', 'clip_name', name, 'Encoder'), type: check('CLIPLoader', 'type', type, 'Encoder type'), device: config.encoder_device,
    });
    const images = imagePaths.map(image => add('LoadImage', { image }));
    if (operation === 'enhance' || operation === 'describe') {
        if (operation === 'describe' && !images.length) throw new Error('Select a reference to analyze.');
        const clip = load(config.encoder, config.encoder_type);
        const text = add('TextGenerate', { clip, prompt: config.instruction, max_length: Number(config.max_length),
            sampling_mode: 'off', thinking: false, use_default_template: true, mtp: 'auto', ...(operation === 'describe' ? { image: images[0] } : {}) });
        const output = add('SaveText', { text, filename_prefix: `manga-maker/${jobId}/${operation}`, format: 'txt' });
        return { graph, outputNode: output[0] };
    }
    if (operation === 'analysis') {
        if (!images.length) throw new Error('Select a page to analyze.');
        const clip = load(config.analysis_encoder, config.analysis_encoder_type);
        const text = add('TextGenerate', { clip, prompt: analysisInstruction(config), image: images[0], max_length: Number(config.max_length),
            sampling_mode: 'off', thinking: false, use_default_template: true, mtp: 'auto' });
        const output = add('SaveText', { text, filename_prefix: `manga-maker/${jobId}/analysis`, format: 'txt' });
        return { graph, outputNode: output[0] };
    }
    if (images.length && config.size_mode === 'manual' && (engine === 'qwen' || operation === 'refine')) {
        images[0] = add('ImageScale', { image: images[0], upscale_method: 'lanczos', ...imageDimensions(config, engine === 'qwen' ? 32 : 8), crop: 'center' });
    }
    const prompt = composePrompt(config);
    let model = add('UNETLoader', { unet_name: check('UNETLoader', 'unet_name', config.model, 'Model'), weight_dtype: config.weight_dtype });
    let clip = load(config.encoder, config.encoder_type);
    const vae = add('VAELoader', { vae_name: check('VAELoader', 'vae_name', config.vae, 'VAE') });
    if (engine === 'krea_edit' && !sketch && config.identity_lora) {
        const identity = config.loras.find(l => l.enabled && l.name === config.identity_lora);
        model = add('LoraLoaderModelOnly', { model,
            lora_name: check('LoraLoaderModelOnly', 'lora_name', config.identity_lora, 'Identity Edit LoRA'), strength_model: Number(identity?.model ?? 1) });
    }
    for (const lora of config.loras.filter(l => l.enabled)) {
        if (engine === 'krea_edit' && !sketch && lora.name === config.identity_lora) continue;
        const type = engine === 'krea_edit' ? 'LoraLoaderModelOnly' : 'LoraLoader';
        check(type, 'lora_name', lora.name, 'LoRA');
        const loaded = add(type, { model, lora_name: lora.name, strength_model: Number(lora.model), ...(engine === 'krea_edit' ? {} : { clip, strength_clip: Number(lora.clip) }) });
        model = loaded; if (engine !== 'krea_edit') clip = [loaded[0], 1];
    }
    const attention = config.attention || defaultAttention(defs, engine);
    if (attention) {
        check('ModelAttentionBackend', 'attention', attention, 'Attention');
        model = add('ModelAttentionBackend', { model, attention });
    }
    if (isKrea && !sketch && config.shift !== '' && config.shift != null) {
        const shift = Number(config.shift);
        // Equal shifts make the patch independent of canvas resolution.
        model = add('ModelSamplingFlux', { model, max_shift: shift, base_shift: shift, width: 1024, height: 1024 });
    }
    let positive, negative, latent;
    if (isKrea) {
        if (kreaEditing) {
            const type = config.encoding === 'bridge' ? 'Krea2Qwen8BGroundedEncode' : 'Krea2EditGroundedEncode';
            const expected = config.encoding === 'bridge' ? 'stable_diffusion' : 'krea2';
            if (config.encoder_type !== expected) throw new Error(`This Krea2 editing path requires an encoder of type ${expected}.`);
            positive = add(type, { clip, prompt, ...Object.fromEntries(images.map((image, i) => [['image', 'image_b', 'image_c', 'image_d'][i], image])),
                grounding_px: Number(config.grounding_px ?? 768), system_prompt: config.grounding_system_prompt || '' });
        } else if (config.encoding === 'bridge') {
            if (config.encoder_type !== 'stable_diffusion') throw new Error('The Qwen-VL 8B bridge requires CLIPLoader type stable_diffusion.');
            positive = add('Krea2Qwen8BEncode', { clip, text: prompt });
        } else {
            if (config.encoder_type !== 'krea2') throw new Error('The native Krea2 path requires encoder type krea2.');
            positive = add('CLIPTextEncode', { clip, text: prompt });
        }
        if (config.encoding === 'bridge') positive = add('Krea2Qwen8BAdapter', { conditioning: positive, adapter_name: check('Krea2Qwen8BAdapter', 'adapter_name', config.adapter, 'Bridge') });
    } else {
        if (config.encoder_type !== 'qwen_image') throw new Error('Qwen Image requires encoder type qwen_image.');
        const spec = defs.TextEncodeQwenImage21?.input.required.images?.[1]?.template;
        const names = spec?.names || [];
        if (images.length > names.length) throw new Error(`The installed Qwen encoder provides ${names.length} visual inputs.`);
        const encoded = add('TextEncodeQwenImage21', { clip, vae, prompt, negative_prompt: config.negative,
            resolution: 0, ...Object.fromEntries(images.map((im, i) => [`images.${names[i]}`, im])) });
        positive = encoded; negative = [encoded[0], 1];
        if (images.length) latent = [encoded[0], 2];
        if (defs.QwenImage21Cache) model = add('QwenImage21Cache', { model, device: config.cache_device, dtype: config.cache_dtype });
    }
    if (isKrea && operation === 'refine') {
        if (!images.length) throw new Error('Select the original image.');
        latent = add('VAEEncode', { pixels: images[0], vae });
    }
    const sources = kreaEditing ? images.map(pixels => add('VAEEncode', { pixels, vae })) : [];
    const useReferenceLatent = engine === 'krea_edit' && (sketch || config.latent_reference_index != null);
    if (useReferenceLatent) {
        const index = sketch ? 0 : config.latent_reference_index;
        if (!images[index]) throw new Error('The selected latent reference is not connected.');
        if (!sketch && config.size_mode === 'manual') {
            const pixels = add('ImageScale', { image: images[index], upscale_method: 'lanczos', ...imageDimensions(config), crop: 'center' });
            latent = add('VAEEncode', { pixels, vae });
        } else latent = sources[index];
    }
    if (!latent) {
        // The selected VAE owns the native latent layout for both engines.
        const pixels = add('EmptyImage', { ...imageDimensions(config), batch_size: 1, color: 16777215 });
        latent = add('VAEEncode', { pixels, vae });
        latent = add('LatentMultiply', { samples: latent, multiplier: 0 });
    }
    let sampled;
    if (kreaEditing) {
        model = add('Krea2EditModelPatch', { model, vae, target_latent: latent,
            ...Object.fromEntries(sources.flatMap((source, i) => {
                const suffix = ['', '_b', '_c', '_d'][i];
                return [[`source_latent${suffix}`, source], [`source_image${suffix}`, images[i]]];
            })),
            ref_boost: Number(config.ref_boost ?? 1), ref_boost_a: Number(config.ref_boost_a ?? 1), fit_mode: config.fit_mode || 'fit' });
        if (sketch && config.shift !== '' && config.shift != null) {
            const shift = Number(config.shift);
            model = add('ModelSamplingFlux', { model, max_shift: shift, base_shift: shift, width: 1024, height: 1024 });
        }
        negative = add('ConditioningZeroOut', { conditioning: positive });
        sampled = add('KSampler', { model, positive, negative, latent_image: latent, seed: Number(config.seed), steps: Number(config.steps),
            cfg: Number(config.cfg), sampler_name: config.sampler, scheduler: config.scheduler, denoise: useReferenceLatent ? Number(config.denoise ?? 0.65) : 1 });
    } else if (isKrea) {
        const guider = add('BasicGuider', { model, conditioning: positive });
        const sigmas = add('BasicScheduler', { model, scheduler: config.scheduler, steps: Number(config.steps), denoise: operation === 'refine' ? Number(config.denoise) : 1 });
        const sampler = add('KSamplerSelect', { sampler_name: config.sampler });
        const noise = add('RandomNoise', { noise_seed: Number(config.seed) });
        sampled = add('SamplerCustomAdvanced', { noise, guider, sampler, sigmas, latent_image: latent });
    } else {
        sampled = add('KSampler', { model, positive, negative, latent_image: latent, seed: Number(config.seed), steps: Number(config.steps),
            cfg: Number(config.cfg), sampler_name: config.sampler, scheduler: config.scheduler, denoise: 1 });
    }
    const decoded = add('VAEDecode', { samples: sampled, vae });
    const output = sketch ? add('PreviewImage', { images: decoded }) : add('SaveImage', { images: decoded, filename_prefix: `manga-maker/${jobId}/result` });
    return { graph, outputNode: output[0] };
}
