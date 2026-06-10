"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ShieldCheck, Lock } from "lucide-react";
import { formatRupees } from "@/shared/lib/format/moneyInr";
import { extractApiError } from "@/shared/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

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

// Per repo rule: no <input type="number">. Keep digits and a single dot.
function sanitize(raw: string): string {
    const cleaned = raw.replace(/[^\d.]/g, "");
    const firstDot = cleaned.indexOf(".");
    if (firstDot === -1) return cleaned;
    return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
}

export default function AccountCreditLimitCard({ accountId, initialLimit, canEdit, onSaved }: Props) {
    const [value, setValue] = useState(() => toInput(initialLimit));
    const [saving, setSaving] = useState(false);

    const savedValue = toInput(initialLimit);
    const dirty = value !== savedValue;
    const parsed = value.trim() === "" ? 0 : Number(value);
    const allowsCredit = parsed > 0;

    const save = async () => {
        // Empty or zero → null (cash-only). A positive number grants that headroom.
        const next = parsed > 0 ? parsed : null;
        setSaving(true);
        try {
            await axios.patch(`/api/accounts/${accountId}`, { creditLimit: next });
            toast.success(next === null ? "Set to cash-only" : `Credit limit set to ${formatRupees(next)}`);
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
                        ? <>This customer can buy on credit up to <span className="font-medium text-foreground">{formatRupees(parsed)}</span> of outstanding balance.</>
                        : "Cash-only — credit sales are blocked at the register. Set a positive limit to allow buying on credit."}
                </p>

                {canEdit ? (
                    <>
                        <div className="space-y-1.5">
                            <Label htmlFor="credit-limit">Limit (₹) — leave blank for cash-only</Label>
                            <Input
                                id="credit-limit"
                                inputMode="decimal"
                                value={value}
                                onChange={e => setValue(sanitize(e.target.value))}
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
