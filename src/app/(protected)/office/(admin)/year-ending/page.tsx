"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Pencil, RotateCcw, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

interface SeriesRow {
    kind: string;
    label: string;
    prefix: string;
    suffix: string;
    startFrom: number;
    padWidth: number;
    nextSeq: number;
    updatedAt: string;
}

interface EditForm {
    prefix: string;
    suffix: string;
    startFrom: number;
    padWidth: number;
}

function previewRef(prefix: string, suffix: string, startFrom: number, padWidth: number, nextSeq: number): string {
    const num = startFrom + nextSeq;
    return `${prefix}${String(num).padStart(padWidth, "0")}${suffix}`;
}

export default function YearEndingPage() {
    const [series, setSeries] = useState<SeriesRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [editId, setEditId] = useState<string | null>(null);
    const [form, setForm] = useState<EditForm>({ prefix: "", suffix: "", startFrom: 1, padWidth: 4 });
    const [saving, setSaving] = useState(false);
    const [resetKind, setResetKind] = useState<string | null>(null);
    const [resetting, setResetting] = useState(false);

    useEffect(() => {
        axios
            .get<SeriesRow[]>("/api/finance/voucher-series")
            .then((r) => setSeries(r.data))
            .catch(() => toast.error("Failed to load voucher series"))
            .finally(() => setLoading(false));
    }, []);

    function startEdit(row: SeriesRow) {
        setEditId(row.kind);
        setForm({ prefix: row.prefix, suffix: row.suffix, startFrom: row.startFrom, padWidth: row.padWidth });
    }

    function cancelEdit() {
        setEditId(null);
    }

    async function handleSave(kind: string) {
        setSaving(true);
        try {
            const { data } = await axios.patch<SeriesRow>(`/api/finance/voucher-series/${kind}`, {
                prefix: form.prefix,
                suffix: form.suffix,
                startFrom: form.startFrom,
                padWidth: form.padWidth,
            });
            setSeries((prev) => prev.map((r) => (r.kind === kind ? data : r)));
            setEditId(null);
            toast.success("Voucher series updated");
        } catch (err) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : null;
            toast.error(msg ?? "Failed to save");
        } finally {
            setSaving(false);
        }
    }

    async function handleReset(kind: string) {
        setResetting(true);
        try {
            const { data } = await axios.post<SeriesRow>(`/api/finance/voucher-series/${kind}/reset`);
            setSeries((prev) => prev.map((r) => (r.kind === kind ? data : r)));
            setResetKind(null);
            toast.success("Counter reset to 0");
        } catch (err) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : null;
            toast.error(msg ?? "Failed to reset");
        } finally {
            setResetting(false);
        }
    }

    const resetRow = series.find((r) => r.kind === resetKind);

    return (
        <div className="space-y-6 p-6">
            <div>
                <h1 className="text-xl font-semibold">Year Ending — Voucher Numbering</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Configure how reference numbers are generated per voucher type. At year-end, update the
                    prefix or suffix and reset the counter to restart numbering.
                </p>
            </div>

            <div className="rounded border border-yellow-200 bg-yellow-50 px-4 py-3 text-xs text-yellow-900">
                <span className="font-medium">Formula:</span>{" "}
                <code className="rounded bg-yellow-100 px-1">prefix + padded-number + suffix</code>
                {"  "}— e.g. prefix <code className="rounded bg-yellow-100 px-1">PV-2026-</code> start&nbsp;1
                pad&nbsp;4 → <code className="rounded bg-yellow-100 px-1">PV-2026-0001</code>. Tally-style:
                prefix <code className="rounded bg-yellow-100 px-1">TI/</code> suffix{" "}
                <code className="rounded bg-yellow-100 px-1">/25-26</code> →{" "}
                <code className="rounded bg-yellow-100 px-1">TI/0001/25-26</code>
            </div>

            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Voucher Type</TableHead>
                            <TableHead>Prefix</TableHead>
                            <TableHead>Suffix</TableHead>
                            <TableHead className="text-right">Start&nbsp;#</TableHead>
                            <TableHead className="text-right">Width</TableHead>
                            <TableHead className="text-right">Issued</TableHead>
                            <TableHead>Next Number Preview</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {series.map((row) =>
                            editId === row.kind ? (
                                <TableRow key={row.kind} className="bg-muted/40">
                                    <TableCell>
                                        <div className="font-medium">{row.label}</div>
                                        <code className="text-xs text-muted-foreground">{row.kind}</code>
                                    </TableCell>
                                    <TableCell>
                                        <Input
                                            value={form.prefix}
                                            onChange={(e) => setForm((f) => ({ ...f, prefix: e.target.value }))}
                                            className="h-8 w-32 font-mono text-xs"
                                            placeholder="PV-2026-"
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <Input
                                            value={form.suffix}
                                            onChange={(e) => setForm((f) => ({ ...f, suffix: e.target.value }))}
                                            className="h-8 w-24 font-mono text-xs"
                                            placeholder="/25-26"
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <Input
                                            type="number"
                                            min={1}
                                            value={form.startFrom}
                                            onChange={(e) =>
                                                setForm((f) => ({ ...f, startFrom: Number(e.target.value) }))
                                            }
                                            className="h-8 w-20 text-right text-xs"
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <Input
                                            type="number"
                                            min={1}
                                            max={10}
                                            value={form.padWidth}
                                            onChange={(e) =>
                                                setForm((f) => ({ ...f, padWidth: Number(e.target.value) }))
                                            }
                                            className="h-8 w-16 text-right text-xs"
                                        />
                                    </TableCell>
                                    <TableCell className="text-right text-xs text-muted-foreground">
                                        {row.nextSeq}
                                    </TableCell>
                                    <TableCell>
                                        <code className="rounded bg-muted px-1 py-0.5 text-xs">
                                            {previewRef(form.prefix, form.suffix, form.startFrom, form.padWidth, row.nextSeq)}
                                        </code>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex items-center justify-end gap-1">
                                            <Button
                                                size="sm"
                                                onClick={() => handleSave(row.kind)}
                                                disabled={saving}
                                            >
                                                <Check className="size-3.5" />
                                            </Button>
                                            <Button size="sm" variant="outline" onClick={cancelEdit} disabled={saving}>
                                                <X className="size-3.5" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                <TableRow key={row.kind}>
                                    <TableCell>
                                        <div className="font-medium">{row.label}</div>
                                        <code className="text-xs text-muted-foreground">{row.kind}</code>
                                    </TableCell>
                                    <TableCell>
                                        <code className="font-mono text-xs">{row.prefix || <span className="text-muted-foreground italic">—</span>}</code>
                                    </TableCell>
                                    <TableCell>
                                        <code className="font-mono text-xs">{row.suffix || <span className="text-muted-foreground italic">—</span>}</code>
                                    </TableCell>
                                    <TableCell className="text-right text-sm">{row.startFrom}</TableCell>
                                    <TableCell className="text-right text-sm">{row.padWidth}</TableCell>
                                    <TableCell className="text-right">
                                        <Badge variant="secondary">{row.nextSeq} issued</Badge>
                                    </TableCell>
                                    <TableCell>
                                        <code className="rounded bg-muted px-1 py-0.5 text-xs">
                                            {previewRef(row.prefix, row.suffix, row.startFrom, row.padWidth, row.nextSeq)}
                                        </code>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex items-center justify-end gap-1">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => startEdit(row)}
                                                title="Edit"
                                            >
                                                <Pencil className="size-3.5" />
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => setResetKind(row.kind)}
                                                title="Reset counter"
                                            >
                                                <RotateCcw className="size-3.5" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ),
                        )}
                    </TableBody>
                </Table>
            )}

            {/* Reset confirmation dialog */}
            <Dialog open={!!resetKind} onOpenChange={(open) => !open && setResetKind(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Reset Counter — {resetRow?.label}</DialogTitle>
                        <DialogDescription>
                            This will set <strong>nextSeq to 0</strong>. The next voucher created will be:
                            <br />
                            <code className="mt-1 inline-block rounded bg-muted px-2 py-1 text-sm font-mono">
                                {resetRow
                                    ? previewRef(resetRow.prefix, resetRow.suffix, resetRow.startFrom, resetRow.padWidth, 0)
                                    : ""}
                            </code>
                            <br />
                            <br />
                            Use this at <strong>year-end</strong> after updating the prefix/suffix. This cannot
                            be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setResetKind(null)} disabled={resetting}>
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => resetKind && handleReset(resetKind)}
                            disabled={resetting}
                        >
                            {resetting ? "Resetting…" : "Reset Counter"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
