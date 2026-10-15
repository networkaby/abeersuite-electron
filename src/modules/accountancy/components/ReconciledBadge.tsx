"use client";

// Reconciliation watermark control for the ledger detail strip.
//
// Reads: "Reconciled thru 15-Oct-2026 · checked 27-Dec-2026" — two different
// dates on purpose. The first is how far the statement was matched, the second
// is when a human sat down and did the matching. Showing only one of them hides
// the window where a backdated entry can land.
//
// Click to open an inline editor: set the date, or clear the watermark. The
// value can also move on its own — a voucher posted or deleted inside the
// reconciled window pulls it back to the day before that entry (see
// retreatReconciliation() in lib/reconciliation.ts), so what's shown here is
// always the last date still known to be clean.

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useApiResource } from "@/shared/hooks/useApiResource";
import axios from "axios";
import { toast } from "sonner";
import { CheckCircle2, CircleDashed, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { formatDate } from "@/shared/lib/format/formatDate";
import { cn } from "@/shared/lib/format/utils";

export interface ReconciledBadgeProps {
    accountId: number;
    /** yyyy-mm-dd, or null when this ledger has never been reconciled. */
    reconciledThrough: string | null;
    /** ISO instant the last reconciliation was performed. */
    reconciledAt: string | null;
    /** Called after a successful save/clear so the parent can refetch. */
    onSaved: () => void;
}

export function ReconciledBadge({ accountId, reconciledThrough, reconciledAt, onSaved }: ReconciledBadgeProps) {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState(reconciledThrough ?? "");
    const [saving, setSaving] = useState(false);

    const save = async (value: string | null) => {
        setSaving(true);
        try {
            await axios.post(`/api/accountancy/ledgers/${accountId}/reconcile`, { reconciledThrough: value });
            toast.success(value ? `Reconciled through ${formatDate(value)}` : "Reconciliation cleared");
            setOpen(false);
            onSaved();
        } catch (e) {
            const msg = axios.isAxiosError(e) ? e.response?.data?.error : null;
            toast.error(msg ?? "Failed to update reconciliation");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex flex-col items-end gap-1.5">
            <button
                type="button"
                onClick={() => { setDraft(reconciledThrough ?? ""); setOpen((v) => !v); }}
                className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
                    reconciledThrough
                        ? "border-green-200 bg-green-50 text-green-700 hover:bg-green-100 dark:border-green-800 dark:bg-green-900/30 dark:text-green-300 dark:hover:bg-green-900/50"
                        : "border-border bg-background text-muted-foreground hover:bg-muted",
                )}
            >
                {reconciledThrough
                    ? <CheckCircle2 size={12} className="shrink-0" />
                    : <CircleDashed size={12} className="shrink-0" />}
                <span className="font-medium">
                    {/* "upto" reads as inclusive on its own — "thru" left it ambiguous
                        whether the named day itself was in or out. */}
                    {reconciledThrough ? `Reconciled upto ${formatDate(reconciledThrough)}` : "Not reconciled"}
                </span>
            </button>

            {reconciledThrough && reconciledAt && !open && (
                <span className="text-[10px] text-muted-foreground">
                    checked {formatDate(reconciledAt)}
                </span>
            )}

            {open && (
                <div className="flex items-center gap-2 rounded-md border bg-background p-2 shadow-sm">
                    <label className="text-xs text-muted-foreground whitespace-nowrap">Matched thru</label>
                    <TallyDateInput
                        value={draft}
                        onValueChange={setDraft}
                        monthMode="end"
                        className="h-7 w-36 text-xs"
                    />
                    <Button
                        size="sm"
                        className="h-7 px-2.5 text-xs"
                        disabled={saving || !draft}
                        onClick={() => save(draft)}
                    >
                        {saving ? <Loader2 size={12} className="animate-spin" /> : "Save"}
                    </Button>
                    {reconciledThrough && (
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs text-muted-foreground"
                            disabled={saving}
                            onClick={() => save(null)}
                        >
                            Clear
                        </Button>
                    )}
                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs text-muted-foreground"
                        disabled={saving}
                        onClick={() => setOpen(false)}
                    >
                        Cancel
                    </Button>
                </div>
            )}
        </div>
    );
}

/** A green tick beside a balance: this ledger is reconciled right up to its
 *  last entry (watermark set, nothing posted after it). Renders nothing
 *  otherwise — drop it next to any balance where a ledger's status matters. */
export function ReconciledTick({ through, pending, size = 12 }: {
    through: string | null | undefined;
    pending: number | null | undefined;
    size?: number;
}) {
    if (!through || pending) return null;
    const label = `Reconciled upto ${formatDate(through)}`;
    return (
        <span title={label} aria-label={label} className="inline-flex shrink-0 text-green-600 dark:text-green-400">
            <CheckCircle2 size={size} />
        </span>
    );
}

// ── Reports: one read, a tick on every reconciled ledger row ─────────────────

const ReconciledLedgers = createContext<Map<number, string> | null>(null);

/** Wrap a report once; every `LedgerReconciledTick` inside it reads this list. */
export function ReconciledLedgersProvider({ children }: { children: ReactNode }) {
    const { data } = useApiResource<{ id: number; through: string }[]>(
        "/api/accountancy/ledgers/reconciled", { topics: ["ledger"] },
    );
    const map = useMemo(() => new Map((data ?? []).map((r) => [r.id, r.through])), [data]);
    return <ReconciledLedgers.Provider value={map}>{children}</ReconciledLedgers.Provider>;
}

/** The green tick for a ledger row, when that ledger is reconciled up to date. */
export function LedgerReconciledTick({ ledgerId, size }: { ledgerId: number; size?: number }) {
    const through = useContext(ReconciledLedgers)?.get(ledgerId);
    return <ReconciledTick through={through} pending={0} size={size} />;
}
