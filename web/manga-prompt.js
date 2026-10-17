import { options } from './prompts.js';

export const mangaDefaults = {
    mode: 'lite', pen_lines: false, resolution: 1280, megapixels: 2,
    black: 0.2, white: 0.7, gamma: 1.3, screen_lines: 250, white_point: 0.8, black_point: 0.3,
    light_tone: 0.18, dark_tone: 0.42, gradation: 1, pen_threshold: 0.3, white_lines: 0.4,
    frame: 'original', crop_x: 0.5, crop_y: 0.4, border: 5, margin: 60, paper: 'white', ink: 0.5,
    sigmas: '1.0, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0.0',
    instruction: 'Redraw <image1> as a printed black-and-white manga page panel, as if inked by the original artist for serialization. Keep the exact composition, pose, character design, face, expression and drawing style of <image1>. Use confident ink lines with varied line weight, solid black for dark hair and deep shadows, white paper for skin and light surfaces, ink hatching lines for shadows on cloth, and regular screentone only where a mid tone is needed. No color and no smooth gradients. Do not add anything that is not in <image1>.',
};

export function buildMangaPrompt(defs, cfg, imagePath) {
    const graph = {}; let count = 0;
    const add = (type, inputs) => {
        if (!defs[type]) throw new Error(`Missing node ${type}. Install or enable ${type.startsWith('Manga2') ? 'comfyui_controlnet_aux' : type.startsWith('Manga') ? 'ComfyUI-MangaScreen' : 'its dependency'} and refresh the lists.`);
        const id = String(++count); graph[id] = { class_type: type, inputs }; return [id, 0];
    };
    const selected = (node, key, value) => {
        if (!options(defs, node, key).includes(value)) throw new Error(`${key}: missing or unregistered selection (${value || 'not selected'}).`);
        return value;
    };
    let image = add('LoadImage', { image: imagePath });
    image = add('ImageScaleToTotalPixels', { image, upscale_method: 'lanczos', megapixels: Number(cfg.megapixels), resolution_steps: 32 });
    if (cfg.mode === 'qwen') {
        let model = add('UNETLoader', { unet_name: selected('UNETLoader', 'unet_name', cfg.model), weight_dtype: cfg.weight_dtype });
        let clip = add('CLIPLoader', { clip_name: selected('CLIPLoader', 'clip_name', cfg.encoder), type: 'qwen_image', device: cfg.encoder_device });
        const vae = add('VAELoader', { vae_name: selected('VAELoader', 'vae_name', cfg.vae) });
        for (const lora of cfg.loras.filter(lora => lora.enabled)) {
            model = add('LoraLoader', { model, clip, lora_name: selected('LoraLoader', 'lora_name', lora.name), strength_model: Number(lora.model), strength_clip: Number(lora.clip) });
            clip = [model[0], 1];
        }
        if (cfg.attention) model = add('ModelAttentionBackend', { model, attention: selected('ModelAttentionBackend', 'attention', cfg.attention) });
        const names = defs.TextEncodeQwenImage21?.input.required.images?.[1]?.template?.names;
        if (!names?.length) throw new Error('Missing node TextEncodeQwenImage21 with visual inputs. Update ComfyUI and refresh the lists.');
        const encoded = add('TextEncodeQwenImage21', { clip, vae, prompt: cfg.instruction, negative_prompt: '', resolution: 0, [`images.${names[0]}`]: image });
        if (defs.QwenImage21Cache) model = add('QwenImage21Cache', { model, device: cfg.cache_device, dtype: cfg.cache_dtype });
        const guider = add('BasicGuider', { model, conditioning: encoded });
        const noise = add('RandomNoise', { noise_seed: Number(cfg.seed) });
        const sampler = add('KSamplerSelect', { sampler_name: selected('KSamplerSelect', 'sampler_name', cfg.sampler) });
        const sigmas = add('ManualSigmas', { sigmas: cfg.sigmas });
        const samples = add('SamplerCustomAdvanced', { noise, guider, sampler, sigmas, latent_image: [encoded[0], 2] });
        image = add('VAEDecode', { samples, vae });
    } else image = add('MangaLevels', { image, ...Object.fromEntries(['black', 'white', 'gamma'].map(key => [key, Number(cfg[key])])) });
    const pen = cfg.pen_lines ? add('Manga2Anime_LineArt_Preprocessor', { image, resolution: Number(cfg.resolution) }) : null;
    image = add('MangaFinish', { image, ...Object.fromEntries(['screen_lines', 'white_point', 'black_point', 'light_tone', 'dark_tone', 'gradation', 'pen_threshold', 'white_lines'].map(key => [key, Number(cfg[key])])), ...(pen ? { pen_lines: pen } : {}) });
    image = add('MangaPanel', { image, frame: cfg.frame, paper: cfg.paper, ...Object.fromEntries(['crop_x', 'crop_y', 'border', 'margin', 'ink'].map(key => [key, Number(cfg[key])])) });
    const output = add('PreviewImage', { images: image });
    return { graph, outputNode: output[0] };
}

