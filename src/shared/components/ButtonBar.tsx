"use client";

import { useEffect, useRef, useState } from "react";
import { useResizable } from "@/shared/hooks/useResizable";
import { usePanelStore } from "@/store/panelStore";
import Link from "next/link";
import { usePathname } from "next/navigation";
import axios from "axios";
import { PanelRightClose, PanelRightOpen, Grid2x2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BUTTON_BAR_ACTIONS, MODULE_SECTIONS, type ModuleCreateAction } from "@/utils/constants";
import { getActiveModule } from "@/utils/active-module";
import { canViewModule, canDoCreateAction } from "@/utils/module-access";
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

const ACTION_HREFS: Partial<Record<NonNullable<ModuleCreateAction["action"]>, string>> = {
    "new-journal-voucher":        "/vouchers/journal-entries/new",
    "new-debit-note":             "/vouchers/debit-notes/new",
    "new-contra":                 "/vouchers/contras/new",
    "new-payment":                "/vouchers/payments/new",
    "new-receipt":                "/vouchers/receipts/new",
    "new-credit-note":            "/vouchers/credit-notes/new",
    "new-sale":                   "/vouchers/sales/new",
    "new-purchase":               "/vouchers/purchases/new",
    "new-sale-return":            "/vouchers/sale-returns/new",
    "new-purchase-return":        "/vouchers/purchase-returns/new",
    "new-sales-order":            "/vouchers/sales-orders/new",
    "new-purchase-order":         "/vouchers/purchase-orders/new",
    "new-grn":                    "/vouchers/grn/new",
    "new-challan":                "/vouchers/challans/new",
    "new-manufacturing-journal":  "/vouchers/manufacturing-journals/new",
    "new-physical-stock":         "/vouchers/physical-stock/new",
    "new-branch-transfer":        "/vouchers/branch-transfers/new",
    "new-rejection-in":           "/vouchers/rejections-in/new",
    "new-rejection-out":          "/vouchers/rejections-out/new",
    "new-estimate":               "/vouchers/estimates/new",
};

interface BtnBarMenuState { x: number; y: number; href: string; }

function ActionContextMenu({ menu, onClose }: { menu: BtnBarMenuState | null; onClose: () => void }) {
    const closeRef = useRef(onClose);
    useEffect(() => { closeRef.current = onClose; }, [onClose]);

    useEffect(() => {
        if (!menu) return;
        const onDown = (e: MouseEvent) => {
            if ((e.target as HTMLElement).closest("[data-bb-ctx-menu]")) return;
            closeRef.current();
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
        const onScroll = () => closeRef.current();
        document.addEventListener("mousedown", onDown);
        document.addEventListener("keydown", onKey);
        document.addEventListener("scroll", onScroll, true);
        return () => {
            document.removeEventListener("mousedown", onDown);
            document.removeEventListener("keydown", onKey);
            document.removeEventListener("scroll", onScroll, true);
        };
    }, [menu]);

    if (!menu) return null;
    const x = Math.min(menu.x, window.innerWidth - 200);
    const y = Math.min(menu.y, window.innerHeight - 60);

    return (
        <div
            data-bb-ctx-menu
            className="fixed z-50 min-w-[180px] rounded-md border border-border bg-popover text-popover-foreground shadow-lg py-1"
            style={{ left: x, top: y }}
            onContextMenu={(e) => e.preventDefault()}
        >
            <button
                type="button"
                onClick={() => { window.open(menu.href, "_blank", "noopener"); onClose(); }}
                className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-[12px] text-foreground hover:bg-muted"
            >
                Open in new window
            </button>
        </div>
    );
}

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
    const [ctxMenu, setCtxMenu] = useState<BtnBarMenuState | null>(null);
    const { barMode, setBarMode } = usePanelStore();
    const collapsed = barMode === "collapsed";
    const isHidden = barMode === "hidden";
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
    const canDo = (a: ModuleCreateAction | typeof BUTTON_BAR_ACTIONS[number]) => canDoCreateAction(a, permissions, isAdmin);

    const activeModule = getActiveModule(pathname);
    const createActions = activeModule?.createActions ?? null;

    // Module create actions — gated by each action's effective permission (per-kind
    // voucher CREATE key for vouchers, else the action's own permission).
    const visibleActions = (createActions ?? []).filter(canDo);

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
            .catch(() => { });
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
        }
    };

    const headerLabel = activeModule ? activeModule.label : "Quick Actions";

    // For universal (no active module) fall back to BUTTON_BAR_ACTIONS rendered as
    // ModuleCreateAction shape — gated by permission, same as module actions.
    const universalActions: ModuleCreateAction[] = BUTTON_BAR_ACTIONS
        .filter(canDo)
        .map((a) => ({
            label: a.label,
            subtitle: a.subtitle,
            icon: a.icon,
            variant: a.variant,
            href: a.href,
            newTab: a.newTab,
            action: a.action,
            pipelineRef: a.pipelineRef,
            permission: a.permission,
            disabled: a.disabled,
        }));

    const actions = activeModule ? visibleActions : universalActions;

    // "More +" opens the all-create-actions dialog, which lists actions from
    // modules the user can view. Hide it when that dialog would be empty, so a
    // zero-permission / unappointed user gets a truly empty action bar.
    const moreHasContent = MODULE_SECTIONS.some(
        (m) => canViewModule(m, permissions, isAdmin) && (m.createActions ?? []).some(canDo),
    );

    return (
        <>
            <aside
                className="relative flex h-full flex-col border-l border-border bg-sidebar shrink-0 overflow-hidden"
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
                        {collapsed ? (
                            <button
                                type="button"
                                title="Expand action bar"
                                onClick={() => setBarMode("expanded")}
                                className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                            >
                                <PanelRightOpen size={15} />
                            </button>
                        ) : (

                            <button
                                type="button"
                                title="Collapse action bar"
                                onClick={() => setBarMode("collapsed")}
                                className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
                            >
                                <PanelRightClose size={14} />
                            </button>

                        )}
                        {/* <div className="flex h-7 w-7 shrink-0 items-center justify-center bg-primary/10 text-primary">
                            <Zap size={14} />


                        </div> */}
                        {!collapsed && (
                            <>
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold text-foreground">{headerLabel}</p>
                                    {user?.name && (
                                        <p className="truncate text-xs text-muted-foreground">{user.name}</p>
                                    )}
                                </div>
                                {/* <button
                                type="button"
                                title="Collapse action bar"
                                onClick={() => setBarMode("collapsed")}
                                className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
                            >
                                <PanelRightClose size={14} />
                            </button> */}
                            </>
                        )}
                    </div>

                    {/* Action buttons — sidebar-style: flat rows, deep highlight when active */}
                    <ScrollArea className="flex-1 min-h-0">
                        <div className="space-y-0.5 p-2">
                            {/* More + button — first, but only when there are actions to show */}
                            {moreHasContent && (
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
                            )}

                            {/* Module-specific or universal create actions */}
                            {actions.map((action) => {
                                const Icon = action.icon;
                                const resolvedHref = action.href ?? (action.action ? ACTION_HREFS[action.action] : undefined);
                                const isActive = !!(resolvedHref && pathname.startsWith(resolvedHref));

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

                                if (resolvedHref && !action.disabled) {
                                    return (
                                        <Link
                                            key={`${action.label}|${action.action ?? action.href ?? ""}`}
                                            href={resolvedHref}
                                            className={rowClass}
                                            title={titleAttr}
                                            onContextMenu={(e) => {
                                                e.preventDefault();
                                                setCtxMenu({ x: e.clientX, y: e.clientY, href: resolvedHref });
                                            }}
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
                                        key={`${action.label}|${action.action ?? action.href ?? ""}`}
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
            <ActionContextMenu menu={ctxMenu} onClose={() => setCtxMenu(null)} />
        </>
    );
}
