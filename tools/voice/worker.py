#!/usr/bin/env python3
"""Local speech worker. Bind to loopback and reach it through an SSH tunnel."""
import argparse, base64, hmac, io, json, os, subprocess, tempfile, threading, wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import urllib.request, urllib.parse

LIMIT=5*1024*1024
LOCK=threading.Lock()

def chat(config,text,history,context):
    endpoint=config.get('chatUrl','http://127.0.0.1:1234/v1/chat/completions')
    u=urllib.parse.urlsplit(endpoint)
    if u.hostname not in ('localhost','127.0.0.1','::1') or u.scheme!='http':
        raise ValueError('The language model must be a local HTTP endpoint.')
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    models_url=urllib.parse.urlunsplit((u.scheme,u.netloc,'/v1/models','',''))
    try:
        with opener.open(models_url,timeout=5) as r:models=json.loads(r.read(256*1024))
    except OSError:
        if not config.get('serverCommand'):raise
        subprocess.run(config['serverCommand'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=30)
        with opener.open(models_url,timeout=5) as r:models=json.loads(r.read(256*1024))
    if not any(m.get('id')==config['chatModel'] for m in models.get('data',[])) and config.get('loadCommand'):
        subprocess.run(config['loadCommand'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=150)
    messages=[{'role':'system','content':'You are Hub, a conversational assistant on a household display. Answer briefly in plain spoken English, usually two sentences. Do not use Markdown. You cannot run commands or change devices. Never claim to be the user\'s existing Codex session. Facts supplied by the household dashboard: '+context[:3000]}]
    messages.extend(history)
    messages.append({'role':'user','content':text})
    payload={'model':config['chatModel'],'messages':messages,'max_tokens':160,'temperature':0.5,'stream':False,'chat_template_kwargs':{'enable_thinking':False}}
    req=urllib.request.Request(endpoint,data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'})
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req,timeout=150) as response:
        data=json.loads(response.read(256*1024))
    answer=data['choices'][0]['message'].get('content')
    if not isinstance(answer,str) or not answer.strip():raise ValueError('The local language model returned no answer.')
    # Some local reasoning templates still wrap private reasoning in think tags.
    import re
    answer=re.sub(r'<think>.*?</think>','',answer,flags=re.S).strip()
    return answer[:1200]

class Worker:
    def __init__(self,config):
        from piper import PiperVoice
        self.config=config
        self.asr=None
        if config.get('speechEngine')!='nemotron':
            from faster_whisper import WhisperModel
            self.asr=WhisperModel(config['speechModel'],device=config.get('device','cpu'),compute_type=config.get('computeType','int8'),cpu_threads=4,local_files_only=True)
        elif not Path(config['speechBinary']).is_file() or not Path(config['speechModel']).is_file():
            raise ValueError('Install the Nemotron runtime and speech model first.')
        self.voice=PiperVoice.load(config['voiceModel'])
    def transcribe(self,raw):
        import av
        container=av.open(io.BytesIO(raw))
        stream=next((s for s in container.streams if s.type=='audio'),None)
        if not stream:raise ValueError('No audio track was supplied.')
        # Bound decoded samples too; a small compressed file must not hide hours of audio.
        import numpy as np
        resampler=av.AudioResampler(format='s16',layout='mono',rate=16000)
        samples=[];count=0
        for frame in container.decode(stream):
            for out in resampler.resample(frame):
                array=out.to_ndarray().reshape(-1);count+=len(array)
                if count>32*16000:raise ValueError('Record at most 30 seconds.')
                samples.append(array)
        container.close()
        if count<1600:raise ValueError('The recording was too short.')
        audio=np.concatenate(samples).astype(np.float32)/32768
        if self.config.get('speechEngine')=='nemotron':
            with tempfile.TemporaryDirectory(prefix='hub-voice-') as folder:
                source=Path(folder)/'recording.wav';destination=Path(folder)/'transcript.json'
                with wave.open(str(source),'wb') as w:
                    w.setnchannels(1);w.setsampwidth(2);w.setframerate(16000);w.writeframes((audio*32768).astype(np.int16).tobytes())
                binary=self.config['speechBinary'];env=dict(os.environ,LD_LIBRARY_PATH=str(Path(binary).parent))
                subprocess.run([binary,'transcribe',str(source),'--model',self.config['speechModel'],'--device',self.config.get('device','cpu'),'--language',self.config.get('language','en'),'--stream','--format','json','--output',str(destination),'--no-batching'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,env=env,timeout=55)
                result=json.loads(destination.read_text());text=result.get('text') or ' '.join(str(w.get('word',w.get('text',''))) for w in result.get('words',[]))
            if not text.strip():raise ValueError('No speech was heard. Try again.')
            return text.strip()[:1000]
        segments,_=self.asr.transcribe(audio,language=self.config.get('language','en'),beam_size=1,vad_filter=True,condition_on_previous_text=False)
        text=' '.join(s.text.strip() for s in segments).strip()
        if not text:raise ValueError('No speech was heard. Try again.')
        return text[:1000]
    def speak(self,text):
        out=io.BytesIO()
        with wave.open(out,'wb') as w:self.voice.synthesize_wav(text,w)
        return base64.b64encode(out.getvalue()).decode()

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass # Do not log recordings, transcripts or tokens.
    def reply(self,status,value):
        raw=json.dumps(value).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(raw)
    def authorized(self):return hmac.compare_digest(self.headers.get('Authorization',''),'Bearer '+self.server.token)
    def do_GET(self):
        if not self.authorized():return self.reply(401,{'error':'Authentication required'})
        if self.path!='/health':return self.reply(404,{'error':'Not found'})
        self.reply(200,{'ok':True,'speechReady':True,'voiceReady':True,'local':True})
    def do_POST(self):
        if not self.authorized():return self.reply(401,{'error':'Authentication required'})
        if not LOCK.acquire(blocking=False):return self.reply(429,{'error':'Voice is busy. Try again shortly.'})
        try:
            size=int(self.headers.get('Content-Length','0'))
            if not 0<size<=LIMIT:raise ValueError('Audio or text request is too large.')
            raw=self.rfile.read(size)
            if len(raw)!=size:raise ValueError('Incomplete request')
            if self.path=='/transcribe':return self.reply(200,{'text':self.server.worker.transcribe(raw)})
            data=json.loads(raw);text=data.get('text')
            if not isinstance(text,str) or not text.strip() or len(text)>1200:raise ValueError('Use a short text request.')
            if self.path=='/chat':
                history=data.get('history',[])
                if not isinstance(history,list) or len(history)>8 or any(not isinstance(m,dict) or m.get('role') not in ('user','assistant') or not isinstance(m.get('content'),str) or len(m['content'])>1200 for m in history):raise ValueError('Invalid conversation history')
                text=chat(self.server.worker.config,text,history,str(data.get('context','')))
            elif self.path!='/speak':return self.reply(404,{'error':'Not found'})
            self.reply(200,{'answer':text,'audio':self.server.worker.speak(text),'mime':'audio/wav'})
        except ValueError as e:self.reply(400,{'error':str(e)})
        except Exception:self.reply(503,{'error':'Local voice processing failed. Check the speech worker or loaded language model.'})
        finally:LOCK.release()

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--config',required=True);args=parser.parse_args()
    config=json.loads(Path(args.config).expanduser().read_text());token=Path(config['tokenFile']).expanduser().read_text().strip()
    if len(token)<32:raise ValueError('Use a dedicated voice token.')
    worker=Worker(config);server=ThreadingHTTPServer(('127.0.0.1',config.get('port',8101)),Handler);server.token=token;server.worker=worker
    print('Local Hub voice worker ready',flush=True);server.serve_forever()
if __name__=='__main__':main()
