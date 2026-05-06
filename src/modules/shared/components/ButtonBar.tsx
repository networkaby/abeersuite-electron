"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import axios from "axios";
import { ChevronLeft, ChevronRight, Zap, Grid2x2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BUTTON_BAR_ACTIONS, type ModuleCreateAction } from "@/utils/constants";
import { getActiveModule } from "@/utils/active-module";
import { useQuickTicketStore } from "@/store/quickTicketStore";
import { useCreateDialogStore } from "@/store/createDialogStore";
import CreatePersonDialog from "@/modules/shared/components/CreatePersonDialog";
import CreateCompanyDialog from "@/modules/shared/components/CreateCompanyDialog";
import AllCreateActionsDialog from "@/modules/shared/components/AllCreateActionsDialog";
import { ScrollArea } from "@/components/ui/scroll-area";

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

    const permissions = user?.permissions ?? [];
    const isAdmin = permissions.includes("admin:bypass");

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
        }
    };

    const headerLabel = activeModule ? activeModule.label : "Quick Actions";

    // For universal (no active module) fall back to BUTTON_BAR_ACTIONS rendered as ModuleCreateAction shape
    const universalActions: ModuleCreateAction[] = BUTTON_BAR_ACTIONS.map((a) => ({
        label: a.label,
        subtitle: a.subtitle,
        icon: a.icon,
        variant: a.variant,
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

                {/* Action buttons */}
                <ScrollArea className="flex-1 min-h-0">
                    <div className="space-y-1 p-2">
                        {/* More + button — always first */}
                        <Button
                            type="button"
                            title={collapsed ? "More actions" : "More — all create actions"}
                            onClick={() => setMoreOpen(true)}
                            variant="ghost"
                            className={[
                                "group h-auto w-full rounded-md border border-dashed border-border text-left transition-all duration-150",
                                collapsed ? "px-0" : "",
                                "bg-card hover:border-solid hover:border-primary/30 hover:bg-muted active:scale-[0.98]",
                            ].join(" ")}
                        >
                            <div className={`flex items-center px-2 py-1.5 ${collapsed ? "justify-center" : "gap-2"}`}>
                                <div className="flex h-7 w-7 shrink-0 items-center justify-center bg-muted text-muted-foreground transition-colors group-hover:bg-accent group-hover:text-accent-foreground">
                                    <Grid2x2 size={14} />
                                </div>
                                {!collapsed && (
                                    <span className="block truncate text-sm font-semibold text-foreground">
                                        More +
                                    </span>
                                )}
                            </div>
                        </Button>

                        {/* Module-specific or universal create actions */}
                        {actions.map((action) => {
                            const Icon = action.icon;
                            const isPrimary = action.variant === "default" && !action.disabled;
                            const inner = (
                                <div className={`flex items-center px-2 py-1.5 ${collapsed ? "justify-center" : "gap-2"}`}>
                                    <div className={[
                                        "flex h-7 w-7 shrink-0 items-center justify-center transition-colors",
                                        action.disabled
                                            ? "bg-muted text-muted-foreground"
                                            : isPrimary
                                                ? "bg-primary text-primary-foreground shadow-sm"
                                                : "bg-muted text-muted-foreground group-hover:bg-accent group-hover:text-accent-foreground",
                                    ].join(" ")}>
                                        <Icon size={14} />
                                    </div>
                                    {!collapsed && (
                                        <div className="flex min-w-0 flex-1 items-center gap-1.5">
                                            <span className={[
                                                "block truncate text-sm font-medium",
                                                action.disabled
                                                    ? "text-muted-foreground"
                                                    : isPrimary
                                                        ? "text-primary"
                                                        : "text-foreground",
                                            ].join(" ")}>
                                                {action.label}
                                            </span>
                                            {action.disabled && (
                                                <Badge variant="secondary" className="h-4 shrink-0 px-1.5 text-[10px]">
                                                    Soon
                                                </Badge>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );

                            const buttonClass = [
                                "group h-auto w-full rounded-md border text-left transition-all duration-150",
                                collapsed ? "px-0" : "",
                                action.disabled
                                    ? "cursor-not-allowed border-border bg-muted opacity-50"
                                    : isPrimary
                                        ? "border-primary/20 bg-primary/5 hover:border-primary/30 hover:bg-primary/10 active:scale-[0.98]"
                                        : "border-border bg-card hover:bg-muted active:scale-[0.98]",
                            ].join(" ");

                            if (action.href && !action.disabled) {
                                return (
                                    <Link
                                        key={action.label}
                                        href={action.href}
                                        className={buttonClass}
                                        title={collapsed ? action.label : `${action.label} — ${action.subtitle}`}
                                    >
                                        {inner}
                                    </Link>
                                );
                            }

                            return (
                                <Button
                                    key={action.label}
                                    type="button"
                                    title={collapsed ? action.label : `${action.label} — ${action.subtitle}`}
                                    disabled={action.disabled}
                                    onClick={() => handleAction(action)}
                                    variant="ghost"
                                    className={buttonClass}
                                >
                                    {inner}
                                </Button>
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
