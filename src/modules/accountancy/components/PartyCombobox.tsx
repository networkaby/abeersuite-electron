"use client";

// PartyCombobox — Tally-style inline party search + create.
// Mirrors the first two steps of QuickTicketButton:
//   1. Search Customer + Company by name OR phone via /api/people?lookup=...
//   2. If no match, click "+ Create" to open a quick-create form that POSTs
//      to /api/people (which auto-creates the Sundry Debtors ledger).
// On select, returns the linked Account so the GL post hits the right party.

import { useEffect, useRef, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, User, Building2, X, UserPlus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

type LookupResponse = {
    id:              number;
    name:            string;
    phone:           string | null;
    type:            "customer" | "company";
    accountId:       number | null;
    linkedCompanies: { id: number; name: string; accountId: number | null }[];
};

export type SelectedParty = {
    accountId: number;
    partyId:   number;
    partyType: "customer" | "company";
    name:      string;
    phone:     string | null;
};

type Props = {
    value:    SelectedParty | null;
    onChange: (party: SelectedParty | null) => void;
    placeholder?: string;
    autoFocus?:   boolean;
    className?:   string;
    // Where to put the auto-created ledger when a brand-new party is created
    // from the dropdown's "+ Create" item. Defaults to Sundry Debtors.
    createUnderGroup?: "Sundry Debtors" | "Sundry Creditors";
};

export function PartyCombobox({
    value, onChange,
    placeholder      = "Search party by name or phone…",
    autoFocus        = false,
    className        = "",
    createUnderGroup = "Sundry Debtors",
}: Props) {
    // Local typed text — only relevant when no party is selected.
    // When a party IS selected we show value.name and ignore typedQuery, so we
    // never need to mirror value→state (which caused a race where typing over
    // a selection wiped the input).
    const [typedQuery, setTypedQuery] = useState("");
    const [results, setResults]         = useState<LookupResponse[]>([]);
    const [open, setOpen]               = useState(false);
    const [loading, setLoading]         = useState(false);
    const [highlighted, setHighlighted] = useState(0);
    const [createOpen, setCreateOpen]   = useState(false);
    const [createSeed, setCreateSeed]   = useState<{ name: string; phone: string }>({ name: "", phone: "" });
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Display value: selected name takes precedence over the search box buffer.
    const displayValue = value ? value.name : typedQuery;

    const search = useCallback((term: string) => {
        const q = term.trim();
        if (q.length < 1) { setResults([]); return; }
        setLoading(true);
        axios.get<LookupResponse[]>(`/api/people?lookup=${encodeURIComponent(q)}`)
            .then((r) => { setResults(r.data); setHighlighted(0); })
            .catch(() => setResults([]))
            .finally(() => setLoading(false));
    }, []);

    const handleQuery = (v: string) => {
        setTypedQuery(v);
        setOpen(true);
        // Typing always invalidates the previous selection — caller stays in sync.
        if (value) onChange(null);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => search(v), 200);
    };

    const select = (r: LookupResponse) => {
        if (!r.accountId) return;
        onChange({
            accountId: r.accountId,
            partyId:   r.id,
            partyType: r.type,
            name:      r.name,
            phone:     r.phone,
        });
        setTypedQuery("");
        setOpen(false);
    };

    const clear = () => {
        onChange(null);
        setTypedQuery("");
        setResults([]);
    };

    const openCreate = () => {
        const trimmed = displayValue.trim();
        const looksLikePhone = /^\+?[\d\s-]{6,}$/.test(trimmed);
        setCreateSeed({
            name:  looksLikePhone ? "" : trimmed,
            phone: looksLikePhone ? trimmed : "",
        });
        setCreateOpen(true);
        setOpen(false);
    };

    const onKey = (e: React.KeyboardEvent) => {
        if (!open) return;
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlighted((h) => Math.min(h + 1, results.length - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlighted((h) => Math.max(h - 1, 0));
        } else if (e.key === "Enter") {
            e.preventDefault();
            const r = results[highlighted];
            if (r?.accountId) select(r);
            else if (results.length === 0 && typedQuery.trim().length > 0) openCreate();
        } else if (e.key === "Escape") {
            setOpen(false);
        }
    };

    const showDropdown = !value && open && (loading || results.length > 0 || typedQuery.trim().length > 0);

    return (
        <div className={`relative ${className}`}>
            <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <input
                    value={displayValue}
                    onChange={(e) => handleQuery(e.target.value)}
                    onFocus={() => { setOpen(true); if (typedQuery) search(typedQuery); }}
                    onBlur={() => setTimeout(() => setOpen(false), 150)}
                    onKeyDown={onKey}
                    placeholder={placeholder}
                    autoFocus={autoFocus}
                    readOnly={!!value}
                    className={`h-8 w-full rounded-md border border-input bg-background pl-8 pr-7 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring ${value ? "font-medium" : ""}`}
                />
                {value && (
                    <button
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); clear(); }}
                        className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                        title="Clear"
                    >
                        <X size={12} />
                    </button>
                )}
            </div>

            {showDropdown && (
                <ul className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-auto rounded-md border border-border bg-popover shadow-lg ring-1 ring-black/5">
                    {loading && (
                        <li className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                            <Loader2 size={12} className="animate-spin" /> Searching…
                        </li>
                    )}
                    {!loading && results.map((r, i) => {
                        const Icon = r.type === "company" ? Building2 : User;
                        const disabled = !r.accountId;
                        return (
                            <li
                                key={`${r.type}-${r.id}`}
                                onMouseDown={(e) => { e.preventDefault(); if (!disabled) select(r); }}
                                onMouseEnter={() => setHighlighted(i)}
                                className={`flex items-center gap-2 px-3 py-2 text-sm border-b border-border last:border-0 ${
                                    i === highlighted && !disabled ? "bg-accent" : ""
                                } ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:bg-accent/60"}`}
                            >
                                <Icon size={14} className="shrink-0 text-muted-foreground" />
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="truncate font-medium">{r.name}</span>
                                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                            {r.type}
                                        </span>
                                    </div>
                                    {r.phone && (
                                        <div className="text-xs text-muted-foreground tabular-nums">{r.phone}</div>
                                    )}
                                </div>
                                {disabled && <span className="text-xs text-destructive">No A/c</span>}
                            </li>
                        );
                    })}
                    {!loading && typedQuery.trim().length > 0 && (
                        <li
                            onMouseDown={(e) => { e.preventDefault(); openCreate(); }}
                            className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer bg-primary/5 hover:bg-primary/10 border-t border-border text-primary font-medium"
                        >
                            <UserPlus size={14} className="shrink-0" />
                            <span>Create new customer “{typedQuery.trim()}”</span>
                        </li>
                    )}
                </ul>
            )}

            <CreatePartyDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                seed={createSeed}
                accountGroup={createUnderGroup}
                onCreated={(party) => {
                    onChange(party);
                    setTypedQuery("");
                    setCreateOpen(false);
                    toast.success(`Created ${party.name}`);
                }}
            />
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline create form — POSTs to /api/people (which auto-creates the
// Sundry Debtors ledger). Mirrors step 2 of QuickTicketButton, minus company
// linkage (which can be added later if needed for B2B sales).
// ─────────────────────────────────────────────────────────────────────────────

function CreatePartyDialog({
    open, onOpenChange, seed, accountGroup, onCreated,
}: {
    open:         boolean;
    onOpenChange: (open: boolean) => void;
    seed:         { name: string; phone: string };
    accountGroup: "Sundry Debtors" | "Sundry Creditors";
    onCreated:    (party: SelectedParty) => void;
}) {
    const [form, setForm] = useState({
        name: "", phone: "", email: "", address: "",
        gstin: "",
    });
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (open) {
            setForm({ name: seed.name, phone: seed.phone, email: "", address: "", gstin: "" });
        }
    }, [open, seed.name, seed.phone]);

    const submit = async () => {
        if (!form.name.trim()) { toast.error("Name is required"); return; }
        setSaving(true);
        try {
            const res = await axios.post<{
                id:    number;
                name:  string;
                phone: string | null;
                account: { id: number } | null;
            }>("/api/people", {
                name:    form.name.trim(),
                phones:  form.phone.trim() ? [form.phone.trim()] : [],
                emails:  form.email.trim() ? [form.email.trim()] : [],
                address: form.address.trim() || undefined,
                gstin:   form.gstin.trim().toUpperCase() || undefined,
                accountGroup,
            });
            if (!res.data.account?.id) {
                toast.error(`Created but no ledger account — check that "${accountGroup}" group exists`);
                return;
            }
            onCreated({
                accountId: res.data.account.id,
                partyId:   res.data.id,
                partyType: "customer",
                name:      res.data.name,
                phone:     res.data.phone,
            });
        } catch (err: unknown) {
            toast.error(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Failed to create") : "Failed to create");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>New {accountGroup === "Sundry Creditors" ? "Supplier" : "Customer"}</DialogTitle>
                    <DialogDescription>
                        We&apos;ll auto-create a {accountGroup} ledger so this party can be billed.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-3 py-2">
                    <div className="space-y-1">
                        <Label htmlFor="party-name">Name *</Label>
                        <Input
                            id="party-name"
                            value={form.name}
                            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                            autoFocus
                            placeholder="Customer name"
                        />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="party-phone">Phone</Label>
                        <Input
                            id="party-phone"
                            value={form.phone}
                            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                            placeholder="Mobile / phone"
                        />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="party-email">Email</Label>
                        <Input
                            id="party-email"
                            type="email"
                            value={form.email}
                            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                            placeholder="optional"
                        />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="party-address">Address</Label>
                        <Input
                            id="party-address"
                            value={form.address}
                            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                            placeholder="optional"
                        />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="party-gstin">GSTIN</Label>
                        <Input
                            id="party-gstin"
                            value={form.gstin}
                            onChange={(e) => setForm((f) => ({ ...f, gstin: e.target.value }))}
                            placeholder="15-char GSTIN, e.g. 27AAACR5055K1Z5 (optional)"
                            maxLength={15}
                            className="font-mono uppercase"
                        />
                        <p className="text-xs text-muted-foreground">
                            We&apos;ll auto-fill the state code from the first 2 digits.
                        </p>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                        Cancel
                    </Button>
                    <Button onClick={submit} disabled={saving}>
                        {saving && <Loader2 size={13} className="animate-spin mr-1" />}
                        Create &amp; Select
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
