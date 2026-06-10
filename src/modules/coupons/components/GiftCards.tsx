"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, CreditCard, Share2, Printer, Trash2, BadgeIndianRupee, MessageCircle, Mail, Copy, Clock, Search, Sparkles, Image as ImageIcon, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { giftCardWhatsappUrl, giftCardWhatsappWebUrl, giftCardEmailUrl, giftCardMessage, type GiftCardShareInfo } from "@/modules/coupons/lib/giftCardShare";
import { extractApiError } from "@/shared/lib/api";
import { parseDecimalInput, formatInr } from "@/shared/lib/format";

interface GiftCard {
    id: number;
    code: string;
    initialValue: string | number;
    balance: string | number;
    status: "DRAFT" | "ACTIVE" | "REDEEMED" | "EXPIRED" | "VOID";
    enabled: boolean;
    expiresAt: string | null;
    ownerAccount: { name: string } | null;
    createdAt: string;
}

type StatusFilter = "ALL" | "DRAFT" | "ACTIVE" | "DISABLED" | "REDEEMED" | "EXPIRED" | "VOID";

// Hero gradient per lifecycle state.
const heroTone: Record<GiftCard["status"], string> = {
    DRAFT:    "from-sky-600 via-sky-700 to-cyan-800",
    ACTIVE:   "from-teal-600 via-teal-700 to-emerald-800",
    REDEEMED: "from-slate-500 via-slate-600 to-slate-700",
    EXPIRED:  "from-amber-600 via-amber-700 to-orange-800",
    VOID:     "from-rose-600 via-rose-700 to-rose-800",
};
const FILTERS: { value: StatusFilter; label: string }[] = [
    { value: "ALL", label: "All" },
    { value: "DRAFT", label: "Draft" },
    { value: "ACTIVE", label: "Active" },
    { value: "DISABLED", label: "Disabled" },
    { value: "REDEEMED", label: "Redeemed" },
    { value: "EXPIRED", label: "Expired" },
    { value: "VOID", label: "Void" },
];

export function GiftCards({ brandName }: { brandName: string }) {
    const [cards, setCards] = useState<GiftCard[]>([]);
    const [loading, setLoading] = useState(true);
    const [value, setValue] = useState("");
    const [code, setCode] = useState("");
    const [expiresAt, setExpiresAt] = useState("");
    const [generating, setGenerating] = useState(false);
    const [busyId, setBusyId] = useState<number | null>(null);
    const [sweeping, setSweeping] = useState(false);
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");

    function load() {
        axios.get<GiftCard[]>("/api/gift-cards")
            .then((r) => setCards(r.data))
            .catch(() => toast.error("Failed to load gift cards"))
            .finally(() => setLoading(false));
    }
    useEffect(load, []);

    // ACTIVE cards already past expiry with a balance — eligible for breakage.
    const breakageCount = useMemo(() => {
        const now = Date.now();
        return cards.filter((c) => c.status === "ACTIVE" && c.expiresAt && new Date(c.expiresAt).getTime() < now && Number(c.balance) > 0).length;
    }, [cards]);

    const matchesFilter = (c: GiftCard): boolean => {
        switch (statusFilter) {
            case "ALL":      return true;
            case "ACTIVE":   return c.status === "ACTIVE" && c.enabled;
            case "DISABLED": return c.status === "ACTIVE" && !c.enabled;
            default:         return c.status === statusFilter;
        }
    };
    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return cards.filter((c) => {
            if (!matchesFilter(c)) return false;
            if (!q) return true;
            return c.code.toLowerCase().includes(q) || (c.ownerAccount?.name.toLowerCase().includes(q) ?? false);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cards, search, statusFilter]);

    async function generate() {
        const v = Number(value);
        if (!Number.isFinite(v) || v <= 0) return toast.error("Enter a value");
        setGenerating(true);
        try {
            await axios.post("/api/gift-cards", {
                initialValue: v,
                code: code.trim() || undefined,
                expiresAt: expiresAt ? new Date(expiresAt + "T00:00:00").toISOString() : null,
            });
            toast.success("Gift card generated (draft) — issue it when sold");
            setValue(""); setCode(""); setExpiresAt("");
            load();
        } catch (e) {
            toast.error(extractApiError(e, "Failed to generate"));
        } finally {
            setGenerating(false);
        }
    }

    async function issue(c: GiftCard) {
        if (!confirm(`Sell gift card ${c.code} for ${formatInr(Number(c.initialValue))}?\nThis takes payment and posts Dr Cash / Cr Gift Card Liability.`)) return;
        setBusyId(c.id);
        try {
            await axios.post(`/api/gift-cards/${c.id}/issue`, {});
            toast.success(`Gift card ${c.code} issued`);
            load();
        } catch (e) {
            toast.error(extractApiError(e, "Failed to issue"));
        } finally {
            setBusyId(null);
        }
    }

    async function remove(c: GiftCard) {
        if (!confirm(`Delete draft gift card ${c.code}? This can't be undone.`)) return;
        setBusyId(c.id);
        try {
            await axios.delete(`/api/gift-cards/${c.id}`);
            toast.success("Draft deleted");
            setCards((cs) => cs.filter((x) => x.id !== c.id));
        } catch (e) {
            toast.error(extractApiError(e, "Failed to delete"));
        } finally {
            setBusyId(null);
        }
    }

    async function toggleEnabled(c: GiftCard, next: boolean) {
        setCards((cs) => cs.map((x) => (x.id === c.id ? { ...x, enabled: next } : x))); // optimistic
        try {
            await axios.patch(`/api/gift-cards/${c.id}`, { enabled: next });
            toast.success(next ? "Gift card enabled" : "Gift card disabled (can't be redeemed)");
        } catch (e) {
            setCards((cs) => cs.map((x) => (x.id === c.id ? { ...x, enabled: !next } : x))); // revert
            toast.error(extractApiError(e, "Failed"));
        }
    }

    async function runBreakage() {
        if (!confirm(`Recognise breakage on ${breakageCount} expired gift card(s)? This posts income for the unredeemed balances.`)) return;
        setSweeping(true);
        try {
            const r = await axios.post<{ expired: number; total: number }>("/api/gift-cards/expire-breakage", {});
            toast.success(`Breakage recognised: ${r.data.expired} card(s), ${formatInr(r.data.total)}`);
            load();
        } catch (e) {
            toast.error(extractApiError(e, "Failed"));
        } finally {
            setSweeping(false);
        }
    }

    function shareInfo(c: GiftCard): GiftCardShareInfo {
        return { brandName, code: c.code, balance: Number(c.balance), expiresAt: c.expiresAt };
    }
    function printCard(c: GiftCard) {
        window.open(`/receipt/gift-card/${c.id}`, "_blank", "noopener");
    }
    async function copyCode(c: GiftCard) {
        try { await navigator.clipboard.writeText(c.code); toast.success("Code copied"); }
        catch { toast.error("Couldn't copy"); }
    }
    async function fetchCardImage(c: GiftCard): Promise<File> {
        const res = await fetch(`/api/gift-cards/${c.id}/image`);
        if (!res.ok) throw new Error("image");
        const blob = await res.blob();
        return new File([blob], `gift-card-${c.code}.png`, { type: "image/png" });
    }
    // Share the card IMAGE + text via the native share sheet (WhatsApp, email, …).
    // wa.me / mailto links can't carry an image, so this is the only way to send
    // the picture. Falls back to downloading the PNG + opening the WhatsApp text
    // where file-sharing isn't supported (most desktop browsers).
    async function shareCardImage(c: GiftCard) {
        const text = giftCardMessage(shareInfo(c));
        try {
            const file = await fetchCardImage(c);
            const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
            if (nav.canShare && nav.canShare({ files: [file] })) {
                await navigator.share({ files: [file], text, title: `${brandName} gift card` });
                return;
            }
            // Fallback: download the image, then open WhatsApp with the text to attach it to.
            const url = URL.createObjectURL(file);
            const a = document.createElement("a"); a.href = url; a.download = file.name; a.click();
            URL.revokeObjectURL(url);
            toast.info("Image downloaded — attach it in WhatsApp. Opening the message…");
            window.open(giftCardWhatsappUrl(shareInfo(c)), "_blank", "noopener");
        } catch (e) {
            if (e instanceof DOMException && e.name === "AbortError") return; // user cancelled
            toast.error("Couldn't share the image");
        }
    }
    // WhatsApp Web: copy the PNG to the clipboard + open the chat with text
    // prefilled, so the user pastes (Ctrl+V) the image in. WhatsApp has no
    // attach-via-link API, so clipboard-paste is the only way to get the picture
    // into web. clipboard.write() MUST be called synchronously in the click
    // gesture, so we pass a Promise-valued ClipboardItem (Chrome/Edge) — awaiting
    // the fetch first would void the user-gesture permission and silently fail.
    async function shareWhatsappWebImage(c: GiftCard) {
        const blobPromise = fetch(`/api/gift-cards/${c.id}/image`).then((r) => {
            if (!r.ok) throw new Error("image");
            return r.blob();
        });
        let copied = false;
        try {
            if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
                await navigator.clipboard.write([new ClipboardItem({ "image/png": blobPromise })]);
                copied = true;
            }
        } catch { /* clipboard blocked — fall back to download below */ }

        if (!copied) {
            try {
                const blob = await blobPromise;
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a"); a.href = url; a.download = `gift-card-${c.code}.png`; a.click();
                URL.revokeObjectURL(url);
            } catch { toast.error("Couldn't generate the image"); return; }
        }

        window.open(giftCardWhatsappWebUrl(shareInfo(c)), "_blank", "noopener");
        toast.info(copied
            ? "Image copied — press Ctrl+V in the WhatsApp chat to attach it. The message text is prefilled."
            : "Image downloaded — drag it into the WhatsApp chat. The message text is prefilled.");
    }
    async function downloadImage(c: GiftCard) {
        try {
            const file = await fetchCardImage(c);
            const url = URL.createObjectURL(file);
            const a = document.createElement("a"); a.href = url; a.download = file.name; a.click();
            URL.revokeObjectURL(url);
        } catch { toast.error("Couldn't generate the image"); }
    }

    return (
        <div className="space-y-4">
            {/* Separate generate area */}
            <Card>
                <CardHeader className="space-y-1.5">
                    <CardTitle className="flex items-center gap-2 text-base">
                        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-400"><Sparkles size={15} /></span>
                        Generate a gift card
                    </CardTitle>
                    <CardDescription>
                        Creates a <span className="font-medium">draft</span> (no accounting). Issue it from the card below when it&rsquo;s sold — that posts Dr Cash / Cr &ldquo;Gift Card Liability&rdquo;.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-wrap items-end gap-3">
                        <div className="w-36 space-y-1">
                            <Label className="text-[11px] text-muted-foreground">Value</Label>
                            <div className="relative">
                                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₹</span>
                                <Input inputMode="decimal" value={value} onChange={(e) => setValue(parseDecimalInput(e.target.value))} placeholder="1000" className="h-9 pl-6 text-right" />
                            </div>
                        </div>
                        <div className="w-44 space-y-1">
                            <Label className="text-[11px] text-muted-foreground">Code (blank = auto)</Label>
                            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="auto" className="h-9 font-mono" />
                        </div>
                        <div className="w-40 space-y-1">
                            <Label className="text-[11px] text-muted-foreground">Expires (optional)</Label>
                            <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="h-9" />
                        </div>
                        <Button size="sm" className="h-9" onClick={generate} disabled={generating}>
                            <Plus size={14} className="mr-1" /> Generate draft
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* List + toolbar */}
            <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                    <div className="space-y-1.5">
                        <CardTitle className="flex items-center gap-2 text-base">
                            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-400"><CreditCard size={15} /></span>
                            Gift cards
                            <span className="text-xs font-normal text-muted-foreground">({filtered.length})</span>
                        </CardTitle>
                        <CardDescription>
                            Toggle a card off to block redemption (no accounting change); it waits until it expires, then recognises breakage income.
                        </CardDescription>
                    </div>
                    {breakageCount > 0 && (
                        <Button size="sm" variant="outline" className="shrink-0 text-amber-700 dark:text-amber-400" onClick={runBreakage} disabled={sweeping}>
                            <Clock size={14} className="mr-1" /> Breakage ({breakageCount})
                        </Button>
                    )}
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* Search + filter toolbar */}
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="relative flex-1 min-w-[200px]">
                            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by code or owner…" className="h-9 pl-8" />
                        </div>
                        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                            <SelectTrigger className="h-9 w-[150px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {FILTERS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>

                    {loading ? (
                        <p className="text-sm text-muted-foreground">Loading…</p>
                    ) : cards.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-border/70 py-10 text-center text-sm text-muted-foreground">
                            No gift cards yet — generate one above, share or print it, then issue it when sold.
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-border/70 py-10 text-center text-sm text-muted-foreground">
                            No cards match your search/filter.
                        </div>
                    ) : (
                        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                            {filtered.map((c) => {
                                const isDraft = c.status === "DRAFT";
                                const isActive = c.status === "ACTIVE";
                                const dimmed = isActive && !c.enabled;
                                const info = shareInfo(c);
                                return (
                                    <li key={c.id} className={`overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm transition ${dimmed ? "opacity-60 grayscale" : ""}`}>
                                        {/* Card face */}
                                        <div className={`relative bg-gradient-to-br ${heroTone[c.status]} p-4 text-white`}>
                                            <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-white/10" />
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <div className="truncate text-xs font-semibold">{brandName}</div>
                                                    <div className="text-[10px] uppercase tracking-[2px] opacity-80">Gift Card</div>
                                                </div>
                                                <Badge className="border-0 bg-white/20 text-[10px] text-white backdrop-blur">
                                                    {dimmed ? "DISABLED" : c.status}
                                                </Badge>
                                            </div>
                                            <div className="mt-4 text-[10px] opacity-80">BALANCE</div>
                                            <div className="text-2xl font-extrabold leading-none">{formatInr(Number(c.balance))}</div>
                                            <div className="mt-0.5 text-[10px] opacity-70">of {formatInr(Number(c.initialValue))}</div>
                                            <div className="mt-3 font-mono text-sm font-bold tracking-wider break-all">{c.code}</div>
                                        </div>

                                        {/* Meta + actions */}
                                        <div className="space-y-2.5 p-3">
                                            <div className="min-h-[16px] text-[11px] text-muted-foreground">
                                                {c.ownerAccount ? c.ownerAccount.name : "Bearer card"}
                                                {c.expiresAt ? ` · expires ${c.expiresAt.slice(0, 10)}` : " · no expiry"}
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button size="icon" variant="outline" className="h-7 w-7" title="Share"><Share2 size={14} /></Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="start" className="w-52">
                                                        <DropdownMenuItem onSelect={() => shareCardImage(c)}><ImageIcon size={14} className="mr-2" /> Share with image</DropdownMenuItem>
                                                        <DropdownMenuItem onSelect={() => shareWhatsappWebImage(c)}><MessageCircle size={14} className="mr-2" /> WhatsApp Web (image)</DropdownMenuItem>
                                                        <DropdownMenuItem onSelect={() => downloadImage(c)}><Download size={14} className="mr-2" /> Download image</DropdownMenuItem>
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuItem asChild>
                                                            <a href={giftCardWhatsappUrl(info)} target="_blank" rel="noopener noreferrer"><MessageCircle size={14} className="mr-2" /> WhatsApp (text)</a>
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem asChild>
                                                            <a href={giftCardEmailUrl(info)}><Mail size={14} className="mr-2" /> Email (text)</a>
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onSelect={() => copyCode(c)}><Copy size={14} className="mr-2" /> Copy code</DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                                <Button size="icon" variant="outline" className="h-7 w-7" title="Print" onClick={() => printCard(c)}><Printer size={14} /></Button>

                                                {isDraft && (
                                                    <Button size="sm" variant="outline" className="h-7" disabled={busyId === c.id} onClick={() => issue(c)}>
                                                        <BadgeIndianRupee size={14} className="mr-1" /> Issue
                                                    </Button>
                                                )}
                                                {isDraft && (
                                                    <Button size="icon" variant="ghost" className="h-7 w-7" title="Delete draft" disabled={busyId === c.id} onClick={() => remove(c)}>
                                                        <Trash2 size={14} className="text-destructive" />
                                                    </Button>
                                                )}

                                                {isActive && (
                                                    <div className="ml-auto flex items-center gap-1.5">
                                                        <span className="text-[11px] text-muted-foreground">{c.enabled ? "Active" : "Disabled"}</span>
                                                        <Switch checked={c.enabled} onCheckedChange={(v) => toggleEnabled(c, v)} />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
