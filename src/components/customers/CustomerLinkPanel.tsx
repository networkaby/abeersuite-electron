"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, X, Building2 } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface LinkedCompany {
    id: number;
    company: { id: number; name: string; phone: string | null };
}

interface Props {
    customerId: number;
    initialLinks: LinkedCompany[];
}

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
            await axios.post(`/api/companies/${companyId}/links`, { customerId });
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
            await axios.delete(`/api/companies/${companyId}/links?customerId=${customerId}`);
            setLinks(prev => prev.filter(l => l.id !== linkId));
            toast.success("Unlinked");
        } catch {
            toast.error("Failed to unlink");
        }
    };

    return (
        <div className="space-y-2">
            {links.length === 0 && !showSearch && (
                <p className="text-sm text-gray-400">No linked companies.</p>
            )}
            {links.map(lc => (
                <div key={lc.id} className="flex items-center justify-between p-2 rounded-lg border text-sm">
                    <div className="flex items-center gap-2">
                        <Building2 size={13} className="text-purple-500" />
                        <Link href={`/companies/${lc.company.id}`} className="font-medium hover:text-purple-700">
                            {lc.company.name}
                        </Link>
                        {lc.company.phone && <span className="text-xs text-gray-400">· {lc.company.phone}</span>}
                    </div>
                    <button onClick={() => unlink(lc.company.id, lc.id)} className="text-gray-300 hover:text-red-500">
                        <X size={14} />
                    </button>
                </div>
            ))}

            {showSearch ? (
                <div className="border rounded-lg p-3 space-y-2">
                    <div className="flex gap-2">
                        <input
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && search()}
                            placeholder="Search company..."
                            className="flex-1 border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                            autoFocus
                        />
                        <button onClick={search} disabled={searching} className="bg-purple-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-purple-700 disabled:opacity-50">
                            {searching ? "..." : "Search"}
                        </button>
                        <button onClick={() => { setShowSearch(false); setResults([]); }} className="text-gray-400 hover:text-gray-600">
                            <X size={16} />
                        </button>
                    </div>
                    {results.map(r => (
                        <button key={r.id} onClick={() => link(r.id, r.name)}
                            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-purple-50 text-sm text-left border">
                            <Building2 size={13} className="text-purple-400" />
                            <span className="font-medium">{r.name}</span>
                            {r.phone && <span className="text-xs text-gray-400">· {r.phone}</span>}
                        </button>
                    ))}
                    {results.length === 0 && query && !searching && (
                        <p className="text-xs text-gray-400 text-center py-1">No companies found.</p>
                    )}
                </div>
            ) : (
                <button onClick={() => setShowSearch(true)}
                    className="flex items-center gap-1.5 text-xs text-purple-600 hover:text-purple-800 mt-1">
                    <Plus size={13} /> Link a company
                </button>
            )}
        </div>
    );
}
