"use client";

// HR & People → Staff Directory. Every User is a staff member; the HR profile
// rides along once HR has saved something. One read, filtered and paged here
// (the list is the size of the staff, not the customer book).

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Contact, Plus, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import UserAvatar from "@/shared/components/UserAvatar";
import UserForm from "@/shared/components/UserForm";
import { DataPageHeader } from "@/shared/components/DataPageHeader";
import { PaginationBar } from "@/shared/components/PaginationBar";
import { PositionChip } from "@/shared/components/PositionChip";
import { QueryStateBlock } from "@/shared/components/QueryStateBlock";
import { TableEmptyRow } from "@/shared/components/DataTableStates";
import { SearchableSelect } from "@/shared/components/SearchableSelect";
import { useApiResource, useClientPagination, useRealtimeTopics } from "@/shared/hooks";
import { formatDate } from "@/shared/lib/format/formatDate";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { staffHasLeft } from "@/shared/lib/hr/staffStatus";
import { EMPLOYMENT_TYPE_LABELS, type EmploymentType } from "@/shared/lib/schemas/hrSchema";
import type { StaffRow } from "../lib/staffTypes";

type Status = "active" | "left" | "all";

export default function StaffDirectory({ canEdit }: { canEdit: boolean }) {
    const router = useRouter();
    // No `loading`: the table is always mounted and says "Reading…" in its own
    // body, so there is no first-paint spinner to gate on.
    const { data, refreshing, error, reload } = useApiResource<StaffRow[]>("/api/hr/staff?includeLeft=1");
    // A profile saved or a user added elsewhere announces `settings`.
    useRealtimeTopics(["settings"], reload);

    const [q, setQ] = useState("");
    const [branchId, setBranchId] = useState<string | null>(null);
    const [departmentId, setDepartmentId] = useState<string | null>(null);
    const [status, setStatus] = useState<Status>("active");
    const [showForm, setShowForm] = useState(false);

    const rows = useMemo(() => data ?? [], [data]);

    // Filter options come from the rows themselves — no second fetch for a
    // handful of branches and departments.
    const branchOptions = useMemo(() => {
        const m = new Map<string, string>();
        for (const r of rows) for (const b of r.branches) m.set(b.id, b.name);
        return [...m].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
    }, [rows]);
    const departmentOptions = useMemo(() => {
        const m = new Map<string, string>();
        for (const r of rows) for (const d of r.departments) m.set(d.id, d.name);
        return [...m].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
    }, [rows]);

    const filtered = useMemo(() => {
        const needle = q.trim().toLowerCase();
        return rows.filter((r) => {
            const left = staffHasLeft(r.staffProfile);
            if (status === "active" && left) return false;
            if (status === "left" && !left) return false;
            if (branchId && !r.branches.some((b) => b.id === branchId)) return false;
            if (departmentId && !r.departments.some((d) => d.id === departmentId)) return false;
            if (!needle) return true;
            const hay = [r.name, r.email, r.phone ?? "", r.staffProfile?.staffCode ?? "", ...r.positions.map((p) => p.title)]
                .join(" ").toLowerCase();
            return hay.includes(needle);
        });
    }, [rows, q, status, branchId, departmentId]);

    const { pageRows, page, setPage, pageSize, setPageSize, total } = useClientPagination(filtered, 50);

    const leftCount = rows.filter((r) => staffHasLeft(r.staffProfile)).length;

    return (
        <ScrollArea className="h-full" type="always">
            <div className="px-6 pt-3 pb-6">
                <DataPageHeader
                    title="Staff Directory"
                    // Never undefined: a subtitle that arrives with the data pushes
                    // everything below it down once the fetch lands.
                    subtitle={data
                        ? `${rows.length - leftCount} on the staff${leftCount ? `, ${leftCount} left` : ""}${refreshing ? " · refreshing…" : ""}`
                        : "Reading the staff…"}
                    icon={<Contact size={20} />}
                    actions={canEdit ? (
                        <Button type="button" onClick={() => setShowForm(true)}>
                            <Plus size={16} /> Add staff
                        </Button>
                    ) : null}
                />

                {showForm && (
                    <UserForm
                        onClose={() => { setShowForm(false); reload(); }}
                        // A new person goes straight to their HR profile — the login is
                        // made; joining date and pay are what HR fills in next.
                        onSaved={(u) => router.push(`/office/hr/staff/${u.id}`)}
                    />
                )}

                <div className="mb-3 flex flex-wrap items-center gap-2">
                    <div className="relative">
                        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                        <Input
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                            placeholder="Search name, email, phone, staff ID, seat"
                            aria-label="Search staff"
                            className="h-9 w-72 pl-8 text-sm"
                        />
                    </div>
                    {branchOptions.length > 1 && (
                        <SearchableSelect
                            value={branchId}
                            options={branchOptions}
                            onChange={setBranchId}
                            placeholder="All branches"
                            ariaLabel="Filter by branch"
                            triggerClassName="h-9 text-sm"
                        />
                    )}
                    {departmentOptions.length > 1 && (
                        <SearchableSelect
                            value={departmentId}
                            options={departmentOptions}
                            onChange={setDepartmentId}
                            placeholder="All departments"
                            ariaLabel="Filter by department"
                            triggerClassName="h-9 text-sm"
                        />
                    )}
                    <div role="group" aria-label="Staff status" className="ml-auto flex gap-1">
                        {(["active", "left", "all"] as const).map((s) => (
                            <Button
                                key={s}
                                type="button"
                                size="sm"
                                variant={status === s ? "default" : "outline"}
                                aria-pressed={status === s}
                                onClick={() => setStatus(s)}
                            >
                                {s === "active" ? "On the staff" : s === "left" ? "Left" : "Everyone"}
                            </Button>
                        ))}
                    </div>
                </div>

                {/* Errors only. Swapping a centred spinner for the whole table is
                    the biggest jump on the page, so the table below is always
                    mounted and carries its own "Reading…" row instead. */}
                {error && <QueryStateBlock loading={false} error={error} hasData={!!data} onRetry={reload} />}

                <div className="overflow-x-auto rounded-lg border border-border shadow-sm">
                        {/* No `min-w-max`: this sits inside a ScrollArea whose viewport hides
                            horizontal overflow, so a table sized to its own content pushes the
                            page wider than the visible area and the excess is simply clipped —
                            63px of the Staff Directory was unreachable that way. The wrapper's
                            own overflow-x-auto is what scrolls if the columns ever need it. */}
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
                                {!data && (
                                    <TableRow>
                                        <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                                            Reading…
                                        </TableCell>
                                    </TableRow>
                                )}
                                {data && pageRows.length === 0 && (
                                    <TableEmptyRow colSpan={5} message={rows.length === 0 ? "No staff yet — add the first person." : "Nobody matches these filters."} />
                                )}
                                {pageRows.map((r) => {
                                    const left = staffHasLeft(r.staffProfile);
                                    const type = r.staffProfile?.employmentType as EmploymentType | undefined;
                                    return (
                                        <TableRow key={r.id} className={left ? "opacity-60" : undefined}>
                                            {/* Person carries what used to be three thin columns: the
                                                staff ID beside the name, the phone beside the email.
                                                Neither earned a column of its own — both were empty
                                                for most of the staff. */}
                                            <TableCell className="py-2.5">
                                                <Link href={`/office/hr/staff/${r.id}`} className="group flex items-center gap-2.5">
                                                    <UserAvatar avatarUrl={r.avatarUrl} name={r.name} role={r.role} sizePx={32} className="shrink-0" />
                                                    <div className="min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-medium transition-colors group-hover:text-primary">{r.name}</span>
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
                                                </Link>
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
            </div>
        </ScrollArea>
    );
}
