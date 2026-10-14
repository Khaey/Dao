"""Synthetic credentials only; no GitHub/VPS calls or real credential reads."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('ops_private_tests', ROOT / 'ops/dao-ops-admin.py')
admin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(admin)
TOKEN = 'github_pat_' + 'FICTIONAL_ONLY_' * 4


class PrivateGithubTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.directory = self.root / 'credential'
        self.directory.mkdir(mode=0o700)
        self.token = self.directory / 'github-read-token'
        self.token.write_text(TOKEN + '\n')
        self.token.chmod(0o600)
        patches = patch.multiple(admin, GITHUB_TOKEN=self.token, ANCHOR=self.root, OWNER=os.getuid())
        patches.start()
        self.addCleanup(patches.stop)

    def test_missing_token_stops_before_network_and_has_no_anonymous_fallback(self):
        self.token.unlink()
        with patch.object(admin.urllib.request, 'build_opener') as network:
            with self.assertRaisesRegex(admin.Halt, '^GITHUB_TOKEN_MISSING$'):
                admin.fetch(admin.API + '/git/ref/heads/main')
        network.assert_not_called()

    def test_invalid_tokens_and_unsafe_files_are_rejected(self):
        for value in ('', 'ghp_' + 'x' * 40, TOKEN + '\r\n', TOKEN + '\nX: injected',
                      ' ' + TOKEN, TOKEN + '\n\n', 'github_pat_' + 'x' * 300):
            with self.subTest(kind='format'), patch.object(admin.urllib.request, 'build_opener') as network:
                self.token.write_text(value)
                with self.assertRaises(admin.Halt):
                    admin.fetch(admin.API + '/issues/91')
                network.assert_not_called()
        self.token.write_text(TOKEN)
        for mode in (0o640, 0o644, 0o400, 0o660):
            self.token.chmod(mode)
            with self.subTest(mode=mode), self.assertRaisesRegex(admin.Halt, 'GITHUB_TOKEN_UNSAFE'):
                admin.github_token()
        self.token.chmod(0o600)
        self.directory.chmod(0o750)
        with self.assertRaisesRegex(admin.Halt, 'GITHUB_TOKEN_UNSAFE'):
            admin.github_token()
        self.directory.chmod(0o700)
        with patch.object(admin, 'OWNER', os.getuid() + 1), self.assertRaises(admin.Halt):
            admin.github_token()

    def test_symlinks_hardlinks_and_fifo_are_rejected(self):
        target = self.root / 'target'
        self.token.rename(target)
        self.token.symlink_to(target)
        with self.assertRaisesRegex(admin.Halt, 'GITHUB_TOKEN_UNSAFE'):
            admin.github_token()
        self.token.unlink()
        os.link(target, self.token)
        with self.assertRaisesRegex(admin.Halt, 'GITHUB_TOKEN_UNSAFE'):
            admin.github_token()
        self.token.unlink()
        os.mkfifo(self.token, 0o600)
        with self.assertRaisesRegex(admin.Halt, 'GITHUB_TOKEN_UNSAFE'):
            admin.github_token()

    def test_rotation_is_observed_without_caching_or_snapshotting_credentials(self):
        self.assertEqual(admin.github_token(), TOKEN)
        replacement = self.directory / 'replacement'
        replacement.write_text(TOKEN + 'ROTATED')
        replacement.chmod(0o600)
        os.replace(replacement, self.token)
        self.assertEqual(admin.github_token(), TOKEN + 'ROTATED')
        self.assertNotIn(str(self.token), [entry[0] for entry in admin.CATALOG.values()])

    def test_only_exact_repository_read_endpoints_can_receive_authorization(self):
        sha = 'a' * 40
        paths = ['/git/ref/heads/main', '/issues/91', '/issues/91/comments?per_page=100&page=1000',
                 '/actions/runs?branch=main&event=push&head_sha=' + sha + '&per_page=100',
                 '/contents/ops/ops-release.json?ref=' + sha,
                 '/contents/ops/dao-ops-admin.py?ref=' + sha]
        for path in paths:
            with self.subTest(path=path), patch.object(admin.urllib.request, 'build_opener') as build:
                response = build.return_value.open.return_value.__enter__.return_value
                response.status = 200
                response.read.return_value = b'fictional data'
                self.assertEqual(admin.fetch(admin.API + path), b'fictional data')
                request = build.return_value.open.call_args.args[0]
                self.assertEqual(request.get_method(), 'GET')
                self.assertEqual(request.get_header('Authorization'), 'Bearer ' + TOKEN)
                self.assertEqual(request.get_header('Accept'), 'application/vnd.github.raw+json'
                                 if path.startswith('/contents/') else 'application/vnd.github+json')
                self.assertEqual(build.call_args.args[0].proxies, {})
        bad = [admin.API + '/issues/92', admin.API + '/issues/91?extra=1',
               admin.API + '/contents/ops/dao-ops-admin.py?ref=main',
               admin.API + '/contents/README.md?ref=' + sha,
               admin.API + '/contents/ops/../dao-dev-admin.py?ref=' + sha,
               admin.API + '/git/ref/heads/main#fragment',
               admin.API + '/issues/91/comments?per_page=100&page=0',
               admin.API + '/issues/91/comments?per_page=100&page=1&extra=1',
               admin.API.replace('Khaey/Dao', 'Other/Repo') + '/issues/91',
               'https://api.github.com.evil.invalid/repos/Khaey/Dao/issues/91',
               'https://raw.githubusercontent.com/Khaey/Dao/' + sha + '/ops/dao-ops-admin.py']
        for url in bad:
            with self.subTest(url=url), patch.object(admin, 'github_token') as read, \
                 patch.object(admin.urllib.request, 'build_opener') as network:
                with self.assertRaisesRegex(admin.Halt, '^UNTRUSTED_SOURCE$'):
                    admin.fetch(url)
                read.assert_not_called()
                network.assert_not_called()

    def test_real_redirect_handlers_never_forward_a_second_request(self):
        calls = []
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                calls.append(self.path)
                self.send_response(self.server.redirect_code)
                self.send_header('Location', '/credential-sink')
                self.end_headers()

            def log_message(self, *_):
                pass

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            base = 'http://127.0.0.1:' + str(server.server_port) + '/repos/Khaey/Dao'
            for code in (301, 302, 303, 307, 308):
                server.redirect_code = code
                calls.clear()
                with self.subTest(code=code), patch.object(admin, 'API', base):
                    with self.assertRaisesRegex(admin.Halt, '^GITHUB_REDIRECT_REJECTED$'):
                        admin.fetch(base + '/issues/91')
                self.assertEqual(calls, ['/repos/Khaey/Dao/issues/91'])
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_api_errors_and_unexpected_exceptions_never_print_secrets(self):
        url = admin.API + '/issues/91'
        for error, expected in (
            (urllib.error.HTTPError(url, 401, TOKEN, {'X-Private': TOKEN}, io.BytesIO(TOKEN.encode())), 'GITHUB_HTTP_401'),
            (urllib.error.HTTPError(url, 403, TOKEN, {}, None), 'GITHUB_HTTP_403'),
            (urllib.error.HTTPError(url, 404, TOKEN, {}, None), 'GITHUB_HTTP_404'),
            (RuntimeError(TOKEN), 'OPERATION_FAILED'),
        ):
            stdout, stderr = io.StringIO(), io.StringIO()
            with self.subTest(error=type(error).__name__), \
                 patch.object(admin.os, 'geteuid', return_value=0), \
                 patch.object(admin.sys, 'argv', ['dao-ops-admin', 'preflight']), \
                 patch.object(admin.signal, 'signal'), patch.object(admin.signal, 'alarm'), \
                 patch.object(admin, 'locked'), patch.object(admin, 'load_ledger'), \
                 patch.object(admin, 'prepare', side_effect=lambda _: admin.fetch(url)), \
                 patch.object(admin.urllib.request, 'build_opener') as network, \
                 contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                network.return_value.open.side_effect = error
                self.assertEqual(admin.main(), 1)
            self.assertEqual(json.loads(stderr.getvalue())['ops_error'], expected)
            self.assertNotIn(TOKEN, stdout.getvalue() + stderr.getvalue())

    def test_response_limit_is_still_enforced(self):
        with patch.object(admin.urllib.request, 'build_opener') as network:
            response = network.return_value.open.return_value.__enter__.return_value
            response.status = 200
            response.read.return_value = b'x' * 9
            with self.assertRaisesRegex(admin.Halt, '^RESPONSE_TOO_LARGE$'):
                admin.fetch(admin.API + '/issues/91', limit=8)
            response.read.assert_called_once_with(9)


if __name__ == '__main__':
    unittest.main()
