import importlib.util
import io
import json
from pathlib import Path
import struct
import sys
import tempfile
import types
import unittest

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from PIL import Image

FAKE_WORKER = '''
import json, sys
loaded = False
while line := sys.stdin.readline():
    request = json.loads(line)
    if not loaded:
        print(json.dumps({'type': 'loaded'}), flush=True); loaded = True
    content = request['messages'][-1]['content']
    images = 0 if isinstance(content, str) else len(content) - 1
    text = content if isinstance(content, str) else content[0]['text']
    if text == 'fail':
        print(json.dumps({'type': 'error', 'message': 'Model failure'}), flush=True); sys.exit(1)
    answer = json.dumps({'title': text}) if request['schema'] else f"{text} | images={images} | history={len(request['messages'])} | {request['load']['projector_path'] is not None}"
    print(json.dumps({'type': 'delta', 'text': answer}), flush=True)
    print(json.dumps({'type': 'done'}), flush=True)
'''


def gguf(path, values):
    def string(value):
        data = value.encode()
        return struct.pack('<Q', len(data)) + data
    body = b''
    for key, value in values.items():
        body += string(key)
        if isinstance(value, bool):
            body += struct.pack('<I?', 7, value)
        elif isinstance(value, int):
            body += struct.pack('<II', 4, value)
        elif isinstance(value, list):
            body += struct.pack('<IIQ', 9, 8, len(value)) + b''.join(string(v) for v in value)
        else:
            body += struct.pack('<I', 8) + string(value)
    path.write_bytes(b'GGUF' + struct.pack('<IQQ', 3, 0, len(values)) + body)


class AssistantTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        for name in ('input', 'output', 'user', 'models/LLM/vision'):
            (self.root / name).mkdir(parents=True)
        gguf(self.root / 'models/LLM/story.gguf', {'general.architecture': 'gemma4', 'general.name': 'Story 12B', 'gemma4.context_length': 8192,
                                                   'gemma4.embedding_length': 3840, 'tokenizer.ggml.tokens': ['a', 'b'], 'tokenizer.chat_template': '{{ enable_thinking }}'})
        gguf(self.root / 'models/LLM/vision/mmproj.gguf', {'general.architecture': 'clip', 'clip.has_vision_encoder': True, 'clip.projector_type': 'gemma4uv', 'clip.vision.projection_dim': 3840})
        gguf(self.root / 'models/LLM/vision/other.gguf', {'general.architecture': 'clip', 'clip.has_vision_encoder': True, 'clip.projector_type': 'gemma4uv', 'clip.vision.projection_dim': 1024})
        (self.root / 'models/LLM/broken.gguf').write_bytes(b'GGUF\x03')
        folder = types.ModuleType('folder_paths')
        folder.get_user_directory = lambda: str(self.root / 'user')
        folder.get_input_directory = lambda: str(self.root / 'input')
        folder.get_output_directory = folder.get_temp_directory = lambda: str(self.root / 'output')
        folder.models_dir = str(self.root / 'models'); folder.folder_names_and_paths = {}
        sys.modules['folder_paths'] = folder
        self.unloaded = 0
        comfy = types.ModuleType('comfy'); comfy.model_management = types.SimpleNamespace(unload_all_models=self.unload, soft_empty_cache=lambda: None)
        sys.modules['comfy'] = comfy; sys.modules['comfy.model_management'] = comfy.model_management
        self.queue = types.SimpleNamespace(get_current_queue=lambda: ([], []), get_history=lambda prompt_id: {}, get_tasks_remaining=lambda: self.remaining)
        self.remaining = 0
        app = web.Application()
        server = types.ModuleType('server'); server.PromptServer = types.SimpleNamespace(instance=types.SimpleNamespace(app=app, routes=web.RouteTableDef(), prompt_queue=self.queue, send_sync=lambda *a: None))
        sys.modules['server'] = server
        directory = Path(__file__).parents[1]
        spec = importlib.util.spec_from_file_location('manga_assistant_test', directory / '__init__.py', submodule_search_locations=[str(directory)])
        package = importlib.util.module_from_spec(spec); sys.modules[spec.name] = package
        for name in ('routes', 'storage', 'models', 'assistant'): sys.modules.pop(f'manga_assistant_test.{name}', None)
        spec.loader.exec_module(package)
        self.assistant = sys.modules['manga_assistant_test.assistant']; self.store = sys.modules['manga_assistant_test.routes'].store
        worker = self.root / 'worker.py'; worker.write_text(FAKE_WORKER); self.assistant.WORKER = worker
        app.add_routes(server.PromptServer.instance.routes)
        async def prompt(request):
            return web.json_response({'prompt_id': 'queued'})
        app.router.add_post('/prompt', prompt)
        self.client = TestClient(TestServer(app)); await self.client.start_server()
        self.project = self.store.create('Story')

    async def asyncTearDown(self):
        await self.assistant.RUNTIME.stop()
        await self.client.close(); self.temp.cleanup()

    def unload(self):
        self.unloaded += 1

    async def ask(self, **body):
        response = await self.client.post(f"/manga-maker/projects/{self.project['id']}/assistant", json={'module': 'logline', 'text': 'Hi', 'prompt': 'Hi', 'system': 'You help.', **body})
        if response.content_type == 'application/json':
            return response.status, (await response.json())['error']
        return response.status, [json.loads(line) for line in (await response.text()).splitlines()]

    async def test_catalog_pairs_projectors_and_reports_broken_files(self):
        state = await (await self.client.get('/manga-maker/assistant')).json()
        self.assertEqual([m['name'] for m in state['models']], ['story.gguf'])
        model = state['models'][0]
        self.assertEqual((model['label'], model['context_length'], model['thinking'], model['projectors']), ('Story 12B', 8192, True, ['vision/mmproj.gguf']))
        self.assertEqual(sorted(p['name'] for p in state['projectors']), ['vision/mmproj.gguf', 'vision/other.gguf'])
        self.assertTrue(any(error.startswith('broken.gguf') for error in state['errors']))
        self.assertNotIn('path', model)

    async def test_messages_stream_store_history_and_release_memory(self):
        status, error = await self.ask()
        self.assertEqual((status, error), (400, 'Select a GGUF language model for the assistant in Settings.'))
        self.store.configure({'assistant': {'model': 'story.gguf', 'vision': False}})
        status, events = await self.ask(text='Hello', prompt='Hello')
        self.assertEqual(events[-1]['type'], 'complete')
        self.assertEqual(events[-1]['messages'][1]['text'], 'Hello | images=0 | history=2 | False')
        self.assertFalse(self.assistant.RUNTIME.loaded); self.assertEqual(self.unloaded, 1)
        status, events = await self.ask(text='Again', prompt='Again', action={'kind': 'logline', 'target': None}, schema={'type': 'object'})
        reply = events[-1]['messages'][1]
        self.assertEqual((json.loads(reply['text']), reply['action']['kind']), ({'title': 'Again'}, 'logline'))
        chats = await (await self.client.get(f"/manga-maker/projects/{self.project['id']}/assistant")).json()
        self.assertEqual([m['text'] for m in chats['logline']], ['Hello', 'Hello | images=0 | history=2 | False', 'Again', reply['text']])
        status, events = await self.ask(prompt='fail')
        self.assertEqual(events[-1], {'type': 'error', 'message': 'Model failure', 'loaded': False})
        self.assertEqual(len(self.store.chats(self.project['id'])['logline']), 4)
        cleared = await (await self.client.delete(f"/manga-maker/projects/{self.project['id']}/assistant/logline")).json()
        self.assertEqual(cleared, {})

    async def test_keep_loaded_reuses_process_until_a_workflow_is_queued(self):
        self.store.configure({'assistant': {'model': 'story.gguf', 'vision': False, 'keep_loaded': True}})
        await self.ask(); process = self.assistant.RUNTIME.process
        status, events = await self.ask()
        self.assertNotIn('loaded', [e['type'] for e in events])
        self.assertIs(self.assistant.RUNTIME.process, process); self.assertEqual(self.unloaded, 1)
        self.assertTrue((await (await self.client.get('/manga-maker/assistant')).json())['loaded'])
        self.assertEqual((await self.client.post('/prompt', json={})).status, 200)
        self.assertFalse(self.assistant.RUNTIME.loaded); self.assertIsNotNone(process.returncode)
        self.remaining = 1
        status, error = await self.ask()
        self.assertEqual(status, 400); self.assertIn('Wait for the queue', error)

    async def test_vision_attaches_project_images(self):
        buffer = io.BytesIO(); Image.new('RGB', (2048, 1024), 'red').save(buffer, format='PNG')
        asset = self.store.import_image(self.project['id'], 'references', buffer.getvalue(), 'Hero')
        self.store.configure({'assistant': {'model': 'story.gguf', 'vision': False}})
        status, error = await self.ask(images=[asset['id']])
        self.assertIn('Enable vision', error)
        self.store.configure({'assistant': {'model': 'story.gguf', 'projector': 'vision/other.gguf'}})
        status, error = await self.ask()
        self.assertIn('incompatible', error)
        self.store.configure({'assistant': {'model': 'story.gguf', 'projector': 'vision/mmproj.gguf'}})
        status, events = await self.ask(text='Look', prompt='Look', images=[asset['id']])
        self.assertEqual(events[-1]['messages'][1]['text'], 'Look | images=1 | history=2 | True')
        self.assertEqual(self.assistant.image_url(self.project['id'], asset['id'])[:23], 'data:image/jpeg;base64,')
        status, error = await self.ask(images=['missing'])
        self.assertEqual(status, 400)


if __name__ == '__main__': unittest.main()
