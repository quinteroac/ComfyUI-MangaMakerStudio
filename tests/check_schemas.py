"""Validate built API graphs against installed V3 input normalization, without sampling."""
import copy
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[3]))

from comfy_api.latest._io import build_nested_inputs, get_finalized_class_inputs

schemas = json.load(open(sys.argv[1]))
prompts = json.load(open(sys.argv[2]))
for job in prompts:
    for node in job['graph'].values():
        schema = schemas[node['class_type']]
        inputs = node['inputs']
        normalized = copy.deepcopy(schema['input'])
        for group in normalized.values():
            for spec in group.values():
                if isinstance(spec[0], list):
                    spec[:] = ['COMBO', {'options': spec[0]}]
                if len(spec) == 1:
                    spec.append({})
        defined, _, v3 = get_finalized_class_inputs(normalized, inputs)
        for name in defined['required']:
            assert name in inputs, (job['op'], node['class_type'], 'missing', name)
        nested = build_nested_inputs(inputs, v3)
        if node['class_type'] == 'TextEncodeQwenImage21':
            assert len(nested['images']) == job['count']
        if node['class_type'] == 'TextGenerate':
            assert nested['sampling_mode'] == {'sampling_mode': 'off'}
        for name, value in inputs.items():
            if isinstance(value, list) and len(value) == 2:
                source = job['graph'][value[0]]
                actual = schemas[source['class_type']]['output'][value[1]]
                expected = defined['required'].get(name, defined['optional'].get(name))[0]
                assert actual == expected, (name, actual, expected)
print(f'{len(prompts)} graphs match installed input contracts and linked output types')
