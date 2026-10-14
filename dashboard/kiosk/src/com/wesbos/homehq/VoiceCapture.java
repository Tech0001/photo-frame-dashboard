package com.wesbos.homehq;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.media.MediaRecorder;
import android.media.AudioRecord;
import android.media.AudioFormat;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.webkit.WebView;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import org.json.JSONObject;

/** Bounded tap capture and upload of questions captured by the optional wake-word listener. */
final class VoiceCapture {
  interface Listener { void accept(JSONObject event); }
  private final Activity activity;
  private final WebView web;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private Capture capture;
  private static final int RATE=16000, MAX_BYTES=RATE*2*30;
  private static final class Capture {
    final AudioRecord recorder;
    volatile boolean stopped, discard;
    Capture(AudioRecord recorder){this.recorder=recorder;}
  }
  private String endpoint;
  private String history;
  private String origin;
  private volatile boolean canceled;
  private boolean sending;
  private int generation;
  private Listener listener;
  VoiceCapture(Activity activity, WebView web) { this.activity=activity;this.web=web; }
  private void emit(JSONObject value) {
    final int request=generation;
    final Listener target=listener;
    handler.post(() -> {
      if(request!=generation || canceled || activity.isFinishing() || !sameOrigin(web.getUrl())) return;
      if(target!=null) target.accept(value);
      else web.evaluateJavascript("window.HubVoice&&HubVoice.nativeEvent("+value.toString()+")", null);
    });
  }
  private boolean sameOrigin(String url) {
    if(origin==null||url==null)return false;
    Uri a=Uri.parse(origin),b=Uri.parse(url);
    return a.getScheme().equals(b.getScheme())&&a.getHost().equals(b.getHost())&&a.getPort()==b.getPort();
  }
  private JSONObject message(String phase,String error) {
    JSONObject o=new JSONObject();try{o.put("phase",phase);if(error!=null)o.put("error",error);}catch(Exception ignored){}return o;
  }
  void start(String dashboardUrl,String displayId,String conversation) {
    if(capture!=null||sending){
      web.evaluateJavascript("window.HubVoice&&HubVoice.nativeEvent("+message("error","Wait for the previous recording to finish.")+")",null);return;
    }
    generation++;listener=null;
    origin=dashboardUrl;canceled=false;
    if(activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){
      activity.requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},71);
      emit(message("error","Allow microphone access, then tap Talk again."));return;
    }
    Uri u=Uri.parse(dashboardUrl);
    endpoint=u.buildUpon().path("/api/voice/").clearQuery().fragment(null).appendQueryParameter("display",displayId).build().toString();
    history=conversation;
    AudioRecord recorder=null;
    try {
      int minimum=AudioRecord.getMinBufferSize(RATE,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT);
      if(minimum<=0)throw new IOException("Unsupported microphone format");
      recorder=new AudioRecord(MediaRecorder.AudioSource.MIC,RATE,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT,Math.max(minimum*2,8192));
      if(recorder.getState()!=AudioRecord.STATE_INITIALIZED)throw new IOException("Microphone unavailable");
      recorder.startRecording();
      if(recorder.getRecordingState()!=AudioRecord.RECORDSTATE_RECORDING)throw new IOException("Microphone did not start");
      final Capture session=new Capture(recorder);capture=session;
      emit(message("recording",null));
      new Thread(()->collect(session),"HubVoiceCapture").start();
    } catch(Exception e){
      if(recorder!=null)recorder.release();
      Log.w("HubVoice","Microphone start failed",e);
      emit(message("error","Could not start the microphone. Check permission and try again."));
    }
  }
  private void collect(Capture session){
    ByteArrayOutputStream pcm=new ByteArrayOutputStream();
    String failure=null;
    long started=SystemClock.elapsedRealtime(),lastData=started;
    try{
      byte[] buffer=new byte[2048];
      while(!session.stopped&&pcm.size()<MAX_BYTES&&SystemClock.elapsedRealtime()-started<30000){
        int n=session.recorder.read(buffer,0,Math.min(buffer.length,MAX_BYTES-pcm.size()),AudioRecord.READ_NON_BLOCKING);
        if(n<0)throw new IOException("Microphone read failed: "+n);
        if(n>0){pcm.write(buffer,0,n);lastData=SystemClock.elapsedRealtime();}
        else if(SystemClock.elapsedRealtime()-lastData>2000)throw new IOException("Microphone stopped providing samples");
        else Thread.sleep(10);
      }
      if(pcm.size()<RATE/5)failure="The recording was too short. Speak for a moment, then tap Stop.";
    }catch(Exception e){Log.w("HubVoice","PCM capture failed",e);failure="Android lost microphone capture. Close Voice and try again.";}
    finally{
      try{session.recorder.stop();}catch(Exception ignored){}
      session.recorder.release();
    }
    Log.i("HubVoice","PCM capture: "+pcm.size()+" bytes in "+(SystemClock.elapsedRealtime()-started)+" ms");
    final String error=failure;
    final byte[] bytes=error==null&&!session.discard?PcmWave.wrap(pcm.toByteArray(),RATE):null;
    handler.post(()->{
      if(capture!=session)return;
      capture=null;
      if(session.discard||canceled)return;
      if(error!=null){emit(message("error",error));return;}
      sending=true;emit(message("processing",null));
      upload(bytes);
    });
  }
  void stop(){if(capture!=null)capture.stopped=true;}
  boolean isBusy(){return capture!=null||sending;}
  void submit(String dashboardUrl,String displayId,byte[] pcm,String conversation,Listener target) {
    if(isBusy()) {target.accept(message("error","Wait for the previous question to finish."));return;}
    generation++;listener=target;origin=dashboardUrl;canceled=false;history=conversation;
    endpoint=Uri.parse(dashboardUrl).buildUpon().path("/api/voice/").clearQuery().fragment(null)
        .appendQueryParameter("display",displayId).build().toString();
    try {
      byte[] bytes=PcmWave.wrap(pcm,RATE);
      sending=true;emit(message("processing",null));upload(bytes);
    } catch(Exception e) { sending=false;emit(message("error","Could not prepare the recording.")); }
  }
  private void upload(final byte[] bytes){
    new Thread(()->{
      try{
        String statusUrl=endpoint.replace("/api/voice/","/api/voice/status");
        JSONObject status=new JSONObject(request(statusUrl,null,null));
        if(!status.optBoolean("ready"))throw new IOException("Voice PC unavailable");
        if(canceled)return;
        JSONObject answer=new JSONObject(request(endpoint.replace("/api/voice/","/api/voice/audio"),bytes,status.getString("token")));
        answer.put("phase","reply");emit(answer);
      }catch(Exception e){emit(message("error","Could not process the recording. Check that the voice PC is connected, then try again."));}
      finally{handler.post(()->sending=false);}
    },"HubVoiceUpload").start();
  }
  private String request(String address,byte[] body,String token) throws Exception {
    HttpURLConnection c=(HttpURLConnection)new URL(address).openConnection();
    c.setConnectTimeout(10000);c.setReadTimeout(180000);c.setInstanceFollowRedirects(false);
    try {
      if(body!=null){c.setRequestMethod("POST");c.setDoOutput(true);c.setRequestProperty("Content-Type","audio/wav");c.setRequestProperty("X-Voice-Token",token);if(history!=null&&!history.isEmpty()&&history.length()<7000)c.setRequestProperty("X-Voice-History",history);c.setFixedLengthStreamingMode(body.length);try(OutputStream out=c.getOutputStream()){out.write(body);}}
      int code=c.getResponseCode();if(code!=200)throw new IOException("Voice HTTP "+code);
      return new String(read(c.getInputStream(),8*1024*1024),"UTF-8");
    } finally{c.disconnect();}
  }
  private byte[] read(InputStream stream,int limit) throws Exception {
    try(InputStream in=stream;ByteArrayOutputStream out=new ByteArrayOutputStream()){
      byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){if(out.size()+n>limit)throw new IOException("Voice response too large");out.write(b,0,n);}return out.toByteArray();
    }
  }
  void cancel(){canceled=true;generation++;listener=null;if(capture!=null){capture.discard=true;capture.stopped=true;}}
}
