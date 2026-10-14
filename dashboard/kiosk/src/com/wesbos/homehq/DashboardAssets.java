package com.wesbos.homehq;

import android.content.res.AssetManager;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Collections;

/** Serves the bundled dashboard from a private HTTPS origin without a network server. */
class DashboardAssets extends WebViewClient {
  static final String HOST = "appassets.androidplatform.net";
  static final String URL = "https://" + HOST + "/index.html";
  private final AssetManager assets;

  DashboardAssets(AssetManager assets) { this.assets = assets; }

  @Override
  public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
    Uri uri = request.getUrl();
    if (!HOST.equals(uri.getHost())) return null;
    String path = uri.getPath();
    if (!"https".equals(uri.getScheme()) || !"GET".equals(request.getMethod())
        || path == null || path.contains("..") || path.contains("\\")) return missing();
    if ("/".equals(path)) path = "/index.html";
    try {
      return new WebResourceResponse(mime(path), "UTF-8", 200, "OK",
          Collections.singletonMap("Cache-Control", "no-cache"),
          assets.open("dashboard" + path));
    } catch (IOException e) {
      return missing();
    }
  }

  private static WebResourceResponse missing() {
    return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
        Collections.<String, String>emptyMap(), new ByteArrayInputStream(new byte[0]));
  }

  private static String mime(String path) {
    if (path.endsWith(".html")) return "text/html";
    if (path.endsWith(".js")) return "application/javascript";
    if (path.endsWith(".css")) return "text/css";
    if (path.endsWith(".json") || path.endsWith(".webmanifest")) return "application/json";
    if (path.endsWith(".png")) return "image/png";
    if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
    if (path.endsWith(".svg")) return "image/svg+xml";
    if (path.endsWith(".woff2")) return "font/woff2";
    return "application/octet-stream";
  }
}
