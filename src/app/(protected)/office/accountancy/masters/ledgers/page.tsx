"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import {
    ChevronRight, ChevronDown, Plus, Loader2, ArrowRight,
    Pencil, Check, X, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { fmt } from "@/utils/constants";
import { GroupCombobox } from "@/modules/accountancy/components/GroupCombobox";
import { TallyDateInput } from "@/shared/components/TallyDateInput";

type GroupType = "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE";

interface LedgerRow {
    id: number;
    name: string;
    code: string | null;
    normalBalance: "DEBIT" | "CREDIT" | null;
    isActive: boolean;
    personId: number | null;
    companyId: number | null;
    groupId: number | null;
    balance: number;
    /** Bank-ledger particulars (Bank-group ledgers only) — printed on the
     *  Contra deposit slip. */
    bankJson: unknown;
    openingBalance: number | null;
    openingBalanceType: "DEBIT" | "CREDIT" | null;
    openingBalanceDate: string | null;
}

type NewLedgerForm = {
    name: string;
    groupId: number | null;
    description: string;
    openingBalance: string;
    openingBalanceType: "DEBIT" | "CREDIT";
    openingBalanceDate: string;
};

const createNewLedgerForm = (): NewLedgerForm => ({
    name: "",
    groupId: null,
    description: "",
    openingBalance: "",
    openingBalanceType: "DEBIT",
    openingBalanceDate: new Date().toISOString().slice(0, 10),
});

// Bank particulars are shown only for ledgers under a Bank group (seeded
// "Bank Accounts" / "Bank OD A/c").
const isBankGroupName = (name?: string | null): boolean =>
    (name ?? "").toLowerCase().includes("bank");

type BankFields = { bankName: string; branch: string; accountNumber: string; ifsc: string; beneficiary: string };
const EMPTY_BANK: BankFields = { bankName: "", branch: "", accountNumber: "", ifsc: "", beneficiary: "" };
const hasBankData = (b: BankFields): boolean =>
    !!(b.bankName || b.branch || b.accountNumber || b.ifsc || b.beneficiary);

function parseBank(v: unknown): BankFields {
    if (v == null || typeof v !== "object" || Array.isArray(v)) return { ...EMPTY_BANK };
    const o = v as Record<string, unknown>;
    const s = (x: unknown): string => (typeof x === "string" ? x : "");
    return {
        bankName: s(o.bankName),
        branch: s(o.branch),
        accountNumber: s(o.accountNumber),
        ifsc: s(o.ifsc),
        beneficiary: s(o.beneficiary),
    };
}

const BANK_FIELD_LABELS: { key: keyof BankFields; label: string; placeholder: string }[] = [
    { key: "bankName", label: "Bank Name", placeholder: "State Bank of India" },
    { key: "branch", label: "Branch", placeholder: "Fancy Bazar Branch" },
    { key: "accountNumber", label: "A/C No", placeholder: "38124567890" },
    { key: "ifsc", label: "IFSC", placeholder: "SBIN0000123" },
    { key: "beneficiary", label: "A/C Holder’s Name", placeholder: "Firm name as per bank" },
];

interface GroupNode {
    id: number;
    name: string;
    type: GroupType;
    parentId: number | null;
    sortOrder: number;
    isActive: boolean;
    totalBalance: number;
    _count: { children: number; accounts: number };
    children: GroupNode[];
    ledgers: LedgerRow[];
    /** True direct-ledger count; `ledgers` is capped server-side for display. */
    ledgerTotal: number;
}

// A flattened, depth-tagged row — a group header, one of its ledgers, or a
// "+N more" footer when the group's ledger list was capped.
type VisibleRow =
    | { kind: "group"; depth: number; hasChildren: boolean; group: GroupNode }
    | { kind: "ledger"; depth: number; ledger: LedgerRow }
    | { kind: "more"; depth: number; group: GroupNode };

const TYPE_COLORS: Record<GroupType, string> = {
    ASSET: "bg-blue-50 text-blue-700 border-blue-200",
    LIABILITY: "bg-purple-50 text-purple-700 border-purple-200",
    INCOME: "bg-green-50 text-green-700 border-green-200",
    EXPENSE: "bg-red-50 text-red-700 border-red-200",
};

// Walk the tree, emitting a group row then — when expanded — its child groups
// (recursively) followed by its own ledger accounts one level deeper.
function flattenVisible(nodes: GroupNode[], expanded: Set<number>, depth = 0): VisibleRow[] {
    const result: VisibleRow[] = [];
    for (const n of nodes) {
        const hasChildren = n.children.length > 0 || n.ledgers.length > 0;
        result.push({ kind: "group", depth, hasChildren, group: n });
        if (expanded.has(n.id) && hasChildren) {
            result.push(...flattenVisible(n.children, expanded, depth + 1));
            for (const l of n.ledgers) {
                result.push({ kind: "ledger", depth: depth + 1, ledger: l });
            }
            if (n.ledgerTotal > n.ledgers.length) {
                result.push({ kind: "more", depth: depth + 1, group: n });
            }
        }
    }
    return result;
}

function allGroupsFlat(nodes: GroupNode[]): GroupNode[] {
    const result: GroupNode[] = [];
    for (const n of nodes) {
        result.push(n);
        result.push(...allGroupsFlat(n.children));
    }
    return result;
}

function countLedgers(nodes: GroupNode[]): number {
    let n = 0;
    for (const g of nodes) n += g.ledgerTotal + countLedgers(g.children);
    return n;
}

function drCr(balance: number): string {
    if (balance === 0) return "0.00";
    const abs = fmt(Math.abs(balance));
    return balance > 0 ? `${abs} Dr` : `${abs} Cr`;
}

// A ledger's normal balance is inherited from its group's accounting nature.
function inheritedNormalBalance(type: GroupType): "Debit" | "Credit" {
    return type === "ASSET" || type === "EXPENSE" ? "Debit" : "Credit";
}

export default function LedgersPage() {
    const router = useRouter();

    const [tree, setTree] = useState<GroupNode[]>([]);
    const [expanded, setExpanded] = useState<Set<number>>(new Set());
    const [loading, setLoading] = useState(true);
    const [showAdd, setShowAdd] = useState(false);
    const [saving, setSaving] = useState(false);

    const [newForm, setNewForm] = useState<NewLedgerForm>(createNewLedgerForm);
    const [newBank, setNewBank] = useState<BankFields>(EMPTY_BANK);

    // Inline ledger edit (name + parent group + bank particulars + opening balance)
    const [editLedgerId, setEditLedgerId] = useState<number | null>(null);
    const [editName, setEditName] = useState("");
    const [editGroupId, setEditGroupId] = useState<number | null>(null);
    const [editBank, setEditBank] = useState<BankFields>(EMPTY_BANK);
    const [editOpeningBalance, setEditOpeningBalance] = useState("");
    const [editOpeningBalanceType, setEditOpeningBalanceType] = useState<"DEBIT" | "CREDIT">("DEBIT");
    const [editOpeningBalanceDate, setEditOpeningBalanceDate] = useState("");
    const [savingLedger, setSavingLedger] = useState(false);

    const load = useCallback(() => {
        setLoading(true);
        axios.get<GroupNode[]>("/api/accountancy/account-groups?withLedgers=1")
            .then((r) => {
                setTree(r.data);
                setExpanded((prev) => {
                    if (prev.size > 0) return prev;
                    return new Set(r.data.map((g) => g.id));
                });
            })
            .catch(() => toast.error("Failed to load account groups"))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => { load(); }, [load]);

    const toggle = (id: number) =>
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(id)) { next.delete(id); } else { next.add(id); }
            return next;
        });

    const allFlat = allGroupsFlat(tree);
    const flat = flattenVisible(tree, expanded);
    const ledgerCount = countLedgers(tree);

    const startEditLedger = (l: LedgerRow) => {
        setEditLedgerId(l.id);
        setEditName(l.name);
        setEditGroupId(l.groupId);
        setEditBank(parseBank(l.bankJson));
        setEditOpeningBalance(l.openingBalance ? String(l.openingBalance) : "");
        setEditOpeningBalanceType(l.openingBalanceType ?? "DEBIT");
        setEditOpeningBalanceDate(
            l.openingBalanceDate
                ? new Date(l.openingBalanceDate).toISOString().slice(0, 10)
                : new Date().toISOString().slice(0, 10),
        );
    };

    const saveLedger = async (id: number) => {
        if (!editName.trim()) { toast.error("Name is required"); return; }
        const hasOpeningBalance = editOpeningBalance.trim() !== "";
        const openingBalance = Number(editOpeningBalance);
        if (hasOpeningBalance && (!Number.isFinite(openingBalance) || openingBalance < 0)) {
            toast.error("Opening balance must be a valid non-negative number");
            return;
        }
        if (hasOpeningBalance && !editOpeningBalanceDate) {
            toast.error("Opening balance date is required");
            return;
        }
        setSavingLedger(true);
        const editGroupIsBank = isBankGroupName(allFlat.find((g) => g.id === editGroupId)?.name);
        try {
            const payload: Record<string, unknown> = {
                name: editName.trim(),
                groupId: editGroupId,
                // Bank-group ledgers carry their particulars; moving a ledger
                // out of the Bank group clears them.
                bankJson: editGroupIsBank && hasBankData(editBank) ? editBank : null,
            };
            if (hasOpeningBalance) {
                payload.openingBalance = openingBalance;
                payload.openingBalanceType = editOpeningBalanceType;
                payload.openingBalanceDate = editOpeningBalanceDate;
            } else {
                payload.openingBalance = null;
                payload.openingBalanceType = null;
                payload.openingBalanceDate = null;
            }
            await axios.patch(`/api/accountancy/ledgers/${id}`, payload);
            toast.success("Ledger updated");
            setEditLedgerId(null);
            load();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed";
            toast.error(msg ?? "Failed to update ledger");
        } finally {
            setSavingLedger(false);
        }
    };

    const deleteLedger = async (l: LedgerRow) => {
        if (!confirm(`Delete ledger "${l.name}"?`)) return;
        try {
            await axios.delete(`/api/accountancy/ledgers/${l.id}`);
            toast.success("Ledger deleted");
            load();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Cannot delete";
            toast.error(msg ?? "Cannot delete ledger");
        }
    };

    const addLedger = async () => {
        if (!newForm.name.trim()) { toast.error("Name is required"); return; }
        if (!newForm.groupId) { toast.error("Group is required"); return; }
        const hasOpeningBalance = newForm.openingBalance.trim() !== "";
        const openingBalance = Number(newForm.openingBalance);
        if (hasOpeningBalance && (!Number.isFinite(openingBalance) || openingBalance <= 0)) {
            toast.error("Opening balance must be greater than zero");
            return;
        }
        if (hasOpeningBalance && !newForm.openingBalanceDate) {
            toast.error("Opening balance date is required");
            return;
        }
        setSaving(true);
        const newGroupIsBank = isBankGroupName(allFlat.find((g) => g.id === newForm.groupId)?.name);
        try {
            // normalBalance is left unset → inherited from the group's nature.
            await axios.post("/api/accountancy/ledgers", {
                name: newForm.name.trim(),
                groupId: newForm.groupId,
                description: newForm.description.trim() || null,
                ...(newGroupIsBank && hasBankData(newBank) ? { bankJson: newBank } : {}),
                ...(hasOpeningBalance ? {
                    openingBalance,
                    openingBalanceType: newForm.openingBalanceType,
                    openingBalanceDate: newForm.openingBalanceDate,
                } : {}),
            });
            toast.success("Ledger created");
            setShowAdd(false);
            setNewForm(createNewLedgerForm());
            setNewBank(EMPTY_BANK);
            load();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Failed";
            toast.error(msg ?? "Failed to create ledger");
        } finally {
            setSaving(false);
        }
    };

    if (loading) return (
        <div className="flex items-center justify-center h-64">
            <Loader2 className="animate-spin text-muted-foreground" size={32} />
        </div>
    );

    return (
        <ScrollArea className="h-full" type="always">
            <div className="max-w-5xl mx-auto space-y-6 px-6 pt-3 pb-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-foreground">Ledgers</h1>
                        <p className="text-sm text-muted-foreground mt-0.5">
                            {allFlat.length} groups · {ledgerCount} ledgers — expand a group to see its ledgers
                        </p>
                    </div>
                    <Button onClick={() => setShowAdd((v) => !v)}>
                        <Plus size={16} /> New Ledger
                    </Button>
                </div>

                {/* Add ledger form */}
                {showAdd && (
                    <div className="space-y-4 rounded-lg border border-border bg-card p-5 shadow">
                        <h2 className="font-semibold text-foreground">New Ledger Account</h2>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <Label>Name <span className="text-destructive">*</span></Label>
                                <Input
                                    value={newForm.name}
                                    onChange={(e) => setNewForm((f) => ({ ...f, name: e.target.value }))}
                                    placeholder="Account name"
                                    autoFocus
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Under (Group) <span className="text-destructive">*</span></Label>
                                <GroupCombobox
                                    value={newForm.groupId}
                                    onChange={(groupId) => setNewForm((f) => ({ ...f, groupId }))}
                                    groups={allFlat}
                                    allowNone={false}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Normal Balance</Label>
                                {(() => {
                                    const selectedGroup = allFlat.find((g) => g.id === newForm.groupId);
                                    return (
                                        <div className="flex h-9 items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground">
                                            {selectedGroup
                                                ? `${inheritedNormalBalance(selectedGroup.type)} — inherited from ${selectedGroup.name}`
                                                : "Inherited from group"}
                                        </div>
                                    );
                                })()}
                            </div>
                            <div className="space-y-1.5">
                                <Label>Description</Label>
                                <Input
                                    value={newForm.description}
                                    onChange={(e) => setNewForm((f) => ({ ...f, description: e.target.value }))}
                                    placeholder="Optional"
                                />
                            </div>
                            <div className="col-span-2 space-y-3 rounded-md border border-border bg-muted/30 p-4">
                                <p className="text-sm font-medium text-foreground">
                                    Opening Balance <span className="font-normal text-muted-foreground">— optional</span>
                                </p>
                                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                                    <div className="space-y-1.5">
                                        <Label>Amount (₹)</Label>
                                        <Input
                                            type="text"
                                            inputMode="decimal"
                                            value={newForm.openingBalance}
                                            onChange={(e) => setNewForm((f) => ({ ...f, openingBalance: e.target.value }))}
                                            placeholder="0.00"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label>Dr / Cr</Label>
                                        <Select
                                            value={newForm.openingBalanceType}
                                            onValueChange={(value) => setNewForm((f) => ({
                                                ...f,
                                                openingBalanceType: value as "DEBIT" | "CREDIT",
                                            }))}
                                        >
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="DEBIT">Debit</SelectItem>
                                                <SelectItem value="CREDIT">Credit</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label>As of</Label>
                                        <TallyDateInput
                                            value={newForm.openingBalanceDate}
                                            onValueChange={(iso) => setNewForm((f) => ({ ...f, openingBalanceDate: iso }))}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                        {/* Bank particulars — only for ledgers under a Bank group;
                        printed on the Contra deposit slip. */}
                        {isBankGroupName(allFlat.find((g) => g.id === newForm.groupId)?.name) && (
                            <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4">
                                <p className="text-sm font-medium text-foreground">Bank Details <span className="font-normal text-muted-foreground">— printed on the deposit slip</span></p>
                                <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                                    {BANK_FIELD_LABELS.map(({ key, label, placeholder }) => (
                                        <div key={key} className="space-y-1.5">
                                            <Label>{label}</Label>
                                            <Input
                                                value={newBank[key]}
                                                onChange={(e) => setNewBank((b) => ({ ...b, [key]: e.target.value }))}
                                                placeholder={placeholder}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        <div className="flex gap-2 justify-end">
                            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
                            <Button onClick={addLedger} disabled={saving}>
                                {saving && <Loader2 size={14} className="animate-spin" />} Save
                            </Button>
                        </div>
                    </div>
                )}

                {/* Group tree table */}
                <div className="overflow-hidden rounded-lg border border-border bg-card shadow">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border bg-muted text-xs text-muted-foreground">
                                <th className="px-4 py-2.5 text-left font-medium w-8" />
                                <th className="px-4 py-2.5 text-left font-medium">Name of Group</th>
                                <th className="px-4 py-2.5 text-left font-medium w-28">Type</th>
                                <th className="px-4 py-2.5 text-right font-medium w-24">Accounts</th>
                                <th className="px-4 py-2.5 text-right font-medium w-36">Balance</th>
                                <th className="px-4 py-2.5 w-16" />
                            </tr>
                        </thead>
                        <tbody>
                            {flat.map((row) => {
                                // ── Group header row ──────────────────────────────
                                if (row.kind === "group") {
                                    const g = row.group;
                                    return (
                                        <tr
                                            key={`g-${g.id}`}
                                            className="border-b last:border-0 hover:bg-muted/40"
                                        >
                                            {/* Expand chevron */}
                                            <td className="px-2 py-2.5 text-center w-8">
                                                {row.hasChildren ? (
                                                    <button
                                                        onClick={() => toggle(g.id)}
                                                        className="text-muted-foreground hover:text-foreground transition-colors"
                                                    >
                                                        {expanded.has(g.id)
                                                            ? <ChevronDown size={14} />
                                                            : <ChevronRight size={14} />}
                                                    </button>
                                                ) : null}
                                            </td>

                                            {/* Name (indented by depth) */}
                                            <td className="py-2.5 pr-4">
                                                <div style={{ paddingLeft: row.depth * 20 }}>
                                                    {g._count.accounts > 0 ? (
                                                        <Link
                                                            href={`/office/accountancy/masters/ledgers/${g.id}`}
                                                            className={`font-medium hover:underline hover:text-primary ${row.depth === 0 ? "text-foreground" : "text-muted-foreground"}`}
                                                        >
                                                            {g.name}
                                                        </Link>
                                                    ) : (
                                                        <span className={`font-medium ${row.depth === 0 ? "text-foreground" : "text-muted-foreground"}`}>
                                                            {g.name}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>

                                            {/* Type badge */}
                                            <td className="px-4 py-2.5">
                                                <span className={`text-xs px-2 py-0.5 border font-medium rounded-sm ${TYPE_COLORS[g.type]}`}>
                                                    {g.type}
                                                </span>
                                            </td>

                                            {/* Account count */}
                                            <td className="px-4 py-2.5 text-right text-muted-foreground text-xs">
                                                {g._count.accounts > 0
                                                    ? <span className="font-medium text-foreground">{g._count.accounts}</span>
                                                    : <span className="text-muted-foreground/50">—</span>}
                                            </td>

                                            {/* Balance (rolled up) */}
                                            <td className="px-4 py-2.5 text-right font-mono text-xs">
                                                {g._count.accounts > 0
                                                    ? <span className={g.totalBalance < 0 ? "text-destructive" : "text-foreground"}>
                                                        {drCr(g.totalBalance)}
                                                    </span>
                                                    : <span className="text-muted-foreground/50">—</span>}
                                            </td>

                                            {/* View accounts link */}
                                            <td className="px-4 py-2.5 text-right">
                                                {g._count.accounts > 0 && (
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-7 px-2 text-xs text-muted-foreground hover:text-primary gap-1"
                                                        onClick={() => router.push(`/office/accountancy/masters/ledgers/${g.id}`)}
                                                    >
                                                        View <ArrowRight size={12} />
                                                    </Button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                }

                                // ── "View all" footer when the ledger list is capped ──
                                if (row.kind === "more") {
                                    const g = row.group;
                                    return (
                                        <tr key={`m-${g.id}`} className="border-b last:border-0 bg-muted/10">
                                            <td className="px-2 py-2 w-8" />
                                            <td className="py-2 pr-4" colSpan={5}>
                                                <div style={{ paddingLeft: row.depth * 20 }}>
                                                    <button
                                                        type="button"
                                                        onClick={() => router.push(`/office/accountancy/masters/ledgers/${g.id}`)}
                                                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary hover:underline"
                                                    >
                                                        Showing {g.ledgers.length} of {g.ledgerTotal} ledgers — View all
                                                        <ArrowRight size={12} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                }

                                // ── Ledger (leaf) row ─────────────────────────────
                                const l = row.ledger;
                                const isEditing = editLedgerId === l.id;
                                const isIdentity = l.personId !== null || l.companyId !== null;
                                if (isEditing) {
                                    return (
                                        <tr
                                            key={`l-${l.id}`}
                                            className="border-b last:border-0 bg-muted/20"
                                        >
                                            <td className="px-2 py-3 w-8 align-top" />
                                            <td colSpan={5} className="py-3 pr-4 align-top">
                                                <div style={{ paddingLeft: row.depth * 20 }}>
                                                    <div className="rounded-lg border border-border bg-card p-4 shadow-sm space-y-3">
                                                        <div className="grid grid-cols-2 gap-4">
                                                            <div className="space-y-1.5">
                                                                <Label className="text-xs">Name <span className="text-destructive">*</span></Label>
                                                                <Input
                                                                    value={editName}
                                                                    onChange={(e) => setEditName(e.target.value)}
                                                                    placeholder="Ledger name"
                                                                    autoFocus
                                                                    className="h-8 text-sm"
                                                                />
                                                            </div>
                                                            <div className="space-y-1.5">
                                                                <Label className="text-xs">Under (Group)</Label>
                                                                <GroupCombobox
                                                                    value={editGroupId}
                                                                    onChange={setEditGroupId}
                                                                    groups={allFlat}
                                                                />
                                                            </div>
                                                        </div>
                                                        {/* Opening Balance */}
                                                        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
                                                            <p className="text-sm font-medium text-foreground">
                                                                Opening Balance <span className="font-normal text-muted-foreground">— leave blank to clear</span>
                                                            </p>
                                                            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                                                                <div className="space-y-1.5">
                                                                    <Label className="text-xs">Amount (₹)</Label>
                                                                    <Input
                                                                        type="text"
                                                                        inputMode="decimal"
                                                                        value={editOpeningBalance}
                                                                        onChange={(e) => setEditOpeningBalance(e.target.value)}
                                                                        placeholder="0.00"
                                                                        className="h-8 text-sm"
                                                                    />
                                                                </div>
                                                                <div className="space-y-1.5">
                                                                    <Label className="text-xs">Dr / Cr</Label>
                                                                    <Select
                                                                        value={editOpeningBalanceType}
                                                                        onValueChange={(value) => setEditOpeningBalanceType(value as "DEBIT" | "CREDIT")}
                                                                    >
                                                                        <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                                                                        <SelectContent>
                                                                            <SelectItem value="DEBIT">Debit</SelectItem>
                                                                            <SelectItem value="CREDIT">Credit</SelectItem>
                                                                        </SelectContent>
                                                                    </Select>
                                                                </div>
                                                                <div className="space-y-1.5">
                                                                    <Label className="text-xs">As of</Label>
                                                                    <TallyDateInput
                                                                        value={editOpeningBalanceDate}
                                                                        onValueChange={(iso) => setEditOpeningBalanceDate(iso)}
                                                                        className="h-8 text-sm"
                                                                    />
                                                                </div>
                                                            </div>
                                                        </div>
                                                        {/* Bank particulars — Bank-group ledgers only. */}
                                                        {isBankGroupName(allFlat.find((g) => g.id === editGroupId)?.name) && (
                                                            <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
                                                                <p className="text-sm font-medium text-foreground">Bank Details <span className="font-normal text-muted-foreground">— printed on the deposit slip</span></p>
                                                                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                                                                    {BANK_FIELD_LABELS.map(({ key, label, placeholder }) => (
                                                                        <div key={key} className="space-y-1.5">
                                                                            <Label className="text-xs">{label}</Label>
                                                                            <Input
                                                                                value={editBank[key]}
                                                                                onChange={(e) => setEditBank((b) => ({ ...b, [key]: e.target.value }))}
                                                                                placeholder={placeholder}
                                                                                className="h-8 text-sm"
                                                                            />
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                        <div className="flex gap-2 justify-end pt-1">
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                onClick={() => setEditLedgerId(null)}
                                                                className="h-8"
                                                            >
                                                                <X size={14} className="mr-1" /> Cancel
                                                            </Button>
                                                            <Button
                                                                size="sm"
                                                                className="h-8 text-white"
                                                                onClick={() => saveLedger(l.id)}
                                                                disabled={savingLedger}
                                                            >
                                                                {savingLedger ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Check size={14} className="mr-1" />} Save
                                                            </Button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                }
                                return (
                                    <tr
                                        key={`l-${l.id}`}
                                        className={`border-b last:border-0 hover:bg-muted/30 ${!l.isActive ? "opacity-60" : ""}`}
                                    >
                                        {/* No chevron for leaves */}
                                        <td className="px-2 py-2 w-8" />

                                        {/* Ledger name (one level deeper than its group) */}
                                        <td className="py-2 pr-4">
                                            <div style={{ paddingLeft: row.depth * 20 }}>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-foreground">{l.name}</span>
                                                    {l.code && (
                                                        <span className="font-mono text-xs text-muted-foreground/70">{l.code}</span>
                                                    )}
                                                    {isIdentity && (
                                                        <span className="text-xs px-1.5 py-0.5 bg-muted text-muted-foreground border border-border rounded-sm">
                                                            {l.personId ? "Customer" : "Company"}
                                                        </span>
                                                    )}
                                                    {!l.isActive && (
                                                        <span className="text-xs px-1.5 py-0.5 bg-muted text-muted-foreground border border-border rounded-sm">
                                                            Inactive
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </td>

                                        {/* Type column — blank for ledgers */}
                                        <td className="px-4 py-2" />

                                        {/* Account count — blank for ledgers */}
                                        <td className="px-4 py-2" />

                                        {/* Balance */}
                                        <td className="px-4 py-2 text-right font-mono text-xs">
                                            {l.balance !== 0
                                                ? <span className={l.balance < 0 ? "text-destructive" : "text-foreground"}>
                                                    {drCr(l.balance)}
                                                </span>
                                                : <span className="text-muted-foreground/50">0.00</span>}
                                        </td>

                                        {/* Edit / delete buttons */}
                                        <td className="px-4 py-2 text-right">
                                            <div className="flex items-center gap-1 justify-end">
                                                <Button
                                                    variant="ghost" size="icon-sm"
                                                    className="text-muted-foreground hover:bg-primary/10 hover:text-primary"
                                                    onClick={() => startEditLedger(l)}
                                                    aria-label={`Edit ${l.name}`}
                                                >
                                                    <Pencil size={14} />
                                                </Button>
                                                <Button
                                                    variant="ghost" size="icon-sm"
                                                    className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                                    onClick={() => deleteLedger(l)}
                                                    disabled={isIdentity}
                                                    aria-label={`Delete ${l.name}`}
                                                >
                                                    <Trash2 size={14} />
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                            {flat.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">
                                        No groups found.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </ScrollArea>
    );
}
