"use client";

import Link from "next/link";
import { Building2, Layers, Globe2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { PositionNode, OrgStructure } from "@/shared/types/orgChart";
import UserAvatar from "@/shared/components/UserAvatar";

// ── Avatar helpers ────────────────────────────────────────────────────────────

function HolderRow({ user }: { user: PositionNode["holders"][number]["user"] }) {
    return (
        <Link
            href={`/office/user/${user.id}`}
            className="flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-muted transition-colors"
        >
            <UserAvatar avatarUrl={user.avatarUrl} name={user.name} role={user.role} sizePx={20} className="border border-card" />
            <div className="text-left min-w-0">
                <p className="text-[11px] font-medium truncate leading-none">{user.name}</p>
                {user.userRole && (
                    <Badge className={`${user.userRole.color} text-[10px] px-1 py-0 mt-0.5`}>
                        {user.userRole.label}
                    </Badge>
                )}
            </div>
        </Link>
    );
}

// ── Position card ─────────────────────────────────────────────────────────────

function PositionCard({ node, orgWide }: { node: PositionNode; orgWide?: boolean }) {
    return (
        <div className={[
            "border-2 bg-card w-44 text-center px-3 py-2.5 shadow-sm rounded-sm shrink-0",
            orgWide ? "border-orange-400" : "border-border",
        ].join(" ")}>
            <p className="text-sm font-semibold leading-tight text-foreground">{node.title}</p>
            {node.holders.length === 0 ? (
                <p className="mt-2 text-[10px] text-muted-foreground italic">Vacant</p>
            ) : (
                <div className="mt-2 space-y-1">
                    {node.holders.map(h => <HolderRow key={h.user.id} user={h.user} />)}
                </div>
            )}
        </div>
    );
}

// ── Connector primitives ──────────────────────────────────────────────────────

function VLine({ h = 20 }: { h?: number }) {
    return <div className="w-px bg-border mx-auto" style={{ height: h }} />;
}

// Horizontal bar across N children, each `cellW` wide
function HBar({ count, cellW }: { count: number; cellW: number }) {
    if (count <= 1) return null;
    const totalW = count * cellW;
    const sideW  = cellW / 2;
    return (
        <div
            className="bg-border mx-auto"
            style={{ width: totalW - sideW * 2 + 1, height: 1, marginLeft: sideW - 0.5 }}
        />
    );
}

// ── Dept group card ───────────────────────────────────────────────────────────
// Dept label → connector → position cards in a row

const POSITION_CELL_W = 192; // px (w-44 = 176 + 16 gap)

function DeptGroup({ dept, positions }: { dept: { id: string; name: string } | null; positions: PositionNode[] }) {
    if (positions.length === 0) return null;

    const cellW  = POSITION_CELL_W;
    const totalW = positions.length * cellW;

    return (
        <div className="flex flex-col items-center" style={{ width: totalW }}>
            {/* Department label */}
            {dept && (
                <div className="flex items-center gap-1 border border-border bg-muted/60 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <Layers size={9} />
                    {dept.name}
                </div>
            )}
            <VLine h={12} />
            <HBar count={positions.length} cellW={cellW} />
            <div className="flex">
                {positions.map(p => (
                    <div key={p.id} className="flex flex-col items-center" style={{ width: cellW }}>
                        <VLine h={12} />
                        <PositionCard node={p} />
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── Branch node ───────────────────────────────────────────────────────────────

function BranchNode({ branch, deptGroups }: OrgStructure["branches"][number]) {
    const isEmpty = deptGroups.length === 0;

    // Calculate total width for centering the branch card above its children
    const totalPositionCount = deptGroups.reduce((s, g) => s + g.positions.length, 0);
    const contentW = Math.max(totalPositionCount * POSITION_CELL_W, POSITION_CELL_W);

    return (
        <div className="flex flex-col items-center" style={{ width: contentW }}>
            {/* Branch header card */}
            <div className="flex items-center gap-1.5 border-2 border-primary/60 bg-primary/5 rounded px-4 py-2 shadow-sm">
                <Building2 size={13} className="text-primary shrink-0" />
                <p className="text-sm font-bold text-primary whitespace-nowrap">{branch.name}</p>
            </div>

            {isEmpty ? (
                <p className="mt-3 text-[10px] text-muted-foreground italic">No positions</p>
            ) : (
                <>
                    <VLine h={16} />
                    {/* Dept groups side by side */}
                    <HBar count={deptGroups.length} cellW={deptGroups.length > 1 ? contentW / deptGroups.length : contentW} />
                    <div className="flex">
                        {deptGroups.map((g, i) => (
                            <DeptGroup key={g.dept?.id ?? `no-dept-${i}`} dept={g.dept} positions={g.positions} />
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

// ── Org-wide (Executive Council) row ─────────────────────────────────────────

function OrgWideRow({ positions }: { positions: PositionNode[] }) {
    const cellW  = POSITION_CELL_W;
    const totalW = positions.length * cellW;

    return (
        <div className="flex flex-col items-center">
            {/* Section label */}
            <div className="flex items-center gap-1.5 mb-3">
                <Globe2 size={12} className="text-orange-500" />
                <span className="text-[11px] font-bold uppercase tracking-widest text-orange-500">
                    Executive Council
                </span>
            </div>
            <HBar count={positions.length} cellW={cellW} />
            <div className="flex" style={{ width: totalW }}>
                {positions.map(p => (
                    <div key={p.id} className="flex flex-col items-center" style={{ width: cellW }}>
                        <VLine h={positions.length > 1 ? 12 : 0} />
                        <PositionCard node={p} orgWide />
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── Public component ──────────────────────────────────────────────────────────

export default function StructureTree({ structure }: { structure: OrgStructure }) {
    const { orgWidePositions, branches } = structure;
    const hasBranches = branches.length > 0;

    if (orgWidePositions.length === 0 && !hasBranches) return null;

    // Total width of the branches row for centering the org-wide section above
    const totalPositionsCount = branches.reduce(
        (s, bg) => s + Math.max(bg.deptGroups.reduce((ss, g) => ss + g.positions.length, 0), 1),
        0,
    );
    const branchRowW = Math.max(totalPositionsCount * POSITION_CELL_W, POSITION_CELL_W);

    return (
        <div className="overflow-auto pb-12">
            <div className="min-w-max pt-6 flex flex-col items-start">

                {/* ── Level 1: Executive Council ───────────────────────── */}
                {orgWidePositions.length > 0 && (
                    <div style={{ width: branchRowW }}>
                        <div className="flex justify-center">
                            <OrgWideRow positions={orgWidePositions} />
                        </div>
                        {hasBranches && (
                            <>
                                <VLine h={20} />
                                <div className="bg-border" style={{ height: 1, width: "100%" }} />
                            </>
                        )}
                    </div>
                )}

                {/* ── Level 2: Branches ────────────────────────────────── */}
                {hasBranches && (
                    <div className="flex gap-12 pt-0">
                        {branches.map(bg => (
                            <div key={bg.branch.id} className="flex flex-col items-center">
                                <VLine h={20} />
                                <BranchNode {...bg} />
                            </div>
                        ))}
                    </div>
                )}

            </div>
        </div>
    );
}
