"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, ImageIcon, Pencil, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { TableEmptyRow, TableLoadingRow } from "@/shared/components/DataTableStates";
import { useCollapsibleTree } from "@/modules/inventory/hooks";
import ShopImageField from "@/modules/ecommerce/components/ShopImageField";

export type ShopMasterRow = {
    id: number;
    name: string;
    isActive: boolean;
    slug: string | null;
    imageUrl: string | null;
    description: string | null;
    /** null on a flat master (Brand); present on hierarchical ones (Group, Category). */
    parentId: number | null;
};

/**
 * Editor for the SHOP-PRESENTATION fields only (slug, image, description) of one
 * taxonomy master — Group, Category, or Brand. Deliberately narrow: name,
 * hierarchy (parent), GST/HSN and movement bands stay owned by the inventory
 * master pages (`/office/inventory/masters/*`) — this list is read-only on all
 * of that, editable only on the fields the ecommerce module owns. One
 * component, three call sites (see MastersPage), so Group/Category/Brand share
 * identical editing behaviour instead of three near-duplicate pages.
 */
export default function ShopMasterPresentationList({
    apiBase,
    resourceLabel,
    imageFolder,
    hierarchical,
}: {
    /** e.g. "/api/inventory/product-groups" — GET (list) + PATCH `${apiBase}/${id}` reused as-is. */
    apiBase: string;
    resourceLabel: string;
    imageFolder: string;
    hierarchical: boolean;
}) {
    const [rows, setRows] = useState<ShopMasterRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [editId, setEditId] = useState<number | null>(null);
    const [form, setForm] = useState({ slug: "", imageUrl: null as string | null, description: "" });
    const [saving, setSaving] = useState(false);
    const [search, setSearch] = useState("");

    const load = () => {
        setLoading(true);
        axios
            .get<ShopMasterRow[]>(apiBase)
            .then((r) => setRows(r.data.map((x) => ({ ...x, parentId: hierarchical ? x.parentId : null }))))
            .catch(() => toast.error(`Failed to load ${resourceLabel.toLowerCase()}s`))
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- apiBase/hierarchical are fixed per tab, not reactive
    }, [apiBase]);

    const normalizedSearch = search.trim().toLowerCase();
    const searchedRows = normalizedSearch
        ? rows.filter((r) => r.name.toLowerCase().includes(normalizedSearch))
        : rows;

    const { visible, collapsed, toggle, expandAll, collapseAll, hasTree } = useCollapsibleTree(searchedRows);

    const openEdit = (r: ShopMasterRow) => {
        setEditId(r.id);
        setForm({ slug: r.slug ?? "", imageUrl: r.imageUrl, description: r.description ?? "" });
    };

    const save = async () => {
        if (editId == null) return;
        setSaving(true);
        try {
            await axios.patch(`${apiBase}/${editId}`, {
                slug: form.slug.trim() || null,
                imageUrl: form.imageUrl,
                description: form.description.trim() || null,
            });
            toast.success(`${resourceLabel} updated`);
            setEditId(null);
            load();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error : "Save failed");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex h-full flex-col gap-4 overflow-hidden">
            <div className="flex flex-none flex-col gap-2">

                <div className="flex items-center gap-2">
                    <div className="relative">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={`Search ${resourceLabel.toLowerCase()}s…`}
                            className="w-56 pl-8"
                        />
                    </div>
                    {hasTree ? (
                        <>
                            <Button type="button" variant="outline" size="sm" onClick={expandAll}>Expand all</Button>
                            <Button type="button" variant="outline" size="sm" onClick={collapseAll}>Collapse all</Button>
                        </>
                    ) : null}
                    <p className="text-sm text-muted-foreground">
                        {/* Storefront presentation for */}
                        {resourceLabel.toLowerCase()}s — slug, image and description. Name
                        {hierarchical ? ", hierarchy" : ""} and other master data stay on the{" "}
                        <span className="font-medium text-foreground">Inventory → Masters</span> page.
                    </p>
                </div>

            </div>

            <Dialog open={editId != null} onOpenChange={(o) => { if (!o) setEditId(null); }}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Edit {resourceLabel.toLowerCase()} — storefront presentation</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>Slug</Label>
                            <Input
                                value={form.slug}
                                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                                placeholder="url-segment"
                            />
                        </div>
                        <ShopImageField
                            label="Image"
                            value={form.imageUrl}
                            onChange={(url) => setForm((f) => ({ ...f, imageUrl: url }))}
                            folder={imageFolder}
                        />
                        <div className="space-y-2">
                            <Label>Description</Label>
                            <Textarea
                                rows={4}
                                value={form.description}
                                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                                placeholder={`Shown on the ${resourceLabel.toLowerCase()}'s storefront page.`}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setEditId(null)}>Cancel</Button>
                        <Button type="button" onClick={save} disabled={saving}>Save</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <div className="min-h-0 flex-1 overflow-auto border border-border **:data-[slot=table-container]:overflow-x-visible">
                <Table>
                    <TableHeader className="sticky top-0 z-20 bg-background [&_th]:bg-background [&_tr]:border-b [&_th]:shadow-[inset_0_-1px_0_var(--border)]">
                        <TableRow>
                            <TableHead className="w-10"> </TableHead>
                            <TableHead>Name</TableHead>
                            <TableHead>Slug</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead className="text-right"> </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableLoadingRow colSpan={5} />
                        ) : visible.length === 0 ? (
                            <TableEmptyRow
                                colSpan={5}
                                message={normalizedSearch ? `No ${resourceLabel.toLowerCase()}s match "${search.trim()}".` : `No ${resourceLabel.toLowerCase()}s yet.`}
                            />
                        ) : (
                            visible.map(({ row: r, depth, hasChildren }) => (
                                <TableRow key={r.id}>
                                    <TableCell>
                                        <div className="flex size-9 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
                                            {r.imageUrl ? (
                                                // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote URL
                                                <img src={r.imageUrl} alt="" className="size-full object-cover" />
                                            ) : (
                                                <ImageIcon className="size-4 text-muted-foreground" />
                                            )}
                                        </div>
                                    </TableCell>
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
                                            {!r.isActive ? <Badge variant="outline">inactive</Badge> : null}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground">{r.slug ?? "—"}</TableCell>
                                    <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                                        {r.description ?? "—"}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button type="button" variant="outline" size="icon-sm" aria-label="Edit" onClick={() => openEdit(r)}>
                                            <Pencil className="size-4" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
