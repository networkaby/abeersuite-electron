"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { ArrowLeft, User, Building2, Link2, Unlink, Plus, Pencil } from "lucide-react";
import Link from "next/link";
import { formatDateTime } from "@/lib/format-date";
import AccountForm from "@/components/AccountForm";

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
            createdAt: string;
            ticketStatus: { label: string; color: string };
            ticketPriority: { label: string; color: string };
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

    if (loading) return <p className="text-gray-500">Loading…</p>;
    if (!account) return <p className="text-gray-500">Account not found.</p>;

    const relationships = account.type === "individual" ? account.asIndividual : account.asCompany;
    const isCompany = account.type === "company";

    return (
        <div className="max-w-5xl mx-auto">
            {/* Header */}
            <div className="flex items-center gap-4 mb-6">
                <Link href="/accounts" className="text-gray-400 hover:text-gray-600">
                    <ArrowLeft size={20} />
                </Link>
                <div className="flex-1">
                    <div className="flex items-center gap-3">
                        <h1 className="text-2xl font-bold">{account.name}</h1>
                        {isCompany ? (
                            <span className="flex items-center gap-1 text-xs font-medium text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full">
                                <Building2 size={11} /> Company
                            </span>
                        ) : (
                            <span className="flex items-center gap-1 text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                                <User size={11} /> Individual
                            </span>
                        )}
                        {!account.isActive && (
                            <span className="text-xs text-red-500 bg-red-50 px-2 py-0.5 rounded-full">Inactive</span>
                        )}
                    </div>
                    <p className="text-gray-400 text-sm">Account #{account.id} · Created {formatDateTime(account.createdAt)}</p>
                </div>
                <button
                    onClick={() => setShowEdit(true)}
                    className="flex items-center gap-2 border border-gray-300 text-gray-600 px-3 py-2 rounded-lg hover:bg-gray-50 text-sm"
                >
                    <Pencil size={14} /> Edit
                </button>
            </div>

            <div className="grid grid-cols-3 gap-6">
                {/* Left: details + devices */}
                <div className="col-span-2 space-y-6">

                    {/* Contact Info */}
                    <div className="bg-white rounded-xl shadow p-6">
                        <h2 className="font-semibold text-gray-700 mb-4 text-sm uppercase tracking-wide">Contact Details</h2>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            {account.phone && <div><p className="text-gray-400 text-xs mb-0.5">Phone</p><p>{account.phone}</p></div>}
                            {account.email && <div><p className="text-gray-400 text-xs mb-0.5">Email</p><p>{account.email}</p></div>}
                            {account.address && <div className="col-span-2"><p className="text-gray-400 text-xs mb-0.5">Address</p><p>{account.address}</p></div>}
                            {account.companyReg && <div><p className="text-gray-400 text-xs mb-0.5">Company Reg</p><p className="font-mono">{account.companyReg}</p></div>}
                            {account.taxId && <div><p className="text-gray-400 text-xs mb-0.5">Tax / VAT ID</p><p className="font-mono">{account.taxId}</p></div>}
                        </div>
                    </div>

                    {/* Devices & Tickets */}
                    <div className="bg-white rounded-xl shadow p-6">
                        <h2 className="font-semibold text-gray-700 mb-4 text-sm uppercase tracking-wide">Devices & Tickets</h2>
                        {account.devices.length === 0 ? (
                            <p className="text-gray-400 text-sm">No devices yet.</p>
                        ) : (
                            <div className="space-y-4">
                                {account.devices.map(d => (
                                    <div key={d.id} className="border border-gray-100 rounded-lg p-4">
                                        <p className="font-medium text-sm">{d.brand} {d.model} <span className="text-gray-400">({d.type})</span></p>
                                        <p className="text-xs text-gray-500 mb-3">{d.problem}</p>
                                        {d.tickets.length === 0 ? (
                                            <p className="text-xs text-gray-400">No tickets</p>
                                        ) : (
                                            <div className="space-y-1.5">
                                                {d.tickets.map(t => (
                                                    <div key={t.id} className="flex items-center gap-2 text-xs">
                                                        <Link href={`/tickets/${t.id}`} className="font-medium text-blue-600 hover:underline">
                                                            #{t.id}
                                                        </Link>
                                                        {t.pipeline && (
                                                            <span className={`px-1.5 py-0.5 rounded-full text-xs ${t.pipeline.color}`}>{t.pipeline.label}</span>
                                                        )}
                                                        <span className={`px-1.5 py-0.5 rounded-full ${t.ticketStatus.color}`}>{t.ticketStatus.label}</span>
                                                        <span className={`px-1.5 py-0.5 rounded-full ${t.ticketPriority.color}`}>{t.ticketPriority.label}</span>
                                                        <span className="text-gray-400 ml-auto">{formatDateTime(t.createdAt)}</span>
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
                    <div className="bg-white rounded-xl shadow p-5">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="font-semibold text-gray-700 text-sm flex items-center gap-2">
                                <Link2 size={15} />
                                {isCompany ? "Linked Individuals" : "Linked Companies"}
                            </h2>
                            <button
                                onClick={() => setShowLinkModal(true)}
                                className="text-xs flex items-center gap-1 text-blue-600 hover:text-blue-800"
                            >
                                <Plus size={13} /> Link
                            </button>
                        </div>

                        {relationships.length === 0 ? (
                            <p className="text-xs text-gray-400">No links yet.</p>
                        ) : (
                            <div className="space-y-2">
                                {relationships.map(rel => {
                                    const linked = isCompany ? rel.individual : rel.company;
                                    return (
                                        <div key={rel.id} className="flex items-start justify-between gap-2 py-2 border-b border-gray-50 last:border-0">
                                            <div>
                                                <Link
                                                    href={`/accounts/${linked?.id}`}
                                                    className="text-sm font-medium text-blue-600 hover:underline"
                                                >
                                                    {linked?.name}
                                                </Link>
                                                {linked?.phone && <p className="text-xs text-gray-400">{linked.phone}</p>}
                                                {rel.role && <span className="text-xs text-gray-400 italic">{rel.role}</span>}
                                            </div>
                                            <button
                                                onClick={() => unlink(rel.id)}
                                                className="text-gray-300 hover:text-red-400 shrink-0 mt-0.5"
                                                title="Unlink"
                                            >
                                                <Unlink size={13} />
                                            </button>
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

            {/* Link Modal */}
            {showLinkModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                        <h2 className="font-semibold mb-4 flex items-center gap-2">
                            <Link2 size={16} />
                            Link to a {isCompany ? "Person" : "Company"}
                        </h2>
                        <div className="space-y-3">
                            <div className="flex gap-2">
                                <input
                                    value={linkSearch}
                                    onChange={e => setLinkSearch(e.target.value)}
                                    onKeyDown={e => e.key === "Enter" && searchForLink()}
                                    placeholder={`Search ${isCompany ? "individual" : "company"} by name or phone…`}
                                    className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                                />
                                <button
                                    onClick={searchForLink}
                                    className="bg-blue-600 text-white px-4 rounded-lg text-sm hover:bg-blue-700"
                                >
                                    Search
                                </button>
                            </div>

                            {linkResults.length > 0 && (
                                <>
                                    <div>
                                        <label className="text-xs text-gray-500 block mb-1">Role <span className="font-normal">(optional)</span></label>
                                        <input
                                            value={linkRole}
                                            onChange={e => setLinkRole(e.target.value)}
                                            placeholder="e.g. Owner, Employee, Contact"
                                            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                                        />
                                    </div>
                                    <div className="border rounded-lg divide-y max-h-48 overflow-y-auto">
                                        {linkResults.map(r => (
                                            <button
                                                key={r.id}
                                                onClick={() => linkTo(r.id)}
                                                disabled={linking}
                                                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-50 text-left text-sm disabled:opacity-50"
                                            >
                                                {r.type === "company" ? <Building2 size={14} className="text-purple-500 shrink-0" /> : <User size={14} className="text-blue-500 shrink-0" />}
                                                <div>
                                                    <p className="font-medium">{r.name}</p>
                                                    {r.phone && <p className="text-xs text-gray-400">{r.phone}</p>}
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </>
                            )}

                            <div className="flex gap-2 pt-1">
                                <button
                                    onClick={() => { setShowLinkModal(false); setLinkSearch(""); setLinkResults([]); setLinkRole(""); }}
                                    className="flex-1 border rounded-lg py-2 text-sm hover:bg-gray-50"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
