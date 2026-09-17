"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ShieldCheck, Lock, Sparkles } from "lucide-react";
import { formatRupees } from "@/shared/lib/format/moneyInr";
import { extractApiError } from "@/shared/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { parseDecimalInput } from "@/shared/lib/format";

interface Props {
    accountId: number;
    /** Current limit from the API. Prisma Decimal arrives as a string; null = no credit. */
    initialLimit: string | number | null;
    /** Whether the current user may change the limit. */
    canEdit: boolean;
    /** Called after a successful save so the parent can re-fetch. */
    onSaved: () => void;
}

// Decimal/null from the API → a clean editable string ("" when no credit).
function toInput(limit: string | number | null): string {
    if (limit === null || limit === undefined) return "";
    const n = Number(limit);
    if (!Number.isFinite(n) || n <= 0) return "";
    return String(n);
}

// The auto half of the limit, read from /api/accounts/[id]/credit-limit. The
// manual figure is already in hand (and editable below); what the profile cannot
// work out for itself is the AUTO limit the config grants from this customer's
// own recent sales. `effective` — the higher of the two — is what actually gets
// enforced at the register, so the card speaks in that number.
interface Breakup {
    manual: number;
    auto: number;
    effective: number;
    salesInWindow: number;
    autoEnabled: boolean;
    windowDays: number;
    pctOfSales: number;
}

// Per repo rule: no <input type="number">. Keep digits and a single dot.
export default function AccountCreditLimitCard({ accountId, initialLimit, canEdit, onSaved }: Props) {
    const [value, setValue] = useState(() => toInput(initialLimit));
    const [saving, setSaving] = useState(false);
    const [breakup, setBreakup] = useState<Breakup | null>(null);

    const savedValue = toInput(initialLimit);
    const dirty = value !== savedValue;
    const parsed = value.trim() === "" ? 0 : Number(value);

    // Show the auto number as it stands on the server, but let the box the user is
    // typing in win for the manual side — so the effective figure moves with the
    // edit instead of lagging a save behind.
    const autoLimit = breakup?.auto ?? 0;
    const showAuto = (breakup?.autoEnabled ?? false) || autoLimit > 0;
    const effective = Math.max(parsed, autoLimit);
    const allowsCredit = effective > 0;

    const loadBreakup = useCallback(async () => {
        try {
            const { data } = await axios.get<Breakup>(`/api/accounts/${accountId}/credit-limit`);
            setBreakup(data);
        } catch {
            // Non-fatal — the card still shows and edits the manual limit.
            setBreakup(null);
        }
    }, [accountId]);

    useEffect(() => { void loadBreakup(); }, [loadBreakup]);

    const save = async () => {
        // Empty or zero → null (cash-only). A positive number grants that headroom.
        const next = parsed > 0 ? parsed : null;
        setSaving(true);
        try {
            await axios.patch(`/api/accounts/${accountId}`, { creditLimit: next });
            toast.success(next === null ? "Set to cash-only" : `Credit limit set to ${formatRupees(next)}`);
            void loadBreakup();
            onSaved();
        } catch (e) {
            toast.error(extractApiError(e, "Save failed"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card>
            <CardContent className="space-y-3 pt-4">
                <div className="flex items-center gap-2">
                    {allowsCredit
                        ? <ShieldCheck size={15} className="text-primary" />
                        : <Lock size={15} className="text-muted-foreground" />}
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                        Credit limit
                    </p>
                </div>

                <p className="text-sm text-muted-foreground">
                    {allowsCredit
                        ? <>This customer can buy on credit up to <span className="font-medium text-foreground">{formatRupees(effective)}</span> of outstanding balance.</>
                        : "Cash-only — credit sales are blocked at the register. Set a positive limit to allow buying on credit."}
                </p>

                {/* The breakup, only when an auto limit is in play. Manual stays the
                    editable half below; auto is read-only and comes from Settings. */}
                {showAuto && (
                    <div className="space-y-1 rounded-md border bg-muted/40 p-2.5 text-xs">
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">Manual limit</span>
                            <span className="font-medium">{parsed > 0 ? formatRupees(parsed) : "Not set"}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                            <span className="flex items-center gap-1 text-muted-foreground">
                                <Sparkles size={12} /> Auto limit
                            </span>
                            <span className="font-medium">{autoLimit > 0 ? formatRupees(autoLimit) : "₹0"}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 border-t pt-1">
                            <span className="font-medium">Effective limit</span>
                            <span className="font-semibold">{formatRupees(effective)}</span>
                        </div>
                        <p className="pt-0.5 text-[11px] leading-snug text-muted-foreground/80">
                            {breakup && breakup.autoEnabled
                                ? <>Auto = {breakup.pctOfSales}% of {formatRupees(breakup.salesInWindow)} sales in the last {breakup.windowDays} days. The higher of manual and auto is enforced. Change the rule in Settings → Credit limit.</>
                                : "Auto credit limit is switched off — only the manual limit applies."}
                        </p>
                    </div>
                )}

                {canEdit ? (
                    <>
                        <div className="space-y-1.5">
                            <Label htmlFor="credit-limit">Limit (₹) — leave blank for cash-only</Label>
                            <Input
                                id="credit-limit"
                                inputMode="decimal"
                                value={value}
                                onChange={e => setValue(parseDecimalInput(e.target.value))}
                                placeholder="0 (cash-only)"
                                className="max-w-xs"
                            />
                        </div>
                        {dirty && (
                            <Button size="sm" onClick={() => void save()} disabled={saving}>
                                {saving ? "Saving…" : "Save credit limit"}
                            </Button>
                        )}
                    </>
                ) : (
                    <p className="text-xs text-muted-foreground/70">
                        You don&apos;t have permission to change the credit limit.
                    </p>
                )}
            </CardContent>
        </Card>
    );
}
