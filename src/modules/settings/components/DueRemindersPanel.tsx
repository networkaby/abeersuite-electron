"use client";

// Settings → Due Reminders. The automation switch, the age/amount rules, the
// customers who are never reminded and the recent sends. UI-first phase: all
// of it is local state over sample data — nothing is saved or sent yet.

import { Fragment, useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { NumericInput } from "@/shared/components/NumericInput";
import { fmt } from "@/shared/lib/format/moneyInr";
import {
    ACTION_LABEL,
    SAMPLE_LOG,
    SAMPLE_RULES,
    TONE_LABEL,
    WEEKDAYS,
    type ReminderAction,
    type ReminderRule,
} from "@/modules/accountancy/components/reminders/sampleData";

const card = "rounded-lg border bg-card p-4 shadow-sm space-y-3";

type RuleDraft = { name: string; minDays: string; minAmount: string; repeatDays: string; action: ReminderAction };

const toDraft = (r: ReminderRule): RuleDraft => ({
    name: r.name, minDays: String(r.minDays), minAmount: String(r.minAmount), repeatDays: String(r.repeatDays), action: r.action,
});

export function DueRemindersPanel() {
    const [enabled, setEnabled] = useState(false);
    const [sendTime, setSendTime] = useState("10:00");
    const [skipDays, setSkipDays] = useState<number[]>([5]);
    const [dailyCap, setDailyCap] = useState("50");
    const [rules, setRules] = useState(SAMPLE_RULES);
    // Rule being edited (id) or added (0), with its draft values.
    const [editing, setEditing] = useState<{ id: number; draft: RuleDraft } | null>(null);
    const [excluded, setExcluded] = useState<string[]>(["Abdul Karim (relative)", "Block Office, Govt."]);
    const [excludeText, setExcludeText] = useState("");

    const saveRule = () => {
        if (!editing) return;
        const d = editing.draft;
        if (!d.name.trim()) { toast.error("Give the rule a name."); return; }
        const rule: ReminderRule = {
            id: editing.id || Math.max(0, ...rules.map((r) => r.id)) + 1,
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

    const setDraft = (patch: Partial<RuleDraft>) =>
        setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...patch } } : e));

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
            <td className="px-2 py-1.5" colSpan={2}>
                <div className="flex justify-end gap-1">
                    <Button size="sm" onClick={saveRule}><Save size={14} /> Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}><X size={14} /></Button>
                </div>
            </td>
        </tr>
    );

    return (
        <div className="space-y-4">
            <div className="rounded-md bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                Preview of the screen only — changes here are not saved and nothing is sent yet.
            </div>

            {/* Master switch and timing */}
            <section className={card}>
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <h2 className="font-semibold">Automatic reminders</h2>
                        <p className="text-xs text-muted-foreground">
                            Once a day the rules below are checked and each matching customer gets at most one message.
                        </p>
                    </div>
                    <Switch checked={enabled} onCheckedChange={setEnabled} />
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1">
                        <Label>Send time</Label>
                        <Input type="time" value={sendTime} onChange={(e) => setSendTime(e.target.value)} className="w-32" />
                    </div>
                    <div className="space-y-1">
                        <Label>Max messages a day</Label>
                        <NumericInput value={dailyCap} onValueChange={setDailyCap} min={1} max={1000} className="w-32" />
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
                            Age is counted from the oldest unpaid bill. When several rules match, the strongest wins. A rule stops once the balance is paid.
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
                            <th className="px-2 py-1.5 text-center font-medium">On</th>
                            <th className="px-2 py-1.5 w-20" />
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
                                <td className="px-2 py-1.5 text-center">
                                    <Switch
                                        checked={r.enabled}
                                        onCheckedChange={(v) => setRules((cur) => cur.map((x) => (x.id === r.id ? { ...x, enabled: v } : x)))}
                                    />
                                </td>
                                <td className="px-2 py-1.5">
                                    <div className="flex justify-end gap-1">
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
                            <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">No rules — automatic reminders will send nothing.</td></tr>
                        )}
                    </tbody>
                </table>
                <p className="text-xs text-muted-foreground">
                    Message wording is edited on the WhatsApp Templates page ({TONE_LABEL.SOFT} / {TONE_LABEL.FIRM}).
                </p>
            </section>

            {/* Excluded customers */}
            <section className={card}>
                <div>
                    <h2 className="font-semibold">Never remind</h2>
                    <p className="text-xs text-muted-foreground">Relatives, VIPs, government offices — skipped by automation and by Send to all.</p>
                </div>
                <div className="flex gap-2">
                    <Input
                        value={excludeText}
                        onChange={(e) => setExcludeText(e.target.value)}
                        placeholder="Search customer…"
                        className="h-8 max-w-xs"
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && excludeText.trim()) { setExcluded((c) => [...c, excludeText.trim()]); setExcludeText(""); }
                        }}
                    />
                    <Button size="sm" variant="outline" disabled={!excludeText.trim()} onClick={() => { setExcluded((c) => [...c, excludeText.trim()]); setExcludeText(""); }}>
                        <Plus size={14} /> Add
                    </Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                    {excluded.map((name) => (
                        <span key={name} className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2.5 py-0.5 text-xs">
                            {name}
                            <button type="button" title="Remove" onClick={() => setExcluded((c) => c.filter((x) => x !== name))}><X size={12} /></button>
                        </span>
                    ))}
                    {excluded.length === 0 && <span className="text-xs text-muted-foreground">Nobody excluded.</span>}
                </div>
            </section>

            {/* Recent sends */}
            <section className={card}>
                <div className="flex items-center justify-between">
                    <h2 className="font-semibold">Recent reminders</h2>
                    <Button size="sm" variant="outline" disabled title="Not wired yet">Send test to my number</Button>
                </div>
                <table className="w-full text-sm">
                    <thead className="border-b text-xs text-muted-foreground">
                        <tr>
                            <th className="px-2 py-1.5 text-left font-medium">When</th>
                            <th className="px-2 py-1.5 text-left font-medium">Customer</th>
                            <th className="px-2 py-1.5 text-right font-medium">Amount</th>
                            <th className="px-2 py-1.5 text-left font-medium">How</th>
                            <th className="px-2 py-1.5 text-left font-medium">Message</th>
                            <th className="px-2 py-1.5 text-left font-medium">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {SAMPLE_LOG.map((l, i) => (
                            <tr key={i} className="border-b last:border-0">
                                <td className="px-2 py-1.5 text-xs text-muted-foreground">{new Date(l.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</td>
                                <td className="px-2 py-1.5">{l.party}</td>
                                <td className="px-2 py-1.5 text-right font-mono">₹{fmt(l.amount)}</td>
                                <td className="px-2 py-1.5 text-xs">{l.mode === "MANUAL" ? "By hand" : l.mode === "ALL" ? "Send to all" : "Automatic"}</td>
                                <td className="px-2 py-1.5 text-xs">{TONE_LABEL[l.tone]}</td>
                                <td className={`px-2 py-1.5 text-xs font-medium ${l.status === "FAILED" ? "text-red-600" : l.status === "READ" ? "text-emerald-600" : ""}`}>
                                    {l.status === "FAILED" ? "Failed" : l.status === "READ" ? "Read" : "Sent"}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </section>

            <div className="flex justify-end">
                <Button onClick={() => toast.info("Preview only — settings are not saved yet.")}><Save size={14} /> Save settings</Button>
            </div>
        </div>
    );
}
