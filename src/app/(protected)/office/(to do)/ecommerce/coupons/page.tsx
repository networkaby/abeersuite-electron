"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

type Coupon = {
    id: string;
    code: string;
    percentOff: number | null;
    flatPaise: number | null;
    isActive: boolean;
    expiresAt: string | null;
};

export default function EcommerceCouponsPage() {
    const [rows, setRows] = useState<Coupon[]>([]);
    const [code, setCode] = useState("");
    const [percentOff, setPercentOff] = useState("");
    const [flatRupees, setFlatRupees] = useState("");
    const [expiresAt, setExpiresAt] = useState("");

    const load = () => {
        axios
            .get<Coupon[]>("/api/ecommerce/coupons")
            .then((r) => setRows(r.data))
            .catch(() => setRows([]));
    };

    useEffect(() => {
        load();
    }, []);

    const create = async () => {
        const pct = percentOff.trim() ? parseInt(percentOff, 10) : null;
        const flat =
            flatRupees.trim() ? Math.round(parseFloat(flatRupees) * 100) : null;
        if (!code.trim()) {
            toast.error("Code required");
            return;
        }
        if ((pct === null || Number.isNaN(pct)) && (flat === null || Number.isNaN(flat))) {
            toast.error("Set percent or flat discount");
            return;
        }
        try {
            await axios.post("/api/ecommerce/coupons", {
                code: code.trim(),
                percentOff: pct && !Number.isNaN(pct) ? pct : null,
                flatPaise: flat && !Number.isNaN(flat) ? flat : null,
                expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
            });
            toast.success("Coupon created");
            setCode("");
            setPercentOff("");
            setFlatRupees("");
            setExpiresAt("");
            load();
        } catch (e: unknown) {
            const msg =
                axios.isAxiosError(e) && e.response?.data && typeof e.response.data === "object"
                    ? (e.response.data as { error?: string }).error
                    : "Failed";
            toast.error(msg ?? "Failed");
        }
    };

    const toggleActive = async (c: Coupon, on: boolean) => {
        try {
            await axios.patch(`/api/ecommerce/coupons/${c.id}`, { isActive: on });
            load();
        } catch {
            toast.error("Update failed");
        }
    };

    const remove = async (c: Coupon) => {
        if (!confirm(`Delete coupon ${c.code}?`)) return;
        try {
            await axios.delete(`/api/ecommerce/coupons/${c.id}`);
            toast.success("Deleted");
            load();
        } catch {
            toast.error("Delete failed (may be in use)");
        }
    };

    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">Coupons</h1>
                <p className="text-muted-foreground text-sm">Promotional codes for checkout (future wiring).</p>
            </div>

            <div className="rounded-lg border border-border p-4 space-y-4 max-w-xl">
                <div className="grid gap-2">
                    <Label>Code</Label>
                    <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="SAVE10" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-2">
                        <Label>% off</Label>
                        <Input value={percentOff} onChange={(e) => setPercentOff(e.target.value)} placeholder="10" />
                    </div>
                    <div className="grid gap-2">
                        <Label>Flat ₹ off</Label>
                        <Input value={flatRupees} onChange={(e) => setFlatRupees(e.target.value)} placeholder="50" />
                    </div>
                </div>
                <div className="grid gap-2">
                    <Label>Expires (optional)</Label>
                    <Input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
                </div>
                <Button type="button" onClick={() => void create()}>
                    Add coupon
                </Button>
            </div>

            <div className="rounded-md border border-border overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Code</TableHead>
                            <TableHead>Discount</TableHead>
                            <TableHead>Expires</TableHead>
                            <TableHead>Active</TableHead>
                            <TableHead />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.map((c) => (
                            <TableRow key={c.id}>
                                <TableCell className="font-mono font-medium">{c.code}</TableCell>
                                <TableCell>
                                    {c.percentOff != null
                                        ? `${c.percentOff}%`
                                        : c.flatPaise != null
                                          ? formatRupeesFromPaise(c.flatPaise)
                                          : "—"}
                                </TableCell>
                                <TableCell className="text-muted-foreground text-xs">
                                    {c.expiresAt ? new Date(c.expiresAt).toLocaleString("en-IN") : "—"}
                                </TableCell>
                                <TableCell>
                                    <Switch checked={c.isActive} onCheckedChange={(on) => void toggleActive(c, on)} />
                                </TableCell>
                                <TableCell>
                                    <Button type="button" variant="ghost" size="sm" onClick={() => void remove(c)}>
                                        Delete
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
                {rows.length === 0 ? (
                    <p className="text-muted-foreground p-6 text-center text-sm">No coupons.</p>
                ) : null}
            </div>
        </div>
    );
}
