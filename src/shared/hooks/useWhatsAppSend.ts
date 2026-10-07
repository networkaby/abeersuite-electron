"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { extractApiError } from "@/shared/lib/api";
import type { WaSendState, WaTemplateKind } from "@/shared/lib/whatsapp/billTemplates";

/**
 * "Send on WhatsApp" for the 3-dot menus and the repair ticket.
 *
 * Whether each kind can be sent (switched on + approved on Settings → WhatsApp
 * Templates, or why not) is asked once and shared by every menu on the page for
 * a minute — a register with 200 rows makes one call, not 200.
 */
const TTL_MS = 60_000;
export type WaSendStates = Partial<Record<WaTemplateKind, WaSendState>>;
let shared: { at: number; states: Promise<WaSendStates> } | null = null;

function loadStates(): Promise<WaSendStates> {
    if (!shared || Date.now() - shared.at > TTL_MS) {
        shared = {
            at: Date.now(),
            states: axios
                .get<{ states: WaSendStates }>("/api/bill-notifications/send")
                .then((r) => r.data.states)
                .catch(() => ({})),
        };
    }
    return shared.states;
}

/** Per kind: "ready", or why the send is greyed out. Empty until loaded. */
export function useWaSendStates(): WaSendStates {
    const [states, setStates] = useState<WaSendStates>({});
    useEffect(() => {
        let alive = true;
        void loadStates().then((s) => alive && setStates(s));
        return () => {
            alive = false;
        };
    }, []);
    return states;
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
