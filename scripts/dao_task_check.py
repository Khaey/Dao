"""Read-only, bounded task preflight. No checkout/fetch/test/deploy side effects."""
import argparse
import json
import re
import shutil
import subprocess
import sys


def run(*args):
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=20)
        return p.stdout.strip() if p.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def impact(paths):
    if not paths:
        return {"kind": "none", "checks": []}
    if all(p.endswith('.md') for p in paths):
        return {"kind": "docs", "checks": ["git diff --check", "review local links and evidence"]}
    checks = ["git diff --check"]
    if any(p.startswith(('scripts/', 'ops/', '.github/')) for p in paths):
        checks += ["python3 -m unittest discover -s scripts/tests -v", "bash syntax for changed shell files"]
    if any(p.startswith('dao-backend/') for p in paths):
        checks += ["cd dao-backend && npm test", "cd dao-backend && npm run test:local"]
    if any(p.startswith('dao-frontend/') for p in paths):
        checks += ["cd dao-frontend && npx tsc --noEmit", "select relevant Playwright specs on disposable stack"]
    checks.append("all existing required CI checks on final PR head")
    return {"kind": "code-or-platform", "checks": checks}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true', help='local report; remote state explicitly unverified')
    args = parser.parse_args()
    root = run('git', 'rev-parse', '--show-toplevel')
    if not root:
        print(json.dumps({"error": "not a Git checkout"}))
        return 2
    remote = run('git', 'remote', 'get-url', 'origin') or ''
    official = remote.lower() in ('https://github.com/khaey/dao.git', 'https://github.com/khaey/dao', 'git@github.com:khaey/dao.git')
    if not official:
        # Never print arbitrary remote URLs: they can contain credentials.
        print(json.dumps({"error": "origin is not the official Khaey/Dao repository"}))
        return 2
    report = {"repository": "Khaey/Dao", "root": root,
              "branch": run('git', 'branch', '--show-current'),
              "head": run('git', 'rev-parse', 'HEAD'), "remote_main": None,
              "remote_state": "unverified", "latest_main_ci": None, "open_prs": None}
    if not args.offline:
        ref = run('git', 'ls-remote', 'origin', 'refs/heads/main')
        if ref and re.fullmatch(r'[0-9a-f]{40}\s+refs/heads/main', ref):
            report['remote_main'] = ref.split()[0]
            report['remote_state'] = 'verified'
        if shutil.which('gh'):
            for key, endpoint in [('latest_main_ci', 'actions/runs?branch=main&per_page=1'), ('open_prs', 'pulls?state=open&per_page=100')]:
                raw = run('gh', 'api', 'repos/Khaey/Dao/' + endpoint)
                try:
                    data = json.loads(raw or 'null')
                    if key == 'latest_main_ci' and data:
                        report[key] = [{k: r.get(k) for k in ('id', 'head_sha', 'status', 'conclusion')} for r in data['workflow_runs']]
                    elif data is not None:
                        report[key] = [{"number": r['number'], "head": r['head']['ref'], "sha": r['head']['sha']} for r in data]
                except (ValueError, KeyError, TypeError):
                    pass
    base = report['remote_main'] or 'origin/main'
    committed = run('git', 'diff', '--name-only', base + '...HEAD', '--')
    tracked = run('git', 'diff', '--name-only', 'HEAD', '--')
    untracked = run('git', 'ls-files', '--others', '--exclude-standard')
    paths = sorted(set(filter(None, '\n'.join(x or '' for x in [committed, tracked, untracked]).splitlines())))
    report['changed_files'] = paths
    report['impact'] = impact(paths)
    report['base_diff_available'] = committed is not None
    report['tools'] = {name: bool(shutil.which(name)) for name in ('git', 'gh', 'node', 'npm', 'docker', 'ssh')}
    report['next'] = 'Use authenticated GitHub connector for missing remote/CI evidence; do not guess.'
    print(json.dumps(report, indent=2))
    return 0 if report['remote_state'] == 'verified' else 3


if __name__ == '__main__':
    sys.exit(main())
