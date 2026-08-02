import "server-only";

/**
 * Server-side verification of Firebase ID tokens (Google sign-in) — no Admin SDK.
 *
 * A Firebase ID token is a plain RS256 JWT signed by Google. We verify it with
 * `jose` against Google's published signing keys, exactly the checks
 * firebase-admin's verifyIdToken performs: signature, expiry, issuer and
 * audience (both bound to our Firebase project id).
 *
 * Why not firebase-admin: its dependency chain (jwks-rsa, CommonJS) does
 * `require("jose")`, and jose v6 is ESM-only — that require crashes on
 * Vercel's runtime with ERR_REQUIRE_ESM, 500ing every Google login. `jose`
 * used directly is pure ESM and bundles cleanly.
 *
 * Trade-off vs the Admin SDK: no `checkRevoked` round trip (that needs the
 * Admin API). Acceptable here — the token lives 1 hour and is only ever used
 * once, immediately after the popup, to mint our own NextAuth session.
 *
 * The project id comes from FIREBASE_SERVICE_ACCOUNT_JSON (kept for
 * compatibility with existing deployments) or NEXT_PUBLIC_FIREBASE_PROJECT_ID.
 */

import { createRemoteJWKSet, jwtVerify } from "jose";

/** What we trust after verifying a token. */
export type VerifiedFirebaseIdentity = {
    /** E.164 phone, present for SMS sign-in. */
    phone: string | null;
    /** Present for Google sign-in (and only when Google says it is verified). */
    email: string | null;
    /** Firebase's own uid — handy for logs, not used as our identity. */
    uid: string;
};

/** Google's signing keys for Firebase ID tokens (cached + rotated by jose). */
const FIREBASE_JWKS_URL =
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function firebaseProjectId(): string | null {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (raw) {
        try {
            const parsed = JSON.parse(raw) as { project_id?: string };
            if (parsed.project_id) return parsed.project_id;
        } catch {
            // fall through to the public project id
        }
    }
    return process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? null;
}

/** True once a project id is available to validate tokens against. */
export function isFirebaseVerifyConfigured(): boolean {
    return firebaseProjectId() !== null;
}

/**
 * Verify a browser-minted Firebase ID token.
 * Returns null when the token is invalid — callers must treat that as a refusal.
 */
export async function verifyFirebaseIdToken(
    idToken: string
): Promise<VerifiedFirebaseIdentity | null> {
    if (!idToken) return null;
    const projectId = firebaseProjectId();
    if (!projectId) return null;
    try {
        jwks ??= createRemoteJWKSet(new URL(FIREBASE_JWKS_URL));
        const { payload } = await jwtVerify(idToken, jwks, {
            issuer: `https://securetoken.google.com/${projectId}`,
            audience: projectId,
            algorithms: ["RS256"],
        });
        if (!payload.sub) return null;
        return {
            phone: typeof payload.phone_number === "string" ? payload.phone_number : null,
            // Only trust an email Firebase itself marked verified — an
            // unverified one proves nothing about who is signing in.
            email:
                typeof payload.email === "string" && payload.email_verified === true
                    ? payload.email
                    : null,
            uid: payload.sub,
        };
    } catch {
        return null;
    }
}
