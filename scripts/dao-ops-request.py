#!/usr/bin/env python3
"""Normalize an owner request; never forward comment text to SSH."""
import json
import os
from pathlib import Path
import sys

OPERATIONS = (
    'status', 'health', 'restart', 'env-sync', 'log-summary', 'diagnostics',
    'ops-status', 'ops-preflight', 'ops-upgrade', 'ops-rollback', 'backup-status',
    'oce-integration-inventory', 'oce-gateway-plan',
    'oce-status', 'oce-audit', 'oce-probe', 'oce-start', 'oce-stop',
)


def select(event_name, event, repository, ref, actor):
    if repository != 'Khaey/Dao' or ref != 'refs/heads/main' or actor != 'Khaey':
        raise ValueError('request rejected')
    if event_name == 'workflow_dispatch':
        operation = event.get('inputs', {}).get('operation')
    elif event_name == 'issue_comment':
        issue, comment = event.get('issue', {}), event.get('comment', {})
        if (event.get('action') != 'created' or issue.get('number') != 91
                or 'pull_request' in issue or comment.get('user', {}).get('login') != 'Khaey'):
            raise ValueError('request rejected')
        signals = {'/dao-ops ' + op: op for op in OPERATIONS}
        operation = signals.get(comment.get('body'))
    else:
        raise ValueError('request rejected')
    if operation not in OPERATIONS:
        raise ValueError('request rejected')
    return operation


def main():
    try:
        event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
        operation = select(os.environ['GITHUB_EVENT_NAME'], event,
                           os.environ['GITHUB_REPOSITORY'], os.environ['GITHUB_REF'], os.environ['GITHUB_ACTOR'])
        with open(os.environ['GITHUB_OUTPUT'], 'a') as stream:
            stream.write('operation=' + operation + '\n')
        print('OPS_REQUEST_ACCEPTED operation=' + operation)
        return 0
    except Exception:
        print('OPS_REQUEST_REJECTED (request contents withheld)', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
