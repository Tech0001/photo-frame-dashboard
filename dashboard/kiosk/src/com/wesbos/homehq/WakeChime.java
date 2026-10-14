package com.wesbos.homehq;

import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

/** A short original two-tone wake cue, synthesized locally. No sound file or network. */
final class WakeChime {
  static final int DURATION_MS=240, GUARD_MS=320;
  private final Handler main=new Handler(Looper.getMainLooper());
  private final short[] samples=createSamples();
  private AudioTrack track;
  private final Runnable release=this::stop;
  void play() {
    stop();
    try {
      track=new AudioTrack(AudioManager.STREAM_MUSIC,24000,AudioFormat.CHANNEL_OUT_MONO,
          AudioFormat.ENCODING_PCM_16BIT,samples.length*2,AudioTrack.MODE_STATIC);
      if(track.getState()==AudioTrack.STATE_UNINITIALIZED)throw new IllegalStateException("Audio output unavailable");
      if(track.write(samples,0,samples.length)!=samples.length)throw new IllegalStateException("Incomplete wake cue");
      if(track.getState()!=AudioTrack.STATE_INITIALIZED)throw new IllegalStateException("Wake cue did not initialize");
      track.setVolume(.65f);track.play();
      main.postDelayed(release,DURATION_MS+80);
    } catch(Exception e) {Log.w("HubWake","Wake cue unavailable",e);stop();}
  }
  void stop() {
    main.removeCallbacks(release);
    if(track!=null){try{track.stop();}catch(Exception ignored){}track.release();track=null;}
  }
  private static short[] createSamples() {
    short[] pcm=new short[24000*DURATION_MS/1000];
    for(int i=0;i<pcm.length;i++) {
      double t=i/24000.0;
      double attack=Math.min(1,t/.006),tail=Math.min(1,(DURATION_MS/1000.0-t)/.035);
      double body=Math.sin(2*Math.PI*523.25*t)*Math.exp(-t*14);
      double bell=.42*Math.sin(2*Math.PI*1046.5*t)*Math.exp(-t*22);
      pcm[i]=(short)(11000*attack*tail*(body+bell));
    }
    return pcm;
  }
}
