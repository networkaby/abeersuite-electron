"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, Share2, Printer, Image as ImageIcon, Download, MessageCircle, Mail, Copy, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
    Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { CouponForm, type Coupon, type RuleMasters } from "./CouponForm";
import {
    couponHeadline, couponValueText, couponWhatsappUrl, couponWhatsappWebUrl, couponEmailUrl, type CouponShareInfo,
} from "@/modules/coupons/lib/couponShare";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { confirmAction } from "@/shared/lib/ui/confirmStore";

const channelTone: Record<Coupon["channels"], string> = {
    BOTH: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
    POS: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
    SHOP: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
};
const channelLabel: Record<Coupon["channels"], string> = { BOTH: "POS+Shop", POS: "POS", SHOP: "Shop" };

type TabKey = "ALL" | "ACTIVE" | "INACTIVE" | "AUTO";
const TABS: { key: TabKey; label: string }[] = [
    { key: "ALL", label: "All" },
    { key: "ACTIVE", label: "Active" },
    { key: "INACTIVE", label: "Inactive" },
    { key: "AUTO", label: "Auto-apply" },
];
const TYPE_FILTERS = [
    { value: "ALL", label: "All types" }, { value: "PERCENT", label: "% off" }, { value: "FLAT", label: "Flat ₹" },
    { value: "FREE_ITEM", label: "Free item" }, { value: "BOGO", label: "Buy X get Y" }, { value: "SET_PRICE", label: "Set price" },
] as const;
const CHAN_FILTERS = [
    { value: "ALL", label: "All channels" }, { value: "BOTH", label: "POS + Shop" }, { value: "POS", label: "POS" }, { value: "SHOP", label: "Shop" },
] as const;

const DAY_MS = 86_400_000;
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/// Validity read for a decision: what the date means right now, and its tone.
function validity(c: Coupon): { label: string; tone: "muted" | "amber" | "rose" } {
    const now = Date.now();
    if (c.startsAt && new Date(c.startsAt).getTime() > now) return { label: `Starts ${fmtDate(c.startsAt)}`, tone: "muted" };
    if (c.endsAt) {
        const days = Math.ceil((new Date(c.endsAt).getTime() - now) / DAY_MS);
        if (days < 0) return { label: `Ended ${fmtDate(c.endsAt)}`, tone: "rose" };
        if (days <= 7) return { label: `Ends in ${days}d · ${fmtDate(c.endsAt)}`, tone: "amber" };
        return { label: `Until ${fmtDate(c.endsAt)}`, tone: "muted" };
    }
    return { label: "No end date", tone: "muted" };
}

/// Compact qualifier line under the offer (only the non-default facts).
function metaLine(c: Coupon): string[] {
    const parts: string[] = [];
    if (c.minBillValue != null && Number(c.minBillValue) > 0) parts.push(`Min ₹${Number(c.minBillValue).toLocaleString("en-IN")}`);
    if (c.independent) parts.push("free on top");
    if (c.stackable) parts.push("with tier + points");
    else if (c.stackScope === "LINE") parts.push("exclusive · its items only");
    if (c.isPrivate) parts.push("private");
    if (c.eligibility !== "ANY") parts.push(c.eligibility.toLowerCase());
    return parts;
}

export function CouponList({ masters, brandName }: { masters: RuleMasters; brandName: string }) {
    const [coupons, setCoupons] = useState<Coupon[]>([]);
    const [loading, setLoading] = useState(true);
    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState<Coupon | null>(null);
    const [search, setSearch] = useState("");
    const [tab, setTab] = useState<TabKey>("ALL");
    const [typeFilter, setTypeFilter] = useState<string>("ALL");
    const [chanFilter, setChanFilter] = useState<string>("ALL");

    function load() {
        axios.get<Coupon[]>("/api/coupons")
            .then((r) => setCoupons(r.data))
            .catch(() => toast.error("Failed to load coupons"))
            .finally(() => setLoading(false));
    }
    useEffect(load, []);
    // A coupon created or retired elsewhere shows up here on its own.
    useRealtimeTopics(["catalogue"], load);

    const counts = useMemo(() => {
        let active = 0, auto = 0;
        for (const c of coupons) {
            if (c.isActive) active++;
            if (c.applyMode === "AUTO") auto++;
        }
        return { all: coupons.length, active, inactive: coupons.length - active, auto };
    }, [coupons]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return coupons.filter((c) => {
            if (tab === "ACTIVE" && !c.isActive) return false;
            if (tab === "INACTIVE" && c.isActive) return false;
            if (tab === "AUTO" && c.applyMode !== "AUTO") return false;
            if (typeFilter !== "ALL" && c.type !== typeFilter) return false;
            if (chanFilter !== "ALL" && c.channels !== chanFilter) return false;
            if (q && !(c.code?.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))) return false;
            return true;
        });
    }, [coupons, search, tab, typeFilter, chanFilter]);

    async function patch(id: number, body: Partial<Coupon>) {
        try { await axios.patch(`/api/coupons/${id}`, body); load(); }
        catch { toast.error("Failed to update coupon"); }
    }
    async function remove(c: Coupon) {
        if (!(await confirmAction({ title: `Delete coupon ${c.code ?? c.name}?`, confirmLabel: "Delete" }))) return;
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

    const shareMenu = (c: Coupon) => (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="h-7 w-7" title="Share"><Share2 size={14} /></Button>
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
    );

    return (
        <div className="flex h-full min-h-0 flex-col gap-4">
            {/* Tabs + search + filters + add — stays put; only the table body scrolls */}
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
                <div className="inline-flex rounded-lg border border-border bg-muted/30 p-0.5">
                    {TABS.map((t) => (
                        <button
                            key={t.key}
                            type="button"
                            onClick={() => setTab(t.key)}
                            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${tab === t.key
                                ? "bg-background text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                                }`}
                        >
                            {t.label}
                            <span className={`rounded-full px-1.5 py-0.5 text-xs tabular-nums ${tab === t.key ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                                {counts[t.key.toLowerCase() as "all" | "active" | "inactive" | "auto"]}
                            </span>
                        </button>
                    ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <div className="relative min-w-50 flex-1 sm:w-64 sm:flex-none">
                        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search code or name…" className="h-9 pl-8" />
                    </div>
                    <Select value={typeFilter} onValueChange={setTypeFilter}>
                        <SelectTrigger className="h-9 w-32.5"><SelectValue /></SelectTrigger>
                        <SelectContent>{TYPE_FILTERS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
                    </Select>
                    <Select value={chanFilter} onValueChange={setChanFilter}>
                        <SelectTrigger className="h-9 w-35"><SelectValue /></SelectTrigger>
                        <SelectContent>{CHAN_FILTERS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
                    </Select>
                    <Button size="sm" onClick={openAdd}>
                        <Plus size={14} className="mr-1" /> Add coupon
                    </Button>
                </div>
            </div>

            {loading ? (
                <p className="rounded-lg border border-border/60 p-8 text-center text-sm text-muted-foreground">Loading…</p>
            ) : coupons.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/70 py-10 text-center text-sm text-muted-foreground">
                    No coupons yet — add one to run a promotion.
                </div>
            ) : filtered.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/70 py-10 text-center text-sm text-muted-foreground">
                    No coupons match your search/filter.
                </div>
            ) : (
                <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border/60 **:data-[slot=table-container]:overflow-x-visible">
                    <Table>
                        <TableHeader className="sticky top-0 z-10 bg-muted [&_th]:bg-muted [&_th]:shadow-[inset_0_-1px_0_var(--border)]">
                            <TableRow className="hover:bg-transparent">
                                <TableHead>Offer</TableHead>
                                <TableHead className="w-28">Mode</TableHead>
                                <TableHead className="w-24">Channel</TableHead>
                                <TableHead className="w-40">Validity</TableHead>
                                <TableHead className="w-28">Usage</TableHead>
                                <TableHead className="w-20">Active</TableHead>
                                <TableHead className="w-28 text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filtered.map((c) => {
                                const v = validity(c);
                                const meta = metaLine(c);
                                const used = c._count?.redemptions ?? 0;
                                return (
                                    <TableRow
                                        key={c.id}
                                        className={`cursor-pointer ${c.isActive ? "" : "opacity-60"}`}
                                        onClick={() => openEdit(c)}
                                        title="Edit coupon"
                                    >
                                        <TableCell className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="truncate font-semibold">{couponHeadline(c)}</span>
                                                {v.tone === "rose" && (
                                                    <Badge variant="outline" className="shrink-0 border-rose-200 bg-rose-50 px-1.5 text-[10px] text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-400">
                                                        Expired
                                                    </Badge>
                                                )}
                                            </div>
                                            <div className="truncate text-xs text-muted-foreground">{c.name}</div>
                                            {meta.length > 0 && (
                                                <div className="truncate text-[11px] text-muted-foreground/75">{meta.join(" · ")}</div>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-col items-start gap-1">
                                                {c.applyMode === "AUTO" && (
                                                    <span className="inline-flex rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">Auto</span>
                                                )}
                                                {c.code ? (
                                                    <button
                                                        type="button"
                                                        onClick={(e) => { e.stopPropagation(); copyCode(c); }}
                                                        title="Copy code"
                                                        className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] hover:bg-muted/70"
                                                    >
                                                        {c.code}
                                                    </button>
                                                ) : (
                                                    <span className="text-[11px] text-muted-foreground">—</span>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge className={`${channelTone[c.channels]} border-0`}>{channelLabel[c.channels]}</Badge>
                                        </TableCell>
                                        <TableCell>
                                            <span className={`whitespace-nowrap text-xs ${v.tone === "amber" ? "font-medium text-amber-600 dark:text-amber-400"
                                                    : v.tone === "rose" ? "font-medium text-rose-600 dark:text-rose-400"
                                                        : "text-muted-foreground"
                                                }`}>
                                                {v.label}
                                            </span>
                                        </TableCell>
                                        <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                                            {c.totalUsageLimit
                                                ? `${used.toLocaleString("en-IN")} / ${c.totalUsageLimit.toLocaleString("en-IN")} used`
                                                : used > 0 ? `${used.toLocaleString("en-IN")} used` : "Never used"}
                                            {c.perCustomerLimit ? ` · ${c.perCustomerLimit}/cust` : ""}
                                        </TableCell>
                                        <TableCell onClick={(e) => e.stopPropagation()}>
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-xs text-muted-foreground">{c.isActive ? "On" : "Off"}</span>
                                                <Switch checked={c.isActive} onCheckedChange={(v) => patch(c.id, { isActive: v })} />
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                                            <div className="flex items-center justify-end gap-0.5">
                                                {c.code && shareMenu(c)}
                                                {c.code && (
                                                    <Button size="icon" variant="ghost" className="h-7 w-7" title="Print" onClick={() => printCoupon(c)}><Printer size={14} /></Button>
                                                )}
                                                <Button size="icon" variant="ghost" className="h-7 w-7" title="Edit" onClick={() => openEdit(c)}><Pencil size={14} /></Button>
                                                <Button size="icon" variant="ghost" className="h-7 w-7" title="Delete" onClick={() => remove(c)}><Trash2 size={14} className="text-destructive" /></Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            )}

            {/* Add / edit dialog — keeps the list in view while configuring */}
            <Dialog open={formOpen} onOpenChange={(o) => { if (!o) setFormOpen(false); }}>
                <DialogContent className="max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-[min(1400px,calc(100vw-2rem))]">
                    <DialogHeader>
                        <DialogTitle>{editing ? `Edit ${editing.name}` : "New coupon"}</DialogTitle>
                        <DialogDescription>
                            {editing
                                ? "Update the promotion — changes apply from the next bill."
                                : "Create a promotion for POS and/or the online shop."}
                        </DialogDescription>
                    </DialogHeader>
                    <CouponForm
                        embedded
                        initial={editing ?? undefined}
                        masters={masters}
                        onSaved={() => { setFormOpen(false); load(); }}
                        onCancel={() => setFormOpen(false)}
                    />
                </DialogContent>
            </Dialog>
        </div>
    );
}
