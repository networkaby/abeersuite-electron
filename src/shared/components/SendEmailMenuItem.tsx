"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Mail } from "lucide-react";
import { extractApiError } from "@/shared/lib/api";
import { emailKindForVoucherType, type EmailTemplateKind } from "@/shared/lib/email/emailTemplates";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

/**
 * "Send email" for the voucher 3-dot menus (Day Book, inventory registers).
 *
 * Whether each kind can be sent is asked once and shared by every menu on the
 * page for a minute — a register with 200 rows makes one call, not 200 (same as
 * useWhatsAppSend). Renders nothing for a voucher type that is never emailed.
 */
type State = "ready" | "off" | "not-configured";
type States = Partial<Record<EmailTemplateKind, State>>;
const TTL_MS = 60_000;
let shared: { at: number; states: Promise<States> } | null = null;

function loadStates(): Promise<States> {
    if (!shared || Date.now() - shared.at > TTL_MS) {
        shared = {
            at: Date.now(),
            states: axios.get<{ states: States }>("/api/bill-notifications/email").then((r) => r.data.states).catch(() => ({})),
        };
    }
    return shared.states;
}

const HINT: Record<State, string | null> = {
    ready: null,
    off: "Switched off on Email Templates",
    "not-configured": "Email is not set up on this server",
};

type Props = { voucherType: string; source: "inv" | "uv"; id: number };

export function SendEmailMenuItem({ voucherType, source, id }: Props) {
    const kind = emailKindForVoucherType(voucherType);
    const [states, setStates] = useState<States>({});
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        if (!kind) return;
        let alive = true;
        void loadStates().then((s) => alive && setStates(s));
        return () => {
            alive = false;
        };
    }, [kind]);
    if (!kind) return null;

    const state = states[kind];
    const hint = state ? HINT[state] : null;
    const send = async () => {
        setBusy(true);
        try {
            const { data } = await axios.post<{ result: "sent" | "already" }>("/api/bill-notifications/email", { source, id });
            if (data.result === "already") toast.info("Already emailed to this customer earlier");
            else toast.success("Emailed to the customer");
        } catch (e) {
            toast.error(extractApiError(e, "Could not send email"));
        } finally {
            setBusy(false);
        }
    };

    return (
        <DropdownMenuItem onSelect={() => void send()} disabled={busy || state !== "ready"} title={hint ?? undefined}>
            <Mail className="size-4" />
            <span className="flex flex-col">
                Send email
                {hint && <span className="text-[10px] leading-tight text-muted-foreground">{hint}</span>}
            </span>
        </DropdownMenuItem>
    );
}
