"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BUTTON_BAR_ACTIONS, type ButtonBarAction } from "@/utils/constants";
import { useQuickTicketStore } from "@/store/quickTicketStore";

type UserType = {
    name?: string | null;
    role?: string;
    roles?: string[];
    permissions?: string[];
};

type Pipeline = { id: string; isDefault: boolean; isActive: boolean };

export default function ButtonBar({ user }: { user?: UserType }) {
    const [defaultPipeline, setDefaultPipeline] = useState<Pipeline | null>(null);
    const { setOpen: openQuickTicket, setInitialPipelineId } = useQuickTicketStore();

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

    const handleAction = (action: ButtonBarAction) => {
        if (action.disabled) return;
        if (action.action === "new-ticket" && action.pipelineRef === "default" && defaultPipeline) {
            setInitialPipelineId(defaultPipeline.id);
            openQuickTicket(true);
        }
    };

    return (
        <aside className="flex w-52 flex-col border-l border-border bg-sidebar">
            {/* Header */}
            <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center bg-primary/10 text-primary">
                    <Zap size={14} />
                </div>
                <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">Quick Actions</p>
                    {user?.name && (
                        <p className="truncate text-xs text-muted-foreground">{user.name}</p>
                    )}
                </div>
            </div>

            {/* Action buttons */}
            <div className="flex-1 space-y-1.5 p-3">
                {BUTTON_BAR_ACTIONS.map((action) => {
                    const Icon = action.icon;
                    const isPrimary = action.variant === "default" && !action.disabled;

                    return (
                        <button
                            key={action.label}
                            type="button"
                            disabled={action.disabled}
                            onClick={() => handleAction(action)}
                            className={[
                                "group w-full border-2 border-border text-left transition-all duration-150",
                                action.disabled
                                    ? "cursor-not-allowed border-border bg-muted opacity-50"
                                    : isPrimary
                                        ? "border-primary/20 bg-primary/5 hover:border-primary/30 hover:bg-primary/10 active:scale-[0.98]"
                                        : "border-border bg-card hover:bg-muted active:scale-[0.98]",
                            ].join(" ")}
                        >
                            <div className="flex items-center gap-3 px-3 py-2.5">
                                {/* Icon */}
                                <div className={[
                                    "flex h-8 w-8 shrink-0 items-center justify-center transition-colors",
                                    action.disabled
                                        ? "bg-muted text-muted-foreground"
                                        : isPrimary
                                            ? "bg-primary text-primary-foreground shadow-sm"
                                            : "bg-muted text-muted-foreground group-hover:bg-accent group-hover:text-accent-foreground",
                                ].join(" ")}>
                                    <Icon size={15} />
                                </div>

                                {/* Label + subtitle */}
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5">
                                        <span className={[
                                            "block truncate text-sm font-semibold",
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
                                    <span className="block truncate text-xs text-muted-foreground">
                                        {action.subtitle}
                                    </span>
                                </div>
                            </div>
                        </button>
                    );
                })}
            </div>
        </aside>
    );
}
