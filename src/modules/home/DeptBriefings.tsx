/**
 * Department Briefing Cards
 *
 * Each async server component below shows a compact "morning briefing" card
 * for one department. Shown on /office below the UniversalCustomerPanel.
 *
 * Design intent:
 *  - Only live counts that are cheap to fetch (no full list queries)
 *  - Quick-action buttons linking to the real module pages
 *  - Simple to extend when new departments are added
 *
 * Department IDs (from bootstrap seed):
 *   DEP-REPAIR  → Repair briefing
 *   DEP-SALES   → Showroom briefing
 *   DEP-DESK    → Showroom briefing (Front Desk staff use same layout)
 *   DEP-FIN     → Finance briefing
 *   DEP-IT      → Admin briefing (also shown for admin:bypass users)
 *   DEP-HR      → HR briefing (basic links only for now)
 *   DEP-DESP    → Despatch briefing
 */

import Link from "next/link";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import {
    Wrench, ShoppingCart, DollarSign, Settings2, Package,
    Users, ChevronRight, AlertCircle, CheckCircle2,
    FileText, BookOpen, CreditCard, ReceiptText,
} from "lucide-react";

// ── Shared helpers ─────────────────────────────────────────────────────────────

function BriefingCard({
    icon,
    title,
    color,
    children,
}: {
    icon: React.ReactNode;
    title: string;
    color: string;
    children: React.ReactNode;
}) {
    return (
        <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className={`flex items-center gap-2.5 px-5 py-3.5 border-b border-border ${color}`}>
                {icon}
                <span className="font-semibold text-sm">{title}</span>
            </div>
            <div className="p-5">{children}</div>
        </div>
    );
}

function StatCard({ label, value, highlight = false }: { label: string; value: number | string; highlight?: boolean }) {
    return (
        <div className="flex-1 min-w-0 rounded-lg border border-border bg-muted/40 px-4 py-3 text-center">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide truncate">{label}</p>
            <p className={`text-2xl font-bold mt-0.5 ${highlight ? "text-destructive" : "text-foreground"}`}>{value}</p>
        </div>
    );
}

function QuickLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
    return (
        <Link
            href={href}
            className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted/60 transition-colors"
        >
            {icon}
            <span className="flex-1">{label}</span>
            <ChevronRight size={14} className="text-muted-foreground shrink-0" />
        </Link>
    );
}

// ── Repair Briefing ────────────────────────────────────────────────────────────

export async function RepairBriefing({ userId, isAdmin }: { userId: number; isAdmin: boolean }) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let open: number | string = "—", escalated: number | string = "—",
        readyToCollect: number | string = "—", myOpen: number | string = "—",
        newToday: number | string = "—";
    try {
        [open, escalated, readyToCollect, myOpen, newToday] = await Promise.all([
            prisma.ticket.count({ where: { ticketStatus: { isTerminal: false } } }),
            prisma.ticket.count({ where: { repair: { escalated: true }, ticketStatus: { isTerminal: false } } }),
            prisma.ticket.count({ where: { status: "S6" } }),
            prisma.ticket.count({ where: { createdBy: { path: ["userId"], equals: userId }, ticketStatus: { isTerminal: false } } }),
            prisma.ticket.count({ where: { createdAt: { gte: today } } }),
        ]);
    } catch {
        // DB unavailable — show "—" so the page still loads without misleading zeros
    }

    return (
        <BriefingCard
            icon={<Wrench size={16} />}
            title="Repair &amp; Service"
            color="bg-blue-50 text-blue-800"
        >
            <div className="space-y-4">
                <div className="flex gap-3 flex-wrap sm:flex-nowrap">
                    <StatCard label="Open" value={open} />
                    <StatCard label="Escalated" value={escalated} highlight={typeof escalated === "number" && escalated > 0} />
                    <StatCard label="Ready to collect" value={readyToCollect} />
                    {!isAdmin && <StatCard label="Mine" value={myOpen} />}
                    <StatCard label="New today" value={newToday} />
                </div>

                <div className="grid grid-cols-2 gap-2">
                    <QuickLink href="/office/repairing" icon={<Wrench size={14} />} label="Repair Dashboard" />
                    <QuickLink href="/office/repairing/tickets" icon={<FileText size={14} />} label="All Tickets" />
                </div>
            </div>
        </BriefingCard>
    );
}

// ── Showroom Briefing ──────────────────────────────────────────────────────────
// Used by both DEP-SALES and DEP-DESK (Front Desk)

export async function ShowroomBriefing() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // POS counter sales = today's posted InvVouchers of type POS (walk-in
    // counter); deliberately excludes ecommerce/shop-order or ticket-linked
    // SALE vouchers. Migrated from prisma.invoice to prisma.invVoucher on
    // 2026-05-24 (Layer 3d of the Invoice → InvVoucher consolidation).
    const posFilter = {
        createdAt: { gte: today },
        deletedAt: null,
        status:    "POSTED" as const,
        type:      "POS" as const,
    };

    let billsToday: number | string = "—", openShifts: number | string = "—",
        salesDisplay = "—";
    try {
        const [b, s, agg] = await Promise.all([
            prisma.voucherDetail.count({ where: posFilter }),
            prisma.posShift.count({ where: { closedAt: null } }),
            prisma.voucherDetail.aggregate({ where: posFilter, _sum: { totalAmount: true } }),
        ]);
        billsToday = b;
        openShifts = s;
        const totalRs = Math.round((agg._sum.totalAmount?.toNumber() ?? 0));
        salesDisplay = `₹${totalRs.toLocaleString("en-IN")}`;
    } catch {
        // DB unavailable — show "—" so the page still loads without misleading zeros
    }

    return (
        <BriefingCard
            icon={<ShoppingCart size={16} />}
            title="Showroom / Front Counter"
            color="bg-amber-50 text-amber-800"
        >
            <div className="space-y-4">
                <div className="flex gap-3 flex-wrap sm:flex-nowrap">
                    <StatCard label="Today's sales" value={salesDisplay} />
                    <StatCard label="Bills today" value={billsToday} />
                    <StatCard label="Open shifts" value={openShifts} highlight={typeof openShifts === "number" && openShifts === 0} />
                </div>

                <div className="grid grid-cols-2 gap-2">
                    <QuickLink href="/vouchers/pos/new" icon={<ReceiptText size={14} />} label="New POS Bill" />
                    <QuickLink href="/vouchers/pos" icon={<ShoppingCart size={14} />} label="Today&apos;s Bills" />
                    <QuickLink href="/office/customers" icon={<Users size={14} />} label="Customers" />
                    <QuickLink href="/office/repairing/tickets" icon={<Wrench size={14} />} label="Repair Tickets" />
                </div>
            </div>
        </BriefingCard>
    );
}

// ── Finance / Accounts Briefing ────────────────────────────────────────────────

export function FinanceBriefing() {
    return (
        <BriefingCard
            icon={<DollarSign size={16} />}
            title="Finance &amp; Accounts"
            color="bg-green-50 text-green-800"
        >
            <div className="grid grid-cols-2 gap-2">
                <QuickLink href="/office/accountancy/daybook" icon={<BookOpen size={14} />} label="Day Book" />
                <QuickLink href="/office/accountancy/receivables" icon={<CreditCard size={14} />} label="Receivables" />
                <QuickLink href="/office/accountancy/cash-bank" icon={<DollarSign size={14} />} label="Cash &amp; Bank Book" />
                <QuickLink href="/office/accountancy/gst" icon={<FileText size={14} />} label="GST Hub" />
                <QuickLink href="/office/accountancy" icon={<ReceiptText size={14} />} label="Journals" />
                <QuickLink href="/office/accountancy/reports" icon={<FileText size={14} />} label="Reports" />
            </div>
        </BriefingCard>
    );
}

// ── Admin Overview Briefing ────────────────────────────────────────────────────

export async function AdminBriefing() {
    let openRepair: number | string = "—", openSupport: number | string = "—",
        openInternal: number | string = "—";
    try {
        [openRepair, openSupport, openInternal] = await Promise.all([
            prisma.ticket.count({ where: { pipelineId: "P1", ticketStatus: { isTerminal: false } } }),
            prisma.ticket.count({ where: { pipelineId: "P2" } }),
            prisma.ticket.count({ where: { pipelineId: "P4" } }),
        ]);
    } catch {
        // DB unavailable — show "—" so the page still loads without misleading zeros
    }

    return (
        <BriefingCard
            icon={<Settings2 size={16} />}
            title="Admin Overview"
            color="bg-violet-50 text-violet-800"
        >
            <div className="space-y-4">
                <div className="flex gap-3 flex-wrap sm:flex-nowrap">
                    <StatCard label="Repair open" value={openRepair} />
                    <StatCard label="Support queue" value={openSupport} />
                    <StatCard label="Internal requests" value={openInternal} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <QuickLink href="/office/repairing" icon={<Wrench size={14} />} label="Repair Dashboard" />
                    <QuickLink href="/office/customers" icon={<Users size={14} />} label="Customers" />
                    <QuickLink href="/office/accountancy" icon={<DollarSign size={14} />} label="Accountancy" />
                    <QuickLink href="/office/admin/users" icon={<Settings2 size={14} />} label="Admin / Users" />
                </div>
            </div>
        </BriefingCard>
    );
}

// ── Despatch Briefing ──────────────────────────────────────────────────────────

export async function DespatchBriefing() {
    let pendingDespatch: number | string = "—", escalated: number | string = "—";
    try {
        [pendingDespatch, escalated] = await Promise.all([
            prisma.ticket.count({
                where: { workerId: "SS22", ticketStatus: { isTerminal: false } },
            }),
            prisma.ticket.count({ where: { repair: { escalated: true }, status: "S4" } }),
        ]);
    } catch {
        // DB unavailable — show "—" so the page still loads without misleading zeros
    }

    return (
        <BriefingCard
            icon={<Package size={16} />}
            title="Despatch &amp; Logistics"
            color="bg-orange-50 text-orange-800"
        >
            <div className="space-y-4">
                <div className="flex gap-3 flex-wrap sm:flex-nowrap">
                    <StatCard label="Pending despatch" value={pendingDespatch} highlight={typeof pendingDespatch === "number" && pendingDespatch > 0} />
                    <StatCard label="Escalated (in repair)" value={escalated} />
                </div>
                <div className="grid grid-cols-1 gap-2">
                    <QuickLink href="/office/repairing" icon={<Wrench size={14} />} label="Repair Dashboard (Despatch View)" />
                </div>
            </div>
        </BriefingCard>
    );
}

// ── HR Briefing ────────────────────────────────────────────────────────────────

export function HrBriefing() {
    return (
        <BriefingCard
            icon={<Users size={16} />}
            title="HR &amp; People"
            color="bg-pink-50 text-pink-800"
        >
            <div className="grid grid-cols-2 gap-2">
                <QuickLink href="/office/hr/staff" icon={<Users size={14} />} label="Staff Directory" />
                <QuickLink href="/office/admin/org-chart" icon={<Settings2 size={14} />} label="Org Chart" />
            </div>
        </BriefingCard>
    );
}

// ── No Department Assigned ─────────────────────────────────────────────────────

export function NoDeptCard({ name }: { name: string }) {
    return (
        <div className="rounded-xl border border-border bg-card shadow-sm p-8 text-center">
            <AlertCircle size={32} className="text-muted-foreground mx-auto mb-3" />
            <h2 className="text-lg font-semibold text-foreground mb-1">No department assigned yet</h2>
            <p className="text-sm text-muted-foreground">
                Hi {name}, you are logged in but have not been assigned to a department.
                Please ask your admin to assign you to a team — this affects what you see on this page.
            </p>
        </div>
    );
}

// ── All Clear Card ─────────────────────────────────────────────────────────────

export function AllClearCard({ name }: { name: string }) {
    return (
        <div className="rounded-xl border border-border bg-card shadow-sm p-8 text-center">
            <CheckCircle2 size={32} className="text-primary mx-auto mb-3" />
            <h2 className="text-lg font-semibold text-foreground">All clear, {name}!</h2>
            <p className="text-sm text-muted-foreground mt-1">No pending actions. Use the panel above to help customers or log requests.</p>
        </div>
    );
}
