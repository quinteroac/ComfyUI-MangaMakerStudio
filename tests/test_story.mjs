import assert from 'node:assert/strict';
import { actions, normalizeStory, structure, storyContext, systemPrompt, layoutFromScript, scriptMarkdown, readable, newChapter, newScriptPage, findPage } from '../web/story-data.js';

const story = normalizeStory({ logline: { title: 'Kitsune Run' } });
assert.equal(story.plot.template, 'three_act');
assert.deepEqual(story.plot.acts.map(a => a.beats.length), [3, 3, 2]);
assert.equal(structure('save_the_cat').flatMap(a => a.beats).length, 15);
assert.equal(normalizeStory(structuredClone(story)).plot.acts[0].id, story.plot.acts[0].id);

actions.logline.apply(story, { title: '  ', genre: 'Shōnen', tone: 'Hopeful', audience: 'Teens', logline: 'A fox girl races spirits.', synopsis: 'Synopsis.', themes: 'Friendship' });
assert.equal(story.logline.title, 'Kitsune Run');
actions.character.apply(story, { name: 'Aiko', role: 'Protagonist', voice: 'Blunt', visual_prompt: 'Fennec ears, blonde wavy hair, blue eyes' });
actions.cast.apply(story, { characters: [{ name: 'Ren', role: 'Rival' }] });
const [aiko, ren] = story.characters;
assert.equal(aiko.voice, 'Blunt'); assert.deepEqual(aiko.references, []);
actions.develop.apply(story, { personality: 'Stubborn', name: '' }, aiko.id);
assert.equal(aiko.personality, 'Stubborn'); assert.equal(aiko.name, 'Aiko');
aiko.portrait = 'p'; aiko.references = ['p', 'r'];
assert.deepEqual(actions.appearance.images(story, aiko.id), ['p', 'r']);
assert.throws(() => actions.develop.apply(story, {}, 'gone'), /no longer exists/);

actions.outline.apply(story, { acts: [{ title: 'Ki', summary: 'Start', beats: [{ title: 'Meet', summary: 'They meet', characters: ['aiko', 'REN', 'Nobody'] }] }] });
assert.deepEqual(story.plot.acts[0].beats[0].characters, [aiko.id, ren.id]);

actions.chapters.apply(story, { chapters: [{ title: 'The race', summary: 'Aiko enters.' }] });
const chapter = story.script.chapters[0];
assert.equal(chapter.title, 'The race');
const panel = { shot: 'close', description: 'Aiko grins', characters: ['Aiko'], lines: [{ type: 'speech', speaker: 'Aiko', text: 'Catch me!' }, { type: 'sfx', speaker: '', text: 'WHOOSH' }] };
actions.pages.apply(story, { pages: [{ title: 'Start line', panels: [panel, { ...panel, shot: 'bogus', lines: [] }] }] }, chapter.id);
const page = chapter.pages[0];
assert.equal(page.panels[1].shot, 'medium'); assert.deepEqual(page.panels[0].characters, [aiko.id]);
page.panels[0].asset = 'image';
const firstId = page.panels[0].id;
actions.dialogue.apply(story, { panels: [{ ...panel, lines: [{ type: 'thought', speaker: 'Aiko', text: 'I can win.' }] }] }, page.id);
assert.equal(page.panels.length, 1); assert.equal(page.panels[0].id, firstId); assert.equal(page.panels[0].asset, 'image');
assert.equal(findPage(story, page.id).chapter, chapter);

const context = storyContext(story, { character: aiko.id, chapter: chapter.id, page: page.id });
for (const text of ['Title: Kitsune Run', '## Aiko (selected)', 'Voice and speech: Blunt', '- Meet: They meet (Aiko, Ren)', '- 1. Start line · 1 panels', '# Selected page', 'Aiko (thought): I can win.'])
    assert.ok(context.includes(text), text);
assert.ok(systemPrompt(story, 'script', {}).includes('Script Editor'));

for (const [kind, action] of Object.entries(actions)) {
    assert.equal(action.schema.type, 'object', kind);
    assert.ok(action.prompt(story, action.target === 'character' ? aiko.id : action.target === 'chapter' ? chapter.id : page.id).endsWith('JSON object.'), kind);
}

const five = newScriptPage(2);
five.panels = Array.from({ length: 5 }, (_, i) => ({ id: String(i), shot: 'wide', description: '', characters: [], asset: i === 0 ? 'img' : null, lines: i === 0 ? [{ type: 'speech', speaker: 'A', text: 'Hi' }, { type: 'caption', speaker: '', text: 'Later' }, { type: 'speech', text: ' ' }] : [] }));
const layout = layoutFromScript(five, 'rtl');
assert.deepEqual(layout.panels.map(p => p.order), [1, 2, 3, 4, 5]);
assert.equal(layout.panels[0].asset, 'img');
assert.ok(layout.panels[0].polygon[0][0] > layout.panels[1].polygon[0][0], 'right-to-left reading puts panel 1 on the right');
assert.ok(layout.panels.every(p => p.polygon.flat().every(v => v >= 0 && v <= 1)));
assert.deepEqual(layout.bubbles.map(b => [b.type, b.text, b.tail]), [['speech', 'Hi', true], ['caption', 'Later', false]]);
const [x0, y0] = layout.panels[0].polygon[0], [x1, y1] = layout.panels[0].polygon[2];
assert.ok(layout.bubbles.every(b => b.x >= x0 && b.x + b.w <= x1 && b.y >= y0 && b.y + b.h <= y1));
assert.equal(layoutFromScript(newScriptPage(1)).panels.length, 1);
assert.ok(layoutFromScript(five, 'ltr').panels[0].polygon[0][0] < layoutFromScript(five, 'ltr').panels[1].polygon[0][0]);

story.script.chapters.push(newChapter(2));
const markdown = scriptMarkdown(story);
assert.ok(markdown.startsWith('# Kitsune Run\n\n> A fox girl races spirits.')); assert.ok(markdown.includes('## Chapter 2'));
assert.equal(readable({ name: 'Aiko', tags: ['a'], empty: '', nested: { role: 'Hero' } }), 'Name: Aiko\nTags:\n   • a\nNested:\n   Role: Hero');
console.log('Story data, assistant actions, context and script layouts passed.');
