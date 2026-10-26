"use client";

/**
 * Passwordless sign-in for the customer portal — browser seam.
 *
 * Every provider call lives here so the login UI never imports a vendor SDK
 * directly. Each path ends the same way: a verification token that our
 * NextAuth provider checks before minting a session.
 *
 *   mobile → 6-digit code on WhatsApp (our API → Meta), SMS as fallback or on request
 *   email  → emailed 6-digit code (our API → Resend delivery)
 *   google → popup              (Firebase — the only remaining Firebase use);
 *            in the customer app, the phone's own Google sheet (NsGooglePlugin)
 *
 * Both OTP channels are identical from here down: one send endpoint, one verify
 * endpoint, one ticket. The WhatsApp/email vendors only *deliver* — our own server
 * decides who is verified (see `otpChallenge.ts`). That is why phone sign-in
 * needs no reCAPTCHA and no Firebase SDK in the browser.
 *
 * Firebase is loaded with dynamic `import()` so its bulk never lands in the
 * login page's initial bundle — it arrives only if the customer picks Google.
 */

import { isFirebaseConfigured } from "@/shared/lib/auth/firebaseClient";
import { isLikelyEmail } from "@/shared/lib/auth/portalIdentifier";
import { SHOP_APP_GOOGLE_WEB_CLIENT_ID } from "@/shared/lib/device/shopApp";

/** Which channel the customer verified through. */
export type OtpChannel = "mobile" | "email";

/** How the code actually travelled — mobile codes go by WhatsApp, SMS as fallback. */
export type OtpDelivery = "email" | "whatsapp" | "sms";

/** Handle for the code-entry step, returned once the code is on its way. */
export type OtpConfirmation = {
    /** Shown on the code step so the customer knows where to look. */
    via: OtpDelivery;
    /** A mobile code may be re-sent by SMS — an SMS provider is set up. */
    smsAvailable: boolean;
    /** The SMS delivery partner whose name the customer will see, if any. */
    partner?: string;
    /**
     * Verify the 6-digit code. Resolves to a verification token: our own
     * short-lived portal ticket. The NextAuth provider re-checks it server-side.
     */
    confirm: (code: string) => Promise<string>;
};


/** Firebase errors are `auth/...` codes; turn the common ones into plain English. */
function friendlyFirebaseError(e: unknown): string {
    const code = typeof e === "object" && e && "code" in e ? String((e as { code: unknown }).code) : "";
    switch (code) {
        case "auth/too-many-requests":
            return "Too many attempts. Please wait a few minutes and try again.";
        case "auth/popup-closed-by-user":
        case "auth/cancelled-popup-request":
            return "Google sign-in was cancelled.";
        case "auth/popup-blocked":
            return "Your browser blocked the Google popup. Please allow popups and retry.";
        case "auth/account-exists-with-different-credential":
            return "This email is already registered another way. Try OTP instead.";
        default:
            return e instanceof Error && e.message ? e.message : "Something went wrong. Please try again.";
    }
}

/** Shared verify half — identical for SMS and email. */
function confirmationFor(via: OtpDelivery, smsAvailable: boolean, partner?: string): OtpConfirmation {
    return {
        via,
        smsAvailable,
        partner,
        confirm: async (code: string) => {
            const res = await fetch("/api/portal/otp/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code }),
            });
            const body = (await res.json().catch(() => null)) as
                | { ticket?: string; error?: string }
                | null;
            if (!res.ok || !body?.ticket) {
                throw new Error(body?.error ?? "That code did not match. Please check and retry.");
            }
            return body.ticket;
        },
    };
}

/**
 * Send a 6-digit code to whatever the customer typed — the server works out
 * whether it is a mobile or an email and picks the delivery channel.
 * `sms`: the customer asked for SMS instead of WhatsApp; `smsTry` is how many
 * SMS this screen already sent, so the server hands it to the next provider.
 * `purpose` "reset" (Forgot password) only picks the email's wording.
 */
export async function sendOtp(identifier: string, sms?: { smsTry: number }, purpose?: "reset"): Promise<OtpConfirmation> {
    const res = await fetch("/api/portal/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, ...(sms ? { via: "sms", smsTry: sms.smsTry } : {}), ...(purpose ? { purpose } : {}) }),
    });
    const body = (await res.json().catch(() => null)) as { error?: string; via?: OtpDelivery; smsAvailable?: boolean; partner?: string } | null;
    if (!res.ok) {
        throw new Error(body?.error ?? "Could not send the code. Please try again.");
    }
    return confirmationFor(
        body?.via ?? (isLikelyEmail(identifier) ? "email" : "whatsapp"),
        body?.smsAvailable ?? false,
        body?.partner
    );
}

type NativeGoogle = { signIn: (o: { clientId: string }) => Promise<{ idToken: string }> };

/** The customer app's native Google sheet — absent in a browser and in APKs before versionCode 4. */
function nativeGoogle(): NativeGoogle | undefined {
    if (typeof window === "undefined") return undefined;
    return (window as { Capacitor?: { Plugins?: { NsGoogle?: NativeGoogle } } }).Capacitor?.Plugins?.NsGoogle;
}

/** Google sign-in can run here: a browser popup, or the app's native sheet. */
export function canSignInWithGoogle(inApp: boolean): boolean {
    return !inApp || Boolean(nativeGoogle());
}

/** Google sign-in via popup (or the app's native sheet); resolves to a Firebase ID token. */
export async function signInWithGoogle(): Promise<string> {
    if (!isFirebaseConfigured()) {
        throw new Error("Google sign-in is not set up yet. Please use mobile/email and password.");
    }

    const [{ firebaseAuth }, { GoogleAuthProvider, signInWithCredential, signInWithPopup }] = await Promise.all([
        import("@/shared/lib/auth/firebaseClient"),
        import("firebase/auth"),
    ]);

    try {
        const provider = new GoogleAuthProvider();
        // Always show the chooser — shared family devices are common.
        provider.setCustomParameters({ prompt: "select_account" });
        const native = nativeGoogle();
        // Google refuses its popup in a WebView: the app's sheet hands us a Google
        // ID token, and Firebase swaps it for the same token the popup gives.
        const cred = native
            ? await signInWithCredential(firebaseAuth(), GoogleAuthProvider.credential((await native.signIn({ clientId: SHOP_APP_GOOGLE_WEB_CLIENT_ID })).idToken))
            : await signInWithPopup(firebaseAuth(), provider);
        return await cred.user.getIdToken();
    } catch (e) {
        throw new Error(friendlyFirebaseError(e));
    }
}
