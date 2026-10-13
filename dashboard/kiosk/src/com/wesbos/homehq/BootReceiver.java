package com.wesbos.homehq;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

/** Start the dashboard after boot; an opt-in SI006 workaround restores its working USB mode. */
public class BootReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context context, Intent intent) {
    if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
    if ("SI006".equals(Build.MODEL) && "sp7731g_1h10".equals(Build.HARDWARE)
        && context.getSharedPreferences("kiosk", 0).getBoolean("keep_usb", false)) {
      final PendingResult pending = goAsync();
      new Thread(() -> {
        Handler handler = new Handler(Looper.getMainLooper());
        Runnable timeout = null;
        try {
          Process process = Runtime.getRuntime().exec(new String[] {"su", "-c",
              "setprop persist.sys.usb.config mtp,adb; setprop sys.usb.config mtp,adb"});
          // A stalled or prompting su must not hold the boot broadcast indefinitely.
          timeout = process::destroy;
          handler.postDelayed(timeout, 7000);
          Log.i("HomeHQ", "USB boot setup exit: " + process.waitFor());
        } catch (Exception e) {
          Log.e("HomeHQ", "USB boot setup failed", e);
        } finally {
          if (timeout != null) handler.removeCallbacks(timeout);
          pending.finish();
        }
      }, "homehq-usb-setup").start();
    }
    context.startActivity(new Intent(context, MainActivity.class)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
  }
}
