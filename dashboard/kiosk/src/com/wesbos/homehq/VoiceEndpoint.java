package com.wesbos.homehq;

/** A bounded silence endpoint for post-wake PCM. Counters measure audio, not CPU speed. */
final class VoiceEndpoint {
  static final int SILENCE_MS=3000, FRAME_MS=80;
  enum Result { MORE, COMPLETE, EMPTY }
  private int frames, consecutiveSpeech, lastSpeech;
  private boolean heardSpeech;
  private double level;
  private final double threshold;
  // No upper cap: a fan louder than the old cap must still count as background.
  // Freeze the room estimate during the question so sustained speech isn't learned as noise.
  VoiceEndpoint(double ambientRms){threshold=Math.max(180,ambientRms*2.5);}
  Result accept(short[] pcm) {return accept(pcm,false);}
  Result accept(short[] pcm,boolean cuePlaying) {
    frames++;
    // Allow the end of the wake phrase to settle, while retaining that audio in the buffer.
    // The wake chime must not count as the user's question or reset the silence timer.
    level=!cuePlaying && frames>3?Math.max(0,rms(pcm)-threshold):0;
    if(level>0)consecutiveSpeech++;else consecutiveSpeech=0;
    // Qualify an initial word (240 ms), then require 160 ms to resume after a pause.
    // A single click shouldn't establish a question or restart the three-second timer.
    if(consecutiveSpeech>=(heardSpeech?2:3)){heardSpeech=true;lastSpeech=frames;}
    // Give a possible resumed word one frame to qualify at the silence boundary.
    if(heardSpeech && consecutiveSpeech==0 && quietMillis()>=SILENCE_MS)return Result.COMPLETE;
    if(!heardSpeech && frames>=75)return Result.EMPTY;
    if(frames>=375)return heardSpeech?Result.COMPLETE:Result.EMPTY;
    return Result.MORE;
  }
  int quietMillis(){return heardSpeech?(frames-lastSpeech)*FRAME_MS:0;}
  double levelRms(){return level;}
  static double rms(short[] pcm){double sum=0;for(short v:pcm)sum+=(double)v*v;return Math.sqrt(sum/pcm.length);}
}
