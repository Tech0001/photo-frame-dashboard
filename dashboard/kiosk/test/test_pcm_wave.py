"""Validate native capture's WAV payload with Python's independent WAV reader."""
import io
from pathlib import Path
import subprocess
import tempfile
import unittest
import wave

class PcmWaveTest(unittest.TestCase):
    def test_repeated_recordings_and_input_bounds(self):
        source=Path(__file__).resolve().parents[1]/'src/com/wesbos/homehq/PcmWave.java'
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            runner=root/'Check.java'
            runner.write_text('''package com.wesbos.homehq;
import java.nio.file.*;
class Check {
 public static void main(String[] args)throws Exception {
  for(int i=1;i<=3;i++)Files.write(Paths.get(args[0],i+".wav"),PcmWave.wrap(new byte[32000*i],16000));
  for(int size:new int[]{1,960002}){
   try{PcmWave.wrap(new byte[size],16000);throw new AssertionError("Accepted invalid input");}
   catch(IllegalArgumentException expected){}
  }
 }
}''')
            subprocess.run(['javac','-d',folder,str(source),str(runner)],check=True)
            subprocess.run(['java','-cp',folder,'com.wesbos.homehq.Check',folder],check=True)
            for seconds in range(1,4):
                with wave.open(io.BytesIO((root/f'{seconds}.wav').read_bytes())) as audio:
                    self.assertEqual((audio.getnchannels(),audio.getsampwidth(),audio.getframerate(),audio.getnframes()),(1,2,16000,16000*seconds))
                    self.assertEqual(len(audio.readframes(audio.getnframes())),32000*seconds)

if __name__=='__main__':unittest.main()
