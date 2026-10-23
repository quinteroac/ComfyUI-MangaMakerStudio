// Story Studio data, assistant prompts and structured actions. Kept free of DOM and ComfyUI imports for tests.
const id = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');

export const modules = { logline: 'Logline', characters: 'Characters', plot: 'Plot & Structure', script: 'Script Editor' };
export const loglineFields = [['title', 'Title'], ['genre', 'Genre'], ['tone', 'Tone'], ['audience', 'Audience'], ['logline', 'Logline'], ['synopsis', 'Synopsis'], ['themes', 'Themes']];
export const characterFields = [['name', 'Name'], ['role', 'Role'], ['age', 'Age'], ['appearance', 'Appearance'], ['personality', 'Personality'], ['goal', 'Goal'], ['conflict', 'Conflict'],
    ['arc', 'Arc'], ['voice', 'Voice and speech'], ['relationships', 'Relationships'], ['visual_prompt', 'Visual prompt'], ['notes', 'Notes']];
export const shots = { establishing: 'Establishing shot', wide: 'Wide shot', medium: 'Medium shot', close: 'Close-up', extreme: 'Extreme close-up', over: 'Over the shoulder', high: 'High angle', low: 'Low angle' };
export const shotPrompts = { establishing: 'Establishing shot showing the whole location.', wide: 'Wide shot with full bodies inside their environment.', medium: 'Medium shot framed from the waist up.',
    close: 'Close-up on the face and expression.', extreme: 'Extreme close-up on a single detail.', over: 'Over-the-shoulder shot.', high: 'High-angle shot looking down.', low: 'Low-angle shot looking up.' };
export const lineTypes = { speech: 'Dialogue', thought: 'Thought', caption: 'Caption', sfx: 'SFX' };
const bubbleTypes = { speech: 'speech', thought: 'thought', caption: 'caption', sfx: 'shout' };

export const templates = {
    three_act: { label: 'Three acts', acts: [['Act I · Setup', ['Hook', 'Inciting incident', 'First plot point']], ['Act II · Confrontation', ['Rising action', 'Midpoint', 'Crisis']], ['Act III · Resolution', ['Climax', 'Resolution']]] },
    kishotenketsu: { label: 'Kishōtenketsu', acts: [['Ki · Introduction', ['Introduction']], ['Shō · Development', ['Development']], ['Ten · Twist', ['Twist']], ['Ketsu · Conclusion', ['Reconciliation']]] },
    save_the_cat: { label: 'Save the Cat', acts: [['Act I', ['Opening image', 'Theme stated', 'Set-up', 'Catalyst', 'Debate']],
        ['Act II', ['Break into two', 'B story', 'Fun and games', 'Midpoint', 'Bad guys close in', 'All is lost', 'Dark night of the soul']], ['Act III', ['Break into three', 'Finale', 'Final image']]] },
    free: { label: 'Free structure', acts: [['Part 1', []]] },
};

export const newBeat = (title = '') => ({ id: id(), title, summary: '', characters: [] });
export const newAct = (title = '') => ({ id: id(), title, summary: '', beats: [] });
export const structure = template => templates[template].acts.map(([title, beats]) => ({ ...newAct(title), beats: beats.map(newBeat) }));
export const newCharacter = () => ({ id: id(), ...Object.fromEntries(characterFields.map(([key]) => [key, ''])), portrait: null, references: [] });
export const newChapter = number => ({ id: id(), title: `Chapter ${number}`, summary: '', pages: [] });
export const newScriptPage = number => ({ id: id(), title: `Page ${number}`, notes: '', layout: null, panels: [] });
export const newPanel = () => ({ id: id(), shot: 'medium', description: '', characters: [], asset: null, lines: [] });
export const newLine = (type = 'speech') => ({ id: id(), type, speaker: '', text: '' });

export function normalizeStory(story) {
    story.logline = { ...Object.fromEntries(loglineFields.map(([key]) => [key, ''])), ...story.logline };
    story.characters = (story.characters || []).map(c => ({ ...newCharacter(), ...c }));
    story.plot ||= { template: 'three_act', acts: structure('three_act') };
    story.script ||= { chapters: [] };
    return story;
}

export function findPage(story, pageId) {
    for (const chapter of story.script.chapters) {
        const page = chapter.pages.find(p => p.id === pageId);
        if (page) return { chapter, page };
    }
    return {};
}

const filled = (pairs, owner) => pairs.filter(([key]) => String(owner[key] || '').trim()).map(([key, label]) => `${label}: ${String(owner[key]).trim()}`);
const castNames = (story, ids) => ids.map(i => story.characters.find(c => c.id === i)?.name).filter(Boolean);

export function pageScript(story, page) {
    return [`${page.title}${page.notes.trim() ? ` · ${page.notes.trim()}` : ''}`, ...page.panels.map((panel, i) => [
        `Panel ${i + 1} [${shots[panel.shot] || panel.shot}]: ${panel.description.trim() || '(no description)'}${panel.characters.length ? ` · Characters: ${castNames(story, panel.characters).join(', ')}` : ''}`,
        ...panel.lines.filter(l => l.text.trim()).map(l => `  ${l.type === 'caption' || l.type === 'sfx' ? lineTypes[l.type].toUpperCase() : `${l.speaker || '?'}${l.type === 'thought' ? ' (thought)' : ''}`}: ${l.text.trim()}`)].join('\n'))].join('\n');
}

export function storyContext(story, focus = {}) {
    const plot = story.plot.acts.map(act => [`## ${act.title}${act.summary.trim() ? `: ${act.summary.trim()}` : ''}`,
        ...act.beats.map(b => `- ${b.title || 'Beat'}${b.summary.trim() ? `: ${b.summary.trim()}` : ''}${b.characters.length ? ` (${castNames(story, b.characters).join(', ')})` : ''}`)].join('\n')).join('\n');
    const script = story.script.chapters.map(chapter => [`## ${chapter.title}${chapter.summary.trim() ? `: ${chapter.summary.trim()}` : ''} · ${chapter.pages.length} pages`,
        ...(chapter.id === focus.chapter ? chapter.pages.map((p, i) => `- ${i + 1}. ${p.title} · ${p.panels.length} panels`) : [])].join('\n')).join('\n');
    const { page } = findPage(story, focus.page);
    return [`# Story\n${filled(loglineFields, story.logline).join('\n') || '(not defined yet)'}`,
        `# Characters\n${story.characters.map(c => `## ${c.name || 'Unnamed'}${c.id === focus.character ? ' (selected)' : ''}\n${filled(characterFields.slice(1), c).join('\n')}`).join('\n') || '(none yet)'}`,
        `# Plot · ${templates[story.plot.template]?.label || 'Free structure'}\n${plot || '(empty)'}`,
        `# Script\n${script || '(no chapters yet)'}`,
        ...(page ? [`# Selected page\n${pageScript(story, page)}`] : [])].join('\n\n');
}

const guides = {
    logline: 'Focus on premise, hook, central conflict, stakes and the genre promise. A logline is one or two sentences.',
    characters: 'Focus on distinctive, visually readable characters with clear wants, needs, flaws, arcs and speech patterns. Visual prompts describe only stable visual identity for image generation (hair, eyes, build, outfit, palette, distinctive marks), written in English.',
    plot: 'Focus on causality, escalation, reversals and pacing across acts and beats.',
    script: 'Focus on page turns, panel flow, readable staging and short, natural manga dialogue. A manga page usually has 3 to 7 panels. Panel descriptions are visual instructions for image generation, written in English.',
};

export function systemPrompt(story, module, focus) {
    return `You are the writing assistant of Manga Maker Studio, an experienced manga story editor and scriptwriter helping the author with the ${modules[module]} module. ${guides[module]} `
        + 'Respect the author\'s decisions and the established facts below; do not contradict them unless asked. Write story content and dialogue in the language already used in the project, '
        + 'and reply to chat messages in the language of the author\'s message. Be concrete and concise.\n\n' + storyContext(story, focus);
}

const text = { type: 'string' };
const list = items => ({ type: 'array', items });
const object = properties => ({ type: 'object', properties, required: Object.keys(properties) });
const characterSchema = object(Object.fromEntries(characterFields.filter(([key]) => key !== 'notes').map(([key]) => [key, text])));
const panelSchema = object({ shot: { type: 'string', enum: Object.keys(shots) }, description: text, characters: list(text),
    lines: list(object({ type: { type: 'string', enum: Object.keys(lineTypes) }, speaker: text, text })) });
const json = ' Answer only with the JSON object.';

const pick = (data, fields) => Object.fromEntries(fields.map(([key]) => [key, String(data[key] ?? '').trim()]).filter(([, value]) => value));
const castIds = (story, names) => names.map(name => story.characters.find(c => c.name.trim().toLowerCase() === String(name).trim().toLowerCase())?.id).filter(Boolean);
const panelFrom = (story, data, previous) => ({ ...newPanel(), ...(previous ? { id: previous.id, asset: previous.asset } : {}), shot: shots[data.shot] ? data.shot : 'medium',
    description: data.description || '', characters: castIds(story, data.characters || []),
    lines: (data.lines || []).map(l => ({ ...newLine(lineTypes[l.type] ? l.type : 'speech'), speaker: l.speaker || '', text: l.text || '' })) });
const required = (value, label) => { if (!value) throw new Error(`The ${label} for this proposal no longer exists.`); return value; };
const character = (story, target) => required(story.characters.find(c => c.id === target), 'character');
const chapter = (story, target) => required(story.script.chapters.find(c => c.id === target), 'chapter');
const page = (story, target) => required(findPage(story, target).page, 'page');

// Each action asks for JSON constrained by its schema; apply() writes an accepted proposal into the story.
export const actions = {
    logline: { module: 'logline', label: 'Propose logline and synopsis', schema: object(Object.fromEntries(loglineFields.map(([key]) => [key, text]))),
        prompt: () => 'Propose a complete story foundation: title, genre, tone, audience, a one- or two-sentence logline, a synopsis of three to five paragraphs and the central themes. Keep and build on anything already defined.' + json,
        apply: (story, data) => Object.assign(story.logline, pick(data, loglineFields)) },
    character: { module: 'characters', label: 'Create a character card', schema: characterSchema,
        prompt: () => 'Create one new character who fits this story and complements the existing cast. Fill every field.' + json,
        apply: (story, data) => { story.characters.push({ ...newCharacter(), ...pick(data, characterFields) }); } },
    cast: { module: 'characters', label: 'Suggest supporting cast', schema: object({ characters: list(characterSchema) }),
        prompt: () => 'Suggest three supporting characters who create conflict or contrast with the existing cast. Fill every field.' + json,
        apply: (story, data) => { story.characters.push(...data.characters.map(c => ({ ...newCharacter(), ...pick(c, characterFields) }))); } },
    develop: { module: 'characters', label: 'Develop selected character', target: 'character', schema: characterSchema,
        prompt: (story, target) => `Develop the character card of "${character(story, target).name || 'the selected character'}". Keep every established fact, fill empty fields and deepen the existing ones.` + json,
        apply: (story, data, target) => Object.assign(character(story, target), pick(data, characterFields)) },
    appearance: { module: 'characters', label: 'Describe from reference images', target: 'character', vision: true, schema: object({ appearance: text, visual_prompt: text }),
        images: (story, target) => { const c = character(story, target); return [...new Set([c.portrait, ...c.references].filter(Boolean))]; },
        prompt: (story, target) => `The attached images are references of "${character(story, target).name || 'the selected character'}". Describe the visible appearance for the card and write an English visual prompt with the stable identity details needed to redraw this character consistently.` + json,
        apply: (story, data, target) => Object.assign(character(story, target), pick(data, [['appearance'], ['visual_prompt']])) },
    outline: { module: 'plot', label: 'Outline the plot', schema: object({ acts: list(object({ title: text, summary: text, beats: list(object({ title: text, summary: text, characters: list(text) })) })) }),
        prompt: story => `Outline the plot with the ${templates[story.plot.template]?.label || 'current'} structure${story.plot.template === 'free' ? '' : ` (${templates[story.plot.template].acts.map(([act, beats]) => `${act}: ${beats.join(', ')}`).join('; ')})`}. Keep developed beats, fill empty ones, and name the characters involved in each beat exactly as on their cards.` + json,
        apply: (story, data) => { story.plot.acts = data.acts.map(act => ({ ...newAct(act.title), summary: act.summary || '', beats: act.beats.map(b => ({ ...newBeat(b.title), summary: b.summary || '', characters: castIds(story, b.characters || []) })) })); } },
    chapters: { module: 'script', label: 'Plan chapters from the plot', schema: object({ chapters: list(object({ title: text, summary: text })) }),
        prompt: () => 'Divide the plot into manga chapters that follow its beats, after any chapters that already exist. Give each new chapter a title and a summary of its events.' + json,
        apply: (story, data) => { story.script.chapters.push(...data.chapters.map((c, i) => ({ ...newChapter(story.script.chapters.length + i + 1), title: c.title, summary: c.summary || '' }))); } },
    pages: { module: 'script', label: 'Break selected chapter into pages', target: 'chapter', schema: object({ pages: list(object({ title: text, panels: list(panelSchema) })) }),
        prompt: (story, target) => `Break "${chapter(story, target).title}" into manga pages after its existing pages. For each page, write its panels with shot, visual description, characters named exactly as on their cards, and dialogue lines.` + json,
        apply: (story, data, target) => { const c = chapter(story, target); c.pages.push(...data.pages.map((p, i) => ({ ...newScriptPage(c.pages.length + i + 1), title: p.title, panels: p.panels.map(panel => panelFrom(story, panel)) }))); } },
    page: { module: 'script', label: 'Write selected page', target: 'page', schema: object({ panels: list(panelSchema) }),
        prompt: (story, target) => `Write the complete script of "${page(story, target).title}": panels with shot, visual description, characters named exactly as on their cards, and dialogue lines. Keep what already works on the page.` + json,
        apply: (story, data, target) => { const p = page(story, target); p.panels = data.panels.map((panel, i) => panelFrom(story, panel, p.panels[i])); } },
    dialogue: { module: 'script', label: 'Polish dialogue of selected page', target: 'page', schema: object({ panels: list(panelSchema) }),
        prompt: (story, target) => `Rewrite only the dialogue of "${page(story, target).title}" so each character sounds like their card, lines stay short enough for balloons and the page reads well. Return every existing panel in order with its shot, description and characters unchanged.` + json,
        apply: (story, data, target) => { const p = page(story, target); p.panels = data.panels.map((panel, i) => panelFrom(story, panel, p.panels[i])); } },
};

const label = key => key.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
export function readable(value, indent = '') {
    if (Array.isArray(value)) return value.map((item, i) => item && typeof item === 'object' ? `${indent}${i + 1}.\n${readable(item, `${indent}   `)}` : `${indent}• ${item}`).join('\n');
    if (value && typeof value === 'object') return Object.entries(value).filter(([, v]) => v !== '' && !(Array.isArray(v) && !v.length))
        .map(([key, v]) => v && typeof v === 'object' ? `${indent}${label(key)}:\n${readable(v, `${indent}   `)}` : `${indent}${label(key)}: ${v}`).join('\n');
    return `${indent}${value}`;
}

// Rows of up to two panels in reading order, with each line placed as a bubble inside its panel.
export function layoutFromScript(page, reading = 'rtl') {
    const count = Math.max(1, page.panels.length), rows = count <= 3 ? count : Math.ceil(count / 2), margin = 0.04, gap = 0.015;
    const height = (1 - 2 * margin - gap * (rows - 1)) / rows, panels = [], bubbles = [];
    for (let row = 0, index = 0; row < rows; row++) {
        const columns = Math.ceil((count - index) / (rows - row)), width = (1 - 2 * margin - gap * (columns - 1)) / columns;
        for (let column = 0; column < columns; column++, index++) {
            const x = margin + (reading === 'rtl' ? columns - 1 - column : column) * (width + gap), y = margin + row * (height + gap), source = page.panels[index];
            panels.push({ order: index + 1, polygon: [[x, y], [x + width, y], [x + width, y + height], [x, y + height]], asset: source?.asset || null });
            const lines = source?.lines.filter(l => l.text.trim()) || [];
            const w = Math.min(0.3, width * 0.45), h = Math.max(0.02, Math.min(0.1, (height - 0.02) / Math.max(1, lines.length) - 0.01));
            lines.forEach((line, i) => {
                const start = (i % 2 === 0) === (reading === 'rtl');
                bubbles.push({ type: bubbleTypes[line.type], text: line.text.trim(), x: start ? x + width - w - 0.01 : x + 0.01, y: y + 0.01 + i * (h + 0.01), w, h, z: bubbles.length,
                    tail: line.type !== 'caption', tailX: start ? 0.3 : 0.7 });
            });
        }
    }
    return { name: page.title, reading, panels, bubbles };
}

export function scriptMarkdown(story) {
    const title = story.logline.title.trim() || 'Untitled manga';
    return [`# ${title}`, ...story.logline.logline.trim() ? [`> ${story.logline.logline.trim()}`] : [],
        ...story.script.chapters.map(chapter => [`## ${chapter.title}`, ...chapter.summary.trim() ? [chapter.summary.trim()] : [],
            ...chapter.pages.map(p => `### ${pageScript(story, p).replace('\n', '\n\n')}`)].join('\n\n'))].join('\n\n') + '\n';
}
