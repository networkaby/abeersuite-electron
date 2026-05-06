"use client";

import Link from "next/link";
import { Grid2x2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { MODULE_SECTIONS, type ModuleCreateAction } from "@/utils/constants";
import { useQuickTicketStore } from "@/store/quickTicketStore";
import { useCreateDialogStore } from "@/store/createDialogStore";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    permissions: string[];
    isAdmin: boolean;
    defaultPipeline: { id: string } | null;
};

export default function AllCreateActionsDialog({ open, onOpenChange, permissions, isAdmin, defaultPipeline }: Props) {
    const { setOpen: openQuickTicket, setInitialPipelineId } = useQuickTicketStore();
    const { setPersonOpen, setCompanyOpen } = useCreateDialogStore();

    const canDo = (permission?: string | null) => {
        if (!permission) return true;
        return isAdmin || permissions.includes(permission);
    };

    const handleAction = (action: ModuleCreateAction) => {
        if (action.disabled) return;
        onOpenChange(false);
        if (action.action === "new-ticket" && action.pipelineRef === "default" && defaultPipeline) {
            setInitialPipelineId(defaultPipeline.id);
            openQuickTicket(true);
        } else if (action.action === "new-person") {
            setPersonOpen(true);
        } else if (action.action === "new-company") {
            setCompanyOpen(true);
        }
    };

    const modulesWithActions = MODULE_SECTIONS.filter(
        (m) => m.createActions && m.createActions.some((a) => canDo(a.permission))
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[80vh] max-w-xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Grid2x2 size={16} />
                        All Create Actions
                    </DialogTitle>
                </DialogHeader>

                <ScrollArea className="h-[70vh]">

                    <div className="space-y-5 pt-2">
                        {modulesWithActions.map((mod) => {
                            const visibleActions = (mod.createActions ?? []).filter((a) => canDo(a.permission));
                            if (!visibleActions.length) return null;

                            const ModIcon = mod.icon;

                            return (
                                <div key={mod.key}>
                                    <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                        <ModIcon size={12} />
                                        {mod.label}
                                    </div>
                                    <div className="grid grid-cols-3 gap-1.5">
                                        {visibleActions.map((action) => {
                                            const Icon = action.icon;
                                            const isPrimary = action.variant === "default";

                                            const inner = (
                                                <div className="flex items-center gap-2.5 px-3 py-2">
                                                    <div className={[
                                                        "flex h-7 w-7 shrink-0 items-center justify-center",
                                                        isPrimary
                                                            ? "bg-primary text-primary-foreground"
                                                            : "bg-muted text-muted-foreground",
                                                    ].join(" ")}>
                                                        <Icon size={13} />
                                                    </div>
                                                    <span className="truncate text-sm font-medium">{action.label}</span>
                                                </div>
                                            );

                                            if (action.href && !action.disabled) {
                                                return (
                                                    <Link
                                                        key={action.label}
                                                        href={action.href}
                                                        onClick={() => onOpenChange(false)}
                                                        className="rounded-md border border-border bg-card hover:bg-muted transition-colors"
                                                    >
                                                        {inner}
                                                    </Link>
                                                );
                                            }

                                            return (
                                                <Button
                                                    key={action.label}
                                                    type="button"
                                                    variant="ghost"
                                                    disabled={action.disabled}
                                                    onClick={() => handleAction(action)}
                                                    className="h-auto w-full rounded-md border border-border bg-card text-left hover:bg-muted"
                                                >
                                                    {inner}
                                                </Button>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <ScrollBar orientation="vertical" />
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
}
