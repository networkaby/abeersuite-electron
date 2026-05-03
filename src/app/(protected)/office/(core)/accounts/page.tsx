"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Plus, Pencil, Search, X, User, Building2, Link2 } from "lucide-react";
import { toast } from "sonner";
import AccountForm from "@/modules/core/components/AccountForm";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

interface Account {
    id: number;
    type: string;
    name: string;
    phone?: string | null;
    email?: string | null;
    companyReg?: string | null;
    isActive: boolean;
    createdAt: string;
    devices: { id: number }[];
    _count: { asIndividual: number; asCompany: number };
}

const TYPE_FILTERS = [
    { label: "All", value: "" },
    { label: "Individuals", value: "individual" },
    { label: "Companies", value: "company" },
];

export default function AccountsPage() {
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [filtered, setFiltered] = useState<Account[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editAccount, setEditAccount] = useState<Account | null>(null);
    const [search, setSearch] = useState("");
    const [typeFilter, setTypeFilter] = useState("");

    const fetchAccounts = async () => {
        setLoading(true);
        try {
            const res = await axios.get("/api/accounts");
            setAccounts(res.data);
        } catch {
            toast.error("Failed to load accounts");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchAccounts(); }, []);

    useEffect(() => {
        let list = accounts;
        if (typeFilter) list = list.filter(a => a.type === typeFilter);
        if (search) {
            const s = search.toLowerCase();
            list = list.filter(a =>
                a.name.toLowerCase().includes(s) ||
                a.phone?.includes(s) ||
                a.email?.toLowerCase().includes(s) ||
                a.companyReg?.toLowerCase().includes(s)
            );
        }
        setFiltered(list);
    }, [search, typeFilter, accounts]);

    const handleFormClose = (created?: { id: number; name: string; type: string }) => {
        setShowForm(false);
        setEditAccount(null);
        if (created) fetchAccounts();
    };

    const individuals = accounts.filter(a => a.type === "individual").length;
    const companies = accounts.filter(a => a.type === "company").length;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold">Accounts</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        {individuals} individual{individuals !== 1 ? "s" : ""} · {companies} compan{companies !== 1 ? "ies" : "y"}
                    </p>
                </div>
                <Button type="button" onClick={() => setShowForm(true)}>
                    <Plus size={16} /> New Account
                </Button>
            </div>

            {(showForm || editAccount) && (
                <AccountForm account={editAccount ?? undefined} onClose={handleFormClose} />
            )}

            {/* Search + Filter */}
            <div className="space-y-3 rounded-lg border border-border bg-card p-4 shadow">
                <div className="flex gap-2">
                    <div className="relative flex-1">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            type="text"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search by name, phone, email, company reg…"
                            className="pl-9"
                        />
                        {search && (
                            <Button onClick={() => setSearch("")} variant="ghost" size="icon-xs" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                                <X size={15} />
                            </Button>
                        )}
                    </div>
                    <div className="flex gap-1">
                        {TYPE_FILTERS.map(f => (
                            <Button
                                key={f.value}
                                type="button"
                                size="sm"
                                variant={typeFilter === f.value ? "default" : "outline"}
                                onClick={() => setTypeFilter(f.value)}
                            >
                                {f.label}
                            </Button>
                        ))}
                    </div>
                </div>
                <p className="text-sm text-muted-foreground">
                    Showing <span className="font-medium text-foreground">{filtered.length}</span> of{" "}
                    <span className="font-medium text-foreground">{accounts.length}</span> accounts
                </p>
            </div>

            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : filtered.length === 0 ? (
                <div className="rounded-lg border border-border bg-card p-12 text-center text-muted-foreground shadow">
                    {search || typeFilter ? "No accounts match your filter." : "No accounts yet. Add your first one!"}
                </div>
            ) : (
                <div className="overflow-hidden rounded-lg border border-border shadow">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-12">#</TableHead>
                                <TableHead>Name</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead>Phone</TableHead>
                                <TableHead>Email</TableHead>
                                <TableHead>Links</TableHead>
                                <TableHead>Devices</TableHead>
                                <TableHead>Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filtered.map(a => (
                                <TableRow key={a.id} className={!a.isActive ? "opacity-50" : ""}>
                                    <TableCell className="text-muted-foreground">{a.id}</TableCell>
                                    <TableCell>
                                        <Link href={`/office/accounts/${a.id}`} className="font-medium hover:text-primary hover:underline">
                                            {a.name}
                                        </Link>
                                        {a.companyReg && <p className="text-xs text-muted-foreground">{a.companyReg}</p>}
                                    </TableCell>
                                    <TableCell>
                                        {a.type === "company" ? (
                                            <Badge className="bg-primary/10 text-primary border-primary/20">
                                                <Building2 size={11} /> Company
                                            </Badge>
                                        ) : (
                                            <Badge variant="outline">
                                                <User size={11} /> Individual
                                            </Badge>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">{a.phone || "—"}</TableCell>
                                    <TableCell className="text-muted-foreground">{a.email || "—"}</TableCell>
                                    <TableCell>
                                        {(a._count.asIndividual + a._count.asCompany) > 0 ? (
                                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                                <Link2 size={12} />
                                                {a.type === "individual" ? `${a._count.asIndividual} co.` : `${a._count.asCompany} people`}
                                            </span>
                                        ) : (
                                            <span className="text-muted-foreground text-xs">—</span>
                                        )}
                                    </TableCell>
                                    <TableCell>{a.devices.length}</TableCell>
                                    <TableCell>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="icon-sm"
                                            onClick={() => setEditAccount(a)}
                                        >
                                            <Pencil size={14} />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}
        </div>
    );
}
