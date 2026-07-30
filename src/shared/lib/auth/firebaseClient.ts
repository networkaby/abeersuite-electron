"use client";

/**
 * Browser-side Firebase app + auth, created lazily on first use.
 *
 * Lazy on purpose: the login page is the only surface that needs Firebase, so
 * nothing is initialised (or downloaded, thanks to the dynamic imports in
 * `portalPasswordless.ts`) until a customer actually chooses OTP or Google.
 */

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

const CONFIG = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

/** True once the browser-side keys are present. */
export function isFirebaseConfigured(): boolean {
    return Boolean(CONFIG.apiKey && CONFIG.authDomain && CONFIG.projectId);
}

function firebaseApp(): FirebaseApp {
    // Reuse across hot reloads / repeat visits.
    return getApps().length ? getApp() : initializeApp(CONFIG);
}

export function firebaseAuth(): Auth {
    const auth = getAuth(firebaseApp());
    // Persist nothing beyond the tab: our own NextAuth cookie is the session,
    // so a lingering Firebase session would only be a second source of truth.
    auth.useDeviceLanguage();
    return auth;
}
