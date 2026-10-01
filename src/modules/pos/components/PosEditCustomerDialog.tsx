"use client";

// Fix a customer's spelling, address or contact from the counter without leaving
// the bill. Details is open to every cashier (same as the office's party PUT);
// Advanced carries the office's own credit-limit, group and password-reset cards behind
// the same Role ticks the office uses (customers:edit, users:edit) — the APIs
// check them again. Saves through the office party endpoints, so the GSTIN ↔
// state check and the "parties" realtime refresh (the counter's party search
// list) come along for free.

import { useEffect, useState, type FormEvent } from "react";
import { useSession } from "next-auth/react";
import axios from "axios";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import CustomerGroupCard from "@/modules/customer/components/CustomerGroupCard";
import AccountCreditLimitCard from "@/modules/customer/components/AccountCreditLimitCard";
import CustomerEmergencyPasswordResetCard from "@/modules/customer/components/CustomerEmergencyPasswordResetCard";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { extractApiError } from "@/shared/lib/api";
import { usePosDraftStore } from "@/store/posDraftStore";
import { type Snapshot } from "@/modules/pos/lib/posDraftTypes";

type Party = Snapshot["party"];
type Contact = { id: number; value: string } | null;
type Form = { name: string; address: string; gstin: string; phone: string; email: string };

export function PosEditCustomerDialog({ party, accountId, open, onOpenChange }: {
    party: Party;
    accountId: number | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const setSnapshot = usePosDraftStore((s) => s.setSnapshot);
    const { data: session } = useSession();
    const perms = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const canCredit = accountId != null && hasPermissionWithScope(perms, PERMISSIONS.CUSTOMERS_EDIT);
    // The portal login is a person's — a company has none.
    const canPassword = party.kind === "person" && hasPermissionWithScope(perms, PERMISSIONS.USERS_EDIT);
    const [creditLimit, setCreditLimit] = useState<string | number | null>(null);
    const [groupId, setGroupId] = useState<number | null>(null);
    const base = party.kind === "person" ? `/api/person/${party.id}` : `/api/companies/${party.id}`;

    const [form, setForm] = useState<Form>({ name: "", address: "", gstin: "", phone: "", email: "" });
    // The primary phone / email rows — a change edits that row, an empty one adds.
    const [phoneRow, setPhoneRow] = useState<Contact>(null);
    const [emailRow, setEmailRow] = useState<Contact>(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    // Load from the party record, not the snapshot: the snapshot's phone may be a
    // derived one (a company's linked person), which is not this party's to edit.
    useEffect(() => {
        if (!open) return;
        setLoading(true);
        setForm({ name: party.name, address: party.address ?? "", gstin: party.gstin ?? "", phone: "", email: "" });
        axios.get(base)
            .then(({ data }) => {
                const phones: { id: number; value: string }[] = party.kind === "person"
                    ? (data.phones ?? []).map((p: { id: number; phone: string }) => ({ id: p.id, value: p.phone }))
                    : data.contactRows?.phones ?? [];
                const emails: { id: number; value: string }[] = party.kind === "person"
                    ? (data.emails ?? []).map((e: { id: number; email: string }) => ({ id: e.id, value: e.email }))
                    : data.contactRows?.emails ?? [];
                setCreditLimit(data.creditLimit ?? null);
                setGroupId(data.customerGroupId ?? null);
                setPhoneRow(phones[0] ?? null);
                setEmailRow(emails[0] ?? null);
                setForm({
                    name: data.name ?? party.name,
                    address: data.address ?? "",
                    gstin: data.gstin ?? "",
                    phone: phones[0]?.value ?? "",
                    email: emails[0]?.value ?? "",
                });
            })
            .catch((e) => toast.error(extractApiError(e, "Could not load customer")))
            .finally(() => setLoading(false));
    }, [open, base, party.kind, party.name, party.address, party.gstin]);

    // Credit limit and group both feed the panel (Avail. credit, group prices), so
    // after either one re-read the whole snapshot rather than patching by hand.
    const refreshAdvanced = () => {
        void axios.get(base).then(({ data }) => {
            setCreditLimit(data.creditLimit ?? null);
            setGroupId(data.customerGroupId ?? null);
        }).catch(() => {});
        if (accountId == null) return;
        void axios.get<Snapshot>(`/api/pos/account-snapshot/${accountId}`)
            .then(({ data }) => setSnapshot((s) => (s?.account?.id === accountId ? data : s)))
            .catch(() => {});
    };

    const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setForm((f) => ({ ...f, [k]: e.target.value }));

    const saveContact = async (kind: "phones" | "emails", row: Contact, value: string) => {
        const v = value.trim();
        if (v === (row?.value ?? "")) return;
        if (row && v) await axios.patch(`${base}/${kind}/${row.id}`, { value: v });
        else if (row) await axios.delete(`${base}/${kind}/${row.id}`);
        else if (v) await axios.post(`${base}/${kind}`, { value: v, isPrimary: true });
    };

    const onSubmit = async (e: FormEvent) => {
        e.preventDefault();
        const name = form.name.trim();
        if (!name) { toast.error("Name is required"); return; }
        setSaving(true);
        try {
            await axios.put(base, { name, address: form.address.trim() || null, gstin: form.gstin.trim().toUpperCase() });
            await saveContact("phones", phoneRow, form.phone);
            await saveContact("emails", emailRow, form.email);
            // Patch the panel in place — the bill keeps its cart and customer.
            setSnapshot((s) => s && s.party.id === party.id && s.party.kind === party.kind
                ? {
                    ...s,
                    party: {
                        ...s.party,
                        name,
                        address: form.address.trim() || null,
                        gstin: form.gstin.trim().toUpperCase() || null,
                        phone: form.phone.trim() || s.party.phone,
                        email: form.email.trim() || null,
                    },
                }
                : s);
            toast.success("Customer updated");
            onOpenChange(false);
        } catch (err) {
            toast.error(extractApiError(err, "Could not save customer"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Edit customer</DialogTitle>
                </DialogHeader>
                <Tabs defaultValue="details">
                {(canCredit || canPassword) && (
                    <TabsList className="w-full">
                        <TabsTrigger value="details" className="flex-1">Details</TabsTrigger>
                        <TabsTrigger value="advanced" className="flex-1">Advanced</TabsTrigger>
                    </TabsList>
                )}
                <TabsContent value="details">
                <form onSubmit={onSubmit} className="space-y-3">
                    <div className="space-y-1">
                        <Label htmlFor="pec-name">Name</Label>
                        <Input id="pec-name" value={form.name} onChange={set("name")} disabled={loading} autoFocus />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                            <Label htmlFor="pec-phone">Phone</Label>
                            <Input id="pec-phone" type="tel" inputMode="tel" value={form.phone} onChange={set("phone")} disabled={loading} />
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="pec-email">Email</Label>
                            <Input id="pec-email" type="email" value={form.email} onChange={set("email")} disabled={loading} />
                        </div>
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="pec-gstin">GSTIN</Label>
                        <Input id="pec-gstin" value={form.gstin} onChange={set("gstin")} disabled={loading} className="font-mono uppercase" maxLength={15} />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="pec-address">Address</Label>
                        <textarea
                            id="pec-address"
                            value={form.address}
                            onChange={set("address")}
                            disabled={loading}
                            rows={3}
                            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                        />
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
                        <Button type="submit" disabled={saving || loading}>{saving ? "Saving…" : "Save"}</Button>
                    </DialogFooter>
                </form>
                </TabsContent>
                <TabsContent value="advanced" className="space-y-3">
                    {canCredit && !loading && (
                        <AccountCreditLimitCard
                            key={`cl-${accountId}`}
                            accountId={accountId!}
                            initialLimit={creditLimit}
                            canEdit
                            onSaved={refreshAdvanced}
                        />
                    )}
                    {canCredit && !loading && (
                        <CustomerGroupCard
                            key={`cg-${party.kind}-${party.id}`}
                            party={{ kind: party.kind, id: party.id }}
                            initialGroupId={groupId}
                            onSaved={refreshAdvanced}
                        />
                    )}
                    {canPassword && <CustomerEmergencyPasswordResetCard customerId={party.id} />}
                </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}
