package com.wesbos.homehq;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;
import java.nio.FloatBuffer;
import java.util.Arrays;
import java.util.Collections;

/** Streaming openWakeWord feature contract; one 80 ms signed PCM frame per call.
 * See wake-word-NOTICE.txt for upstream model/pipeline attribution. No microphone or network here. */
final class WakeWordEngine implements AutoCloseable {
  static final int FRAME = 1280, RATE = 16000;
  private final OrtEnvironment env = OrtEnvironment.getEnvironment();
  private OrtSession mel, embedding, classifier;
  private final float[] raw = new float[1760], spectrum = new float[76*32], features = new float[16*96];
  private int frames;

  WakeWordEngine(byte[] melModel, byte[] embeddingModel, byte[] wordModel) throws Exception {
    try (OrtSession.SessionOptions options = new OrtSession.SessionOptions()) {
      options.setInterOpNumThreads(1);
      options.setIntraOpNumThreads(1);
      // Do not spin idle native threads on an always-on household display.
      options.addConfigEntry("session.intra_op.allow_spinning", "0");
      options.addConfigEntry("session.inter_op.allow_spinning", "0");
      mel = env.createSession(melModel, options);
      embedding = env.createSession(embeddingModel, options);
      classifier = env.createSession(wordModel, options);
      reset();
    } catch (Exception e) { close(); throw e; }
  }

  void reset() {
    Arrays.fill(raw, 0); Arrays.fill(spectrum, 1); Arrays.fill(features, 0); frames=0;
  }

  float predict(short[] pcm) throws Exception {
    if (pcm.length != FRAME) throw new IllegalArgumentException("Expected 1280 PCM samples");
    System.arraycopy(raw, FRAME, raw, 0, 480);
    for (int i=0;i<FRAME;i++) raw[480+i]=pcm[i];
    float[] nextMel = run(mel, raw, new long[]{1,raw.length});
    if (nextMel.length != 8*32) throw new IllegalStateException("Unexpected mel model output");
    System.arraycopy(spectrum, nextMel.length, spectrum, 0, spectrum.length-nextMel.length);
    for (int i=0;i<nextMel.length;i++) spectrum[spectrum.length-nextMel.length+i]=nextMel[i]/10f+2f;
    float[] nextFeatures = run(embedding, spectrum, new long[]{1,76,32,1});
    if (nextFeatures.length != 96) throw new IllegalStateException("Unexpected speech embedding output");
    System.arraycopy(features, 96, features, 0, features.length-96);
    System.arraycopy(nextFeatures, 0, features, features.length-96, 96);
    // Only score complete real-audio context after startup/rearm.
    if (++frames < 20) return 0;
    float[] score = run(classifier, features, new long[]{1,16,96});
    if (score.length != 1 || Float.isNaN(score[0]) || Float.isInfinite(score[0])) throw new IllegalStateException("Unexpected classifier output");
    return score[0];
  }

  private float[] run(OrtSession session, float[] data, long[] shape) throws Exception {
    try (OnnxTensor input=OnnxTensor.createTensor(env,FloatBuffer.wrap(data),shape);
         OrtSession.Result result=session.run(Collections.singletonMap(session.getInputNames().iterator().next(),input))) {
      FloatBuffer buffer=((OnnxTensor)result.get(0)).getFloatBuffer();
      float[] output=new float[buffer.remaining()]; buffer.get(output); return output;
    }
  }

  @Override public void close() {
    for (OrtSession session:new OrtSession[]{classifier,embedding,mel}) {
      if (session!=null) try { session.close(); } catch (Exception ignored) {}
    }
    classifier=null; embedding=null; mel=null;
    // OrtEnvironment is shared process-wide and must outlive other ORT clients.
  }
}
