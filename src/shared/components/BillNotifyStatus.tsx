"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { BellRing, Loader2, MessageCircle } from "lucide-react";
import { extractApiError } from "@/shared/lib/api";
import { Button } from "@/components/ui/button";

type Notification = {
    pushStatus: string;
    shownAt: string | null;
    clickedAt: string | null;
    waStatus: string;
    waError: string | null;
    mobile: string | null;
};

const GOOD = "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200";
const WAIT = "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200";
const BAD = "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200";
const OFF = "bg-muted text-muted-foreground";

function appChip(n: Notification): [string, string, string] {
    if (n.clickedAt) return ["App: opened", GOOD, "The customer tapped the notification"];
    if (n.shownAt) return ["App: shown", GOOD, "The customer's phone showed the notification"];
    if (n.pushStatus === "sent") return ["App: not shown yet", WAIT, "Sent; the phone has not reported showing it"];
    if (n.pushStatus === "pending") return ["App: sending", WAIT, ""];
    if (n.pushStatus === "failed") return ["App: failed", BAD, "Google/Apple refused every device"];
    return ["App: none", OFF, "Customer has no app with notifications on"];
}

function waChip(n: Notification): [string, string, string] {
    switch (n.waStatus) {
        case "sent": return ["WhatsApp: sent", GOOD, n.mobile ? `To ${n.mobile}` : ""];
        case "pending": return ["WhatsApp: sending", WAIT, ""];
        case "failed": return ["WhatsApp: failed", BAD, n.waError ?? ""];
        case "no-mobile": return ["WhatsApp: no mobile", OFF, "No 10-digit mobile on this party"];
        case "disabled": return ["WhatsApp: off", OFF, "Template switched off or not approved yet"];
        default: return ["WhatsApp: not set up", OFF, "Meta keys missing on the server"];
    }
}

/**
 * How the customer was told about one document — App and WhatsApp chips.
 * Renders nothing when no message was sent (walk-in, draft, older document),
 * except an estimate, which offers the manual Send button instead.
 */
export function BillNotifyStatus({
    universalVoucherId,
    sendable = false,
}: {
    universalVoucherId: number | null | undefined;
    /** An estimate: offer "Send on WhatsApp" until it has been sent. */
    sendable?: boolean;
}) {
    const [n, setN] = useState<Notification | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [sending, setSending] = useState(false);

    useEffect(() => {
        if (!universalVoucherId) return;
        let alive = true;
        axios
            .get(`/api/bill-notifications/${universalVoucherId}`)
            .then(({ data }) => {
                if (!alive) return;
                setN(data.notification);
                setLoaded(true);
            })
            .catch(() => undefined);
        return () => {
            alive = false;
        };
    }, [universalVoucherId]);

    async function send() {
        setSending(true);
        try {
            const { data } = await axios.post(`/api/bill-notifications/${universalVoucherId}`);
            setN(data.notification);
            toast.success("Sent to the customer's app and WhatsApp");
        } catch (e) {
            toast.error(extractApiError(e, "Could not send"));
        } finally {
            setSending(false);
        }
    }

    if (!n) {
        if (!sendable || !loaded) return null;
        return (
            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={send} disabled={sending}>
                {sending ? <Loader2 className="size-3 animate-spin" /> : <MessageCircle className="size-3" />}
                Send on WhatsApp
            </Button>
        );
    }
    const [appText, appCls, appTip] = appChip(n);
    const [waText, waCls, waTip] = waChip(n);
    return (
        <span className="inline-flex flex-wrap items-center gap-1.5">
            <span title={appTip} className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${appCls}`}>
                <BellRing className="size-3" /> {appText}
            </span>
            <span title={waTip} className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${waCls}`}>
                <MessageCircle className="size-3" /> {waText}
            </span>
        </span>
    );
}
