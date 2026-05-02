"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatRupeesFromPaise } from "@/lib/money-inr";

type Product = {
    id: number;
    name: string;
    description: string | null;
    pricePaise: number;
    imageUrl: string | null;
    isActive: boolean;
};

export default function EcommerceProductsAdminPage() {
    const [products, setProducts] = useState<Product[]>([]);
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [priceRupees, setPriceRupees] = useState(""); // user types rupees e.g. 199.50
    const [error, setError] = useState("");

    const load = () => {
        axios
            .get<Product[]>("/api/ecommerce/products")
            .then((r) => setProducts(r.data))
            .catch(() => setProducts([]));
    };

    useEffect(() => {
        load();
    }, []);

    const create = async () => {
        setError("");
        const rupees = parseFloat(priceRupees);
        if (!name.trim() || !Number.isFinite(rupees) || rupees <= 0) {
            setError("Enter name and a valid price in ₹");
            return;
        }
        const pricePaise = Math.round(rupees * 100);
        try {
            await axios.post("/api/ecommerce/products", {
                name: name.trim(),
                description: description.trim() || null,
                pricePaise,
            });
            setName("");
            setDescription("");
            setPriceRupees("");
            load();
        } catch (e: unknown) {
            const msg =
                axios.isAxiosError(e) && e.response?.data && typeof e.response.data === "object"
                    ? (e.response.data as { error?: string }).error
                    : null;
            setError(msg || "Create failed");
        }
    };

    return (
        <div className="space-y-8 max-w-2xl">
            <h1 className="text-2xl font-semibold">Shop products</h1>

            <div className="rounded-lg border border-border p-4 space-y-3">
                <h2 className="font-medium">Add product</h2>
                <div className="space-y-2">
                    <Label>Name</Label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-2">
                    <Label>Description</Label>
                    <Input value={description} onChange={(e) => setDescription(e.target.value)} />
                </div>
                <div className="space-y-2">
                    <Label>Price (₹)</Label>
                    <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="e.g. 199.50"
                        value={priceRupees}
                        onChange={(e) => setPriceRupees(e.target.value)}
                    />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="button" onClick={() => void create()}>
                    Create
                </Button>
            </div>

            <ul className="space-y-2">
                {products.map((p) => (
                    <li key={p.id} className="flex justify-between gap-2 border border-border rounded-lg p-3 text-sm">
                        <span>
                            <span className="font-medium">{p.name}</span>
                            {p.isActive ? null : (
                                <span className="ml-2 text-muted-foreground">(inactive)</span>
                            )}
                        </span>
                        <span>{formatRupeesFromPaise(p.pricePaise)}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
