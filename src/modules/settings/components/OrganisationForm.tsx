"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { extractApiError } from "@/shared/lib/api";
import { Loader2, Save, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { OrganisationView } from "@/shared/lib/org/organisationView";

interface Props {
    initial: OrganisationView;
}

export function OrganisationForm({ initial }: Props) {
    const [form, setForm] = useState<OrganisationView>(initial);
    const [baseline, setBaseline] = useState<OrganisationView>(initial);
    const [saving, setSaving] = useState(false);

    const isDirty = JSON.stringify(form) !== JSON.stringify(baseline);

    function set<K extends keyof OrganisationView>(field: K, value: OrganisationView[K]) {
        setForm((prev) => {
            const next = { ...prev, [field]: value };
            // Keep gstStateCode in sync with the first 2 chars of GSTIN unless
            // the admin manually overrides it. Pure UX — the API does the same.
            if (field === "gstin" && typeof value === "string") {
                next.gstStateCode = value.length >= 2 ? value.slice(0, 2) : "";
            }
            return next;
        });
    }

    async function handleSave() {
        if (!isDirty) return;
        setSaving(true);
        try {
            const { data } = await axios.patch<OrganisationView>("/api/settings/organisation", form);
            setForm(data);
            setBaseline(data);
            toast.success("Organisation saved");
        } catch (err) {
            toast.error(extractApiError(err, "Save failed"));
        } finally {
            setSaving(false);
        }
    }

    function handleDiscard() {
        setForm(baseline);
    }

    return (
        <div className="space-y-4 max-w-3xl">
            {/* Sticky action bar */}
            <div className="flex items-center justify-between gap-2 rounded-lg border bg-card p-3">
                <p className="text-sm text-muted-foreground">
                    {isDirty ? "Unsaved changes" : "All changes saved"}
                </p>
                <div className="flex items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={handleDiscard} disabled={!isDirty || saving}>
                        <RotateCcw className="mr-1 size-3.5" /> Discard
                    </Button>
                    <Button size="sm" onClick={handleSave} disabled={!isDirty || saving}>
                        {saving
                            ? <Loader2 className="mr-1 size-3.5 animate-spin" />
                            : <Save className="mr-1 size-3.5" />}
                        Save
                    </Button>
                </div>
            </div>

            {/* Identity */}
            <Section title="Identity" description="Names shown on the storefront and on receipts.">
                <Field label="Brand name" hint="Customer-facing — appears on receipts and the storefront header.">
                    <Input value={form.brandName} onChange={(e) => set("brandName", e.target.value)} />
                </Field>
                <Field label="Legal name" hint="Used on tax invoices and contracts (often differs from brand).">
                    <Input value={form.legalName} onChange={(e) => set("legalName", e.target.value)} />
                </Field>
                <Field label="Tagline">
                    <Input value={form.tagline} onChange={(e) => set("tagline", e.target.value)} />
                </Field>
                <Field label="Logo URL" hint="Public URL (no upload UI yet). Shown on A4 letterhead when voucher template has 'Show logo' on.">
                    <Input value={form.logoUrl} onChange={(e) => set("logoUrl", e.target.value)} placeholder="https://…" />
                </Field>
            </Section>

            {/* Address */}
            <Section title="Address" description="One canonical postal address. Auto-formatted as a multi-line block on receipts.">
                <Field label="Address line 1">
                    <Input value={form.addressLine1} onChange={(e) => set("addressLine1", e.target.value)} />
                </Field>
                <Field label="Address line 2">
                    <Input value={form.addressLine2} onChange={(e) => set("addressLine2", e.target.value)} />
                </Field>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Field label="City">
                        <Input value={form.city} onChange={(e) => set("city", e.target.value)} />
                    </Field>
                    <Field label="State">
                        <Input value={form.state} onChange={(e) => set("state", e.target.value)} />
                    </Field>
                    <Field label="PIN code">
                        <Input
                            inputMode="numeric"
                            value={form.pinCode}
                            onChange={(e) => set("pinCode", e.target.value)}
                        />
                    </Field>
                </div>
                <Field label="Country">
                    <Input value={form.country} onChange={(e) => set("country", e.target.value)} />
                </Field>
            </Section>

            {/* Tax */}
            <Section title="Tax IDs" description="Printed on every tax invoice. State code auto-populates from the first two digits of GSTIN.">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                        <Field label="GSTIN" hint="15 characters. e.g. 18ABCDE1234F1Z5">
                            <Input
                                value={form.gstin}
                                onChange={(e) => set("gstin", e.target.value.toUpperCase().slice(0, 15))}
                                placeholder="00ABCDE1234F1Z5"
                            />
                        </Field>
                    </div>
                    <Field label="GST state code" hint="Read-only — derived from GSTIN.">
                        <Input value={form.gstStateCode} readOnly className="bg-muted/40" />
                    </Field>
                </div>
                <Field label="PAN" hint="10 characters. e.g. ABCDE1234F">
                    <Input
                        value={form.pan}
                        onChange={(e) => set("pan", e.target.value.toUpperCase().slice(0, 10))}
                        placeholder="ABCDE1234F"
                    />
                </Field>
            </Section>

            {/* Contact */}
            <Section title="Contact" description="Where customers reach you. Phone shows up on receipts; emails appear in order notifications.">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Phone">
                        <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
                    </Field>
                    <Field label="WhatsApp">
                        <Input value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} />
                    </Field>
                    <Field label="Email">
                        <Input value={form.email} onChange={(e) => set("email", e.target.value)} />
                    </Field>
                    <Field label="Support email">
                        <Input value={form.supportEmail} onChange={(e) => set("supportEmail", e.target.value)} />
                    </Field>
                </div>
                <Field label="Site URL">
                    <Input value={form.siteUrl} onChange={(e) => set("siteUrl", e.target.value)} />
                </Field>
                <Field label="Hours" hint="Free-form, e.g. 'Mon–Sat · 10:00 AM – 7:00 PM IST'.">
                    <Input value={form.hours} onChange={(e) => set("hours", e.target.value)} />
                </Field>
            </Section>

            {/* Bank details — printed on a voucher only when that template's
                "Bank details" toggle is on (Print Templates settings). */}
            <Section title="Bank details" description="Primary bank account for customer payments. Prints on vouchers where the 'Bank details' toggle is on.">
                <Field label="Beneficiary name" hint="Account holder as it should appear on the voucher.">
                    <Input value={form.bankBeneficiary} onChange={(e) => set("bankBeneficiary", e.target.value)} />
                </Field>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Bank name">
                        <Input value={form.bankName} onChange={(e) => set("bankName", e.target.value)} />
                    </Field>
                    <Field label="Account number">
                        <Input value={form.bankAccountNumber} onChange={(e) => set("bankAccountNumber", e.target.value)} />
                    </Field>
                    <Field label="IFSC">
                        <Input value={form.bankIfsc} onChange={(e) => set("bankIfsc", e.target.value)} />
                    </Field>
                    <Field label="Branch">
                        <Input value={form.bankBranch} onChange={(e) => set("bankBranch", e.target.value)} />
                    </Field>
                </div>
                <Field label="UPI ID" hint="Optional — e.g. shopname@okhdfcbank.">
                    <Input value={form.bankUpi} onChange={(e) => set("bankUpi", e.target.value)} />
                </Field>
            </Section>
        </div>
    );
}

function Section({
    title, description, children,
}: { title: string; description: string; children: React.ReactNode }) {
    return (
        <section className="rounded-lg border bg-card p-4 space-y-3">
            <header>
                <h2 className="text-sm font-semibold">{title}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
            </header>
            {children}
        </section>
    );
}

function Field({
    label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <div className="space-y-1.5">
            <Label className="text-xs font-medium">{label}</Label>
            {children}
            {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
        </div>
    );
}
