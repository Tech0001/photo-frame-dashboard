"""Finish on room noise, preserve resumed speech, reject clicks, and remain bounded."""
from pathlib import Path
import subprocess
import tempfile
import unittest

class EndpointTest(unittest.TestCase):
    def test_silence_and_long_speech(self):
        source = Path(__file__).resolve().parents[1] / 'src/com/wesbos/homehq'
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
  // 37 * 80 = 2960 ms must NOT send; the next frame crosses three seconds.
  for(int i=0;i<37;i++)check(normal.accept(quiet)==VoiceEndpoint.Result.MORE);
  check(normal.accept(quiet)==VoiceEndpoint.Result.COMPLETE);
  VoiceEndpoint resumed=new VoiceEndpoint(60);
  for(int i=0;i<10;i++)resumed.accept(speech);
  for(int i=0;i<30;i++)check(resumed.accept(quiet)==VoiceEndpoint.Result.MORE);
  check(resumed.accept(speech)==VoiceEndpoint.Result.MORE);
  check(resumed.accept(speech)==VoiceEndpoint.Result.MORE);
  check(resumed.quietMillis()==0);
  for(int i=0;i<37;i++)check(resumed.accept(quiet)==VoiceEndpoint.Result.MORE);
  check(resumed.accept(quiet)==VoiceEndpoint.Result.COMPLETE);
  VoiceEndpoint chime=new VoiceEndpoint(60);
  for(int i=0;i<8;i++)check(chime.accept(speech,true)==VoiceEndpoint.Result.MORE);
  for(int i=0;i<66;i++)check(chime.accept(quiet)==VoiceEndpoint.Result.MORE);
  check(chime.accept(quiet)==VoiceEndpoint.Result.EMPTY);
  VoiceEndpoint forever=new VoiceEndpoint(60);
  for(int i=0;i<374;i++)check(forever.accept(speech)==VoiceEndpoint.Result.MORE);
  check(forever.accept(speech)==VoiceEndpoint.Result.COMPLETE);
  VoiceEndpoint click=new VoiceEndpoint(60);
  for(int i=0;i<10;i++)click.accept(quiet);click.accept(speech);
  for(int i=0;i<63;i++)check(click.accept(quiet)==VoiceEndpoint.Result.MORE);
  check(click.accept(quiet)==VoiceEndpoint.Result.EMPTY);
  // A new phrase right at the silence deadline gets time to qualify.
  VoiceEndpoint boundary=new VoiceEndpoint(60);
  for(int i=0;i<10;i++)boundary.accept(speech);
  for(int i=0;i<37;i++)boundary.accept(quiet);
  check(boundary.accept(speech)==VoiceEndpoint.Result.MORE);
  check(boundary.accept(speech)==VoiceEndpoint.Result.MORE);
  check(boundary.quietMillis()==0);
  for(int i=0;i<37;i++)check(boundary.accept(quiet)==VoiceEndpoint.Result.MORE);
  check(boundary.accept(quiet)==VoiceEndpoint.Result.COMPLETE);
  // Occasional keyboard clicks don't keep resetting an otherwise quiet question.
  VoiceEndpoint typing=new VoiceEndpoint(60);
  for(int i=0;i<10;i++)typing.accept(speech);
  for(int i=0;i<37;i++)check(typing.accept(i%7==3?speech:quiet)==VoiceEndpoint.Result.MORE);
  check(typing.accept(quiet)==VoiceEndpoint.Result.COMPLETE);
  VoiceEndpoint onlyClicks=new VoiceEndpoint(60);
  for(int i=0;i<74;i++)check(onlyClicks.accept(i%7==0?speech:quiet)==VoiceEndpoint.Result.MORE);
  check(onlyClicks.accept(quiet)==VoiceEndpoint.Result.EMPTY);
  // The old quiet-room seed could never learn a fan above 120 RMS, and its
  // threshold cap classified any noise above 900 RMS as speech forever.
  for(int fanRms:new int[]{240,700,1400}) {
    short[] fan=level(fanRms),louderFan=level((int)(fanRms*1.3));
    short[] spoken=level(fanRms*4);
    AmbientNoise room=new AmbientNoise();
    for(int i=0;i<100;i++)room.accept(i%7==0?spoken:fan);
    // A loud wake phrase immediately before detection must not raise the floor.
    for(int i=0;i<15;i++)room.accept(spoken);
    check(Math.abs(room.rms()-fanRms)<1);
    VoiceEndpoint question=new VoiceEndpoint(room.rms());
    for(int i=0;i<10;i++)check(question.accept(spoken)==VoiceEndpoint.Result.MORE);
    for(int i=0;i<37;i++)check(question.accept(louderFan)==VoiceEndpoint.Result.MORE);
    check(question.levelRms()==0);
    check(question.accept(louderFan)==VoiceEndpoint.Result.COMPLETE);
    VoiceEndpoint fanOnly=new VoiceEndpoint(room.rms());
    for(int i=0;i<74;i++)check(fanOnly.accept(louderFan)==VoiceEndpoint.Result.MORE);
    check(fanOnly.accept(louderFan)==VoiceEndpoint.Result.EMPTY);
    // Rolling standby calibration catches both a fan starting and stopping.
    for(int i=0;i<115;i++)room.accept(level(2400));
    check(Math.abs(room.rms()-2400)<1);
    for(int i=0;i<115;i++)room.accept(level(40));
    check(Math.abs(room.rms()-40)<1);
    room.reset();for(int i=0;i<20;i++)room.accept(fan);
    check(Math.abs(room.rms()-fanRms)<1);
  }
 }
 static short[] level(int rms){short[] frame=new short[1280];Arrays.fill(frame,(short)rms);return frame;}
 static void check(boolean ok){if(!ok)throw new AssertionError();}
}''')
            subprocess.run(['javac','-d',folder,str(source / 'VoiceEndpoint.java'),
                            str(source / 'AmbientNoise.java'),str(runner)],check=True)
            subprocess.run(['java','-cp',folder,'com.wesbos.homehq.EndpointCheck'],check=True)

if __name__ == '__main__': unittest.main()
