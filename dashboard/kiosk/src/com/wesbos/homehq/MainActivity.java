package com.wesbos.homehq;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.ResolveInfo;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.io.IOException;

/**
 * Full-screen kiosk WebView for the Home HQ wall tablet.
 * - Immersive mode hides the status + navigation bars (true 1280x800).
 * - Controls: hold two fingers still on the screen for 1.5s for launcher/settings/reload.
 * - Remote debugging is OFF unless launched with the debug extra (every app on this device
 *   gets root, so the devtools socket should only exist while actively debugging):
 *     adb shell am start -n com.wesbos.homehq/.MainActivity --ez debug true
 * - Launch with a URL: adb shell am start -a android.intent.action.VIEW -d <url> -n com.wesbos.homehq/.MainActivity
 */
public class MainActivity extends Activity {
  static final String TAG = "HomeHQ";
  static final String DEFAULT_URL = "https://home-dashboard.wesbos.workers.dev/";
  static final long EXIT_HOLD_MS = 1500;
  static final float EXIT_SLOP_PX = 60;

  private WebView web;
  private DashboardClient dashboard;
  private TextView waitingMessage;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private final int[] exitIds = new int[2];
  private final float[] exitX = new float[2];
  private final float[] exitY = new float[2];
  private boolean exitArmed;

  private final Runnable exitToLauncher = new Runnable() {
    @Override
    public void run() {
      exitArmed = false;
      Log.i(TAG, "Two-finger hold: opening controls");
      new AlertDialog.Builder(MainActivity.this)
          .setTitle("Home HQ")
          .setItems(new String[] {"Open launcher", "Android settings", "Wi-Fi settings", "Reload dashboard"},
              (dialog, which) -> {
                if (which == 0) openLauncher();
                else if (which == 1) startActivity(new Intent(Settings.ACTION_SETTINGS));
                else if (which == 2) openWifiSettings();
                else dashboard.reload();
              })
          .setNegativeButton("Back to dashboard", null).show();
    }
  };

  @Override
  protected void onCreate(Bundle state) {
    super.onCreate(state);
    saveOptions(getIntent());
    if (redirectToDefaultHome(getIntent())) return;
    applyDebugFlag(getIntent());
    keepNavigationEnabled();
    getWindow().setBackgroundDrawable(new ColorDrawable(Color.BLACK));
    getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SHOW_WALLPAPER);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        | WindowManager.LayoutParams.FLAG_FULLSCREEN);

    web = new WebView(this);
    web.setBackgroundColor(Color.BLACK);
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    // The page fits its fixed stage itself. Use the real device viewport rather than
    // a virtual wide viewport, which clips higher-density screens like the Echo Show.
    s.setUseWideViewPort(false);
    s.setMediaPlaybackRequiresUserGesture(false);
    s.setAllowFileAccess(false);
    s.setAllowContentAccess(false);
    FrameLayout content = new FrameLayout(this);
    content.setBackgroundColor(Color.BLACK);
    content.addView(web);
    LinearLayout waiting = new LinearLayout(this);
    waiting.setOrientation(LinearLayout.VERTICAL);
    waiting.setGravity(Gravity.CENTER);
    waiting.setBackgroundColor(Color.rgb(243, 239, 230));
    waiting.setClickable(true);
    TextView message = new TextView(this);
    waitingMessage = message;
    message.setText("Waiting for dashboard\nIt will open automatically when the connection is ready.");
    message.setTextColor(Color.rgb(32, 32, 32));
    message.setTextSize(24);
    message.setGravity(Gravity.CENTER);
    message.setPadding(32, 24, 32, 24);
    waiting.addView(message);
    Button retry = new Button(this);
    retry.setText("Retry now");
    retry.setOnClickListener(v -> dashboard.reload());
    Button wifi = new Button(this);
    wifi.setText("Open Wi-Fi settings");
    wifi.setOnClickListener(v -> openWifiSettings());
    waiting.addView(wifi);
    waiting.addView(retry, new LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT));
    waiting.setVisibility(View.GONE);
    content.addView(waiting, new FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
    dashboard = new DashboardClient(getAssets(), web, waiting, this::showOffline, this::openSpotify,
        getSharedPreferences("kiosk", 0).getBoolean("household_sidebar", false));
    web.setWebViewClient(dashboard);
    setContentView(content);

    String url = requestedUrl(getIntent());
    dashboard.load(url != null ? url : defaultUrl());
  }

  @Override
  protected void onResume() {
    super.onResume();
    if (dashboard != null) {
      NavigationService.setDashboardVisible(true);
      dashboard.resume();
    }
  }

  @Override
  protected void onPause() {
    cancelExit();
    if (dashboard != null) {
      NavigationService.setDashboardVisible(false);
      dashboard.pause();
    }
    super.onPause();
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    saveOptions(intent);
    applyDebugFlag(intent);
    String url = requestedUrl(intent);
    if (url != null) dashboard.load(url);
    else if (intent.getBooleanExtra("reset_url", false)) dashboard.load(defaultUrl());
  }

  private void saveOptions(Intent intent) {
    if (intent != null && intent.getBooleanExtra("reset_url", false)) {
      getSharedPreferences("kiosk", 0).edit().remove("dashboard_url").apply();
    }
    String requested = requestedUrl(intent);
    if (requested != null) {
      Uri uri = Uri.parse(requested);
      String scheme = uri.getScheme();
      if (("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme))
          && uri.getHost() != null) {
        getSharedPreferences("kiosk", 0).edit()
            .putString("dashboard_url", requested).apply();
      }
    }
    if (intent != null && intent.hasExtra("household_sidebar")) {
      getSharedPreferences("kiosk", 0).edit()
          .putBoolean("household_sidebar", intent.getBooleanExtra("household_sidebar", false)).apply();
    }
    if (intent != null && intent.hasExtra("keep_usb")) {
      getSharedPreferences("kiosk", 0).edit()
          .putBoolean("keep_usb", intent.getBooleanExtra("keep_usb", false)).apply();
    }
  }

  private String defaultUrl() {
    String savedUrl = getSharedPreferences("kiosk", 0).getString("dashboard_url", null);
    if (savedUrl != null) return savedUrl;
    try (java.io.InputStream ignored = getAssets().open("dashboard/index.html")) {
      return DashboardAssets.URL;
    } catch (IOException e) {
      return DEFAULT_URL;
    }
  }

  /** Android keeps HOME and ordinary app tasks separate even for singleTask.
   * Route shortcuts/reloads into our default HOME task instead of retaining two WebViews. */
  private boolean redirectToDefaultHome(Intent incoming) {
    if (incoming != null && incoming.hasCategory(Intent.CATEGORY_HOME)) return false;
    Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
    ResolveInfo selected = getPackageManager().resolveActivity(home, 0);
    if (selected == null || selected.activityInfo == null
        || !getPackageName().equals(selected.activityInfo.packageName)
        || !getClass().getName().equals(selected.activityInfo.name)) return false;
    Intent canonical = new Intent(incoming == null ? new Intent() : incoming);
    canonical.setAction(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        .removeCategory(Intent.CATEGORY_LAUNCHER);
    canonical.setComponent(new ComponentName(this, MainActivity.class));
    canonical.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    startActivity(canonical);
    finish();
    return true;
  }

  private void openSpotify() {
    Intent launch = getPackageManager().getLaunchIntentForPackage("com.spotify.music");
    if (launch != null) startActivity(launch);
    else new AlertDialog.Builder(this).setTitle("Spotify")
        .setMessage("Install Spotify on this display first.")
        .setPositiveButton("OK", null).show();
  }

  private boolean wifiConnected() {
    ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
    @SuppressWarnings("deprecation")
    NetworkInfo n = cm != null ? cm.getNetworkInfo(ConnectivityManager.TYPE_WIFI) : null;
    return n != null && n.isConnected();
  }

  private void showOffline() {
    waitingMessage.setText(wifiConnected()
        ? "Can't reach the dashboard\nWi-Fi is connected. Retrying every few seconds."
        : "Connect to Wi-Fi?\nThe dashboard comes back by itself once the connection is ready.");
  }

  private void openWifiSettings() {
    try {
      startActivity(new Intent(Settings.ACTION_WIFI_SETTINGS));
    } catch (Exception e) {
      Log.w(TAG, "No Wi-Fi settings screen, opening Settings", e);
      startActivity(new Intent(Settings.ACTION_SETTINGS));
    }
  }

  /**
   * Some frames (PF1007L) run a vendor BackgroundManagerService that drops the navigation service
   * after the kiosk is updated or force-stopped, leaving no way back from Settings. If the owner
   * opted in by granting WRITE_SECURE_SETTINGS, put the service back on the enabled list:
   *   adb shell pm grant com.wesbos.homehq android.permission.WRITE_SECURE_SETTINGS
   */
  private void keepNavigationEnabled() {
    if (checkSelfPermission("android.permission.WRITE_SECURE_SETTINGS") != PackageManager.PERMISSION_GRANTED) return;
    String svc = getPackageName() + "/" + NavigationService.class.getName();
    String cur = Settings.Secure.getString(getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
    if (cur != null) {
      ComponentName want = new ComponentName(this, NavigationService.class);
      for (String entry : cur.split(":")) {
        if (want.equals(ComponentName.unflattenFromString(entry))) return;
      }
    }
    String next = cur == null || cur.isEmpty() ? svc : cur + ":" + svc;
    try {
      Settings.Secure.putString(getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES, next);
      Settings.Secure.putString(getContentResolver(), Settings.Secure.ACCESSIBILITY_ENABLED, "1");
      Log.i(TAG, "Re-enabled navigation service");
    } catch (SecurityException e) {
      Log.w(TAG, "Could not re-enable navigation service", e);
    }
  }

  /** Accept upstream's saved URL extra while preserving this fork's VIEW persistence. */
  private String requestedUrl(Intent intent) {
    if (intent == null) return null;
    String explicit = intent.getStringExtra("url");
    if (explicit == null) return intent.getDataString();
    Uri uri = Uri.parse(explicit);
    if (("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))
        && uri.getHost() != null) return explicit;
    return null;
  }

  private void openLauncher() {
    Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
    for (ResolveInfo info : getPackageManager().queryIntentActivities(home, 0)) {
      String pkg = info.activityInfo.packageName;
      if (pkg.equals(getPackageName()) || pkg.equals("com.android.settings")) continue;
      startActivity(new Intent(home).setComponent(new ComponentName(pkg, info.activityInfo.name)));
      return;
    }
    startActivity(new Intent(Settings.ACTION_SETTINGS));
  }

  @Override
  protected void onDestroy() {
    handler.removeCallbacksAndMessages(null);
    if (dashboard != null) dashboard.destroy();
    if (web != null) web.destroy();
    super.onDestroy();
  }

  /** Remote debugging only when explicitly requested; any normal launch turns it back off. */
  private void applyDebugFlag(Intent intent) {
    boolean debug = intent != null && intent.getBooleanExtra("debug", false);
    WebView.setWebContentsDebuggingEnabled(debug);
    Log.i(TAG, "WebView remote debugging " + (debug ? "ON" : "off"));
  }

  /** Watches for the two-finger exit hold; all touches still go to the page. */
  @Override
  public boolean dispatchTouchEvent(MotionEvent e) {
    if (getIntent().getBooleanExtra("debug", false)) {
      Log.d(TAG, "Touch action=" + e.getActionMasked() + " pointers=" + e.getPointerCount());
    }
    switch (e.getActionMasked()) {
      case MotionEvent.ACTION_POINTER_DOWN:
        if (e.getPointerCount() == 2) {
          for (int i = 0; i < 2; i++) {
            exitIds[i] = e.getPointerId(i);
            exitX[i] = e.getX(i);
            exitY[i] = e.getY(i);
          }
          exitArmed = true;
          handler.removeCallbacks(exitToLauncher);
          handler.postDelayed(exitToLauncher, EXIT_HOLD_MS);
        } else {
          cancelExit(); // 3+ fingers
        }
        break;
      case MotionEvent.ACTION_MOVE:
        if (exitArmed) {
          for (int i = 0; i < 2; i++) {
            int idx = e.findPointerIndex(exitIds[i]);
            if (idx < 0 || Math.hypot(e.getX(idx) - exitX[i], e.getY(idx) - exitY[i]) > EXIT_SLOP_PX) {
              cancelExit();
              break;
            }
          }
        }
        break;
      case MotionEvent.ACTION_POINTER_UP:
      case MotionEvent.ACTION_UP:
      case MotionEvent.ACTION_CANCEL:
        cancelExit();
        break;
      default:
        break;
    }
    return super.dispatchTouchEvent(e);
  }

  private void cancelExit() {
    if (!exitArmed) return;
    exitArmed = false;
    handler.removeCallbacks(exitToLauncher);
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) hideSystemUi();
  }

  private void hideSystemUi() {
    getWindow().getDecorView().setSystemUiVisibility(
        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
  }

  @Override
  public void onBackPressed() {
    if (web.canGoBack()) web.goBack();
  }
}
