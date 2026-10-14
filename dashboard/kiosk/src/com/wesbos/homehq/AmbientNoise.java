package com.wesbos.homehq;

import java.util.Arrays;

/** Rolling room-noise estimate from standby audio levels only; stores no audio. */
final class AmbientNoise {
  // Eight seconds, with the most recent 1.2 seconds excluded so the wake phrase
  // doesn't raise its own question's threshold. The lower fifth rejects speech/clicks.
  private final double[] levels=new double[100];
  private int count,next;
  void accept(short[] pcm) {
    levels[next]=VoiceEndpoint.rms(pcm);next=(next+1)%levels.length;
    count=Math.min(count+1,levels.length);
  }
  double rms() {
    if(count==0)return 60;
    int size=count>15?count-15:count;
    double[] sorted=new double[size];
    int oldest=(next-count+levels.length)%levels.length;
    for(int i=0;i<size;i++)sorted[i]=levels[(oldest+i)%levels.length];
    Arrays.sort(sorted);
    return sorted[(size-1)/5];
  }
  void reset(){count=next=0;}
}
