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
            .catch(() => { });
    }, []);

    const handleAction = (action: ButtonBarAction) => {
        if (action.disabled) return;
        if (action.action === "new-ticket" && action.pipelineRef === "default" && defaultPipeline) {
            setInitialPipelineId(defaultPipeline.id);
            openQuickTicket(true);
        }
    };

    return (
        <aside className="flex w-46 flex-col border-l bg-white">
            {/* Header */}
            <div className="flex items-center gap-2.5 border-b px-4 py-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-600">
                    <Zap size={14} />
                </div>
                <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-800">Quick Actions</p>
                    {user?.name && (
                        <p className="truncate text-xs text-gray-400">{user.name}</p>
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
                                "group w-full rounded-xl border text-left transition-all duration-150",
                                action.disabled
                                    ? "cursor-not-allowed border-gray-100 bg-gray-50 opacity-60"
                                    : isPrimary
                                        ? "border-blue-200 bg-blue-50 hover:border-blue-300 hover:bg-blue-100 active:scale-[0.98]"
                                        : "border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50 active:scale-[0.98]",
                            ].join(" ")}
                        >
                            <div className="flex items-center gap-3 px-3 py-2.5">
                                {/* Icon badge */}
                                <div
                                    className={[
                                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                                        action.disabled
                                            ? "bg-gray-100 text-gray-400"
                                            : isPrimary
                                                ? "bg-blue-600 text-white shadow-sm"
                                                : "bg-gray-100 text-gray-500 group-hover:bg-gray-200",
                                    ].join(" ")}
                                >
                                    <Icon size={15} />
                                </div>

                                {/* Label + subtitle */}
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5">
                                        <span
                                            className={[
                                                "block truncate text-sm font-semibold",
                                                action.disabled
                                                    ? "text-gray-400"
                                                    : isPrimary
                                                        ? "text-blue-700"
                                                        : "text-gray-700",
                                            ].join(" ")}
                                        >
                                            {action.label}
                                        </span>
                                        {action.disabled && (
                                            <Badge
                                                variant="secondary"
                                                className="h-4 shrink-0 px-1.5 text-[10px]"
                                            >
                                                Soon
                                            </Badge>
                                        )}
                                    </div>
                                    <span className="block truncate text-xs text-gray-400">
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
