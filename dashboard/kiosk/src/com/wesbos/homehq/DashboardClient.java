package com.wesbos.homehq;

import android.content.res.AssetManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.View;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

/** Keeps the kiosk recovering if Home starts before Wi-Fi or the hub is available. */
final class DashboardClient extends DashboardAssets {
  interface VoiceAction { void accept(Uri command); }
  private static final long RETRY_MS = 5000;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private final WebView web;
  private final View waiting;
  private final Runnable updateWaiting;
  private final Runnable openSpotify;
  private final boolean householdSidebar;
  private final VoiceAction voiceAction;
  private Uri dashboardOrigin;
  private String retryUrl;
  private boolean failed;
  private boolean active;
  private final Runnable retry = this::retryLoad;

  DashboardClient(AssetManager assets, WebView web, View waiting, Runnable updateWaiting, Runnable openSpotify, VoiceAction voiceAction, boolean householdSidebar) {
    super(assets);
    this.web = web;
    this.waiting = waiting;
    this.updateWaiting = updateWaiting;
    this.openSpotify = openSpotify;
    this.voiceAction = voiceAction;
    this.householdSidebar = householdSidebar;
  }

  void load(String url) {
    dashboardOrigin = Uri.parse(url);
    cancelRetry();
    failed = false;
    waiting.setVisibility(View.GONE);
    web.loadUrl(url);
  }

  void reload() {
    if (retryUrl != null) retryLoad();
    else {
      failed = false;
      web.reload();
    }
  }

  void resume() {
    active = true;
    if (retryUrl != null) scheduleRetry(0);
  }

  void pause() {
    active = false;
    handler.removeCallbacks(retry);
  }

  void destroy() {
    pause();
    cancelRetry();
  }

  @Override
  public void onPageStarted(WebView view, String url, Bitmap favicon) {
    Log.i(MainActivity.TAG, "Dashboard navigation started");
    // WebView 106 can report an HTTP error before this callback for the same load.
    // An explicit load/retry clears failed first; preserve a newly reported error.
    if (failed && url.equals(retryUrl)) return;
    cancelRetry();
    failed = false;
    // Keep the waiting screen up during retries, until a successful load finishes.
  }

  @Override
  public void onPageFinished(WebView view, String url) {
    // WebView also calls this after displaying its built-in error page.
    if (failed) return;
    cancelRetry();
    waiting.setVisibility(View.GONE);
    Log.i(MainActivity.TAG, "Dashboard loaded");
    if(sameDashboardOrigin(url)) view.evaluateJavascript("window.HubVoice&&HubVoice.nativeReady()",null);
    if (householdSidebar && sameDashboardOrigin(url)) {
      view.evaluateJavascript(HouseholdSidebar.SCRIPT, null);
    }
  }

  private boolean sameDashboardOrigin(String url) {
    if (dashboardOrigin == null || url == null) return false;
    Uri uri = Uri.parse(url);
    return dashboardOrigin.getScheme() != null && dashboardOrigin.getScheme().equals(uri.getScheme())
        && dashboardOrigin.getHost() != null && dashboardOrigin.getHost().equals(uri.getHost())
        && dashboardOrigin.getPort() == uri.getPort();
  }

  private boolean appLink(WebView view, Uri uri) {
    if (!"homehq".equals(uri.getScheme())) return false;
    // Only launch the fixed Spotify package from this display's selected dashboard.
    if (sameDashboardOrigin(view.getUrl()) && "spotify".equals(uri.getHost())
        && (uri.getPath() == null || uri.getPath().isEmpty())
        && uri.getQuery() == null && uri.getFragment() == null) openSpotify.run();
    if(sameDashboardOrigin(view.getUrl()) && "voice".equals(uri.getHost())) voiceAction.accept(uri);
    return true;
  }

  @Override
  public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
    if ("homehq".equals(request.getUrl().getScheme()) && !request.isForMainFrame()) return true;
    return appLink(view, request.getUrl());
  }

  @Override
  public boolean shouldOverrideUrlLoading(WebView view, String url) {
    return appLink(view, Uri.parse(url));
  }

  @Override
  public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
    // Image, font and API failures must not restart an otherwise usable dashboard.
    if (!request.isForMainFrame()) return;
    failed = true;
    int code = error.getErrorCode();
    Log.i(MainActivity.TAG, "Main-page network error: " + code);
    if (code == ERROR_HOST_LOOKUP || code == ERROR_CONNECT || code == ERROR_IO
        || code == ERROR_TIMEOUT) {
      waitAndRetry(request.getUrl());
    } else {
      cancelRetry();
      waiting.setVisibility(View.GONE);
    }
  }

  @Override
  public void onReceivedHttpError(WebView view, WebResourceRequest request,
      WebResourceResponse response) {
    if (!request.isForMainFrame()) return;
    failed = true;
    int status = response.getStatusCode();
    Log.i(MainActivity.TAG, "Main-page HTTP error: " + status);
    if (status == 408 || status == 429 || status >= 500) waitAndRetry(request.getUrl());
    else {
      cancelRetry();
      waiting.setVisibility(View.GONE);
    }
  }

  private void waitAndRetry(Uri url) {
    String scheme = url.getScheme();
    if (!("http".equals(scheme) || "https".equals(scheme)) || HOST.equals(url.getHost())) return;
    retryUrl = url.toString();
    updateWaiting.run();
    waiting.setVisibility(View.VISIBLE);
    Log.i(MainActivity.TAG, "Dashboard unavailable; retrying in 5 seconds");
    if (active) scheduleRetry(RETRY_MS);
  }

  private void scheduleRetry(long delay) {
    handler.removeCallbacks(retry);
    handler.postDelayed(retry, delay);
  }

  private void retryLoad() {
    if (!active || retryUrl == null) return;
    String url = retryUrl;
    cancelRetry();
    failed = false;
    web.loadUrl(url);
  }

  private void cancelRetry() {
    handler.removeCallbacks(retry);
    retryUrl = null;
  }
}
