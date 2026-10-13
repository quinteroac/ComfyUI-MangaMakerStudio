import copy
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import threading
import time
import uuid

from PIL import Image, ImageOps

KINDS = ('references', 'panels', 'pages')
FONT_SIGNATURES = {'.ttf': (b'\x00\x01\x00\x00', b'true'), '.otf': (b'OTTO', b'\x00\x01\x00\x00'), '.woff': (b'wOFF',), '.woff2': (b'wOF2',)}


def contained(root, relative):
    root = Path(root).resolve()
    path = Path(relative)
    if path.is_absolute() or '..' in path.parts:
        raise ValueError('Path is outside the authorized directory')
    target = (root / path).resolve()
    if not target.is_relative_to(root):
        raise ValueError('Symbolic link is outside the authorized directory')
    return target


def atomic_json(path, value):
    path = Path(path)
    temp = path.with_name(f'.{path.name}.{uuid.uuid4().hex}.tmp')
    try:
        temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


class ProjectStore:
    def __init__(self, settings_path, default_root):
        self.settings_path = Path(settings_path)
        self.default_root = Path(default_root)
        self.font_directory = self.settings_path.parent / 'manga-maker-fonts'
        self.lock = threading.RLock()

    def settings(self):
        if self.settings_path.exists():
            return json.loads(self.settings_path.read_text('utf-8'))
        return {'root': str(self.default_root), 'defaults': {}, 'models': {}, 'presets': {}, 'text_generator': {}}

    def fonts(self):
        return sorted([json.loads(contained(self.font_directory, path.name).read_text('utf-8')) for path in self.font_directory.glob('*.json')], key=lambda font: font['name'].casefold())

    def install_font(self, filename, content):
        extension = Path(filename).suffix.lower()
        if extension not in FONT_SIGNATURES or content[:4] not in FONT_SIGNATURES[extension]:
            raise ValueError('Use a valid TTF, OTF, WOFF or WOFF2 font file')
        with self.lock:
            font_id = hashlib.sha256(content).hexdigest()[:32]
            font = {'id': font_id, 'name': Path(filename).stem, 'family': f'MangaFont_{font_id}', 'file': font_id + extension}
            self.font_directory.mkdir(parents=True, exist_ok=True)
            contained(self.font_directory, font['file']).write_bytes(content)
            atomic_json(contained(self.font_directory, font_id + '.json'), font)
            return font

    def font_path(self, font_id):
        font_id = uuid.UUID(font_id).hex
        font = json.loads(contained(self.font_directory, font_id + '.json').read_text('utf-8'))
        if Path(font['file']).suffix not in FONT_SIGNATURES:
            raise ValueError('Unsupported font format')
        return contained(self.font_directory, font['file'])

    def configure(self, data):
        with self.lock:
            previous = self.settings()
            root = Path(data.get('root', previous['root'])).expanduser()
            if not root.is_absolute():
                raise ValueError('The root folder path must be absolute')
            root.mkdir(parents=True, exist_ok=True)
            value = {'root': str(root.resolve()), 'defaults': data.get('defaults', previous['defaults']),
                     'models': data.get('models', previous.get('models', {})),
                     'presets': data.get('presets', previous['presets']),
                     'text_generator': data.get('text_generator', previous.get('text_generator', {}))}
            self.settings_path.parent.mkdir(parents=True, exist_ok=True)
            atomic_json(self.settings_path, value)
            return value

    def root(self):
        root = Path(self.settings()['root'])
        root.mkdir(parents=True, exist_ok=True)
        return root.resolve()

    def directory(self, project_id):
        if not isinstance(project_id, str) or len(project_id) != 32 or any(c not in '0123456789abcdef' for c in project_id):
            raise ValueError('Invalid project identifier')
        return contained(self.root(), project_id)

    def read(self, project_id):
        with self.lock:
            path = contained(self.directory(project_id), 'project.json')
            data = json.loads(path.read_text('utf-8'))
            if data['id'] != project_id:
                raise ValueError('The identifier does not match the project folder')
            for asset in data['assets']:
                asset['missing'] = not self.asset_path(project_id, asset).is_file()
            return data

    def write(self, data):
        with self.lock:
            data['updated'] = time.time()
            atomic_json(contained(self.directory(data['id']), 'project.json'), data)
            return data

    def list(self):
        with self.lock:
            projects = []
            for folder in self.root().iterdir():
                if len(folder.name) == 32 and (folder / 'project.json').exists():
                    data = json.loads(contained(self.directory(folder.name), 'project.json').read_text('utf-8'))
                    if data['id'] != folder.name:
                        raise ValueError('The identifier does not match the project folder')
                    item = {k: data[k] for k in ('id', 'name', 'updated')}
                    item['active_jobs'] = any(j['state'] in ('registered', 'queued', 'running') for j in data.get('jobs', []))
                    projects.append(item)
            return sorted(projects, key=lambda x: x['updated'], reverse=True)

    def create(self, name):
        with self.lock:
            project_id = uuid.uuid4().hex
            directory = self.directory(project_id)
            directory.mkdir()
            for kind in KINDS:
                contained(directory, kind).mkdir()
            data = {'id': project_id, 'name': str(name).strip() or 'New manga', 'updated': time.time(),
                    'assets': [], 'config': {}, 'presets': {}, 'layouts': {}, 'workspace': {}, 'jobs': []}
            return self.write(data)

    def update(self, project_id, patch):
        with self.lock:
            data = self.read(project_id)
            for key in ('name', 'config', 'presets', 'layouts', 'workspace'):
                if key in patch:
                    if key != 'name' and not isinstance(patch[key], dict):
                        raise ValueError(f'{key} must be a JSON object')
                    if key == 'name' and not isinstance(patch[key], str):
                        raise ValueError('Name must be text')
                    data[key] = patch[key]
            return self.write(data)

    def duplicate(self, project_id, name):
        with self.lock:
            source = self.read(project_id)
            # Inspect every path before copying: copytree must never follow external symlinks.
            directory = self.directory(project_id)
            for path in directory.rglob('*'):
                if path.is_symlink():
                    raise ValueError('Remove symbolic links before duplicating the project')
            dest = self.create(name)
            target = self.directory(dest['id'])
            for kind in KINDS:
                shutil.copytree(contained(directory, kind), contained(target, kind), dirs_exist_ok=True)
            source = copy.deepcopy(source)
            source.update(id=dest['id'], name=name, jobs=[])
            return self.write(source)

    def asset_path(self, project_id, asset):
        path = Path(asset['path'])
        if len(path.parts) != 2 or path.parts[0] not in KINDS:
            raise ValueError('Invalid asset path')
        return contained(self.directory(project_id), path)

    def asset(self, project_id, asset_id):
        data = self.read(project_id)
        asset = next((a for a in data['assets'] if a['id'] == asset_id), None)
        if asset is None:
            raise ValueError('Asset not found in this project')
        return asset

    def drawing_path(self, project_id, asset):
        path = Path(asset.get('metadata', {}).get('drawing_document', ''))
        if len(path.parts) != 2 or path.parts[0] != asset['kind'] or path.suffix != '.psd' or len(path.stem) != 32 or any(c not in '0123456789abcdef' for c in path.stem):
            raise ValueError('This asset has no editable drawing')
        return contained(self.directory(project_id), path)

    def import_drawing(self, project_id, kind, image, document, name, parent=None):
        if kind not in ('references', 'panels'):
            raise ValueError('Drawings must be references or panels')
        if len(document) < 26 or document[:6] != b'8BPS\x00\x01':
            raise ValueError('Invalid PSD document')
        with self.lock:
            if parent:
                original = self.asset(project_id, parent)
                if original['kind'] != kind or original['deleted'] or original['missing']:
                    raise ValueError('Select an available original from the same category')
            relative = f'{kind}/{uuid.uuid4().hex}.psd'
            path = contained(self.directory(project_id), relative)
            path.write_bytes(document)
            saved = False
            try:
                asset = self.import_image(project_id, kind, image, name, {'editor': 'klecks', 'drawing_document': relative}, parent, [parent] if parent else [])
                saved = True
                return asset
            finally:
                if not saved:
                    path.unlink(missing_ok=True)

    def import_image(self, project_id, kind, content, name, metadata=None, parent=None, sources=None, result_id=None):
        if kind not in KINDS:
            raise ValueError('Invalid gallery')
        with self.lock:
            data = self.read(project_id)
            if result_id:
                existing = next((a for a in data['assets'] if a.get('result_id') == result_id), None)
                if existing:
                    return existing
            with Image.open(io.BytesIO(content)) as original:
                original.load()
                image = ImageOps.exif_transpose(original).convert('RGBA' if 'A' in original.getbands() else 'RGB')
            asset_id = uuid.uuid4().hex
            relative = f'{kind}/{asset_id}.png'
            path = contained(self.directory(project_id), relative)
            image.save(path, format='PNG')
            thumbnail = image.copy()
            thumbnail.thumbnail((320, 320), Image.Resampling.LANCZOS)
            thumbnail.save(contained(self.directory(project_id), f'{kind}/{asset_id}.thumb.webp'), format='WEBP')
            # Preserve imported source bytes, including original image metadata.
            contained(self.directory(project_id), f'{kind}/{asset_id}.original').write_bytes(content)
            parent_asset = next((a for a in data['assets'] if a['id'] == parent), None)
            asset = {'id': asset_id, 'path': relative, 'kind': kind, 'name': str(name), 'created': time.time(),
                     'width': image.width, 'height': image.height, 'metadata': metadata or {},
                     'parent': parent, 'version': parent_asset['version'] + 1 if parent_asset else 1,
                     'sources': sources or [], 'result_id': result_id, 'deleted': False}
            data['assets'].append(asset)
            self.write(data)
            return asset

    def patch_assets(self, project_id, changes):
        with self.lock:
            data = self.read(project_id)
            for asset in data['assets']:
                patch = changes.get(asset['id'], {})
                for field in ('name', 'deleted', 'order', 'tags'):
                    if field in patch:
                        asset[field] = patch[field]
            return self.write(data)
