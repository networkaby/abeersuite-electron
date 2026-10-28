package in.networkservice.shop;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * A bill or receipt the customer saves or sends (Download / Share on the bill
 * screen, src/modules/external/shopApp/AppDocActions.tsx). The app's web view can
 * neither download a file the page made nor share one, so this does both:
 *
 *   window.Capacitor.Plugins.NsFile.save({ data, fileName, mimeType })   → Downloads
 *   window.Capacitor.Plugins.NsFile.share({ data, fileName, mimeType, text }) → share sheet
 *
 * `data` is the file as base64 (a JPG or a PDF the page drew). Saving goes through
 * MediaStore on Android 10+ (no permission asked); older phones get the app's own
 * Downloads folder, which needs none either. Sharing writes to the app's cache and
 * hands the file over through the FileProvider, as the staff app's NsShare does.
 */
@CapacitorPlugin(name = "NsFile")
public class NsFilePlugin extends Plugin {
    private static final String[] TYPES = { "application/pdf", "image/jpeg" };

    @PluginMethod
    public void save(PluginCall call) {
        try {
            byte[] bytes = decode(call);
            String name = safeName(call.getString("fileName", "bill"));
            String type = mimeType(call);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentResolver cr = getContext().getContentResolver();
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                v.put(MediaStore.Downloads.MIME_TYPE, type);
                v.put(MediaStore.Downloads.IS_PENDING, 1);
                Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (uri == null) throw new Exception("No room in Downloads");
                try (OutputStream out = cr.openOutputStream(uri)) {
                    if (out == null) throw new Exception("Could not write the file");
                    out.write(bytes);
                }
                v.clear();
                v.put(MediaStore.Downloads.IS_PENDING, 0);
                cr.update(uri, v, null, null);
            } else {
                File dir = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (dir == null || (!dir.exists() && !dir.mkdirs())) throw new Exception("No room in Downloads");
                try (FileOutputStream out = new FileOutputStream(new File(dir, name))) {
                    out.write(bytes);
                }
            }
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "Could not save the file" : e.getMessage());
        }
    }

    @PluginMethod
    public void share(PluginCall call) {
        try {
            byte[] bytes = decode(call);
            File dir = new File(getContext().getCacheDir(), "share");
            if (!dir.exists() && !dir.mkdirs()) throw new Exception("No room to prepare the file");
            File file = new File(dir, safeName(call.getString("fileName", "bill")));
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(bytes);
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mimeType(call));
            send.putExtra(Intent.EXTRA_STREAM, uri);
            String text = call.getString("text", "");
            if (!text.isEmpty()) send.putExtra(Intent.EXTRA_TEXT, text);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(Intent.createChooser(send, "Share"));
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "Could not share the file" : e.getMessage());
        }
    }

    private static byte[] decode(PluginCall call) throws Exception {
        String data = call.getString("data", "");
        if (data.isEmpty()) throw new Exception("Nothing to save");
        return Base64.decode(data, Base64.DEFAULT);
    }

    /** Only the two kinds the page makes — never whatever a page might name. */
    private static String mimeType(PluginCall call) throws Exception {
        String type = call.getString("mimeType", "");
        for (String t : TYPES) if (t.equals(type)) return t;
        throw new Exception("Only a PDF or a JPG can be saved");
    }

    /** A plain file name — the page's name may carry anything. */
    private static String safeName(String name) {
        String clean = name.replaceAll("[^A-Za-z0-9._-]+", "_");
        return clean.isEmpty() ? "bill" : clean;
    }
}
