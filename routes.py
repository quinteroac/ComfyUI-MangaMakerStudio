import asyncio
import functools
import json
from pathlib import Path
import re
import shutil
import time
import uuid
from urllib.parse import quote

from aiohttp import web
from PIL import Image, UnidentifiedImageError

import folder_paths
from server import PromptServer

from .storage import ProjectStore, contained
from .models import ModelDownloads

store = ProjectStore(Path(folder_paths.get_user_directory()) / 'manga-maker-settings.json',
                     Path(folder_paths.get_user_directory()) / 'manga-maker-projects')
routes = PromptServer.instance.routes
model_downloads = ModelDownloads()


def endpoint(fn):
    @functools.wraps(fn)
    async def wrapped(request):
        try:
            return await fn(request)
        except FileNotFoundError as error:
            return web.json_response({'error': f'Missing file: {error.filename}'}, status=404)
        except (ValueError, KeyError, UnidentifiedImageError) as error:
            return web.json_response({'error': str(error) or 'Asset not found'}, status=400)
        except OSError as error:
            return web.json_response({'error': str(error)}, status=400)
    return wrapped


@routes.get('/manga-maker/drawing/{path:.*}')
@endpoint
async def drawing_files(request):
    path = contained(Path(__file__).parent / 'drawing', request.match_info['path'])
    response = web.FileResponse(path)
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'"
    return response


@routes.post('/manga-maker/projects/{project}/drawings')
@endpoint
async def save_drawing(request):
    fields = {}; reader = await request.multipart()
    async for part in reader:
        fields[part.name] = bytes(await part.read()) if part.name in ('image', 'document') else await part.text()
    if not fields.get('image') or not fields.get('document'):
        raise ValueError('The PNG and PSD drawing are required')
    return web.json_response(await asyncio.to_thread(store.import_drawing, request.match_info['project'], fields.get('kind', 'references'), fields['image'], fields['document'], fields.get('name', 'Drawing'), fields.get('parent') or None))


@routes.get('/manga-maker/projects/{project}/assets/{asset}/drawing')
@endpoint
async def drawing_document(request):
    project = request.match_info['project']; asset = store.asset(project, request.match_info['asset'])
    return web.FileResponse(store.drawing_path(project, asset))


@routes.get('/manga-maker/settings')
@endpoint
async def settings(request):
    return web.json_response(store.settings())


@routes.get('/manga-maker/models')
@endpoint
async def models(request):
    return web.json_response(await asyncio.to_thread(model_downloads.catalog))


@routes.post('/manga-maker/models/download')
@endpoint
async def download_models(request):
    body = await request.json()
    engine = body['engine']; previous = model_downloads.tasks.get(engine)
    state = model_downloads.start(engine)
    task = model_downloads.tasks[engine]
    if task is not previous:
        task.add_done_callback(lambda completed: configure_downloaded_models(engine, completed))
    return web.json_response(state)


def configure_downloaded_models(engine, task):
    if task.cancelled() or model_downloads.states[engine]['state'] != 'complete':
        return
    try:
        catalog = model_downloads.catalog(); values = dict(catalog['profiles'][engine]['settings'])
        for artifact in catalog['artifacts']:
            for key in ('model', 'encoder', 'vae', 'identity_lora'):
                if values.get(key) == artifact['filename'] and artifact['installed']:
                    values[key] = artifact['installed']
        with store.lock:
            settings = store.settings()
            settings.setdefault('models', {}).setdefault(engine, {}).update(values)
            store.configure(settings)
    except (OSError, ValueError) as error:
        model_downloads.states[engine].update(state='error', error=f'Weights installed, but settings could not be saved: {error}')


@routes.post('/manga-maker/settings')
@endpoint
async def set_settings(request):
    data = await request.json()
    return web.json_response(await asyncio.to_thread(configure_settings, data))


def configure_settings(data):
    # Root changes and job registration share the store lock.
    with store.lock:
        if data.get('root', store.settings()['root']) != store.settings()['root']:
            for project in store.list():
                if project['active_jobs']:
                    synchronize(project['id'])
                    if any(j['state'] in ('registered', 'queued', 'running') for j in store.read(project['id'])['jobs']):
                        raise ValueError('Wait for all jobs to finish before changing the root folder')
        return store.configure(data)


@routes.get('/manga-maker/projects')
@endpoint
async def projects(request):
    return web.json_response(await asyncio.to_thread(store.list))


@routes.get('/manga-maker/fonts')
@endpoint
async def fonts(request):
    return web.json_response(store.fonts())


@routes.post('/manga-maker/fonts')
@endpoint
async def install_font(request):
    reader = await request.multipart()
    async for part in reader:
        if part.name == 'font' and part.filename:
            return web.json_response(await asyncio.to_thread(store.install_font, part.filename, await part.read()))
    raise ValueError('Select a font file')


@routes.get('/manga-maker/fonts/{font}')
@endpoint
async def font_file(request):
    return web.FileResponse(store.font_path(request.match_info['font']))


@routes.post('/manga-maker/projects')
@endpoint
async def create(request):
    data = await request.json()
    return web.json_response(store.create(data['name']))


@routes.get('/manga-maker/projects/{project}')
@endpoint
async def read(request):
    project_id = request.match_info['project']
    await asyncio.to_thread(synchronize, project_id)
    return web.json_response(store.read(project_id))


@routes.put('/manga-maker/projects/{project}')
@endpoint
async def update(request):
    return web.json_response(store.update(request.match_info['project'], await request.json()))


@routes.post('/manga-maker/projects/{project}/duplicate')
@endpoint
async def duplicate(request):
    body = await request.json()
    return web.json_response(await asyncio.to_thread(store.duplicate, request.match_info['project'], body['name']))


@routes.post('/manga-maker/projects/{project}/import')
@endpoint
async def import_image(request):
    reader = await request.multipart()
    fields = {}
    content = None
    name = 'Image'
    async for part in reader:
        if part.name == 'image':
            content = bytes(await part.read())
            name = part.filename or name
        else:
            fields[part.name] = await part.text()
    if content is None:
        raise ValueError('Select an image')
    result = await asyncio.to_thread(store.import_image, request.match_info['project'], fields.get('kind', 'references'),
                                    content, fields.get('name', name), json.loads(fields.get('metadata', '{}')),
                                    fields.get('parent') or None, json.loads(fields.get('sources', '[]')))
    return web.json_response(result)


@routes.patch('/manga-maker/projects/{project}/assets')
@endpoint
async def patch_assets(request):
    return web.json_response(store.patch_assets(request.match_info['project'], await request.json()))


@routes.get('/manga-maker/projects/{project}/assets/{asset}')
@endpoint
async def view(request):
    project = request.match_info['project']
    asset = store.asset(project, request.match_info['asset'])
    path = store.asset_path(project, asset)
    if request.query.get('original') == '1':
        path = contained(store.directory(project), f"{asset['kind']}/{asset['id']}.original")
        with Image.open(path) as image:
            extension = '.jpg' if image.format == 'JPEG' else f'.{image.format.lower()}'
            media_type = Image.MIME.get(image.format, 'application/octet-stream')
        name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', asset['name']).strip(' .') or asset['id']
        if Path(name).suffix.lower() in Image.registered_extensions():
            name = Path(name).stem
        return web.FileResponse(path, headers={'Content-Disposition': f"attachment; filename*=UTF-8''{quote(name + extension, safe='')}", 'Content-Type': media_type})
    if request.query.get('thumb') == '1':
        path = contained(store.directory(project), f"{asset['kind']}/{asset['id']}.thumb.webp")
    return web.FileResponse(path)


@routes.post('/manga-maker/projects/{project}/stage')
@endpoint
async def stage(request):
    project = request.match_info['project']
    body = await request.json()
    result = []
    for asset_id in body['assets']:
        asset = store.asset(project, asset_id)
        relative = f'manga-maker/{project}/{asset_id}.png'
        destination = contained(folder_paths.get_input_directory(), relative)
        destination.parent.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(shutil.copyfile, store.asset_path(project, asset), destination)
        result.append(relative)
    return web.json_response(result)


def synchronize(project_id):
    with store.lock:
        data = store.read(project_id)
        changed = False
        running, pending = PromptServer.instance.prompt_queue.get_current_queue()
        running_ids = {item[1] for item in running}
        pending_ids = {item[1] for item in pending}
        for job in data['jobs']:
            if job['state'] in ('complete', 'error', 'cancelled'):
                continue
            prompt_id = job['id']
            history = PromptServer.instance.prompt_queue.get_history(prompt_id=prompt_id).get(prompt_id)
            state = job['state']
            if history:
                status = history.get('status', {})
                if status.get('status_str') == 'error':
                    job['error'] = status.get('messages', [])
                    state = 'cancelled' if any(message[0] == 'execution_interrupted' for message in job['error']) else 'error'
                elif status.get('completed'):
                    outputs = history.get('outputs', {})
                    output = outputs.get(job['output_node'], {})
                    if job['operation'] in ('analysis', 'enhance', 'describe'):
                        job['text'] = '\n'.join(output.get('text', []))
                        if job['operation'] == 'describe':
                            asset = next(a for a in data['assets'] if a['id'] == job['sources'][0])
                            asset.setdefault('metadata', {})['description_prompt'] = job['text']
                    elif job['operation'] == 'sketch':
                        images = output.get('images', [])
                        if not images:
                            job['error'] = 'Sketch to Art returned no image.'
                        else:
                            image = images[0]
                            if image.get('type') not in ('output', 'temp'):
                                raise ValueError('Unsupported result type')
                            directory = folder_paths.get_output_directory() if image['type'] == 'output' else folder_paths.get_temp_directory()
                            contained(directory, Path(image.get('subfolder', '')) / image['filename'])
                            job['drawing_output'] = {key: image[key] for key in ('filename', 'type')}
                            job['drawing_output']['subfolder'] = image.get('subfolder', '')
                    else:
                        for index, image in enumerate(output.get('images', [])):
                            if image.get('type') not in ('output', 'temp'):
                                raise ValueError('Unsupported result type')
                            directory = folder_paths.get_output_directory() if image['type'] == 'output' else folder_paths.get_temp_directory()
                            source = contained(directory, Path(image.get('subfolder', '')) / image['filename'])
                            asset = store.import_image(project_id, job['kind'], source.read_bytes(), job['name'],
                                                       {'operation': job['operation'], 'engine': job['engine'], 'settings': job['settings'],
                                                        'prompt': job['prompt'], 'prompt_id': prompt_id},
                                                       job.get('parent'), job.get('sources'), f'{prompt_id}:{index}')
                            job.setdefault('results', [])
                            if asset['id'] not in job['results']:
                                job['results'].append(asset['id'])
                    state = 'error' if job['operation'] == 'sketch' and not job.get('drawing_output') else 'complete'
                else:
                    state = 'cancelled'
            elif prompt_id in running_ids:
                state = 'running'
            elif prompt_id in pending_ids:
                state = 'queued'
            elif job.get('cancel_requested'):
                state = 'cancelled'
            elif time.time() - job['created'] > 120:
                state = 'error'
                job['error'] = 'The queue or history no longer contains this job; check ComfyUI history.'
            if job['operation'] == 'sketch' and state in ('complete', 'error', 'cancelled'):
                contained(folder_paths.get_temp_directory(), f"manga-maker-drawing/{project_id}/{str(uuid.UUID(job['id']))}.png").unlink(missing_ok=True)
            if state != job['state']:
                job['state'] = state
                changed = True
        if changed:
            # import_image has updated assets while this local snapshot held the job list.
            fresh = store.read(project_id)
            fresh['jobs'] = data['jobs']
            for asset in data['assets']:
                if 'description_prompt' in asset.get('metadata', {}):
                    target = next(a for a in fresh['assets'] if a['id'] == asset['id'])
                    target.setdefault('metadata', {})['description_prompt'] = asset['metadata']['description_prompt']
            store.write(fresh)


@routes.delete('/manga-maker/projects/{project}/drawing-inputs/{job}')
@endpoint
async def remove_drawing_input(request):
    project = request.match_info['project']; store.read(project)
    job_id = str(uuid.UUID(request.match_info['job']))
    contained(folder_paths.get_temp_directory(), f'manga-maker-drawing/{project}/{job_id}.png').unlink(missing_ok=True)
    return web.json_response({'removed': True})


@routes.post('/manga-maker/projects/{project}/jobs')
@endpoint
async def register_job(request):
    project = request.match_info['project']
    body = await request.json()
    body['id'] = str(uuid.UUID(body['id']))
    body.pop('drawing_output', None)
    if body['kind'] not in ('references', 'panels', 'pages'):
        raise ValueError('Invalid gallery')
    with store.lock:
        data = store.read(project)
        if any(j['id'] == body['id'] for j in data['jobs']):
            raise ValueError('This job is already registered')
        body.update(created=time.time(), state='registered')
        data['jobs'].append(body)
        store.write(data)
    return web.json_response(body)


@routes.get('/manga-maker/projects/{project}/jobs/{job}')
@endpoint
async def get_job(request):
    project = request.match_info['project']; await asyncio.to_thread(synchronize, project)
    job = next((item for item in store.read(project)['jobs'] if item['id'] == request.match_info['job']), None)
    if job is None:
        raise ValueError('Job not found')
    return web.json_response(job)


@routes.patch('/manga-maker/projects/{project}/jobs/{job}')
@endpoint
async def fail_job(request):
    body = await request.json()
    with store.lock:
        data = store.read(request.match_info['project'])
        job = next((j for j in data['jobs'] if j['id'] == request.match_info['job']), None)
        if job is None:
            raise ValueError('Job not found')
        if body.get('cancel_requested'):
            if job['state'] not in ('complete', 'error', 'cancelled'):
                job['cancel_requested'] = True
                store.write(data)
            return web.json_response(job)
        job.update(state='cancelled' if body.get('state') == 'cancelled' else 'error', error=body['error'])
        store.write(data)
    return web.json_response(job)


async def collect_results(app):
    async def collect():
        while True:
            for project in await asyncio.to_thread(store.list):
                if not project['active_jobs']:
                    continue
                try:
                    await asyncio.to_thread(synchronize, project['id'])
                except (OSError, ValueError, KeyError) as error:
                    PromptServer.instance.send_sync('manga_maker_error', {'project': project['id'], 'error': str(error)})
            await asyncio.sleep(2)
    task = asyncio.create_task(collect())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


PromptServer.instance.app.cleanup_ctx.append(collect_results)
