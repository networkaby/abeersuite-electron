"use client";

// Campaigns → Due Reminders. The automation switch, the age/amount rules, the
// customers who are never reminded, a preview of each message and the recent
// sends. One Save writes the whole page (PUT /api/due-reminders/settings).

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { toast } from "sonner";
import { Eye, Loader2, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { NumericInput } from "@/shared/components/NumericInput";
import { extractApiError } from "@/shared/lib/api";
import { fmt } from "@/shared/lib/format/moneyInr";
import { usePartySearch } from "@/shared/hooks/usePartySearch";
import { WA_TEMPLATE_DEFAULTS, WA_TEMPLATE_LABEL } from "@/shared/lib/whatsapp/billTemplates";
import {
    ACTION_LABEL,
    MODE_LABEL,
    WEEKDAYS,
    waStatusText,
    type ReminderAction,
    type ReminderLogRow,
    type ReminderRule,
    type ReminderSettings,
    type ReminderTone,
} from "@/shared/lib/whatsapp/dueReminderTypes";
import { ReminderPreview, type ReminderParty } from "@/modules/accountancy/components/reminders/SendReminderDialog";

const card = "rounded-lg border bg-card p-4 shadow-sm space-y-3";

/** Stand-in customer for the previews on this page. */
const SAMPLE_PARTY: ReminderParty = { accountId: 0, name: "Rahul Sharma", balance: 4250, oldestBillDate: "2026-08-12", oldestDays: 56 };

const TEMPLATE_OF: Record<ReminderTone, "DUE_SOFT" | "DUE_FIRM"> = { SOFT: "DUE_SOFT", FIRM: "DUE_FIRM" };

type RuleDraft = { name: string; minDays: string; minAmount: string; repeatDays: string; action: ReminderAction };

const toDraft = (r: ReminderRule): RuleDraft => ({
    name: r.name, minDays: String(r.minDays), minAmount: String(r.minAmount), repeatDays: String(r.repeatDays), action: r.action,
});

export function DueRemindersPanel() {
    const [loaded, setLoaded] = useState<ReminderSettings | null>(null);
    const [log, setLog] = useState<ReminderLogRow[]>([]);
    const [saving, setSaving] = useState(false);

    const [enabled, setEnabled] = useState(false);
    const [sendTime, setSendTime] = useState("10:00");
    const [skipDays, setSkipDays] = useState<number[]>([]);
    const [dailyCap, setDailyCap] = useState("50");
    const [minBalance, setMinBalance] = useState("100");
    const [minPctAuto, setMinPctAuto] = useState("0");
    const [minPctCredit, setMinPctCredit] = useState("0");
    const [rules, setRules] = useState<ReminderRule[]>([]);
    const [excluded, setExcluded] = useState<{ accountId: number; name: string }[]>([]);
    // Rule being edited (id) or added (0), with its draft values.
    const [editing, setEditing] = useState<{ id: number; draft: RuleDraft } | null>(null);
    const [excludeText, setExcludeText] = useState("");
    const [previewTone, setPreviewTone] = useState<ReminderTone>("SOFT");
    const [previewRule, setPreviewRule] = useState<ReminderRule | null>(null);
    // A new rule gets a negative id until saved — the server creates it.
    const [nextTempId, setNextTempId] = useState(-1);

    const apply = (s: ReminderSettings) => {
        setLoaded(s);
        setEnabled(s.enabled);
        setSendTime(s.sendTime);
        setSkipDays(s.skipDays);
        setDailyCap(String(s.dailyCap));
        setMinBalance(String(s.minBalance));
        setMinPctAuto(String(s.minPctAutoLimit ?? 0));
        setMinPctCredit(String(s.minPctCreditLimit ?? 0));
        setRules(s.rules);
        setExcluded(s.excluded);
    };

    useEffect(() => {
        axios.get<{ settings: ReminderSettings; log: ReminderLogRow[] }>("/api/due-reminders/settings")
            .then((r) => { apply(r.data.settings); setLog(r.data.log); })
            .catch((e) => toast.error(extractApiError(e, "Could not load Due Reminders")));
    }, []);
    // Only the send log follows changes — the settings above are the form being edited.
    useRealtimeTopics(["settings", "ledger"], () => {
        axios.get<{ log: ReminderLogRow[] }>("/api/due-reminders/settings")
            .then((r) => setLog(r.data.log))
            .catch(() => {});
    });

    const { hits } = usePartySearch(excludeText, { group: "Sundry Debtors" });
    const addExcluded = (accountId: number | null, name: string) => {
        if (accountId == null) { toast.error("This party has no ledger."); return; }
        setExcluded((c) => (c.some((x) => x.accountId === accountId) ? c : [...c, { accountId, name }]));
        setExcludeText("");
    };

    const saveRule = () => {
        if (!editing) return;
        const d = editing.draft;
        if (!d.name.trim()) { toast.error("Give the rule a name."); return; }
        const id = editing.id || nextTempId;
        if (!editing.id) setNextTempId((n) => n - 1);
        const rule: ReminderRule = {
            id,
            name: d.name.trim(),
            minDays: Number(d.minDays) || 0,
            minAmount: Number(d.minAmount) || 0,
            repeatDays: Number(d.repeatDays) || 0,
            action: d.action,
            enabled: rules.find((r) => r.id === editing.id)?.enabled ?? true,
        };
        setRules((cur) => editing.id ? cur.map((r) => (r.id === editing.id ? rule : r)) : [...cur, rule]);
        setEditing(null);
    };

    const save = async () => {
        if (editing) { toast.error("Save or cancel the rule you are editing first."); return; }
        setSaving(true);
        try {
            const { data } = await axios.put<{ settings: ReminderSettings }>("/api/due-reminders/settings", {
                enabled,
                sendTime,
                skipDays,
                dailyCap: Math.max(1, Number(dailyCap) || 1),
                minBalance: Number(minBalance) || 0,
                minPctAutoLimit: Math.min(1000, Number(minPctAuto) || 0),
                minPctCreditLimit: Math.min(1000, Number(minPctCredit) || 0),
                excludedAccountIds: excluded.map((x) => x.accountId),
                rules,
            });
            apply(data.settings);
            toast.success("Due Reminders saved");
        } catch (e) {
            toast.error(extractApiError(e, "Could not save"));
        } finally {
            setSaving(false);
        }
    };

    const setDraft = (patch: Partial<RuleDraft>) =>
        setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...patch } } : e));

    if (!loaded) {
        return <div className="flex justify-center py-16"><Loader2 className="animate-spin text-muted-foreground" size={28} /></div>;
    }

    const templateCell = (action: ReminderAction) =>
        action === "CALL_LIST"
            ? <span className="text-xs text-muted-foreground">No message</span>
            : <Link href="/office/settings/whatsapp-templates" className="text-xs text-primary hover:underline">{WA_TEMPLATE_LABEL[TEMPLATE_OF[action]]}</Link>;

    const ruleEditor = editing && (
        <tr className="border-b bg-muted/30">
            <td className="px-2 py-1.5"><Input className="h-8" value={editing.draft.name} onChange={(e) => setDraft({ name: e.target.value })} placeholder="Rule name" /></td>
            <td className="px-2 py-1.5"><NumericInput className="h-8 w-20" value={editing.draft.minDays} onValueChange={(v) => setDraft({ minDays: v })} min={0} max={3650} /></td>
            <td className="px-2 py-1.5"><NumericInput className="h-8 w-24" mode="decimal" value={editing.draft.minAmount} onValueChange={(v) => setDraft({ minAmount: v })} min={0} /></td>
            <td className="px-2 py-1.5"><NumericInput className="h-8 w-20" value={editing.draft.repeatDays} onValueChange={(v) => setDraft({ repeatDays: v })} min={0} max={365} /></td>
            <td className="px-2 py-1.5">
                <select
                    className="h-8 rounded-md border bg-background px-2 text-sm"
                    value={editing.draft.action}
                    onChange={(e) => setDraft({ action: e.target.value as ReminderAction })}
                >
                    {(Object.keys(ACTION_LABEL) as ReminderAction[]).map((a) => <option key={a} value={a}>{ACTION_LABEL[a]}</option>)}
                </select>
            </td>
            <td className="px-2 py-1.5">{templateCell(editing.draft.action)}</td>
            <td className="px-2 py-1.5" colSpan={2}>
                <div className="flex justify-end gap-1">
                    <Button size="sm" onClick={saveRule}><Save size={14} /> OK</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}><X size={14} /></Button>
                </div>
            </td>
        </tr>
    );

    return (
        <div className="space-y-4">
            {/* Master switch and timing */}
            <section className={card}>
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <h2 className="font-semibold">Automatic reminders</h2>
                        <p className="text-xs text-muted-foreground">
                            Once a day, at or after the send time, the rules below are checked and each matching customer gets at most one message.
                            {loaded.lastRunDate && <> Last run: {loaded.lastRunDate}.</>}
                        </p>
                    </div>
                    <Switch checked={enabled} onCheckedChange={setEnabled} />
                </div>
                <div className="grid gap-3 sm:grid-cols-4">
                    <div className="space-y-1">
                        <Label>Send time</Label>
                        <Input type="time" value={sendTime} onChange={(e) => setSendTime(e.target.value || "10:00")} className="w-32" />
                    </div>
                    <div className="space-y-1">
                        <Label>Max messages a day</Label>
                        <NumericInput value={dailyCap} onValueChange={setDailyCap} min={1} max={1000} className="w-32" />
                    </div>
                    <div className="space-y-1">
                        <Label>Skip balance below (₹)</Label>
                        <NumericInput mode="decimal" value={minBalance} onValueChange={setMinBalance} min={0} className="w-32" />
                    </div>
                    <div className="space-y-1">
                        <Label>Skip below % of auto credit limit</Label>
                        <NumericInput value={minPctAuto} onValueChange={setMinPctAuto} min={0} max={1000} className="w-32" />
                        <p className="text-[11px] text-muted-foreground">0 = off. Only when auto limit is on.</p>
                    </div>
                    <div className="space-y-1">
                        <Label>Skip below % of credit limit</Label>
                        <NumericInput value={minPctCredit} onValueChange={setMinPctCredit} min={0} max={1000} className="w-32" />
                        <p className="text-[11px] text-muted-foreground">0 = off. Customers with no limit are not skipped.</p>
                    </div>
                    <div className="space-y-1">
                        <Label>Don&apos;t send on</Label>
                        <div className="flex flex-wrap gap-1">
                            {WEEKDAYS.map((d, i) => {
                                const on = skipDays.includes(i);
                                return (
                                    <button
                                        key={d}
                                        type="button"
                                        onClick={() => setSkipDays((cur) => (on ? cur.filter((x) => x !== i) : [...cur, i]))}
                                        className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                                            on ? "border-red-400 bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200" : "text-muted-foreground hover:bg-muted"
                                        }`}
                                    >
                                        {d}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </section>

            {/* Rules */}
            <section className={card}>
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="font-semibold">Rules</h2>
                        <p className="text-xs text-muted-foreground">
                            Age is counted from the oldest unpaid bill. When several rules match, the strongest wins. &quot;Once&quot; sends one time until the balance is cleared.
                        </p>
                    </div>
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={editing != null}
                        onClick={() => setEditing({ id: 0, draft: { name: "", minDays: "15", minAmount: "1000", repeatDays: "0", action: "SOFT" } })}
                    >
                        <Plus size={14} /> Add rule
                    </Button>
                </div>
                <table className="w-full text-sm">
                    <thead className="border-b text-xs text-muted-foreground">
                        <tr>
                            <th className="px-2 py-1.5 text-left font-medium">Rule</th>
                            <th className="px-2 py-1.5 text-left font-medium">Oldest bill ≥ days</th>
                            <th className="px-2 py-1.5 text-left font-medium">Balance ≥ ₹</th>
                            <th className="px-2 py-1.5 text-left font-medium">Repeat every</th>
                            <th className="px-2 py-1.5 text-left font-medium">Action</th>
                            <th className="px-2 py-1.5 text-left font-medium">Template</th>
                            <th className="px-2 py-1.5 text-center font-medium">On</th>
                            <th className="px-2 py-1.5 w-24" />
                        </tr>
                    </thead>
                    <tbody>
                        {rules.map((r) => editing?.id === r.id ? <Fragment key={r.id}>{ruleEditor}</Fragment> : (
                            <tr key={r.id} className={`border-b last:border-0 ${r.enabled ? "" : "opacity-50"}`}>
                                <td className="px-2 py-1.5 font-medium">{r.name}</td>
                                <td className="px-2 py-1.5">{r.minDays} days</td>
                                <td className="px-2 py-1.5 font-mono">₹{fmt(r.minAmount)}</td>
                                <td className="px-2 py-1.5">{r.repeatDays ? `${r.repeatDays} days` : "Once"}</td>
                                <td className="px-2 py-1.5">{ACTION_LABEL[r.action]}</td>
                                <td className="px-2 py-1.5">{templateCell(r.action)}</td>
                                <td className="px-2 py-1.5 text-center">
                                    <Switch
                                        checked={r.enabled}
                                        onCheckedChange={(v) => setRules((cur) => cur.map((x) => (x.id === r.id ? { ...x, enabled: v } : x)))}
                                    />
                                </td>
                                <td className="px-2 py-1.5">
                                    <div className="flex justify-end gap-1">
                                        {r.action !== "CALL_LIST" && (
                                            <button type="button" title="Preview message" className="rounded p-1 text-muted-foreground hover:bg-muted" onClick={() => setPreviewRule(r)}>
                                                <Eye size={14} />
                                            </button>
                                        )}
                                        <button type="button" title="Edit" disabled={editing != null} className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-40" onClick={() => setEditing({ id: r.id, draft: toDraft(r) })}>
                                            <Pencil size={14} />
                                        </button>
                                        <button type="button" title="Delete" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-red-600" onClick={() => setRules((cur) => cur.filter((x) => x.id !== r.id))}>
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {editing?.id === 0 && ruleEditor}
                        {rules.length === 0 && !editing && (
                            <tr><td colSpan={8} className="py-6 text-center text-muted-foreground">No rules — automatic reminders will send nothing.</td></tr>
                        )}
                    </tbody>
                </table>
            </section>

            {/* Message preview */}
            <section className={card}>
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <h2 className="font-semibold">Message preview</h2>
                        <p className="text-xs text-muted-foreground">
                            Default wording with a sample customer. Change it on{" "}
                            <Link href="/office/settings/whatsapp-templates" className="text-primary hover:underline">WhatsApp Templates</Link>{" "}
                            and send it to Meta for approval — WhatsApp goes only once approved; the app notification goes regardless.
                        </p>
                    </div>
                    <div className="flex shrink-0 gap-1 rounded-md border p-1">
                        {(["SOFT", "FIRM"] as ReminderTone[]).map((t) => (
                            <button
                                key={t}
                                type="button"
                                onClick={() => setPreviewTone(t)}
                                className={`rounded px-3 py-0.5 text-xs font-medium ${previewTone === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                            >
                                {t === "SOFT" ? "Soft" : "Firm"}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="max-w-md">
                    <ReminderPreview body={WA_TEMPLATE_DEFAULTS[TEMPLATE_OF[previewTone]].body} party={SAMPLE_PARTY} />
                </div>
            </section>

            {/* Excluded customers */}
            <section className={card}>
                <div>
                    <h2 className="font-semibold">Never remind</h2>
                    <p className="text-xs text-muted-foreground">Relatives, VIPs, government offices — skipped by automation and by Send to all. A reminder sent by hand still goes.</p>
                </div>
                <div className="relative max-w-sm">
                    <Input value={excludeText} onChange={(e) => setExcludeText(e.target.value)} placeholder="Search customer…" className="h-8" />
                    {hits.length > 0 && (
                        <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover shadow-md">
                            {hits.map((h) => (
                                <li key={`${h.type}-${h.id}`}>
                                    <button
                                        type="button"
                                        className="flex w-full justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted"
                                        onClick={() => addExcluded(h.accountId, h.name)}
                                    >
                                        <span>{h.name}</span>
                                        <span className="text-xs text-muted-foreground">{h.phone}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                    {excluded.map((x) => (
                        <span key={x.accountId} className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2.5 py-0.5 text-xs">
                            {x.name}
                            <button type="button" title="Remove" onClick={() => setExcluded((c) => c.filter((y) => y.accountId !== x.accountId))}><X size={12} /></button>
                        </span>
                    ))}
                    {excluded.length === 0 && <span className="text-xs text-muted-foreground">Nobody excluded.</span>}
                </div>
            </section>

            <div className="flex justify-end">
                <Button onClick={save} disabled={saving}>
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save settings
                </Button>
            </div>

            {/* Recent sends */}
            <section className={card}>
                <h2 className="font-semibold">Recent reminders</h2>
                <table className="w-full text-sm">
                    <thead className="border-b text-xs text-muted-foreground">
                        <tr>
                            <th className="px-2 py-1.5 text-left font-medium">When</th>
                            <th className="px-2 py-1.5 text-left font-medium">Customer</th>
                            <th className="px-2 py-1.5 text-right font-medium">Amount</th>
                            <th className="px-2 py-1.5 text-left font-medium">How</th>
                            <th className="px-2 py-1.5 text-left font-medium">Action</th>
                            <th className="px-2 py-1.5 text-left font-medium">WhatsApp</th>
                            <th className="px-2 py-1.5 text-left font-medium">App</th>
                        </tr>
                    </thead>
                    <tbody>
                        {log.map((l) => (
                            <tr key={l.id} className="border-b last:border-0">
                                <td className="px-2 py-1.5 text-xs text-muted-foreground">{new Date(l.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</td>
                                <td className="px-2 py-1.5">{l.party}</td>
                                <td className="px-2 py-1.5 text-right font-mono">₹{fmt(l.amount)}</td>
                                <td className="px-2 py-1.5 text-xs">{MODE_LABEL[l.mode]}</td>
                                <td className="px-2 py-1.5 text-xs">{ACTION_LABEL[l.action]}</td>
                                <td
                                    className={`px-2 py-1.5 text-xs font-medium ${l.waStatus === "failed" ? "text-red-600" : l.waStatus === "sent" ? "text-emerald-600" : "text-muted-foreground"}`}
                                    title={l.waError ?? undefined}
                                >
                                    {waStatusText(l.waStatus)}
                                </td>
                                <td className="px-2 py-1.5 text-xs text-muted-foreground">{l.pushStatus}</td>
                            </tr>
                        ))}
                        {log.length === 0 && (
                            <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">No reminders sent yet.</td></tr>
                        )}
                    </tbody>
                </table>
            </section>

            <Dialog open={previewRule != null} onOpenChange={(v) => { if (!v) setPreviewRule(null); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{previewRule?.name} — message preview</DialogTitle>
                    </DialogHeader>
                    {previewRule && previewRule.action !== "CALL_LIST" && (
                        <>
                            <p className="text-xs text-muted-foreground">
                                Template: {WA_TEMPLATE_LABEL[TEMPLATE_OF[previewRule.action]]} · sample customer
                            </p>
                            <ReminderPreview body={WA_TEMPLATE_DEFAULTS[TEMPLATE_OF[previewRule.action]].body} party={SAMPLE_PARTY} />
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
