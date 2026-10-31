"use client";

// Fix a customer's spelling, addresses or contacts from the counter without leaving
// the bill. Every phone row shows (add / edit / remove / make main); a person's
// addresses use the office's own AddressBook, a company keeps its one address box. Details is open to every cashier (same as the office's party PUT);
// Advanced carries the office's own credit-limit and group cards behind
// the same Role tick the office uses (customers:edit) — the APIs
// check it again. Saves through the office party endpoints, so the GSTIN ↔
// state check and the "parties" realtime refresh (the counter's party search
// list) come along for free.

import { useEffect, useState, type FormEvent } from "react";
import { useSession } from "next-auth/react";
import { useValueChange } from "@/shared/hooks";
import axios from "axios";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Star, Trash2 } from "lucide-react";
import AddressBook from "@/shared/components/address/AddressBook";
import CustomerLinkPanel from "@/modules/customer/components/CustomerLinkPanel";
import CustomerGroupCard from "@/modules/customer/components/CustomerGroupCard";
import AccountCreditLimitCard from "@/modules/customer/components/AccountCreditLimitCard";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { extractApiError } from "@/shared/lib/api";
import { usePosDraftStore } from "@/store/posDraftStore";
import { type Snapshot } from "@/modules/pos/lib/posDraftTypes";

type Party = Snapshot["party"];
type Contact = { id: number; value: string } | null;
type Form = { name: string; address: string; gstin: string; email: string };
// id null = a row added here, not saved yet. The first row is the main one.
type PhoneRow = { id: number | null; value: string; key: number };
let phoneKey = 0;
const phoneRowOf = (id: number | null, value: string): PhoneRow => ({ id, value, key: ++phoneKey });

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
    const [creditLimit, setCreditLimit] = useState<string | number | null>(null);
    const [groupId, setGroupId] = useState<number | null>(null);
    const isPerson = party.kind === "person";
    const base = party.kind === "person" ? `/api/person/${party.id}` : `/api/companies/${party.id}`;

    const [form, setForm] = useState<Form>({ name: "", address: "", gstin: "", email: "" });
    // Phones as loaded (to diff on save) and as edited, main first.
    // A person's linked companies — the office's link panel, saved on its own.
    const [companyLinks, setCompanyLinks] = useState<React.ComponentProps<typeof CustomerLinkPanel>["links"]>([]);
    const [savedPhones, setSavedPhones] = useState<{ id: number; value: string }[]>([]);
    const [phones, setPhones] = useState<PhoneRow[]>([]);
    // The primary email row — a change edits that row, an empty one adds.
    const [emailRow, setEmailRow] = useState<Contact>(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    // Load from the party record, not the snapshot: the snapshot's phone may be a
    // derived one (a company's linked person), which is not this party's to edit.
    // Seed from the snapshot while rendering (no flash of the last customer), then
    // the effect below reads the record itself.
    const loadFor = open ? JSON.stringify([base, party.kind, party.name, party.address, party.gstin]) : null;
    if (useValueChange(loadFor, null) && loadFor !== null) {
        setLoading(true);
        setForm({ name: party.name, address: party.address ?? "", gstin: party.gstin ?? "", email: "" });
        setPhones([]);
    }
    useEffect(() => {
        if (!open) return;
        axios.get(base)
            .then(({ data }) => {
                const phones: { id: number; value: string }[] = party.kind === "person"
                    ? (data.phones ?? []).map((p: { id: number; phone: string }) => ({ id: p.id, value: p.phone }))
                    : data.contactRows?.phones ?? [];
                const emails: { id: number; value: string }[] = party.kind === "person"
                    ? (data.emails ?? []).map((e: { id: number; email: string }) => ({ id: e.id, value: e.email }))
                    : data.contactRows?.emails ?? [];
                setCreditLimit(data.creditLimit ?? null);
                setCompanyLinks(data.companies ?? []);
                setGroupId(data.customerGroupId ?? null);
                setSavedPhones(phones);
                setPhones(phones.length ? phones.map((p) => phoneRowOf(p.id, p.value)) : [phoneRowOf(null, "")]);
                setEmailRow(emails[0] ?? null);
                setForm({
                    name: data.name ?? party.name,
                    address: data.address ?? "",
                    gstin: data.gstin ?? "",
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

    // The person's main address may have changed in the address book — bills print
    // Person.address, so re-read it and patch the panel.
    const refreshAddress = () => {
        void axios.get(base).then(({ data }) => {
            const address = data.address ?? null;
            setForm((f) => ({ ...f, address: address ?? "" }));
            setSnapshot((s) => s && s.party.id === party.id && s.party.kind === party.kind
                ? { ...s, party: { ...s.party, address } }
                : s);
        }).catch(() => {});
    };

    // A link changes the panel's company list, so re-read the snapshot too.
    const refreshLinks = () => {
        void axios.get(base).then(({ data }) => setCompanyLinks(data.companies ?? [])).catch(() => {});
        if (accountId == null) return;
        void axios.get<Snapshot>(`/api/pos/account-snapshot/${accountId}`)
            .then(({ data }) => setSnapshot((s) => (s?.account?.id === accountId ? data : s)))
            .catch(() => {});
    };

    const setPhone = (key: number, value: string) =>
        setPhones((rows) => rows.map((r) => (r.key === key ? { ...r, value } : r)));
    const removePhone = (row: PhoneRow) => {
        if (row.id != null && !window.confirm(`Remove ${row.value || "this number"} from the customer?`)) return;
        setPhones((rows) => {
            const next = rows.filter((r) => r.key !== row.key);
            return next.length ? next : [phoneRowOf(null, "")];
        });
    };
    const makeMain = (key: number) =>
        setPhones((rows) => [...rows.filter((r) => r.key === key), ...rows.filter((r) => r.key !== key)]);

    // Deletes first (frees a number moved between rows), then edits and adds, and
    // last marks the first row main if it is not already. Returns the main number.
    const savePhones = async () => {
        const kept = phones.filter((r) => r.value.trim());
        const keptIds = new Set(kept.map((r) => r.id).filter((id): id is number => id != null));
        for (const old of savedPhones) {
            if (!keptIds.has(old.id)) await axios.delete(`${base}/phones/${old.id}`);
        }
        const ids: number[] = [];
        for (const row of kept) {
            const v = row.value.trim();
            if (row.id == null) {
                const { data } = await axios.post<{ id: number }>(`${base}/phones`, { value: v, isPrimary: false });
                ids.push(data.id);
            } else {
                if (v !== savedPhones.find((p) => p.id === row.id)?.value) await axios.patch(`${base}/phones/${row.id}`, { value: v });
                ids.push(row.id);
            }
        }
        if (ids.length && ids[0] !== savedPhones.find((p) => keptIds.has(p.id))?.id) {
            await axios.patch(`${base}/phones/${ids[0]}`, { isPrimary: true });
        }
        return kept[0]?.value.trim() ?? null;
    };

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
            // A person's address lives in the address book, which saves on its own.
            await axios.put(base, isPerson
                ? { name, gstin: form.gstin.trim().toUpperCase() }
                : { name, address: form.address.trim() || null, gstin: form.gstin.trim().toUpperCase() });
            const mainPhone = await savePhones();
            await saveContact("emails", emailRow, form.email);
            // Patch the panel in place — the bill keeps its cart and customer.
            setSnapshot((s) => s && s.party.id === party.id && s.party.kind === party.kind
                ? {
                    ...s,
                    party: {
                        ...s.party,
                        name,
                        ...(isPerson ? {} : { address: form.address.trim() || null }),
                        gstin: form.gstin.trim().toUpperCase() || null,
                        phone: mainPhone || s.party.phone,
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
            <DialogContent className="max-h-[90vh] overflow-y-auto overflow-x-hidden sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>Edit customer</DialogTitle>
                </DialogHeader>
                <Tabs defaultValue="details">
                {canCredit && (
                    <TabsList className="w-full">
                        <TabsTrigger value="details" className="flex-1">Details</TabsTrigger>
                        <TabsTrigger value="advanced" className="flex-1">Advanced</TabsTrigger>
                    </TabsList>
                )}
                <TabsContent value="details">
                <form id="pec-form" onSubmit={onSubmit} className="space-y-3">
                    <div className="space-y-1">
                        <Label htmlFor="pec-name">Name</Label>
                        <Input id="pec-name" value={form.name} onChange={set("name")} disabled={loading} autoFocus />
                    </div>
                    <div className="space-y-1">
                        <Label>Phones</Label>
                        {phones.map((row, i) => (
                            <div key={row.key} className="flex items-center gap-1">
                                <Input
                                    type="tel"
                                    inputMode="tel"
                                    aria-label={i === 0 ? "Main phone" : "Phone"}
                                    value={row.value}
                                    onChange={(e) => setPhone(row.key, e.target.value)}
                                    disabled={loading}
                                    className="flex-1"
                                />
                                <Button type="button" variant="ghost" size="icon-xs" disabled={loading || i === 0}
                                    onClick={() => makeMain(row.key)} title={i === 0 ? "Main number" : "Make main"}>
                                    <Star className={i === 0 ? "size-4 fill-amber-400 text-amber-500" : "size-4"} />
                                </Button>
                                <Button type="button" variant="ghost" size="icon-xs" disabled={loading}
                                    onClick={() => removePhone(row)} title="Remove number">
                                    <Trash2 className="size-4" />
                                </Button>
                            </div>
                        ))}
                        <Button type="button" variant="outline" size="sm" disabled={loading}
                            onClick={() => setPhones((rows) => [...rows, phoneRowOf(null, "")])}>
                            <Plus className="size-4" /> Add phone
                        </Button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                        <div className="space-y-1">
                            <Label htmlFor="pec-email">Email</Label>
                            <Input id="pec-email" type="email" value={form.email} onChange={set("email")} disabled={loading} />
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="pec-gstin">GSTIN</Label>
                            <Input id="pec-gstin" value={form.gstin} onChange={set("gstin")} disabled={loading} className="font-mono uppercase" maxLength={15} />
                        </div>
                    </div>
                    {!isPerson && (
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
                    )}
                </form>
                {/* Outside the form: these panels' own buttons would otherwise submit it.
                    Each saves on its own; the main address is what bills print. */}
                {isPerson && !loading && (
                    <div className="mt-3 space-y-3">
                        <div className="space-y-1">
                            <Label>Addresses</Label>
                            <AddressBook apiBase={`${base}/addresses`} emptyText="No address added." onChanged={refreshAddress} />
                        </div>
                        <CustomerLinkPanel customerId={party.id} links={companyLinks} onChanged={refreshLinks} />
                    </div>
                )}
                <DialogFooter className="mt-3">
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
                    <Button type="submit" form="pec-form" disabled={saving || loading}>{saving ? "Saving…" : "Save"}</Button>
                </DialogFooter>
                </TabsContent>
                <TabsContent value="advanced" className="min-h-[460px] grid items-start gap-3 md:grid-cols-2">
                    {canCredit && !loading && (
                        <>
                            <AccountCreditLimitCard
                                key={`cl-${accountId}`}
                                accountId={accountId!}
                                initialLimit={creditLimit}
                                canEdit
                                onSaved={refreshAdvanced}
                            />
                            <CustomerGroupCard
                                key={`cg-${party.kind}-${party.id}`}
                                party={{ kind: party.kind, id: party.id }}
                                initialGroupId={groupId}
                                onSaved={refreshAdvanced}
                            />
                        </>
                    )}
                </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}
