package com.wesbos.homehq;

/** A bounded silence endpoint for post-wake PCM. Counters measure audio, not CPU speed. */
final class VoiceEndpoint {
  static final int SILENCE_MS=3000, FRAME_MS=80;
  enum Result { MORE, COMPLETE, EMPTY }
  private int frames, speechFrames, lastSpeech;
  private final double threshold;
  VoiceEndpoint(double ambientRms){threshold=Math.max(180,Math.min(900,ambientRms*3));}
  Result accept(short[] pcm) {return accept(pcm,false);}
  Result accept(short[] pcm,boolean cuePlaying) {
    frames++;
    // Allow the end of the wake phrase to settle, while retaining that audio in the buffer.
    // The wake chime must not count as the user's question or reset the silence timer.
    if(!cuePlaying && frames>3 && rms(pcm)>threshold){speechFrames++;lastSpeech=frames;}
    if(speechFrames>=3 && quietMillis()>=SILENCE_MS)return Result.COMPLETE;
    if(speechFrames<3 && frames>=75)return Result.EMPTY;
    if(frames>=375)return speechFrames>=3?Result.COMPLETE:Result.EMPTY;
    return Result.MORE;
  }
  int quietMillis(){return speechFrames>=3?(frames-lastSpeech)*FRAME_MS:0;}
  static double rms(short[] pcm){double sum=0;for(short v:pcm)sum+=(double)v*v;return Math.sqrt(sum/pcm.length);}
}
