"use client";

// Activity tab of the Recycle Bin — who created / edited / cancelled / deleted /
// restored which voucher, and when. Read from GET /api/audit/activity, which
// builds it from what every action already records (no separate log).

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, RefreshCw, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { formatDate, formatDateTime, businessTodayIso } from "@/shared/lib/format/formatDate";
import { formatInr } from "@/shared/lib/format/moneyInr";
import { voucherTypeLabel } from "@/shared/lib/format/voucherTypeLabel";
import { referenceHref, voucherSourceForType } from "@/modules/accountancy/lib/voucherUrls";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";

type Action = "CREATED" | "EDITED" | "CANCELLED" | "DELETED" | "RESTORED";

interface ActivityRow {
    key: string;
    at: string;
    action: Action;
    userId: number | null;
    userName: string | null;
    voucherId: number;
    live: boolean;
    type: string | null;
    voucherNo: string | null;
    date: string | null;
    amount: number | null;
    party: string | null;
    note: string | null;
}

const ACTION_STYLE: Record<Action, string> = {
    CREATED: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
    EDITED: "border-amber-500/40 text-amber-700 dark:text-amber-400",
    CANCELLED: "border-orange-500/40 text-orange-700 dark:text-orange-400",
    DELETED: "border-destructive/40 text-destructive",
    RESTORED: "border-sky-500/40 text-sky-700 dark:text-sky-400",
};
const ACTION_LABEL: Record<Action, string> = {
    CREATED: "Created", EDITED: "Edited", CANCELLED: "Cancelled", DELETED: "Deleted", RESTORED: "Restored",
};

const selectCls = "h-8 rounded-md border bg-background px-2 text-xs";

export function ActivityLog() {
    const today = businessTodayIso();
    const [fromIso, setFromIso] = useState(today);
    const [toIso, setToIso] = useState(today);
    const [rows, setRows] = useState<ActivityRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [userId, setUserId] = useState("");
    const [action, setAction] = useState("");
    const [search, setSearch] = useState("");

    // Whole local days: from 00:00 of `fromIso` to 00:00 after `toIso`.
    const load = useCallback((silent = false) => {
        if (!fromIso || !toIso) return Promise.resolve();
        if (!silent) setLoading(true);
        const from = new Date(`${fromIso}T00:00:00`);
        const to = new Date(`${toIso}T00:00:00`);
        to.setDate(to.getDate() + 1);
        return axios
            .get<ActivityRow[]>(`/api/audit/activity?from=${from.toISOString()}&to=${to.toISOString()}`)
            .then((r) => setRows(r.data))
            .catch(() => toast.error("Failed to load activity"))
            .finally(() => { if (!silent) setLoading(false); });
    }, [fromIso, toIso]);

    useEffect(() => { void load(); }, [load]);
    useRealtimeTopics(["ledger", "stock"], () => { void load(true); });

    const users = useMemo(() => {
        const m = new Map<number, string>();
        for (const r of rows) if (r.userId != null) m.set(r.userId, r.userName ?? `User ${r.userId}`);
        return [...m].sort((a, b) => a[1].localeCompare(b[1]));
    }, [rows]);

    const shown = useMemo(() => {
        const q = search.trim().toLowerCase();
        return rows.filter((r) =>
            (!userId || String(r.userId) === userId)
            && (!action || r.action === action)
            && (!q || [r.voucherNo, r.party, r.note, voucherTypeLabel(r.type) ?? r.type]
                .some((s) => s?.toLowerCase().includes(q))));
    }, [rows, userId, action, search]);

    return (
        <div className="flex h-full flex-col overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b px-6 py-2">
                <span className="text-xs text-muted-foreground">From</span>
                <TallyDateInput value={fromIso} onValueChange={setFromIso} className="h-8 w-32 text-xs" />
                <span className="text-xs text-muted-foreground">To</span>
                <TallyDateInput value={toIso} onValueChange={setToIso} className="h-8 w-32 text-xs" />
                <select className={selectCls} value={userId} onChange={(e) => setUserId(e.target.value)}>
                    <option value="">All users</option>
                    {users.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
                <select className={selectCls} value={action} onChange={(e) => setAction(e.target.value)}>
                    <option value="">All actions</option>
                    {(Object.keys(ACTION_LABEL) as Action[]).map((a) => <option key={a} value={a}>{ACTION_LABEL[a]}</option>)}
                </select>
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Voucher no, party, type…" className="h-8 w-56 text-xs" />
                <span className="ml-auto text-xs text-muted-foreground">{shown.length} of {rows.length}</span>
                <Button size="sm" variant="outline" className="h-8" onClick={() => void load(true)}>
                    <RefreshCw size={13} className="mr-1" /> Refresh
                </Button>
            </div>

            <div className="flex-1 overflow-auto">
                {loading ? (
                    <div className="flex h-40 items-center justify-center text-muted-foreground"><Loader2 className="animate-spin" /></div>
                ) : shown.length === 0 ? (
                    <div className="flex h-40 flex-col items-center justify-center gap-2 text-muted-foreground">
                        <History size={36} strokeWidth={1} />
                        <p className="text-sm">No activity in this period.</p>
                    </div>
                ) : (
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 z-10 bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                            <tr className="border-b">
                                <th className="px-4 py-2 text-left font-medium">When</th>
                                <th className="px-4 py-2 text-left font-medium">User</th>
                                <th className="px-4 py-2 text-left font-medium">Action</th>
                                <th className="px-4 py-2 text-left font-medium">Voucher</th>
                                <th className="px-4 py-2 text-left font-medium">Type</th>
                                <th className="px-4 py-2 text-left font-medium">Voucher date</th>
                                <th className="px-4 py-2 text-left font-medium">Party</th>
                                <th className="px-4 py-2 text-right font-medium">Amount</th>
                                <th className="px-4 py-2 text-left font-medium">Note</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {shown.map((r) => {
                                const href = r.live && r.type
                                    ? referenceHref(voucherSourceForType(r.type), r.voucherId, r.type)
                                    : null;
                                const label = r.voucherNo || `UV-${r.voucherId}`;
                                return (
                                    <tr key={r.key} className="hover:bg-muted/40">
                                        <td className="px-4 py-2 text-xs whitespace-nowrap">{formatDateTime(r.at)}</td>
                                        <td className="px-4 py-2 text-xs">{r.userName ?? "—"}</td>
                                        <td className="px-4 py-2">
                                            <Badge variant="outline" className={`text-[10px] font-normal ${ACTION_STYLE[r.action]}`}>{ACTION_LABEL[r.action]}</Badge>
                                        </td>
                                        <td className="px-4 py-2 font-mono text-xs font-medium">
                                            {href ? <Link href={href} className="text-primary hover:underline">{label}</Link> : label}
                                        </td>
                                        <td className="px-4 py-2 text-xs">{voucherTypeLabel(r.type) ?? r.type ?? "—"}</td>
                                        <td className="px-4 py-2 text-xs whitespace-nowrap">{r.date ? formatDate(r.date) : "—"}</td>
                                        <td className="px-4 py-2 text-xs max-w-[12rem] truncate">{r.party ?? "—"}</td>
                                        <td className="px-4 py-2 text-xs text-right tabular-nums">{r.amount != null ? formatInr(r.amount) : "—"}</td>
                                        <td className="px-4 py-2 text-xs text-muted-foreground max-w-xs truncate" title={r.note ?? undefined}>{r.note ?? ""}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
