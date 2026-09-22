"use client";

// The staff list as a table — the Staff Directory's overview pane.
//
// Presentational only: the rows arrive already filtered from StaffExplorer,
// which owns the one read and the search / filter boxes. Clicking a row picks
// that person in the explorer rather than navigating away.

import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import UserAvatar from "@/shared/components/UserAvatar";
import { PaginationBar } from "@/shared/components/PaginationBar";
import { PositionChip } from "@/shared/components/PositionChip";
import { TableEmptyRow } from "@/shared/components/DataTableStates";
import { useClientPagination } from "@/shared/hooks";
import { formatDate } from "@/shared/lib/format/formatDate";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { staffHasLeft } from "@/shared/lib/hr/staffStatus";
import { EMPLOYMENT_TYPE_LABELS, type EmploymentType } from "@/shared/lib/schemas/hrSchema";
import type { StaffRow } from "../lib/staffTypes";

export default function StaffTable({ rows, loaded, emptyMessage, onSelect }: {
    rows: StaffRow[];
    /** False until the first read lands — the table says "Reading…" in its own
     *  body rather than the pane swapping to a centred spinner. */
    loaded: boolean;
    emptyMessage: string;
    onSelect: (userId: number) => void;
}) {
    const { pageRows, page, setPage, pageSize, setPageSize, total } = useClientPagination(rows, 50);

    return (
        <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Person</TableHead>
                        <TableHead>Seats</TableHead>
                        <TableHead>Employment</TableHead>
                        <TableHead className="text-right">Net salary</TableHead>
                        <TableHead className="text-right">Status</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {!loaded && (
                        <TableRow>
                            <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                                Reading…
                            </TableCell>
                        </TableRow>
                    )}
                    {loaded && pageRows.length === 0 && <TableEmptyRow colSpan={5} message={emptyMessage} />}
                    {pageRows.map((r) => {
                        const left = staffHasLeft(r.staffProfile);
                        const type = r.staffProfile?.employmentType as EmploymentType | undefined;
                        return (
                            <TableRow
                                key={r.id}
                                onClick={() => onSelect(r.id)}
                                className={left ? "cursor-pointer opacity-60" : "cursor-pointer"}
                            >
                                {/* Person carries what used to be three thin columns: the
                                    staff ID beside the name, the phone beside the email.
                                    Neither earned a column of its own — both were empty
                                    for most of the staff. */}
                                <TableCell className="py-2.5">
                                    <div className="flex items-center gap-2.5">
                                        <UserAvatar avatarUrl={r.avatarUrl} name={r.name} role={r.role} sizePx={32} className="shrink-0" />
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium">{r.name}</span>
                                                {r.staffProfile?.staffCode && (
                                                    <span className="rounded bg-muted px-1.5 py-px font-mono text-[11px] text-muted-foreground">
                                                        {r.staffProfile.staffCode}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="truncate text-xs text-muted-foreground">
                                                {[r.email, r.phone].filter(Boolean).join("  ·  ")}
                                            </div>
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell className="py-2.5">
                                    {r.positions.length > 0 ? (
                                        <div className="flex max-w-xs flex-wrap gap-1.5">
                                            {/* Title only — branch, department and roles ride
                                                the tooltip, so one seat stays one line. */}
                                            {r.positions.map((p) => <PositionChip key={p.id} position={p} compact />)}
                                        </div>
                                    ) : (
                                        <span className="text-xs text-muted-foreground">No seat</span>
                                    )}
                                </TableCell>
                                <TableCell className="py-2.5 text-sm">
                                    {type || r.staffProfile?.joinedOn ? (
                                        <>
                                            <div>{type ? EMPLOYMENT_TYPE_LABELS[type] ?? type : "—"}</div>
                                            {r.staffProfile?.joinedOn && (
                                                <div className="text-xs text-muted-foreground">
                                                    since {formatDate(r.staffProfile.joinedOn)}
                                                </div>
                                            )}
                                        </>
                                    ) : <span className="text-muted-foreground">—</span>}
                                </TableCell>
                                <TableCell className="py-2.5 text-right font-medium tabular-nums">
                                    {r.currentSalary ? formatRupeesFromPaise(r.currentSalary.netPaise) : <span className="font-normal text-muted-foreground">—</span>}
                                </TableCell>
                                <TableCell className="py-2.5 text-right">
                                    {left ? (
                                        <Badge variant="outline" className="text-muted-foreground">
                                            Left {r.staffProfile?.leftOn ? formatDate(r.staffProfile.leftOn) : ""}
                                        </Badge>
                                    ) : r.staffProfile ? (
                                        <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300">Active</Badge>
                                    ) : (
                                        <Badge variant="outline" className="text-muted-foreground">No HR record yet</Badge>
                                    )}
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
            <PaginationBar
                total={total}
                page={page}
                pageSize={pageSize}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
                unitLabel="person"
                className="border-t border-border px-3 py-2"
            />
        </div>
    );
}
