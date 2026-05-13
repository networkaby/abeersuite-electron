"use client";

import { useEffect, useState } from "react";
import { useResizable } from "@/shared/hooks/useResizable";
import { usePanelStore } from "@/store/panelStore";
import Link from "next/link";
import { usePathname } from "next/navigation";
import axios from "axios";
import { PanelRight, Zap, Grid2x2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BUTTON_BAR_ACTIONS, type ModuleCreateAction } from "@/utils/constants";
import { getActiveModule } from "@/utils/active-module";
import { useQuickTicketStore } from "@/store/quickTicketStore";
import { useCreateDialogStore } from "@/store/createDialogStore";
// GL vouchers now use full-page routes opened in a new tab — no dialog stores needed.
// Sale uses the full-page /sale route now — no dialog store.
// Purchase uses the full-page /purchase route now — no dialog store.
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
    const { barMode, setBarMode, toggleBarVisible } = usePanelStore();
    const collapsed = barMode === "collapsed";
    const isHidden  = barMode === "hidden";
    const [moreOpen, setMoreOpen] = useState(false);

    // Persist mode to localStorage
    useEffect(() => {
        try { localStorage.setItem("app:buttonbar-mode", barMode); } catch { /* ignore */ }
    }, [barMode]);
    useEffect(() => {
        try {
            const stored = localStorage.getItem("app:buttonbar-mode");
            if (stored === "expanded" || stored === "collapsed" || stored === "hidden")
                setBarMode(stored);
        } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const {
        width: barWidth, isDragging: barDragging,
        dragReady: barDragReady,
        onMouseDown: onBarDragStart,
        onHandleMouseEnter: onBarHandleEnter,
        onHandleMouseLeave: onBarHandleLeave,
    } = useResizable({
        storageKey: "app:buttonbar-width",
        defaultWidth: 224,
        minWidth: 160,
        maxWidth: 360,
        direction: "left",
    });

    const { setOpen: openQuickTicket, setInitialPipelineId } = useQuickTicketStore();
    const { personOpen, companyOpen, setPersonOpen, setCompanyOpen } = useCreateDialogStore();
    // GL voucher stores removed — those kinds now navigate to full-page routes.

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
            window.open("/vouchers/journal-entries/new", "_blank", "noopener");
        } else if (action.action === "new-debit-note") {
            window.open("/vouchers/debit-notes/new", "_blank", "noopener");
        } else if (action.action === "new-contra") {
            window.open("/vouchers/contras/new", "_blank", "noopener");
        } else if (action.action === "new-payment") {
            window.open("/vouchers/payments/new", "_blank", "noopener");
        } else if (action.action === "new-receipt") {
            window.open("/vouchers/receipts/new", "_blank", "noopener");
        } else if (action.action === "new-credit-note") {
            window.open("/vouchers/credit-notes/new", "_blank", "noopener");
        } else if (action.action === "new-sale") {
            window.open("/vouchers/sales/new", "_blank", "noopener");
        } else if (action.action === "new-purchase") {
            window.open("/vouchers/purchases/new", "_blank", "noopener");
        } else if (action.action === "new-sale-return") {
            window.open("/vouchers/sale-returns/new", "_blank", "noopener");
        } else if (action.action === "new-purchase-return") {
            window.open("/vouchers/purchase-returns/new", "_blank", "noopener");
        } else if (action.action === "new-sales-order") {
            window.open("/vouchers/sales-orders/new", "_blank", "noopener");
        } else if (action.action === "new-purchase-order") {
            window.open("/vouchers/purchase-orders/new", "_blank", "noopener");
        } else if (action.action === "new-grn") {
            window.open("/vouchers/grn/new", "_blank", "noopener");
        } else if (action.action === "new-challan") {
            window.open("/vouchers/challans/new", "_blank", "noopener");
        } else if (action.action === "new-stock-journal") {
            window.open("/office/inventory/stock-journals/new", "_blank", "noopener");
        } else if (action.action === "new-physical-stock") {
            window.open("/office/inventory/physical-stock/new", "_blank", "noopener");
        } else if (action.action === "new-rejection-in") {
            window.open("/vouchers/rejections-in/new", "_blank", "noopener");
        } else if (action.action === "new-rejection-out") {
            window.open("/vouchers/rejections-out/new", "_blank", "noopener");
        } else if (action.action === "new-estimate") {
            window.open("/vouchers/estimates/new", "_blank", "noopener");
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
                className="relative flex h-screen flex-col border-l border-border bg-sidebar shrink-0 overflow-hidden"
                style={{
                    width: isHidden ? 0 : collapsed ? 64 : barWidth,
                    transition: barDragging ? "none" : "width 0.3s ease",
                }}
            >

                {/* Drag-to-resize handle — left edge, expanded only; stays outside the slide wrapper */}
                {!collapsed && !isHidden && (
                    <div
                        onMouseEnter={onBarHandleEnter}
                        onMouseLeave={onBarHandleLeave}
                        onMouseDown={onBarDragStart}
                        className={[
                            "absolute left-0 top-0 h-full w-1.5 z-20 transition-colors",
                            barDragReady
                                ? "cursor-col-resize bg-primary/30"
                                : "cursor-default bg-transparent hover:bg-primary/10",
                        ].join(" ")}
                        title="Drag to resize"
                    />
                )}

                {/* Slide wrapper — content animates up to hide, down to show */}
                <div
                    className="flex flex-col flex-1 min-h-0"
                    style={{
                        transform: isHidden ? "translateY(-100%)" : "translateY(0)",
                        transition: barDragging ? "none" : "transform 0.3s ease",
                    }}
                >

                {/* Header */}
                <div className={`flex items-center border-b border-border px-3 py-3 ${collapsed ? "flex-col gap-2" : "gap-2.5"}`}>
                    {collapsed && (
                        <button
                            type="button"
                            title="Expand action bar"
                            onClick={() => setBarMode("expanded")}
                            className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        >
                            <PanelRight size={15} />
                        </button>
                    )}
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center bg-primary/10 text-primary">
                        <Zap size={14} />
                    </div>
                    {!collapsed && (
                        <>
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-foreground">{headerLabel}</p>
                                {user?.name && (
                                    <p className="truncate text-xs text-muted-foreground">{user.name}</p>
                                )}
                            </div>
                            <button
                                type="button"
                                title="Collapse action bar"
                                onClick={() => setBarMode("collapsed")}
                                className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
                            >
                                <PanelRight size={14} />
                            </button>
                        </>
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
                </div>{/* end slide wrapper */}
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
