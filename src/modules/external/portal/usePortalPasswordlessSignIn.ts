"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import type { OtpChannel } from "@/shared/lib/auth/portalPasswordless";

/**
 * Shared tail of every passwordless sign-in (mobile OTP, email OTP, Google):
 * we hold a verified token and need a portal session.
 *
 * Known customer   → sign in straight away.
 * Unknown customer → hand back an `onboard` draft so the caller can show the
 *                    minimal create form, then finish with `completeOnboard`.
 *
 * The token is the only thing that authenticates — a name typed into the
 * onboarding form never substitutes for it, and the channel is read out of the
 * token server-side rather than being asserted from here.
 */

export type OnboardDraft = {
    token: string;
    channel: OtpChannel;
    /** What the customer verified — shown back to them on the form. */
    identity: string;
};

const GENERIC_FAIL = "Could not sign you in. Please try again.";

export function usePortalPasswordlessSignIn(onSignedIn: () => void) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [onboard, setOnboard] = useState<OnboardDraft | null>(null);

    /** Exchange a verified token for a session, or ask for onboarding. */
    const submitToken = async (token: string, channel: OtpChannel, identity: string) => {
        setBusy(true);
        setError("");
        try {
            // Does a customer already exist for this verified identity?
            const res = await fetch("/api/portal/passwordless-identity", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token }),
            });
            if (!res.ok) {
                setError(GENERIC_FAIL);
                return;
            }
            const { exists, unverified } = (await res.json()) as { exists: boolean; unverified?: boolean };

            if (unverified) {
                setError("This contact is saved on a profile but not verified yet. Sign in with your password or a verified mobile/email, then verify it from My Profile.");
                return;
            }
            if (!exists) {
                setOnboard({ token, channel, identity });
                return;
            }
            await finishSignIn(token);
        } catch {
            setError(GENERIC_FAIL);
        } finally {
            setBusy(false);
        }
    };

    /** Create the customer with the minimal details, then sign in. */
    const completeOnboard = async (name: string, extraContact: string) => {
        if (!onboard) return;
        setBusy(true);
        setError("");
        try {
            await finishSignIn(onboard.token, name, extraContact);
        } catch {
            setError(GENERIC_FAIL);
        } finally {
            setBusy(false);
        }
    };

    async function finishSignIn(token: string, name?: string, extraContact?: string) {
        const res = await signIn("credentials-portal-passwordless", {
            token,
            name: name ?? "",
            extraContact: extraContact ?? "",
            redirect: false,
        });
        if (res?.error) {
            setError(GENERIC_FAIL);
            return;
        }
        setOnboard(null);
        onSignedIn();
    }

    const cancelOnboard = () => {
        setOnboard(null);
        setError("");
    };

    return { busy, error, setError, onboard, submitToken, completeOnboard, cancelOnboard };
}
