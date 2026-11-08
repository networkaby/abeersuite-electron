"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { isCustomKind } from "@/shared/lib/whatsapp/billTemplates";

/** One choice in a "which template" dropdown (Workflow statuses / workers). */
export type TemplateOption = { kind: string; name: string; ready: boolean; why: string };

/** Built-in kinds a workflow may also send — they fill device / job no / link
 *  from the repair ticket itself. */
const REPAIR_KINDS: Record<string, string> = { REPAIR_RECEIVED: "Repair received", REPAIR_READY: "Repair ready" };

type Row = { kind: string; name: string | null; enabled: boolean; autoSend?: boolean; approved?: unknown };

/**
 * WhatsApp and email templates for the Workflow pickers, read once when `open`
 * turns true. `withRepair` adds Repair received / Repair ready on top of staff's
 * own templates. A template not ready yet is still listed, with the reason, so
 * a stage can be set up now and the template switched on later.
 */
export function useMessageTemplateOptions(open: boolean, withRepair = false) {
    const [list, setList] = useState<{ wa: TemplateOption[]; email: TemplateOption[] }>({ wa: [], email: [] });
    useEffect(() => {
        if (!open) return;
        const keep = (t: Row) => isCustomKind(t.kind) || (withRepair && t.kind in REPAIR_KINDS);
        const label = (t: Row) => REPAIR_KINDS[t.kind] ?? t.name ?? "Untitled";
        Promise.all([
            axios.get("/api/settings/whatsapp-templates").catch(() => ({ data: { templates: [] as Row[] } })),
            axios.get("/api/settings/email-templates").catch(() => ({ data: { templates: [] as Row[] } })),
        ]).then(([wa, em]) =>
            setList({
                wa: (wa.data.templates as Row[]).filter(keep).map((t) => ({
                    kind: t.kind,
                    name: label(t),
                    ready: t.enabled && !!t.approved,
                    why: !t.approved ? "not approved yet" : "switched off",
                })),
                email: (em.data.templates as Row[]).filter(keep).map((t) => ({
                    kind: t.kind,
                    name: label(t),
                    // A built-in repair email also needs its Auto send on.
                    ready: t.enabled && (isCustomKind(t.kind) || t.autoSend !== false),
                    why: !t.enabled ? "switched off" : "auto send off",
                })),
            }),
        );
    }, [open, withRepair]);
    return list;
}
