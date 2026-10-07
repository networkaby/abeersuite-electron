"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { extractApiError } from "@/shared/lib/api";
import type { WaTemplateKind } from "@/shared/lib/whatsapp/billTemplates";

/**
 * "Send on WhatsApp" for the 3-dot menus and the repair ticket.
 *
 * Which kinds may be sent (switched on + approved on Settings → WhatsApp
 * Templates) is asked once and shared by every menu on the page for a minute —
 * a register with 200 rows makes one call, not 200.
 */
const TTL_MS = 60_000;
let shared: { at: number; kinds: Promise<WaTemplateKind[]> } | null = null;

function loadKinds(): Promise<WaTemplateKind[]> {
    if (!shared || Date.now() - shared.at > TTL_MS) {
        shared = {
            at: Date.now(),
            kinds: axios
                .get<{ kinds: WaTemplateKind[] }>("/api/bill-notifications/send")
                .then((r) => r.data.kinds)
                .catch(() => []),
        };
    }
    return shared.kinds;
}

export function useSendableWaKinds(): WaTemplateKind[] {
    const [kinds, setKinds] = useState<WaTemplateKind[]>([]);
    useEffect(() => {
        let alive = true;
        void loadKinds().then((k) => alive && setKinds(k));
        return () => {
            alive = false;
        };
    }, []);
    return kinds;
}

export type WaSendTarget =
    | { source: "inv" | "uv"; id: number }
    | { ticketId: number; kind: "REPAIR_RECEIVED" | "REPAIR_READY" };

/** Send one document; toasts the outcome. Resolves true when it went (or had already gone). */
export async function sendOnWhatsApp(target: WaSendTarget): Promise<boolean> {
    try {
        const { data } = await axios.post<{ result: "sent" | "already" }>("/api/bill-notifications/send", target);
        if (data.result === "already") toast.info("Already sent to this customer earlier");
        else toast.success("Sent to the customer's app and WhatsApp");
        return true;
    } catch (e) {
        toast.error(extractApiError(e, "Could not send"));
        return false;
    }
}
