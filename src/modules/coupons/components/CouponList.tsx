"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, Ticket, Share2, Printer, Image as ImageIcon, Download, MessageCircle, Mail, Copy, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { CouponForm, type Coupon, type RuleMasters } from "./CouponForm";
import {
    couponHeadline, couponValueText, couponWhatsappUrl, couponWhatsappWebUrl, couponEmailUrl, type CouponShareInfo,
} from "@/modules/coupons/lib/couponShare";

const channelTone: Record<Coupon["channels"], string> = {
    BOTH: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
    POS:  "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
    SHOP: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
};
const channelLabel: Record<Coupon["channels"], string> = { BOTH: "POS+Shop", POS: "POS", SHOP: "Shop" };

type StatusFilter = "ALL" | "ACTIVE" | "INACTIVE" | "AUTO";
const TYPE_FILTERS = [
    { value: "ALL", label: "All types" }, { value: "PERCENT", label: "% off" }, { value: "FLAT", label: "Flat ₹" },
    { value: "FREE_ITEM", label: "Free item" }, { value: "BOGO", label: "Buy X get Y" }, { value: "SET_PRICE", label: "Set price" },
] as const;
const CHAN_FILTERS = [
    { value: "ALL", label: "All channels" }, { value: "BOTH", label: "POS + Shop" }, { value: "POS", label: "POS" }, { value: "SHOP", label: "Shop" },
] as const;
const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
    { value: "ALL", label: "All" }, { value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive" }, { value: "AUTO", label: "Auto-apply" },
];

export function CouponList({ masters, brandName }: { masters: RuleMasters; brandName: string }) {
    const [coupons, setCoupons] = useState<Coupon[]>([]);
    const [loading, setLoading] = useState(true);
    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState<Coupon | null>(null);
    const [search, setSearch] = useState("");
    const [typeFilter, setTypeFilter] = useState<string>("ALL");
    const [chanFilter, setChanFilter] = useState<string>("ALL");
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");

    function load() {
        axios.get<Coupon[]>("/api/coupons")
            .then((r) => setCoupons(r.data))
            .catch(() => toast.error("Failed to load coupons"))
            .finally(() => setLoading(false));
    }
    useEffect(load, []);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return coupons.filter((c) => {
            if (typeFilter !== "ALL" && c.type !== typeFilter) return false;
            if (chanFilter !== "ALL" && c.channels !== chanFilter) return false;
            if (statusFilter === "ACTIVE" && !c.isActive) return false;
            if (statusFilter === "INACTIVE" && c.isActive) return false;
            if (statusFilter === "AUTO" && c.applyMode !== "AUTO") return false;
            if (q && !(c.code?.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))) return false;
            return true;
        });
    }, [coupons, search, typeFilter, chanFilter, statusFilter]);

    async function patch(id: number, body: Partial<Coupon>) {
        try { await axios.patch(`/api/coupons/${id}`, body); load(); }
        catch { toast.error("Failed to update coupon"); }
    }
    async function remove(c: Coupon) {
        if (!confirm(`Delete coupon ${c.code ?? c.name}?`)) return;
        try {
            const r = await axios.delete<{ softDisabled?: boolean }>(`/api/coupons/${c.id}`);
            toast.success(r.data.softDisabled ? "Coupon disabled (it has redemptions)" : "Coupon deleted");
            load();
        } catch { toast.error("Failed to delete coupon"); }
    }
    function openAdd() { setEditing(null); setFormOpen(true); }
    function openEdit(c: Coupon) { setEditing(c); setFormOpen(true); }

    // ── Sharing (code coupons only) — mirrors the gift-card share flow ──
    function shareInfo(c: Coupon): CouponShareInfo {
        return { brandName, code: c.code ?? "", name: c.name, value: couponValueText(c), minBill: c.minBillValue != null ? Number(c.minBillValue) : null, validUntil: c.endsAt };
    }
    function printCoupon(c: Coupon) { window.open(`/receipt/coupon/${c.id}`, "_blank", "noopener"); }
    async function copyCode(c: Coupon) {
        try { await navigator.clipboard.writeText(c.code ?? ""); toast.success("Code copied"); } catch { toast.error("Couldn't copy"); }
    }
    async function fetchCouponImage(c: Coupon): Promise<File> {
        const res = await fetch(`/api/coupons/${c.id}/image`);
        if (!res.ok) throw new Error("image");
        return new File([await res.blob()], `coupon-${c.code}.png`, { type: "image/png" });
    }
    async function shareCouponImage(c: Coupon) {
        const text = `${brandName} coupon — ${c.name}`;
        try {
            const file = await fetchCouponImage(c);
            const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
            if (nav.canShare && nav.canShare({ files: [file] })) { await navigator.share({ files: [file], text, title: text }); return; }
            const url = URL.createObjectURL(file);
            const a = document.createElement("a"); a.href = url; a.download = file.name; a.click(); URL.revokeObjectURL(url);
            toast.info("Image downloaded — attach it to your message.");
            window.open(couponWhatsappUrl(shareInfo(c)), "_blank", "noopener");
        } catch (e) { if (e instanceof DOMException && e.name === "AbortError") return; toast.error("Couldn't share the image"); }
    }
    async function shareWhatsappWebImage(c: Coupon) {
        const blobPromise = fetch(`/api/coupons/${c.id}/image`).then((r) => { if (!r.ok) throw new Error("image"); return r.blob(); });
        let copied = false;
        try {
            if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
                await navigator.clipboard.write([new ClipboardItem({ "image/png": blobPromise })]); copied = true;
            }
        } catch { /* fall back */ }
        if (!copied) {
            try { const blob = await blobPromise; const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `coupon-${c.code}.png`; a.click(); URL.revokeObjectURL(url); }
            catch { toast.error("Couldn't generate the image"); return; }
        }
        window.open(couponWhatsappWebUrl(shareInfo(c)), "_blank", "noopener");
        toast.info(copied ? "Image copied — press Ctrl+V in the WhatsApp chat to attach it. The text is prefilled." : "Image downloaded — drag it into the WhatsApp chat. The text is prefilled.");
    }
    async function downloadImage(c: Coupon) {
        try { const file = await fetchCouponImage(c); const url = URL.createObjectURL(file); const a = document.createElement("a"); a.href = url; a.download = file.name; a.click(); URL.revokeObjectURL(url); }
        catch { toast.error("Couldn't generate the image"); }
    }

    return (
        <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                <div className="space-y-1.5">
                    <CardTitle className="flex items-center gap-2 text-base">
                        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400"><Ticket size={15} /></span>
                        Coupons
                        <span className="text-xs font-normal text-muted-foreground">({filtered.length})</span>
                    </CardTitle>
                    <CardDescription>
                        Promotions for POS &amp; the online shop. Non-stackable coupons replace the spend-tier discount and block loyalty redemption.
                    </CardDescription>
                </div>
                <Button size="sm" variant="outline" className="shrink-0" onClick={openAdd}>
                    <Plus size={14} className="mr-1" /> Add coupon
                </Button>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Expandable add / edit card (no dialog) */}
                {formOpen && (
                    <CouponForm
                        initial={editing ?? undefined}
                        masters={masters}
                        onSaved={() => { setFormOpen(false); load(); }}
                        onCancel={() => setFormOpen(false)}
                    />
                )}

                {/* Search + filters */}
                <div className="flex flex-wrap items-center gap-2">
                    <div className="relative min-w-[200px] flex-1">
                        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search code or name…" className="h-9 pl-8" />
                    </div>
                    <Select value={typeFilter} onValueChange={setTypeFilter}>
                        <SelectTrigger className="h-9 w-[130px]"><SelectValue /></SelectTrigger>
                        <SelectContent>{TYPE_FILTERS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
                    </Select>
                    <Select value={chanFilter} onValueChange={setChanFilter}>
                        <SelectTrigger className="h-9 w-[140px]"><SelectValue /></SelectTrigger>
                        <SelectContent>{CHAN_FILTERS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
                    </Select>
                    <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                        <SelectTrigger className="h-9 w-[120px]"><SelectValue /></SelectTrigger>
                        <SelectContent>{STATUS_FILTERS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
                    </Select>
                </div>

                {loading ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                ) : coupons.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border/70 py-10 text-center text-sm text-muted-foreground">
                        No coupons yet — add one to run a promotion.
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border/70 py-10 text-center text-sm text-muted-foreground">
                        No coupons match your search/filter.
                    </div>
                ) : (
                    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {filtered.map((c) => (
                            <li key={c.id} className={`overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm transition ${c.isActive ? "" : "opacity-60"}`}>
                                {/* Ticket face */}
                                <div className="relative bg-gradient-to-br from-rose-600 via-rose-700 to-rose-800 p-3 text-white">
                                    <div className="absolute -right-7 -top-7 h-20 w-20 rounded-full bg-white/10" />
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="text-xl font-extrabold leading-tight">{couponHeadline(c)}</div>
                                        {c.code
                                            ? <span className="shrink-0 rounded bg-white/20 px-1.5 py-0.5 font-mono text-[11px] font-semibold backdrop-blur">{c.code}</span>
                                            : <span className="shrink-0 rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-semibold backdrop-blur">AUTO</span>}
                                    </div>
                                    <div className="mt-1 truncate text-xs opacity-90">{c.name}</div>
                                </div>

                                {/* Meta + actions */}
                                <div className="space-y-2 p-3">
                                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                                        <Badge className={`${channelTone[c.channels]} border-0`}>{channelLabel[c.channels]}</Badge>
                                        {c.independent && (
                                            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">free on top</span>
                                        )}
                                        {c.stackable && <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">stackable</span>}
                                        {!c.stackable && c.stackScope === "LINE" && <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">exclusive · its items only</span>}
                                        {c.singleUse && <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">single-use</span>}
                                        {c.eligibility !== "ANY" && <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">{c.eligibility.toLowerCase()}</span>}
                                    </div>
                                    <div className="min-h-[15px] text-[11px] text-muted-foreground">
                                        {c.minBillValue != null && Number(c.minBillValue) > 0 ? `Min ₹${Number(c.minBillValue).toLocaleString("en-IN")}` : "No min bill"}
                                        {c.endsAt ? ` · ends ${c.endsAt.slice(0, 10)}` : ""}
                                        {c._count && c._count.redemptions > 0 ? ` · ${c._count.redemptions} used` : ""}
                                    </div>
                                    <div className="flex items-center gap-1">
                                        {c.code && (
                                            <>
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button size="icon" variant="outline" className="h-7 w-7" title="Share"><Share2 size={14} /></Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="start" className="w-52">
                                                        <DropdownMenuItem onSelect={() => shareCouponImage(c)}><ImageIcon size={14} className="mr-2" /> Share with image</DropdownMenuItem>
                                                        <DropdownMenuItem onSelect={() => shareWhatsappWebImage(c)}><MessageCircle size={14} className="mr-2" /> WhatsApp Web (image)</DropdownMenuItem>
                                                        <DropdownMenuItem onSelect={() => downloadImage(c)}><Download size={14} className="mr-2" /> Download image</DropdownMenuItem>
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuItem asChild>
                                                            <a href={couponWhatsappUrl(shareInfo(c))} target="_blank" rel="noopener noreferrer"><MessageCircle size={14} className="mr-2" /> WhatsApp (text)</a>
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem asChild>
                                                            <a href={couponEmailUrl(shareInfo(c))}><Mail size={14} className="mr-2" /> Email (text)</a>
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onSelect={() => copyCode(c)}><Copy size={14} className="mr-2" /> Copy code</DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                                <Button size="icon" variant="outline" className="h-7 w-7" title="Print" onClick={() => printCoupon(c)}><Printer size={14} /></Button>
                                            </>
                                        )}
                                        <Button size="icon" variant="ghost" className="h-7 w-7" title="Edit" onClick={() => openEdit(c)}><Pencil size={14} /></Button>
                                        <Button size="icon" variant="ghost" className="h-7 w-7" title="Delete" onClick={() => remove(c)}><Trash2 size={14} className="text-destructive" /></Button>
                                        <div className="ml-auto flex items-center gap-1.5">
                                            <span className="text-[11px] text-muted-foreground">{c.isActive ? "On" : "Off"}</span>
                                            <Switch checked={c.isActive} onCheckedChange={(v) => patch(c.id, { isActive: v })} />
                                        </div>
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </CardContent>
        </Card>
    );
}
