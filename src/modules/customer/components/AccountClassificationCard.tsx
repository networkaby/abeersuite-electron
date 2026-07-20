"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Tags, Building2, User, ArrowRightLeft, Loader2 } from "lucide-react";
import { extractApiError } from "@/shared/lib/api";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

// Human labels for the two identity groups a party ledger can sit under.
const GROUPS = [
    { name: ACCOUNT_GROUPS.SUNDRY_DEBTORS, label: "Customer", hint: "Sundry Debtors" },
    { name: ACCOUNT_GROUPS.SUNDRY_CREDITORS, label: "Supplier", hint: "Sundry Creditors" },
] as const;

type PartyKind = "person" | "company";

interface Props {
    accountId: number;
    /** The party this ledger belongs to — drives the conversion direction. */
    party: { type: PartyKind; id: number; name: string };
    /** Current group name from the API (null when the ledger has no group). */
    groupName: string | null;
    canEdit: boolean;
    /** Re-fetch the detail after a group change. */
    onSaved: () => void;
    /** Navigate to the freshly-created party (the opposite type) after a conversion. */
    onConverted: (newId: number) => void;
}

export default function AccountClassificationCard({
    accountId, party, groupName, canEdit, onSaved, onConverted,
}: Props) {
    const [savingGroup, setSavingGroup] = useState<string | null>(null);
    const [confirmConvert, setConfirmConvert] = useState(false);
    const [converting, setConverting] = useState(false);

    // A person converts to a company and vice-versa — one card, both directions.
    const toCompany = party.type === "person";
    const direction = toCompany ? "personToCompany" : "companyToPerson";
    const targetLabel = toCompany ? "company" : "person";
    const TargetIcon = toCompany ? Building2 : User;

    const changeGroup = async (name: string) => {
        if (name === groupName || savingGroup) return;
        setSavingGroup(name);
        try {
            await axios.patch(`/api/accounts/${accountId}`, { accountGroup: name });
            toast.success(`Moved to ${name}`);
            onSaved();
        } catch (e) {
            toast.error(extractApiError(e, "Could not change group"));
        } finally {
            setSavingGroup(null);
        }
    };

    const convert = async () => {
        setConverting(true);
        try {
            const res = await axios.post<{ newId: number }>("/api/customer-tools/convert", {
                direction,
                sourceId: party.id,
            });
            toast.success(`${party.name} is now a ${targetLabel}`);
            setConfirmConvert(false);
            onConverted(res.data.newId);
        } catch (e) {
            // 409 = conversion blocked (open orders, already converted, …).
            toast.error(extractApiError(e, `Could not convert to ${targetLabel}`));
        } finally {
            setConverting(false);
        }
    };

    return (
        <Card>
            <CardContent className="space-y-4 pt-4">
                {/* ── Group / classification ── */}
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <Tags size={15} className="text-primary" />
                        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                            Account group
                        </p>
                    </div>
                    <p className="text-sm text-muted-foreground">
                        Which ledger this party sits under in the books — a customer (receivable)
                        or a supplier (payable).
                    </p>
                    {canEdit ? (
                        <div className="flex flex-wrap gap-2">
                            {GROUPS.map((g) => {
                                const active = g.name === groupName;
                                return (
                                    <Button
                                        key={g.name}
                                        type="button"
                                        size="sm"
                                        variant={active ? "default" : "outline"}
                                        disabled={savingGroup !== null}
                                        onClick={() => void changeGroup(g.name)}
                                    >
                                        {savingGroup === g.name && <Loader2 size={13} className="animate-spin" />}
                                        {g.label}
                                        <span className="ml-1 text-[11px] opacity-70">({g.hint})</span>
                                    </Button>
                                );
                            })}
                        </div>
                    ) : (
                        <p className="text-sm">
                            {groupName ?? <span className="text-muted-foreground">No group</span>}
                        </p>
                    )}
                </div>

                {/* ── Convert to the opposite party type ── */}
                {canEdit && (
                    <div className="space-y-2 border-t pt-4">
                        <div className="flex items-center gap-2">
                            <TargetIcon size={15} className="text-primary" />
                            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                                Convert to {targetLabel}
                            </p>
                        </div>
                        <p className="text-sm text-muted-foreground">
                            Turn this {party.type} into a {targetLabel}. The ledger, balance, tickets
                            and devices stay attached — only the contact type changes.
                        </p>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setConfirmConvert(true)}
                        >
                            <ArrowRightLeft size={14} /> Convert to {targetLabel}
                        </Button>
                    </div>
                )}
            </CardContent>

            <Dialog open={confirmConvert} onOpenChange={(o) => !converting && setConfirmConvert(o)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Convert {party.name} to a {targetLabel}?</DialogTitle>
                        <DialogDescription>
                            The account and its full history move to a new {targetLabel} record. The
                            old {party.type} entry is retired to the Customer Tools trash. Contact
                            links are dropped. This can&apos;t be undone from here.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button type="button" variant="outline" disabled={converting} onClick={() => setConfirmConvert(false)}>
                            Cancel
                        </Button>
                        <Button type="button" disabled={converting} onClick={() => void convert()}>
                            {converting ? "Converting…" : "Convert"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
}
