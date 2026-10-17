"""Isolated GitHub runner proof, not a DEV deployment or production credential test.

Requires OpenSSH and passwordless sudo on a disposable Linux runner. Uses the
exact action entrypoint supplied as argv[1]; never imports the runner's secrets
into that process. No raw SSH logs or keys are printed or uploaded.
"""
import hashlib
import os
from pathlib import Path
import pwd
import socket
import stat
import subprocess
import sys
import tempfile


def command(args, **kwargs):
    return subprocess.run(args, capture_output=True, text=True, timeout=120, **kwargs)


def checked(args):
    result = command(args)
    if result.returncode:
        raise RuntimeError('Fixture command failed (output withheld): ' + args[0])
    return result.stdout


def validate_private_parent(directory, uid):
    """Match StrictModes' owner/write constraints without following symlinks."""
    directory = Path(directory)
    assert directory.is_absolute(), 'Fixture parent must be absolute'
    for parent in (directory, *directory.parents):
        info = parent.lstat()
        print(f'Fixture parent metadata: {parent} uid={info.st_uid} mode={stat.S_IMODE(info.st_mode):04o}')
        assert stat.S_ISDIR(info.st_mode), 'Fixture parent is not a real directory'
        assert info.st_uid in (0, uid), 'Fixture parent has an unexpected owner'
        assert not info.st_mode & 0o022, 'Fixture parent is writable by others'
    assert directory.stat().st_uid == uid, 'Runner home must belong to runner'


def main():
    action = Path(sys.argv[1]).resolve()
    assert (action / 'entrypoint.sh').is_file()
    account = pwd.getpwuid(os.getuid())
    username = account.pw_name
    assert os.getuid() != 0, 'Run as the disposable runner user, not root'
    runner_home = Path(account.pw_dir)
    validate_private_parent(runner_home, os.getuid())
    with tempfile.TemporaryDirectory(prefix='.dao187-ssh-', dir=runner_home) as directory:
        root = Path(directory)
        assert stat.S_IMODE(root.stat().st_mode) == 0o700
        for name in ('host', 'client'):
            checked(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(root / name)])
        validate_private_parent(root, os.getuid())
        for name, mode in (('client', 0o600), ('client.pub', 0o644)):
            info = (root / name).lstat()
            assert stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
            assert stat.S_IMODE(info.st_mode) == mode
            print(f'Fixture key metadata: {name} uid={info.st_uid} mode={mode:04o}')
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            port = probe.getsockname()[1]
        config = root / 'sshd_config'
        config.write_text(f'''ListenAddress 127.0.0.1
Port {port}
HostKey {root}/host
PidFile {root}/pid
AuthorizedKeysFile {root}/client.pub
StrictModes yes
PasswordAuthentication no
KbdInteractiveAuthentication no
UsePAM yes
PermitRootLogin no
AllowUsers {username}
LogLevel VERBOSE
''')
        fingerprint = checked(['ssh-keygen', '-lf', str(root / 'host.pub')]).split()[1]
        checked(['sudo', '-n', 'mkdir', '-p', '/run/sshd'])
        checked(['sudo', '-n', '/usr/sbin/sshd', '-t', '-f', str(config)])
        checked(['sudo', '-n', '/usr/sbin/sshd', '-f', str(config), '-E', str(root / 'server.log')])
        try:
            value = "DAO187_SYNTHETIC_'_$(false)_QUOTE\nDAO187_SECOND_LINE"
            expected = hashlib.sha256(value.encode()).hexdigest()
            # Explicit environment: no GITHUB_TOKEN, DEV credentials, or inherited INPUT_*.
            env = {
                'PATH': os.environ['PATH'],
                'GITHUB_ACTION_PATH': str(action), 'INPUT_HOST': '127.0.0.1',
                'INPUT_PORT': str(port), 'INPUT_USERNAME': username,
                'INPUT_KEY_PATH': str(root / 'client'), 'INPUT_FINGERPRINT': fingerprint,
                'INPUT_ENVS': 'DAO187_TEST', 'INPUT_DEBUG': 'false',
                'INPUT_CAPTURE_STDOUT': 'false', 'INPUT_TIMEOUT': '10s',
                'INPUT_COMMAND_TIMEOUT': '15s', 'DAO187_TEST': value,
            }
            script = ("python3 - <<'PY'\nimport hashlib,os\n"
                      "assert hashlib.sha256(os.environ['DAO187_TEST'].encode()).hexdigest() == '"
                      + expected + "'\nprint('SYNTHETIC_ROUNDTRIP_PASS')\nPY")
            for name, remote_script, success in (
                ('success', script, True),
                ('remote_failure', script + '\nexit 23', False),
            ):
                env['INPUT_SCRIPT'] = remote_script
                result = command(['bash', str(action / 'entrypoint.sh')], env=env)
                logs = result.stdout + result.stderr
                if (result.returncode == 0) != success:
                    # Fixture-only diagnostics; never forward arbitrary command output.
                    categories = ('unable to authenticate', 'handshake failed',
                                  'connection refused', 'fingerprint', 'curl:',
                                  'unbound variable', 'Permission denied',
                                  'account is locked', 'bad ownership', 'not allowed')
                    server_log = checked(['sudo', '-n', 'cat', str(root / 'server.log')])
                    for category in categories:
                        if category.lower() in (logs + server_log).lower():
                            print('Fixture failure category:', category)
                    print('Fixture exit code:', result.returncode)
                assert (result.returncode == 0) == success, name + ': wrong exit outcome'
                assert 'SYNTHETIC_ROUNDTRIP_PASS' in logs, name + ': no receipt proof'
                assert 'DAO187_SYNTHETIC_' not in logs, name + ': sentinel leak'
                assert 'DAO187_SECOND_LINE' not in logs, name + ': multiline leak'
                print(name + ': exact synthetic value received; no sentinel in stdout/stderr; PASS')
            # Positive control proves the detector would notice a debug disclosure.
            env['INPUT_DEBUG'] = 'true'
            env['INPUT_SCRIPT'] = script
            result = command(['bash', str(action / 'entrypoint.sh')], env=env)
            assert result.returncode == 0, 'debug control did not complete'
            assert 'DAO187_SYNTHETIC_' in result.stdout + result.stderr
            print('debug positive control: disclosure detected; raw synthetic output withheld; PASS')
            binary = action / 'drone-ssh-1.8.1-linux-amd64'
            print('Observed binary SHA256:', hashlib.sha256(binary.read_bytes()).hexdigest())
            print('Scope: wrapper + local SSH transport only; no DEV/VPS or GitHub masking proof')
        finally:
            pid = int((root / 'pid').read_text().strip())
            assert pid > 1
            checked(['sudo', '-n', 'kill', '-TERM', str(pid)])
            # The server log may be root-owned; it contains only fixture diagnostics.
            checked(['sudo', '-n', 'chown', str(os.getuid()), str(root / 'server.log')])


if __name__ == '__main__':
    main()
