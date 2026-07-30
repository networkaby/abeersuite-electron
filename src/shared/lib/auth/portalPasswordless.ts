"use client";

/**
 * Passwordless sign-in for the customer portal — browser seam.
 *
 * Every provider call lives here so the login UI never imports a vendor SDK
 * directly. Each path ends the same way: a verification token that our
 * NextAuth provider checks before minting a session.
 *
 *   mobile → SMS 6-digit code   (our API → Fast2SMS delivery)
 *   email  → emailed 6-digit code (our API → Resend delivery)
 *   google → popup              (Firebase — the only remaining Firebase use)
 *
 * Both OTP channels are identical from here down: one send endpoint, one verify
 * endpoint, one ticket. The SMS/email vendors only *deliver* — our own server
 * decides who is verified (see `otpChallenge.ts`). That is why phone sign-in
 * needs no reCAPTCHA and no Firebase SDK in the browser.
 *
 * Firebase is loaded with dynamic `import()` so its bulk never lands in the
 * login page's initial bundle — it arrives only if the customer picks Google.
 */

import { isFirebaseConfigured } from "@/shared/lib/auth/firebaseClient";

/** Which channel the customer verified through. */
export type OtpChannel = "mobile" | "email";

/** Handle for the code-entry step, returned once the code is on its way. */
export type OtpConfirmation = {
    /**
     * Verify the 6-digit code. Resolves to a verification token: our own
     * short-lived portal ticket. The NextAuth provider re-checks it server-side.
     */
    confirm: (code: string) => Promise<string>;
};

export class PortalAuthNotConfiguredError extends Error {
    constructor(message = "OTP sign-in is not set up yet. Please use mobile/email and password.") {
        super(message);
        this.name = "PortalAuthNotConfiguredError";
    }
}

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
function confirmationFor(): OtpConfirmation {
    return {
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
 */
export async function sendOtp(identifier: string): Promise<OtpConfirmation> {
    const res = await fetch("/api/portal/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier }),
    });
    if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Could not send the code. Please try again.");
    }
    return confirmationFor();
}

/** Google sign-in via popup; resolves to a Firebase ID token. */
export async function signInWithGoogle(): Promise<string> {
    if (!isFirebaseConfigured()) {
        throw new PortalAuthNotConfiguredError(
            "Google sign-in is not set up yet. Please use mobile/email and password."
        );
    }

    const [{ firebaseAuth }, { GoogleAuthProvider, signInWithPopup }] = await Promise.all([
        import("@/shared/lib/auth/firebaseClient"),
        import("firebase/auth"),
    ]);

    try {
        const provider = new GoogleAuthProvider();
        // Always show the chooser — shared family devices are common.
        provider.setCustomParameters({ prompt: "select_account" });
        const cred = await signInWithPopup(firebaseAuth(), provider);
        return await cred.user.getIdToken();
    } catch (e) {
        throw new Error(friendlyFirebaseError(e));
    }
}
