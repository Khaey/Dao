#!/usr/bin/env python3
"""Regenerate hashes after a catalogued helper change; no secrets or root calls."""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def generate():
    spec = importlib.util.spec_from_file_location('ops_catalog', ROOT / 'ops/dao-ops-admin.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.manifest({source: (ROOT / source).read_bytes() for source in module.CATALOG})


if __name__ == '__main__':
    (ROOT / 'ops/ops-release.json').write_text(json.dumps(generate(), sort_keys=True, indent=2) + '\n')
