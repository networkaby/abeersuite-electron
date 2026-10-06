"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { BellRing, MessageCircle } from "lucide-react";

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
 * How the customer was told about one bill / receipt — App and WhatsApp chips.
 * Renders nothing when no message was sent (walk-in, draft, older bill).
 */
export function BillNotifyStatus({ universalVoucherId }: { universalVoucherId: number | null | undefined }) {
    const [n, setN] = useState<Notification | null>(null);

    useEffect(() => {
        if (!universalVoucherId) return;
        let alive = true;
        axios
            .get(`/api/bill-notifications/${universalVoucherId}`)
            .then(({ data }) => alive && setN(data.notification))
            .catch(() => undefined);
        return () => {
            alive = false;
        };
    }, [universalVoucherId]);

    if (!n) return null;
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
