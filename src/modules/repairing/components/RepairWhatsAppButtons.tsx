"use client";

import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sendOnWhatsApp, useSendableWaKinds } from "@/shared/hooks";
import { WA_TEMPLATE_LABEL } from "@/shared/lib/whatsapp/billTemplates";

const REPAIR_KINDS = ["REPAIR_RECEIVED", "REPAIR_READY"] as const;

/**
 * The repair ticket's "Send on WhatsApp" — one button per repair message that
 * is switched on (Settings → WhatsApp Templates). Each goes once per ticket;
 * the workflow's stage actions send the same messages by themselves when the
 * template's Auto send is on.
 */
export default function RepairWhatsAppButtons({ ticketId, className }: { ticketId: number; className?: string }) {
    const sendable = useSendableWaKinds();
    const [busy, setBusy] = useState(false);
    const kinds = REPAIR_KINDS.filter((k) => sendable.includes(k));
    if (!kinds.length) return null;

    return (
        <>
            {kinds.map((kind) => (
                <Button
                    key={kind}
                    variant="outline"
                    className={className}
                    disabled={busy}
                    onClick={async () => {
                        setBusy(true);
                        await sendOnWhatsApp({ ticketId, kind }).finally(() => setBusy(false));
                    }}
                >
                    <MessageCircle size={15} /> WhatsApp: {WA_TEMPLATE_LABEL[kind]}
                </Button>
            ))}
        </>
    );
}
