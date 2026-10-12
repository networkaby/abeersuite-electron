"use client";

// Seats — the positions this person holds, appointed and vacated here.
//
// Positions themselves (their title, branch, department, the roles they carry)
// are DEFINED in Administration → Positions. HR only puts a person into one
// that already exists, or takes them out of it. Both go through the same
// `/api/positions/[id]/holders` routes the Positions screen uses, so a seat
// filled from HR is the same seat in every other screen.

import { useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { IdCard, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/shared/components/SearchableSelect";
import { useApiResource } from "@/shared/hooks";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { confirmAction } from "@/shared/lib/ui/confirmStore";
import { positionScopeLabel } from "@/shared/lib/org/positionScope";
import type { StaffDetail } from "../lib/staffTypes";

interface PositionRow {
    id: string;
    title: string;
    branch: { id: string; name: string } | null;
    department: { id: string; name: string } | null;
    parent?: { id: string; title: string } | null;
    roleTemplates?: { id: string; label: string; color: string }[];
}

export default function StaffSeatsCard({ detail, canEdit, onChanged }: {
    detail: StaffDetail;
    /** positions:edit — without it the seats are listed but not changeable. */
    canEdit: boolean;
    onChanged: () => void;
}) {
    const { user } = detail;
    const { data: positions } = useApiResource<PositionRow[]>(canEdit ? "/api/positions" : null, { topics: ["settings"] });
    const [busy, setBusy] = useState(false);
    const [picking, setPicking] = useState(false);

    const held = new Set(user.positions.map((p) => p.id));
    const options = useMemo(
        () => (positions ?? [])
            .filter((p) => !held.has(p.id))
            .map((p) => ({
                value: p.id,
                label: `${p.title} · ${positionScopeLabel(p, { withDepartment: true })}`,
                leaf:  p.title,
            })),
        // `held` is derived from user.positions; listing it would rebuild every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [positions, user.positions],
    );

    const appoint = async (positionId: string) => {
        setBusy(true);
        try {
            await axios.post(`/api/positions/${positionId}/holders`, { userId: user.id });
            toast.success("Appointed");
            setPicking(false);
            onChanged();
        } catch (e) {
            toast.error(extractApiError(e, "Could not appoint them"));
        } finally {
            setBusy(false);
        }
    };

    const vacate = async (positionId: string, title: string) => {
        const ok = await confirmAction({
            title: `Take ${user.name.split(" ")[0]} out of "${title}"?`,
            body: "Work already resolved to this seat stays where it is; nothing new will reach them through it. Their login and role are not touched.",
            confirmLabel: "Vacate the seat",
        });
        if (!ok) return;
        setBusy(true);
        try {
            await axios.delete(`/api/positions/${positionId}/holders/${user.id}`);
            toast.success("Seat vacated");
            onChanged();
        } catch (e) {
            toast.error(extractApiError(e, "Could not vacate the seat"));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="rounded-lg border border-border p-4">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-medium"><IdCard size={14} /> Seats</p>
                {canEdit && !picking && (
                    <Button type="button" size="sm" variant="outline" onClick={() => setPicking(true)} disabled={busy}>
                        <Plus size={14} /> Appoint to a position
                    </Button>
                )}
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
                Positions are set up in Administration; here you put the person into one.
            </p>

            {picking && (
                <div className="mb-3 flex flex-wrap items-center gap-2">
                    <SearchableSelect
                        value={null}
                        options={options}
                        onChange={(v) => v && appoint(String(v))}
                        placeholder={options.length ? "Search positions" : "No free position"}
                        ariaLabel="Position to appoint to"
                        triggerClassName="h-9 w-80 text-sm"
                    />
                    <Button type="button" size="sm" variant="ghost" onClick={() => setPicking(false)}>Cancel</Button>
                </div>
            )}

            {user.positions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No seat yet.</p>
            ) : (
                <ul className="space-y-2">
                    {user.positions.map((p) => {
                        const reportsTo = p.parent ? p.parent.title : "Executive Council";
                        const isExec = !p.parent;
                        return (
                            <li key={p.id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-medium text-sm text-foreground">{p.title}</span>
                                        <span className="text-xs text-muted-foreground">· {positionScopeLabel(p, { withDepartment: true })}</span>
                                    </div>
                                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                                        {p.roleTemplates && p.roleTemplates.length > 0 && (
                                            <div className="flex items-center gap-1">
                                                <span className="text-muted-foreground">Role{p.roleTemplates.length > 1 ? "s" : ""}:</span>
                                                {p.roleTemplates.map((r) => (
                                                    <Badge key={r.id} className={`${r.color} text-[10px] px-1.5 py-0`}>
                                                        {r.label}
                                                    </Badge>
                                                ))}
                                            </div>
                                        )}
                                        <div className="flex items-center gap-1 text-muted-foreground">
                                            <span>Reports to:</span>
                                            <span className={isExec ? "font-medium text-orange-600 dark:text-orange-400" : "font-medium text-foreground"}>
                                                {reportsTo}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                {canEdit && (
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => vacate(p.id, p.title)}
                                        disabled={busy}
                                        aria-label={`Vacate ${p.title}`}
                                        className="shrink-0 text-muted-foreground hover:text-destructive"
                                    >
                                        <X size={14} />
                                    </Button>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
