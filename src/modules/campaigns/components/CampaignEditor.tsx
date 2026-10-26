"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Bell, CalendarClock, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SearchableSelect } from "@/shared/components/SearchableSelect";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { confirmAction } from "@/shared/lib/ui/confirmStore";
import {
    CAMPAIGN_AUDIENCES,
    CAMPAIGN_BODY_MAX,
    CAMPAIGN_CHANNELS,
    CAMPAIGN_TITLE_MAX,
    campaignBody,
    scheduleTimeError,
    toLocalInput,
    type CampaignInput,
    type CampaignRow,
} from "@/modules/campaigns/lib/campaign";

type Options = {
    coupons: { id: number; code: string | null; name: string; endsAt: string | null }[];
    audience: Record<string, { devices: number; customers: number }>;
};

type Form = Omit<CampaignInput, "url"> & { url: string };

const blank: Form = { name: "", channel: "PUSH", title: "", body: "", url: "", couponId: null, audience: "ALL_PUSH", status: "DRAFT" };

const fromRow = (c: CampaignRow): Form => ({
    name: c.name,
    channel: "PUSH",
    title: c.title,
    body: c.body,
    url: c.url ?? "",
    couponId: c.couponId,
    audience: "ALL_PUSH",
    status: c.status === "READY" ? "READY" : "DRAFT",
});

/** Write / edit one campaign, with a phone-style preview of the notification. */
export default function CampaignEditor({
    campaign,
    canSend,
    onClose,
    onSaved,
}: {
    campaign: CampaignRow | null;
    canSend: boolean;
    onClose: () => void;
    onSaved: () => void;
}) {
    const [form, setForm] = useState<Form>(campaign ? fromRow(campaign) : blank);
    const [options, setOptions] = useState<Options | null>(null);
    const [saving, setSaving] = useState(false);
    const sent = campaign?.status === "SENT";
    const scheduled = campaign?.status === "SCHEDULED";
    const [when, setWhen] = useState(toLocalInput(campaign?.scheduledAt ?? null));

    useEffect(() => {
        axios
            .get<Options>("/api/campaigns/options")
            .then((r) => setOptions(r.data))
            .catch((e) => toast.error(extractApiError(e, "Failed to load coupons")));
    }, []);

    const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

    // A coupon picked earlier that has since ended still shows, by its saved name.
    const saved = campaign?.coupon;
    const couponOptions = [
        ...(options?.coupons ?? []).map((c) => ({ value: c.id, label: `${c.code} — ${c.name}`, searchText: `${c.code} ${c.name}` })),
        ...(saved && options && !options.coupons.some((c) => c.id === saved.id)
            ? [{ value: saved.id, label: `${saved.code ?? ""} — ${saved.name} (no longer active)` }]
            : []),
    ];
    const reach = options?.audience[form.audience];
    const couponCode = options?.coupons.find((c) => c.id === form.couponId)?.code ?? (saved?.id === form.couponId ? saved.code : null) ?? null;

    async function save() {
        setSaving(true);
        try {
            if (campaign) await axios.patch(`/api/campaigns/${campaign.id}`, form);
            else await axios.post("/api/campaigns", form);
            toast.success("Campaign saved");
            onSaved();
        } catch (e) {
            toast.error(extractApiError(e, "Failed to save the campaign"));
        } finally {
            setSaving(false);
        }
    }

    /** Saves the latest wording first, then sends — what is on screen is what goes. */
    async function send() {
        if (!campaign) return;
        const who = reach ? `${reach.customers} customers (${reach.devices} phones / browsers)` : "every customer with notifications on";
        const ok = await confirmAction({
            title: `Send "${form.title}" now?`,
            body: `It goes to ${who} at once and cannot be taken back.`,
            confirmLabel: "Send",
        });
        if (!ok) return;
        setSaving(true);
        try {
            await axios.patch(`/api/campaigns/${campaign.id}`, form);
            await axios.post(`/api/campaigns/${campaign.id}/send`);
            toast.success("Sending now — results fill in over the next few minutes");
            onSaved();
        } catch (e) {
            toast.error(extractApiError(e, "Failed to send the campaign"));
        } finally {
            setSaving(false);
        }
    }

    /** Saves the latest wording, then puts it on the schedule (or moves its time). */
    async function schedule() {
        if (!campaign) return;
        const at = new Date(when);
        const bad = scheduleTimeError(at);
        if (bad) return void toast.error(bad);
        setSaving(true);
        try {
            await axios.patch(`/api/campaigns/${campaign.id}`, form);
            await axios.post(`/api/campaigns/${campaign.id}/schedule`, { at: at.toISOString() });
            toast.success(`Scheduled for ${at.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`);
            onSaved();
        } catch (e) {
            toast.error(extractApiError(e, "Failed to schedule the campaign"));
        } finally {
            setSaving(false);
        }
    }

    async function unschedule() {
        if (!campaign) return;
        setSaving(true);
        try {
            await axios.post(`/api/campaigns/${campaign.id}/schedule`, { at: null });
            toast.success("Taken off the schedule");
            onSaved();
        } catch (e) {
            toast.error(extractApiError(e, "Failed to cancel the schedule"));
        } finally {
            setSaving(false);
        }
    }

    async function remove() {
        if (!campaign) return;
        if (!(await confirmAction({ title: `Delete "${campaign.name}"?`, body: "This cannot be undone.", confirmLabel: "Delete" }))) return;
        try {
            await axios.delete(`/api/campaigns/${campaign.id}`);
            toast.success("Campaign deleted");
            onSaved();
        } catch (e) {
            toast.error(extractApiError(e, "Failed to delete the campaign"));
        }
    }

    return (
        <Dialog open onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>{campaign ? campaign.name : "New campaign"}</DialogTitle>
                    <DialogDescription>
                        {sent
                            ? "This campaign was sent and is kept as history."
                            : scheduled
                              ? `Scheduled for ${new Date(campaign!.scheduledAt!).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} — edits keep the time.`
                              : "Save it as a draft, send it now, or schedule it for later."}
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-6 md:grid-cols-[1fr_260px]">
                    <fieldset disabled={sent} className="min-w-0 space-y-4">
                        <div className="space-y-1.5">
                            <Label htmlFor="cmp-name">Campaign name (staff only)</Label>
                            <Input id="cmp-name" value={form.name} maxLength={120} placeholder="Diwali 2026 greeting" onChange={(e) => set("name", e.target.value)} />
                        </div>

                        <div className="space-y-1.5">
                            <Label>Send as</Label>
                            <div className="flex flex-wrap gap-2">
                                {CAMPAIGN_CHANNELS.map((ch) => (
                                    <button
                                        key={ch.value}
                                        type="button"
                                        disabled={!ch.ready}
                                        onClick={() => set("channel", "PUSH")}
                                        className={`rounded-lg border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60 ${
                                            form.channel === ch.value ? "border-primary bg-primary/10 font-medium" : "text-muted-foreground"
                                        }`}
                                    >
                                        {ch.label}
                                        {!ch.ready && <span className="ml-1 text-xs">· coming later</span>}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <div className="flex justify-between">
                                <Label htmlFor="cmp-title">Title</Label>
                                <span className="text-xs text-muted-foreground">
                                    {form.title.length}/{CAMPAIGN_TITLE_MAX}
                                </span>
                            </div>
                            <Input
                                id="cmp-title"
                                value={form.title}
                                maxLength={CAMPAIGN_TITLE_MAX}
                                placeholder="Happy Diwali from Network Service!"
                                onChange={(e) => set("title", e.target.value)}
                            />
                        </div>

                        <div className="space-y-1.5">
                            <div className="flex justify-between">
                                <Label htmlFor="cmp-body">Message</Label>
                                <span className="text-xs text-muted-foreground">
                                    {form.body.length}/{CAMPAIGN_BODY_MAX}
                                </span>
                            </div>
                            <Textarea id="cmp-body" rows={4} value={form.body} maxLength={CAMPAIGN_BODY_MAX} onChange={(e) => set("body", e.target.value)} />
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="cmp-url">Tap opens (optional)</Label>
                            <Input id="cmp-url" value={form.url} maxLength={300} placeholder="/shop" onChange={(e) => set("url", e.target.value)} />
                            <p className="text-xs text-muted-foreground">A page on the shop site, like /shop or /portal/coupons. Empty opens the app home.</p>
                        </div>

                        <div className="space-y-1.5">
                            <Label>Coupon to carry (optional)</Label>
                            <SearchableSelect<number>
                                value={form.couponId}
                                options={couponOptions}
                                onChange={(v) => set("couponId", v)}
                                placeholder="— no coupon —"
                                ariaLabel="Coupon"
                            />
                            <p className="text-xs text-muted-foreground">Only active coupons with a code. Coupons are made and changed in Retention → Coupons.</p>
                        </div>

                        <div className="space-y-1.5">
                            <Label>Who gets it</Label>
                            <p className="text-sm">{CAMPAIGN_AUDIENCES.find((a) => a.value === form.audience)?.label}</p>
                            <p className="text-xs text-muted-foreground">
                                {reach ? `${reach.customers} customers on ${reach.devices} phones / browsers right now` : "Counting…"}
                            </p>
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="cmp-when">Schedule for (optional)</Label>
                            <div className="flex flex-wrap items-center gap-2">
                                <Input id="cmp-when" type="datetime-local" className="w-auto" value={when} onChange={(e) => setWhen(e.target.value)} />
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={schedule}
                                    disabled={saving || !campaign || !canSend || !when}
                                    title={!campaign ? "Save it first" : !canSend ? "Needs the Send campaigns tick" : undefined}
                                >
                                    <CalendarClock className="mr-1.5 h-4 w-4" /> {scheduled ? "Move to this time" : "Schedule"}
                                </Button>
                                {scheduled && (
                                    <Button type="button" variant="ghost" onClick={unschedule} disabled={saving || !canSend}>
                                        Cancel schedule
                                    </Button>
                                )}
                            </div>
                            <p className="text-xs text-muted-foreground">Goes out at the first half-hourly run on or after this time. Between 8:00 am and 8:00 pm.</p>
                        </div>

                        {!scheduled && (
                        <label className="flex items-center gap-2 text-sm">
                            <Checkbox checked={form.status === "READY"} onCheckedChange={(v) => set("status", v === true ? "READY" : "DRAFT")} />
                            Ready to send (checked by the writer)
                        </label>
                        )}
                    </fieldset>

                    <div>
                        <Label className="mb-1.5 block">Preview</Label>
                        <div className="rounded-2xl bg-slate-800 p-3 shadow-inner">
                            <div className="rounded-xl bg-white p-3 text-slate-900 shadow">
                                <div className="mb-1 flex items-center gap-1.5 text-[11px] text-slate-500">
                                    <Bell size={11} /> Network Service · now
                                </div>
                                <p className="text-sm font-semibold leading-snug">{form.title || "Title"}</p>
                                <p className="whitespace-pre-line text-[13px] leading-snug text-slate-700">
                                    {form.body ? campaignBody(form.body, couponCode) : "Your message shows here."}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                <DialogFooter className="gap-2 sm:justify-between">
                    <div>
                        {campaign && !sent && (
                            <Button variant="ghost" className="text-destructive" onClick={remove}>
                                <Trash2 className="mr-1.5 h-4 w-4" /> Delete
                            </Button>
                        )}
                    </div>
                    <div className="flex gap-2">
                        {!sent && (
                            <Button
                                variant="outline"
                                onClick={send}
                                disabled={saving || !campaign || !canSend}
                                title={!campaign ? "Save it first" : !canSend ? "Needs the Send campaigns tick" : undefined}
                            >
                                <Send className="mr-1.5 h-4 w-4" /> Send now
                            </Button>
                        )}
                        {!sent && (
                            <Button onClick={save} disabled={saving}>
                                {saving ? "Saving…" : "Save"}
                            </Button>
                        )}
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
