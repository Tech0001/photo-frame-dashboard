"""The wake recording must finish on silence, time out without speech, and remain bounded."""
from pathlib import Path
import subprocess
import tempfile
import unittest

class EndpointTest(unittest.TestCase):
    def test_silence_and_long_speech(self):
        source = Path(__file__).resolve().parents[1] / 'src/com/wesbos/homehq/VoiceEndpoint.java'
        with tempfile.TemporaryDirectory() as folder:
            runner = Path(folder) / 'EndpointCheck.java'
            runner.write_text('''package com.wesbos.homehq;
import java.util.Arrays;
class EndpointCheck {
 public static void main(String[] args) {
  short[] quiet=new short[1280], speech=new short[1280];Arrays.fill(speech,(short)2000);
  VoiceEndpoint empty=new VoiceEndpoint(60);
  for(int i=0;i<74;i++)check(empty.accept(quiet)==VoiceEndpoint.Result.MORE);
  check(empty.accept(quiet)==VoiceEndpoint.Result.EMPTY);
  VoiceEndpoint normal=new VoiceEndpoint(60);
  for(int i=0;i<10;i++)check(normal.accept(speech)==VoiceEndpoint.Result.MORE);
  for(int i=0;i<19;i++)check(normal.accept(quiet)==VoiceEndpoint.Result.MORE);
  check(normal.accept(quiet)==VoiceEndpoint.Result.COMPLETE);
  VoiceEndpoint forever=new VoiceEndpoint(60);
  for(int i=0;i<374;i++)check(forever.accept(speech)==VoiceEndpoint.Result.MORE);
  check(forever.accept(speech)==VoiceEndpoint.Result.COMPLETE);
  VoiceEndpoint click=new VoiceEndpoint(60);
  for(int i=0;i<10;i++)click.accept(quiet);click.accept(speech);
  for(int i=0;i<63;i++)check(click.accept(quiet)==VoiceEndpoint.Result.MORE);
  check(click.accept(quiet)==VoiceEndpoint.Result.EMPTY);
 }
 static void check(boolean ok){if(!ok)throw new AssertionError();}
}''')
            subprocess.run(['javac','-d',folder,str(source),str(runner)],check=True)
            subprocess.run(['java','-cp',folder,'com.wesbos.homehq.EndpointCheck'],check=True)

if __name__ == '__main__': unittest.main()
