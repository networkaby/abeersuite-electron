"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { ArrowLeft, Loader2, CheckCircle, XCircle } from "lucide-react";
import Link from "next/link";

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
    VOIDED: "bg-gray-100 text-gray-500 border-gray-200",
};

function fmt(n: number) {
    return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2 }).format(n);
}

export default function JournalEntryDetailPage() {
    const { id } = useParams<{ id: string }>();
    const router = useRouter();
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
            <Loader2 className="animate-spin text-gray-400" size={32} />
        </div>
    );

    if (!entry) return <div className="text-center py-24 text-gray-400">Not found</div>;

    const totalDebit = entry.lines.filter((l) => l.type === "DEBIT").reduce((s, l) => s + Number(l.amount), 0);
    const totalCredit = entry.lines.filter((l) => l.type === "CREDIT").reduce((s, l) => s + Number(l.amount), 0);

    return (
        <div className="max-w-3xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
                <Link href="/finance/journal-entries" className="text-gray-400 hover:text-gray-600">
                    <ArrowLeft size={20} />
                </Link>
                <div className="flex-1">
                    <div className="flex items-center gap-3">
                        <h1 className="text-xl font-bold text-gray-900 font-mono">{entry.reference}</h1>
                        <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${STATUS_COLORS[entry.status]}`}>
                            {entry.status}
                        </span>
                    </div>
                    <p className="text-sm text-gray-500 mt-0.5">{entry.description}</p>
                </div>
                <div className="flex gap-2">
                    {entry.status === "DRAFT" && (
                        <button
                            onClick={post}
                            disabled={posting}
                            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                        >
                            {posting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                            Post Entry
                        </button>
                    )}
                    {entry.status === "POSTED" && (
                        <button
                            onClick={() => setShowVoid(true)}
                            className="flex items-center gap-2 px-4 py-2 border border-red-300 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50"
                        >
                            <XCircle size={14} /> Void
                        </button>
                    )}
                </div>
            </div>

            {/* Meta */}
            <div className="bg-white rounded-xl border shadow-sm p-5 grid grid-cols-3 gap-4 text-sm">
                <div>
                    <p className="text-xs text-gray-400 mb-1">Date</p>
                    <p className="font-medium">{new Date(entry.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</p>
                </div>
                <div>
                    <p className="text-xs text-gray-400 mb-1">Created by</p>
                    <p className="font-medium">{entry.createdBy.name}</p>
                </div>
                <div>
                    <p className="text-xs text-gray-400 mb-1">Created at</p>
                    <p className="font-medium">{new Date(entry.createdAt).toLocaleString()}</p>
                </div>
                {entry.postedAt && (
                    <div>
                        <p className="text-xs text-gray-400 mb-1">Posted at</p>
                        <p className="font-medium text-green-700">{new Date(entry.postedAt).toLocaleString()}</p>
                    </div>
                )}
                {entry.voidedAt && (
                    <div>
                        <p className="text-xs text-gray-400 mb-1">Voided at</p>
                        <p className="font-medium text-red-600">{new Date(entry.voidedAt).toLocaleString()}</p>
                    </div>
                )}
                {entry.voidReason && (
                    <div className="col-span-2">
                        <p className="text-xs text-gray-400 mb-1">Void reason</p>
                        <p className="font-medium text-red-600">{entry.voidReason}</p>
                    </div>
                )}
            </div>

            {/* Lines */}
            <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-500 border-b">
                        <tr>
                            <th className="px-5 py-3 text-left font-medium">Account</th>
                            <th className="px-5 py-3 text-left font-medium">Note</th>
                            <th className="px-5 py-3 text-right font-medium w-36">Debit</th>
                            <th className="px-5 py-3 text-right font-medium w-36">Credit</th>
                        </tr>
                    </thead>
                    <tbody>
                        {entry.lines.map((l) => (
                            <tr key={l.id} className="border-b last:border-0 hover:bg-gray-50">
                                <td className="px-5 py-3">
                                    <span className="font-mono text-gray-500 mr-2">{l.account.code}</span>
                                    <span className="font-medium text-gray-800">{l.account.name}</span>
                                </td>
                                <td className="px-5 py-3 text-gray-400 text-xs">{l.description ?? "—"}</td>
                                <td className="px-5 py-3 text-right font-mono">
                                    {l.type === "DEBIT" ? <span className="text-gray-800">{fmt(Number(l.amount))}</span> : <span className="text-gray-300">—</span>}
                                </td>
                                <td className="px-5 py-3 text-right font-mono">
                                    {l.type === "CREDIT" ? <span className="text-gray-800">{fmt(Number(l.amount))}</span> : <span className="text-gray-300">—</span>}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot className="bg-gray-50 border-t font-semibold text-sm">
                        <tr>
                            <td colSpan={2} className="px-5 py-3 text-gray-600">Total</td>
                            <td className="px-5 py-3 text-right font-mono">{fmt(totalDebit)}</td>
                            <td className="px-5 py-3 text-right font-mono">{fmt(totalCredit)}</td>
                        </tr>
                        <tr>
                            <td colSpan={4} className="px-5 py-2 text-center text-xs">
                                {Math.abs(totalDebit - totalCredit) < 0.005
                                    ? <span className="text-green-600">✓ Balanced</span>
                                    : <span className="text-red-500">⚠ Not balanced — difference: {fmt(Math.abs(totalDebit - totalCredit))}</span>
                                }
                            </td>
                        </tr>
                    </tfoot>
                </table>
            </div>

            {/* Void modal */}
            {showVoid && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md space-y-4">
                        <h3 className="font-semibold text-gray-900">Void Journal Entry</h3>
                        <p className="text-sm text-gray-600">
                            This will create a reversal entry and update GL balances. This action cannot be undone.
                        </p>
                        <div>
                            <label className="text-xs font-medium text-gray-600">Reason</label>
                            <textarea
                                value={voidReason}
                                onChange={(e) => setVoidReason(e.target.value)}
                                rows={3}
                                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                                placeholder="Reason for voiding..."
                            />
                        </div>
                        <div className="flex gap-2 justify-end">
                            <button onClick={() => setShowVoid(false)} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">
                                Cancel
                            </button>
                            <button
                                onClick={voidEntry}
                                disabled={voiding}
                                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
                            >
                                {voiding && <Loader2 size={14} className="animate-spin" />} Confirm Void
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
