package com.wesbos.homehq;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
/** A bounded mono PCM recording, without MediaRecorder's AAC timestamp pipeline. */
final class PcmWave {
  static byte[] wrap(byte[] pcm,int rate){
    if(rate<=0||pcm.length%2!=0||pcm.length>rate*2L*30)throw new IllegalArgumentException("Invalid PCM recording");
    ByteBuffer out=ByteBuffer.allocate(44+pcm.length).order(ByteOrder.LITTLE_ENDIAN);
    out.put(new byte[]{'R','I','F','F'}).putInt(36+pcm.length).put(new byte[]{'W','A','V','E','f','m','t',' '});
    out.putInt(16).putShort((short)1).putShort((short)1).putInt(rate).putInt(rate*2).putShort((short)2).putShort((short)16);
    out.put(new byte[]{'d','a','t','a'}).putInt(pcm.length).put(pcm);
    return out.array();
  }
}
