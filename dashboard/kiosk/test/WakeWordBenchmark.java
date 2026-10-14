package com.wesbos.homehq;

import java.nio.file.Files;
import java.nio.file.Paths;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Arrays;

/** Run with app_process on the actual device, without opening its microphone.
 * Arguments: model directory, raw 16 kHz mono s16le test file(s). */
public final class WakeWordBenchmark {
  public static void main(String[] args) throws Exception {
    try(WakeWordEngine engine=new WakeWordEngine(
        Files.readAllBytes(Paths.get(args[0],"melspectrogram.onnx")),
        Files.readAllBytes(Paths.get(args[0],"embedding_model.onnx")),
        Files.readAllBytes(Paths.get(args[0],"hey_orbis.onnx")))) {
      for(int k=1;k<args.length;k++) {
        engine.reset();
        ByteBuffer pcm=ByteBuffer.wrap(Files.readAllBytes(Paths.get(args[k]))).order(ByteOrder.LITTLE_ENDIAN);
        long[] timings=new long[pcm.remaining()/2560]; int count=0, detections=0; float max=0;
        short[] frame=new short[1280];
        while(pcm.remaining()>=2560) {
          for(int i=0;i<frame.length;i++)frame[i]=pcm.getShort();
          long started=System.nanoTime();float score=engine.predict(frame);
          timings[count++]=(System.nanoTime()-started)/1000;
          max=Math.max(max,score); if(score>=.7f)detections++;
        }
        Arrays.sort(timings);long total=0;for(long t:timings)total+=t;
        System.out.println(Paths.get(args[k]).getFileName()+" frames="+count+" max="+max+" detections="+detections+
            " mean_ms="+(total/(1000.0*count))+" p95_ms="+(timings[(int)(count*.95)]/1000.0));
      }
    }
  }
}
