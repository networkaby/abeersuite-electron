package in.networkservice.staff;

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

import java.util.Map;

/**
 * Receives customer WhatsApp messages for staff (data messages from
 * src/shared/lib/push/staffPush.ts) and draws the notification itself, even
 * when the app is closed. A tap opens the chat in the app's Inbox.
 */
public class NsMessagingService extends FirebaseMessagingService {
    static final String CHANNEL = "messages";
    static final String EXTRA_URL = "ns_push_url";

    @Override
    public void onNewToken(@NonNull String token) {
        NsPushPlugin.saveToken(this, token);
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        Map<String, String> data = message.getData();
        String title = data.get("title");
        String body = data.get("body");
        if (title == null) return;

        ensureChannel(this);
        NotificationManagerCompat manager = NotificationManagerCompat.from(this);
        if (!manager.areNotificationsEnabled()) return;

        // One tag per customer: a newer message replaces the older notification instead of stacking.
        String tag = data.get("tag") != null ? data.get("tag") : String.valueOf(System.currentTimeMillis());
        Intent open = new Intent(this, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(EXTRA_URL, data.get("url"));
        PendingIntent tap = PendingIntent.getActivity(this, tag.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder notification = new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(getApplicationInfo().icon)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setAutoCancel(true)
                .setContentIntent(tap);
        try {
            manager.notify(tag, 0, notification.build());
        } catch (SecurityException notAllowed) {
            // notifications switched off for the app
        }
    }

    /** The "Customer messages" channel (Android 8+). Safe to call again and again. */
    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL, context.getString(R.string.ns_push_channel), NotificationManager.IMPORTANCE_HIGH);
        context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }
}
