"""Isolated HTTP fixture for browser tests; never loads models or changes ComfyUI."""
import asyncio
import importlib.util
import io
import json
from pathlib import Path
import sys
import signal
import tempfile
import types

from aiohttp import web
from PIL import Image, ImageDraw


async def main():
    with tempfile.TemporaryDirectory(prefix='manga-browser-') as temp:
        root = Path(temp)
        for name in ('input', 'output', 'user'):
            (root / name).mkdir()
        folder = types.ModuleType('folder_paths')
        folder.get_user_directory = lambda: str(root / 'user')
        folder.get_input_directory = lambda: str(root / 'input')
        folder.get_output_directory = lambda: str(root / 'output')
        folder.get_temp_directory = lambda: str(root / 'output')
        folder.get_folder_paths = lambda category: [str(root / 'models' / category)]
        folder.get_filename_list = lambda category: [str(p.relative_to(root / 'models' / category)) for p in (root / 'models' / category).rglob('*.safetensors')]
        folder.get_full_path = lambda category, name: str(root / 'models' / category / name)
        definitions = json.loads(Path('/tmp/manga-object-info.json').read_text())
        for category, node, field in [('diffusion_models', 'UNETLoader', 'unet_name'), ('text_encoders', 'CLIPLoader', 'clip_name'), ('vae', 'VAELoader', 'vae_name'), ('loras', 'LoraLoaderModelOnly', 'lora_name')]:
            spec = definitions[node]['input']['required'][field]; names = spec[0] if isinstance(spec[0], list) else spec[1]['options']
            for name in names:
                target = root / 'models' / category / name; target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(b'fixture')
        sys.modules['folder_paths'] = folder
        server = types.ModuleType('server')
        class Queue:
            history = {}
            running = []
            pending = []
            def get_current_queue(self): return self.running, self.pending
            def get_history(self, prompt_id=None): return {prompt_id: self.history[prompt_id]} if prompt_id in self.history else {}
        instance = types.SimpleNamespace(routes=web.RouteTableDef(), app=web.Application(client_max_size=64 * 1024 ** 2), prompt_queue=Queue(), send_sync=lambda *a: None)
        server.PromptServer = types.SimpleNamespace(instance=instance)
        sys.modules['server'] = server
        package_path = Path(__file__).parents[1]
        spec = importlib.util.spec_from_file_location('manga_test_plugin', package_path / '__init__.py', submodule_search_locations=[str(package_path)])
        package = importlib.util.module_from_spec(spec); sys.modules[spec.name] = package; spec.loader.exec_module(package)
        routes = sys.modules['manga_test_plugin.routes']
        def fixture_download(artifact, state):
            target = root / 'models' / artifact['directory'] / artifact['filename']
            target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(b'fixture')
            state['received'] = artifact['size']
        routes.model_downloads.download = fixture_download
        @instance.routes.post('/test/model-missing/{engine}')
        async def model_missing(request):
            catalog = routes.model_downloads.catalog(); profile = catalog['profiles'][request.match_info['engine']]
            for artifact in catalog['artifacts']:
                if artifact['id'] in profile['artifacts'] and artifact['installed']:
                    Path(folder.get_full_path(artifact['directory'], artifact['installed'])).unlink()
            return web.json_response({})
        project = routes.store.create('Prueba de navegador')
        for i in range(8):
            image = Image.new('RGB', (320 + i * 10, 480), ('#e8d4b2' if i % 2 else '#d0deef'))
            draw = ImageDraw.Draw(image); draw.rectangle((35, 45, 275, 435), outline='#343439', width=4); draw.ellipse((85, 80, 220, 225), outline='#343439', width=3); draw.text((95, 260), f'Panel {i+1}', fill='#343439')
            buffer = io.BytesIO(); image.save(buffer, format='PNG'); routes.store.import_image(project['id'], 'panels', buffer.getvalue(), f'Panel de prueba {i+1}')
        @instance.routes.post('/test/active')
        async def active(request):
            data = await request.json()
            instance.prompt_queue.running = data['running']; instance.prompt_queue.pending = data['pending']
            return web.json_response({'ok': True})
        @instance.routes.post('/test/queue')
        async def cancel_queue(request):
            data = await request.json()
            instance.prompt_queue.pending = [item for item in instance.prompt_queue.pending if item[1] not in data['delete']]
            return web.json_response({})
        @instance.routes.post('/test/interrupt')
        async def interrupt(request):
            data = await request.json(); prompt_id = data['prompt_id']
            if any(item[1] == prompt_id for item in instance.prompt_queue.running):
                instance.prompt_queue.running = [item for item in instance.prompt_queue.running if item[1] != prompt_id]
                instance.prompt_queue.history[prompt_id] = {'status': {'status_str': 'error', 'messages': [['execution_interrupted', {'prompt_id': prompt_id}]]}, 'outputs': {}}
            return web.json_response({})
        @instance.routes.post('/test/history')
        async def history(request):
            data = await request.json(); instance.prompt_queue.history[data['id']] = data['history']; return web.json_response({'ok': True})
        @instance.routes.post('/test/upload')
        async def upload(request):
            fields = {}; content = None; filename = ''
            reader = await request.multipart()
            async for part in reader:
                if part.name == 'image': content = bytes(await part.read()); filename = part.filename
                else: fields[part.name] = await part.text()
            path = routes.contained(root / 'output', Path(fields.get('subfolder', '')) / filename)
            path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(content)
            with Image.open(io.BytesIO(content)) as image: width, height = image.size
            return web.json_response({'name': filename, 'subfolder': fields.get('subfolder', ''), 'type': 'temp', 'width': width, 'height': height})
        @instance.routes.get('/test/view')
        async def view(request):
            return web.FileResponse(routes.contained(root / 'output', Path(request.query.get('subfolder', '')) / request.query['filename']))
        @instance.routes.post('/test/enqueue')
        async def enqueue(request):
            body = await request.json(); instance.prompt_queue.pending.append((1, body['prompt_id']))
            return web.json_response({'prompt_id': body['prompt_id'], 'number': 1, 'node_errors': {}})

        @instance.routes.post('/test/complete')
        async def complete(request):
            body = await request.json()
            prompt_id = body['prompt_id']
            instance.prompt_queue.pending = [item for item in instance.prompt_queue.pending if item[1] != prompt_id]
            graph = body['prompt']
            output_id, output = next((node_id, node) for node_id, node in graph.items() if node['class_type'] in ('SaveImage', 'SaveText'))
            if output['class_type'] == 'SaveText':
                if output['inputs']['filename_prefix'].endswith('/describe'):
                    text = '[TASK: TEXT_TO_IMAGE]\n\n[Subject] A red rectangle.\n\n[Composition] Centered.\n\n[Style] Flat colors.'
                elif output['inputs']['filename_prefix'].endswith('/enhance'):
                    text = 'One adult woman seated comfortably on a modern couch.'
                else:
                    text = 'Improve linework and anatomy while preserving all panel borders and framing.'
                result = {'text': [text]}
            else:
                filename = f'{prompt_id}.png'
                Image.new('RGB', (320, 480), '#c1d8cb').save(root / 'output' / filename)
                result = {'images': [{'filename': filename, 'subfolder': '', 'type': 'output'}]}
            instance.prompt_queue.history[prompt_id] = {'status': {'status_str': 'success', 'completed': True}, 'outputs': {output_id: result}}
            return web.json_response({'prompt_id': prompt_id, 'number': 1, 'node_errors': {}})
        @instance.routes.get('/test/project')
        async def test_project(request): return web.json_response(routes.store.read(project['id']))
        instance.app.add_routes(instance.routes)
        runner = web.AppRunner(instance.app); await runner.setup(); site = web.TCPSite(runner, '127.0.0.1', 0); await site.start()
        print(json.dumps({'url': f'http://127.0.0.1:{site._server.sockets[0].getsockname()[1]}', 'project': project['id']}), flush=True)
        stopped = asyncio.Event()
        asyncio.get_running_loop().add_signal_handler(signal.SIGTERM, stopped.set)
        try:
            await stopped.wait()
        finally:
            await runner.cleanup()


if __name__ == '__main__': asyncio.run(main())
