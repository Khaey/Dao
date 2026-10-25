#!/usr/bin/env python3
"""Bounded, read-only DEV resource and HTTP latency snapshot; emits no secrets or raw logs."""
import json
import math
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone
import urllib.error
import urllib.request

PROC_ROOT = Path('/proc')
CGROUP_ROOT = Path('/sys/fs/cgroup')
SAMPLE_SECONDS = 1.0
HTTP_SAMPLES = 5
HTTP_TIMEOUT_SECONDS = 3
HTTP_BODY_LIMIT = 256 * 1024
UNITS = (
    'dao-dev.service',
    'dao-oce-gateway.service',
    'dao-oce-cloudflared.service',
    'docker.service',
    'caddy.service',
)
ENDPOINTS = (
    ('local_auth_login', 'http://127.0.0.1:3000/auth/login'),
    ('local_home', 'http://127.0.0.1:3000/'),
    ('public_auth_login', 'https://dao-dev.logiclab.fr/auth/login'),
    ('public_home', 'https://dao-dev.logiclab.fr/'),
)
SAFE_UNIT_STATES = frozenset({'active', 'inactive', 'failed', 'activating', 'deactivating', 'reloading'})
CONTAINER_METRICS_UNAVAILABLE = {'status': 'unavailable', 'reason': 'no_scoped_read_only_Docker_stats_endpoint; Docker socket is not queried'}
SAFE_PROCESS_LABELS = ('node', 'postgres', 'cloudflared', 'caddy', 'docker', 'containerd', 'python', 'nginx')


def _number(value):
    return int(value) if isinstance(value, str) and re.fullmatch(r'\d{1,20}', value) else None


def parse_meminfo(text):
    raw = {}
    for line in text.splitlines():
        match = re.fullmatch(r'(MemTotal|MemAvailable|SwapTotal|SwapFree):\s+(\d+)\s+kB', line.strip())
        if match:
            raw[match.group(1)] = int(match.group(2))
    return {name: round(raw[name] / 1024, 1) if name in raw else None
            for name in ('MemTotal', 'MemAvailable', 'SwapTotal', 'SwapFree')}


def parse_cpu_times(text):
    line = next((row for row in text.splitlines() if row.startswith('cpu ')), '')
    values = line.split()[1:]
    if len(values) < 4 or any(not re.fullmatch(r'\d{1,20}', value) for value in values):
        return None
    ticks = [int(value) for value in values]
    return {'total': sum(ticks), 'idle': ticks[3] + (ticks[4] if len(ticks) > 4 else 0)}


def cpu_percent(before, after):
    if not before or not after:
        return None
    total = after['total'] - before['total']
    idle = after['idle'] - before['idle']
    if total <= 0 or idle < 0 or idle > total:
        return None
    return round(100.0 * (total - idle) / total, 2)


def nearest_percentile(values, percentile):
    if not values:
        return None
    ordered = sorted(float(value) for value in values)
    rank = max(1, math.ceil(percentile * len(ordered)))
    return round(ordered[rank - 1], 2)


def _process_label(name):
    lowered = name.lower()
    for label in SAFE_PROCESS_LABELS:
        if lowered == label or lowered.startswith(label + '-') or lowered.startswith(label + '.'):
            return label
    if lowered.startswith('node'):
        return 'node'
    if lowered.startswith('postgres'):
        return 'postgres'
    return 'other'


def _parse_proc_stat(text):
    left, right = text.find('('), text.rfind(')')
    if left < 0 or right <= left:
        return None
    fields = text[right + 1:].split()
    if len(fields) < 22:
        return None
    try:
        utime, stime, start_time = int(fields[11]), int(fields[12]), int(fields[19])
    except (ValueError, IndexError):
        return None
    return {'ticks': utime + stime, 'start_time': start_time,
            'label': _process_label(text[left + 1:right])}


def read_processes(proc_root=PROC_ROOT):
    processes = {}
    try:
        entries = list(proc_root.iterdir())
    except OSError:
        return processes
    try:
        page_size = os.sysconf('SC_PAGE_SIZE')
    except (ValueError, OSError):
        page_size = 4096
    for entry in entries:
        if not entry.name.isdigit():
            continue
        try:
            parsed = _parse_proc_stat((entry / 'stat').read_text())
            statm = (entry / 'statm').read_text().split()
            if parsed is None or len(statm) < 2 or not statm[1].isdigit():
                continue
            parsed['rss_bytes'] = int(statm[1]) * page_size
            processes[int(entry.name)] = parsed
        except (OSError, ValueError):
            continue
    return processes


def process_deltas(before, after, elapsed):
    result = {}
    if elapsed <= 0:
        return result
    try:
        ticks_per_second = os.sysconf('SC_CLK_TCK')
    except (ValueError, OSError):
        return result
    for pid, current in after.items():
        previous = before.get(pid)
        if not previous or previous['start_time'] != current['start_time']:
            cpu = None
        else:
            delta = current['ticks'] - previous['ticks']
            cpu = round(100.0 * delta / ticks_per_second / elapsed, 2) if delta >= 0 else None
        result[pid] = {'pid': pid, 'label': current['label'], 'cpu_percent': cpu,
                       'rss_mb': round(current['rss_bytes'] / (1024 * 1024), 1)}
    return result


def parse_pressure(text):
    result = {}
    for line in text.splitlines():
        parts = line.split()
        if not parts or parts[0] not in {'some', 'full'}:
            continue
        row = {}
        for token in parts[1:]:
            key, sep, value = token.partition('=')
            if sep and key in {'avg10', 'avg60', 'avg300', 'total'}:
                try:
                    parsed = float(value)
                except ValueError:
                    continue
                if math.isfinite(parsed) and parsed >= 0:
                    row[key] = round(parsed, 2) if key != 'total' else int(parsed)
        if row:
            result[parts[0]] = row
    return result or None


def _read_int(path):
    try:
        raw = path.read_text().strip()
    except OSError:
        return None
    return _number(raw)


def _safe_cgroup_path(value):
    if not isinstance(value, str) or not re.fullmatch(r'/system\.slice/[A-Za-z0-9_.@\\:-]+', value):
        return None
    if '..' in value.split('/'):
        return None
    return value


def _cgroup_metrics(cgroup_path, cgroup_root=CGROUP_ROOT):
    safe_path = _safe_cgroup_path(cgroup_path)
    if not safe_path:
        return {}
    directory = cgroup_root / safe_path.lstrip('/')
    result = {}
    memory = _read_int(directory / 'memory.current')
    cpu_text = ''
    events_text = ''
    io_text = ''
    try:
        cpu_text = (directory / 'cpu.stat').read_text()
    except OSError:
        pass
    try:
        events_text = (directory / 'memory.events').read_text()
    except OSError:
        pass
    try:
        io_text = (directory / 'io.stat').read_text()
    except OSError:
        pass
    if memory is not None:
        result['cgroup_memory_mb'] = round(memory / (1024 * 1024), 1)
    for key in ('usage_usec',):
        match = re.search(r'^' + key + r'\s+(\d+)$', cpu_text, re.M)
        if match:
            result['cgroup_cpu_usage_usec_total'] = int(match.group(1))
    events = {}
    for key in ('oom', 'oom_kill'):
        match = re.search(r'^' + key + r'\s+(\d+)$', events_text, re.M)
        if match:
            events[key] = int(match.group(1))
    if events:
        result['cgroup_memory_events'] = events
    reads = writes = 0
    found_io = False
    for line in io_text.splitlines():
        for key, current in (('rbytes', reads), ('wbytes', writes)):
            match = re.search(r'(?:^|\s)' + key + r'=(\d+)(?:\s|$)', line)
            if match:
                found_io = True
                if key == 'rbytes':
                    reads += int(match.group(1))
                else:
                    writes += int(match.group(1))
    if found_io:
        result['cgroup_io_read_bytes_total'] = reads
        result['cgroup_io_write_bytes_total'] = writes
    return result


def _systemctl(unit):
    try:
        completed = subprocess.run(
            ['/usr/bin/systemctl', 'show', '--no-pager',
             '--property=Id,ActiveState,SubState,MainPID,NRestarts,MemoryCurrent,CPUUsageNSec,TasksCurrent,ControlGroup',
             unit],
            capture_output=True, text=True, timeout=3, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return {}
    if completed.returncode != 0 or len(completed.stdout) > 4096:
        return {}
    result = {}
    for line in completed.stdout.splitlines():
        key, separator, value = line.partition('=')
        if separator and key in {'Id', 'ActiveState', 'SubState', 'MainPID', 'NRestarts',
                                 'MemoryCurrent', 'CPUUsageNSec', 'TasksCurrent', 'ControlGroup'}:
            result[key] = value[:256]
    return result


def _service_snapshot(unit, processes, run_systemctl, cgroup_root):
    raw = run_systemctl(unit)
    if not raw:
        return {'unit': unit, 'status': 'unavailable', 'reason': 'systemd_query_failed'}
    active = raw.get('ActiveState', 'unknown')
    if active not in SAFE_UNIT_STATES:
        active = 'unknown'
    sub = raw.get('SubState', 'unknown')
    if not re.fullmatch(r'[A-Za-z_]{1,24}', sub):
        sub = 'unknown'
    pid = _number(raw.get('MainPID', ''))
    restarts = _number(raw.get('NRestarts', ''))
    memory = _number(raw.get('MemoryCurrent', ''))
    cpu_total = _number(raw.get('CPUUsageNSec', ''))
    tasks = _number(raw.get('TasksCurrent', ''))
    process = processes.get(pid) if pid else None
    result = {
        'unit': unit, 'status': 'ok', 'active_state': active, 'sub_state': sub,
        'main_pid': pid if pid else None, 'restart_count': restarts,
        'main_process_rss_mb': process['rss_mb'] if process else None,
        'main_process_cpu_percent': process['cpu_percent'] if process else None,
        'systemd_memory_mb': round(memory / (1024 * 1024), 1) if memory is not None else None,
        'systemd_cpu_usage_usec_total': int(cpu_total / 1000) if cpu_total is not None else None,
        'task_count': tasks,
    }
    cgroup_path = raw.get('ControlGroup')
    result.update(_cgroup_metrics(cgroup_path, cgroup_root))
    return result


def _open_url(request, timeout):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    return opener.open(request, timeout=timeout)


def probe_one(url, opener=None, timeout=HTTP_TIMEOUT_SECONDS):
    opener = opener or _open_url
    request = urllib.request.Request(url, headers={
        'Accept': 'text/html,application/xhtml+xml',
        'User-Agent': 'DAO-DEV-perf-snapshot/1.0',
    }, method='GET')
    started = time.perf_counter()
    response = None
    try:
        response = opener(request, timeout)
        ttfb = (time.perf_counter() - started) * 1000
        status = getattr(response, 'status', None)
        if status is None:
            status = response.getcode()
        status = int(status)
        body = response.read(HTTP_BODY_LIMIT + 1)
        total = (time.perf_counter() - started) * 1000
        return {'outcome': 'ok' if 200 <= status < 400 else ('http_4xx' if status < 500 else 'http_5xx'),
                'http_status': status, 'ttfb_ms': round(ttfb, 2), 'total_ms': round(total, 2),
                'bytes_read': min(len(body), HTTP_BODY_LIMIT), 'body_truncated': len(body) > HTTP_BODY_LIMIT}
    except urllib.error.HTTPError as error:
        elapsed = round((time.perf_counter() - started) * 1000, 2)
        code = int(error.code) if 100 <= int(error.code) <= 599 else None
        return {'outcome': 'http_4xx' if code and code < 500 else 'http_5xx',
                'http_status': code, 'ttfb_ms': elapsed, 'total_ms': elapsed,
                'bytes_read': 0, 'body_truncated': False}
    except (TimeoutError, socket.timeout, urllib.error.URLError) as error:
        reason = getattr(error, 'reason', None)
        outcome = 'timeout' if isinstance(error, (TimeoutError, socket.timeout)) or isinstance(reason, (TimeoutError, socket.timeout)) else 'network_error'
        return {'outcome': outcome, 'http_status': None, 'ttfb_ms': None, 'total_ms': round((time.perf_counter() - started) * 1000, 2),
                'bytes_read': 0, 'body_truncated': False}
    except Exception:
        return {'outcome': 'network_error', 'http_status': None, 'ttfb_ms': None,
                'total_ms': round((time.perf_counter() - started) * 1000, 2),
                'bytes_read': 0, 'body_truncated': False}
    finally:
        if response is not None:
            try:
                response.close()
            except Exception:
                pass


def latency_snapshots(probe=probe_one):
    result = {}
    for label, url in ENDPOINTS:
        samples = [probe(url) for _ in range(HTTP_SAMPLES)]
        successful = [sample for sample in samples if sample.get('outcome') == 'ok']
        status_counts = {}
        for sample in samples:
            code = sample.get('http_status')
            if isinstance(code, int):
                status_counts[str(code)] = status_counts.get(str(code), 0) + 1
        result[label] = {
            'samples_requested': HTTP_SAMPLES,
            'samples_received': len(successful),
            'errors': HTTP_SAMPLES - len(successful),
            'status_counts': status_counts,
            'ttfb_ms': {'p50': nearest_percentile([s['ttfb_ms'] for s in successful], 0.50),
                        'p95': nearest_percentile([s['ttfb_ms'] for s in successful], 0.95)},
            'total_ms': {'p50': nearest_percentile([s['total_ms'] for s in successful], 0.50),
                         'p95': nearest_percentile([s['total_ms'] for s in successful], 0.95)},
            'samples': samples,
        }
    return result


def _host_metrics(proc_root=PROC_ROOT):
    try:
        load = (proc_root / 'loadavg').read_text().split()[:3]
        load = [round(float(value), 2) for value in load] if len(load) == 3 else None
    except (OSError, ValueError):
        load = None
    try:
        uptime = float((proc_root / 'uptime').read_text().split()[0])
        uptime = round(uptime, 1)
    except (OSError, ValueError, IndexError):
        uptime = None
    try:
        memory = parse_meminfo((proc_root / 'meminfo').read_text())
    except OSError:
        memory = parse_meminfo('')
    pressure = {}
    for name in ('cpu', 'memory', 'io'):
        try:
            pressure[name] = parse_pressure((proc_root / 'pressure' / name).read_text())
        except OSError:
            pressure[name] = None
    try:
        usage = shutil.disk_usage('/')
        disk = {'total_gb': round(usage.total / (1024 ** 3), 2),
                'used_gb': round((usage.total - usage.free) / (1024 ** 3), 2),
                'available_gb': round(usage.free / (1024 ** 3), 2)}
    except OSError:
        disk = None
    return {'uptime_seconds': uptime, 'load_1_5_15': load, 'memory_mb': memory,
            'cpu_pressure': pressure['cpu'], 'memory_pressure': pressure['memory'],
            'io_pressure': pressure['io'], 'root_disk': disk}


def collect_snapshot(proc_root=PROC_ROOT, cgroup_root=CGROUP_ROOT,
                     run_systemctl=None, probe=None, sleep_fn=None, clock=None):
    run_systemctl = run_systemctl or _systemctl
    probe = probe or probe_one
    sleep_fn = sleep_fn or time.sleep
    clock = clock or time.monotonic
    before_cpu = parse_cpu_times((proc_root / 'stat').read_text()) if (proc_root / 'stat').exists() else None
    before_processes = read_processes(proc_root)
    started = clock()
    sleep_fn(SAMPLE_SECONDS)
    elapsed = max(clock() - started, 0.001)
    after_cpu = parse_cpu_times((proc_root / 'stat').read_text()) if (proc_root / 'stat').exists() else None
    processes = process_deltas(before_processes, read_processes(proc_root), elapsed)
    top = sorted(processes.values(), key=lambda item: (item['cpu_percent'] is not None,
                                                        item['cpu_percent'] or 0, item['rss_mb']), reverse=True)[:10]
    services = [_service_snapshot(unit, processes, run_systemctl, cgroup_root) for unit in UNITS]
    try:
        cpu_count = os.cpu_count()
    except Exception:
        cpu_count = None
    return {
        'schema_version': 1,
        'status': 'ok',
        'sampled_at_utc': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'sample_duration_seconds': round(elapsed, 2),
        'host': _host_metrics(proc_root),
        'cpu_percent_total_host': cpu_percent(before_cpu, after_cpu),
        'logical_cpu_count': cpu_count,
        'processes_top_10': top,
        'systemd_units': services,
        'containers': dict(CONTAINER_METRICS_UNAVAILABLE),
        'http_latency': latency_snapshots(probe),
        'measurement_notes': [
            'CPU and process CPU are sampled over one interval; process percentages are per logical core.',
            'HTTP uses five sequential anonymous GET samples per fixed route; p95 is indicative at this sample count.',
            'No command lines, environment values, usernames, raw logs, HTTP bodies, or Docker socket data are read or emitted.',
            'Host/systemd data is not a per-container attribution; container metrics require a separately qualified scoped read-only source.',
        ],
    }


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if os.geteuid() == 0 or argv:
        print('PERF_SNAPSHOT_REJECTED (non-root, no arguments required)', file=sys.stderr)
        return 2
    try:
        result = collect_snapshot()
        rendered = json.dumps(result, sort_keys=True, separators=(',', ':'))
        if len(rendered) > 48000:
            raise ValueError('snapshot exceeds output bound')
        print(rendered)
        return 0
    except Exception:
        print('PERF_SNAPSHOT_FAILED (details withheld)', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
