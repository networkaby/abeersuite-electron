package in.networkservice.shop;

import android.content.Context;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;

/**
 * Gives the page (src/modules/external/shopApp/AppPushRegister.tsx) this phone's
 * Firebase push token: window.Capacitor.Plugins.NsPush.getToken() gives { token }.
 * The page saves it for the signed-in customer. "" until Firebase has one, and
 * for good when the build has no google-services.json (push simply stays off).
 */
@CapacitorPlugin(name = "NsPush")
public class NsPushPlugin extends Plugin {
    private static final String PREFS = "ns_push";
    private static final String TOKEN = "token";

    static void saveToken(Context context, String token) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(TOKEN, token).apply();
    }

    @Override
    public void load() {
        // No google-services.json in this build: Firebase never started, push stays off.
        if (FirebaseApp.getApps(getContext()).isEmpty()) return;
        FirebaseMessaging.getInstance().getToken().addOnSuccessListener(token -> saveToken(getContext(), token));
    }

    @PluginMethod
    public void getToken(PluginCall call) {
        JSObject result = new JSObject();
        result.put(TOKEN, getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(TOKEN, ""));
        call.resolve(result);
    }
}
