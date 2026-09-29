"use client";

// "Bank" tab on the customer/party detail panel — the PARTY's own account, i.e.
// how WE pay THEM (a supplier payout, a customer refund). This is not our
// shop's bank; that one lives in COMPANY_DETAILS and prints on vouchers.
//
// Two blocks:
//   • NEFT/RTGS — beneficiary, bank, branch, A/C no, IFSC. A/C no and IFSC get
//     a copy button, because those are the two values staff retype into
//     net-banking and the two a typo is most expensive on. Typing the IFSC
//     fills a blank Bank Name / Branch from RBI's list (useIfscLookup).
//   • UPI — the VPA, with a live scan-to-pay QR beside it.
//
// Stored as one JSON column (Person.bankJson / Company.bankJson) through the
// party's existing PUT route. Shared by Person and Company so the two can never
// drift, exactly like PersonProfileTab / CompanyProfileTab.

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Landmark, QrCode, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { extractApiError } from "@/shared/lib/api";
import { QrSvg } from "@/shared/components/print/QrSvg";
import { IfscLookupHint } from "@/shared/components/IfscLookupHint";
import { useIfscLookup } from "@/shared/hooks";
import {
    PARTY_BANK_FIELDS, parsePartyBank, hasPartyBankData,
    buildPartyUpiLink, isValidIfsc, isValidVpa,
    type PartyBankFields,
} from "@/shared/lib/parties/partyBank";

interface Props {
    party: { kind: "person" | "company"; id: number; name: string };
    /** The raw `bankJson` column straight off the detail row — parsed here. */
    initialBank: unknown;
    /** Without customers:edit the tab is readable but frozen. */
    canEdit: boolean;
    /** Re-fetch the party detail after a successful save. */
    onSaved: () => void;
}

/** Small copy-to-clipboard button that confirms itself for a moment. */
function CopyButton({ value }: { value: string }) {
    const [copied, setCopied] = useState(false);
    if (!value) return null;
    return (
        <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0"
            title="Copy"
            onClick={() => {
                void navigator.clipboard.writeText(value).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1200);
                });
            }}
        >
            {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
        </Button>
    );
}

export default function PartyBankTab({ party, initialBank, canEdit, onSaved }: Props) {
    const initial = parsePartyBank(initialBank);
    const [bank, setBank] = useState<PartyBankFields>(initial);
    const [baseline, setBaseline] = useState<PartyBankFields>(initial);
    const [saving, setSaving] = useState(false);

    const set = (key: keyof PartyBankFields, value: string) =>
        setBank((b) => ({ ...b, [key]: value }));
    const ifsc = useIfscLookup(bank, (patch) => setBank((b) => ({ ...b, ...patch })));

    const isDirty = JSON.stringify(bank) !== JSON.stringify(baseline);
    const ifscBad = !isValidIfsc(bank.ifsc);
    const vpaBad = !isValidVpa(bank.upiVpa);
    // The QR follows the field as it is typed, so staff see it appear the moment
    // the UPI id is complete — and see nothing while it is still half-typed.
    const upiLink = vpaBad ? "" : buildPartyUpiLink(bank, party.name);

    const save = async () => {
        setSaving(true);
        try {
            const base = party.kind === "person" ? "/api/person" : "/api/companies";
            // An all-blank form clears the account rather than storing six empty
            // strings — the API turns `null` into a NULL column.
            await axios.put(`${base}/${party.id}`, {
                bankJson: hasPartyBankData(bank) ? bank : null,
            });
            setBaseline(bank);
            toast.success("Bank details saved");
            onSaved();
        } catch (e) {
            toast.error(extractApiError(e, "Could not save the bank details"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="max-w-3xl space-y-6">
            <fieldset disabled={!canEdit} className={`space-y-6 border-0 p-0 ${canEdit ? "" : "opacity-60"}`}>
                {/* ── NEFT / RTGS ─────────────────────────────────────────── */}
                <div className="rounded-lg border border-border p-4">
                    <div className="mb-3 flex items-center gap-2">
                        <Landmark size={15} className="text-muted-foreground" />
                        <Label className="text-sm font-medium">Bank account (NEFT / RTGS / IMPS)</Label>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                        {PARTY_BANK_FIELDS.map((f) => (
                            <div key={f.key} className="space-y-1">
                                <Label className="text-xs text-muted-foreground">{f.label}</Label>
                                <div className="flex items-center gap-1">
                                    <Input
                                        className="h-9 text-sm"
                                        value={bank[f.key]}
                                        placeholder={f.placeholder}
                                        aria-invalid={f.key === "ifsc" && ifscBad}
                                        onChange={(e) =>
                                            f.key === "ifsc"
                                                ? ifsc.typeIfsc(e.target.value)
                                                : set(f.key, e.target.value)
                                        }
                                    />
                                    {f.copyable && <CopyButton value={bank[f.key]} />}
                                </div>
                            </div>
                        ))}
                    </div>
                    {ifscBad ? (
                        <p className="mt-2 text-xs text-destructive">
                            IFSC looks wrong — expected 4 letters, a 0, then 6 characters (e.g. SBIN0000123).
                        </p>
                    ) : (
                        <IfscLookupHint state={ifsc.state} onUse={ifsc.use} canUse={canEdit} className="mt-2" />
                    )}
                    <p className="mt-3 text-xs text-muted-foreground">
                        Used when we pay this {party.kind === "person" ? "person" : "company"} — a supplier
                        payout or a customer refund. Internal only; never printed on their invoice.
                    </p>
                </div>

                {/* ── UPI + QR ────────────────────────────────────────────── */}
                <div className="rounded-lg border border-border p-4">
                    <div className="mb-3 flex items-center gap-2">
                        <QrCode size={15} className="text-muted-foreground" />
                        <Label className="text-sm font-medium">UPI</Label>
                    </div>
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                        <div className="min-w-0 flex-1 space-y-1">
                            <Label className="text-xs text-muted-foreground">UPI id (VPA)</Label>
                            <div className="flex items-center gap-1">
                                <Input
                                    className="h-9 text-sm"
                                    value={bank.upiVpa}
                                    placeholder="party@okhdfcbank"
                                    aria-invalid={vpaBad}
                                    onChange={(e) => set("upiVpa", e.target.value.trim())}
                                />
                                <CopyButton value={bank.upiVpa} />
                            </div>
                            {vpaBad ? (
                                <p className="text-xs text-destructive">
                                    UPI id looks wrong — expected something like party@okhdfcbank.
                                </p>
                            ) : (
                                <p className="text-xs text-muted-foreground">
                                    Scan the code from any UPI app to pay this party — the amount is typed in
                                    the app, so one saved code covers every payment.
                                </p>
                            )}
                        </div>
                        <div className="flex w-full shrink-0 justify-center sm:w-auto">
                            {upiLink ? (
                                <div className="rounded-md border border-border bg-white p-2">
                                    <QrSvg value={upiLink} size={140} />
                                </div>
                            ) : (
                                <div className="flex h-[156px] w-[156px] items-center justify-center rounded-md border border-dashed border-border text-center text-xs text-muted-foreground">
                                    Enter a UPI id<br />to get the QR
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <Button type="button" size="sm" disabled={!isDirty || saving || ifscBad || vpaBad} onClick={() => void save()}>
                        {saving ? "Saving…" : "Save bank details"}
                    </Button>
                    {isDirty && !saving && (
                        <Button type="button" size="sm" variant="ghost" onClick={() => setBank(baseline)}>
                            Discard
                        </Button>
                    )}
                    {!isDirty && !hasPartyBankData(bank) && (
                        <span className="text-xs text-muted-foreground">No bank details on file yet.</span>
                    )}
                </div>
            </fieldset>

            {!canEdit && (
                <p className="text-xs text-muted-foreground">
                    You can read these details but not change them — that needs Contacts edit rights.
                </p>
            )}
        </div>
    );
}
