"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQuickTicketStore } from "@/store/quickTicketStore";

type UserType = {
    name?: string | null;
    role?: string;
    roles?: string[];
    permissions?: string[];
};

type PipelineOption = {
    id: string;
    label: string;
    color: string;
    isActive: boolean;
    isDefault: boolean;
};

function colorDot(color: string) {
    return color.split(" ")[0];
}

export default function ButtonBar({ user }: { user?: UserType }) {
    const [pipelines, setPipelines] = useState<PipelineOption[]>([]);
    const { setOpen: openQuickTicket, setInitialPipelineId } = useQuickTicketStore();

    useEffect(() => {
        axios.get<PipelineOption[]>("/api/pipelines")
            .then((response) => {
                setPipelines(response.data.filter((pipeline) => pipeline.isActive));
            })
            .catch(() => {
                setPipelines([]);
            });
    }, []);

    const handleNewTicket = (pipelineId: string) => {
        setInitialPipelineId(pipelineId);
        openQuickTicket(true);
    };

    return (
        <aside className="w-52 border-l bg-white">
            <div className="border-b p-4">
                <h2 className="text-sm font-semibold text-gray-700">Actions</h2>
                <p className="truncate text-xs text-gray-400">{user?.name}</p>
            </div>

            <div className="space-y-2 p-3">
                {pipelines.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-center text-xs text-gray-400">
                        No active ticket actions
                    </p>
                ) : (
                    pipelines.map((pipeline) => (
                        <Button
                            key={pipeline.id}
                            type="button"
                            variant={pipeline.isDefault ? "default" : "outline"}
                            className="h-auto w-full items-start justify-start gap-3 px-3 py-3 text-left"
                            onClick={() => handleNewTicket(pipeline.id)}
                        >
                            <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${colorDot(pipeline.color)}`} />
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium">
                                    New {pipeline.label}
                                </span>
                                <span className="mt-0.5 block truncate text-xs opacity-70">
                                    Open ticket intake
                                </span>
                            </span>
                            <Ticket size={16} className="mt-0.5 shrink-0" />
                        </Button>
                    ))
                )}
            </div>
        </aside>
    );
}
