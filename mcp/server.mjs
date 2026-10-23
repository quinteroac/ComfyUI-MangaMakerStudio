// Manga Maker Studio MCP server over stdio. It only talks to the local ComfyUI server in MANGA_MAKER_URL.
import readline from 'node:readline';
import { actions, modules, normalizeStory, readable, scriptMarkdown, storyContext } from '../web/story-data.js';

const base = (process.env.MANGA_MAKER_URL || 'http://127.0.0.1:8188').replace(/\/$/, '');
const identifier = (value, label) => { if (!/^[0-9a-f]{32}$/.test(value)) throw new Error(`Invalid ${label} identifier`); return value; };

async function api(path, body, method = 'GET') {
    const response = await fetch(`${base}/manga-maker${path}`, body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw Object.assign(new Error(data.error || `ComfyUI answered ${response.status} for ${path}`), { status: response.status });
    }
    return response;
}
const json = async (...args) => (await api(...args)).json();
const text = value => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }];
const project = id => json(`/projects/${identifier(id, 'project')}`);

// The in-app assistant returns schema-constrained JSON; MCP proposals get the same check before apply().
function check(value, schema, path) {
    if (schema.type === 'string') {
        if (typeof value !== 'string' || (schema.enum && !schema.enum.includes(value))) throw new Error(`${path} must be ${schema.enum ? `one of ${schema.enum.join(', ')}` : 'text'}`);
    } else if (schema.type === 'array') {
        if (!Array.isArray(value)) throw new Error(`${path} must be a list`);
        value.forEach((item, i) => check(item, schema.items, `${path}[${i}]`));
    } else {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object`);
        for (const key of schema.required) check(value[key], schema.properties[key], `${path}.${key}`);
    }
}

async function applyStory(projectId, action, proposal, target) {
    check(proposal, action.schema, 'proposal');
    for (let attempt = 1; ; attempt++) {
        const data = await project(projectId);
        const story = normalizeStory(data.story || {});
        action.apply(story, proposal, target);
        try { return (await json(`/projects/${projectId}`, { story, revision: data.revision }, 'PUT')).revision; }
        catch (error) { if (error.status !== 409 || attempt === 3) throw error; }
    }
}

const projectInput = { type: 'string', description: 'Project id from list_projects' };
const input = (properties = {}, required = []) => ({ type: 'object', properties, required });
const read = { readOnlyHint: true, openWorldHint: false };

const tools = {
    list_projects: { description: 'List Manga Maker Studio projects, most recently updated first.', annotations: read, inputSchema: input(),
        run: async () => text(await json('/projects')) },
    get_project: { description: 'Summarize a project: revision, asset counts, page layouts, active jobs and story size.', annotations: read, inputSchema: input({ project: projectInput }, ['project']),
        run: async ({ project: id }) => {
            const data = await project(id), story = normalizeStory(data.story || {}), live = data.assets.filter(a => !a.deleted);
            return text({ id: data.id, name: data.name, revision: data.revision, updated: data.updated,
                assets: Object.fromEntries(['references', 'panels', 'pages'].map(kind => [kind, live.filter(a => a.kind === kind).length])),
                page_layouts: (data.workspace.design?.pages || []).map(p => ({ id: p.id, name: p.name })), active_jobs: data.jobs.filter(j => ['registered', 'queued', 'running'].includes(j.state)).map(j => ({ id: j.id, operation: j.operation, state: j.state })),
                story: { title: story.logline.title, characters: story.characters.length, acts: story.plot.acts.length, chapters: story.script.chapters.length,
                    pages: story.script.chapters.reduce((n, c) => n + c.pages.length, 0) } });
        } },
    list_assets: { description: 'List a project\'s images. Trash is excluded unless include_deleted is true.', annotations: read,
        inputSchema: input({ project: projectInput, kind: { type: 'string', enum: ['references', 'panels', 'pages'] }, include_deleted: { type: 'boolean' } }, ['project']),
        run: async ({ project: id, kind, include_deleted }) => text((await project(id)).assets.filter(a => (!kind || a.kind === kind) && (include_deleted || !a.deleted))
            .map(a => ({ id: a.id, kind: a.kind, name: a.name, width: a.width, height: a.height, version: a.version, parent: a.parent, tags: a.tags || [], deleted: a.deleted, missing: a.missing,
                operation: a.metadata?.operation, engine: a.metadata?.engine, description_prompt: a.metadata?.description_prompt }))) },
    view_asset: { description: 'Return a project image. The 320 px thumbnail is returned unless thumbnail is false.', annotations: read,
        inputSchema: input({ project: projectInput, asset: { type: 'string', description: 'Asset id from list_assets' }, thumbnail: { type: 'boolean', default: true } }, ['project', 'asset']),
        run: async ({ project: id, asset, thumbnail = true }) => {
            const response = await api(`/projects/${identifier(id, 'project')}/assets/${identifier(asset, 'asset')}${thumbnail ? '?thumb=1' : ''}`);
            return [{ type: 'image', data: Buffer.from(await response.arrayBuffer()).toString('base64'), mimeType: response.headers.get('content-type') }];
        } },
    get_story: { description: 'Read the story. "summary" is the context the Studio assistant uses, "markdown" is the exported script and "json" includes the character, chapter and page ids the story tools take as target.',
        annotations: read, inputSchema: input({ project: projectInput, format: { type: 'string', enum: ['summary', 'markdown', 'json'], default: 'summary' } }, ['project']),
        run: async ({ project: id, format = 'summary' }) => {
            const story = normalizeStory((await project(id)).story || {});
            return text(format === 'json' ? story : format === 'markdown' ? scriptMarkdown(story) : storyContext(story));
        } },
};

const effects = { outline: 'Replaces every act and beat.', page: 'Replaces the panels of the target page.', dialogue: 'Replaces the panels of the target page; keep shots, descriptions and characters unchanged.',
    develop: 'Empty fields keep their current value.', appearance: 'Look at the character\'s portrait and references with view_asset first.' };
for (const [name, action] of Object.entries(actions)) {
    tools[`story_${name}`] = { description: `${action.label} (${modules[action.module]}). ${effects[name] || 'Adds to the story.'} Read get_story first; name characters exactly as on their cards. Open Studio windows reload the change.`,
        annotations: { readOnlyHint: false, destructiveHint: ['outline', 'page', 'dialogue'].includes(name), openWorldHint: false },
        inputSchema: input({ project: projectInput, ...(action.target ? { target: { type: 'string', description: `${action.target[0].toUpperCase()}${action.target.slice(1)} id from get_story with format json` } } : {}), proposal: action.schema },
            ['project', ...(action.target ? ['target'] : []), 'proposal']),
        run: async ({ project: id, target, proposal }) => {
            const revision = await applyStory(identifier(id, 'project'), action, proposal, target);
            return text(`Applied to the story (revision ${revision}):\n${readable(proposal)}`);
        } };
}

const handlers = {
    initialize: params => ({ protocolVersion: params.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'manga-maker-studio', version: '0.2.0-alpha' },
        instructions: 'Tools for Manga Maker Studio projects on the local ComfyUI server. Start with list_projects. Read get_story before using a story_* tool; those tools write the story.' }),
    ping: () => ({}),
    'tools/list': () => ({ tools: Object.entries(tools).map(([name, { description, inputSchema, annotations }]) => ({ name, description, inputSchema, annotations })) }),
    'tools/call': async ({ name, arguments: args = {} }) => {
        if (!tools[name]) throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
        try { return { content: await tools[name].run(args) }; }
        catch (error) { return { content: text(error.message === 'fetch failed' ? `ComfyUI is not reachable at ${base}. Start it or set MANGA_MAKER_URL.` : error.message), isError: true }; }
    },
};

readline.createInterface({ input: process.stdin }).on('line', async line => {
    if (!line.trim()) return;
    let message;
    try { message = JSON.parse(line); } catch { return process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n'); }
    if (message.id === undefined) return;
    const reply = { jsonrpc: '2.0', id: message.id };
    try {
        if (!handlers[message.method]) throw Object.assign(new Error(`Method not found: ${message.method}`), { code: -32601 });
        reply.result = await handlers[message.method](message.params || {});
    } catch (error) { reply.error = { code: error.code ?? -32603, message: error.message }; }
    process.stdout.write(JSON.stringify(reply) + '\n');
});
