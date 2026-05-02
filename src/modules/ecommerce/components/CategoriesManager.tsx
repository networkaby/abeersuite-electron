"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Row = { name: string; productCount: number };

export default function CategoriesManager() {
    const [rows, setRows] = useState<Row[]>([]);

    useEffect(() => {
        axios
            .get<Row[]>("/api/ecommerce/categories")
            .then((r) => setRows(r.data))
            .catch(() => setRows([]));
    }, []);

    return (
        <Card>
            <CardHeader>
                <CardTitle>Categories</CardTitle>
                <CardDescription>Derived from active product rows — rename products to organise.</CardDescription>
            </CardHeader>
            <CardContent>
                <ul className="divide-y divide-border rounded-md border border-border">
                    {rows.map((c) => (
                        <li key={c.name} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                            <span className="font-medium">{c.name}</span>
                            <span className="text-muted-foreground">{c.productCount} products</span>
                            <Link
                                href={`/?category=${encodeURIComponent(c.name)}`}
                                className="text-primary text-xs underline-offset-4 hover:underline"
                                target="_blank"
                            >
                                View on storefront
                            </Link>
                        </li>
                    ))}
                </ul>
                {rows.length === 0 ? <p className="text-sm text-muted-foreground">No categories yet.</p> : null}
            </CardContent>
        </Card>
    );
}
