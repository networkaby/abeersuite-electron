package in.networkservice.staff;

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
        registerPlugin(NsSharePlugin.class);
        super.onCreate(savedInstanceState);
        NsMessagingService.ensureChannel(this);
        askForNotifications();
        openFromNotification(getIntent());
        backStepsThroughPages();
    }

    /**
     * The phone's Back walks the app's own history (Inbox → Home, a voucher sheet →
     * its list). Only on the first screen does it leave — to the background, like
     * Home, so the next open does not reload from scratch.
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
    }

    /** Android 13+ asks once; without it messages still pop up while the app is open. */
    private void askForNotifications() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[] { Manifest.permission.POST_NOTIFICATIONS }, 7);
        }
    }

    /** A tapped notification opens its chat inside the app. */
    private void openFromNotification(Intent intent) {
        if (intent == null) return;
        String path = intent.getStringExtra(NsMessagingService.EXTRA_URL);
        if (path == null) return;
        intent.removeExtra(NsMessagingService.EXTRA_URL);
        if (!path.startsWith("/")) return;
        String site = getString(R.string.ns_site);
        getBridge().getWebView().post(() -> getBridge().getWebView().loadUrl(site + path));
    }
}
