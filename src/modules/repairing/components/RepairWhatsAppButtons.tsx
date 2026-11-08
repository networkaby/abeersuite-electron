"use client";

import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sendOnWhatsApp, useWaSendStates } from "@/shared/hooks";
import { WA_TEMPLATE_LABEL, waSendHint } from "@/shared/lib/whatsapp/billTemplates";
import { statusHasWorkflowRole, type WorkflowStatusRole } from "@/shared/lib/constants/workflow";

/** Each message, and the workflow stage it belongs to (constants/workflow.ts). */
const REPAIR_KINDS = [
    { kind: "REPAIR_RECEIVED", role: "repairReceived" },
    { kind: "REPAIR_READY", role: "repairReady" },
] as const satisfies readonly { kind: string; role: WorkflowStatusRole }[];

/**
 * The repair ticket's "Send on WhatsApp" — one button per repair message,
 * greyed out with the reason until its template is approved and switched on
 * (Settings → WhatsApp Templates), and shown only on its own stage. Each goes once per ticket; the workflow's
 * stage actions send the same messages by themselves when Auto send is on.
 */
export default function RepairWhatsAppButtons({ ticketId, status, className }: { ticketId: number; status: string; className?: string }) {
    const states = useWaSendStates();
    const [busy, setBusy] = useState(false);

    return (
        <>
            {REPAIR_KINDS.filter((k) => statusHasWorkflowRole(k.role, status)).map(({ kind }) => {
                const hint = waSendHint(states[kind]);
                const ready = states[kind] === "ready";
                return (
                    <div key={kind}>
                        <Button
                            variant="outline"
                            className={className}
                            disabled={busy || !ready}
                            title={hint ?? undefined}
                            onClick={async () => {
                                setBusy(true);
                                await sendOnWhatsApp({ ticketId, kind }).finally(() => setBusy(false));
                            }}
                        >
                            <MessageCircle size={15} /> WhatsApp: {WA_TEMPLATE_LABEL[kind]}
                        </Button>
                        {hint && <p className="mt-0.5 text-center text-[10px] text-muted-foreground">{hint}</p>}
                    </div>
                );
            })}
        </>
    );
}
