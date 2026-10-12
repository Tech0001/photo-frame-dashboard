"""Tests use temporary state and mocks; no host maintenance commands are executed."""
import importlib.machinery
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

loader = importlib.machinery.SourceFileLoader('helper', str(Path(__file__).with_name('frame-pihole')))
spec = importlib.util.spec_from_loader(loader.name, loader)
h = importlib.util.module_from_spec(spec)
loader.exec_module(h)

class HelperTests(unittest.TestCase):
    def test_original_command_cannot_add_arguments_or_shell(self):
        with patch.object(h.os, 'geteuid', return_value=0), patch.object(h.os, 'umask'), patch.object(h, 'queue') as queue:
            for command in ('reboot; id', '--run reboot', 'gravity extra', 'sudo reboot', 'status\nreboot'):
                with self.assertRaises(SystemExit):
                    h.main([command])
            queue.assert_not_called()

    def test_old_os_major_upgrade_and_missing_version_block_update(self):
        good = [{'current': 'v5.1', 'latest': 'v5.2'}] * 3
        self.assertEqual(h.update_reason(good, {}), '')
        self.assertIn('OS', h.update_reason(good, {'VERSION_CODENAME': 'buster'}))
        self.assertIn('major', h.update_reason([{'current': 'v5.1', 'latest': 'v6.0'}], {}))
        self.assertIn('incomplete', h.update_reason([{'current': 'v5.1', 'latest': None}], {}))

    def test_version_cache_preserves_empty_web_version(self):
        with patch.object(h, 'read', side_effect=['v5.18.4-0-gabc v5.21-0-gdef v5.16.3', 'v6.4.3  v6.7.1']):
            v = h.versions()
        self.assertEqual(v[0]['current'], 'v5.18.4')
        self.assertIsNone(v[1]['latest'])
        self.assertEqual(v[2]['latest'], 'v6.7.1')

    def test_busy_or_unsupported_actions_do_not_start_jobs(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(h, 'ROOT', Path(tmp)), patch.object(h, 'status', return_value={'actions': [], 'updateReason': 'migration required'}), patch.object(h.subprocess, 'run') as run:
            self.assertFalse(h.queue('reboot')['accepted'])
            self.assertEqual(h.queue('update')['error'], 'migration required')
            run.assert_not_called()

    def test_queue_is_not_claimed_as_completion_and_worker_records_failure(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(h, 'ROOT', Path(tmp)), patch.object(h, 'status', return_value={'actions': ['gravity'], 'updateReason': ''}), patch.object(h.subprocess, 'run') as run:
            self.assertTrue(h.queue('gravity')['accepted'])
            self.assertEqual(h.load()['job']['state'], 'queued')
            self.assertIn('--collect', run.call_args.args[0])
            run.side_effect = OSError('failed')
            h.worker('gravity')
            self.assertEqual(h.load()['job']['state'], 'failed')
            self.assertNotIn('softwareUpdatedAt', h.load())

    def test_only_successful_software_update_changes_software_timestamp(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(h, 'ROOT', Path(tmp)), patch.object(h, 'status', return_value={'updateReason': ''}), patch.object(h.subprocess, 'run'):
            h.save({'job': {'action': 'gravity', 'state': 'queued'}}); h.worker('gravity')
            self.assertNotIn('softwareUpdatedAt', h.load())
            h.save({'job': {'action': 'update', 'state': 'queued'}}); h.worker('update')
            self.assertEqual(h.load()['job']['state'], 'succeeded')
            self.assertTrue(h.load()['softwareUpdatedAt'])

if __name__ == '__main__':
    unittest.main()
