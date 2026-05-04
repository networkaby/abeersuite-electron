"use client";

import { useState, useRef, useEffect } from "react";
import { Search, UserPlus, Building2, User, Banknote, X } from "lucide-react";
import axios from "axios";
import { toast } from "sonner";
import { z } from "zod/v3";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type PartyResult = {
    id: number;
    name: string;
    phone: string | null;
    type: "customer" | "company";
    accountId: number | null;
};

type SelectedParty = {
    accountId: number;
    label: string;
    type: "customer" | "company" | "cash";
};

const createSchema = z.object({
    name: z.string().trim().min(1, "Name is required"),
    phone: z.string().trim().min(1, "Phone is required"),
});
type CreateFormData = z.infer<typeof createSchema>;

/** Walk-in cash account code — resolved from the API once and cached. */
let _cashAccountId: number | null = null;
async function getCashAccountId(): Promise<number | null> {
    if (_cashAccountId !== null) return _cashAccountId;
    try {
        const { data } = await axios.get<{ id: number }[]>("/api/accounts?code=CASH-WALKIN");
        _cashAccountId = data[0]?.id ?? null;
    } catch {
        _cashAccountId = null;
    }
    return _cashAccountId;
}

type Props = {
    /** Called whenever a party is selected/cleared. */
    onSelect: (accountId: number | null, party: SelectedParty | null) => void;
    /** Show the Cash Bill toggle (only in in-store / phone contexts). */
    showCashOption?: boolean;
    /** Allow creating a company instead of a customer. */
    allowCompany?: boolean;
    defaultValue?: SelectedParty | null;
    placeholder?: string;
    label?: string;
    disabled?: boolean;
};

export function PartyPicker({
    onSelect,
    showCashOption = false,
    allowCompany = false,
    defaultValue,
    placeholder = "Search by name or phone…",
    label = "Party",
    disabled = false,
}: Props) {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<PartyResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [showDropdown, setShowDropdown] = useState(false);
    const [selected, setSelected] = useState<SelectedParty | null>(defaultValue ?? null);
    const [isCash, setIsCash] = useState(false);
    const [showCreate, setShowCreate] = useState(false);
    const [createAsCompany, setCreateAsCompany] = useState(false);
    const [creating, setCreating] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const { register, handleSubmit, formState: { errors }, reset: resetForm } = useForm<CreateFormData>({
        resolver: zodResolver(createSchema),
    });

    // Close dropdown on outside click
    useEffect(() => {
        function handler(e: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setShowDropdown(false);
            }
        }
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    async function search(q: string) {
        if (q.length < 2) { setResults([]); return; }
        setSearching(true);
        try {
            const { data } = await axios.get<PartyResult[]>(`/api/customers?phone=${encodeURIComponent(q)}`);
            setResults(data);
        } catch {
            setResults([]);
        } finally {
            setSearching(false);
        }
    }

    function pick(party: PartyResult) {
        if (!party.accountId) {
            toast.error("This party has no linked account.");
            return;
        }
        const s: SelectedParty = { accountId: party.accountId, label: party.name, type: party.type };
        setSelected(s);
        setIsCash(false);
        setShowDropdown(false);
        setQuery("");
        onSelect(party.accountId, s);
    }

    async function toggleCash(on: boolean) {
        if (!on) {
            setIsCash(false);
            setSelected(null);
            onSelect(null, null);
            return;
        }
        const cashId = await getCashAccountId();
        if (!cashId) {
            toast.error("Walk-in Cash Account not found. Run the seed script.");
            return;
        }
        const s: SelectedParty = { accountId: cashId, label: "Walk-in Cash Customer", type: "cash" };
        setIsCash(true);
        setSelected(s);
        setShowDropdown(false);
        setQuery("");
        onSelect(cashId, s);
    }

    async function onCreate(data: CreateFormData) {
        setCreating(true);
        try {
            const endpoint = createAsCompany ? "/api/companies" : "/api/customers";
            const { data: created } = await axios.post<{ id: number; account?: { id: number } }>(endpoint, {
                name: data.name,
                phone: data.phone,
            });
            const accountId = created.account?.id ?? null;
            if (!accountId) throw new Error("Account not created");
            const s: SelectedParty = {
                accountId,
                label: data.name,
                type: createAsCompany ? "company" : "customer",
            };
            setSelected(s);
            setShowCreate(false);
            setShowDropdown(false);
            resetForm();
            onSelect(accountId, s);
            toast.success(`${createAsCompany ? "Company" : "Customer"} created`);
        } catch (e) {
            const msg = axios.isAxiosError(e) ? e.response?.data?.error : "Create failed";
            toast.error(msg ?? "Create failed");
        } finally {
            setCreating(false);
        }
    }

    function clear() {
        setSelected(null);
        setIsCash(false);
        setQuery("");
        onSelect(null, null);
    }

    if (selected) {
        return (
            <div className="space-y-1">
                {label && <Label>{label}</Label>}
                <div className="flex items-center gap-2 rounded-md border px-3 py-2 bg-muted/40">
                    {selected.type === "cash" ? (
                        <Banknote className="h-4 w-4 text-muted-foreground shrink-0" />
                    ) : selected.type === "company" ? (
                        <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                    ) : (
                        <User className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                    <span className="flex-1 text-sm font-medium">{selected.label}</span>
                    <Badge variant="outline" className="text-xs capitalize">{selected.type}</Badge>
                    {!disabled && (
                        <button type="button" onClick={clear} className="text-muted-foreground hover:text-foreground">
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-2" ref={containerRef}>
            {label && <Label>{label}</Label>}

            {/* Cash Bill toggle */}
            {showCashOption && (
                <button
                    type="button"
                    onClick={() => toggleCash(!isCash)}
                    className={cn(
                        "flex items-center gap-2 text-sm rounded-md px-2.5 py-1 border transition-colors",
                        isCash
                            ? "bg-amber-50 border-amber-300 text-amber-800"
                            : "border-dashed text-muted-foreground hover:text-foreground",
                    )}
                >
                    <Banknote className="h-3.5 w-3.5" />
                    Cash Bill (no party registration)
                </button>
            )}

            {/* Search input */}
            <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                    className="pl-8"
                    placeholder={placeholder}
                    value={query}
                    disabled={disabled}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setShowDropdown(true);
                        search(e.target.value);
                    }}
                    onFocus={() => query.length >= 2 && setShowDropdown(true)}
                />

                {showDropdown && (
                    <div className="absolute z-50 top-full mt-1 w-full rounded-md border bg-popover shadow-md">
                        {searching && (
                            <p className="px-3 py-2 text-xs text-muted-foreground">Searching…</p>
                        )}
                        {!searching && results.length === 0 && query.length >= 2 && (
                            <div className="px-3 py-2 space-y-1">
                                <p className="text-xs text-muted-foreground">No match found.</p>
                                <button
                                    type="button"
                                    className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                                    onClick={() => { setShowCreate(true); setShowDropdown(false); }}
                                >
                                    <UserPlus className="h-3 w-3" />
                                    Create new {allowCompany ? "customer or company" : "customer"}
                                </button>
                            </div>
                        )}
                        {results.map((r) => (
                            <button
                                key={`${r.type}-${r.id}`}
                                type="button"
                                className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-accent text-sm"
                                onClick={() => pick(r)}
                            >
                                {r.type === "company"
                                    ? <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                    : <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                }
                                <span className="flex-1">{r.name}</span>
                                {r.phone && <span className="text-xs text-muted-foreground">{r.phone}</span>}
                                <Badge variant="outline" className="text-xs">{r.type}</Badge>
                            </button>
                        ))}
                        {!searching && query.length >= 2 && results.length > 0 && (
                            <button
                                type="button"
                                className="flex items-center gap-1.5 w-full px-3 py-2 text-xs text-muted-foreground hover:text-primary border-t"
                                onClick={() => { setShowCreate(true); setShowDropdown(false); }}
                            >
                                <UserPlus className="h-3 w-3" />
                                Create new instead
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Inline create form */}
            {showCreate && (
                <form
                    onSubmit={handleSubmit(onCreate)}
                    className="rounded-md border p-3 space-y-3 bg-muted/30"
                >
                    <p className="text-xs font-medium text-muted-foreground">Create new party</p>
                    {allowCompany && (
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => setCreateAsCompany(false)}
                                className={cn("text-xs px-2 py-1 rounded border", !createAsCompany ? "bg-primary text-primary-foreground" : "")}
                            >
                                Customer
                            </button>
                            <button
                                type="button"
                                onClick={() => setCreateAsCompany(true)}
                                className={cn("text-xs px-2 py-1 rounded border", createAsCompany ? "bg-primary text-primary-foreground" : "")}
                            >
                                Company
                            </button>
                        </div>
                    )}
                    <div className="space-y-1">
                        <Label className="text-xs">Name *</Label>
                        <Input {...register("name")} placeholder="Full name or company name" className="h-8 text-sm" />
                        {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
                    </div>
                    <div className="space-y-1">
                        <Label className="text-xs">Phone *</Label>
                        <Input {...register("phone")} placeholder="Mobile number" className="h-8 text-sm" />
                        {errors.phone && <p className="text-xs text-destructive">{errors.phone.message}</p>}
                    </div>
                    <div className="flex gap-2">
                        <Button type="submit" size="sm" disabled={creating}>
                            {creating ? "Creating…" : "Create & Select"}
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setShowCreate(false)}>
                            Cancel
                        </Button>
                    </div>
                </form>
            )}
        </div>
    );
}
