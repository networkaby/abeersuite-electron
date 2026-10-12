"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, LayoutGrid, ChevronRight, ChevronDown, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useDeleteWithConfirm } from "@/shared/hooks";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { flattenTree, treeLabel } from "@/modules/inventory/components/InventoryMasterDropdownQuickDialog";
import { useCollapsibleTree } from "@/modules/inventory/hooks";

type GstRateOpt = { id: number; rate: string | number; label: string; isActive: boolean };

type Row = {
    id: number;
    name: string;
    isActive: boolean;
    parentId: number | null;
    parent: { id: number; name: string } | null;
    gstRateId: number | null;
    gstRate: { id: number; rate: string | number; label: string } | null;
    hsnCode: string | null;
    taxability: string | null;
    /** Movement-band overrides (days) — null = inherit parent → org default. */
    slowAfterDays: number | null;
    nonMovingAfterDays: number | null;
    deadAfterDays: number | null;
};

const TAXABILITY_OPTIONS = [
    { value: "TAXABLE",   label: "Taxable" },
    { value: "EXEMPT",    label: "Exempt" },
    { value: "NIL_RATED", label: "Nil Rated (0%)" },
    { value: "NON_GST",   label: "Non-GST" },
];

const emptyForm = {
    name: "",
    isActive: true,
    parentId: "",
    gstRateId: "",
    hsnCode: "",
    taxability: "",
    slowAfterDays: "",
    nonMovingAfterDays: "",
    deadAfterDays: "",
};

const NONE = "__none__";

/** Org-wide movement-band fallback (Settings → Org defaults). */
type OrgBands = { slow: number; nonMoving: number; dead: number };
const BAND_KEYS = ["slowAfterDays", "nonMovingAfterDays", "deadAfterDays"] as const;

export default function InventoryProductGroupsPage() {
    const [rows, setRows] = useState<Row[]>([]);
    const [gstRates, setGstRates] = useState<GstRateOpt[]>([]);
    const [orgBands, setOrgBands] = useState<OrgBands | null>(null);
    const [loading, setLoading] = useState(true);
    const [adding, setAdding] = useState(false);
    const [editId, setEditId] = useState<number | null>(null);
    const [form, setForm] = useState(emptyForm);
    const [saving, setSaving] = useState(false);

    const load = () => {
        axios
            .get<Row[]>("/api/inventory/product-groups")
            .then((r) => setRows(r.data))
            .catch(() => toast.error("Failed to load groups"))
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        load();
        axios
            .get<GstRateOpt[]>("/api/inventory/gst-rates")
            .then((r) => setGstRates(r.data))
            .catch(() => {/* non-fatal */});
        axios
            .get("/api/settings/org-defaults")
            .then((r) => setOrgBands({
                slow:      r.data.reorderSlowAfterDays      ?? 30,
                nonMoving: r.data.reorderNonMovingAfterDays ?? 90,
                dead:      r.data.reorderDeadAfterDays      ?? 180,
            }))
            .catch(() => {/* non-fatal — bands fall back to em dash */});
    }, []);

    // Resolve a group's EFFECTIVE bands: its own value if set, else walk up the
    // parent chain (first ancestor that sets the field wins), else the org
    // default. `own` marks whether the winning value is set on THIS group — so
    // the table can show own values solid and inherited values muted, but always
    // show the real number (never a bare "inherit").
    const resolveBands = (r: Row): Record<typeof BAND_KEYS[number], { value: number | null; own: boolean }> => {
        const byId = new Map(rows.map((g) => [g.id, g]));
        const orgFallback: Record<typeof BAND_KEYS[number], number | null> = {
            slowAfterDays:      orgBands?.slow      ?? null,
            nonMovingAfterDays: orgBands?.nonMoving ?? null,
            deadAfterDays:      orgBands?.dead      ?? null,
        };
        const out = {} as Record<typeof BAND_KEYS[number], { value: number | null; own: boolean }>;
        for (const key of BAND_KEYS) {
            if (r[key] != null) { out[key] = { value: r[key], own: true }; continue; }
            let node = r.parentId != null ? byId.get(r.parentId) : undefined;
            const seen = new Set<number>();
            let value: number | null = null;
            while (node && !seen.has(node.id)) {
                seen.add(node.id);
                if (node[key] != null) { value = node[key]; break; }
                node = node.parentId != null ? byId.get(node.parentId) : undefined;
            }
            out[key] = { value: value ?? orgFallback[key], own: false };
        }
        return out;
    };

    useRealtimeTopics(["catalogue"], load);

    const cancel = () => {
        setAdding(false);
        setEditId(null);
        setForm(emptyForm);
    };

    const save = async () => {
        if (!form.name.trim()) {
            toast.error("Name is required");
            return;
        }
        setSaving(true);
        try {
            const payload = {
                name: form.name.trim(),
                isActive: form.isActive,
                parentId:   form.parentId   !== "" && form.parentId !== NONE ? Number(form.parentId) : null,
                gstRateId:  form.gstRateId  !== "" && form.gstRateId !== NONE ? Number(form.gstRateId) : null,
                hsnCode:    form.hsnCode.trim() || null,
                taxability: form.taxability !== "" && form.taxability !== NONE ? form.taxability : null,
                slowAfterDays:      form.slowAfterDays.trim()      !== "" ? Number(form.slowAfterDays)      : null,
                nonMovingAfterDays: form.nonMovingAfterDays.trim() !== "" ? Number(form.nonMovingAfterDays) : null,
                deadAfterDays:      form.deadAfterDays.trim()      !== "" ? Number(form.deadAfterDays)      : null,
            };
            if (adding) {
                await axios.post("/api/inventory/product-groups", payload);
                toast.success("Group created");
            } else if (editId != null) {
                await axios.patch(`/api/inventory/product-groups/${editId}`, payload);
                toast.success("Group updated");
            }
            cancel();
            load();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error : "Save failed");
        } finally {
            setSaving(false);
        }
    };

    // ── Inline movement-band editing ──────────────────────────────────────
    // Bands change often, so they are editable straight in the table row —
    // no need to open the full Edit dialog. Blank = inherit (null).
    const [bandEditId, setBandEditId] = useState<number | null>(null);
    const [bandForm, setBandForm] = useState({ slow: "", nonMoving: "", dead: "" });
    const [bandSaving, setBandSaving] = useState(false);

    const startBandEdit = (r: Row) => {
        setBandEditId(r.id);
        setBandForm({
            slow:      r.slowAfterDays      != null ? String(r.slowAfterDays)      : "",
            nonMoving: r.nonMovingAfterDays != null ? String(r.nonMovingAfterDays) : "",
            dead:      r.deadAfterDays      != null ? String(r.deadAfterDays)      : "",
        });
    };

    const saveBands = async () => {
        if (bandEditId == null) return;
        setBandSaving(true);
        try {
            await axios.patch(`/api/inventory/product-groups/${bandEditId}`, {
                slowAfterDays:      bandForm.slow.trim()      !== "" ? Number(bandForm.slow)      : null,
                nonMovingAfterDays: bandForm.nonMoving.trim() !== "" ? Number(bandForm.nonMoving) : null,
                deadAfterDays:      bandForm.dead.trim()      !== "" ? Number(bandForm.dead)      : null,
            });
            toast.success("Movement bands updated");
            setBandEditId(null);
            load();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error : "Save failed");
        } finally {
            setBandSaving(false);
        }
    };

    const { remove: del } = useDeleteWithConfirm({
        url: (id) => `/api/inventory/product-groups/${id}`,
        message: () => "Delete this group?",
        errorMessage: "Delete failed",
        onSuccess: () => load(),
    });

    // Groups eligible as parent: all except the current group being edited (to avoid self-ref).
    const parentOptions = rows.filter((r) => r.id !== editId);

    // Collapsible hierarchy view: parent → child ordering (via flattenTree) with
    // per-node expand/collapse. Shared with the categories master page.
    const { visible, collapsed, toggle, expandAll, collapseAll, hasTree } = useCollapsibleTree(rows);

    return (
        <div className="flex h-full flex-col gap-4 overflow-hidden p-6">
            <div className="flex flex-none flex-wrap items-center justify-between gap-4">
                <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
                    <LayoutGrid className="size-5" aria-hidden />
                    Product groups
                </h2>
                <div className="flex items-center gap-2">
                    {hasTree ? (
                        <>
                            <Button type="button" variant="outline" size="sm" onClick={expandAll}>Expand all</Button>
                            <Button type="button" variant="outline" size="sm" onClick={collapseAll}>Collapse all</Button>
                        </>
                    ) : null}
                    <Button type="button" onClick={() => { setForm(emptyForm); setEditId(null); setAdding(true); }} disabled={adding}>
                        <Plus className="size-4" />
                        New group
                    </Button>
                </div>
            </div>

            <Dialog open={adding || editId != null} onOpenChange={(o) => { if (!o) cancel(); }}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{adding ? "New group" : "Edit group"}</DialogTitle>
                    </DialogHeader>

                    <div className="grid gap-4 sm:grid-cols-2">
                        {/* Name */}
                        <div className="space-y-2 sm:col-span-2">
                            <Label>Name</Label>
                            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                        </div>

                        {/* Parent group */}
                        <div className="space-y-2">
                            <Label>Parent group</Label>
                            <Select
                                value={form.parentId || NONE}
                                onValueChange={(v) => setForm((f) => ({ ...f, parentId: v === NONE ? "" : v }))}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="None (top-level)" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={NONE}>None (top-level)</SelectItem>
                                    {flattenTree(parentOptions).map((r) => (
                                        <SelectItem key={r.id} value={String(r.id)}>
                                            {treeLabel(r)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-[11px] text-muted-foreground">GST / HSN set here is inherited by child groups and their products.</p>
                        </div>

                        {/* GST rate */}
                        <div className="space-y-2">
                            <Label>GST rate</Label>
                            <Select
                                value={form.gstRateId || NONE}
                                onValueChange={(v) => setForm((f) => ({ ...f, gstRateId: v === NONE ? "" : v }))}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="— inherit —" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={NONE}>— inherit —</SelectItem>
                                    {gstRates.filter((r) => r.isActive).map((r) => (
                                        <SelectItem key={r.id} value={String(r.id)}>
                                            {r.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* HSN code */}
                        <div className="space-y-2">
                            <Label>HSN / SAC code</Label>
                            <Input
                                value={form.hsnCode}
                                onChange={(e) => setForm((f) => ({ ...f, hsnCode: e.target.value }))}
                                placeholder="Leave empty to inherit"
                                maxLength={32}
                            />
                        </div>

                        {/* Taxability */}
                        <div className="space-y-2">
                            <Label>Taxability</Label>
                            <Select
                                value={form.taxability || NONE}
                                onValueChange={(v) => setForm((f) => ({ ...f, taxability: v === NONE ? "" : v }))}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="— inherit —" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={NONE}>— inherit —</SelectItem>
                                    {TAXABILITY_OPTIONS.map((o) => (
                                        <SelectItem key={o.value} value={o.value}>
                                            {o.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Movement bands */}
                        <div className="space-y-2 sm:col-span-2">
                            <Label>Movement bands (days since last sale)</Label>
                            <div className="grid grid-cols-3 gap-2">
                                {([
                                    ["slowAfterDays", "Slow after"],
                                    ["nonMovingAfterDays", "Non-moving after"],
                                    ["deadAfterDays", "Dead after"],
                                ] as const).map(([key, label]) => (
                                    <div key={key} className="space-y-1">
                                        <span className="text-[11px] text-muted-foreground">{label}</span>
                                        <Input
                                            inputMode="numeric"
                                            placeholder="inherit"
                                            value={form[key]}
                                            onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value.replace(/\D/g, "") }))}
                                        />
                                    </div>
                                ))}
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                                Drives the Reorder / Stock Health classes. Blank = inherit parent group → org default
                                (Settings → Org defaults). Set once on a root group — e.g. CCTV 60/150/270 — and the
                                whole tree follows.
                            </p>
                        </div>

                        {/* Active */}
                        <div className="sm:col-span-2">
                            <label className="flex items-center gap-2 text-sm">
                                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
                                Active
                            </label>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={cancel}>Cancel</Button>
                        <Button type="button" onClick={save} disabled={saving}>Save</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <div className="min-h-0 flex-1 overflow-auto border border-border [&_[data-slot=table-container]]:overflow-x-visible">
                <Table>
                    <TableHeader className="sticky top-0 z-20 bg-background [&_th]:bg-background [&_tr]:border-b [&_th]:shadow-[inset_0_-1px_0_var(--border)]">
                        <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>GST</TableHead>
                            <TableHead>HSN</TableHead>
                            <TableHead>Taxability</TableHead>
                            <TableHead title="Days since last sale: Slow / Non-moving / Dead. Click a cell to edit.">
                                Movement (S / N / D)
                            </TableHead>
                            <TableHead className="text-right"> </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell colSpan={6} className="text-muted-foreground">Loading…</TableCell>
                            </TableRow>
                        ) : visible.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} className="text-muted-foreground">No groups yet.</TableCell>
                            </TableRow>
                        ) : (
                            visible.map(({ row: r, depth, hasChildren }) => {
                              const bands = resolveBands(r);
                              return (
                                <TableRow key={r.id}>
                                    <TableCell className="font-medium" style={{ paddingLeft: `${12 + depth * 20}px` }}>
                                        <span className="flex items-center gap-1">
                                            {hasChildren ? (
                                                <button
                                                    type="button"
                                                    onClick={() => toggle(r.id)}
                                                    className="-ml-1 rounded p-0.5 hover:bg-muted"
                                                    aria-label={collapsed.has(r.id) ? "Expand" : "Collapse"}
                                                >
                                                    {collapsed.has(r.id) ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                                                </button>
                                            ) : depth > 0 ? (
                                                <span className="text-muted-foreground">└</span>
                                            ) : null}
                                            {r.name}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-sm">{r.gstRate ? r.gstRate.label : <span className="italic text-muted-foreground">inherit</span>}</TableCell>
                                    <TableCell className="font-mono text-sm">{r.hsnCode ?? <span className="italic text-muted-foreground">inherit</span>}</TableCell>
                                    <TableCell className="text-sm">{r.taxability ?? <span className="italic text-muted-foreground">inherit</span>}</TableCell>
                                    {/* Movement bands — click to edit inline (frequently tuned) */}
                                    <TableCell
                                        className={bandEditId === r.id ? "py-1" : "cursor-pointer"}
                                        title={bandEditId === r.id ? undefined : "Click to edit movement bands"}
                                        onClick={bandEditId === r.id ? undefined : () => startBandEdit(r)}
                                    >
                                        {bandEditId === r.id ? (
                                            <div className="flex items-center gap-1">
                                                {([
                                                    ["slow", "Slow", "slowAfterDays"],
                                                    ["nonMoving", "Non-moving", "nonMovingAfterDays"],
                                                    ["dead", "Dead", "deadAfterDays"],
                                                ] as const).map(([key, label, bandKey], i) => (
                                                    <Input
                                                        key={key}
                                                        autoFocus={i === 0}
                                                        inputMode="numeric"
                                                        // Placeholder = the value that would be inherited if left blank.
                                                        placeholder={bands[bandKey].value != null ? `↳${bands[bandKey].value}` : "inh"}
                                                        title={`${label} after (days) — blank inherits ${bands[bandKey].value ?? "—"}`}
                                                        className="h-7 w-14 px-1.5 text-xs"
                                                        value={bandForm[key]}
                                                        onChange={(e) => setBandForm((f) => ({ ...f, [key]: e.target.value.replace(/\D/g, "") }))}
                                                        onKeyDown={(e) => {
                                                            if (e.key === "Enter") saveBands();
                                                            if (e.key === "Escape") setBandEditId(null);
                                                        }}
                                                    />
                                                ))}
                                                <Button type="button" variant="outline" size="icon-sm" aria-label="Save bands" disabled={bandSaving} onClick={saveBands}>
                                                    <Check className="size-3.5" />
                                                </Button>
                                                <Button type="button" variant="outline" size="icon-sm" aria-label="Cancel" disabled={bandSaving} onClick={() => setBandEditId(null)}>
                                                    <X className="size-3.5" />
                                                </Button>
                                            </div>
                                        ) : (
                                            // Always show the effective numbers. Own values are solid;
                                            // inherited values are muted + italic.
                                            <span className="font-mono text-sm">
                                                {BAND_KEYS.map((key, i) => {
                                                    const b = bands[key];
                                                    return (
                                                        <span key={key}>
                                                            {i > 0 && <span className="text-muted-foreground"> / </span>}
                                                            <span className={b.own ? "text-foreground" : "italic text-muted-foreground"}>
                                                                {b.value ?? "–"}
                                                            </span>
                                                        </span>
                                                    );
                                                })}
                                            </span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-right space-x-2">
                                        {!r.isActive ? <Badge variant="outline">inactive</Badge> : null}
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="icon-sm"
                                            aria-label="Edit"
                                            onClick={() => {
                                                setAdding(false);
                                                setEditId(r.id);
                                                setForm({
                                                    name: r.name,
                                                    isActive: r.isActive,
                                                    parentId:   r.parentId  != null ? String(r.parentId)  : "",
                                                    gstRateId:  r.gstRateId != null ? String(r.gstRateId) : "",
                                                    hsnCode:    r.hsnCode  ?? "",
                                                    taxability: r.taxability ?? "",
                                                    slowAfterDays:      r.slowAfterDays      != null ? String(r.slowAfterDays)      : "",
                                                    nonMovingAfterDays: r.nonMovingAfterDays != null ? String(r.nonMovingAfterDays) : "",
                                                    deadAfterDays:      r.deadAfterDays      != null ? String(r.deadAfterDays)      : "",
                                                });
                                            }}
                                        >
                                            <Pencil className="size-4" />
                                        </Button>
                                        <Button type="button" variant="outline" size="icon-sm" aria-label="Delete" onClick={() => del(r.id)}>
                                            <Trash2 className="size-4" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                              );
                            })
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
