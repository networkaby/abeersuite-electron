"use client";

import { useEffect, useState } from "react";
import { useResizable } from "@/shared/hooks/useResizable";
import { useHoverPeek } from "@/shared/hooks/useHoverPeek";
import { usePanelStore } from "@/store/panelStore";
import Link from "next/link";
import { usePathname } from "next/navigation";
import axios from "axios";
import { PanelRightClose, PanelRightOpen, Pin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BUTTON_BAR_ACTIONS } from "@/shared/lib/constants/quickActions";
import { type ModuleCreateAction } from "@/shared/lib/constants/nav";
import { moduleActiveStyle, moduleIconStyle } from "@/shared/lib/format/moduleTheme";
import { canDoCreateAction } from "@/utils/module-access";
import { useQuickTicketStore } from "@/store/quickTicketStore";
import { useCreateDialogStore } from "@/store/createDialogStore";
// GL vouchers now use full-page routes opened in a new tab — no dialog stores needed.
// Sale uses the full-page /sale route now — no dialog store.
// Purchase uses the full-page /purchase route now — no dialog store.
import { LinkContextMenu, useLinkContextMenu } from "@/shared/components/LinkContextMenu";
import CreatePersonDialog from "@/shared/components/CreatePersonDialog";
import CreateCompanyDialog from "@/shared/components/CreateCompanyDialog";
import AllCreateActionsDialog from "@/shared/components/AllCreateActionsDialog";
import GlVoucherDialog, { GL_DIALOG_KIND_BY_ACTION, type GlDialogKind } from "@/shared/components/GlVoucherDialog";
import { useActivePartyStore, stashPreloadParty, type ActiveParty } from "@/store/activePartyStore";

/** Full-page vouchers that take a party: the open profile rides along. */
const PARTY_FACING_TRADING = new Set([
    "new-sale", "new-purchase", "new-sale-return", "new-purchase-return",
    "new-estimate", "new-sales-order", "new-purchase-order",
]);
import { HelpQuickForm } from "@/modules/help/components";
import { DealFormDialog } from "@/modules/deals/components";
import { TaskFormDialog } from "@/modules/administration/components";
import type { DealPositionOption } from "@/modules/deals/lib/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const ACTION_HREFS: Partial<Record<NonNullable<ModuleCreateAction["action"]>, string>> = {
    "new-journal-voucher": "/vouchers/journal-entries/new",
    "new-debit-note": "/vouchers/debit-notes/new",
    "new-contra": "/vouchers/contras/new",
    "new-payment": "/vouchers/payments/new",
    "new-receipt": "/vouchers/receipts/new",
    "new-credit-note": "/vouchers/credit-notes/new",
    "new-sale": "/vouchers/sales/new",
    "new-purchase": "/vouchers/purchases/new",
    "new-sale-return": "/vouchers/sale-returns/new",
    "new-purchase-return": "/vouchers/purchase-returns/new",
    "new-sales-order": "/vouchers/sales-orders/new",
    "new-purchase-order": "/vouchers/purchase-orders/new",
    "new-grn": "/vouchers/grn/new",
    "new-challan": "/vouchers/challans/new",
    "new-manufacturing-journal": "/vouchers/manufacturing-journals/new",
    "new-physical-stock": "/vouchers/physical-stock/new",
    "new-branch-transfer": "/vouchers/branch-transfers/new",
    "new-rejection-in": "/vouchers/rejections-in/new",
    "new-rejection-out": "/vouchers/rejections-out/new",
    "new-estimate": "/vouchers/estimates/new",
};

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
    const { menu: ctxMenu, openAt: openCtxMenu, close: closeCtxMenu } = useLinkContextMenu();
    // usePanelStore's own `persist` middleware is the single source of truth for
    // bar mode (localStorage key "panel-store") — no separate bridge needed.
    const { barMode, setBarMode } = usePanelStore();
    const hoverMode = barMode === "hover";
    const { peeking, onMouseEnter: onPeekEnter, onMouseLeave: onPeekLeave } = useHoverPeek(hoverMode);
    // Hover mode shows the rail until the mouse rests on it, then the full bar.
    const collapsed = barMode === "collapsed" || (hoverMode && !peeking);
    const isHidden = barMode === "hidden";
    const [moreOpen, setMoreOpen] = useState(false);
    // GL voucher opened in place over the office (left-click); right-click → new window.
    const [glDialogKind, setGlDialogKind] = useState<GlDialogKind | null>(null);
    // Party captured at click time, so closing the profile mid-entry doesn't blank the form.
    const [glDialogParty, setGlDialogParty] = useState<ActiveParty | null>(null);
    const activeParty = useActivePartyStore((s) => s.party);
    const openGlDialog = (kind: GlDialogKind) => { setGlDialogParty(activeParty); setGlDialogKind(kind); };

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
    const {
        personOpen, companyOpen, helpOpen, dealOpen, taskOpen,
        setPersonOpen, setCompanyOpen, setHelpOpen, setDealOpen, setTaskOpen,
    } = useCreateDialogStore();
    // GL voucher stores removed — those kinds now navigate to full-page routes.
    const [positions, setPositions] = useState<DealPositionOption[]>([]);

    const permissions = user?.permissions ?? [];
    const isAdmin = permissions.includes(PERMISSIONS.ADMIN_BYPASS);
    const canDo = (a: ModuleCreateAction | typeof BUTTON_BAR_ACTIONS[number]) => canDoCreateAction(a, permissions, isAdmin);

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

    useEffect(() => {
        axios
            .get<{ id: string; title: string; branch?: { name: string } | null }[]>("/api/positions")
            .then((res) => {
                setPositions(res.data.map((p) => ({ id: p.id, title: p.title, branchName: p.branch?.name ?? null })));
            })
            .catch(() => { });
    }, []);

    const handleAction = (action: ModuleCreateAction) => {
        if (action.disabled) return;
        if (action.action === "more") {
            setMoreOpen(true);
        } else if (action.action === "new-ticket" && action.pipelineRef === "default" && defaultPipeline) {
            setInitialPipelineId(defaultPipeline.id);
            openQuickTicket(true);
        } else if (action.action === "new-person") {
            setPersonOpen(true);
        } else if (action.action === "new-company") {
            setCompanyOpen(true);
        } else if (action.action === "new-help-ticket") {
            setHelpOpen(true);
        } else if (action.action === "new-deal") {
            setDealOpen(true);
        } else if (action.action === "new-task") {
            setTaskOpen(true);
        }
    };

    // Permanently visible bar: the action list never switches to module-specific
    // nav when a module is opened. One global set on every page, so the header is
    // a fixed label rather than the active module's name.
    const headerLabel = "Quick Actions";

    // The single always-on list — BUTTON_BAR_ACTIONS rendered as ModuleCreateAction
    // shape, gated by permission (respects the Role editor ticks via crudSatisfied).
    const universalActions: ModuleCreateAction[] = BUTTON_BAR_ACTIONS
        .filter(canDo)
        .map((a) => ({
            label: a.label,
            subtitle: a.subtitle,
            icon: a.icon,
            module: a.module,
            variant: a.variant,
            href: a.href,
            newTab: a.newTab,
            action: a.action,
            pipelineRef: a.pipelineRef,
            permission: a.permission,
            disabled: a.disabled,
        }));

    // "More +" is now a normal gated entry in `actions` (permission quick-actions:more),
    // so it renders and hides through the same canDo filter as every other action.
    const actions = universalActions;

    return (
        <>
            <aside
                className="dark chrome-surface relative flex h-full flex-col border-l border-border-strong bg-surface-rail shrink-0 overflow-hidden text-foreground"
                style={{
                    width: isHidden ? 0 : collapsed ? 64 : barWidth,
                    transition: barDragging ? "none" : "width 0.3s ease, margin 0.3s ease",
                    // Peeking floats over the page: the layout keeps only the 64px rail.
                    ...(peeking ? { marginLeft: 64 - barWidth, zIndex: 40, boxShadow: "-4px 0 16px rgb(0 0 0 / 0.25)" } : null),
                }}
                onMouseEnter={onPeekEnter}
                onMouseLeave={onPeekLeave}
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
                                title={hoverMode ? "Keep action bar open" : "Open on mouse-over"}
                                onClick={() => setBarMode(hoverMode ? "expanded" : "hover")}
                                className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                            >
                                {hoverMode ? <Pin size={14} /> : <PanelRightOpen size={15} />}
                            </button>
                        ) : (

                            <button
                                type="button"
                                title={hoverMode ? "Keep action bar open" : "Collapse action bar"}
                                onClick={() => setBarMode(hoverMode ? "expanded" : "collapsed")}
                                className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
                            >
                                {hoverMode ? <Pin size={14} /> : <PanelRightClose size={14} />}
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
                            {/* Global create actions — includes the gated "More +" (first entry). */}
                            {actions.map((action) => {
                                const Icon = action.icon;
                                const resolvedHref = action.href ?? (action.action ? ACTION_HREFS[action.action] : undefined);
                                const isActive = !!(resolvedHref && pathname.startsWith(resolvedHref));

                                const rowClass = [
                                    "flex h-auto w-full items-center rounded-lg text-sm font-medium transition-all duration-150",
                                    collapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-2",
                                    action.disabled
                                        ? "cursor-not-allowed text-muted-foreground/65"
                                        : isActive
                                            ? ""
                                            : "text-muted-foreground hover:bg-muted hover:text-foreground",
                                ].join(" ");

                                // Each action wears its owning module's hue, so "Sale +" here and
                                // Accountancy in the sidebar are the same colour. The glyph carries
                                // it at rest; the whole row tints only when active.
                                const rowStyle = action.disabled
                                    ? undefined
                                    : isActive
                                        ? moduleActiveStyle(action.module)
                                        : undefined;

                                const inner = (
                                    <>
                                        <Icon
                                            size={17}
                                            className="shrink-0"
                                            style={action.disabled || isActive ? undefined : moduleIconStyle(action.module)}
                                        />
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
                                    const dialogKind = action.action ? GL_DIALOG_KIND_BY_ACTION[action.action] : undefined;
                                    return (
                                        <Link
                                            key={`${action.label}|${action.action ?? action.href ?? ""}`}
                                            href={resolvedHref}
                                            className={rowClass}
                                            style={rowStyle}
                                            title={titleAttr}
                                            // Plain left-click on a GL voucher opens it over the office;
                                            // modifier clicks keep the browser's own new-tab behaviour.
                                            onClick={dialogKind ? (e) => {
                                                if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
                                                e.preventDefault();
                                                openGlDialog(dialogKind);
                                            } : action.action && PARTY_FACING_TRADING.has(action.action) ? () => {
                                                // Same-tab navigation: hand the open profile to the form.
                                                stashPreloadParty(activeParty);
                                            } : undefined}
                                            onContextMenu={(e) => {
                                                e.preventDefault();
                                                openCtxMenu(e, resolvedHref);
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
                                        style={rowStyle}
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
                onOpenGlVoucher={openGlDialog}
            />
            <CreatePersonDialog open={personOpen} onOpenChange={setPersonOpen} />
            <CreateCompanyDialog open={companyOpen} onOpenChange={setCompanyOpen} />
            <HelpQuickForm open={helpOpen} onOpenChange={setHelpOpen} onSaved={() => { /* no list on-screen to refresh */ }} />
            <DealFormDialog open={dealOpen} onOpenChange={setDealOpen} positions={positions} deal={null} onSaved={() => { /* no list on-screen to refresh */ }} />
            <TaskFormDialog open={taskOpen} onOpenChange={setTaskOpen} positions={positions} task={null} onSaved={() => { /* no list on-screen to refresh */ }} />
            <LinkContextMenu menu={ctxMenu} onClose={closeCtxMenu} />
            <GlVoucherDialog kind={glDialogKind} initialParty={glDialogParty} onClose={() => setGlDialogKind(null)} />
        </>
    );
}
