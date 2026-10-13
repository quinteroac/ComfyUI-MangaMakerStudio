import asyncio
import hashlib
import json
import os
from pathlib import Path
import urllib.request

import folder_paths

from .storage import contained

CATALOG = json.loads(Path(__file__).with_name('model-catalog.json').read_text('utf-8'))


class ModelDownloads:
    def __init__(self):
        self.states = {}
        self.tasks = {}
        self.lock = asyncio.Lock()

    def installed(self, artifact):
        for name in folder_paths.get_filename_list(artifact['directory']):
            if Path(name).name == artifact['filename']:
                path = folder_paths.get_full_path(artifact['directory'], name)
                if path and Path(path).is_file() and Path(path).stat().st_size:
                    return name
        return None

    def catalog(self):
        artifacts = [{**a, 'installed': self.installed(a)} for a in CATALOG['artifacts']]
        return {'profiles': CATALOG['profiles'], 'artifacts': artifacts, 'downloads': {key: dict(value) for key, value in self.states.items()}}

    def start(self, engine):
        if engine not in CATALOG['profiles']:
            raise ValueError('Unknown model profile')
        if engine not in self.tasks or self.tasks[engine].done():
            self.states[engine] = {'state': 'queued', 'received': 0, 'total': 0}
            self.tasks[engine] = asyncio.create_task(self.run(engine))
        return self.states[engine]

    async def run(self, engine):
        state = self.states[engine]
        try:
            async with self.lock:
                for artifact in CATALOG['artifacts']:
                    if artifact['id'] in CATALOG['profiles'][engine]['artifacts'] and not self.installed(artifact):
                        state.update(state='downloading', filename=artifact['filename'], received=0, total=artifact['size'])
                        await asyncio.to_thread(self.download, artifact, state)
                state['state'] = 'complete'
        except (OSError, ValueError) as error:
            state.update(state='error', error=str(error))

    def download(self, artifact, state):
        directory = Path(folder_paths.get_folder_paths(artifact['directory'])[0])
        directory.mkdir(parents=True, exist_ok=True)
        target = contained(directory, artifact['filename'])
        partial = contained(directory, '.' + artifact['filename'] + '.manga-download')
        digest = hashlib.sha256()
        try:
            with urllib.request.urlopen(artifact['url'], timeout=60) as response, partial.open('wb') as output:
                while chunk := response.read(1024 * 1024):
                    output.write(chunk); digest.update(chunk); state['received'] += len(chunk)
            if state['received'] != artifact['size'] or digest.hexdigest() != artifact['sha256']:
                raise ValueError('Downloaded weights failed size or SHA-256 verification. Retry the download.')
            os.replace(partial, target)
        finally:
            partial.unlink(missing_ok=True)
