import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import readline from 'node:readline';

// A minimal stand-in for the Studio routes the MCP server reads and writes.
const id = 'a'.repeat(32), asset = 'b'.repeat(32);
const project = { id, name: 'Kitsune', updated: 1, revision: 0, workspace: { design: { pages: [{ id: 'p1', name: 'Page 1' }] } }, jobs: [], story: {},
    assets: [{ id: asset, kind: 'references', name: 'Aiko', width: 80, height: 120, version: 1, parent: null, deleted: false, missing: false, metadata: {} }] };
let externalEdit = false;
const server = http.createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    const send = (status, value) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
    if (request.url === '/manga-maker/projects') return send(200, [{ id, name: project.name, updated: 1, active_jobs: false }]);
    if (request.url === `/manga-maker/projects/${id}/assets/${asset}?thumb=1`) { response.writeHead(200, { 'Content-Type': 'image/webp' }); return response.end('webp'); }
    if (request.url !== `/manga-maker/projects/${id}`) return send(404, { error: 'Missing' });
    if (request.method === 'GET') return send(200, project);
    const patch = JSON.parse(body);
    if (externalEdit) { externalEdit = false; project.revision++; }
    if (patch.revision !== project.revision) return send(409, { error: 'The project was changed by another client.' });
    Object.assign(project, { story: patch.story, revision: project.revision + 1 });
    send(200, project);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

const child = spawn(process.execPath, [new URL('../mcp/server.mjs', import.meta.url).pathname], { env: { ...process.env, MANGA_MAKER_URL: `http://127.0.0.1:${server.address().port}/` }, stdio: ['pipe', 'pipe', 'inherit'] });
const replies = new Map(); let next = 0;
readline.createInterface({ input: child.stdout }).on('line', line => { const message = JSON.parse(line); replies.get(message.id)(message); });
const rpc = (method, params) => new Promise(resolve => { const n = ++next; replies.set(n, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n'); });
const call = async (name, args) => (await rpc('tools/call', { name, arguments: args })).result;

assert.equal((await rpc('initialize', { protocolVersion: '2025-06-18' })).result.serverInfo.name, 'manga-maker-studio');
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
const tools = (await rpc('tools/list')).result.tools;
assert(tools.some(t => t.name === 'story_page' && t.inputSchema.required.includes('target')));
assert.equal((await rpc('missing/method')).error.code, -32601);

assert.equal(JSON.parse((await call('list_projects')).content[0].text)[0].id, id);
const summary = JSON.parse((await call('get_project', { project: id })).content[0].text);
assert.deepEqual([summary.assets.references, summary.page_layouts], [1, [{ id: 'p1', name: 'Page 1' }]]);
assert.deepEqual((await call('view_asset', { project: id, asset })).content[0], { type: 'image', data: Buffer.from('webp').toString('base64'), mimeType: 'image/webp' });
assert((await call('get_project', { project: '../settings' })).isError);

const logline = { title: 'Kitsune Run', genre: 'Shōnen', tone: 'Hopeful', audience: 'Teens', logline: 'A fox girl races spirits.', synopsis: 'Synopsis.', themes: 'Friendship' };
assert.match((await call('story_logline', { project: id, proposal: logline })).content[0].text, /revision 1/);
assert.equal(project.story.logline.title, 'Kitsune Run');
assert((await call('story_logline', { project: id, proposal: { title: 'Missing fields' } })).isError);

// A Studio save between the read and the write is retried on the newer revision instead of being overwritten.
externalEdit = true;
const character = { name: 'Aiko', role: 'Protagonist', age: '16', appearance: 'Fennec ears', personality: 'Blunt', goal: 'Win', conflict: 'Rival', arc: 'Trust', voice: 'Short', relationships: '', visual_prompt: 'Blonde wavy hair, blue eyes' };
assert.match((await call('story_character', { project: id, proposal: character })).content[0].text, /revision 3/);
assert.equal(project.story.characters[0].name, 'Aiko');
assert.match((await call('get_story', { project: id, format: 'markdown' })).content[0].text, /^# Kitsune Run/);

child.stdin.end(); server.close();
console.log('MCP tests passed');
