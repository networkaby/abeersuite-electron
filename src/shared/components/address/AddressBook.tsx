"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { MapPin, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { formatAddress, type AddressRow } from "@/shared/lib/address/address";
import AddressForm, { EMPTY_ADDRESS_DRAFT, fromDraft, toDraft, type AddressDraft } from "./AddressForm";

/**
 * A customer's address book — list, add, edit, delete, make main. The office
 * profile and the portal's Addresses page both use it; only `apiBase` differs
 * (`/api/person/<id>/addresses` or `/api/portal/addresses`). Writes are
 * optimistic where the result is known, and roll back on failure.
 */
export default function AddressBook({
    apiBase,
    showRecipient = false,
    emptyText = "No address yet.",
    onChanged,
}: {
    apiBase: string;
    showRecipient?: boolean;
    emptyText?: string;
    /** After any saved change — e.g. the office header re-reads Person.address. */
    onChanged?: () => void;
}) {
    const [rows, setRows] = useState<AddressRow[] | null>(null);
    // null = closed, 0 = adding, id = editing that row.
    const [editing, setEditing] = useState<number | null>(null);
    const [draft, setDraft] = useState<AddressDraft>(EMPTY_ADDRESS_DRAFT);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        axios
            .get<{ addresses: AddressRow[] }>(apiBase)
            .then((r) => setRows(r.data.addresses))
            .catch((e) => {
                setRows([]);
                toast.error(extractApiError(e, "Could not load addresses"));
            });
    }, [apiBase]);

    const reload = async () => {
        setRows((await axios.get<{ addresses: AddressRow[] }>(apiBase)).data.addresses);
        onChanged?.();
    };

    function open(row: AddressRow | null) {
        setDraft(row ? toDraft(row) : EMPTY_ADDRESS_DRAFT);
        setEditing(row ? row.id : 0);
    }

    async function save() {
        if (!draft.line1.trim()) {
            toast.error("Enter address line 1");
            return;
        }
        setSaving(true);
        try {
            if (editing) await axios.patch(`${apiBase}/${editing}`, fromDraft(draft));
            else await axios.post(apiBase, fromDraft(draft));
            await reload();
            setEditing(null);
            toast.success("Address saved");
        } catch (e) {
            toast.error(extractApiError(e, "Could not save the address"));
        } finally {
            setSaving(false);
        }
    }

    async function remove(row: AddressRow) {
        if (!window.confirm(`Delete this address?\n${formatAddress(row)}`)) return;
        const before = rows;
        setRows((r) => r?.filter((x) => x.id !== row.id) ?? r);
        try {
            await axios.delete(`${apiBase}/${row.id}`);
            // The main one may have moved to another row.
            await reload();
        } catch (e) {
            setRows(before);
            toast.error(extractApiError(e, "Could not delete"));
        }
    }

    async function makePrimary(row: AddressRow) {
        const before = rows;
        setRows((r) => r?.map((x) => ({ ...x, isPrimary: x.id === row.id })) ?? r);
        try {
            await axios.patch(`${apiBase}/${row.id}`, { ...fromDraft(toDraft(row)), makePrimary: true });
            onChanged?.();
        } catch (e) {
            setRows(before);
            toast.error(extractApiError(e, "Could not change the main address"));
        }
    }

    const form = (
        <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
            <AddressForm value={draft} onChange={setDraft} showRecipient={showRecipient} />
            <div className="flex gap-2">
                <Button size="sm" onClick={() => void save()} disabled={saving}>
                    {saving ? "Saving…" : "Save address"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)} disabled={saving}>
                    Cancel
                </Button>
            </div>
        </div>
    );

    return (
        <div className="space-y-2">
            {rows === null && <p className="text-sm text-muted-foreground">Loading…</p>}
            {rows?.length === 0 && editing === null && <p className="text-sm text-muted-foreground">{emptyText}</p>}
            {rows?.map((r) =>
                editing === r.id ? (
                    <div key={r.id}>{form}</div>
                ) : (
                    <div key={r.id} className="flex items-start gap-3 rounded-lg border p-3">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                            <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                                {r.label || "Address"}
                                {r.isPrimary && <span className="rounded bg-primary/10 px-1.5 text-[11px] font-medium text-primary">Main</span>}
                            </p>
                            {(r.name || r.phone) && <p className="text-xs text-muted-foreground">{[r.name, r.phone].filter(Boolean).join(" · ")}</p>}
                            <p className="text-sm text-muted-foreground">{formatAddress(r)}</p>
                            {!r.pincode && <p className="text-xs text-amber-600 dark:text-amber-400">Add the PIN code so it can be used for delivery.</p>}
                        </div>
                        <div className="flex shrink-0 gap-1">
                            {!r.isPrimary && (
                                <Button size="icon" variant="ghost" className="h-7 w-7" title="Make main address" onClick={() => void makePrimary(r)}>
                                    <Star className="h-3.5 w-3.5" />
                                </Button>
                            )}
                            <Button size="icon" variant="ghost" className="h-7 w-7" title="Edit" onClick={() => open(r)} disabled={editing !== null}>
                                <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" title="Delete" onClick={() => void remove(r)} disabled={editing !== null}>
                                <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                    </div>
                ),
            )}
            {editing === 0 && form}
            {editing === null && rows !== null && (
                <Button size="sm" variant="outline" onClick={() => open(null)}>
                    <Plus className="mr-1 h-3.5 w-3.5" /> Add address
                </Button>
            )}
        </div>
    );
}
