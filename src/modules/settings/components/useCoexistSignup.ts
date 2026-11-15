"use client";

import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { extractApiError } from "@/shared/lib/api";
import { useIsDesktopApp } from "@/shared/lib/bridge";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { META_GRAPH_VERSION } from "@/shared/lib/constants/meta";

/**
 * Meta's coexistence wizard (Embedded Signup): a number that stays on the
 * WhatsApp Business app. Staff pick any business, then scan the QR shown there
 * from that phone. The server finishes the hook-up and saves the number as a
 * COEXIST record (/api/settings/whatsapp-connect). Used by App Settings →
 * WhatsApp numbers → Add number → Coexistence.
 */

type FbLoginResponse = { authResponse?: { code?: string } | null };
type FbSdk = {
    init: (o: Record<string, unknown>) => void;
    login: (cb: (r: FbLoginResponse) => void, o: Record<string, unknown>) => void;
};
declare global {
    interface Window { FB?: FbSdk; fbAsyncInit?: () => void }
}

function loadSdk(appId: string): Promise<FbSdk> {
    if (window.FB) return Promise.resolve(window.FB);
    return new Promise((resolve, reject) => {
        window.fbAsyncInit = () => {
            window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version: META_GRAPH_VERSION });
            resolve(window.FB!);
        };
        const s = document.createElement("script");
        s.src = "https://connect.facebook.net/en_US/sdk.js";
        s.async = true;
        s.crossOrigin = "anonymous";
        s.onerror = () => reject(new Error("Could not load Facebook sign-in"));
        document.body.appendChild(s);
    });
}

export type CoexistDone = { phoneNumberId: string; display?: string; name?: string; steps: string[] };

/** `start()` opens the wizard; `onDone` runs once the number is saved. */
export function useCoexistSignup(onDone: (d: CoexistDone) => void) {
    const [busy, setBusy] = useState(false);
    const ids = useRef<{ phoneNumberId?: string; wabaId?: string }>({});
    const done = useRef(onDone);
    useEffect(() => { done.current = onDone; }, [onDone]);

    // Meta posts the new number's ids from the popup before the login callback.
    useEffect(() => {
        const onMsg = (e: MessageEvent) => {
            if (!e.origin.endsWith("facebook.com")) return;
            try {
                const d = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
                if (d?.type !== "WA_EMBEDDED_SIGNUP") return;
                if (d.data?.phone_number_id) ids.current = { phoneNumberId: d.data.phone_number_id, wabaId: d.data.waba_id };
                if (d.event === "CANCEL") toast.error(`Signup stopped${d.data?.current_step ? ` at ${d.data.current_step}` : ""}`);
            } catch { /* not ours */ }
        };
        window.addEventListener("message", onMsg);
        return () => window.removeEventListener("message", onMsg);
    }, []);

    // Meta's sign-in only runs on an https site listed in the Meta app, never on the
    // counter's http://localhost — so the counter hands the job to the office website
    // (window.open of an outside URL goes to the PC's browser).
    const isCounter = useIsDesktopApp();

    async function start() {
        if (isCounter) {
            window.open(`${COMPANY_DETAILS.sites.office}/office/settings/app-settings`, "_blank");
            return;
        }
        setBusy(true);
        try {
            // The server says why when META_APP_ID is missing (503) — shown by the catch.
            const { data: config } = await axios.get<{ appId: string; configId: string }>("/api/settings/whatsapp-connect");
            const FB = await loadSdk(config.appId);
            ids.current = {};
            FB.login(
                (r) => {
                    const code = r.authResponse?.code;
                    const { phoneNumberId, wabaId } = ids.current;
                    if (!code || !phoneNumberId || !wabaId) {
                        setBusy(false);
                        if (code) toast.error("Meta did not return the number — try again");
                        return;
                    }
                    axios
                        .post<CoexistDone>("/api/settings/whatsapp-connect", { code, phoneNumberId, wabaId })
                        .then(({ data }) => { toast.success("WhatsApp number connected"); done.current(data); })
                        .catch((err) => toast.error(extractApiError(err)))
                        .finally(() => setBusy(false));
                },
                {
                    config_id: config.configId,
                    response_type: "code",
                    override_default_response_type: true,
                    extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" },
                },
            );
        } catch (e) {
            toast.error(axios.isAxiosError(e) ? extractApiError(e) : (e as Error).message);
            setBusy(false);
        }
    }

    return { start, busy, isCounter };
}
