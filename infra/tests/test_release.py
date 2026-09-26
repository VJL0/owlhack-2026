"""Exercise release promotion and failure recovery without touching production."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/release.sh'
IMAGE = 'ghcr.io/vjl0/owlhack-2026/web@sha256:' + 'b' * 64


class ReleaseTest(unittest.TestCase):
    def exercise(self, fail=False, existing=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            app = root / 'app'
            previous = app / ('releases/previous' if existing else 'infra')
            previous.mkdir(parents=True)
            (previous / 'compose.yaml').write_text('name: reefatlas\n')
            (previous / '.env').write_text('DOMAIN=reefatlas.us\n')
            if existing:
                (app / 'current').symlink_to(previous)
            release = app / 'releases' / ('a' * 40 + '-1-1')
            release.mkdir(parents=True)
            (release / 'compose.yaml').write_text('name: reefatlas\n')
            script = root / 'release.sh'
            script.write_text(SCRIPT.read_text().replace('/opt/reefatlas', str(app)))
            binary = root / 'bin'
            binary.mkdir()
            docker = binary / 'docker'
            docker.write_text('''#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$TEST_LOG"
if [[ "$*" == *"$TEST_RELEASE/compose.yaml up"* && "$TEST_FAIL" == 1 ]]; then
  exit 1
fi
''')
            docker.chmod(0o755)
            for name in ('curl', 'flock'):
                stub = binary / name
                stub.write_text('#!/bin/sh\nexit 0\n')
                stub.chmod(0o755)
            log = root / 'commands'
            env = dict(os.environ, PATH=str(binary) + ':' + os.environ['PATH'],
                       TEST_LOG=str(log), TEST_RELEASE=str(release),
                       TEST_FAIL=str(int(fail)))
            result = subprocess.run(['bash', str(script), str(release), IMAGE],
                                    env=env, capture_output=True, text=True)
            if fail:
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertIn(str(previous / 'compose.yaml') + ' up', log.read_text())
                self.assertIn('Previous release restored.', result.stderr)
                if existing:
                    self.assertEqual((app / 'current').resolve(), previous)
                else:
                    self.assertFalse((app / 'current').exists())
            else:
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual((app / 'current').resolve(), release)
                self.assertEqual((app / 'previous').resolve(), previous)
                self.assertIn(IMAGE, (release / '.env').read_text())

    def test_first_promotion(self):
        self.exercise()

    def test_subsequent_promotion(self):
        self.exercise(existing=True)

    def test_first_failure_restores_original_stack(self):
        self.exercise(fail=True)

    def test_failure_preserves_current_release(self):
        self.exercise(fail=True, existing=True)


if __name__ == '__main__':
    unittest.main()
