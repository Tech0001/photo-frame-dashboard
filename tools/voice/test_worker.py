import json
import subprocess
import unittest
from unittest.mock import Mock, patch
import worker

class WorkerTests(unittest.TestCase):
    def test_gpu_success_does_not_retry(self):
        run=Mock(return_value=subprocess.CompletedProcess([],0,stderr=b''))
        self.assertEqual(worker.speech_attempt(run,'vulkan:0','cpu'),'vulkan:0')
        run.assert_called_once_with('vulkan:0')

    def test_memory_failure_retries_cpu(self):
        run=Mock(side_effect=[subprocess.CompletedProcess([],1,stderr=b'Device memory allocation of size 903046144 failed.'),subprocess.CompletedProcess([],0,stderr=b'')])
        self.assertEqual(worker.speech_attempt(run,'vulkan:0','cpu'),'cpu')
        self.assertEqual([c.args[0] for c in run.call_args_list],['vulkan:0','cpu'])

    def test_other_failures_are_not_hidden(self):
        run=Mock(return_value=subprocess.CompletedProcess([],1,stderr=b'Invalid model'))
        with self.assertRaises(subprocess.CalledProcessError):worker.speech_attempt(run,'vulkan:0','cpu')
        run.assert_called_once()

    def test_existing_server_receives_direct_chat_request(self):
        response=Mock();response.read.return_value=json.dumps({'choices':[{'message':{'content':'Hello!'}}]}).encode()
        response.__enter__=Mock(return_value=response);response.__exit__=Mock(return_value=False)
        opener=Mock();opener.open.return_value=response
        with patch.object(worker.urllib.request,'build_opener',return_value=opener),patch.object(worker.subprocess,'run') as run:
            self.assertEqual(worker.chat({'chatUrl':'http://127.0.0.1:18080/v1/chat/completions','chatModel':'existing-model'},'Hi',[],''),'Hello!')
            opener.open.assert_called_once()
            self.assertEqual(opener.open.call_args.args[0].full_url,'http://127.0.0.1:18080/v1/chat/completions')
            run.assert_not_called()

if __name__=='__main__':unittest.main()
