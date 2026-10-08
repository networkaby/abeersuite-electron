package in.networkservice.shop;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * Receives the shop's messages (bills, receipts, order updates), data messages
 * from src/shared/lib/push/fcm.ts, draws the notification itself, and tells the
 * server "shown" straight away (POST /api/portal/push/ack), even when the app is
 * closed. That "shown" is what lets the server count the message as delivered,
 * like WhatsApp's double tick. Nothing is reported when the customer has turned
 * notifications off, so WhatsApp still goes out to them.
 */
public class NsMessagingService extends FirebaseMessagingService {
    static final String CHANNEL = "bills";
    static final String EXTRA_ID = "ns_push_id";
    static final String EXTRA_URL = "ns_push_url";

    @Override
    public void onNewToken(@NonNull String token) {
        NsPushPlugin.saveToken(this, token);
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        Map<String, String> data = message.getData();
        String id = data.get("id");
        String title = data.get("title");
        String body = data.get("body");
        if (title == null) return;

        ensureChannel(this);
        NotificationManagerCompat manager = NotificationManagerCompat.from(this);
        if (!manager.areNotificationsEnabled()) return;

        Intent open = new Intent(this, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(EXTRA_ID, id)
                .putExtra(EXTRA_URL, data.get("url"));
        int requestCode = id != null ? id.hashCode() : (int) System.currentTimeMillis();
        PendingIntent tap = PendingIntent.getActivity(this, requestCode, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder notification = new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(getApplicationInfo().icon)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(tap);
        // The same tag replaces an older notification instead of stacking.
        String tag = data.get("tag") != null ? data.get("tag") : id;
        try {
            manager.notify(tag, 0, notification.build());
        } catch (SecurityException notAllowed) {
            return;
        }
        // Already on a background thread here, so report straight away.
        if (id != null) postAck(this, id, "shown");
    }

    /** The "Bills & orders" channel (Android 8+). Safe to call again and again. */
    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL, context.getString(R.string.ns_push_channel), NotificationManager.IMPORTANCE_HIGH);
        context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    /** Report "shown" / "clicked" for one message. Never throws; a lost report only means WhatsApp also goes. */
    static void postAck(Context context, String id, String event) {
        try {
            URL url = new URL(context.getString(R.string.ns_site) + "/api/portal/push/ack");
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(10000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            String json = "{\"id\":\"" + id.replace("\"", "") + "\",\"event\":\"" + event + "\"}";
            try (OutputStream out = connection.getOutputStream()) {
                out.write(json.getBytes(StandardCharsets.UTF_8));
            }
            connection.getResponseCode();
            connection.disconnect();
        } catch (Exception offline) {
            // the server sends WhatsApp as well
        }
    }
}
