"use client";

// "Personal & Bank" on a person's own profile page. The fields HR needs on file
// that the person themselves knows best — kept current by them, readable by HR.
// Text fields save on blur (Pattern D); the bank account is one bag, saved
// whole, with the same checks as a customer's bank tab.

import { useState } from "react";
import axios from "axios";
import Link from "next/link";
import { toast } from "sonner";
import { IdCard, Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/shared/components/Field";
import { FieldSaveMark } from "@/shared/components/FieldSaveMark";
import { QueryStateBlock } from "@/shared/components/QueryStateBlock";
import { IfscLookupHint } from "@/shared/components/IfscLookupHint";
import { useApiResource, useFieldSave, useIfscLookup } from "@/shared/hooks";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import {
    PARTY_BANK_FIELDS, hasPartyBankData, isValidIfsc, isValidVpa, parsePartyBank,
    type PartyBankFields,
} from "@/shared/lib/parties/partyBank";
import type { StaffDetail, StaffProfileDto } from "../lib/staffTypes";
import { STAFF_PHONE_HINT } from "@/shared/lib/schemas/commonSchemas";

type TextKey = "fatherName" | "address" | "bloodGroup" | "emergencyName" | "emergencyPhone" | "aadhaarLast4" | "panNumber" | "uanNumber" | "esiNumber" | "notes";

const TEXT_FIELDS: { key: TextKey; label: string; placeholder?: string; hint?: string; wide?: boolean; multiline?: boolean }[] = [
    { key: "fatherName",     label: "Father's / guardian's name" },
    { key: "bloodGroup",     label: "Blood group", placeholder: "O+" },
    { key: "address",        label: "Address", wide: true, multiline: true },
    { key: "emergencyName",  label: "Emergency contact — name" },
    { key: "emergencyPhone", label: "Emergency contact — phone", placeholder: STAFF_PHONE_HINT },
    { key: "aadhaarLast4",   label: "Aadhaar — last 4 digits", placeholder: "1234", hint: "Only the last four digits are kept." },
    { key: "panNumber",      label: "PAN", placeholder: "ABCDE1234F" },
    { key: "uanNumber",      label: "UAN (PF)", placeholder: "12 digits" },
    { key: "esiNumber",      label: "ESI number" },
    { key: "notes",          label: "Notes", wide: true, multiline: true },
];

export default function StaffPersonalForm({ userId, canEdit, hrHref }: {
    userId: number;
    canEdit: boolean;
    /** Shown to viewers who may open the HR profile — the job / pay / money side. */
    hrHref?: string | null;
}) {
    const url = `/api/hr/staff/${userId}`;
    const { data, loading, error, reload } = useApiResource<StaffDetail>(url);
    const { save, stateOf } = useFieldSave();

    // What the server holds right now, field by field.
    //
    // `data` is fetched once and is NOT refetched after a blur-save, so using it
    // as each field's "before" froze every comparison at page-load. Clearing a
    // box you had just filled then did nothing at all: the empty box matched the
    // stale original, so useFieldSave's rule 1 ("a tab-through is not an edit")
    // skipped the write and the old value stayed in the database, with no tick
    // and no toast to say so. The PATCH hands the whole record back, so moving
    // the baseline on with every save costs no extra GET. It is tagged with the
    // fetch it was saved over, so a reload (the bank block does one) hands the
    // baseline straight back to the fresh server copy.
    const [saved, setSaved] = useState<{ from: StaffDetail; profile: StaffProfileDto | null } | null>(null);
    const profile = (saved && saved.from === data ? saved.profile : data?.profile) ?? null;

    // `box` is the input the value came from. The server normalises some fields
    // (a PAN comes back upper-cased), so the box is put in step with what was
    // actually stored — otherwise the next tab-through would look like an edit
    // and write again. Skipped if the user has already clicked back in, so a
    // slow save can never overwrite what they are typing now.
    const patch = async (body: Record<string, unknown>, box?: HTMLInputElement | HTMLTextAreaElement) => {
        const res = await axios.patch<StaffDetail>(url, body);
        if (data) setSaved({ from: data, profile: res.data.profile });
        if (box && document.activeElement !== box) {
            const key = Object.keys(body)[0] as TextKey;
            box.value = res.data.profile?.[key] ?? "";
        }
        return res;
    };

    return (
        <div className="max-w-2xl space-y-6">
            {hrHref && (
                <Button asChild variant="outline" size="sm">
                    <Link href={hrHref}><IdCard size={14} /> HR profile — job, pay, money</Link>
                </Button>
            )}

            <QueryStateBlock loading={loading} error={error} hasData={!!data} onRetry={reload} />

            {data && (
                <>
                    <fieldset disabled={!canEdit} className="grid gap-4 border-0 p-0 sm:grid-cols-2">
                        {TEXT_FIELDS.map((f) => (
                            <div key={f.key} className={f.wide ? "sm:col-span-2" : undefined}>
                                <Field label={f.label} hint={f.hint}>
                                    {(id) => (
                                        <div className="flex items-start gap-1">
                                            {f.multiline ? (
                                                <Textarea
                                                    id={id}
                                                    defaultValue={profile?.[f.key] ?? ""}
                                                    rows={2}
                                                    className="text-sm"
                                                    onBlur={(e) => void save({
                                                        key: f.key,
                                                        original: profile?.[f.key] ?? "",
                                                        next: e.target.value.trim(),
                                                        write: (v) => patch({ [f.key]: v || null }, e.target),
                                                        revert: (v) => { e.target.value = v; },
                                                        label: f.label,
                                                    })}
                                                />
                                            ) : (
                                                <Input
                                                    id={id}
                                                    defaultValue={profile?.[f.key] ?? ""}
                                                    placeholder={f.placeholder}
                                                    className="h-9 text-sm"
                                                    onBlur={(e) => void save({
                                                        key: f.key,
                                                        original: profile?.[f.key] ?? "",
                                                        next: e.target.value.trim(),
                                                        write: (v) => patch({ [f.key]: v || null }, e.target),
                                                        revert: (v) => { e.target.value = v; },
                                                        label: f.label,
                                                    })}
                                                />
                                            )}
                                            <FieldSaveMark state={stateOf(f.key)} className="mt-2.5" />
                                        </div>
                                    )}
                                </Field>
                            </div>
                        ))}
                    </fieldset>

                    <BankBlock profile={profile} canEdit={canEdit} onSave={(bank) => patch({ bankJson: bank })} onSaved={reload} />

                    {!canEdit && (
                        <p className="text-xs text-muted-foreground">These details can be changed by the person themselves or by HR.</p>
                    )}
                </>
            )}
        </div>
    );
}

function BankBlock({ profile, canEdit, onSave, onSaved }: {
    profile: StaffProfileDto | null;
    canEdit: boolean;
    onSave: (bank: PartyBankFields | null) => Promise<unknown>;
    onSaved: () => void;
}) {
    const initial = parsePartyBank(profile?.bankJson);
    const [bank, setBank] = useState<PartyBankFields>(initial);
    const [baseline, setBaseline] = useState<PartyBankFields>(initial);
    const [saving, setSaving] = useState(false);

    const set = (key: keyof PartyBankFields, value: string) => setBank((b) => ({ ...b, [key]: value }));
    const ifsc = useIfscLookup(bank, (patch) => setBank((b) => ({ ...b, ...patch })));
    const isDirty = JSON.stringify(bank) !== JSON.stringify(baseline);
    const ifscBad = !isValidIfsc(bank.ifsc);
    const vpaBad = !isValidVpa(bank.upiVpa);

    const submit = async () => {
        setSaving(true);
        try {
            // An all-blank form clears the account rather than storing six empty strings.
            await onSave(hasPartyBankData(bank) ? bank : null);
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
        <fieldset disabled={!canEdit} className={`rounded-lg border border-border p-4 ${canEdit ? "" : "opacity-60"}`}>
            <div className="mb-3 flex items-center gap-2">
                <Landmark size={15} className="text-muted-foreground" />
                <span className="text-sm font-medium">Bank account — where salary is paid</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
                {PARTY_BANK_FIELDS.map((f) => (
                    <Field key={f.key} label={f.label}>
                        {(id) => (
                            <Input
                                id={id}
                                className="h-9 text-sm"
                                value={bank[f.key]}
                                placeholder={f.placeholder}
                                aria-invalid={f.key === "ifsc" && ifscBad}
                                onChange={(e) => (f.key === "ifsc" ? ifsc.typeIfsc(e.target.value) : set(f.key, e.target.value))}
                            />
                        )}
                    </Field>
                ))}
                <Field label="UPI id (VPA)">
                    {(id) => (
                        <Input
                            id={id}
                            className="h-9 text-sm"
                            value={bank.upiVpa}
                            placeholder="name@okhdfcbank"
                            aria-invalid={vpaBad}
                            onChange={(e) => set("upiVpa", e.target.value.trim())}
                        />
                    )}
                </Field>
            </div>
            {ifscBad
                ? <p className="mt-2 text-xs text-destructive">IFSC looks wrong — expected 4 letters, a 0, then 6 characters (e.g. SBIN0000123).</p>
                : <IfscLookupHint state={ifsc.state} onUse={ifsc.use} canUse={canEdit} className="mt-2" />}
            {vpaBad && <p className="mt-2 text-xs text-destructive">UPI id looks wrong — expected something like name@okhdfcbank.</p>}
            <div className="mt-3 flex items-center gap-3">
                <Button type="button" size="sm" disabled={!isDirty || saving || ifscBad || vpaBad} onClick={() => void submit()}>
                    {saving ? "Saving…" : "Save bank details"}
                </Button>
                {isDirty && !saving && (
                    <Button type="button" size="sm" variant="ghost" onClick={() => setBank(baseline)}>Discard</Button>
                )}
                {!isDirty && !hasPartyBankData(bank) && (
                    <span className="text-xs text-muted-foreground">No bank details on file yet.</span>
                )}
            </div>
        </fieldset>
    );
}
