"use client";

// Region-based hierarchy view with nested bordered containers.
// Light theme; uses theme tokens so it works in both light/dark mode.
//
// Structure:
//   ┌── HEADQUARTERS (gold border) ────────────────────────┐
//   │  Board · CEO · C-Level · Central Departments         │
//   │  (combines org-wide posts AND posts at BR-HQ branch) │
//   └──────────────────────────────┬───────────────────────┘
//                                  │   ← vertical connector
//          ┌───────────────┬───────┴───────┬───────────────┐
//      [Branch 1]      [Branch 2]      [Branch 3]      [Branch 4]
//      (regional branches — BR-HQ excluded since it's the HQ)
//
// The HQ container is identified as the branch with id === "BR-HQ" (the
// bootstrap-seeded Headquarters branch). All other branches are regional.

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Crown, Building2, Briefcase, Users, AlertCircle, Landmark } from "lucide-react";
import type { OrgStructure, PositionNode } from "@/shared/types/orgChart";

// Branch ID that maps to "Headquarters" — bootstrap seeds this one.
// All posts at this branch + all org-wide posts go inside the HQ container.
const HQ_BRANCH_ID = "BR-HQ";

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string) {
    return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

const AVATAR_COLOR: Record<string, string> = {
    R1: "bg-purple-100 text-purple-700",
    R2: "bg-blue-100 text-blue-700",
    R3: "bg-green-100 text-green-700",
    R4: "bg-orange-100 text-orange-700",
};

function Avatar({ user, size = 32 }: { user: PositionNode["holders"][number]["user"]; size?: number }) {
    const [imgErr, setImgErr] = useState(false);
    if (user.avatarUrl && !imgErr) {
        return (
            <Image
                src={user.avatarUrl} alt={user.name} width={size} height={size}
                style={{ width: size, height: size }}
                className="rounded-full object-cover ring-2 ring-white/40 shrink-0"
                onError={() => setImgErr(true)}
            />
        );
    }
    const cls = user.role ? (AVATAR_COLOR[user.role] ?? "bg-gray-200 text-gray-700") : "bg-gray-200 text-gray-700";
    return (
        <div
            style={{ width: size, height: size, fontSize: size * 0.4 }}
            className={`flex shrink-0 items-center justify-center rounded-full font-bold ring-2 ring-white/60 ${cls}`}
        >
            {initials(user.name)}
        </div>
    );
}

// ── Position card ────────────────────────────────────────────────────────────

interface PosCardProps {
    position: PositionNode;
    accent: "gold" | "blue" | "green";
}

const POS_CARD_STYLES: Record<PosCardProps["accent"], { card: string; name: string; title: string; avatar: string; icon: React.ReactNode }> = {
    gold:  { card: "bg-amber-50 dark:bg-amber-950/30 border-amber-400 hover:border-amber-500",     name: "text-amber-900 dark:text-amber-200",   title: "text-amber-700/70 dark:text-amber-300/60",   avatar: "bg-amber-200 dark:bg-amber-900/40",  icon: <Landmark size={18} className="text-amber-600 dark:text-amber-300" /> },
    blue:  { card: "bg-sky-50 dark:bg-sky-950/30 border-sky-400 hover:border-sky-500",             name: "text-sky-900 dark:text-sky-200",       title: "text-sky-700/70 dark:text-sky-300/60",       avatar: "bg-sky-200 dark:bg-sky-900/40",      icon: <Crown size={18} className="text-sky-600 dark:text-sky-300" /> },
    green: { card: "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-400 hover:border-emerald-500", name: "text-emerald-900 dark:text-emerald-200", title: "text-emerald-700/70 dark:text-emerald-300/60", avatar: "bg-emerald-200 dark:bg-emerald-900/40", icon: <Briefcase size={18} className="text-emerald-600 dark:text-emerald-300" /> },
};

function PosCard({ position, accent, compact = false }: PosCardProps & { compact?: boolean }) {
    const s = POS_CARD_STYLES[accent];
    const holder = position.holders[0];
    const vacant = !holder;
    const w = compact ? "w-[88px]" : "w-[120px]";
    const px = compact ? "px-1.5" : "px-2";
    const py = compact ? "py-1.5" : "py-2.5";
    const avatarBox = compact ? "w-8 h-8" : "w-10 h-10";
    const avatarSize = compact ? 28 : 36;
    const nameSize = compact ? "text-[10px]" : "text-[11px]";
    const titleSize = compact ? "text-[8.5px]" : "text-[9px]";
    const card = (
        <div className={`flex flex-col items-center ${w} ${px} ${py} rounded-md border shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${s.card}`}>
            <div className={`flex items-center justify-center ${avatarBox} rounded-full mb-1 ring-2 ring-white/60 ${s.avatar}`}>
                {holder ? <Avatar user={holder.user} size={avatarSize} /> : s.icon}
            </div>
            <p className={`${nameSize} font-bold text-center leading-tight ${s.name} truncate w-full`} title={holder?.user.name ?? position.title}>
                {holder?.user.name ?? position.title}
            </p>
            <p className={`${titleSize} text-center mt-0.5 leading-tight ${s.title} truncate w-full`} title={holder ? position.title : "Vacant"}>
                {holder ? position.title : "Vacant"}
            </p>
            {vacant && !compact && (
                <span className="mt-1 inline-flex items-center gap-0.5 rounded bg-amber-200 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300 px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-wider">
                    <AlertCircle size={8} /> Vacant
                </span>
            )}
            {!vacant && position.holders.length > 1 && (
                <span className="mt-0.5 text-[9px] text-muted-foreground">+{position.holders.length - 1}</span>
            )}
        </div>
    );
    return holder ? (
        <Link href={`/office/social/users/${holder.user.id}`} className="block">{card}</Link>
    ) : card;
}

// ── Section label inside a container ─────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex items-center justify-center my-3">
            <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">
                {children}
            </span>
        </div>
    );
}

// ── Dept sub-container ───────────────────────────────────────────────────────

function DeptBox({ name, posts }: { name: string; posts: PositionNode[] }) {
    return (
        <div className="rounded-md border border-emerald-300 dark:border-emerald-700/50 bg-emerald-50/40 dark:bg-emerald-950/15 px-1.5 py-1.5">
            <p className="text-[9px] uppercase tracking-wider text-center font-bold mb-1 text-emerald-700 dark:text-emerald-300">
                {name}
            </p>
            <div className="flex flex-wrap justify-center gap-1">
                {posts.map(p => <PosCard key={p.id} position={p} accent="green" compact />)}
            </div>
        </div>
    );
}

// ── Branch container ─────────────────────────────────────────────────────────

function BranchContainer({ bg }: { bg: OrgStructure["branches"][number] }) {
    const allPositions = bg.deptGroups.flatMap(g => g.positions);
    const branchManagerPosition = allPositions.find((p: PositionNode) =>
        p.title.toLowerCase().includes("manager") || p.title.toLowerCase().includes("incharge"),
    );
    const otherDeptGroups = bg.deptGroups.filter(g => !g.positions.some(p => p.id === branchManagerPosition?.id));
    const noDeptGroup = bg.deptGroups.find(g => !g.dept);
    const restNonMgrInNoDept = noDeptGroup
        ? noDeptGroup.positions.filter((p: PositionNode) => p.id !== branchManagerPosition?.id)
        : [];

    return (
        <div className="relative rounded-lg border border-emerald-400 dark:border-emerald-600 bg-emerald-50/50 dark:bg-emerald-950/20 px-2.5 pt-5 pb-2.5 w-[210px] shadow-sm">
            {/* Branch name pill */}
            <div className="flex justify-center -mt-7 mb-2">
                <div className="rounded border border-emerald-500 dark:border-emerald-600 bg-card px-2 py-0.5 shadow-sm">
                    <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                        <Building2 size={9} /> {bg.branch.name}
                    </p>
                </div>
            </div>

            {/* Branch Manager (highlighted at top) */}
            {branchManagerPosition && (
                <>
                    <div className="flex justify-center mb-2">
                        <PosCard position={branchManagerPosition} accent="green" compact />
                    </div>
                    {(otherDeptGroups.length > 0 || restNonMgrInNoDept.length > 0) && (
                        <div className="h-px bg-emerald-300/60 dark:bg-emerald-700/40 my-1.5" />
                    )}
                </>
            )}

            {/* Branch-level posts (no dept) other than the manager */}
            {restNonMgrInNoDept.length > 0 && (
                <div className="flex flex-wrap justify-center gap-1 mb-2">
                    {restNonMgrInNoDept.map(p => <PosCard key={p.id} position={p} accent="green" compact />)}
                </div>
            )}

            {/* Dept sub-boxes */}
            {otherDeptGroups.filter(g => g.dept).length > 0 && (
                <div className="grid grid-cols-2 gap-1.5">
                    {otherDeptGroups
                        .filter(g => g.dept)
                        .map((g, i) => (
                            <DeptBox key={g.dept!.id + i} name={g.dept!.name} posts={g.positions} />
                        ))}
                </div>
            )}

            {allPositions.length === 0 && (
                <p className="text-[10px] text-muted-foreground italic text-center py-3">No positions</p>
            )}
        </div>
    );
}

// ── HQ container (board + executives + central depts) ────────────────────────

function HQContainer({
    orgWidePosts,
    hqBranchPosts,
    hqBranchName,
}: {
    orgWidePosts: PositionNode[];
    hqBranchPosts: PositionNode[];
    hqBranchName: string;
}) {
    // Merge org-wide + HQ-branch posts so the HQ container holds everything
    const allHqPosts = [...orgWidePosts, ...hqBranchPosts];

    if (allHqPosts.length === 0) {
        return (
            <div className="relative rounded-xl border-2 border-amber-400 dark:border-amber-500 bg-amber-50/50 dark:bg-amber-950/20 p-6 min-w-[400px] text-center shadow-sm">
                <div className="flex justify-center -mt-9 mb-3">
                    <div className="rounded-lg border border-amber-500 bg-card px-4 py-1 shadow-md">
                        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-amber-700 dark:text-amber-300">
                            <Landmark size={12} /> {hqBranchName}
                        </p>
                    </div>
                </div>
                <p className="text-[11px] text-amber-700/60 dark:text-amber-300/60 italic">
                    No HQ positions yet — create org-wide positions (branchId = null) or assign positions to {hqBranchName}
                </p>
            </div>
        );
    }

    // Classify posts by title patterns
    const boardPosts: PositionNode[] = [];
    const ceoPosts: PositionNode[]   = [];
    const cLevelPosts: PositionNode[] = [];
    const centralDeptPosts: PositionNode[] = [];

    for (const p of allHqPosts) {
        const t = p.title.toLowerCase();
        if (/\b(chairman|chairperson|independent director|board director|board member)\b/.test(t)) {
            boardPosts.push(p);
        } else if (/^(chief executive|ceo|managing director|md)\b/.test(t) || /\bceo\b/.test(t)) {
            ceoPosts.push(p);
        } else if (/^(cfo|cto|coo|cio|cmo|cso|chief)/.test(t) || /\b(c[a-z]o)\b/.test(t)) {
            cLevelPosts.push(p);
        } else {
            centralDeptPosts.push(p);
        }
    }

    const classifiedCount = boardPosts.length + ceoPosts.length + cLevelPosts.length;
    const singleSection = classifiedCount === 0;

    return (
        <div className="relative rounded-xl border-2 border-amber-400 dark:border-amber-500 bg-amber-50/50 dark:bg-amber-950/20 p-5 min-w-[400px] shadow-sm">
            {/* Header pill */}
            <div className="flex justify-center -mt-9 mb-2">
                <div className="rounded-lg border border-amber-500 bg-card px-4 py-1 shadow-md">
                    <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-amber-700 dark:text-amber-300">
                        <Landmark size={12} /> {hqBranchName}
                    </p>
                </div>
            </div>

            {singleSection && (
                <>
                    <SectionLabel>Executive Council</SectionLabel>
                    <div className="flex flex-wrap justify-center gap-2">
                        {allHqPosts.map(p => <PosCard key={p.id} position={p} accent="gold" />)}
                    </div>
                </>
            )}

            {!singleSection && (
                <>
                    {boardPosts.length > 0 && (
                        <>
                            <SectionLabel>Board of Directors</SectionLabel>
                            <div className="flex flex-wrap justify-center gap-2">
                                {boardPosts.map(p => <PosCard key={p.id} position={p} accent="gold" />)}
                            </div>
                        </>
                    )}
                    {ceoPosts.length > 0 && (
                        <>
                            <SectionLabel>Chief Executive</SectionLabel>
                            <div className="flex flex-wrap justify-center gap-2">
                                {ceoPosts.map(p => <PosCard key={p.id} position={p} accent="blue" />)}
                            </div>
                        </>
                    )}
                    {cLevelPosts.length > 0 && (
                        <>
                            <SectionLabel>C-Level Executives</SectionLabel>
                            <div className="flex flex-wrap justify-center gap-2">
                                {cLevelPosts.map(p => <PosCard key={p.id} position={p} accent="blue" />)}
                            </div>
                        </>
                    )}
                    {centralDeptPosts.length > 0 && (
                        <>
                            <SectionLabel>HQ Central Departments</SectionLabel>
                            <div className="flex flex-wrap justify-center gap-2">
                                {centralDeptPosts.map(p => <PosCard key={p.id} position={p} accent="gold" />)}
                            </div>
                        </>
                    )}
                </>
            )}
        </div>
    );
}

// ── Connector lines (HQ → branches) ──────────────────────────────────────────

function HQBranchConnector({ branchCount }: { branchCount: number }) {
    if (branchCount === 0) return null;
    return (
        <div className="flex flex-col items-center pointer-events-none">
            {/* vertical stem from HQ down */}
            <div className="w-0.5 h-8 bg-gradient-to-b from-amber-500 via-amber-400 to-emerald-400" />
            {/* horizontal bar across branches */}
            {branchCount > 1 && (
                <div
                    className="bg-emerald-400 dark:bg-emerald-500"
                    style={{
                        height: 2,
                        width: `${Math.min(branchCount * 270, 1100)}px`,
                        maxWidth: "100%",
                    }}
                />
            )}
        </div>
    );
}

// Per-branch top connector (small vertical stem from horizontal bar down)
function BranchTopStem() {
    return <div className="w-0.5 h-6 bg-emerald-400 dark:bg-emerald-500 mb-0" />;
}

// ── Main component ───────────────────────────────────────────────────────────

export default function OrgRegions({ structure }: { structure: OrgStructure }) {
    // Separate the HQ branch (BR-HQ) from regional branches
    const hqBranch = structure.branches.find(b => b.branch.id === HQ_BRANCH_ID);
    const regionalBranches = structure.branches.filter(b => b.branch.id !== HQ_BRANCH_ID);

    const hqBranchPosts = hqBranch
        ? hqBranch.deptGroups.flatMap(g => g.positions)
        : [];
    const hqBranchName = hqBranch?.branch.name ?? "Headquarters";

    return (
        <div className="rounded-xl bg-gradient-to-br from-amber-50/40 via-card to-emerald-50/40 dark:from-amber-950/10 dark:via-card dark:to-emerald-950/10 p-6 sm:p-10 overflow-x-auto border border-border">
            {/* Legend bar */}
            <div className="flex justify-center flex-wrap gap-4 mb-8 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> Headquarters</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" /> Board of Directors</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-sky-500" /> Executives (C-Level)</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Regional Branch</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400" /> Branch Manager / Staff</span>
            </div>

            {/* ── HEADQUARTERS region ──────────────────────────────────── */}
            <div className="flex flex-col items-center mb-0">
                <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-3">Headquarters</p>
                <HQContainer
                    orgWidePosts={structure.orgWidePositions}
                    hqBranchPosts={hqBranchPosts}
                    hqBranchName={hqBranchName}
                />
            </div>

            {/* ── CONNECTOR LINES HQ → Branches ────────────────────────── */}
            {regionalBranches.length > 0 && (
                <HQBranchConnector branchCount={regionalBranches.length} />
            )}

            {/* ── REGIONAL BRANCHES ────────────────────────────────────── */}
            {regionalBranches.length > 0 && (
                <div className="mt-0">
                    <div className="flex flex-wrap justify-center items-start gap-3">
                        {regionalBranches.map(bg => (
                            <div key={bg.branch.id} className="flex flex-col items-center">
                                <BranchTopStem />
                                <BranchContainer bg={bg} />
                            </div>
                        ))}
                    </div>
                    <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground text-center mt-6">
                        Regional Branches
                    </p>
                </div>
            )}

            {/* Footer stats */}
            <div className="mt-10 pt-6 border-t border-border/60 flex justify-center flex-wrap gap-6 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                    <Landmark size={11} className="text-amber-500" />
                    {structure.orgWidePositions.length + hqBranchPosts.length} HQ position{(structure.orgWidePositions.length + hqBranchPosts.length) !== 1 ? "s" : ""}
                </span>
                <span className="flex items-center gap-1.5">
                    <Building2 size={11} className="text-emerald-500" />
                    {regionalBranches.length} regional branch{regionalBranches.length !== 1 ? "es" : ""}
                </span>
                <span className="flex items-center gap-1.5">
                    <Users size={11} className="text-sky-500" />
                    {structure.branches.reduce((s, b) => s + b.deptGroups.reduce((ss, g) => ss + g.positions.length, 0), 0) + structure.orgWidePositions.length} total positions
                </span>
            </div>
        </div>
    );
}
