package com.wesbos.homehq;

/** A bounded silence endpoint for post-wake PCM. Counters measure audio, not CPU speed. */
final class VoiceEndpoint {
  enum Result { MORE, COMPLETE, EMPTY }
  private int frames, speechFrames, lastSpeech;
  private final double threshold;
  VoiceEndpoint(double ambientRms){threshold=Math.max(180,Math.min(900,ambientRms*3));}
  Result accept(short[] pcm) {
    frames++;
    // Allow the end of the wake phrase to settle, while retaining that audio in the buffer.
    if(frames>3 && rms(pcm)>threshold){speechFrames++;lastSpeech=frames;}
    if(speechFrames>=3 && frames-lastSpeech>=20)return Result.COMPLETE;
    if(speechFrames<3 && frames>=75)return Result.EMPTY;
    if(frames>=375)return speechFrames>=3?Result.COMPLETE:Result.EMPTY;
    return Result.MORE;
  }
  static double rms(short[] pcm){double sum=0;for(short v:pcm)sum+=(double)v*v;return Math.sqrt(sum/pcm.length);}
}
