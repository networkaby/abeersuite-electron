package in.networkservice.shop;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NsPushPlugin.class);
        registerPlugin(NsGooglePlugin.class);
        registerPlugin(NsUpdatePlugin.class);
        registerPlugin(NsFilePlugin.class);
        super.onCreate(savedInstanceState);
        markPlayBuild();
        NsMessagingService.ensureChannel(this);
        askForNotifications();
        openFromNotification(getIntent());
        openFromLink(getIntent());
        backStepsThroughPages();
    }

    /** The Play build adds " PlayStore" to the user agent, so AppUpdateBar sends
     *  updates to the Play listing instead of downloading the website's APK. */
    private void markPlayBuild() {
        if (!"play".equals(BuildConfig.FLAVOR)) return;
        WebView web = getBridge().getWebView();
        web.getSettings().setUserAgentString(web.getSettings().getUserAgentString() + " PlayStore");
    }

    /**
     * The phone's Back walks the app's own history (a bill → its list → Home).
     * Only on the first screen does it leave — to the background, like Home, so
     * the next open does not reload from scratch.
     */
    private void backStepsThroughPages() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView web = getBridge().getWebView();
                if (web.canGoBack()) web.goBack();
                else moveTaskToBack(true);
            }
        });
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        openFromNotification(intent);
        openFromLink(intent);
    }

    /** Android 13+ asks once; the answer is the customer's. Without it bills still come on WhatsApp. */
    private void askForNotifications() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[] { Manifest.permission.POST_NOTIFICATIONS }, 7);
        }
    }

    /** A tapped notification: say "clicked", then open its page inside the app (proxy.ts maps it to the app screen). */
    private void openFromNotification(Intent intent) {
        if (intent == null) return;
        String id = intent.getStringExtra(NsMessagingService.EXTRA_ID);
        String path = intent.getStringExtra(NsMessagingService.EXTRA_URL);
        if (id == null && path == null) return;
        intent.removeExtra(NsMessagingService.EXTRA_ID);
        intent.removeExtra(NsMessagingService.EXTRA_URL);
        if (id != null) new Thread(() -> NsMessagingService.postAck(this, id, "clicked")).start();
        if (path != null && path.startsWith("/")) {
            String site = getString(R.string.ns_site);
            getBridge().getWebView().post(() -> getBridge().getWebView().loadUrl(site + path));
        }
    }

    /** A tapped shop.networkservice.in link (App Links — WhatsApp View bill / Open in app):
     *  open it inside the app; proxy.ts maps it to the app screen. */
    private void openFromLink(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction()) || intent.getData() == null) return;
        String url = intent.getData().toString();
        intent.setData(null);
        if (!url.startsWith(getString(R.string.ns_site) + "/")) return;
        getBridge().getWebView().post(() -> getBridge().getWebView().loadUrl(url));
    }
}
