package in.networkservice.shop;

import android.os.CancellationSignal;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;

/**
 * Google sign-in for the customer app. Google refuses its web popup inside a
 * WebView, so the page (src/shared/lib/auth/portalPasswordless.ts) asks here:
 * window.Capacitor.Plugins.NsGoogle.signIn({ clientId }) gives { idToken } — a
 * Google ID token for the Firebase web client, which the page swaps for a
 * Firebase token exactly as the website's popup does. Rejects with code
 * "cancelled" when the customer closes the account chooser.
 *
 * Needs this APK's signing SHA-1 added to the Firebase Android app, or Google
 * answers every request with "no credentials".
 */
@CapacitorPlugin(name = "NsGoogle")
public class NsGooglePlugin extends Plugin {
    @PluginMethod
    public void signIn(PluginCall call) {
        String clientId = call.getString("clientId");
        if (clientId == null || clientId.isEmpty()) {
            call.reject("Google sign-in is not set up yet.", "unconfigured");
            return;
        }
        // The plain "Sign in with Google" sheet: always shows the account chooser,
        // which suits the shared family phones the website's popup also allows for.
        GetCredentialRequest request = new GetCredentialRequest.Builder()
                .addCredentialOption(new GetSignInWithGoogleOption.Builder(clientId).build())
                .build();
        CredentialManager.create(getContext()).getCredentialAsync(
                getActivity(),
                request,
                new CancellationSignal(),
                ContextCompat.getMainExecutor(getContext()),
                new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                    @Override
                    public void onResult(GetCredentialResponse response) {
                        Credential credential = response.getCredential();
                        if (credential instanceof CustomCredential
                                && GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(credential.getType())) {
                            GoogleIdTokenCredential google = GoogleIdTokenCredential.createFrom(credential.getData());
                            JSObject result = new JSObject();
                            result.put("idToken", google.getIdToken());
                            call.resolve(result);
                        } else {
                            call.reject("Google did not return an account.", "failed");
                        }
                    }

                    @Override
                    public void onError(@NonNull GetCredentialException e) {
                        if (e instanceof GetCredentialCancellationException) {
                            call.reject("Google sign-in was cancelled.", "cancelled");
                        } else {
                            call.reject("Google sign-in failed. Please use mobile/email instead.", "failed", e);
                        }
                    }
                });
    }
}
