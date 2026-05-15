"use client";

import { toast } from "sonner";
import {
    AlertTriangle,
    Clock,
    Shield,
    Wrench,
    ShoppingBag,
    Sparkles,
    Plus,
    Receipt,
    MessageSquarePlus,
    LifeBuoy,
    FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Customer "Heads Up" strip — turns the panel from passive context into
 * an active conversation prompt. Sits between the account-health bar and
 * the Tickets / Purchases grid in the Customer Context Panel.
 *
 * ALL FOUR BLOCKS USE MOCK DATA so the user can judge the design vision
 * before any backend wiring lands. Real data will flow in follow-ups:
 *
 * 1. Warranty alerts        — derive from invoice lines × InvWarrantyTerm
 * 2. AMC / subscriptions    — needs a new AmcContract model (deferred)
 * 3. Cross-sell suggestions — needs a RelatedProduct mapping (deferred)
 * 4. Quick service actions  — wire to QuickEnquiryDialog etc (deferred)
 */
interface CustomerHeadsUpStripProps {
    accountId: number | null;
}

export default function CustomerHeadsUpStrip({
    accountId,
}: CustomerHeadsUpStripProps) {
    // No account → nothing to surface
    if (accountId == null) return null;

    const soon = (label: string) =>
        toast.info(`${label} — coming in next iteration`, {
            description: "UI placeholder for now. Backend wiring is on the roadmap.",
        });

    return (
        <div className="space-y-3 border-b border-border bg-muted/20 px-4 py-3">

            {/* ── Block 1 — Warranty alerts (mock) ── */}
            <Section
                icon={AlertTriangle}
                iconClass="text-amber-600"
                title="Heads up — mention these"
            >
                <div className="space-y-2">
                    <WarrantyRow
                        product="Brother HL-2271 Printer"
                        invoice="INV-089"
                        lineMain="Warranty expires in 28 days"
                        lineSub="Purchased 11 months ago · 12-month manufacturer warranty"
                        tone="amber"
                        onAction={soon}
                    />
                    <WarrantyRow
                        product="Asus VivoBook X515"
                        invoice="INV-072"
                        lineMain="Warranty expired 12 days ago"
                        lineSub="Last-chance grace claim · brand allows 30-day post-expiry"
                        tone="red"
                        onAction={soon}
                    />
                </div>
            </Section>

            {/* ── Block 2 — Active subscriptions & AMCs (mock) ── */}
            <Section
                icon={Shield}
                iconClass="text-blue-600"
                title="Active subscriptions & AMCs"
                soon
            >
                <div className="space-y-2">
                    <SubscriptionRow
                        name="Norton Antivirus 1-Year"
                        meta="Last renewed 11 Jan 2025 · ₹1,200/yr · 1 device"
                        expiresIn="23 days"
                        tone="amber"
                        onRenew={() => soon("Renew Norton Antivirus")}
                    />
                    <SubscriptionRow
                        name="Office AMC contract"
                        meta="Annual desktop + printer maintenance · ₹6,000/yr"
                        expiresIn="4 months"
                        tone="muted"
                        onRenew={() => soon("Renew Office AMC")}
                    />
                </div>
            </Section>

            {/* ── Block 3 — Suggested cross-sell (mock) ── */}
            <Section
                icon={ShoppingBag}
                iconClass="text-emerald-600"
                title="Suggested for them"
                soon
            >
                <p className="mb-2 text-[11px] italic text-muted-foreground">
                    Based on: <span className="font-medium">owns Brother HL-2271 (last bought 11 mo ago)</span>
                </p>
                <div className="grid gap-2 sm:grid-cols-3">
                    <CrossSellCard
                        name="Brother TN-2280 Toner"
                        meta="Black · genuine cartridge"
                        price="₹1,999"
                        stock={5}
                        onAdd={() => soon("Add Brother TN-2280 to ticket")}
                    />
                    <CrossSellCard
                        name="HP CB435A Toner"
                        meta="Compatible with their LaserJet"
                        price="₹2,150"
                        stock={2}
                        onAdd={() => soon("Add HP CB435A to ticket")}
                    />
                    <CrossSellCard
                        name="A4 Plain Paper 80gsm"
                        meta="500 sheets · pack"
                        price="₹320"
                        stock={48}
                        onAdd={() => soon("Add A4 paper to ticket")}
                    />
                </div>
            </Section>

            {/* ── Block 4 — Quick service actions (placeholder buttons) ── */}
            <Section
                icon={Sparkles}
                iconClass="text-purple-600"
                title="Quick actions"
            >
                <div className="flex flex-wrap gap-2">
                    <ActionPill
                        icon={MessageSquarePlus}
                        label="Log enquiry"
                        onClick={() => soon("Log enquiry")}
                    />
                    <ActionPill
                        icon={LifeBuoy}
                        label="After-sale help"
                        onClick={() => soon("After-sale help")}
                    />
                    <ActionPill
                        icon={FileText}
                        label="Issue duplicate invoice"
                        onClick={() => soon("Issue duplicate invoice")}
                    />
                    <ActionPill
                        icon={Wrench}
                        label="Schedule home visit"
                        onClick={() => soon("Schedule home visit")}
                    />
                </div>
            </Section>
        </div>
    );
}

// ── Internal building blocks ──────────────────────────────────────────────

function Section({
    icon: Icon,
    iconClass,
    title,
    soon = false,
    children,
}: {
    icon: typeof AlertTriangle;
    iconClass: string;
    title: string;
    soon?: boolean;
    children: React.ReactNode;
}) {
    return (
        <div>
            <div className="mb-1.5 flex items-center gap-1.5">
                <Icon size={13} className={iconClass} />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
                    {title}
                </span>
                {soon && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                        soon
                    </span>
                )}
            </div>
            {children}
        </div>
    );
}

function WarrantyRow({
    product,
    invoice,
    lineMain,
    lineSub,
    tone,
    onAction,
}: {
    product: string;
    invoice: string;
    lineMain: string;
    lineSub: string;
    tone: "amber" | "red";
    onAction: (label: string) => void;
}) {
    const ring =
        tone === "red"
            ? "border-destructive/40 bg-destructive/5"
            : "border-amber-400/50 bg-amber-50/60 dark:border-amber-600/40 dark:bg-amber-950/20";
    const dot =
        tone === "red"
            ? "text-destructive"
            : "text-amber-600 dark:text-amber-400";

    return (
        <div className={`rounded-lg border ${ring} px-3 py-2`}>
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                        <Clock size={12} className={dot} />
                        <span className="truncate">{product}</span>
                    </div>
                    <div className={`mt-0.5 text-[12px] ${dot} font-medium`}>
                        {lineMain}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {lineSub}
                    </div>
                </div>
                <span className="shrink-0 rounded bg-card px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {invoice}
                </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
                <ActionPill
                    icon={Receipt}
                    label="Issue duplicate invoice"
                    small
                    onClick={() => onAction("Issue duplicate invoice")}
                />
                <ActionPill
                    icon={Wrench}
                    label="Log warranty claim"
                    small
                    onClick={() => onAction("Log warranty claim")}
                />
            </div>
        </div>
    );
}

function SubscriptionRow({
    name,
    meta,
    expiresIn,
    tone,
    onRenew,
}: {
    name: string;
    meta: string;
    expiresIn: string;
    tone: "amber" | "muted";
    onRenew: () => void;
}) {
    const expiryClass =
        tone === "amber"
            ? "text-amber-600 dark:text-amber-400 font-semibold"
            : "text-muted-foreground";
    return (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm">
            <Shield size={14} className="shrink-0 text-blue-600" />
            <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-foreground">{name}</div>
                <div className="truncate text-[11px] text-muted-foreground">
                    {meta}
                </div>
            </div>
            <div className="text-right">
                <div className={`text-[11px] ${expiryClass}`}>
                    expires in {expiresIn}
                </div>
            </div>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onRenew}>
                Renew
            </Button>
        </div>
    );
}

function CrossSellCard({
    name,
    meta,
    price,
    stock,
    onAdd,
}: {
    name: string;
    meta: string;
    price: string;
    stock: number;
    onAdd: () => void;
}) {
    return (
        <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-2.5">
            <div className="text-sm font-medium text-foreground">{name}</div>
            <div className="text-[11px] text-muted-foreground">{meta}</div>
            <div className="mt-auto flex items-center justify-between pt-1">
                <div>
                    <div className="text-sm font-semibold text-foreground">
                        {price}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                        Stock: {stock}
                    </div>
                </div>
                <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 px-2 text-xs"
                    onClick={onAdd}
                >
                    <Plus size={11} />
                    Add
                </Button>
            </div>
        </div>
    );
}

function ActionPill({
    icon: Icon,
    label,
    onClick,
    small = false,
}: {
    icon: typeof AlertTriangle;
    label: string;
    onClick: () => void;
    small?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex items-center gap-1.5 rounded-md border border-border bg-card font-medium text-foreground transition-colors hover:bg-muted/60 ${
                small ? "px-2 py-1 text-[11px]" : "px-2.5 py-1.5 text-xs"
            }`}
        >
            <Icon size={small ? 11 : 12} />
            {label}
        </button>
    );
}
