"use client";

import { useState } from "react";
import { Check, ChevronDown, Lock } from "lucide-react";

// Generic permission matrix — rows × column-groups of single-permission cells.
// Each cell maps to one permission id (or null = N/A for that row). A cell can be
// granted (in `selected`), lockable (not offered by the dept pool via `locked`),
// or N/A. Used by the Role page for the GL voucher matrix; reusable for any
// per-row × per-action permission grid.

export interface MatrixColumn { key: string; label: string }
export interface MatrixColumnGroup { key: string; label: string; tint: ColumnTint; columns: MatrixColumn[] }
export interface MatrixRow { key: string; label: string; sublabel?: string; cells: Record<string, string | null> }

export type ColumnTint = "green" | "blue" | "amber" | "rose" | "red" | "gray";

const TINT_HEAD: Record<ColumnTint, string> = {
    green: "bg-emerald-100 dark:bg-emerald-950",
    blue:  "bg-blue-100 dark:bg-blue-950",
    amber: "bg-amber-100 dark:bg-amber-950",
    rose:  "bg-rose-100 dark:bg-rose-950",
    red:   "bg-red-100 dark:bg-red-950",
    gray:  "bg-muted",
};
const TINT_CELL: Record<ColumnTint, string> = {
    green: "bg-emerald-50/30 dark:bg-emerald-950/15",
    blue:  "bg-blue-50/30 dark:bg-blue-950/15",
    amber: "bg-amber-50/30 dark:bg-amber-950/15",
    rose:  "bg-rose-50/30 dark:bg-rose-950/15",
    red:   "bg-red-50/30 dark:bg-red-950/15",
    gray:  "bg-muted/20",
};

export function PermissionMatrix({
    title,
    description,
    rows,
    columnGroups,
    selected,
    onTogglePerm,
    locked,
    collapsible,
    defaultOpen = true,
}: {
    title?: string;
    description?: string;
    rows: MatrixRow[];
    columnGroups: MatrixColumnGroup[];
    selected: Set<string>;
    onTogglePerm: (permId: string) => void;
    /** Returns true when a permission is NOT offered by the active pool (locked). */
    locked?: (permId: string) => boolean;
    /** Renders the header as a toggle that collapses the table to save space. */
    collapsible?: boolean;
    /** Initial open state when `collapsible` is set. Defaults to expanded. */
    defaultOpen?: boolean;
}) {
    const flatColumns = columnGroups.flatMap((g) => g.columns.map((c) => ({ ...c, groupKey: g.key, tint: g.tint })));
    const [open, setOpen] = useState(defaultOpen);
    // Count of granted permissions among this matrix's own cells — shown in the
    // collapsed header so the state is visible without expanding.
    const grantedCount = rows.reduce(
        (count, row) => count + Object.values(row.cells).filter((permId): permId is string => permId != null && selected.has(permId)).length,
        0,
    );

    return (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
            {(title || description) && (
                collapsible ? (
                    <button
                        type="button"
                        onClick={() => setOpen((prev) => !prev)}
                        className="flex w-full items-start justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2 text-left hover:bg-muted/60"
                    >
                        <div>
                            {title && <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>}
                            {description && <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>}
                        </div>
                        <div className="flex shrink-0 items-center gap-2 pt-0.5">
                            <span className="text-[10px] font-medium text-muted-foreground">{grantedCount} granted</span>
                            <ChevronDown size={14} className={["text-muted-foreground transition-transform", open ? "rotate-180" : ""].join(" ")} />
                        </div>
                    </button>
                ) : (
                    <div className="border-b border-border bg-muted/40 px-3 py-2">
                        {title && <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>}
                        {description && <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>}
                    </div>
                )
            )}
            {(!collapsible || open) && (
                <div className="max-h-[68vh] overflow-auto">
                <table className="w-full text-xs">
                    <thead>
                        <tr className="border-b border-border bg-muted/20 text-[10px] uppercase tracking-wide text-muted-foreground">
                            <th className="sticky top-0 left-0 z-40 bg-muted px-3 py-1.5 text-left align-bottom font-semibold">Area</th>
                            {columnGroups.map((group) => (
                                <th
                                    key={group.key}
                                    colSpan={group.columns.length}
                                    className={["sticky top-0 z-20 border-l border-border px-2 py-1.5 text-center font-semibold", TINT_HEAD[group.tint]].join(" ")}
                                >
                                    {group.label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {rows.map((row) => (
                            <tr key={row.key} className="hover:bg-muted/30">
                                <td className="sticky left-0 z-10 bg-card px-3 py-2">
                                    <div className="font-medium text-foreground">{row.label}</div>
                                    {row.sublabel && <div className="text-[10px] text-muted-foreground">{row.sublabel}</div>}
                                </td>
                                {flatColumns.map((column) => {
                                    const permId = row.cells[column.key] ?? null;
                                    const isNA = permId == null;
                                    const isLocked = !isNA && (locked?.(permId) ?? false);
                                    const isOn = !isNA && !isLocked && selected.has(permId);
                                    const title = isNA
                                        ? "Not applicable"
                                        : isLocked
                                            ? "Not offered by this department's pool"
                                            : permId;
                                    return (
                                        <td key={column.key} className={["border-l border-border px-2 py-2 text-center", TINT_CELL[column.tint]].join(" ")}>
                                            {isNA || isLocked ? (
                                                <span
                                                    title={title}
                                                    className="mx-auto flex h-6 w-6 items-center justify-center border border-dashed border-border bg-muted/30 text-muted-foreground/40"
                                                >
                                                    {isLocked && <Lock size={10} />}
                                                </span>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => onTogglePerm(permId!)}
                                                    title={title}
                                                    className={[
                                                        "mx-auto flex h-6 w-6 items-center justify-center rounded-md border p-0 transition-colors",
                                                        isOn ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary/60 hover:bg-primary/5",
                                                    ].join(" ")}
                                                >
                                                    {isOn && <Check size={11} strokeWidth={3} />}
                                                </button>
                                            )}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            )}
        </div>
    );
}
