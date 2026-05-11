"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import axios from "axios";
import { ChevronLeft, ChevronRight, Zap, Grid2x2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BUTTON_BAR_ACTIONS, type ModuleCreateAction } from "@/utils/constants";
import { getActiveModule } from "@/utils/active-module";
import { useQuickTicketStore } from "@/store/quickTicketStore";
import { useCreateDialogStore } from "@/store/createDialogStore";
import { useJournalVoucherStore } from "@/store/journalVoucherStore";
import { useDebitNoteDialogStore } from "@/store/debitNoteDialogStore";
import { useContraDialogStore } from "@/store/contraDialogStore";
import { usePaymentDialogStore } from "@/store/paymentDialogStore";
import { useReceiptDialogStore } from "@/store/receiptDialogStore";
import { useCreditNoteDialogStore } from "@/store/creditNoteDialogStore";
// Sale uses the full-page /sale route now — no dialog store.
import { usePurchaseDialogStore } from "@/store/purchaseDialogStore";
import { useEstimateDialogStore } from "@/store/estimateDialogStore";
import CreatePersonDialog from "@/shared/components/CreatePersonDialog";
import CreateCompanyDialog from "@/shared/components/CreateCompanyDialog";
import AllCreateActionsDialog from "@/shared/components/AllCreateActionsDialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

type UserType = {
    name?: string | null;
    role?: string;
    roles?: string[];
    permissions?: string[];
};

type Pipeline = { id: string; isDefault: boolean; isActive: boolean };

export default function ButtonBar({ user }: { user?: UserType }) {
    const pathname = usePathname();
    const [defaultPipeline, setDefaultPipeline] = useState<Pipeline | null>(null);
    const [collapsed, setCollapsed] = useState(false);
    const [moreOpen, setMoreOpen] = useState(false);

    const { setOpen: openQuickTicket, setInitialPipelineId } = useQuickTicketStore();
    const { personOpen, companyOpen, setPersonOpen, setCompanyOpen } = useCreateDialogStore();
    const { setOpen: openJournalVoucher } = useJournalVoucherStore();
    const { setOpen: openDebitNote } = useDebitNoteDialogStore();
    const { setOpen: openContra } = useContraDialogStore();
    const { setOpen: openPayment } = usePaymentDialogStore();
    const { setOpen: openReceipt } = useReceiptDialogStore();
    const { setOpen: openCreditNote } = useCreditNoteDialogStore();
    const router = useRouter();
    const { setOpen: openPurchase } = usePurchaseDialogStore();
    const { setOpen: openEstimate } = useEstimateDialogStore();

    const permissions = user?.permissions ?? [];
    const isAdmin = permissions.includes(PERMISSIONS.ADMIN_BYPASS);

    const activeModule = getActiveModule(pathname);
    const createActions = activeModule?.createActions ?? null;

    // Filter by permission
    const visibleActions = (createActions ?? []).filter((a) => {
        if (!a.permission) return true;
        return isAdmin || permissions.includes(a.permission);
    });

    useEffect(() => {
        axios
            .get<Pipeline[]>("/api/pipelines")
            .then((res) => {
                const def =
                    res.data.find((p) => p.isDefault && p.isActive) ??
                    res.data.find((p) => p.isActive) ??
                    null;
                setDefaultPipeline(def);
            })
            .catch(() => {});
    }, []);

    const handleAction = (action: ModuleCreateAction) => {
        if (action.disabled) return;
        if (action.action === "new-ticket" && action.pipelineRef === "default" && defaultPipeline) {
            setInitialPipelineId(defaultPipeline.id);
            openQuickTicket(true);
        } else if (action.action === "new-person") {
            setPersonOpen(true);
        } else if (action.action === "new-company") {
            setCompanyOpen(true);
        } else if (action.action === "new-journal-voucher") {
            openJournalVoucher(true);
        } else if (action.action === "new-debit-note") {
            openDebitNote(true);
        } else if (action.action === "new-contra") {
            openContra(true);
        } else if (action.action === "new-payment") {
            openPayment(true);
        } else if (action.action === "new-receipt") {
            openReceipt(true);
        } else if (action.action === "new-credit-note") {
            openCreditNote(true);
        } else if (action.action === "new-sale") {
            // Sale is a full-page route now (the old dialog was dropped).
            router.push("/sale");
        } else if (action.action === "new-purchase") {
            openPurchase(true);
        } else if (action.action === "new-estimate") {
            openEstimate(true);
        }
    };

    const headerLabel = activeModule ? activeModule.label : "Quick Actions";

    // For universal (no active module) fall back to BUTTON_BAR_ACTIONS rendered as ModuleCreateAction shape
    const universalActions: ModuleCreateAction[] = BUTTON_BAR_ACTIONS.map((a) => ({
        label: a.label,
        subtitle: a.subtitle,
        icon: a.icon,
        variant: a.variant,
        href: a.href,
        newTab: a.newTab,
        action: a.action,
        pipelineRef: a.pipelineRef,
        disabled: a.disabled,
    }));

    const actions = activeModule ? visibleActions : universalActions;

    return (
        <>
            <aside
                className={[
                    collapsed ? "w-16" : "w-56",
                    "relative flex h-screen flex-col border-l border-border bg-sidebar transition-all duration-300 shrink-0",
                ].join(" ")}
            >
                {/* Collapse toggle */}
                <Button
                    type="button"
                    onClick={() => setCollapsed((c) => !c)}
                    aria-label={collapsed ? "Expand button bar" : "Collapse button bar"}
                    variant="outline"
                    size="icon-xs"
                    className="absolute -left-3 top-8 z-10 rounded-full bg-card text-muted-foreground shadow-sm hover:text-foreground"
                >
                    {collapsed ? <ChevronLeft size={12} /> : <ChevronRight size={12} />}
                </Button>

                {/* Header */}
                <div className={`flex items-center border-b border-border px-4 py-3 ${collapsed ? "justify-center px-3" : "gap-2.5"}`}>
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center bg-primary/10 text-primary">
                        <Zap size={14} />
                    </div>
                    {!collapsed && (
                        <div className="min-w-0">
                            <p className="text-sm font-semibold text-foreground">{headerLabel}</p>
                            {user?.name && (
                                <p className="truncate text-xs text-muted-foreground">{user.name}</p>
                            )}
                        </div>
                    )}
                </div>

                {/* Action buttons — sidebar-style: flat rows, deep highlight when active */}
                <ScrollArea className="flex-1 min-h-0">
                    <div className="space-y-0.5 p-2">
                        {/* More + button — always first */}
                        <button
                            type="button"
                            title={collapsed ? "More actions" : "More — all create actions"}
                            onClick={() => setMoreOpen(true)}
                            className={[
                                "flex h-auto w-full items-center rounded-lg text-sm font-medium transition-all duration-150",
                                collapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-2",
                                "text-muted-foreground hover:bg-muted hover:text-foreground",
                            ].join(" ")}
                        >
                            <Grid2x2 size={17} className="shrink-0" />
                            {!collapsed && <span className="truncate text-left">More +</span>}
                        </button>

                        {/* Module-specific or universal create actions */}
                        {actions.map((action) => {
                            const Icon = action.icon;
                            const isActive = !!(action.href && pathname.startsWith(action.href));

                            const rowClass = [
                                "flex h-auto w-full items-center rounded-lg text-sm font-medium transition-all duration-150",
                                collapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-2",
                                action.disabled
                                    ? "cursor-not-allowed text-muted-foreground/30"
                                    : isActive
                                        ? "bg-primary text-primary-foreground hover:bg-primary/90"
                                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                            ].join(" ");

                            const inner = (
                                <>
                                    <Icon size={17} className="shrink-0" />
                                    {!collapsed && (
                                        <>
                                            <span className="flex-1 truncate text-left">{action.label}</span>
                                            {action.disabled && (
                                                <Badge variant="secondary" className="h-4 shrink-0 px-1.5 text-[10px]">
                                                    Soon
                                                </Badge>
                                            )}
                                        </>
                                    )}
                                </>
                            );

                            const titleAttr = collapsed ? action.label : `${action.label} — ${action.subtitle}`;

                            if (action.href && !action.disabled) {
                                return (
                                    <Link
                                        key={action.label}
                                        href={action.href}
                                        className={rowClass}
                                        title={titleAttr}
                                        {...(action.newTab
                                            ? { target: "_blank", rel: "noopener noreferrer" }
                                            : {})}
                                    >
                                        {inner}
                                    </Link>
                                );
                            }

                            return (
                                <button
                                    key={action.label}
                                    type="button"
                                    title={titleAttr}
                                    disabled={action.disabled}
                                    onClick={() => handleAction(action)}
                                    className={rowClass}
                                >
                                    {inner}
                                </button>
                            );
                        })}
                    </div>
                </ScrollArea>
            </aside>

            {/* Dialogs mounted here — owned by ButtonBar */}
            <AllCreateActionsDialog
                open={moreOpen}
                onOpenChange={setMoreOpen}
                permissions={permissions}
                isAdmin={isAdmin}
                defaultPipeline={defaultPipeline}
            />
            <CreatePersonDialog open={personOpen} onOpenChange={setPersonOpen} />
            <CreateCompanyDialog open={companyOpen} onOpenChange={setCompanyOpen} />
        </>
    );
}
