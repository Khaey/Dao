import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('perf_snapshot', ROOT / 'scripts/dao-ops-perf-snapshot.py')
perf = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(perf)


class PerfSnapshotTests(unittest.TestCase):
    def test_meminfo_is_limited_to_required_values_and_converted_to_mb(self):
        result = perf.parse_meminfo(
            'MemTotal: 4096000 kB\nMemAvailable: 2048000 kB\n'
            'SwapTotal: 1024000 kB\nSwapFree: 512000 kB\nSecret: 99 kB\n')
        self.assertEqual(result, {'MemTotal': 4000.0, 'MemAvailable': 2000.0,
                                  'SwapTotal': 1000.0, 'SwapFree': 500.0})
        self.assertNotIn('Secret', json.dumps(result))

    def test_cpu_and_pressure_parsers_reject_invalid_or_unbounded_values(self):
        before = perf.parse_cpu_times('cpu 100 0 50 800 10 0 0 0 0 0\n')
        after = perf.parse_cpu_times('cpu 150 0 60 840 10 0 0 0 0 0\n')
        self.assertEqual(perf.cpu_percent(before, after), 60.0)
        self.assertIsNone(perf.parse_cpu_times('cpu bad 1 2 3\n'))
        pressure = perf.parse_pressure('some avg10=1.20 avg60=0.4 avg300=0.1 total=20\nsecret=private\n')
        self.assertEqual(pressure, {'some': {'avg10': 1.2, 'avg60': 0.4, 'avg300': 0.1, 'total': 20}})
        self.assertIsNone(perf.parse_pressure(''))

    def test_process_parser_exposes_only_allowlisted_labels(self):
        # Linux proc stat fields after the final ')' begin with state (field 3).
        fields = ['S'] + ['0'] * 21
        fields[11], fields[12], fields[19] = '8', '2', '99'
        parsed = perf._parse_proc_stat('123 (credential-bearing-process-name) ' + ' '.join(fields))
        self.assertEqual(parsed, {'ticks': 10, 'start_time': 99, 'label': 'other'})
        self.assertNotIn('credential-bearing-process-name', json.dumps(parsed))
        self.assertEqual(perf._process_label('postgres'), 'postgres')
        self.assertEqual(perf._process_label('cloudflared'), 'cloudflared')

    def test_percentiles_use_nearest_rank(self):
        self.assertEqual(perf.nearest_percentile([8, 1, 3, 4, 2], .5), 3.0)
        self.assertEqual(perf.nearest_percentile([8, 1, 3, 4, 2], .95), 8.0)
        self.assertIsNone(perf.nearest_percentile([], .95))

    def test_cgroup_path_is_fixed_and_io_is_aggregated_without_device_names(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            unit = root / 'system.slice' / 'dao-dev.service'
            unit.mkdir(parents=True)
            (unit / 'memory.current').write_text(str(16 * 1024 * 1024))
            (unit / 'cpu.stat').write_text('usage_usec 1234\nuser_usec 1000\n')
            (unit / 'memory.events').write_text('oom 1\noom_kill 0\n')
            (unit / 'io.stat').write_text('8:0 rbytes=100 wbytes=50 rios=1\n8:1 rbytes=25 wbytes=5\n')
            result = perf._cgroup_metrics('/system.slice/dao-dev.service', root)
            self.assertEqual(result['cgroup_memory_mb'], 16.0)
            self.assertEqual(result['cgroup_cpu_usage_usec_total'], 1234)
            self.assertEqual(result['cgroup_memory_events'], {'oom': 1, 'oom_kill': 0})
            self.assertEqual(result['cgroup_io_read_bytes_total'], 125)
            self.assertEqual(result['cgroup_io_write_bytes_total'], 55)
            self.assertNotIn('8:0', json.dumps(result))
            self.assertEqual(perf._cgroup_metrics('/etc/passwd', root), {})

    def test_http_sampler_never_returns_body_or_transport_errors(self):
        class Response:
            status = 200
            def read(self, limit): return b'private-response-body'
            def close(self): pass

        record = perf.probe_one('https://dao-dev.logiclab.fr/auth/login',
                                opener=lambda request, timeout: Response())
        self.assertEqual(record['outcome'], 'ok')
        self.assertNotIn('private-response-body', json.dumps(record))
        self.assertNotIn('https://', json.dumps(record))
        self.assertLessEqual(record['bytes_read'], perf.HTTP_BODY_LIMIT)

    def test_latency_errors_are_redacted_and_p95_has_counts(self):
        responses = iter([
            {'outcome': 'ok', 'http_status': 200, 'ttfb_ms': 10, 'total_ms': 12,
             'bytes_read': 20, 'body_truncated': False},
            {'outcome': 'timeout', 'http_status': None, 'ttfb_ms': None, 'total_ms': 3000,
             'bytes_read': 0, 'body_truncated': False},
        ] * 10)
        with patch.object(perf, 'HTTP_SAMPLES', 2), patch.object(perf, 'ENDPOINTS', (('private_label','private_url'),)):
            result = perf.latency_snapshots(lambda url: next(responses))
        rendered = json.dumps(result)
        self.assertNotIn('private_url', rendered)
        row = result['private_label']
        self.assertEqual(row['samples_requested'], 2)
        self.assertEqual(row['samples_received'], 1)
        self.assertEqual(row['errors'], 1)
        self.assertEqual(row['ttfb_ms']['p95'], 10.0)

    def test_docker_metrics_are_explicitly_unavailable_without_socket_access(self):
        self.assertEqual(perf.CONTAINER_METRICS_UNAVAILABLE['status'], 'unavailable')
        self.assertIn('no_scoped_read_only_Docker_stats_endpoint', perf.CONTAINER_METRICS_UNAVAILABLE['reason'])
        self.assertNotIn('docker.sock', json.dumps(perf.CONTAINER_METRICS_UNAVAILABLE))

    def test_collect_snapshot_output_has_no_secret_or_command_line_fields(self):
        process_values = iter([
            {123: {'ticks': 10, 'start_time': 8, 'label': 'node', 'rss_bytes': 8 * 1024 * 1024}},
            {123: {'ticks': 15, 'start_time': 8, 'label': 'node', 'rss_bytes': 10 * 1024 * 1024}},
        ])
        with tempfile.TemporaryDirectory() as temporary:
            fake_proc = Path(temporary)
            stat_file = fake_proc / 'stat'
            stat_file.write_text('cpu 100 0 0 900 0 0 0 0\n')
            with patch.object(perf, 'read_processes', side_effect=lambda _: next(process_values)), \
                 patch.object(perf, '_host_metrics', return_value={'memory_mb': {'MemAvailable': 123.0}}), \
                 patch.object(perf, 'latency_snapshots', return_value={'local_auth_login': {'samples_received': 0}}):
                result = perf.collect_snapshot(
                    proc_root=fake_proc, run_systemctl=lambda unit: {},
                    probe=lambda url: {},
                    sleep_fn=lambda seconds: stat_file.write_text('cpu 160 0 0 940 0 0 0 0\n'),
                    clock=iter([1.0, 2.0]).__next__,
                )
        serialized = json.dumps(result)
        self.assertEqual(result['cpu_percent_total_host'], 60.0)
        self.assertEqual(result['processes_top_10'][0]['pid'], 123)
        self.assertEqual(result['systemd_units'][0]['status'], 'unavailable')
        self.assertEqual(result['containers']['status'], 'unavailable')
        self.assertNotIn('command_line', serialized)
        self.assertNotIn('"environment":', serialized)
        self.assertNotIn('password', serialized)
        self.assertNotIn('secret', serialized.lower())

    def test_command_line_arguments_are_rejected_without_echoing_values(self):
        result = subprocess.run(
            [sys.executable, str(ROOT / 'scripts/dao-ops-perf-snapshot.py'), 'secret-arg'],
            capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 2)
        self.assertNotIn('secret-arg', result.stdout + result.stderr)
        self.assertNotIn('secret-arg', result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
