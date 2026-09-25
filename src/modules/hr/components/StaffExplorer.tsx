"use client";

// HR & People → Staff Directory, as a master-detail explorer — the same shape
// the Cash Book uses (see AccountLedgerExplorer): a narrow list of people on
// the left, the chosen person's profile filling the main area on the right.
//
// Every User is a staff member; the HR profile rides along once HR has saved
// something. One read, filtered and paged here (the list is the size of the
// staff, not the customer book), and it feeds both panes — the left list and
// the overview table are the same rows.
//
// The pick rides the URL as `?user=<id>` (replaced, not pushed — one row click
// per person should not pile up history), so a refresh or a shared link opens
// the same person. It is the only address for one person's HR profile —
// every "HR profile" link elsewhere points here.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Contact, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EntityListPanel } from "@/shared/components/EntityListPanel";
import { PositionChip } from "@/shared/components/PositionChip";
import { QueryStateBlock } from "@/shared/components/QueryStateBlock";
import { SearchableSelect } from "@/shared/components/SearchableSelect";
import UserAvatar from "@/shared/components/UserAvatar";
import UserForm from "@/shared/components/UserForm";
import { useApiResource, useRealtimeTopics } from "@/shared/hooks";
import { formatInr, formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { cn } from "@/shared/lib/format/utils";
import { staffHasLeft } from "@/shared/lib/hr/staffStatus";
import { staffLedgerStanding } from "@/shared/lib/hr/staffLedgerStanding";
import type { StaffRow } from "../lib/staffTypes";
import StaffTable from "./StaffTable";
import StaffProfileWorkspace from "./StaffProfileWorkspace";

type Status = "active" | "left" | "all";

export default function StaffExplorer({ selfId, canEdit, canCreateUsers, canEditUsers, canDeleteUsers, canEditPositions }: {
    /** The signed-in person — their own login cannot be deleted. */
    selfId: number | null;
    /** hr:staff:edit — the HR record itself. */
    canEdit: boolean;
    /** users:create — adding a person (the rule POST /api/users enforces). */
    canCreateUsers: boolean;
    /** users:edit — the login (name, email, password), role and manager on the Access tab. */
    canEditUsers: boolean;
    /** users:delete — deleting a login from the Access tab. */
    canDeleteUsers: boolean;
    /** positions:edit — appointing to and vacating a seat. */
    canEditPositions: boolean;
}) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const selectedId = Number(searchParams.get("user")) || null;

    // No `loading`: both panes are always mounted and say "Reading…" in their
    // own body, so there is no first-paint spinner to gate on.
    const { data, refreshing, error, reload } = useApiResource<StaffRow[]>("/api/hr/staff?includeLeft=1");
    // A profile saved or a user added elsewhere announces `settings`.
    useRealtimeTopics(["settings"], reload);

    const [q, setQ] = useState("");
    const [branchId, setBranchId] = useState<string | null>(null);
    const [departmentId, setDepartmentId] = useState<string | null>(null);
    const [status, setStatus] = useState<Status>("active");
    const [showForm, setShowForm] = useState(false);

    const rows = useMemo(() => data ?? [], [data]);

    const select = useCallback((userId: number | null) => {
        const next = new URLSearchParams(searchParams.toString());
        if (userId) next.set("user", String(userId));
        else next.delete("user");
        const qs = next.toString();
        router.replace(qs ? `/office/hr/staff?${qs}` : "/office/hr/staff", { scroll: false });
    }, [router, searchParams]);

    // Deleted from Admin → Users (or another tab): the open person was in the
    // last list and is not in this one, so go back to the directory instead of
    // leaving a profile that can only say "not found". Someone just added is in
    // neither list yet, so a fresh Add is never thrown out.
    const prevRows = useRef<StaffRow[] | undefined>(undefined);
    useEffect(() => {
        const before = prevRows.current;
        prevRows.current = data;
        if (!data || !before || !selectedId) return;
        if (before.some((r) => r.id === selectedId) && !data.some((r) => r.id === selectedId)) select(null);
    }, [data, selectedId, select]);

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

    const leftCount = rows.filter((r) => staffHasLeft(r.staffProfile)).length;

    return (
        <div className="flex h-full flex-col overflow-hidden bg-card">
            {/* No breadcrumb bar of our own — /office/hr's layout already puts
                "HR & People › Staff Directory" above us, and a second strip only
                repeats it. The person's name is the heading of the right pane. */}
            {showForm && (
                <UserForm
                    onClose={() => { setShowForm(false); reload(); }}
                    // A new person opens straight on their HR profile — the login is
                    // made; joining date and pay are what HR fills in next.
                    onSaved={(u) => select(u.id)}
                />
            )}

            {/* Master-detail row */}
            <div className="flex flex-1 overflow-hidden">
                <EntityListPanel
                    title="Staff"
                    icon={<Contact size={15} className="text-primary" />}
                    count={filtered.length}
                    search={q}
                    onSearchChange={setQ}
                    searchPlaceholder="Search name, email, phone, staff ID, seat"
                    onAdd={canCreateUsers ? () => setShowForm(true) : undefined}
                    addLabel="Add staff"
                    onTitleClick={selectedId ? () => select(null) : undefined}
                    isEmpty={filtered.length === 0}
                    emptyMessage={!data ? "Reading…" : rows.length === 0 ? "No staff yet — add the first person." : "Nobody matches these filters."}
                    toolbar={
                        <div className="mt-2 space-y-2">
                            {branchOptions.length > 1 && (
                                <SearchableSelect
                                    value={branchId}
                                    options={branchOptions}
                                    onChange={setBranchId}
                                    placeholder="All branches"
                                    ariaLabel="Filter by branch"
                                    triggerClassName="h-8 w-full text-sm"
                                />
                            )}
                            {departmentOptions.length > 1 && (
                                <SearchableSelect
                                    value={departmentId}
                                    options={departmentOptions}
                                    onChange={setDepartmentId}
                                    placeholder="All departments"
                                    ariaLabel="Filter by department"
                                    triggerClassName="h-8 w-full text-sm"
                                />
                            )}
                            <div role="group" aria-label="Staff status" className="flex gap-1">
                                {(["active", "left", "all"] as const).map((s) => (
                                    <Button
                                        key={s}
                                        type="button"
                                        size="sm"
                                        variant={status === s ? "default" : "outline"}
                                        aria-pressed={status === s}
                                        onClick={() => setStatus(s)}
                                        className="h-7 flex-1 px-1 text-xs"
                                    >
                                        {s === "active" ? "On the staff" : s === "left" ? "Left" : "Everyone"}
                                    </Button>
                                ))}
                            </div>
                        </div>
                    }
                >
                    {filtered.map((r) => {
                        const left = staffHasLeft(r.staffProfile);
                        return (
                            <button
                                key={r.id}
                                type="button"
                                onClick={() => select(r.id)}
                                className={cn(
                                    "w-full border-b px-3 py-2.5 text-left transition-colors hover:bg-muted/50",
                                    selectedId === r.id
                                        ? "border-l-2 border-l-primary bg-primary/10"
                                        : "border-l-2 border-l-transparent",
                                    left && "opacity-60",
                                )}
                            >
                                <div className="flex items-center gap-2.5">
                                    <UserAvatar avatarUrl={r.avatarUrl} name={r.name} role={r.role} sizePx={30} className="shrink-0" />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="truncate text-sm font-medium">{r.name}</span>
                                            {/* Where they stand on their own ledger — money owed to
                                                them, or an advance they are holding. It reads the
                                                top line because it is what changes; the pay below
                                                it is the same figure month after month. */}
                                            <StandingTag balance={r.ledger?.balance ?? 0} />
                                        </div>
                                        <div className="mt-0.5 flex min-w-0 items-center justify-between gap-2">
                                            <div className="flex min-w-0 items-center gap-1.5">
                                                {r.positions.length > 0 ? (
                                                    <PositionChip position={r.positions[0]} compact />
                                                ) : (
                                                    <span className="text-[11px] text-muted-foreground">No seat</span>
                                                )}
                                                {r.positions.length > 1 && (
                                                    <span className="shrink-0 text-[11px] text-muted-foreground">+{r.positions.length - 1}</span>
                                                )}
                                            </div>
                                            {/* Their pay — what they earn a month. Plain text, not
                                                a chip: the chip above is the thing to look at. */}
                                            {r.currentSalary && (
                                                <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                                                    {formatRupeesFromPaise(r.currentSalary.netPaise)}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </EntityListPanel>

                {/* ── Right section: the chosen person, or the whole directory ── */}
                <section className="flex flex-1 flex-col overflow-y-auto bg-muted/30">
                    {selectedId ? (
                        <>
                        <div className="px-6 pt-3">
                            <Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={() => select(null)}>
                                <ArrowLeft size={14} /> All staff
                            </Button>
                        </div>
                        <StaffProfileWorkspace
                            key={selectedId}
                            userId={selectedId}
                            selfId={selfId}
                            canEdit={canEdit}
                            canEditUsers={canEditUsers}
                            canDeleteUsers={canDeleteUsers}
                            canEditPositions={canEditPositions}
                            onDeleted={() => { select(null); reload(); }}
                        />
                        </>
                    ) : (
                        <div className="px-6 pt-4 pb-6">
                            <div className="mb-3 flex items-center gap-2">
                                <Users size={18} className="text-primary" />
                                <div>
                                    <h1 className="text-base font-semibold tracking-tight">Staff Directory</h1>
                                    {/* Never undefined: a subtitle that arrives with the data
                                        pushes everything below it down once the fetch lands. */}
                                    <p className="text-xs text-muted-foreground">
                                        {data
                                            ? `${rows.length - leftCount} on the staff${leftCount ? `, ${leftCount} left` : ""}${refreshing ? " · refreshing…" : ""}`
                                            : "Reading the staff…"}
                                    </p>
                                </div>
                            </div>

                            {/* Errors only. Swapping a centred spinner for the whole table is
                                the biggest jump on the page, so the table below is always
                                mounted and carries its own "Reading…" row instead. */}
                            {error && <QueryStateBlock loading={false} error={error} hasData={!!data} onRetry={reload} />}

                            <StaffTable
                                rows={filtered}
                                loaded={!!data}
                                emptyMessage={rows.length === 0 ? "No staff yet — add the first person." : "Nobody matches these filters."}
                                onSelect={select}
                            />
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}

/** The person's ledger standing as a small chip: what the shop owes them, or
 *  the advance they hold. A settled ledger is a dash, so rows keep one height. */
function StandingTag({ balance }: { balance: number }) {
    const { standing, amount, tag } = staffLedgerStanding(balance, formatInr);
    if (standing === "settled") return <span className="shrink-0 text-[11px] text-muted-foreground/65">—</span>;
    return (
        <span
            className={cn(
                "shrink-0 rounded px-1.5 py-px font-mono text-[11px] font-medium tabular-nums",
                standing === "payable"
                    ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                    : "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
            )}
            title={standing === "payable" ? "Owed to them" : "Advance they are holding"}
        >
            {formatInr(amount)} {tag}
        </span>
    );
}
