"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Box } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { InvProductDialog } from "@/modules/inventory/components/InvProductDialog";

type ProductRow = {
    id: number;
    sku: string;
    name: string;
    isActive: boolean;
    stock: number | null;
    lowStockThreshold: number;
    unit: { code: string; label: string };
    category: { name: string } | null;
    brand: { name: string } | null;
};

export default function InventoryProductsPage() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const editParam = searchParams.get("edit");

    const [rows, setRows] = useState<ProductRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState(false);
    const [editId, setEditId] = useState<number | null>(null);

    const loadProducts = useCallback(() => {
        return axios
            .get<ProductRow[]>("/api/inventory/products")
            .then((r) => setRows(r.data))
            .catch(() => toast.error("Failed to load products"));
    }, []);

    useEffect(() => {
        loadProducts().finally(() => setLoading(false));
    }, [loadProducts]);

    const openNew = () => {
        setEditId(null);
        setOpen(true);
    };

    const openEdit = useCallback((id: number) => {
        setEditId(id);
        setOpen(true);
    }, []);

    // Deep-link: /office/inventory/products?edit=<id> auto-opens the edit
    // dialog. Strip the param afterwards so a refresh / close doesn't
    // re-trigger.
    const handledEditRef = useRef<number | null>(null);
    useEffect(() => {
        if (!editParam) return;
        const id = Number(editParam);
        if (!Number.isFinite(id)) return;
        if (handledEditRef.current === id) return;
        handledEditRef.current = id;
        openEdit(id);
        const next = new URLSearchParams(searchParams.toString());
        next.delete("edit");
        const qs = next.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname);
    }, [editParam, openEdit, pathname, router, searchParams]);

    const del = async (id: number) => {
        if (!confirm("Delete this product master?")) return;
        try {
            await axios.delete(`/api/inventory/products/${id}`);
            toast.success("Deleted");
            loadProducts();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error : "Delete failed");
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
                        <Box className="size-5" aria-hidden />
                        Products
                    </h2>
                    <p className="text-muted-foreground text-sm">SKU master — stock updated automatically via Purchase/Sale vouchers.</p>
                </div>
                <Button type="button" onClick={openNew}>
                    <Plus className="size-4" />
                    New product
                </Button>
            </div>

            <InvProductDialog
                open={open}
                onOpenChange={setOpen}
                editId={editId}
                onSaved={loadProducts}
            />

            <div className="overflow-x-auto border border-border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>SKU</TableHead>
                            <TableHead>Name</TableHead>
                            <TableHead>Unit</TableHead>
                            <TableHead>Category</TableHead>
                            <TableHead>Brand</TableHead>
                            <TableHead className="text-right">Stock</TableHead>
                            <TableHead className="text-right"> </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell colSpan={7} className="text-muted-foreground">
                                    Loading…
                                </TableCell>
                            </TableRow>
                        ) : rows.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={7} className="text-muted-foreground">
                                    No products yet. Create a unit first, then add a product.
                                </TableCell>
                            </TableRow>
                        ) : (
                            rows.map((p) => {
                                const isLow = p.stock != null && p.stock <= p.lowStockThreshold;
                                return (
                                <TableRow key={p.id}>
                                    <TableCell className="font-mono text-sm">{p.sku}</TableCell>
                                    <TableCell className="font-medium">{p.name}</TableCell>
                                    <TableCell className="text-muted-foreground text-sm">
                                        {p.unit.code}
                                    </TableCell>
                                    <TableCell className="text-sm">{p.category?.name ?? "—"}</TableCell>
                                    <TableCell className="text-sm">{p.brand?.name ?? "—"}</TableCell>
                                    <TableCell className="text-right">
                                        {p.stock == null ? (
                                            <span className="text-muted-foreground text-xs">—</span>
                                        ) : (
                                            <span className={`font-mono text-sm font-semibold ${isLow ? "text-destructive" : ""}`}>
                                                {p.stock}
                                                {isLow && <Badge variant="destructive" className="ml-1.5 text-xs py-0 px-1">Low</Badge>}
                                            </span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-right space-x-2">
                                        {!p.isActive ? <Badge variant="outline">inactive</Badge> : null}
                                        <Button type="button" variant="outline" size="icon-sm" aria-label="Edit" onClick={() => openEdit(p.id)}>
                                            <Pencil className="size-4" />
                                        </Button>
                                        <Button type="button" variant="outline" size="icon-sm" aria-label="Delete" onClick={() => del(p.id)}>
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
