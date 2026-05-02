"use client";
import { fmt, JOURNAL_STATUS_COLORS } from "@/utils/constants";

import { useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Loader2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

interface JournalEntry {
    id: number;
    date: string;
    reference: string;
    description: string;
    status: "DRAFT" | "POSTED" | "VOIDED";
    totalDebit: number;
    _count: { lines: number };
    createdBy: { name: string };
}

type LineInput = { accountId: number; type: "DEBIT" | "CREDIT"; amount: string; description: string };

interface GlAccount { id: number; code: string; name: string; type: string }

const STATUS_COLORS = JOURNAL_STATUS_COLORS;

const cellClass  = "w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";


export default function JournalEntriesPage() {
    const [entries, setEntries] = useState<JournalEntry[]>([]);
    const [accounts, setAccounts] = useState<GlAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);
    const [saving, setSaving] = useState(false);
    const [statusFilter, setStatusFilter] = useState("");

    const [form, setForm] = useState({
        date: new Date().toISOString().slice(0, 10),
        description: "",
        lines: [
            { accountId: 0, type: "DEBIT" as "DEBIT" | "CREDIT", amount: "", description: "" },
            { accountId: 0, type: "CREDIT" as "DEBIT" | "CREDIT", amount: "", description: "" },
        ] as LineInput[],
    });

    const load = () => {
        setLoading(true);
        const q = statusFilter ? `?status=${statusFilter}` : "";
        axios.get<JournalEntry[]>(`/api/finance/journal-entries${q}`)
            .then((r) => setEntries(r.data))
            .catch(() => toast.error("Failed to load"))
            .finally(() => setLoading(false));
    };

    useEffect(load, [statusFilter]);

    useEffect(() => {
        axios.get<GlAccount[]>("/api/finance/gl-accounts")
            .then((r) => setAccounts(r.data))
            .catch(() => { });
    }, []);

    const addLine = () => setForm((f) => ({
        ...f,
        lines: [...f.lines, { accountId: 0, type: "DEBIT", amount: "", description: "" }],
    }));

    const removeLine = (i: number) => setForm((f) => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }));

    const updateLine = (i: number, patch: Partial<LineInput>) =>
        setForm((f) => ({ ...f, lines: f.lines.map((l, idx) => idx === i ? { ...l, ...patch } : l) }));

    const totalDebits = form.lines.filter((l) => l.type === "DEBIT").reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
    const totalCredits = form.lines.filter((l) => l.type === "CREDIT").reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
    const balanced = Math.abs(totalDebits - totalCredits) < 0.005;

    const submit = async () => {
        if (!form.description.trim()) { toast.error("Description required"); return; }
        if (!balanced) { toast.error("Debits must equal credits"); return; }
        const lines = form.lines.map((l) => ({
            accountId: Number(l.accountId),
            type: l.type,
            amount: parseFloat(l.amount),
            description: l.description || undefined,
        }));
        setSaving(true);
        try {
            await axios.post("/api/finance/journal-entries", { date: form.date, description: form.description, lines });
            toast.success("Journal entry created");
            setShowCreate(false);
            load();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed";
            toast.error(msg ?? "Failed");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Journal Entries</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">Double-entry bookkeeping records</p>
                </div>
                <Button onClick={() => setShowCreate((v) => !v)}>
                    <Plus size={16} /> New Entry
                </Button>
            </div>

            {/* Filters */}
            <div className="flex gap-1">
                {(["", "DRAFT", "POSTED", "VOIDED"] as const).map((s) => (
                    <Button
                        key={s}
                        onClick={() => setStatusFilter(s)}
                        variant="outline"
                        size="xs"
                        className={`h-auto px-3 py-1.5 text-xs font-medium transition-colors ${
                            statusFilter === s
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-card text-muted-foreground hover:bg-muted"
                        }`}
                    >
                        {s || "All"}
                    </Button>
                ))}
            </div>

            {/* Create form */}
            {showCreate && (
                <div className="space-y-4 rounded-lg border border-border bg-card p-5 shadow">
                    <h2 className="font-semibold text-foreground">New Journal Entry</h2>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <Label>Date</Label>
                            <Input
                                type="date"
                                value={form.date}
                                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Description</Label>
                            <Input
                                value={form.description}
                                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                                placeholder="Narration"
                            />
                        </div>
                    </div>

                    {/* Lines */}
                    <div className="overflow-hidden rounded-lg border border-border">
                        <table className="w-full text-sm">
                            <thead className="border-b border-border bg-muted text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium">Account</th>
                                    <th className="px-3 py-2 text-left font-medium w-24">Type</th>
                                    <th className="px-3 py-2 text-right font-medium w-32">Amount</th>
                                    <th className="px-3 py-2 text-left font-medium">Note</th>
                                    <th className="px-3 py-2 w-8" />
                                </tr>
                            </thead>
                            <tbody>
                                {form.lines.map((line, i) => (
                                    <tr key={i} className="border-t border-border">
                                        <td className="px-3 py-2">
                                            <Select
                                                value={String(line.accountId)}
                                                onValueChange={(value) => updateLine(i, { accountId: Number(value) })}
                                            >
                                                <SelectTrigger className={cellClass}>
                                                    <SelectValue placeholder="Select account" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="0">Select account</SelectItem>
                                                    {accounts.map((a) => (
                                                        <SelectItem key={a.id} value={String(a.id)}>{a.code} — {a.name}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </td>
                                        <td className="px-3 py-2">
                                            <Select
                                                value={line.type}
                                                onValueChange={(value) => updateLine(i, { type: value as "DEBIT" | "CREDIT" })}
                                            >
                                                <SelectTrigger className={cellClass}>
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="DEBIT">DEBIT</SelectItem>
                                                    <SelectItem value="CREDIT">CREDIT</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </td>
                                        <td className="px-3 py-2">
                                            <Input
                                                type="number" min="0" step="0.01"
                                                value={line.amount}
                                                onChange={(e) => updateLine(i, { amount: e.target.value })}
                                                className={`${cellClass} text-right`}
                                                placeholder="0.00"
                                            />
                                        </td>
                                        <td className="px-3 py-2">
                                            <Input
                                                value={line.description}
                                                onChange={(e) => updateLine(i, { description: e.target.value })}
                                                className={cellClass}
                                                placeholder="Optional"
                                            />
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                            {form.lines.length > 2 && (
                                                <Button
                                                    onClick={() => removeLine(i)}
                                                    variant="ghost"
                                                    size="icon-xs"
                                                    className="text-destructive hover:text-destructive/80"
                                                >
                                                    ×
                                                </Button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot className="border-t border-border bg-muted text-xs font-medium">
                                <tr>
                                    <td colSpan={2} className="px-3 py-2 text-muted-foreground">Totals</td>
                                    <td className="px-3 py-2 text-right">
                                        <div className={balanced ? "text-green-600" : "text-destructive"}>
                                            DR {fmt(totalDebits)} / CR {fmt(totalCredits)}
                                        </div>
                                        {!balanced && <div className="text-destructive">Not balanced</div>}
                                    </td>
                                    <td colSpan={2} />
                                </tr>
                            </tfoot>
                        </table>
                    </div>

                    <div className="flex items-center justify-between">
                        <Button onClick={addLine} variant="link" size="sm" className="h-auto p-0 text-sm">+ Add line</Button>
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
                            <Button onClick={submit} disabled={saving || !balanced}>
                                {saving && <Loader2 size={14} className="animate-spin" />} Save as Draft
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* List */}
            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="animate-spin text-muted-foreground" size={28} />
                </div>
            ) : (
                <div className="overflow-hidden rounded-lg border border-border bg-card shadow">
                    {entries.length === 0 ? (
                        <div className="text-center py-16 text-muted-foreground">No journal entries yet</div>
                    ) : (
                        <table className="w-full text-sm">
                            <thead className="border-b border-border bg-muted text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-5 py-3 text-left font-medium">Reference</th>
                                    <th className="px-5 py-3 text-left font-medium">Date</th>
                                    <th className="px-5 py-3 text-left font-medium">Description</th>
                                    <th className="px-5 py-3 text-right font-medium">Amount</th>
                                    <th className="px-5 py-3 text-center font-medium">Status</th>
                                    <th className="px-5 py-3 text-left font-medium">By</th>
                                    <th className="px-5 py-3" />
                                </tr>
                            </thead>
                            <tbody>
                                {entries.map((e) => (
                                    <tr key={e.id} className="border-b last:border-0 hover:bg-muted/40">
                                        <td className="px-5 py-3 font-mono text-primary">{e.reference}</td>
                                        <td className="px-5 py-3 text-muted-foreground">{new Date(e.date).toLocaleDateString()}</td>
                                        <td className="px-5 py-3 text-foreground">{e.description}</td>
                                        <td className="px-5 py-3 text-right font-mono">{fmt(e.totalDebit)}</td>
                                        <td className="px-5 py-3 text-center">
                                            <span className={`text-xs px-2 py-0.5 font-medium ${STATUS_COLORS[e.status]}`}>
                                                {e.status}
                                            </span>
                                        </td>
                                        <td className="px-5 py-3 text-muted-foreground text-xs">{e.createdBy.name}</td>
                                        <td className="px-5 py-3 text-right">
                                            <Link href={`/finance/journal-entries/${e.id}`} className="text-muted-foreground/40 hover:text-primary">
                                                <ChevronRight size={16} />
                                            </Link>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}
        </div>
    );
}
