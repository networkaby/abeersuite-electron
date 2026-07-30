import "server-only";

/**
 * Server-side Firebase Admin — used only to verify ID tokens minted in the
 * browser (SMS OTP and Google). We never use it to create or manage users;
 * Person/Account in our own DB stays the source of truth.
 *
 * Credentials come from FIREBASE_SERVICE_ACCOUNT_JSON (the whole service-account
 * JSON as one env var). Kept lazy so a missing key only breaks the passwordless
 * routes, not every server render.
 */

import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

/** What we trust after verifying a token. */
export type VerifiedFirebaseIdentity = {
    /** E.164 phone, present for SMS sign-in. */
    phone: string | null;
    /** Present for Google sign-in (and only when Google says it is verified). */
    email: string | null;
    /** Firebase's own uid — handy for logs, not used as our identity. */
    uid: string;
};

export class FirebaseAdminNotConfiguredError extends Error {
    constructor() {
        super("FIREBASE_SERVICE_ACCOUNT_JSON is not set — passwordless sign-in cannot be verified.");
        this.name = "FirebaseAdminNotConfiguredError";
    }
}

let cached: App | null = null;

function adminApp(): App {
    if (cached) return cached;
    const existing = getApps();
    if (existing.length) {
        cached = existing[0];
        return cached;
    }

    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) throw new FirebaseAdminNotConfiguredError();

    let parsed: { project_id?: string; client_email?: string; private_key?: string };
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.");
    }
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
        throw new Error(
            "FIREBASE_SERVICE_ACCOUNT_JSON is missing project_id / client_email / private_key."
        );
    }

    cached = initializeApp({
        credential: cert({
            projectId: parsed.project_id,
            clientEmail: parsed.client_email,
            // Env vars flatten newlines to the literal two characters "\n".
            privateKey: parsed.private_key.replace(/\\n/g, "\n"),
        }),
    });
    return cached;
}

/** True once the service-account key is present. */
export function isFirebaseAdminConfigured(): boolean {
    return Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
}

/**
 * Verify a browser-minted Firebase ID token.
 *
 * `checkRevoked: true` costs one extra round trip but means a token cannot be
 * replayed after the Firebase user is disabled or its sessions revoked.
 * Returns null when the token is invalid — callers must treat that as a refusal.
 */
export async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedFirebaseIdentity | null> {
    if (!idToken) return null;
    try {
        const decoded = await getAuth(adminApp()).verifyIdToken(idToken, true);
        return {
            phone: decoded.phone_number ?? null,
            // Only trust an email Firebase itself marked verified — an
            // unverified one proves nothing about who is signing in.
            email: decoded.email && decoded.email_verified ? decoded.email : null,
            uid: decoded.uid,
        };
    } catch {
        return null;
    }
}
