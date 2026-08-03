"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Pencil, Check, X, Loader2, TrendingUp, TrendingDown, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { fmt, GL_TYPE_COLORS, GL_TYPE_ORDER, type GlAccountType } from "@/utils/constants";
import { CreateGlAccountDialog } from "@/modules/accountancy/components/CreateGlAccountDialog";
import type { GroupTypeStr } from "@/modules/accountancy/lib/groupNature";

type NormalBalance = "DEBIT" | "CREDIT";

interface AccountGroupLite {
    id: number;
    name: string;
    type: GroupTypeStr;
}

interface GlAccount {
    id: number;
    code: string | null;
    name: string;
    normalBalance: NormalBalance;
    description: string | null;
    isActive: boolean;
    balance: number;
    group: { id: number; name: string; type: GroupTypeStr } | null;
}

const cellClass = "w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export default function ChartOfAccountsPage() {
    const [accounts, setAccounts] = useState<GlAccount[]>([]);
    const [groups, setGroups] = useState<AccountGroupLite[]>([]);
    const [loading, setLoading] = useState(true);
    const [addOpen, setAddOpen] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editName, setEditName] = useState("");
    const [editDesc, setEditDesc] = useState("");
    const [editNormalBalance, setEditNormalBalance] = useState<NormalBalance>("DEBIT");
    const [saving, setSaving] = useState(false);

    // Refetch without flipping `loading` — the full-page spinner is for the
    // first load only. Re-showing it after every save unmounted the whole
    // table (page blink + lost scroll position).
    const load = () => {
        Promise.all([
            axios.get<GlAccount[]>("/api/accountancy/gl-accounts?activeOnly=false"),
            axios.get<AccountGroupLite[]>("/api/accountancy/account-groups"),
        ])
            .then(([a, g]) => { setAccounts(a.data); setGroups(g.data); })
            .catch(() => toast.error("Failed to load accounts"))
            .finally(() => setLoading(false));
    };

    useEffect(load, []);

    // Group accounts by their parent group's type. Rows with no group fall
    // into a separate "Ungrouped" bucket so they're visible (post-seed there
    // shouldn't be any, but it surfaces orphans during data migrations).
    const grouped = GL_TYPE_ORDER.map((type) => ({
        type,
        rows: accounts.filter((a) => a.group?.type === type),
    }));
    const ungrouped = accounts.filter((a) => !a.group);

    const startEdit = (a: GlAccount) => {
        setEditingId(a.id);
        setEditName(a.name);
        setEditDesc(a.description ?? "");
        setEditNormalBalance(a.normalBalance);
    };

    const saveEdit = async (id: number) => {
        setSaving(true);
        try {
            await axios.patch(`/api/accountancy/gl-accounts/${id}`, {
                name: editName, description: editDesc, normalBalance: editNormalBalance,
            });
            toast.success("Updated");
            setEditingId(null);
            load();
        } catch {
            toast.error("Failed to update");
        } finally {
            setSaving(false);
        }
    };

    const toggleActive = async (a: GlAccount) => {
        if (a.isActive) {
            try {
                await axios.delete(`/api/accountancy/gl-accounts/${a.id}`);
                toast.success("Deactivated");
                load();
            } catch (err: unknown) {
                const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed";
                toast.error(msg ?? "Failed");
            }
        } else {
            await axios.patch(`/api/accountancy/gl-accounts/${a.id}`, { isActive: true });
            toast.success("Activated");
            load();
        }
    };

    // Hard delete — same Account table/rule as the Ledgers page: only allowed
    // when the account has no posted entries, no sub-accounts, and isn't a
    // customer/company identity ledger (enforced server-side).
    const deleteAccount = async (a: GlAccount) => {
        if (!confirm(`Delete account "${a.name}"? This cannot be undone.`)) return;
        try {
            await axios.delete(`/api/accountancy/ledgers/${a.id}`);
            toast.success("Account deleted");
            load();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Cannot delete";
            toast.error(msg ?? "Cannot delete account");
        }
    };

    return (
        // Header sits outside the scroller so "New Account" stays reachable no
        // matter how far down the list the user has scrolled.
        <div className="flex h-full flex-col">
            <div className="shrink-0 bg-background px-6 py-3">
                <div className="mx-auto flex max-w-5xl items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-foreground">Chart of Accounts</h1>
                        <p className="text-sm text-muted-foreground mt-0.5">General Ledger master list</p>
                    </div>
                    <Button onClick={() => setAddOpen(true)}>
                        <Plus size={16} /> New Account
                    </Button>
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-6">
                <div className="max-w-5xl mx-auto space-y-6">
                    {loading ? (
                        <div className="flex items-center justify-center h-64">
                            <Loader2 className="animate-spin text-muted-foreground" size={32} />
                        </div>
                    ) : (
                        <>
                            {/* Account groups — each section is its own bounded
                                table with a sticky header, so scrolling past a
                                long section keeps its column labels in view. */}
                            {grouped.map(({ type, rows }) => rows.length === 0 ? null : (
                                <AccountSection key={type} type={type} rows={rows} editingId={editingId} editName={editName} editDesc={editDesc}
                                    editNormalBalance={editNormalBalance} saving={saving}
                                    onStartEdit={startEdit} onSetEditName={setEditName} onSetEditDesc={setEditDesc}
                                    onSetEditNormalBalance={setEditNormalBalance}
                                    onSaveEdit={saveEdit} onCancelEdit={() => setEditingId(null)} onToggleActive={toggleActive} onDelete={deleteAccount} />
                            ))}

                            {ungrouped.length > 0 && (
                                <AccountSection type={null} rows={ungrouped} editingId={editingId} editName={editName} editDesc={editDesc}
                                    editNormalBalance={editNormalBalance} saving={saving}
                                    onStartEdit={startEdit} onSetEditName={setEditName} onSetEditDesc={setEditDesc}
                                    onSetEditNormalBalance={setEditNormalBalance}
                                    onSaveEdit={saveEdit} onCancelEdit={() => setEditingId(null)} onToggleActive={toggleActive} onDelete={deleteAccount} />
                            )}
                        </>
                    )}
                </div>
            </div>

            <CreateGlAccountDialog
                open={addOpen}
                onOpenChange={setAddOpen}
                groups={groups}
                onCreated={load}
            />
        </div>
    );
}

type SectionProps = {
    type: GlAccountType | null;
    rows: GlAccount[];
    editingId: number | null;
    editName: string;
    editDesc: string;
    editNormalBalance: NormalBalance;
    saving: boolean;
    onStartEdit: (a: GlAccount) => void;
    onSetEditName: (s: string) => void;
    onSetEditDesc: (s: string) => void;
    onSetEditNormalBalance: (v: NormalBalance) => void;
    onSaveEdit: (id: number) => void;
    onCancelEdit: () => void;
    onToggleActive: (a: GlAccount) => void;
    onDelete: (a: GlAccount) => void;
};

function AccountSection({
    type, rows, editingId, editName, editDesc, editNormalBalance, saving,
    onStartEdit, onSetEditName, onSetEditDesc, onSetEditNormalBalance, onSaveEdit, onCancelEdit, onToggleActive, onDelete,
}: SectionProps) {
    const colorClass = type ? GL_TYPE_COLORS[type] : "bg-muted text-muted-foreground";
    const label = type ?? "UNGROUPED";
    return (
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow">
            <div className={`flex items-center justify-between border-b border-border px-5 py-3 ${colorClass}`}>
                <span className={`text-xs font-bold uppercase tracking-wider px-2 py-1 border border-current/20 ${colorClass}`}>{label}</span>
                <span className="text-xs opacity-70">{rows.length} accounts</span>
            </div>
            <table className="w-full text-sm">
                {/* Sticky within the page's shared scroller — pins to the top
                    while this section's rows are in view, then the next
                    section's header takes over. Sticky goes on the cells,
                    not <thead>, for Safari; each needs its own background. */}
                <thead>
                    <tr className="text-xs text-muted-foreground [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:border-b [&>th]:border-border [&>th]:bg-muted">
                        <th className="px-5 py-2 text-left font-medium">Name</th>
                        <th className="px-5 py-2 text-left font-medium">Group</th>
                        <th className="px-5 py-2 text-left font-medium">Normal Balance</th>
                        <th className="px-5 py-2 text-right font-medium">Current Balance</th>
                        <th className="px-5 py-2 text-center font-medium">Status</th>
                        <th className="px-5 py-2" />
                    </tr>
                </thead>
                <tbody>
                    {rows.map((a) => (
                        <tr key={a.id} className={`border-b last:border-0 hover:bg-muted/40 ${!a.isActive ? "opacity-50" : ""}`}>
                            <td className="px-5 py-3">
                                {editingId === a.id ? (
                                    <input
                                        value={editName}
                                        onChange={(e) => onSetEditName(e.target.value)}
                                        className={cellClass}
                                        autoFocus
                                    />
                                ) : (
                                    <span className="font-medium text-foreground">{a.name}</span>
                                )}
                                {a.description && editingId !== a.id && (
                                    <p className="text-xs text-muted-foreground mt-0.5">{a.description}</p>
                                )}
                                {editingId === a.id && (
                                    <input
                                        value={editDesc}
                                        onChange={(e) => onSetEditDesc(e.target.value)}
                                        className={`${cellClass} mt-1`}
                                        placeholder="Description"
                                    />
                                )}
                            </td>
                            <td className="px-5 py-3">
                                <span className="text-xs text-muted-foreground">
                                    {a.group?.name ?? <span className="italic text-muted-foreground/50">—</span>}
                                </span>
                            </td>
                            <td className="px-5 py-3">
                                {editingId === a.id ? (
                                    <Select
                                        value={editNormalBalance}
                                        onValueChange={(v) => onSetEditNormalBalance(v as NormalBalance)}
                                    >
                                        <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="DEBIT">DEBIT</SelectItem>
                                            <SelectItem value="CREDIT">CREDIT</SelectItem>
                                        </SelectContent>
                                    </Select>
                                ) : (
                                    <span className="text-xs text-muted-foreground">{a.normalBalance}</span>
                                )}
                            </td>
                            <td className="px-5 py-3 text-right font-mono">
                                <span className={a.balance < 0 ? "text-destructive" : "text-foreground"}>
                                    {a.balance < 0 && <TrendingDown size={12} className="inline mr-1" />}
                                    {a.balance > 0 && <TrendingUp size={12} className="inline mr-1 text-green-500" />}
                                    {fmt(a.balance)}
                                </span>
                            </td>
                            <td className="px-5 py-3 text-center">
                                <span className={`text-xs px-2 py-0.5 border font-medium ${a.isActive ? "bg-green-100 text-green-700 border-green-200" : "bg-muted text-muted-foreground border-border"}`}>
                                    {a.isActive ? "Active" : "Inactive"}
                                </span>
                            </td>
                            <td className="px-5 py-3 text-right">
                                <div className="flex items-center gap-1 justify-end">
                                    {editingId === a.id ? (
                                        <>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon-sm"
                                                onClick={() => onSaveEdit(a.id)}
                                                className="text-green-600 hover:bg-green-50"
                                                disabled={saving}
                                            >
                                                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon-sm"
                                                onClick={onCancelEdit}
                                                className="text-muted-foreground hover:bg-muted"
                                            >
                                                <X size={14} />
                                            </Button>
                                        </>
                                    ) : (
                                        <>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon-sm"
                                                onClick={() => onStartEdit(a)}
                                                className="text-muted-foreground hover:bg-primary/10 hover:text-primary"
                                            >
                                                <Pencil size={14} />
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon-sm"
                                                onClick={() => onToggleActive(a)}
                                                className={`text-xs ${a.isActive ? "text-destructive hover:bg-destructive/10" : "text-green-600 hover:bg-green-50"}`}
                                            >
                                                {a.isActive ? <X size={14} /> : <Check size={14} />}
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon-sm"
                                                onClick={() => onDelete(a)}
                                                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                                title="Delete (only if no transactions)"
                                            >
                                                <Trash2 size={14} />
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
