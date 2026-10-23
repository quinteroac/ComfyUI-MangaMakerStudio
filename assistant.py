import asyncio
import base64
from functools import lru_cache
import gc
import importlib.util
import io
import json
from pathlib import Path
import struct
import sys
import time
import uuid

from aiohttp import web
from PIL import Image

import comfy.model_management
import folder_paths
from server import PromptServer

from .routes import routes, store, endpoint

MODULES = ('logline', 'characters', 'plot', 'script')
DEFAULTS = {'model': '', 'projector': '', 'vision': True, 'keep_loaded': False, 'n_ctx': 16384, 'n_gpu_layers': -1,
            'temperature': 0.8, 'top_p': 0.95, 'max_tokens': 2048, 'thinking': False}
WORKER = Path(__file__).with_name('assistant_worker.py')
SCALARS = {0: '<B', 1: '<b', 2: '<H', 3: '<h', 4: '<I', 5: '<i', 6: '<f', 7: '<?', 10: '<Q', 11: '<q', 12: '<d'}
# Projector types accepted by llama.cpp's MTMD handler per language-model architecture (adapted from GGUF Chat).
VISION = {'gemma4': ('gemma4uv', 'gemma4v'), 'gemma3': ('gemma3',), 'qwen35': ('qwen3vl_merger',), 'qwen35moe': ('qwen3vl_merger',),
          'qwen3vl': ('qwen3vl_merger',), 'qwen3vlmoe': ('qwen3vl_merger',), 'qwen2vl': ('qwen2vl_merger',), 'qwen2vlmoe': ('qwen2vl_merger',),
          'minicpmv': ('resampler',), 'llama': ('mlp', 'mlp_norm', 'ldp', 'ldpv2')}


@lru_cache(maxsize=64)
def metadata(path, size, mtime):
    with open(path, 'rb') as handle:
        read = lambda fmt: struct.unpack(fmt, handle.read(struct.calcsize(fmt)))[0]
        string = lambda: handle.read(read('<Q')).decode('utf-8', 'replace')
        if handle.read(4) != b'GGUF' or read('<I') not in (2, 3):
            raise ValueError('Not a GGUF v2 or v3 file')
        read('<Q')
        values = {}
        for _ in range(read('<Q')):
            key, kind = string(), read('<I')
            if kind == 9:
                item, count = read('<I'), read('<Q')
                if item == 8:
                    for _ in range(count):
                        handle.seek(read('<Q'), 1)
                else:
                    handle.seek(struct.calcsize(SCALARS[item]) * count, 1)
            else:
                values[key] = string() if kind == 8 else read(SCALARS[kind])
    arch = values.get('general.architecture', '')
    template = values.get('tokenizer.chat_template') or ''
    return {'architecture': arch, 'label': values.get('general.name') or Path(path).stem, 'context_length': values.get(f'{arch}.context_length'),
            'embedding_length': values.get(f'{arch}.embedding_length'), 'chat_template': bool(template), 'thinking': 'enable_thinking' in template,
            'projector_type': values.get('clip.projector_type') or values.get('clip.vision.projector_type'),
            'projection_dim': values.get('clip.vision.projection_dim'), 'vision': values.get('clip.has_vision_encoder') is True}


def catalog():
    roots = [Path(folder_paths.models_dir) / 'LLM']
    if 'LLM' in folder_paths.folder_names_and_paths:
        roots += [Path(p) for p in folder_paths.get_folder_paths('LLM')]
    files, errors = {}, []
    for root in dict.fromkeys(r.resolve() for r in roots if r.is_dir()):
        for path in sorted(root.rglob('*.gguf')):
            name = path.relative_to(root).as_posix()
            if name in files or not path.resolve().is_relative_to(root):
                continue
            try:
                stat = path.stat()
                files[name] = {'name': name, 'path': str(path.resolve()), **metadata(str(path.resolve()), stat.st_size, stat.st_mtime_ns)}
            except (OSError, ValueError, KeyError, struct.error) as error:
                errors.append(f'{name}: {error}')
    projectors = [f for f in files.values() if f['architecture'] == 'clip' and f['vision']]
    models = [f for f in files.values() if f['architecture'] != 'clip']
    for model in models:
        model['projectors'] = [p['name'] for p in projectors if p['projector_type'] in VISION.get(model['architecture'], ()) and p['projection_dim'] == model['embedding_length']]
    return models, projectors, errors


def public(entry):
    return {key: value for key, value in entry.items() if key != 'path'}


def release_comfy():
    comfy.model_management.unload_all_models()
    gc.collect()
    comfy.model_management.soft_empty_cache()


class Runtime:
    """Runs llama.cpp in a child process; ending the process releases every byte it loaded."""
    def __init__(self):
        self.lock = asyncio.Lock()
        self.process = None
        self.key = None
        self.tail = bytearray()
        self.cancelled = False

    @property
    def loaded(self):
        return self.process is not None and self.process.returncode is None

    async def stop(self):
        process, self.process, self.key = self.process, None, None
        if process is None or process.returncode is not None:
            return
        process.stdin.close()
        try:
            await asyncio.wait_for(process.wait(), 10)
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()

    async def kill(self):
        if self.loaded:
            self.process.kill()
        await self.stop()

    async def events(self, load, request, keep, disconnected, timeout=1800):
        key = json.dumps(load, sort_keys=True)
        if self.key != key or not self.loaded:
            await self.stop()
            yield {'type': 'status', 'message': 'Unloading ComfyUI models…'}
            await asyncio.to_thread(release_comfy)
            self.process = await asyncio.create_subprocess_exec(sys.executable, '-u', str(WORKER), stdin=asyncio.subprocess.PIPE,
                                                                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, limit=1024 * 1024)
            self.key = key
            self.tail = bytearray()
            self.drainer = asyncio.create_task(self.drain(self.process, self.tail))
        process = self.process
        process.stdin.write((json.dumps({'load': load, **request}) + '\n').encode())
        await process.stdin.drain()
        deadline = time.monotonic() + timeout
        line = asyncio.create_task(process.stdout.readline())
        try:
            while True:
                done, _ = await asyncio.wait({line}, timeout=0.25)
                if self.cancelled or disconnected():
                    await self.kill()
                    yield {'type': 'cancelled'}
                    return
                if time.monotonic() > deadline:
                    await self.kill()
                    raise ValueError('The assistant timed out; its process was stopped and memory released.')
                if not done:
                    continue
                if not line.result():
                    await process.wait()
                    await self.drainer
                    detail = '\n'.join(self.tail.decode(errors='replace').strip().splitlines()[-3:])
                    if 'out of memory' in detail:
                        detail += '\nThe GPU ran out of memory. Reduce Context or GPU layers, or select a smaller model.'
                    await self.stop()
                    raise ValueError(f'The assistant process exited ({process.returncode}). {detail}')
                event = json.loads(line.result())
                if event['type'] == 'error':
                    await self.stop()
                    raise ValueError(event['message'])
                if event['type'] == 'done':
                    break
                yield event
                line = asyncio.create_task(process.stdout.readline())
        finally:
            line.cancel()
        if not keep:
            await self.stop()

    @staticmethod
    async def drain(process, tail):
        while chunk := await process.stderr.read(8192):
            tail.extend(chunk)
            del tail[:-8192]


RUNTIME = Runtime()
SUBMISSIONS = 0


@web.middleware
async def workflow_guard(request, handler):
    global SUBMISSIONS
    if request.method != 'POST' or request.path not in ('/prompt', '/api/prompt'):
        return await handler(request)
    if RUNTIME.lock.locked():
        return web.json_response({'error': {'type': 'manga_assistant_busy', 'message': 'Wait for the Story assistant to finish or cancel it before queueing a workflow.',
                                            'details': '', 'extra_info': {}}, 'node_errors': {}}, status=409)
    # A model kept loaded between messages gives its memory back before any workflow runs.
    await RUNTIME.stop()
    SUBMISSIONS += 1
    try:
        return await handler(request)
    finally:
        SUBMISSIONS -= 1


PromptServer.instance.app.middlewares.append(workflow_guard)


def settings():
    return {**DEFAULTS, **store.settings().get('assistant', {})}


def image_url(project_id, asset_id):
    asset = store.asset(project_id, asset_id)
    with Image.open(store.asset_path(project_id, asset)) as image:
        image = image.convert('RGB')
        image.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
        buffer = io.BytesIO()
        image.save(buffer, format='JPEG', quality=92)
    return 'data:image/jpeg;base64,' + base64.b64encode(buffer.getvalue()).decode()


def content(project_id, text, images, required=True):
    urls = []
    for asset_id in images:
        try:
            urls.append(image_url(project_id, asset_id))
        except (OSError, ValueError):
            # Older turns keep their text when an attached image was later removed.
            if required:
                raise ValueError('An attached image is missing or was removed from the project.')
    return [{'type': 'text', 'text': text}, *({'type': 'image_url', 'image_url': {'url': url}} for url in urls)] if urls else text


@routes.get('/manga-maker/assistant')
@endpoint
async def assistant_state(request):
    models, projectors, errors = await asyncio.to_thread(catalog)
    return web.json_response({'available': importlib.util.find_spec('llama_cpp') is not None, 'defaults': DEFAULTS, 'models': [public(m) for m in models],
                              'projectors': [public(p) for p in projectors], 'errors': errors, 'loaded': RUNTIME.loaded, 'busy': RUNTIME.lock.locked()})


@routes.post('/manga-maker/assistant/cancel')
@endpoint
async def assistant_cancel(request):
    if RUNTIME.lock.locked():
        RUNTIME.cancelled = True
    return web.json_response({'cancelled': True})


@routes.post('/manga-maker/assistant/release')
@endpoint
async def assistant_release(request):
    if RUNTIME.lock.locked():
        raise ValueError('Wait for the assistant to finish before releasing its model.')
    await RUNTIME.stop()
    return web.json_response({'loaded': False})


@routes.get('/manga-maker/projects/{project}/assistant')
@endpoint
async def assistant_chats(request):
    return web.json_response(store.chats(request.match_info['project']))


@routes.delete('/manga-maker/projects/{project}/assistant/{module}')
@endpoint
async def assistant_clear(request):
    project, module = request.match_info['project'], request.match_info['module']
    with store.lock:
        chats = store.chats(project)
        chats.pop(module, None)
        store.save_chats(project, chats)
    return web.json_response(chats)


@routes.post('/manga-maker/projects/{project}/assistant')
@endpoint
async def assistant_message(request):
    project = request.match_info['project']
    body = await request.json()
    module, text, prompt, system, images = body['module'], body['text'], body['prompt'], body['system'], body.get('images', [])
    schema, action = body.get('schema'), body.get('action')
    if module not in MODULES:
        raise ValueError('Unknown Story module')
    if not all(isinstance(x, str) for x in (text, prompt, system)) or not prompt.strip():
        raise ValueError('Enter a message for the assistant')
    if not isinstance(images, list) or not all(isinstance(x, str) for x in images) or not isinstance(schema, (dict, type(None))) or not isinstance(action, (dict, type(None))):
        raise ValueError('Invalid assistant request')
    if not importlib.util.find_spec('llama_cpp'):
        raise ValueError('Install llama-cpp-python in ComfyUI\'s Python environment to use the assistant.')
    if RUNTIME.lock.locked():
        raise ValueError('The assistant is already answering. Wait for it or cancel it.')
    async with RUNTIME.lock:
        if SUBMISSIONS or PromptServer.instance.prompt_queue.get_tasks_remaining():
            raise ValueError('ComfyUI is running or has queued workflows. Wait for the queue to finish before asking the assistant.')
        config = settings()
        models, projectors, _ = await asyncio.to_thread(catalog)
        model = next((m for m in models if m['name'] == config['model']), None)
        if model is None:
            raise ValueError('Select a GGUF language model for the assistant in Settings.')
        projector = next((p for p in projectors if p['name'] == config['projector'] and p['name'] in model['projectors']), None) if config['vision'] else None
        if config['vision'] and config['projector'] and projector is None:
            raise ValueError('The selected vision projector is missing or incompatible with the language model.')
        if images and projector is None:
            raise ValueError('Enable vision and select a compatible projector in Settings to send images.')
        messages = [{'role': 'system', 'content': system}]
        for message in store.chats(project).get(module, []):
            messages.append({'role': message['role'], 'content': await asyncio.to_thread(content, project, message['prompt'], message.get('images', []) if projector else [], False)})
        messages.append({'role': 'user', 'content': await asyncio.to_thread(content, project, prompt, images)})
        load = {'model_path': model['path'], 'projector_path': projector['path'] if projector else None, 'chat_template': model['chat_template'],
                'n_ctx': int(config['n_ctx']), 'n_gpu_layers': int(config['n_gpu_layers'])}
        generation = {'messages': messages, 'schema': schema, 'temperature': float(config['temperature']), 'top_p': float(config['top_p']),
                      'max_tokens': int(config['max_tokens']), 'thinking': (False if schema else bool(config['thinking'])) if model['thinking'] else None}
        RUNTIME.cancelled = False
        response = web.StreamResponse(headers={'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no'})
        await response.prepare(request)
        send = lambda event: response.write((json.dumps(event) + '\n').encode())
        disconnected = lambda: request.transport is None or request.transport.is_closing()
        answer, status = '', 'complete'
        try:
            async for event in RUNTIME.events(load, generation, bool(config['keep_loaded']), disconnected):
                if event['type'] == 'delta':
                    answer += event['text']
                if event['type'] == 'cancelled':
                    status = 'cancelled'
                await send(event)
            if status == 'complete':
                now = time.time()
                user = {'id': uuid.uuid4().hex, 'role': 'user', 'text': text, 'prompt': prompt, 'images': images, 'created': now}
                reply = {'id': uuid.uuid4().hex, 'role': 'assistant', 'text': answer, 'prompt': answer, 'action': action, 'created': now}
                with store.lock:
                    chats = store.chats(project)
                    chats.setdefault(module, []).extend([user, reply])
                    store.save_chats(project, chats)
                await send({'type': 'complete', 'messages': [user, reply], 'loaded': RUNTIME.loaded})
        except ConnectionError:
            await RUNTIME.kill()
        except (ValueError, OSError) as error:
            await send({'type': 'error', 'message': str(error), 'loaded': RUNTIME.loaded})
        except asyncio.CancelledError:
            await RUNTIME.kill()
            raise
        return response
