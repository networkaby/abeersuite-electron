"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { ArrowLeft, User, Building2, Link2, Unlink, Plus, Pencil } from "lucide-react";
import { PRIORITY_META } from "@/utils/constants";
import Link from "next/link";
import { formatDateTime } from "@/lib/format-date";
import AccountForm from "@/modules/core/components/AccountForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";

interface Relationship {
    id: number;
    role?: string | null;
    linkedAt: string;
    company?: { id: number; name: string; companyReg?: string | null; phone?: string | null };
    individual?: { id: number; name: string; phone?: string | null };
}

interface Account {
    id: number;
    type: string;
    name: string;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    companyReg?: string | null;
    taxId?: string | null;
    isActive: boolean;
    agreedToTerms: boolean;
    createdAt: string;
    devices: {
        id: number;
        type: string;
        brand: string;
        model: string;
        problem: string;
        tickets: {
            id: number;
            priority: string;
            createdAt: string;
            ticketStatus: { label: string; color: string };
            pipeline: { label: string; color: string } | null;
        }[];
    }[];
    asIndividual: Relationship[];
    asCompany: Relationship[];
}

export default function AccountDetailPage() {
    const { id } = useParams();
    const [account, setAccount] = useState<Account | null>(null);
    const [loading, setLoading] = useState(true);
    const [showEdit, setShowEdit] = useState(false);

    // Link modal state
    const [showLinkModal, setShowLinkModal] = useState(false);
    const [linkSearch, setLinkSearch] = useState("");
    const [linkResults, setLinkResults] = useState<{ id: number; name: string; type: string; phone?: string | null }[]>([]);
    const [linkRole, setLinkRole] = useState("");
    const [linking, setLinking] = useState(false);

    const fetchAccount = useCallback(async () => {
        try {
            const res = await axios.get(`/api/accounts/${id}`);
            setAccount(res.data);
        } catch {
            toast.error("Failed to load account");
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => { fetchAccount(); }, [fetchAccount]);

    const searchForLink = async () => {
        if (!linkSearch.trim()) return;
        const targetType = account?.type === "individual" ? "company" : "individual";
        try {
            const res = await axios.get(`/api/accounts?search=${linkSearch.trim()}&type=${targetType}`);
            setLinkResults(res.data);
        } catch {
            toast.error("Search failed");
        }
    };

    const linkTo = async (targetId: number) => {
        setLinking(true);
        try {
            await axios.post(`/api/accounts/${id}/relationships`, { targetId, role: linkRole || undefined });
            toast.success("Linked successfully");
            setShowLinkModal(false);
            setLinkSearch("");
            setLinkResults([]);
            setLinkRole("");
            fetchAccount();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : undefined;
            toast.error(msg ?? "Failed to link");
        } finally {
            setLinking(false);
        }
    };

    const unlink = async (relId: number) => {
        if (!confirm("Unlink this relationship? History will be preserved.")) return;
        try {
            await axios.delete(`/api/accounts/${id}/relationships?relationshipId=${relId}`);
            toast.success("Unlinked");
            fetchAccount();
        } catch {
            toast.error("Failed to unlink");
        }
    };

    if (loading) return <p className="text-muted-foreground">Loading…</p>;
    if (!account) return <p className="text-muted-foreground">Account not found.</p>;

    const relationships = account.type === "individual" ? account.asIndividual : account.asCompany;
    const isCompany = account.type === "company";

    return (
        <div className="max-w-5xl mx-auto">
            {/* Header */}
            <div className="flex items-center gap-4 mb-6">
                <Link href="/office/accounts" className="text-muted-foreground hover:text-foreground">
                    <ArrowLeft size={20} />
                </Link>
                <div className="flex-1">
                    <div className="flex items-center gap-3">
                        <h1 className="text-2xl font-bold">{account.name}</h1>
                        {isCompany ? (
                            <span className="flex items-center gap-1 text-xs font-medium text-purple-600 bg-purple-50 border border-purple-200 px-2 py-0.5">
                                <Building2 size={11} /> Company
                            </span>
                        ) : (
                            <span className="flex items-center gap-1 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5">
                                <User size={11} /> Individual
                            </span>
                        )}
                        {!account.isActive && (
                            <span className="text-xs text-destructive bg-destructive/10 border border-destructive/20 px-2 py-0.5">Inactive</span>
                        )}
                    </div>
                    <p className="text-muted-foreground text-sm">Account #{account.id} · Created {formatDateTime(account.createdAt)}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setShowEdit(true)}>
                    <Pencil size={14} /> Edit
                </Button>
            </div>

            <div className="grid grid-cols-3 gap-6">
                {/* Left: details + devices */}
                <div className="col-span-2 space-y-6">

                    {/* Contact Info */}
                    <div className="rounded-lg border border-border bg-card p-6 shadow">
                        <h2 className="font-semibold text-foreground mb-4 text-sm uppercase tracking-wide">Contact Details</h2>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            {account.phone && <div><p className="text-muted-foreground text-xs mb-0.5">Phone</p><p>{account.phone}</p></div>}
                            {account.email && <div><p className="text-muted-foreground text-xs mb-0.5">Email</p><p>{account.email}</p></div>}
                            {account.address && <div className="col-span-2"><p className="text-muted-foreground text-xs mb-0.5">Address</p><p>{account.address}</p></div>}
                            {account.companyReg && <div><p className="text-muted-foreground text-xs mb-0.5">Company Reg</p><p className="font-mono">{account.companyReg}</p></div>}
                            {account.taxId && <div><p className="text-muted-foreground text-xs mb-0.5">Tax / VAT ID</p><p className="font-mono">{account.taxId}</p></div>}
                        </div>
                    </div>

                    {/* Devices & Tickets */}
                    <div className="rounded-lg border border-border bg-card p-6 shadow">
                        <h2 className="font-semibold text-foreground mb-4 text-sm uppercase tracking-wide">Devices &amp; Tickets</h2>
                        {account.devices.length === 0 ? (
                            <p className="text-muted-foreground text-sm">No devices yet.</p>
                        ) : (
                            <div className="space-y-4">
                                {account.devices.map(d => (
                                    <div key={d.id} className="rounded-md border border-border p-4">
                                        <p className="font-medium text-sm">
                                            {d.brand} {d.model} <span className="text-muted-foreground">({d.type})</span>
                                        </p>
                                        <p className="text-xs text-muted-foreground mb-3">{d.problem}</p>
                                        {d.tickets.length === 0 ? (
                                            <p className="text-xs text-muted-foreground">No tickets</p>
                                        ) : (
                                            <div className="space-y-1.5">
                                                {d.tickets.map(t => (
                                                    <div key={t.id} className="flex items-center gap-2 text-xs">
                                                        <Link href={`/office/tickets/${t.id}`} className="font-medium text-primary hover:underline">
                                                            #{t.id}
                                                        </Link>
                                                        {t.pipeline && (
                                                            <span className={`px-1.5 py-0.5 text-xs ${t.pipeline.color}`}>{t.pipeline.label}</span>
                                                        )}
                                                        <span className={`px-1.5 py-0.5 ${t.ticketStatus.color}`}>{t.ticketStatus.label}</span>
                                                        <span className={`px-1.5 py-0.5 ${PRIORITY_META[t.priority]?.color ?? ""}`}>{PRIORITY_META[t.priority]?.label ?? t.priority}</span>
                                                        <span className="text-muted-foreground ml-auto">{formatDateTime(t.createdAt)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Right: Relationships */}
                <div className="space-y-4">
                    <div className="rounded-lg border border-border bg-card p-5 shadow">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="font-semibold text-foreground text-sm flex items-center gap-2">
                                <Link2 size={15} />
                                {isCompany ? "Linked Individuals" : "Linked Companies"}
                            </h2>
                            <Button
                                type="button"
                                variant="link"
                                size="xs"
                                onClick={() => setShowLinkModal(true)}
                                className="h-auto gap-1 p-0 text-xs text-primary hover:text-primary/80"
                            >
                                <Plus size={13} /> Link
                            </Button>
                        </div>

                        {relationships.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No links yet.</p>
                        ) : (
                            <div className="space-y-2">
                                {relationships.map(rel => {
                                    const linked = isCompany ? rel.individual : rel.company;
                                    return (
                                        <div key={rel.id} className="flex items-start justify-between gap-2 py-2 border-b border-border last:border-0">
                                            <div>
                                                <Link
                                                    href={`/office/accounts/${linked?.id}`}
                                                    className="text-sm font-medium text-primary hover:underline"
                                                >
                                                    {linked?.name}
                                                </Link>
                                                {linked?.phone && <p className="text-xs text-muted-foreground">{linked.phone}</p>}
                                                {rel.role && <span className="text-xs text-muted-foreground italic">{rel.role}</span>}
                                            </div>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon-xs"
                                                onClick={() => unlink(rel.id)}
                                                className="mt-0.5 shrink-0 text-muted-foreground/40 hover:text-destructive"
                                                title="Unlink"
                                            >
                                                <Unlink size={13} />
                                            </Button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Edit Modal */}
            {showEdit && (
                <AccountForm
                    account={account}
                    onClose={(updated) => {
                        setShowEdit(false);
                        if (updated) fetchAccount();
                    }}
                />
            )}

            {/* Link Dialog */}
            <Dialog open={showLinkModal} onOpenChange={(open) => {
                if (!open) { setShowLinkModal(false); setLinkSearch(""); setLinkResults([]); setLinkRole(""); }
            }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Link2 size={16} />
                            Link to a {isCompany ? "Person" : "Company"}
                        </DialogTitle>
                        <DialogDescription>
                            Search and select an account to link.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="flex gap-2">
                            <Input
                                value={linkSearch}
                                onChange={e => setLinkSearch(e.target.value)}
                                onKeyDown={e => e.key === "Enter" && searchForLink()}
                                placeholder={`Search ${isCompany ? "individual" : "company"} by name or phone…`}
                                className="flex-1"
                            />
                            <Button onClick={searchForLink}>Search</Button>
                        </div>

                        {linkResults.length > 0 && (
                            <>
                                <div className="space-y-1.5">
                                    <Label>Role <span className="font-normal text-muted-foreground">(optional)</span></Label>
                                    <Input
                                        value={linkRole}
                                        onChange={e => setLinkRole(e.target.value)}
                                        placeholder="e.g. Owner, Employee, Contact"
                                    />
                                </div>
                                <div className="max-h-48 divide-y divide-border overflow-y-auto rounded-md border border-border">
                                    {linkResults.map(r => (
                                        <Button
                                            key={r.id}
                                            type="button"
                                            variant="ghost"
                                            onClick={() => linkTo(r.id)}
                                            disabled={linking}
                                            className="h-auto w-full justify-start gap-3 rounded-none px-4 py-3 text-left text-sm hover:bg-primary/10 disabled:opacity-50"
                                        >
                                            {r.type === "company"
                                                ? <Building2 size={14} className="text-purple-500 shrink-0" />
                                                : <User size={14} className="text-primary shrink-0" />
                                            }
                                            <div>
                                                <p className="font-medium">{r.name}</p>
                                                {r.phone && <p className="text-xs text-muted-foreground">{r.phone}</p>}
                                            </div>
                                        </Button>
                                    ))}
                                </div>
                            </>
                        )}

                        <Button
                            variant="outline"
                            className="w-full"
                            onClick={() => { setShowLinkModal(false); setLinkSearch(""); setLinkResults([]); setLinkRole(""); }}
                        >
                            Cancel
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
