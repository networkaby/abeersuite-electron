"use client";

import { Zap, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ACTION_TYPES } from "@/modules/repairing/lib/actionTypes";

const KIND_LABEL: Record<string, string> = {
    pipeline: "pipeline",
    status: "status",
    text: "text",
    schedule: "interval",
};

// Read-only catalog of action HOOKS. Actions are code hooks (not DB rows) — each an
// independent function with parameters (filled in on the worker) and an output. To
// USE one, attach it on a worker's Actions tab and supply its arguments there.
export default function ActionsPage() {
    return (
        <ScrollArea className="h-full" type="always">
            <div className="mx-auto max-w-4xl space-y-6 px-6 pt-3 pb-6">
                <div>
                    <h1 className="text-2xl font-bold">Actions</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        The available action hooks — reusable code functions a worker can run on Success / Unsuccess.
                        They&apos;re defined in code (read-only here); to use one, open a worker → <span className="font-medium">Actions</span> tab,
                        pick it, and fill its arguments there. New hooks are added in code (<code className="text-xs">actionTypes.ts</code> + <code className="text-xs">actions.ts</code>).
                    </p>
                </div>

                <div className="space-y-3">
                    {ACTION_TYPES.map((a) => (
                        <Card key={a.type}>
                            <CardHeader className="py-3">
                                <div className="flex items-center gap-3">
                                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700">
                                        <Zap size={12} />
                                    </span>
                                    <span className="text-sm font-medium">{a.label}</span>
                                    <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{a.type}</code>
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-2.5 pt-0 text-sm">
                                <p className="text-muted-foreground">{a.description}</p>
                                <div className="flex flex-wrap items-center gap-2 text-xs">
                                    <span className="font-medium text-foreground">Parameters:</span>
                                    {a.fields.length === 0 ? (
                                        <span className="text-muted-foreground">none</span>
                                    ) : (
                                        a.fields.map((f) => (
                                            <Badge key={f.key} variant="outline" className="font-normal">
                                                {f.label} <span className="ml-1 text-muted-foreground">· {KIND_LABEL[f.kind] ?? f.kind}</span>
                                            </Badge>
                                        ))
                                    )}
                                </div>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <ArrowRight size={12} className="shrink-0" />
                                    <span><span className="font-medium text-foreground">Output:</span> {a.output}</span>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </div>
        </ScrollArea>
    );
}
