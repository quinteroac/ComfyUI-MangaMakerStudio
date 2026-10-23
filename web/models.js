import { initialSettings } from './prompts.js';

export const modelFields = ['model', 'encoder', 'vae', 'identity_lora', 'accelerator_lora', 'encoder_type', 'analysis_encoder', 'analysis_encoder_type', 'weight_dtype', 'encoder_device', 'attention', 'cache_device', 'cache_dtype',
    'ref_boost', 'ref_boost_a', 'fit_mode', 'grounding_px', 'grounding_system_prompt', 'steps', 'cfg', 'sampler', 'scheduler', 'shift'];
const defined = value => value !== undefined && value !== null && value !== '';
export const modelValues = value => Object.fromEntries(modelFields.filter(key => defined(value?.[key])).map(key => [key, structuredClone(value[key])]));

export function globalModels(settings, catalog) {
    settings.models ||= {};
    for (const [engine, profile] of Object.entries(catalog.profiles)) {
        if (settings.models[engine]) {
            const { encoding, adapter, ...stored } = settings.models[engine];
            // The removed Qwen-VL 8B bridge used an encoder that does not load as native Krea2.
            if (encoding === 'bridge' && engine.startsWith('krea')) { delete stored.encoder; delete stored.encoder_type; }
            settings.models[engine] = { ...modelValues(initialSettings(engine)), ...profile.settings, ...stored, engine };
        } else {
            const legacy = Object.entries(settings.defaults || {}).find(([scope, value]) => scope.endsWith(`:${engine}`) && (value.model || value.encoder || value.vae))?.[1];
            settings.models[engine] = { ...modelValues(initialSettings(engine)), ...profile.settings, ...modelValues(legacy), engine };
        }
        for (const artifact of catalog.artifacts) {
            for (const key of ['model', 'encoder', 'vae', 'identity_lora']) if (settings.models[engine][key] === artifact.filename && artifact.installed) settings.models[engine][key] = artifact.installed;
        }
    }
    for (const defaults of Object.values(settings.defaults || {})) for (const key of modelFields) delete defaults[key];
}

export function inheritModels(config, global, engine) {
    const base = { ...initialSettings(engine), ...global };
    if (!config.model_overrides) {
        config.model_overrides = {};
        if (config.model || config.encoder || config.vae) {
            for (const [key, value] of Object.entries(modelValues(config))) if (value !== base[key]) config.model_overrides[key] = value;
        }
        if (config.analysis_encoder) { config.model_overrides.analysis_encoder = config.analysis_encoder; config.model_overrides.analysis_encoder_type = config.analysis_encoder_type; }
    }
    for (const key of modelFields) config[key] = defined(config.model_overrides[key]) ? config.model_overrides[key] : base[key];
    config.analysis_encoder = defined(config.model_overrides.analysis_encoder) ? config.model_overrides.analysis_encoder : config.encoder;
    config.analysis_encoder_type = defined(config.model_overrides.analysis_encoder_type) ? config.model_overrides.analysis_encoder_type : config.encoder_type;
    return config;
}

export function applyPreset(config, preset) {
    if (typeof preset === 'string') { config.prompt = preset; config.model_overrides = {}; return; }
    Object.assign(config, structuredClone(preset));
    config.model_overrides = modelValues(preset.model_overrides || preset);
}

export function savedPreset(config) {
    const preset = structuredClone(config);
    for (const key of modelFields) delete preset[key];
    return preset;
}
