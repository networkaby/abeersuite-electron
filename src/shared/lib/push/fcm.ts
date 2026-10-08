import "server-only";
import { importPKCS8, SignJWT } from "jose";

/**
 * Firebase Cloud Messaging (HTTP v1) for the customer app (shop-app-native/).
 * No firebase-admin — its CommonJS chain crashes on Vercel (see
 * auth/firebaseToken.ts); a signed JWT from the service account buys a
 * 1-hour access token, and one POST sends one message.
 *
 * Setup: FIREBASE_SERVICE_ACCOUNT_JSON = the whole JSON of a Firebase service
 * account key (Project settings → Service accounts → Generate new private key).
 * The same variable the Google sign-in check reads its project id from.
 */

type ServiceAccount = { project_id: string; client_email: string; private_key: string };

let account: ServiceAccount | null | undefined;
function serviceAccount(): ServiceAccount | null {
    if (account !== undefined) return account;
    try {
        const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? "") as Partial<ServiceAccount>;
        account = parsed.project_id && parsed.client_email && parsed.private_key ? (parsed as ServiceAccount) : null;
    } catch {
        account = null;
    }
    return account;
}

export function isFcmConfigured(): boolean {
    return serviceAccount() != null;
}

let cached: { token: string; until: number } | null = null;
async function accessToken(sa: ServiceAccount): Promise<string> {
    if (cached && cached.until > Date.now() + 60_000) return cached.token;
    const key = await importPKCS8(sa.private_key, "RS256");
    const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase.messaging" })
        .setProtectedHeader({ alg: "RS256", typ: "JWT" })
        .setIssuer(sa.client_email)
        .setAudience("https://oauth2.googleapis.com/token")
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(key);
    const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    });
    if (!res.ok) throw new Error(`FCM auth failed (${res.status})`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    cached = { token: json.access_token, until: Date.now() + json.expires_in * 1000 };
    return json.access_token;
}

export type FcmOutcome = "sent" | "dead" | "failed";

/**
 * Send one data message to one app install. Data only, on purpose: the app's
 * own receiver (NsMessagingService) draws the notification and reports "shown"
 * at once, even with the app closed — a notification message would be drawn by
 * Android itself and nobody could report it. "dead" = the install is gone
 * (uninstalled, token rotated): drop the device.
 */
export async function sendFcm(token: string, data: Record<string, string>): Promise<FcmOutcome> {
    const sa = serviceAccount();
    if (!sa) return "failed";
    try {
        const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
            method: "POST",
            headers: { Authorization: `Bearer ${await accessToken(sa)}`, "Content-Type": "application/json" },
            // TTL 1 day: a phone that is off longer gets WhatsApp anyway.
            body: JSON.stringify({ message: { token, data, android: { priority: "high", ttl: "86400s" } } }),
        });
        if (res.ok) return "sent";
        const body = (await res.json().catch(() => null)) as { error?: { status?: string; details?: { errorCode?: string }[] } } | null;
        const code = body?.error?.details?.find((d) => d.errorCode)?.errorCode ?? body?.error?.status;
        // Only Google's own "this install is gone" removes a device — never a
        // fault in our message, which would wipe good phones.
        return res.status === 404 || code === "UNREGISTERED" ? "dead" : "failed";
    } catch {
        return "failed";
    }
}

/** App installs are stored with the web-push devices, their address written `fcm:<token>`. */
export const FCM_PREFIX = "fcm:";
