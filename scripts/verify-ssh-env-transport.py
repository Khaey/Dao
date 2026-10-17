"""Native OpenSSH loopback transport proof. No DEV, VPS or GitHub secrets used."""
import hashlib
import io
import os
from pathlib import Path
import pwd
import shlex
import socket
import subprocess
import sys
import tarfile
import tempfile


def checked(args, *, input_data=None, env=None):
    result = subprocess.run(args, input=input_data, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, env=env, timeout=45)
    if result.returncode:
        raise AssertionError("Synthetic fixture command failed: " + args[0])
    return result.stdout


def main():
    root_dir = Path(__file__).resolve().parents[1]
    user = pwd.getpwuid(os.getuid())
    assert os.getuid() != 0, "Runner fixture must not run as root"
    with tempfile.TemporaryDirectory(prefix=".dao187-native-", dir=user.pw_dir) as temp:
        root = Path(temp)
        for name in ("host", "client", "rogue"):
            checked(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(root / name)])
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        config = root / "sshd_config"
        config.write_text(
            f"ListenAddress 127.0.0.1\nPort {port}\nHostKey {root}/host\n"
            f"PidFile {root}/pid\nAuthorizedKeysFile {root}/client.pub\n"
            f"StrictModes yes\nPasswordAuthentication no\n"
            f"KbdInteractiveAuthentication no\nUsePAM yes\n"
            f"PermitRootLogin no\nAllowUsers {user.pw_name}\nLogLevel VERBOSE\n"
        )
        checked(["sudo", "-n", "mkdir", "-p", "/run/sshd"])
        checked(["sudo", "-n", "/usr/sbin/sshd", "-t", "-f", str(config)])
        checked(["sudo", "-n", "/usr/sbin/sshd", "-f", str(config),
                 "-E", str(root / "server.log")])
        try:
            def fingerprint(path):
                return checked(["ssh-keygen", "-lf", str(path), "-E", "sha256"]).decode().split()[1]

            known_hosts = root / "known_hosts"
            known_hosts.write_bytes(checked([
                "ssh-keyscan", "-T", "10", "-t", "ed25519",
                "-p", str(port), "127.0.0.1",
            ]))
            expected = fingerprint(root / "host.pub")
            assert fingerprint(known_hosts) == expected, "Fixture host pin mismatch"
            assert fingerprint(root / "rogue.pub") != expected, "Negative host pin not distinct"
            known_hosts.chmod(0o600)
            ssh_config = root / "ssh_config"
            ssh_config.write_text(
                f"Host dao-fixture\n  HostName 127.0.0.1\n  Port {port}\n"
                f"  User {user.pw_name}\n  IdentityFile {root}/client\n"
                f"  UserKnownHostsFile {known_hosts}\n"
                "  StrictHostKeyChecking yes\n  IdentitiesOnly yes\n"
                "  BatchMode yes\n  PasswordAuthentication no\n"
            )
            ssh_config.chmod(0o600)
            env = {"PATH": os.environ["PATH"], "HOME": user.pw_dir}
            ssh = ["ssh", "-F", str(ssh_config), "dao-fixture"]
            remote_root = root / "host-dir"
            remote_root.mkdir(mode=0o700)
            stage = (root_dir / "scripts/stage-dev-private-dir.sh").read_text()
            stage = stage.replace("/opt/dao", str(remote_root))
            checked(ssh + ["bash", "-se", "--", "123", "1"],
                    input_data=stage.encode(), env=env)
            staging = remote_root / "ops-incoming" / "123-1"
            assert staging.stat().st_mode & 0o777 == 0o700

            sentinel = "DAO187_SYNTHETIC_PRIVATE_DO_NOT_LOG"
            private = {
                "dao-env.json": ("fictional\n" + sentinel).encode(),
                "github-read-token": b"fictional-token-only\n",
            }
            archive = io.BytesIO()
            with tarfile.open(fileobj=archive, mode="w:gz") as tar:
                for name, value in private.items():
                    info = tarfile.TarInfo(name)
                    info.size = len(value)
                    info.mode = 0o600
                    tar.addfile(info, io.BytesIO(value))
            remote_cmd = ("umask 077; tar -xzf - -C " + shlex.quote(str(staging))
                          + " --no-same-owner --no-same-permissions")
            checked(ssh + [remote_cmd], input_data=archive.getvalue(), env=env)
            for name, value in private.items():
                target = staging / name
                assert target.stat().st_mode & 0o777 == 0o600
                assert hashlib.sha256(target.read_bytes()).digest() == hashlib.sha256(value).digest()
            print("native SSH transport: strict host pin, full fictional payload and 0700/0600 PASS")

            failure = subprocess.run(ssh + ["exit 23"], env=env,
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
            assert failure.returncode == 23
            assert sentinel.encode() not in failure.stdout + failure.stderr
            print("native SSH remote failure: nonzero status and no private sentinel PASS")

            leaked = checked(ssh + ["cat " + shlex.quote(str(staging / "dao-env.json"))], env=env)
            assert sentinel.encode() in leaked  # Detector must recognize deliberately leaked fiction.
            print("native SSH positive disclosure-control: detector triggered PASS")

            checked(ssh + ["rm -rf -- " + shlex.quote(str(staging))], env=env)
            assert not staging.exists()
            print("native SSH run-scoped cleanup PASS")
            print("Scope: disposable loopback only; DEV host pin and real DEV deployment still require trusted access")
        finally:
            pid = int((root / "pid").read_text().strip())
            checked(["sudo", "-n", "kill", "-TERM", str(pid)])
            checked(["sudo", "-n", "chown", str(os.getuid()), str(root / "server.log")])


if __name__ == "__main__":
    main()
