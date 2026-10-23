package in.networkservice.staff;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;

/**
 * Shares a post's photo + caption straight into WhatsApp (Campaigns → Posts; the
 * page is src/modules/mobile/components/MobilePosts.tsx). The app's web view has
 * no Web Share, so a page's "Share" would do nothing; this does it natively:
 *
 *   window.Capacitor.Plugins.NsShare.share({ text, data, mimeType, fileName, packages })
 *
 * `data` is the file as base64 (the page reads it through our own site, signed in);
 * it is written to the app's cache and handed over through the FileProvider.
 * `packages` are tried in order (WhatsApp Business, then WhatsApp); none installed →
 * the phone's own share sheet. Resolves once WhatsApp is opened — what the person
 * then picks (our Channel, My status) is theirs.
 */
@CapacitorPlugin(name = "NsShare")
public class NsSharePlugin extends Plugin {
    @PluginMethod
    public void share(PluginCall call) {
        String text = call.getString("text", "");
        String data = call.getString("data");
        String mimeType = call.getString("mimeType", "image/jpeg");
        String fileName = safeName(call.getString("fileName", "post"));
        JSArray packages = call.getArray("packages", new JSArray());

        try {
            Intent send = new Intent(Intent.ACTION_SEND);
            if (data != null && !data.isEmpty()) {
                File dir = new File(getContext().getCacheDir(), "share");
                if (!dir.exists() && !dir.mkdirs()) throw new Exception("No room to prepare the photo");
                File file = new File(dir, fileName);
                try (FileOutputStream out = new FileOutputStream(file)) {
                    out.write(Base64.decode(data, Base64.DEFAULT));
                }
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
                send.setType(mimeType);
                send.putExtra(Intent.EXTRA_STREAM, uri);
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } else {
                send.setType("text/plain");
            }
            send.putExtra(Intent.EXTRA_TEXT, text);

            String target = firstInstalled(packages);
            if (target != null) {
                send.setPackage(target);
                getActivity().startActivity(send);
            } else {
                getActivity().startActivity(Intent.createChooser(send, "Share post"));
            }
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "Could not open WhatsApp" : e.getMessage());
        }
    }

    private String firstInstalled(JSArray packages) {
        PackageManager pm = getContext().getPackageManager();
        for (int i = 0; i < packages.length(); i++) {
            String name = packages.optString(i, "");
            if (name.isEmpty()) continue;
            try {
                pm.getPackageInfo(name, 0);
                return name;
            } catch (PackageManager.NameNotFoundException ignored) {
                // not installed — try the next one
            }
        }
        return null;
    }

    /** A plain file name — the page's name may carry anything. */
    private static String safeName(String name) {
        String clean = name.replaceAll("[^A-Za-z0-9._-]+", "_");
        return clean.isEmpty() ? "post" : clean;
    }
}
