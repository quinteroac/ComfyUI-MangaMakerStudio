import asyncio
import importlib.util
import io
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
import uuid
from urllib.parse import unquote

from aiohttp import FormData, web
from aiohttp.test_utils import TestClient, TestServer
from PIL import Image


class RouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        for name in ('input', 'output', 'user'): (self.root / name).mkdir()
        folder = types.ModuleType('folder_paths')
        folder.get_user_directory = lambda: str(self.root / 'user')
        folder.get_input_directory = lambda: str(self.root / 'input')
        folder.get_output_directory = lambda: str(self.root / 'output')
        folder.get_temp_directory = lambda: str(self.root / 'output')
        folder.get_folder_paths = lambda category: [str(self.root / 'models' / category)]
        folder.get_filename_list = lambda category: [str(p.relative_to(self.root / 'models' / category)) for p in (self.root / 'models' / category).rglob('*.safetensors')]
        folder.get_full_path = lambda category, name: str(self.root / 'models' / category / name)
        folder.models_dir = str(self.root / 'models'); folder.folder_names_and_paths = {}
        sys.modules['folder_paths'] = folder
        comfy = types.ModuleType('comfy'); comfy.model_management = types.SimpleNamespace(unload_all_models=lambda: None, soft_empty_cache=lambda: None)
        sys.modules['comfy'] = comfy; sys.modules['comfy.model_management'] = comfy.model_management
        self.queue = types.SimpleNamespace(history={}, pending=[], running=[])
        self.queue.get_current_queue = lambda: (self.queue.running, self.queue.pending)
        self.queue.get_history = lambda prompt_id: {prompt_id: self.queue.history[prompt_id]} if prompt_id in self.queue.history else {}
        app = web.Application()
        server = types.ModuleType('server'); server.PromptServer = types.SimpleNamespace(instance=types.SimpleNamespace(app=app, routes=web.RouteTableDef(), prompt_queue=self.queue, send_sync=lambda *a: None))
        sys.modules['server'] = server
        directory = Path(__file__).parents[1]
        spec = importlib.util.spec_from_file_location('manga_route_test', directory / '__init__.py', submodule_search_locations=[str(directory)])
        package = importlib.util.module_from_spec(spec); sys.modules[spec.name] = package
        for name in ('manga_route_test.routes', 'manga_route_test.storage', 'manga_route_test.models', 'manga_route_test.assistant'): sys.modules.pop(name, None)
        spec.loader.exec_module(package)
        self.routes = sys.modules['manga_route_test.routes']; self.store = self.routes.store
        app.add_routes(server.PromptServer.instance.routes)
        self.client = TestClient(TestServer(app)); await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close(); self.temp.cleanup()

    async def test_stale_project_revision_is_a_conflict(self):
        project = self.store.create('Revisions'); path = f"/manga-maker/projects/{project['id']}"
        response = await self.client.put(path, json={'story': {'logline': {'title': 'A'}}, 'revision': 0})
        self.assertEqual((await response.json())['revision'], 1)
        response = await self.client.put(path, json={'story': {}, 'revision': 0})
        self.assertEqual(response.status, 409)
        self.assertEqual((await (await self.client.get(path)).json())['story'], {'logline': {'title': 'A'}})

    async def test_sketch_result_does_not_create_region_assets_and_cleans_temp_input(self):
        project = self.store.create('Sketch'); job_id = str(uuid.uuid4())
        image = io.BytesIO(); Image.new('RGB', (64, 96), 'green').save(image, format='PNG')
        (self.root / 'output' / 'sketch.png').write_bytes(image.getvalue())
        temp = self.root / 'output' / 'manga-maker-drawing' / project['id'] / f'{job_id}.png'
        temp.parent.mkdir(parents=True); temp.write_bytes(image.getvalue())
        response = await self.client.post(f"/manga-maker/projects/{project['id']}/jobs", json={
            'id': job_id, 'operation': 'sketch', 'kind': 'panels', 'engine': 'krea_edit', 'settings': {},
            'prompt': {}, 'output_node': '1', 'sources': [], 'name': 'Sketch to Art', 'drawing_output': {'filename': '../forged'},
        })
        self.assertEqual(response.status, 200); self.assertNotIn('drawing_output', await response.json())
        self.queue.history[job_id] = {'status': {'completed': True}, 'outputs': {'1': {'images': [{'filename': 'sketch.png', 'subfolder': '', 'type': 'output'}]}}}
        response = await self.client.get(f"/manga-maker/projects/{project['id']}"); data = await response.json()
        self.assertEqual(data['assets'], []); self.assertEqual(data['jobs'][0]['state'], 'complete')
        self.assertEqual(data['jobs'][0]['drawing_output'], {'filename': 'sketch.png', 'subfolder': '', 'type': 'output'})
        self.assertFalse(temp.exists())
        response = await self.client.get(f"/manga-maker/projects/{project['id']}/jobs/{job_id}")
        self.assertEqual((await response.json())['state'], 'complete')
        other = self.store.create('Other drawing')
        response = await self.client.get(f"/manga-maker/projects/{other['id']}/jobs/{job_id}")
        self.assertEqual(response.status, 400)
        temp.write_bytes(image.getvalue())
        response = await self.client.delete(f"/manga-maker/projects/{project['id']}/drawing-inputs/{job_id}")
        self.assertEqual(response.status, 200); self.assertFalse(temp.exists())
        response = await self.client.delete(f"/manga-maker/projects/{project['id']}/drawing-inputs/not-a-uuid")
        self.assertEqual(response.status, 400)

    async def test_manga_result_and_empty_output(self):
        for returned in (True, False):
            project = self.store.create('Manga'); job_id = str(uuid.uuid4())
            image = io.BytesIO(); Image.new('RGB', (80, 60), 'white').save(image, format='PNG')
            (self.root / 'output' / 'manga.png').write_bytes(image.getvalue())
            temp = self.root / 'output' / 'manga-maker-drawing' / project['id'] / f'{job_id}.png'
            temp.parent.mkdir(parents=True); temp.write_bytes(image.getvalue())
            response = await self.client.post(f"/manga-maker/projects/{project['id']}/jobs", json={
                'id': job_id, 'operation': 'manga', 'kind': 'panels', 'engine': 'manga_lite', 'settings': {},
                'prompt': {}, 'output_node': '1', 'sources': [], 'name': 'Art to Manga Panel',
            })
            self.assertEqual(response.status, 200)
            self.queue.history[job_id] = {'status': {'completed': True}, 'outputs': {'1': {'images': [
                {'filename': 'manga.png', 'subfolder': '', 'type': 'temp'}] if returned else []}}}
            response = await self.client.get(f"/manga-maker/projects/{project['id']}"); data = await response.json()
            self.assertEqual(data['assets'], [])
            self.assertEqual(data['jobs'][0]['state'], 'complete' if returned else 'error')
            if returned: self.assertEqual(data['jobs'][0]['drawing_output']['filename'], 'manga.png')
            else: self.assertEqual(data['jobs'][0]['error'], 'Art to Manga Panel returned no image.')
            self.assertFalse(temp.exists())

    async def test_image_download_preserves_format_extension_and_source_bytes(self):
        project = self.store.create('Downloads')
        for kind, image_format, name, filename, media_type in [
            ('references', 'PNG', 'Reference', 'Reference.png', 'image/png'),
            ('panels', 'JPEG', 'Panel.png', 'Panel.jpg', 'image/jpeg'),
            ('pages', 'WEBP', 'Página / 1', 'Página _ 1.webp', 'image/webp'),
        ]:
            content = io.BytesIO(); Image.new('RGB', (32, 48), 'blue').save(content, format=image_format)
            asset = self.store.import_image(project['id'], kind, content.getvalue(), name)
            response = await self.client.get(f"/manga-maker/projects/{project['id']}/assets/{asset['id']}?original=1")
            self.assertEqual(response.status, 200)
            self.assertEqual(await response.read(), content.getvalue())
            self.assertEqual(response.headers['Content-Type'], media_type)
            header = response.headers['Content-Disposition']
            self.assertTrue(header.startswith("attachment; filename*=UTF-8''"))
            self.assertEqual(unquote(header.split("UTF-8''", 1)[1]), filename)

    async def test_official_download_is_explicit_verified_and_retryable(self):
        module = sys.modules['manga_route_test.models']; downloads = self.routes.model_downloads
        weights = b'isolated weight fixture'; hits = []
        async def serve(request):
            hits.append(request.path); return web.Response(body=weights)
        app = web.Application(); app.router.add_get('/weights', serve)
        server = TestServer(app); await server.start_server()
        artifact = {'id': 'fixture', 'directory': 'diffusion_models', 'filename': 'official.safetensors', 'size': len(weights), 'sha256': hashlib.sha256(weights).hexdigest(), 'url': str(server.make_url('/weights'))}
        module.CATALOG = {'profiles': {'krea': {'artifacts': ['fixture'], 'settings': {'model': artifact['filename'], 'steps': 8, 'sampler': 'euler'}}}, 'artifacts': [artifact]}
        try:
            response = await self.client.get('/manga-maker/models'); self.assertEqual(response.status, 200)
            self.assertIsNone((await response.json())['artifacts'][0]['installed']); self.assertEqual(hits, [])
            response = await self.client.post('/manga-maker/models/download', json={'engine': '../../outside', 'url': str(server.make_url('/weights'))})
            self.assertEqual(response.status, 400); self.assertEqual(hits, [])
            await self.client.post('/manga-maker/models/download', json={'engine': 'krea'})
            await downloads.tasks['krea']; self.assertEqual(downloads.states['krea']['state'], 'complete')
            self.assertEqual(self.store.settings()['models']['krea']['steps'], 8)
            target = self.root / 'models/diffusion_models/official.safetensors'; self.assertEqual(target.read_bytes(), weights)
            self.assertEqual(hits, ['/weights'])
            response = await self.client.get('/manga-maker/models'); self.assertEqual((await response.json())['artifacts'][0]['installed'], 'official.safetensors')
            await self.client.post('/manga-maker/models/download', json={'engine': 'krea'}); await downloads.tasks['krea']
            self.assertEqual(hits, ['/weights'])
            target.unlink(); artifact['sha256'] = '0' * 64
            await self.client.post('/manga-maker/models/download', json={'engine': 'krea'}); await downloads.tasks['krea']
            self.assertEqual(downloads.states['krea']['state'], 'error'); self.assertFalse(target.exists())
            self.assertFalse(list(target.parent.glob('*.manga-download')))
            artifact['sha256'] = hashlib.sha256(weights).hexdigest()
            await self.client.post('/manga-maker/models/download', json={'engine': 'krea'}); await downloads.tasks['krea']
            self.assertEqual(downloads.states['krea']['state'], 'complete')
            self.assertEqual(len(hits), 3)
            self.assertEqual(len([a for a in json.loads(Path(__file__).parents[1].joinpath('model-catalog.json').read_text())['artifacts'] if a['directory'] == 'loras']), 1)
        finally:
            await server.close()

    async def test_drawing_documents_versions_and_project_ownership(self):
        one = self.store.create('Drawings'); two = self.store.create('Other project')
        image = io.BytesIO(); Image.new('RGBA', (96, 64), 'white').save(image, format='PNG')
        document = b'8BPS\x00\x01' + bytes(20)
        async def save(kind='references', parent=None, psd=document):
            form = FormData(); form.add_field('image', image.getvalue(), filename='drawing.png', content_type='image/png')
            form.add_field('document', psd, filename='drawing.psd', content_type='application/octet-stream'); form.add_field('kind', kind); form.add_field('name', 'My drawing')
            if parent: form.add_field('parent', parent)
            return await self.client.post(f"/manga-maker/projects/{one['id']}/drawings", data=form)
        response = await save(); self.assertEqual(response.status, 200); original = await response.json()
        self.assertEqual(original['metadata']['editor'], 'klecks'); self.assertEqual(original['width'], 96)
        response = await self.client.get(f"/manga-maker/projects/{one['id']}/assets/{original['id']}/drawing"); self.assertEqual(await response.read(), document)
        response = await self.client.get(f"/manga-maker/projects/{two['id']}/assets/{original['id']}/drawing"); self.assertEqual(response.status, 400)
        response = await save(parent=original['id']); version = await response.json(); self.assertEqual(version['version'], 2)
        self.assertEqual(version['parent'], original['id']); self.assertEqual(version['sources'], [original['id']])
        self.assertNotEqual(version['metadata']['drawing_document'], original['metadata']['drawing_document'])
        self.assertEqual((await save(kind='panels', parent=original['id'])).status, 400)
        self.assertEqual((await save(parent=uuid.uuid4().hex)).status, 400)
        self.assertEqual((await save(psd=b'invalid')).status, 400)
        self.assertEqual((await save(kind='pages')).status, 400)
        copy = self.store.duplicate(one['id'], 'Copy'); self.assertEqual(self.store.drawing_path(copy['id'], original).read_bytes(), document)
        forged = dict(original); forged['metadata'] = {'drawing_document': '../settings.json'}
        with self.assertRaises(ValueError): self.store.drawing_path(one['id'], forged)
        static = await self.client.get('/manga-maker/drawing/index.html'); self.assertEqual(static.status, 200)
        self.assertIn("connect-src 'self'", static.headers['Content-Security-Policy'])
        self.assertIn('klecks/embed.js', await static.text())

    async def test_result_ownership_survives_project_switch_and_repeat_poll(self):
        one = self.store.create('Uno'); two = self.store.create('Dos'); job_id = str(uuid.uuid4())
        body = {'id': job_id, 'operation': 'panels', 'engine': 'qwen', 'kind': 'panels', 'settings': {'loras': [{'name': 'active', 'model': .5}]}, 'prompt': {}, 'output_node': '9', 'name': 'Result', 'sources': []}
        response = await self.client.post(f"/manga-maker/projects/{one['id']}/jobs", json=body); self.assertEqual(response.status, 200)
        self.queue.pending = [(0, job_id)]
        response = await self.client.get(f"/manga-maker/projects/{one['id']}"); self.assertEqual((await response.json())['jobs'][0]['state'], 'queued')
        await self.client.get(f"/manga-maker/projects/{two['id']}")
        Image.new('RGB', (64, 96), 'white').save(self.root / 'output' / 'result.png')
        self.queue.pending = []; self.queue.history[job_id] = {'status': {'status_str': 'success', 'completed': True}, 'outputs': {'9': {'images': [{'filename': 'result.png', 'subfolder': '', 'type': 'output'}]}}}
        for _ in range(2): await self.client.get(f"/manga-maker/projects/{one['id']}")
        self.assertEqual(len(self.store.read(one['id'])['assets']), 1); self.assertEqual(len(self.store.read(two['id'])['assets']), 0)
        self.assertEqual(self.store.read(one['id'])['assets'][0]['metadata']['settings'], body['settings'])
        self.assertEqual(self.store.read(one['id'])['jobs'][0]['state'], 'complete')

    async def test_cancellation_waits_for_queue_and_preserves_completed_results(self):
        project = self.store.create('Cancelación')
        ids = [str(uuid.uuid4()) for _ in range(3)]
        url = f"/manga-maker/projects/{project['id']}"
        for job_id in ids:
            await self.client.post(url + '/jobs', json={'id': job_id, 'operation': 'panels', 'engine': 'qwen', 'kind': 'panels', 'settings': {}, 'prompt': {}, 'output_node': '9', 'name': 'Result', 'sources': []})
        self.queue.running = [(0, ids[0])]; self.queue.pending = [(1, ids[1]), (2, ids[2])]
        for job_id in ids[:2]:
            response = await self.client.patch(url + f'/jobs/{job_id}', json={'cancel_requested': True})
            self.assertTrue((await response.json())['cancel_requested'])
        data = await (await self.client.get(url)).json()
        self.assertEqual([j['state'] for j in data['jobs']], ['running', 'queued', 'queued'])
        self.queue.running = []; self.queue.pending = [(2, ids[2])]
        self.queue.history[ids[0]] = {'status': {'status_str': 'error', 'messages': [['execution_interrupted', {'prompt_id': ids[0]}]]}, 'outputs': {}}
        data = await (await self.client.get(url)).json()
        self.assertEqual([j['state'] for j in data['jobs']], ['cancelled', 'cancelled', 'queued'])
        await self.client.patch(url + f'/jobs/{ids[2]}', json={'cancel_requested': True})
        Image.new('RGB', (64, 96), 'white').save(self.root / 'output' / 'result.png')
        self.queue.pending = []
        self.queue.history[ids[2]] = {'status': {'status_str': 'success', 'completed': True}, 'outputs': {'9': {'images': [{'filename': 'result.png', 'subfolder': '', 'type': 'output'}]}}}
        data = await (await self.client.get(url)).json()
        self.assertEqual(data['jobs'][2]['state'], 'complete'); self.assertEqual(len(data['assets']), 1)

    async def test_analysis_is_text_and_invalid_source_cannot_escape(self):
        project = self.store.create('Análisis'); job_id = str(uuid.uuid4())
        body = {'id': job_id, 'operation': 'analysis', 'engine': 'qwen', 'kind': 'pages', 'settings': {}, 'prompt': {}, 'output_node': '5', 'name': 'Análisis'}
        await self.client.post(f"/manga-maker/projects/{project['id']}/jobs", json=body)
        self.queue.history[job_id] = {'status': {'status_str': 'success', 'completed': True}, 'outputs': {'5': {'text': ['Propuesta revisable']}}}
        response = await self.client.get(f"/manga-maker/projects/{project['id']}"); data = await response.json()
        self.assertEqual(data['jobs'][0]['text'], 'Propuesta revisable'); self.assertEqual(data['assets'], [])
        response = await self.client.post(f"/manga-maker/projects/{project['id']}/stage", json={'assets': ['../../etc/passwd']}); self.assertEqual(response.status, 400)

    async def test_local_fonts_reopen_and_reject_invalid_files(self):
        font = b'\x00\x01\x00\x00' + b'font test data'
        for _ in range(2):
            body = FormData(quote_fields=False); body.add_field('font', font, filename='../../Example.ttf')
            response = await self.client.post('/manga-maker/fonts', data=body); self.assertEqual(response.status, 200)
            installed = await response.json()
        listed = await (await self.client.get('/manga-maker/fonts')).json()
        self.assertEqual(len(listed), 1); self.assertEqual(listed[0]['name'], 'Example')
        response = await self.client.get('/manga-maker/fonts/' + installed['id']); self.assertEqual(await response.read(), font)
        for name, content in [('bad.ttf', b'not a font'), ('bad.exe', font)]:
            body = FormData(); body.add_field('font', content, filename=name)
            self.assertEqual((await self.client.post('/manga-maker/fonts', data=body)).status, 400)
        self.assertEqual((await self.client.get('/manga-maker/fonts/not-a-font-id')).status, 400)

    async def test_global_text_tasks_preserve_reference_and_store_description(self):
        project = self.store.create('Texto'); original = io.BytesIO()
        Image.new('RGB', (64, 96), 'red').save(original, format='PNG')
        asset = self.store.import_image(project['id'], 'references', original.getvalue(), 'Importada', {'origin': 'import'})
        for operation in ('enhance', 'describe'):
            job_id = str(uuid.uuid4())
            body = {'id': job_id, 'operation': operation, 'engine': 'text', 'kind': 'references', 'settings': {}, 'prompt': {}, 'output_node': '5', 'name': operation, 'sources': [asset['id']] if operation == 'describe' else []}
            await self.client.post(f"/manga-maker/projects/{project['id']}/jobs", json=body)
            self.queue.history[job_id] = {'status': {'status_str': 'success', 'completed': True}, 'outputs': {'5': {'text': ['[Subject] A red rectangle.']}}}
            for _ in range(2): await self.client.get(f"/manga-maker/projects/{project['id']}")
        data = self.store.read(project['id'])
        self.assertEqual(len(data['assets']), 1)
        self.assertEqual(data['assets'][0]['metadata']['origin'], 'import')
        self.assertEqual(data['assets'][0]['metadata']['description_prompt'], '[Subject] A red rectangle.')
        self.assertTrue(all(job['text'] == '[Subject] A red rectangle.' and job['state'] == 'complete' for job in data['jobs']))
        self.assertEqual(self.store.asset_path(project['id'], asset).read_bytes(), original.getvalue())


if __name__ == '__main__': unittest.main()
