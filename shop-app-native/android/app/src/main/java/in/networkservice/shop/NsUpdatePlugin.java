package in.networkservice.shop;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;
import androidx.core.content.pm.PackageInfoCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Downloads the new app and opens Android's own Install screen — no trip through
 * Chrome (the bar's "Update now", src/shared/components/AppUpdateBar.tsx). Same as
 * the staff app's (phone-app/…/NsUpdatePlugin.java) — keep the two alike:
 *
 *   window.Capacitor.Plugins.NsUpdate.install({ path: "/ns-shop.apk?v=6" })
 *   addListener("progress", ({ got, total, percent }) => …)
 *
 * Only a `.apk` on our own site (R.string.ns_site) — the page names the path, never
 * the host. The file must be this app, newer than this one, or it is refused
 * before the Install screen (a site not deployed yet would otherwise reinstall the
 * same version in a loop); Android itself refuses one signed with another key.
 * First time only: Android must allow this app to install apps — then this opens
 * that setting and rejects with code "permission"; the person allows it, comes back
 * and taps again.
 */
@CapacitorPlugin(name = "NsUpdate")
public class NsUpdatePlugin extends Plugin {
    private static final String APK_TYPE = "application/vnd.android.package-archive";
    /** A trickle never trips the read timeout, so the whole download gets a limit too. */
    private static final long DOWNLOAD_LIMIT_MS = 3 * 60 * 1000;
    private volatile boolean busy = false;

    @PluginMethod
    public void install(PluginCall call) {
        String path = call.getString("path", "");
        if (!path.matches("/[A-Za-z0-9._-]+\\.apk(\\?[A-Za-z0-9=&._-]*)?")) {
            call.reject("Not an app file on our site", "path");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent allow = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            getActivity().startActivity(allow);
            call.reject("Allow this app to install updates, then tap Update again", "permission");
            return;
        }
        if (busy) {
            call.reject("Already downloading", "busy");
            return;
        }
        busy = true;
        String url = getContext().getString(R.string.ns_site) + path;
        new Thread(() -> {
            try {
                File apk = download(url);
                checkIsNewerSelf(apk);
                getActivity().runOnUiThread(() -> {
                    try {
                        openInstaller(apk);
                        call.resolve();
                    } catch (Exception e) {
                        call.reject(message(e, "Could not open the installer"));
                    }
                });
            } catch (Exception e) {
                call.reject(message(e, "Download failed"));
            } finally {
                busy = false;
            }
        }).start();
    }

    /** Into the app's cache (the FileProvider's cache-path), as .part until complete. */
    private File download(String url) throws Exception {
        File dir = new File(getContext().getCacheDir(), "update");
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("No room for the download");
        File part = new File(dir, "update.apk.part");
        File done = new File(dir, "update.apk");

        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(20000);
        conn.setReadTimeout(30000);
        try {
            int status = conn.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK) throw new Exception("The site answered " + status);
            long total = conn.getContentLengthLong();
            long got = 0;
            long lastReported = -1;
            long deadline = System.currentTimeMillis() + DOWNLOAD_LIMIT_MS;
            byte[] buf = new byte[64 * 1024];
            try (InputStream in = conn.getInputStream(); OutputStream out = new FileOutputStream(part)) {
                int n;
                while ((n = in.read(buf)) != -1) {
                    out.write(buf, 0, n);
                    got += n;
                    if (System.currentTimeMillis() > deadline) {
                        throw new Exception("The connection is too slow — try again on better internet");
                    }
                    // Every ~100 KB: bytes always, percent only when the size is known.
                    if (got - lastReported >= 100 * 1024 || got == total) {
                        lastReported = got;
                        JSObject p = new JSObject();
                        p.put("got", got);
                        p.put("total", total);
                        if (total > 0) p.put("percent", (int) (got * 100 / total));
                        notifyListeners("progress", p);
                    }
                }
            }
            if (total > 0 && got != total) throw new Exception("Download cut off — try again");
        } finally {
            conn.disconnect();
        }
        if (done.exists() && !done.delete()) throw new Exception("Could not replace the old download");
        if (!part.renameTo(done)) throw new Exception("Could not save the download");
        return done;
    }

    private void checkIsNewerSelf(File apk) throws Exception {
        PackageManager pm = getContext().getPackageManager();
        PackageInfo file = pm.getPackageArchiveInfo(apk.getAbsolutePath(), 0);
        if (file == null) throw new Exception("The downloaded file is not an app — try again");
        if (!getContext().getPackageName().equals(file.packageName)) throw new Exception("The downloaded file is a different app");
        PackageInfo mine = pm.getPackageInfo(getContext().getPackageName(), 0);
        if (PackageInfoCompat.getLongVersionCode(file) <= PackageInfoCompat.getLongVersionCode(mine)) {
            throw new Exception("The site does not have the new version yet — try later");
        }
    }

    private void openInstaller(File apk) {
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
        Intent open = new Intent(Intent.ACTION_VIEW);
        open.setDataAndType(uri, APK_TYPE);
        open.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        getActivity().startActivity(open);
    }

    private static String message(Exception e, String fallback) {
        return e.getMessage() == null ? fallback : e.getMessage();
    }
}
