package com.wesbos.homehq;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Shader;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Native listening waves and a distinct reply-processing indicator. */
final class WakeFeedback extends FrameLayout {
  private final TextView title, subtitle;
  private final Button send;
  private final Waves waves;
  private boolean listening;
  WakeFeedback(Context context,Runnable cancel,Runnable sendNow) {
    super(context);
    setElevation(dp(12));
    waves=new Waves(context);addView(waves,new LayoutParams(-1,-1));
    LinearLayout header=new LinearLayout(context);header.setGravity(Gravity.CENTER_VERTICAL);
    header.setPadding(dp(24),dp(24),dp(20),0);
    LinearLayout words=new LinearLayout(context);words.setOrientation(LinearLayout.VERTICAL);
    title=new TextView(context);title.setTextSize(24);title.setTextColor(Color.WHITE);title.setShadowLayer(3,0,1,Color.BLACK);
    subtitle=new TextView(context);subtitle.setTextSize(14);subtitle.setTextColor(0xffc5edff);subtitle.setShadowLayer(3,0,1,Color.BLACK);
    words.addView(title);words.addView(subtitle);header.addView(words,new LinearLayout.LayoutParams(0,-2,1));
    send=button(context,"Send now",sendNow);header.addView(send);
    header.addView(button(context,"Cancel",cancel));addView(header,new LayoutParams(-1,-2,Gravity.TOP));
    setVisibility(GONE);
  }
  private Button button(Context context,String text,Runnable action) {
    Button b=new Button(context);b.setText(text);b.setTextSize(13);b.setAllCaps(false);
    b.setTextColor(0xffc5edff);b.setBackgroundColor(Color.TRANSPARENT);b.setMinHeight(dp(48));
    b.setOnClickListener(v->action.run());return b;
  }
  void listen() {
    listening=true;title.setText("Listening…");subtitle.setText("Sends after 3 seconds of quiet");
    subtitle.setTextColor(0xffc5edff);
    send.setVisibility(VISIBLE);waves.thinking=false;waves.target=0;waves.quiet=0;
    setVisibility(VISIBLE);waves.invalidate();
  }
  void preview() {listen();title.setText("Wake feedback preview");subtitle.setText("Microphone off during preview");send.setVisibility(GONE);waves.target=.4f;}
  void previewThinking() {thinking();subtitle.setText("Processing preview · microphone off");}
  void thinking() {
    listening=false;title.setText("Thinking…");subtitle.setText("Preparing your reply · microphone off");
    subtitle.setTextColor(0xffffd89a);
    send.setVisibility(GONE);waves.thinking=true;waves.quiet=0;setVisibility(VISIBLE);waves.invalidate();
  }
  void level(double rms,int quietMs) {
    if(!listening)return;
    waves.target=(float)Math.min(1,rms/1800.0);waves.quiet=Math.min(1,quietMs/3000f);
    subtitle.setText(quietMs>=480?"Sending in "+Math.max(1,(int)Math.ceil((3000-quietMs)/1000.0))+"…":"Sends after 3 seconds of quiet");
  }
  void hide(){listening=false;setVisibility(GONE);}
  private int dp(int value){return (int)(value*getResources().getDisplayMetrics().density+.5f);}

  private final class Waves extends View {
    private final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path path=new Path();
    private Shader backdrop,ink;
    private float target,smoothed,quiet;
    private boolean thinking;
    Waves(Context context){super(context);}
    @Override protected void onSizeChanged(int w,int h,int oldw,int oldh) {
      backdrop=new LinearGradient(0,0,0,h,new int[]{0x00071324,0xe6071324,0xf5071324},new float[]{0,.36f,1},Shader.TileMode.CLAMP);
      ink=new LinearGradient(0,0,w,0,new int[]{0xff2366ff,0xff35c9ff,0xffa6f5ff,0xff35c9ff,0xff2366ff},null,Shader.TileMode.CLAMP);
    }
    @Override protected void onDraw(Canvas canvas) {
      if(WakeFeedback.this.getVisibility()!=VISIBLE)return;
      int w=getWidth(),h=getHeight();float density=getResources().getDisplayMetrics().density;
      paint.setStyle(Paint.Style.FILL);paint.setShader(backdrop);paint.setAlpha(255);canvas.drawRect(0,0,w,h,paint);
      double time=SystemClock.uptimeMillis()/1000.0;
      if(thinking) {
        // Warm, pulsing dots replace the blue waves completely once capture stops.
        paint.setShader(null);
        for(int dot=0;dot<3;dot++) {
          float pulse=(float)(.5+.5*Math.sin(time*4-dot*.9));
          float x=w/2f+(dot-1)*36*density,y=h-40*density;
          paint.setColor(0xffffbd66);paint.setAlpha((int)(18+20*pulse));
          canvas.drawCircle(x,y,(13+4*pulse)*density,paint);
          paint.setColor(0xffffd89a);paint.setAlpha((int)(100+155*pulse));
          canvas.drawCircle(x,y,(5+2*pulse)*density,paint);
        }
        postInvalidateDelayed(33);
        return;
      }
      smoothed+=(target-smoothed)*.18f;
      float amplitude=(6+smoothed*30)*density;
      float baseline=h-40*density;
      paint.setShader(ink);paint.setStyle(Paint.Style.STROKE);paint.setStrokeCap(Paint.Cap.ROUND);
      for(int layer=0;layer<4;layer++) {
        path.reset();
        for(int x=0;x<=w;x+=6) {
          double position=x/(double)w,envelope=Math.pow(Math.sin(Math.PI*position),1.4);
          double wave=Math.sin(position*8*Math.PI-time*3.7+layer*.8)*.65+
              Math.sin(position*5*Math.PI+time*2.1-layer*.7)*.35;
          float y=baseline+(float)(wave*amplitude*envelope*(1+layer*.18));
          if(x==0)path.moveTo(x,y);else path.lineTo(x,y);
        }
        paint.setStrokeWidth((layer==3?2.3f:1.3f)*density);paint.setAlpha(layer==3?255:75+layer*35);
        canvas.drawPath(path,paint);
      }
      if(quiet>0) {
        paint.setStyle(Paint.Style.FILL);paint.setAlpha(160);
        canvas.drawRect(w*(1-quiet)/2,h-3*density,w*(1+quiet)/2,h,paint);
      }
      // Animate only while visible; no permanent timer or background redraw work.
      postInvalidateDelayed(33);
    }
  }
}
