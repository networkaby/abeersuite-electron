"use client";
import { fmt } from "@/utils/constants";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { ArrowLeft, Loader2, CheckCircle, XCircle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
    DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

interface JournalLine {
    id: number;
    type: "DEBIT" | "CREDIT";
    amount: number;
    description: string | null;
    account: { id: number; code: string; name: string; normalBalance: string };
}

interface JournalEntry {
    id: number;
    date: string;
    reference: string;
    description: string;
    status: "DRAFT" | "POSTED" | "VOIDED";
    postedAt: string | null;
    voidedAt: string | null;
    voidReason: string | null;
    createdBy: { id: number; name: string };
    createdAt: string;
    lines: JournalLine[];
}

const STATUS_COLORS = {
    DRAFT:  "bg-yellow-100 text-yellow-700 border-yellow-200",
    POSTED: "bg-green-100 text-green-700 border-green-200",
    VOIDED: "bg-muted text-muted-foreground border-border",
};


export default function JournalEntryDetailPage() {
    const { id } = useParams<{ id: string }>();
    const [entry, setEntry] = useState<JournalEntry | null>(null);
    const [loading, setLoading] = useState(true);
    const [posting, setPosting] = useState(false);
    const [showVoid, setShowVoid] = useState(false);
    const [voidReason, setVoidReason] = useState("");
    const [voiding, setVoiding] = useState(false);

    const load = () => {
        setLoading(true);
        axios.get<JournalEntry>(`/api/finance/journal-entries/${id}`)
            .then((r) => setEntry(r.data))
            .catch(() => toast.error("Failed to load"))
            .finally(() => setLoading(false));
    };

    useEffect(load, [id]);

    const post = async () => {
        setPosting(true);
        try {
            await axios.post(`/api/finance/journal-entries/${id}/post`);
            toast.success("Entry posted — GL balances updated");
            load();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed";
            toast.error(msg ?? "Failed to post");
        } finally {
            setPosting(false);
        }
    };

    const voidEntry = async () => {
        if (!voidReason.trim()) { toast.error("Reason required"); return; }
        setVoiding(true);
        try {
            await axios.post(`/api/finance/journal-entries/${id}/void`, { reason: voidReason });
            toast.success("Entry voided — reversal entry created");
            setShowVoid(false);
            load();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed";
            toast.error(msg ?? "Failed to void");
        } finally {
            setVoiding(false);
        }
    };

    if (loading) return (
        <div className="flex items-center justify-center h-64">
            <Loader2 className="animate-spin text-muted-foreground" size={32} />
        </div>
    );

    if (!entry) return <div className="text-center py-24 text-muted-foreground">Not found</div>;

    const totalDebit = entry.lines.filter((l) => l.type === "DEBIT").reduce((s, l) => s + Number(l.amount), 0);
    const totalCredit = entry.lines.filter((l) => l.type === "CREDIT").reduce((s, l) => s + Number(l.amount), 0);

    return (
        <div className="max-w-3xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
                <Link href="/office/finance/journal-entries" className="text-muted-foreground hover:text-foreground">
                    <ArrowLeft size={20} />
                </Link>
                <div className="flex-1">
                    <div className="flex items-center gap-3">
                        <h1 className="text-xl font-bold text-foreground font-mono">{entry.reference}</h1>
                        <span className={`text-xs px-2.5 py-1 border font-medium ${STATUS_COLORS[entry.status]}`}>
                            {entry.status}
                        </span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{entry.description}</p>
                </div>
                <div className="flex gap-2">
                    {entry.status === "DRAFT" && (
                        <Button
                            onClick={post}
                            disabled={posting}
                            className="bg-green-600 hover:bg-green-700 text-white border-green-600"
                        >
                            {posting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                            Post Entry
                        </Button>
                    )}
                    {entry.status === "POSTED" && (
                        <Button variant="outline" onClick={() => setShowVoid(true)} className="border-destructive/40 text-destructive hover:bg-destructive/10">
                            <XCircle size={14} /> Void
                        </Button>
                    )}
                </div>
            </div>

            {/* Meta */}
            <div className="grid grid-cols-3 gap-4 rounded-lg border border-border bg-card p-5 text-sm shadow">
                <div>
                    <p className="text-xs text-muted-foreground mb-1">Date</p>
                    <p className="font-medium">
                        {new Date(entry.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                    </p>
                </div>
                <div>
                    <p className="text-xs text-muted-foreground mb-1">Created by</p>
                    <p className="font-medium">{entry.createdBy.name}</p>
                </div>
                <div>
                    <p className="text-xs text-muted-foreground mb-1">Created at</p>
                    <p className="font-medium">{new Date(entry.createdAt).toLocaleString()}</p>
                </div>
                {entry.postedAt && (
                    <div>
                        <p className="text-xs text-muted-foreground mb-1">Posted at</p>
                        <p className="font-medium text-green-700">{new Date(entry.postedAt).toLocaleString()}</p>
                    </div>
                )}
                {entry.voidedAt && (
                    <div>
                        <p className="text-xs text-muted-foreground mb-1">Voided at</p>
                        <p className="font-medium text-destructive">{new Date(entry.voidedAt).toLocaleString()}</p>
                    </div>
                )}
                {entry.voidReason && (
                    <div className="col-span-2">
                        <p className="text-xs text-muted-foreground mb-1">Void reason</p>
                        <p className="font-medium text-destructive">{entry.voidReason}</p>
                    </div>
                )}
            </div>

            {/* Lines */}
            <div className="overflow-hidden rounded-lg border border-border bg-card shadow">
                <table className="w-full text-sm">
                    <thead className="border-b border-border bg-muted text-xs text-muted-foreground">
                        <tr>
                            <th className="px-5 py-3 text-left font-medium">Account</th>
                            <th className="px-5 py-3 text-left font-medium">Note</th>
                            <th className="px-5 py-3 text-right font-medium w-36">Debit</th>
                            <th className="px-5 py-3 text-right font-medium w-36">Credit</th>
                        </tr>
                    </thead>
                    <tbody>
                        {entry.lines.map((l) => (
                            <tr key={l.id} className="border-b last:border-0 hover:bg-muted/40">
                                <td className="px-5 py-3">
                                    <span className="font-mono text-muted-foreground mr-2">{l.account.code}</span>
                                    <span className="font-medium text-foreground">{l.account.name}</span>
                                </td>
                                <td className="px-5 py-3 text-muted-foreground text-xs">{l.description ?? "—"}</td>
                                <td className="px-5 py-3 text-right font-mono">
                                    {l.type === "DEBIT"
                                        ? <span className="text-foreground">{fmt(Number(l.amount))}</span>
                                        : <span className="text-muted-foreground/40">—</span>
                                    }
                                </td>
                                <td className="px-5 py-3 text-right font-mono">
                                    {l.type === "CREDIT"
                                        ? <span className="text-foreground">{fmt(Number(l.amount))}</span>
                                        : <span className="text-muted-foreground/40">—</span>
                                    }
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot className="bg-muted border-t-2 border-border font-semibold text-sm">
                        <tr>
                            <td colSpan={2} className="px-5 py-3 text-muted-foreground">Total</td>
                            <td className="px-5 py-3 text-right font-mono">{fmt(totalDebit)}</td>
                            <td className="px-5 py-3 text-right font-mono">{fmt(totalCredit)}</td>
                        </tr>
                        <tr>
                            <td colSpan={4} className="px-5 py-2 text-center text-xs">
                                {Math.abs(totalDebit - totalCredit) < 0.005
                                    ? <span className="text-green-600">✓ Balanced</span>
                                    : <span className="text-destructive">⚠ Not balanced — difference: {fmt(Math.abs(totalDebit - totalCredit))}</span>
                                }
                            </td>
                        </tr>
                    </tfoot>
                </table>
            </div>

            {/* Void Dialog */}
            <Dialog open={showVoid} onOpenChange={(open) => { if (!open) setShowVoid(false); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Void Journal Entry</DialogTitle>
                        <DialogDescription>
                            This will create a reversal entry and update GL balances. This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-1.5">
                        <Label>Reason</Label>
                        <Textarea
                            value={voidReason}
                            onChange={(e) => setVoidReason(e.target.value)}
                            rows={3}
                            placeholder="Reason for voiding..."
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowVoid(false)}>Cancel</Button>
                        <Button variant="destructive" onClick={voidEntry} disabled={voiding}>
                            {voiding && <Loader2 size={14} className="animate-spin" />} Confirm Void
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
