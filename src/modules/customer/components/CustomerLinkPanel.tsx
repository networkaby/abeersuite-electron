"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, X, Building2 } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface LinkedCompany {
    id: number;
    company: { id: number; name: string; phone: string | null };
}

interface Props {
    customerId: number;
    initialLinks: LinkedCompany[];
}

const fieldClass = "flex-1";

export default function CustomerLinkPanel({ customerId, initialLinks }: Props) {
    const router = useRouter();
    const [links, setLinks] = useState(initialLinks);
    const [showSearch, setShowSearch] = useState(false);
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<{ id: number; name: string; phone: string | null }[]>([]);
    const [searching, setSearching] = useState(false);

    const search = async () => {
        if (!query.trim()) return;
        setSearching(true);
        try {
            const res = await axios.get(`/api/companies?q=${encodeURIComponent(query)}`);
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
            toast.success(`Linked to ${companyName}`);
            setShowSearch(false);
            setQuery("");
            setResults([]);
            router.refresh();
        } catch (e: unknown) {
            const msg = axios.isAxiosError(e) ? e.response?.data?.error : "Failed to link";
            toast.error(msg);
        }
    };

    const unlink = async (companyId: number, linkId: number) => {
        try {
            await axios.delete(`/api/companies/${companyId}/links?personId=${customerId}`);
            setLinks(prev => prev.filter(l => l.id !== linkId));
            toast.success("Unlinked");
        } catch {
            toast.error("Failed to unlink");
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
                        <Link href={`/office/customers/companies/${lc.company.id}`} className="font-medium hover:text-primary">
                            {lc.company.name}
                        </Link>
                        {lc.company.phone && <span className="text-xs text-muted-foreground">· {lc.company.phone}</span>}
                    </div>
                    <Button onClick={() => unlink(lc.company.id, lc.id)} variant="ghost" size="icon-xs" className="text-muted-foreground/40 hover:text-destructive">
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
                            onKeyDown={e => e.key === "Enter" && search()}
                            placeholder="Search company..."
                            className={fieldClass}
                            autoFocus
                        />
                        <Button
                            onClick={search}
                            disabled={searching}
                            size="sm"
                        >
                            {searching ? "..." : "Search"}
                        </Button>
                        <Button
                            onClick={() => { setShowSearch(false); setResults([]); }}
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
                            onClick={() => link(r.id, r.name)}
                            variant="outline"
                            className="h-auto w-full justify-start gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                        >
                            <Building2 size={13} className="text-primary" />
                            <span className="font-medium">{r.name}</span>
                            {r.phone && <span className="text-xs text-muted-foreground">· {r.phone}</span>}
                        </Button>
                    ))}
                    {results.length === 0 && query && !searching && (
                        <p className="text-xs text-muted-foreground text-center py-1">No companies found.</p>
                    )}
                </div>
            ) : (
                <Button
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
