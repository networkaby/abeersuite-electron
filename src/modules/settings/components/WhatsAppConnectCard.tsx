"use client";

import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Smartphone } from "lucide-react";
import { extractApiError } from "@/shared/lib/api";
import { Button } from "@/components/ui/button";
import { useIsDesktopApp } from "@/shared/lib/bridge";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";

/**
 * Connect a second number that stays on the WhatsApp Business app (Meta
 * "coexistence"). Opens Meta's Embedded Signup popup; staff pick the
 * business, then scan the QR shown there from the WhatsApp Business app on
 * that phone. The server finishes the hook-up (/api/settings/whatsapp-connect).
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
            window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version: "v23.0" });
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

type Done = { phoneNumberId: string; display?: string; name?: string; steps: string[] };

export function WhatsAppConnectCard() {
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState<Done | null>(null);
    const ids = useRef<{ phoneNumberId?: string; wabaId?: string }>({});

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
            window.open(`${COMPANY_DETAILS.sites.office}/office/settings/whatsapp-templates`, "_blank");
            return;
        }
        setBusy(true);
        try {
            // The server says why when META_APP_ID is missing (503) — shown by the catch.
            const { data: config } = await axios.get<{ appId: string; configId: string }>("/api/settings/whatsapp-connect");
            const FB = await loadSdk(config.appId);
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
                        .post("/api/settings/whatsapp-connect", { code, phoneNumberId, wabaId })
                        .then(({ data }) => { setDone(data); toast.success("WhatsApp number connected"); })
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

    return (
        <div className="rounded-lg border p-4 space-y-2">
            <div className="flex items-center gap-2 font-medium"><Smartphone className="h-4 w-4" /> Connect a WhatsApp Business app number</div>
            <p className="text-sm text-muted-foreground">
                Adds a number that keeps working in the WhatsApp Business app on its phone. Click, choose the business, then scan the QR
                from that phone: WhatsApp Business → Settings → Business platform.
            </p>
            <Button onClick={start} disabled={busy} size="sm">
                {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Connect number
            </Button>
            {isCounter && <p className="text-xs text-muted-foreground">Opens the office website — Meta sign-in works only there.</p>}
            {done && (
                <div className="text-sm rounded bg-emerald-50 dark:bg-emerald-950 p-2">
                    Connected {done.display} ({done.name}). Phone number ID <b className="select-all">{done.phoneNumberId}</b>
                    <div className="text-xs text-muted-foreground">{done.steps.join(" · ")}</div>
                </div>
            )}
        </div>
    );
}
