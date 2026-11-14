"use client";

// Deal screen → Activity Timeline → WhatsApp tab.
// Inside WhatsApp's 24h window: free text. Outside it (or never wrote): an
// approved template only. API: /api/deals/[id]/whatsapp.

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Send, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { GatedLink } from "@/shared/components/GatedLink";
import { MessageTemplatePicker } from "@/modules/settings/components/MessageTemplatePicker";
import { useMessageTemplateOptions } from "@/modules/settings/hooks/useMessageTemplateOptions";
import { formatDateTime } from "@/shared/lib/format";
import { cn } from "@/shared/lib/format/utils";
import { useNow } from "@/shared/hooks";
import { isCustomKind } from "@/shared/lib/whatsapp/billTemplates";

type WaState = {
    phone: string | null;
    window: { open: boolean; closesAt: string | null };
    recent: { id: number; direction: "IN" | "OUT"; body: string; occurredAt: string }[];
    preview?: string | null;
};

/** A deal has no bill behind it — offer the deal greeting and the shop's own templates only. */
const forDeal = (t: { kind: string }) => t.kind === "DEAL_CREATED" || isCustomKind(t.kind);

function hoursLeft(closesAt: string | null, now: number): string {
    if (!closesAt) return "";
    const h = Math.max(0, (new Date(closesAt).getTime() - now) / 3_600_000);
    return h >= 1 ? `${Math.floor(h)}h left` : `${Math.max(1, Math.round(h * 60))} min left`;
}

export function DealWhatsAppComposer({ dealId, onSent }: { dealId: number; onSent: () => void }) {
    const [state, setState] = useState<{ id: number; data: WaState | null; error?: string }>({ id: 0, data: null });
    const [text, setText] = useState("");
    const [template, setTemplate] = useState("");
    const [preview, setPreview] = useState<{ kind: string; text: string | null } | null>(null);
    const [sending, setSending] = useState(false);
    const [reloadTick, setReloadTick] = useState(0);
    const templates = useMessageTemplateOptions("whatsapp");

    useEffect(() => {
        let alive = true;
        axios.get<WaState>(`/api/deals/${dealId}/whatsapp`)
            .then((r) => { if (alive) setState({ id: dealId, data: r.data }); })
            .catch((e) => { if (alive) setState({ id: dealId, data: null, error: e?.response?.data?.error ?? "Could not load WhatsApp" }); });
        return () => { alive = false; };
    }, [dealId, reloadTick]);

    useEffect(() => {
        if (!template) return;
        let alive = true;
        axios.get<WaState>(`/api/deals/${dealId}/whatsapp`, { params: { preview: template } })
            .then((r) => { if (alive) setPreview({ kind: template, text: r.data.preview ?? null }); })
            .catch(() => { if (alive) setPreview({ kind: template, text: null }); });
        return () => { alive = false; };
    }, [dealId, template]);

    const wa = state.id === dealId ? state.data : null;
    const loadError = state.id === dealId ? state.error : undefined;
    const now = useNow();

    const send = async (payload: { text: string } | { template: string; label?: string }) => {
        setSending(true);
        try {
            await axios.post(`/api/deals/${dealId}/whatsapp`, payload);
            toast.success("WhatsApp sent");
            setText("");
            setTemplate("");
            setPreview(null);
            setReloadTick((t) => t + 1);
            onSent();
        } catch (e) {
            toast.error((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Could not send");
        } finally {
            setSending(false);
        }
    };

    if (!wa) {
        return (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                {loadError ?? <><Loader2 className="size-3.5 animate-spin" /> Loading WhatsApp…</>}
            </div>
        );
    }
    if (!wa.phone) {
        return <p className="py-4 text-center text-xs text-muted-foreground">This deal has no mobile number. Add one with Edit Deal Details.</p>;
    }

    const chatHref = `/office/crm/messages?filter=all&phone=${wa.phone}`;

    return (
        <div className="space-y-2.5">
            {/* Last messages with this customer */}
            {wa.recent.length > 0 && (
                <div className="space-y-1.5 rounded-lg border bg-background p-2.5">
                    {wa.recent.map((m) => (
                        <div key={m.id} className={cn("flex", m.direction === "OUT" ? "justify-end" : "justify-start")}>
                            <div className={cn("max-w-[85%] rounded-lg px-2.5 py-1.5 text-xs",
                                m.direction === "OUT" ? "bg-green-100 text-green-950 dark:bg-green-950/50 dark:text-green-100" : "bg-muted text-foreground")}>
                                <p className="whitespace-pre-wrap break-words line-clamp-4">{m.body}</p>
                                <p className="mt-0.5 text-right text-[10px] text-muted-foreground">{formatDateTime(m.occurredAt)}</p>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <div className="flex items-center justify-between text-[11px]">
                <span className={cn("font-medium", wa.window.open ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400")}>
                    {wa.window.open
                        ? `Reply window open — ${hoursLeft(wa.window.closesAt, now)}`
                        : wa.recent.some((m) => m.direction === "IN")
                            ? "More than 24h since the customer wrote — approved template only"
                            : "Customer has not written yet — approved template only"}
                </span>
                <GatedLink href={chatHref} className="flex items-center gap-1 text-blue-600 hover:underline">
                    Open chat <ExternalLink className="size-3" />
                </GatedLink>
            </div>

            {wa.window.open ? (
                <>
                    <Textarea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        rows={2}
                        placeholder={`WhatsApp message to ${wa.phone}…`}
                        className="min-h-[64px] text-sm bg-background resize-none rounded-lg"
                    />
                    <div className="flex justify-end">
                        <Button size="sm" onClick={() => send({ text })} disabled={sending || !text.trim()} className="gap-1.5 h-8 px-3 bg-green-600 hover:bg-green-700 text-white">
                            {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                            <span>{sending ? "Sending…" : "Send WhatsApp"}</span>
                        </Button>
                    </div>
                </>
            ) : (
                <>
                    <MessageTemplatePicker channel="whatsapp" value={template} onChange={setTemplate} noneLabel="— pick a template —" filter={forDeal} className="h-9 bg-background text-sm" />
                    {template && (
                        <div className="rounded-lg border bg-background p-2.5 text-xs whitespace-pre-wrap text-foreground">
                            {preview?.kind !== template
                                ? <span className="text-muted-foreground">Loading preview…</span>
                                : preview.text ?? <span className="text-muted-foreground">No preview — template is not approved or switched off.</span>}
                        </div>
                    )}
                    <div className="flex justify-end">
                        <Button
                            size="sm"
                            onClick={() => send({ template, label: templates.find((t) => t.kind === template)?.name })}
                            disabled={sending || !template || !preview?.text}
                            className="gap-1.5 h-8 px-3 bg-green-600 hover:bg-green-700 text-white"
                        >
                            {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                            <span>{sending ? "Sending…" : "Send template"}</span>
                        </Button>
                    </div>
                </>
            )}
        </div>
    );
}
