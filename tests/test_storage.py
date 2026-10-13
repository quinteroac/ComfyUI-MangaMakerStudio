import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image

spec = importlib.util.spec_from_file_location('manga_storage', Path(__file__).parents[1] / 'storage.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def png(color='red'):
    buffer = io.BytesIO()
    Image.new('RGB', (80, 120), color).save(buffer, format='PNG')
    return buffer.getvalue()


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        self.store = module.ProjectStore(self.directory / 'settings.json', self.directory / 'projects')
        self.project = self.store.create('Capítulo 1')

    def tearDown(self):
        self.temp.cleanup()

    def test_global_text_generator_settings(self):
        generator = {'encoder': 'vision.safetensors', 'encoder_type': 'stable_diffusion', 'encoder_device': 'cpu', 'max_length': 1024}
        self.store.configure({'text_generator': generator})
        self.store.configure({'defaults': {'references:qwen': {'prompt': 'Local default'}}})
        reopened = module.ProjectStore(self.directory / 'settings.json', self.directory / 'unused')
        self.assertEqual(reopened.settings()['text_generator'], generator)
        self.assertNotIn('text_generator', reopened.read(self.project['id'])['config'])

    def test_reopen_versions_duplicate_relocate_and_isolation(self):
        first = self.store.import_image(self.project['id'], 'panels', png(), 'A')
        second = self.store.import_image(self.project['id'], 'panels', png('blue'), 'B', parent=first['id'])
        geometry = {'page': {'polygon': [[0, 0], [1, 0], [1, 1]], 'asset': first['id'], 'dx': .23, 'zoom': 1.4}}
        self.store.update(self.project['id'], {'workspace': geometry, 'config': {'panels:krea': {'loras': ['A']}}})
        self.assertEqual(self.store.read(self.project['id'])['workspace'], geometry)
        self.assertEqual(second['version'], 2)
        self.assertEqual(self.store.asset_path(self.project['id'], first).read_bytes(), png())
        duplicate = self.store.duplicate(self.project['id'], 'Copia')
        self.store.patch_assets(duplicate['id'], {first['id']: {'name': 'Renombrada', 'deleted': True}})
        self.assertEqual(self.store.read(self.project['id'])['assets'][0]['name'], 'A')
        self.assertFalse(self.store.read(self.project['id'])['assets'][0]['deleted'])
        moved = self.directory / 'moved'
        self.store.root().rename(moved)
        self.store.configure({'root': str(moved)})
        reopened = module.ProjectStore(self.directory / 'settings.json', self.directory / 'unused')
        self.assertEqual(reopened.read(self.project['id'])['workspace'], geometry)
        self.assertTrue(reopened.asset_path(self.project['id'], first).is_file())
        reopened.asset_path(self.project['id'], first).unlink()
        self.assertTrue(reopened.read(self.project['id'])['assets'][0]['missing'])

    def test_paths_and_symlinks(self):
        root = self.store.root()
        for path in ['../secret', '/etc/passwd', 'a/../../secret']:
            with self.assertRaises(ValueError): module.contained(root, path)
        outside = self.directory / 'outside'; outside.mkdir()
        (root / 'escape').symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError): module.contained(root, 'escape/secret')
        project_directory = self.store.directory(self.project['id'])
        (project_directory / 'panels').rmdir(); (project_directory / 'panels').symlink_to(outside)
        with self.assertRaises(ValueError): self.store.import_image(self.project['id'], 'panels', png(), 'Escape')
        with self.assertRaises(ValueError): self.store.duplicate(self.project['id'], 'Escape')
        for project_id in ['../x', '/etc', 'g' * 32]:
            with self.assertRaises(ValueError): self.store.directory(project_id)

    def test_idempotent_result_import_and_original_preservation(self):
        original = png(); first = self.store.import_image(self.project['id'], 'pages', original, 'Page', sources=['a', 'b'], result_id='job:0')
        second = self.store.import_image(self.project['id'], 'pages', original, 'Otra', result_id='job:0')
        self.assertEqual(first['id'], second['id'])
        self.assertEqual(len(self.store.read(self.project['id'])['assets']), 1)
        self.assertEqual(module.contained(self.store.directory(self.project['id']), f"pages/{first['id']}.original").read_bytes(), original)
        with self.assertRaises(ValueError): self.store.asset_path(self.project['id'], {'path': 'pages/../secret'})


if __name__ == '__main__':
    unittest.main()
