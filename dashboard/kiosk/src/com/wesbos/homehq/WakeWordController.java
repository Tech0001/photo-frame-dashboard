package com.wesbos.homehq;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaPlayer;
import android.media.MediaRecorder;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Base64;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import org.json.JSONArray;
import org.json.JSONObject;

/** Optional foreground-only listener. Standby audio never leaves this process. */
final class WakeWordController {
  interface Dashboard { String readyUrl(); }
  interface Navigator { void open(String tab); }
  private final Activity activity;
  private final VoiceCapture voice;
  private final Dashboard dashboard;
  private final Navigator navigator;
  private final Handler main=new Handler(Looper.getMainLooper());
  private final TextView badge;
  private final AudioManager audio;
  private final WakeChime chime=new WakeChime();
  private final WakeFeedback feedback;
  private boolean enabled, active, pending, destroyed;
  private int turn;
  private Session session;
  private Runnable afterStop;
  private long resumeAfter;
  private AlertDialog dialog;
  private TextView response;
  private MediaPlayer player;
  private File playbackFile;
  private JSONArray history=new JSONArray();
  private String requestedTab;
  private static final String TAG="HubWake";
  private static final class Session {
    volatile boolean stop, sendNow;
    volatile long cueUntil;
    final int turn;
    final String url, display;
    Session(int turn,String url,String display){this.turn=turn;this.url=url;this.display=display;}
  }

  WakeWordController(Activity activity,FrameLayout content,VoiceCapture voice,Dashboard dashboard,Navigator navigator) {
    this.activity=activity;this.voice=voice;this.dashboard=dashboard;this.navigator=navigator;
    audio=(AudioManager)activity.getSystemService(Context.AUDIO_SERVICE);
    enabled=activity.getSharedPreferences("kiosk",0).getBoolean("wake_word",false);
    badge=new TextView(activity);badge.setTextSize(12);badge.setTextColor(Color.WHITE);
    badge.setPadding(14,8,14,8);
    GradientDrawable background=new GradientDrawable();background.setColor(0xe637493f);background.setCornerRadius(16);
    badge.setBackground(background);badge.setOnClickListener(v->setEnabled(false));
    FrameLayout.LayoutParams position=new FrameLayout.LayoutParams(-2,-2,Gravity.BOTTOM|Gravity.RIGHT);
    position.setMargins(12,12,12,12);content.addView(badge,position);
    feedback=new WakeFeedback(activity,()->{cancelTurn();label("ready soon");schedule();},
        ()->{if(session!=null&&pending)session.sendNow=true;});
    content.addView(feedback,new FrameLayout.LayoutParams(-1,
        (int)(160*activity.getResources().getDisplayMetrics().density),Gravity.BOTTOM));
    label("starting");
  }
  boolean isEnabled(){return enabled;}
  void setEnabled(boolean value) {
    if(value && activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED) {
      activity.requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},72);
      Toast.makeText(activity,"Allow microphone access, then enable Hey Orbis again.",Toast.LENGTH_LONG).show();return;
    }
    enabled=value;activity.getSharedPreferences("kiosk",0).edit().putBoolean("wake_word",value).apply();
    if(!enabled) cancelTurn();
    label("starting");schedule();
  }
  void resume(){active=true;schedule();}
  void pageChanged(){cancelTurn();schedule();}
  void pause(){active=false;cancelTurn();main.removeCallbacks(poll);}
  void destroy(){destroyed=true;pause();main.removeCallbacksAndMessages(null);}
  void stopForManual(Runnable start) {
    cancelTurn();afterStop=start;
    if(session==null){afterStop=null;start.run();}
  }
  private void label(String state){badge.setVisibility(enabled&&feedback.getVisibility()!=View.VISIBLE?View.VISIBLE:View.GONE);badge.setText("Hey Orbis · "+state);}
  /** Local preview for the native controls/debug intent. It never records or uploads. */
  void previewFeedback() {
    if(pending||voice.isBusy())return;
    cancelTurn();pending=true;final int previewTurn=turn;
    feedback.preview();label("preview");chime.play();
    main.postDelayed(()->{
      if(turn!=previewTurn||destroyed)return;
      feedback.previewThinking();
    },2500);
    main.postDelayed(()->{
      if(turn!=previewTurn||destroyed)return;
      pending=false;feedback.hide();label("ready soon");schedule();
    },6500);
  }
  private void schedule(){main.removeCallbacks(poll);if(active&&!destroyed)main.postDelayed(poll,500);}
  private final Runnable poll=this::checkState;
  private void checkState(){
    if(!enabled||!active||destroyed)return;
    if(session==null&&!pending&&!voice.isBusy()&&SystemClock.elapsedRealtime()>=resumeAfter) {
      String url=dashboard.readyUrl();
      String display=url==null?null:Uri.parse(url).getQueryParameter("display");
      if(audio.isMusicActive())label("paused during audio");
      else if(display==null||!display.matches("[a-zA-Z0-9_-]{1,80}"))label("waiting for dashboard profile");
      else start(url,display);
    }
    schedule();
  }
  private void start(String url,String display) {
    if(activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){setEnabled(false);return;}
    Session s=new Session(++turn,url,display);session=s;label("starting");
    new Thread(()->listen(s),"HubWakeListener").start();
  }
  private byte[] asset(String name)throws Exception {
    try(InputStream in=activity.getAssets().open("wakeword/"+name);ByteArrayOutputStream out=new ByteArrayOutputStream()) {
      byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1)out.write(buffer,0,n);return out.toByteArray();
    }
  }
  private void listen(Session s) {
    AudioRecord recorder=null;
    byte[] question=null;String failure=null;
    try(WakeWordEngine engine=new WakeWordEngine(asset("melspectrogram.onnx"),asset("embedding_model.onnx"),asset("hey_orbis.onnx"))) {
      if(s.stop)return;
      int minimum=AudioRecord.getMinBufferSize(16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT);
      if(minimum<=0)throw new IllegalStateException("Unsupported microphone format");
      recorder=new AudioRecord(MediaRecorder.AudioSource.MIC,16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT,Math.max(minimum*2,8192));
      if(recorder.getState()!=AudioRecord.STATE_INITIALIZED)throw new IllegalStateException("Microphone unavailable");
      recorder.startRecording();
      if(recorder.getRecordingState()!=AudioRecord.RECORDSTATE_RECORDING)throw new IllegalStateException("Microphone did not start");
      main.post(()->{if(current(s)){label("ready · tap to pause");Log.i(TAG,"Hey Orbis armed locally");}});
      short[] frame=new short[1280];int filled=0;
      long lastData=SystemClock.elapsedRealtime(),lastPlayback=0;
      AmbientNoise ambient=new AmbientNoise();boolean wasPlaying=false;
      VoiceEndpoint endpoint=null;ByteArrayOutputStream command=new ByteArrayOutputStream();
      // 320 ms of pre-roll prevents the beginning of an immediate question being clipped.
      byte[] recent=new byte[10240];int recentSize=0;
      while(!s.stop) {
        int n=recorder.read(frame,filled,frame.length-filled,AudioRecord.READ_NON_BLOCKING);
        if(n<0)throw new IllegalStateException("Microphone read error "+n);
        if(n==0){if(SystemClock.elapsedRealtime()-lastData>2000)throw new IllegalStateException("No microphone samples");Thread.sleep(10);continue;}
        lastData=SystemClock.elapsedRealtime();filled+=n;if(filled<frame.length)continue;filled=0;
        byte[] pcm=new byte[2560];for(int i=0;i<frame.length;i++){pcm[2*i]=(byte)frame[i];pcm[2*i+1]=(byte)(frame[i]>>8);}
        if(endpoint==null) {
          // Never recognize our own reply (or other app audio) as a new wake word.
          if(audio.isMusicActive()){
            if(!wasPlaying)main.post(()->{if(current(s))label("paused during audio");});
            wasPlaying=true;lastPlayback=lastData;continue;
          }
          if(wasPlaying){engine.reset();ambient.reset();recentSize=0;wasPlaying=false;main.post(()->{if(current(s))label("ready · tap to pause");});}
          if(lastData-lastPlayback<1200)continue;
          if(recentSize==recent.length){System.arraycopy(recent,2560,recent,0,recent.length-2560);recentSize-=2560;}
          System.arraycopy(pcm,0,recent,recentSize,pcm.length);recentSize+=pcm.length;
          ambient.accept(frame);
          float score=engine.predict(frame);
          if(score>=.7f) {
            double noiseRms=ambient.rms();
            Log.i(TAG,"Hey Orbis detected score="+score+" ambientRms="+Math.round(noiseRms));
            endpoint=new VoiceEndpoint(noiseRms);command.write(recent,0,recentSize);
            s.cueUntil=SystemClock.elapsedRealtime()+WakeChime.GUARD_MS;
            main.post(()->{if(current(s)){
              pending=true;dismissResponse();feedback.listen();label("listening");
              s.cueUntil=SystemClock.elapsedRealtime()+WakeChime.GUARD_MS;chime.play();
            }});
          }
        } else {
          // Maximum includes pre-roll and is also checked independently of silence detection.
          if(command.size()+pcm.length<=16000*2*30)command.write(pcm);
          boolean cuePlaying=lastData<s.cueUntil;
          VoiceEndpoint.Result result=endpoint.accept(frame,cuePlaying);
          final double rms=endpoint.levelRms();
          final int quietMs=endpoint.quietMillis();
          main.post(()->{if(current(s))feedback.level(rms,quietMs);});
          if(s.sendNow||result==VoiceEndpoint.Result.COMPLETE||command.size()+pcm.length>16000*2*30){question=command.toByteArray();break;}
          if(result==VoiceEndpoint.Result.EMPTY){failure="I didn’t hear a question. Say Hey Orbis and try again.";break;}
        }
      }
    } catch(Exception|LinkageError e) {Log.w(TAG,"Wake listener failed",e);failure="Wake-word microphone unavailable. Tap the badge to pause, then enable it again in the two-finger menu.";}
    finally {
      if(recorder!=null){try{recorder.stop();}catch(Exception ignored){}recorder.release();}
      Log.i(TAG,"Wake microphone released; question bytes="+(question==null?0:question.length));
      final byte[] bytes=question;final String error=failure;
      main.post(()->{
        if(session==s)session=null;
        if(afterStop!=null){Runnable next=afterStop;afterStop=null;if(active&&!destroyed)next.run();}
        if(!current(s)){schedule();return;}
        if(bytes!=null){
          String encoded=Base64.encodeToString(history.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8),Base64.NO_WRAP);
          voice.submit(s.url,s.display,bytes,encoded,event->{if(current(s))event(event);});
        } else if(error!=null){pending=false;feedback.hide();resumeAfter=SystemClock.elapsedRealtime()+10000;label("try again");show(error,false);}
        schedule();
      });
    }
  }
  private boolean current(Session s){return !destroyed&&active&&enabled&&!s.stop&&s.turn==turn;}
  private void event(JSONObject event) {
    String phase=event.optString("phase");
    if("processing".equals(phase)){feedback.thinking();label("thinking");}
    else if("error".equals(phase)){pending=false;feedback.hide();resumeAfter=SystemClock.elapsedRealtime()+3000;label("ready soon");show(event.optString("error"),false);}
    else if("reply".equals(phase)) {
      feedback.hide();
      String heard=event.optString("text"),answer=event.optString("answer");
      show("You: "+heard+"\n\n"+answer,false);
      JSONObject action=event.optJSONObject("action");
      requestedTab=action!=null&&"navigate".equals(action.optString("type"))?action.optString("tab"):null;
      try {
        JSONArray next=new JSONArray();
        for(int i=Math.max(0,history.length()-2);i<history.length();i++)next.put(history.get(i));
        next.put(new JSONObject().put("role","user").put("content",heard.substring(0,Math.min(500,heard.length()))));
        next.put(new JSONObject().put("role","assistant").put("content",answer.substring(0,Math.min(500,answer.length()))));history=next;
        String encoded=event.optString("audio");
        if(!"audio/wav".equals(event.optString("mime"))||encoded.isEmpty()||encoded.length()>8000000){finishPlayback();return;}
        playbackFile=File.createTempFile("wake-reply-",".wav",activity.getCacheDir());
        try(FileOutputStream out=new FileOutputStream(playbackFile)){out.write(Base64.decode(encoded,Base64.DEFAULT));}
        player=new MediaPlayer();player.setAudioStreamType(AudioManager.STREAM_MUSIC);player.setDataSource(playbackFile.getPath());
        player.setOnCompletionListener(p->finishPlayback());
        player.setOnErrorListener((p,what,extra)->{finishPlayback();return true;});
        player.prepare();player.start();label("speaking");
      } catch(Exception e){Log.w(TAG,"Reply playback failed",e);finishPlayback();}
    }
  }
  private void finishPlayback(){
    releasePlayback();pending=false;resumeAfter=SystemClock.elapsedRealtime()+1500;label("ready soon");
    if(requestedTab!=null&&requestedTab.matches("[a-zA-Z0-9_-]{1,40}")) {
      String tab=requestedTab;requestedTab=null;
      if(dialog!=null)dialog.dismiss();
      navigator.open(tab);
    }
    schedule();
  }
  private void releasePlayback(){if(player!=null){player.release();player=null;}if(playbackFile!=null){playbackFile.delete();playbackFile=null;}}
  private void show(String text,boolean recording) {
    if(dialog==null) {
      response=new TextView(activity);response.setTextSize(20);response.setPadding(28,20,28,20);response.setTextIsSelectable(true);
      ScrollView scroll=new ScrollView(activity);scroll.addView(response);
      dialog=new AlertDialog.Builder(activity).setTitle("Hey Orbis · local voice").setView(scroll)
          .setPositiveButton("Send now",null).setNegativeButton("Close",(d,w)->{}).create();
      dialog.setOnDismissListener(d->{dialog=null;cancelTurn();schedule();});dialog.show();
      dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{if(session!=null&&pending)session.sendNow=true;else dialog.dismiss();});
    }
    response.setText(text);
    dialog.getButton(AlertDialog.BUTTON_POSITIVE).setVisibility(recording?View.VISIBLE:View.GONE);
  }
  private void cancelTurn() {
    turn++;if(session!=null)session.stop=true;afterStop=null;
    requestedTab=null;
    if(pending)voice.cancel();pending=false;chime.stop();feedback.hide();releasePlayback();resumeAfter=SystemClock.elapsedRealtime()+1500;
    dismissResponse();
  }
  private void dismissResponse() {
    if(dialog!=null){AlertDialog old=dialog;dialog=null;old.setOnDismissListener(null);old.dismiss();}
  }
}
