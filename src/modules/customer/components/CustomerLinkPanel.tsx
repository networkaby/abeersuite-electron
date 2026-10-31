"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, X, Building2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { extractApiError } from "@/shared/lib/api";
import { invalidateParties } from "@/shared/lib/parties";

interface LinkedCompany {
    id: number;
    company: { id: number; accountId: number; name: string; phone: string | null };
}

interface Props {
    customerId: number;
    /** The parent's current list — the panel never keeps its own copy. */
    links: LinkedCompany[];
    /** Called after a link or an unlink; the parent refetches and passes the new list. */
    onChanged: () => void;
}

const fieldClass = "flex-1";

export default function CustomerLinkPanel({ customerId, links, onChanged }: Props) {
    const [showSearch, setShowSearch] = useState(false);
    const [query, setQuery] = useState("");
    const [searchedQuery, setSearchedQuery] = useState("");
    const [results, setResults] = useState<{ id: number; name: string; phone: string | null }[]>([]);
    const [searching, setSearching] = useState(false);
    const [creating, setCreating] = useState(false);

    const search = async () => {
        const q = query.trim();
        if (!q) return;
        setSearching(true);
        setSearchedQuery(q);
        try {
            const res = await axios.get(`/api/companies?q=${encodeURIComponent(q)}`);
            setResults(res.data);
        } catch {
            toast.error("Search failed");
        } finally {
            setSearching(false);
        }
    };

    const link = async (companyId: number, companyName: string) => {
        try {
            await axios.post(`/api/companies/${companyId}/links`, { personId: customerId });
            void invalidateParties();
            toast.success(`Linked to ${companyName}`);
            setShowSearch(false);
            setQuery("");
            setSearchedQuery("");
            setResults([]);
            onChanged();
        } catch (e: unknown) {
            toast.error(extractApiError(e, "Failed to link"));
        }
    };

    const unlink = async (companyId: number) => {
        try {
            await axios.delete(`/api/companies/${companyId}/links?personId=${customerId}`);
            void invalidateParties();
            toast.success("Unlinked");
            onChanged();
        } catch {
            toast.error("Failed to unlink");
        }
    };

    const createAndLink = async () => {
        const name = (searchedQuery || query).trim();
        if (!name) return;
        setCreating(true);
        try {
            const res = await axios.post<{ id: number; name: string }>("/api/companies", { name });
            const newCompany = res.data;
            await axios.post(`/api/companies/${newCompany.id}/links`, { personId: customerId });
            void invalidateParties();
            toast.success(`Created and linked to ${newCompany.name || name}`);
            setShowSearch(false);
            setQuery("");
            setSearchedQuery("");
            setResults([]);
            onChanged();
        } catch (e: unknown) {
            toast.error(extractApiError(e, "Failed to create company"));
        } finally {
            setCreating(false);
        }
    };

    return (
        <div className="space-y-2">
            {links.length === 0 && !showSearch && (
                <p className="text-sm text-muted-foreground">No linked companies.</p>
            )}
            {links.map(lc => (
                <div key={lc.id} className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
                    <div className="flex items-center gap-2">
                        <Building2 size={13} className="text-primary" />
                        <Link href={`/office/customers/${lc.company.accountId}`} className="font-medium hover:text-primary">
                            {lc.company.name}
                        </Link>
                        {lc.company.phone && <span className="text-xs text-muted-foreground">· {lc.company.phone}</span>}
                    </div>
                    <Button type="button" onClick={() => unlink(lc.company.id)} variant="ghost" size="icon-xs" className="text-muted-foreground/65 hover:text-destructive">
                        <X size={14} />
                    </Button>
                </div>
            ))}

            {showSearch ? (
                <div className="space-y-2 rounded-md border border-border p-3">
                    <div className="flex gap-2">
                        <Input
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === "Enter") {
                                    e.preventDefault();
                                    if (searchedQuery && searchedQuery === query.trim() && results.length === 0) {
                                        void createAndLink();
                                    } else {
                                        void search();
                                    }
                                }
                            }}
                            placeholder="Search company..."
                            className={fieldClass}
                            autoFocus
                        />
                        <Button
                            type="button"
                            onClick={search}
                            disabled={searching || creating}
                            size="sm"
                        >
                            {searching ? "..." : "Search"}
                        </Button>
                        <Button
                            type="button"
                            onClick={() => { setShowSearch(false); setResults([]); setSearchedQuery(""); }}
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-foreground"
                        >
                            <X size={16} />
                        </Button>
                    </div>
                    {results.map(r => (
                        <Button
                            key={r.id}
                            type="button"
                            onClick={() => link(r.id, r.name)}
                            variant="outline"
                            className="h-auto w-full justify-start gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                        >
                            <Building2 size={13} className="text-primary" />
                            <span className="font-medium">{r.name}</span>
                            {r.phone && <span className="text-xs text-muted-foreground">· {r.phone}</span>}
                        </Button>
                    ))}
                    {searchedQuery && !searching && results.length === 0 && (
                        <div className="space-y-2 py-1 text-center">
                            <p className="text-xs text-muted-foreground">No companies found.</p>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={creating}
                                onClick={createAndLink}
                                className="w-full gap-1.5 text-xs font-medium"
                            >
                                <Plus size={13} />
                                {creating ? "Creating…" : `Create company "${searchedQuery}" and link`}
                            </Button>
                        </div>
                    )}
                    {searchedQuery && !searching && results.length > 0 && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={creating}
                            onClick={createAndLink}
                            className="h-auto w-full justify-start gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted"
                        >
                            <Plus size={13} />
                            {creating ? "Creating…" : `Create company "${searchedQuery}" and link`}
                        </Button>
                    )}
                </div>
            ) : (
                <Button
                    type="button"
                    onClick={() => setShowSearch(true)}
                    variant="link"
                    size="xs"
                    className="mt-1 h-auto p-0 text-xs"
                >
                    <Plus size={13} /> Link a company
                </Button>
            )}
        </div>
    );
}
