package com.wesbos.homehq;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.media.MediaRecorder;
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

/** Records only after a tap, stops at 30 seconds, and deletes its temporary file. */
final class VoiceCapture {
  private final Activity activity;
  private final WebView web;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private MediaRecorder recorder;
  private File recording;
  private long startedAt;
  private String endpoint;
  private String history;
  private String origin;
  private volatile boolean canceled;
  private boolean sending;
  VoiceCapture(Activity activity, WebView web) { this.activity=activity;this.web=web; }
  private void emit(JSONObject value) {
    handler.post(() -> {
      if(canceled || activity.isFinishing() || !sameOrigin(web.getUrl())) return;
      web.evaluateJavascript("window.HubVoice&&HubVoice.nativeEvent("+value.toString()+")", null);
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
    if(recorder!=null||sending)return;
    origin=dashboardUrl;canceled=false;
    if(activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){
      activity.requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},71);
      emit(message("error","Allow microphone access, then tap Talk again."));return;
    }
    Uri u=Uri.parse(dashboardUrl);
    endpoint=u.buildUpon().path("/api/voice/").clearQuery().fragment(null).appendQueryParameter("display",displayId).build().toString();
    history=conversation;
    try {
      recording=File.createTempFile("hub-voice-",".m4a",activity.getCacheDir());
      recorder=new MediaRecorder();recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
      recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
      recorder.setAudioSamplingRate(16000);recorder.setAudioChannels(1);recorder.setAudioEncodingBitRate(64000);
      recorder.setOutputFile(recording.getAbsolutePath());recorder.setMaxDuration(30000);
      recorder.setOnInfoListener((r,what,extra)->{if(what==MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED)stop();});
      recorder.setOnErrorListener((r,what,extra)->{
        if(r!=recorder)return;
        Log.w("HubVoice","Recorder failed: "+what+"/"+extra);
        release();delete();emit(message("error","Android lost microphone capture. Close Voice and try again."));
      });
      recorder.prepare();recorder.start();startedAt=SystemClock.elapsedRealtime();emit(message("recording",null));
    } catch(Exception e){release();delete();emit(message("error","Could not start the microphone. Check permission and try again."));}
  }
  void stop(){
    if(recorder==null)return;
    long duration=SystemClock.elapsedRealtime()-startedAt;
    try{recorder.stop();}catch(Exception e){
      Log.w("HubVoice","Recorder stop failed after "+duration+" ms",e);
      release();delete();
      emit(message("error",duration<1000?"The recording was too short. Speak for a moment, then tap Stop.":"Android captured no microphone audio. Close Voice and try again; if it continues, restart the Echo."));return;
    }
    release();sending=true;emit(message("processing",null));
    final File audio=recording;recording=null;
    new Thread(()->{
      try{
        String statusUrl=endpoint.replace("/api/voice/","/api/voice/status");
        JSONObject status=new JSONObject(request(statusUrl,null,null));
        if(!status.optBoolean("ready"))throw new IOException("Voice PC unavailable");
        byte[] bytes=read(new FileInputStream(audio),5*1024*1024);
        JSONObject answer=new JSONObject(request(endpoint.replace("/api/voice/","/api/voice/audio"),bytes,status.getString("token")));
        answer.put("phase","reply");emit(answer);
      }catch(Exception e){emit(message("error","Could not process the recording. Check that the voice PC is connected, then try again."));}
      finally{audio.delete();handler.post(()->sending=false);}
    },"HubVoiceUpload").start();
  }
  private String request(String address,byte[] body,String token) throws Exception {
    HttpURLConnection c=(HttpURLConnection)new URL(address).openConnection();
    c.setConnectTimeout(10000);c.setReadTimeout(180000);c.setInstanceFollowRedirects(false);
    try {
      if(body!=null){c.setRequestMethod("POST");c.setDoOutput(true);c.setRequestProperty("Content-Type","audio/mp4");c.setRequestProperty("X-Voice-Token",token);if(history!=null&&!history.isEmpty()&&history.length()<7000)c.setRequestProperty("X-Voice-History",history);c.setFixedLengthStreamingMode(body.length);try(OutputStream out=c.getOutputStream()){out.write(body);}}
      int code=c.getResponseCode();if(code!=200)throw new IOException("Voice HTTP "+code);
      return new String(read(c.getInputStream(),8*1024*1024),"UTF-8");
    } finally{c.disconnect();}
  }
  private byte[] read(InputStream stream,int limit) throws Exception {
    try(InputStream in=stream;ByteArrayOutputStream out=new ByteArrayOutputStream()){
      byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){if(out.size()+n>limit)throw new IOException("Voice response too large");out.write(b,0,n);}return out.toByteArray();
    }
  }
  void cancel(){canceled=true;release();delete();}
  private void release(){if(recorder!=null){recorder.release();recorder=null;}}
  private void delete(){if(recording!=null){recording.delete();recording=null;}}
}
