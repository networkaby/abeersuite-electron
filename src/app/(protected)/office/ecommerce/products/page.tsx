"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import Image from "next/image";
import Link from "next/link";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import type { ShopProductAdmin } from "@/modules/ecommerce/lib/product-admin";
import ProductForm from "@/modules/ecommerce/components/ProductForm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

export default function EcommerceProductsPage() {
    const [products, setProducts] = useState<ShopProductAdmin[]>([]);
    const [open, setOpen] = useState(false);

    const load = () => {
        axios
            .get<ShopProductAdmin[]>("/api/ecommerce/products")
            .then((r) => setProducts(r.data))
            .catch(() => setProducts([]));
    };

    useEffect(() => {
        load();
    }, []);

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
                    <p className="text-muted-foreground text-sm">Manage catalogue and inventory.</p>
                </div>
                <Dialog open={open} onOpenChange={setOpen}>
                    <DialogTrigger asChild>
                        <Button type="button">Add product</Button>
                    </DialogTrigger>
                    <DialogContent className="max-h-[90vh] w-full max-w-2xl overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle>New product</DialogTitle>
                        </DialogHeader>
                        <div className="mt-4">
                            <ProductForm
                                submitLabel="Create product"
                                onSaved={() => {
                                    setOpen(false);
                                    load();
                                }}
                            />
                        </div>
                    </DialogContent>
                </Dialog>
            </div>

            <div className="rounded-md border border-border overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-14"> </TableHead>
                            <TableHead>Name</TableHead>
                            <TableHead>Category</TableHead>
                            <TableHead className="text-right">Price</TableHead>
                            <TableHead>Stock</TableHead>
                            <TableHead> </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {products.map((p) => (
                            <TableRow key={p.id}>
                                <TableCell>
                                    <div className="relative size-11 overflow-hidden rounded-md bg-muted">
                                        {(p.galleryUrls[0] ?? p.imageUrl) ? (
                                            <Image
                                                src={p.galleryUrls[0] ?? p.imageUrl!}
                                                alt=""
                                                fill
                                                className="object-cover"
                                                sizes="44px"
                                                unoptimized
                                            />
                                        ) : null}
                                    </div>
                                </TableCell>
                                <TableCell className="font-medium">
                                    {p.name}
                                    {!p.isActive ? (
                                        <Badge variant="outline" className="ml-2">
                                            inactive
                                        </Badge>
                                    ) : null}
                                    {p.badge ? (
                                        <Badge variant="secondary" className="ml-2">
                                            {p.badge}
                                        </Badge>
                                    ) : null}
                                </TableCell>
                                <TableCell className="text-muted-foreground text-sm">{p.category}</TableCell>
                                <TableCell className="text-right">{formatRupeesFromPaise(p.pricePaise)}</TableCell>
                                <TableCell className="text-sm">
                                    {p.stock === null ? "—" : p.stock}
                                </TableCell>
                                <TableCell>
                                    <Button variant="outline" size="sm" asChild>
                                        <Link href={`/office/ecommerce/products/${p.id}`}>Edit</Link>
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
                {products.length === 0 ? (
                    <p className="text-muted-foreground p-6 text-center text-sm">No products.</p>
                ) : null}
            </div>
        </div>
    );
}
