"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { extractApiError } from "@/shared/lib/api";
import { getWithRetry } from "@/shared/lib/http/getWithRetry";
import {
    DEFAULT_TRACKING_CODES,
    TRACKING_ID_PATTERNS,
    type TrackingCodes,
} from "@/shared/lib/shop/trackingCodes";

type IdKey = keyof typeof TRACKING_ID_PATTERNS;
type EnabledKey = "ga4Enabled" | "gtmEnabled" | "metaPixelEnabled" | "tiktokPixelEnabled";

const ID_ROWS: { label: string; hint: string; enabled: EnabledKey; id: IdKey; placeholder: string }[] = [
    { label: "Google Analytics 4", hint: "Measurement ID from GA4 → Admin → Data streams.", enabled: "ga4Enabled", id: "ga4Id", placeholder: "G-XXXXXXXXXX" },
    { label: "Google Tag Manager", hint: "Container ID from the top of Tag Manager.", enabled: "gtmEnabled", id: "gtmId", placeholder: "GTM-XXXXXXX" },
    { label: "Meta (Facebook) Pixel", hint: "Pixel ID from Events Manager — numbers only.", enabled: "metaPixelEnabled", id: "metaPixelId", placeholder: "123456789012345" },
    { label: "TikTok Pixel", hint: "Pixel ID from TikTok Ads → Events.", enabled: "tiktokPixelEnabled", id: "tiktokPixelId", placeholder: "CXXXXXXXXXXXXXXXXXXX" },
];

export function TrackingCodesForm() {
    const [codes, setCodes] = useState<TrackingCodes>(DEFAULT_TRACKING_CODES);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        getWithRetry<TrackingCodes>("/api/settings/tracking-codes")
            .then(setCodes)
            .catch((e) => toast.error(extractApiError(e, "Could not load tracking codes")))
            .finally(() => setLoading(false));
    }, []);

    const set = <K extends keyof TrackingCodes>(k: K, v: TrackingCodes[K]) => setCodes((c) => ({ ...c, [k]: v }));

    /** An id that is filled in but not in its right shape — shown before save. */
    const badId = (k: IdKey) => {
        const v = codes[k].trim().toUpperCase();
        return v !== "" && !TRACKING_ID_PATTERNS[k].test(v);
    };

    const save = async () => {
        setSaving(true);
        try {
            const { data } = await axios.put<TrackingCodes>("/api/settings/tracking-codes", codes);
            setCodes(data);
            toast.success("Tracking codes saved — the shop picks them up within a minute");
        } catch (e) {
            toast.error(extractApiError(e, "Save failed"));
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading…</div>;
    }

    return (
        <div className="max-w-2xl space-y-5">
            {ID_ROWS.map((r) => (
                <div key={r.id} className="rounded-lg border border-border bg-card p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                        <Label htmlFor={`tc-${r.id}`} className="font-medium">{r.label}</Label>
                        <Switch checked={codes[r.enabled]} onCheckedChange={(on) => set(r.enabled, on)} />
                    </div>
                    <Input
                        id={`tc-${r.id}`}
                        value={codes[r.id]}
                        placeholder={r.placeholder}
                        onChange={(e) => set(r.id, e.target.value)}
                        className="font-mono"
                    />
                    <p className={`text-xs ${badId(r.id) ? "text-destructive" : "text-muted-foreground"}`}>
                        {badId(r.id) ? `This does not look like a ${r.label} ID — paste only the ID, not the whole script.` : r.hint}
                    </p>
                </div>
            ))}

            <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                    <Label className="font-medium">Custom code</Label>
                    <Switch checked={codes.customEnabled} onCheckedChange={(on) => set("customEnabled", on)} />
                </div>
                <p className="text-xs text-muted-foreground">
                    For any other tool (Hotjar, Clarity, LinkedIn…). Paste the full snippet it gives you. Runs on every shop page — only paste code from a service you trust.
                </p>
                <div className="space-y-1.5">
                    <Label htmlFor="tc-head" className="text-xs">Inside &lt;head&gt;</Label>
                    <Textarea id="tc-head" rows={5} className="font-mono text-xs" value={codes.customHead} onChange={(e) => set("customHead", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor="tc-body" className="text-xs">End of &lt;body&gt;</Label>
                    <Textarea id="tc-body" rows={5} className="font-mono text-xs" value={codes.customBody} onChange={(e) => set("customBody", e.target.value)} />
                </div>
            </div>

            <Button onClick={save} disabled={saving || ID_ROWS.some((r) => badId(r.id))}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save
            </Button>
        </div>
    );
}
