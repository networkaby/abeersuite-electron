"use client";

// Interactive, search-and-filter-driven org explorer.
// This is the "Explorer" tab on the Org Chart page — a dashboard-style
// alternative to the classic top-down tree. Built to feel responsive and
// visually rich without adding any chart library dependency.
//
// Features:
//   • Live stats bar (branches / depts / positions / holders / vacancies / coverage)
//   • Search across post titles AND holder names — non-matching cards dim
//   • Branch filter chips (multi-toggle, "all" reset)
//   • Hover any post card → side detail panel updates
//   • Click a post card → pin it in the detail panel
//   • Smooth opacity/scale transitions; vacant posts get a red dot
//   • Branch cards collapse/expand individually
//
// Data source: same /api/posts/structure as StructureTree (OrgStructure).

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
    Building2, Globe2, Layers, Search, X, Users, Briefcase, Activity,
    CheckCircle2, AlertCircle, ChevronDown, ChevronUp, Eye,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PositionNode, OrgStructure } from "@/shared/types/orgChart";

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string) {
    return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

const AVATAR_COLOR: Record<string, string> = {
    R1: "bg-purple-100 text-purple-700 ring-purple-200",
    R2: "bg-blue-100 text-blue-700 ring-blue-200",
    R3: "bg-green-100 text-green-700 ring-green-200",
    R4: "bg-orange-100 text-orange-700 ring-orange-200",
};

type Holder = PositionNode["holders"][number]["user"];

function matchesQuery(post: PositionNode, q: string): boolean {
    if (!q) return true;
    const ql = q.toLowerCase();
    if (post.title.toLowerCase().includes(ql)) return true;
    return post.holders.some(h => h.user.name.toLowerCase().includes(ql));
}

// ── Holder avatar ─────────────────────────────────────────────────────────────

function HolderAvatar({ user, size = 24 }: { user: Holder; size?: number }) {
    const [imgErr, setImgErr] = useState(false);
    const dim = `${size}px`;
    if (user.avatarUrl && !imgErr) {
        return (
            <Image
                src={user.avatarUrl} alt={user.name} width={size} height={size}
                style={{ width: dim, height: dim }}
                className="rounded-full object-cover ring-2 ring-card"
                onError={() => setImgErr(true)}
            />
        );
    }
    const cls = user.role ? (AVATAR_COLOR[user.role] ?? "bg-gray-100 text-gray-600 ring-gray-200") : "bg-gray-100 text-gray-600 ring-gray-200";
    return (
        <div
            style={{ width: dim, height: dim, fontSize: size * 0.4 }}
            className={`flex shrink-0 items-center justify-center rounded-full font-bold ring-2 ring-card ${cls}`}
        >
            {initials(user.name)}
        </div>
    );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function Stat({ label, value, icon: Icon, accent }: {
    label: string;
    value: string | number;
    icon: React.ElementType;
    accent: string;
}) {
    return (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 shadow-sm">
            <div className={`flex h-9 w-9 items-center justify-center rounded-md ${accent}`}>
                <Icon size={16} />
            </div>
            <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground leading-none">{label}</p>
                <p className="text-lg font-bold leading-tight mt-0.5">{value}</p>
            </div>
        </div>
    );
}

// ── Post card (interactive) ───────────────────────────────────────────────────

function PostCard({
    post, dimmed, focused, onHover, onClick,
}: {
    post: PositionNode;
    dimmed: boolean;
    focused: boolean;
    onHover: () => void;
    onClick: () => void;
}) {
    const vacant = post.holders.length === 0;
    return (
        <div
            onMouseEnter={onHover}
            onClick={onClick}
            className={[
                "group cursor-pointer rounded-lg border bg-card px-3 py-2.5 shadow-sm transition-all duration-200",
                "hover:shadow-md hover:-translate-y-0.5 hover:border-primary/40",
                dimmed ? "opacity-30" : "opacity-100",
                focused ? "border-primary ring-2 ring-primary/30" : "border-border",
                vacant ? "bg-amber-50/30 dark:bg-amber-950/10" : "",
            ].join(" ")}
        >
            <div className="flex items-start gap-2">
                <div className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${vacant ? "bg-amber-400" : "bg-emerald-500"}`} />
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground leading-tight">{post.title}</p>
                    {vacant ? (
                        <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-400 italic">Vacant</p>
                    ) : (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {post.holders.slice(0, 3).map(h => (
                                <div key={h.user.id} className="flex items-center gap-1">
                                    <HolderAvatar user={h.user} size={20} />
                                    <span className="text-[11px] font-medium text-foreground/80 truncate max-w-[80px]">
                                        {h.user.name}
                                    </span>
                                </div>
                            ))}
                            {post.holders.length > 3 && (
                                <span className="text-[10px] text-muted-foreground">+{post.holders.length - 3}</span>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ── Branch panel ──────────────────────────────────────────────────────────────

function BranchPanel({
    branch, deptGroups, orgWide,
    query, focusedId, onPostHover, onPostClick,
}: {
    branch: { id: string; name: string };
    deptGroups: OrgStructure["branches"][number]["deptGroups"];
    orgWide?: boolean;
    query: string;
    focusedId: string | null;
    onPostHover: (post: PositionNode) => void;
    onPostClick: (post: PositionNode) => void;
}) {
    const [collapsed, setCollapsed] = useState(false);
    const allPosts = deptGroups.flatMap(g => g.positions);
    const holderCount = allPosts.reduce((s, p) => s + p.holders.length, 0);
    const vacantCount = allPosts.filter(p => p.holders.length === 0).length;
    const matchedCount = allPosts.filter(p => matchesQuery(p, query)).length;
    const isEmpty = allPosts.length === 0;

    const headerCls = orgWide
        ? "bg-gradient-to-r from-orange-500/15 via-orange-500/10 to-transparent border-orange-400/50"
        : "bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border-primary/30";
    const iconCls = orgWide ? "text-orange-500" : "text-primary";
    const titleCls = orgWide ? "text-orange-700 dark:text-orange-400" : "text-primary";

    return (
        <div className={`rounded-xl border-2 ${headerCls} overflow-hidden shadow-sm`}>
            {/* Header */}
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border/40">
                <div className="flex items-center gap-2 min-w-0">
                    {orgWide ? <Globe2 size={16} className={iconCls} /> : <Building2 size={16} className={iconCls} />}
                    <h3 className={`text-sm font-bold uppercase tracking-wider ${titleCls}`}>{branch.name}</h3>
                    {!isEmpty && (
                        <Badge className="bg-card text-foreground border border-border text-[10px] ml-1">
                            {allPosts.length} position{allPosts.length !== 1 ? "s" : ""}
                        </Badge>
                    )}
                    {query && matchedCount < allPosts.length && (
                        <Badge className="bg-primary/10 text-primary text-[10px]">
                            {matchedCount} match{matchedCount !== 1 ? "es" : ""}
                        </Badge>
                    )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                    {!isEmpty && (
                        <>
                            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                                <Users size={11} /> {holderCount}
                            </span>
                            {vacantCount > 0 && (
                                <span className="text-[11px] text-amber-600 flex items-center gap-1">
                                    <AlertCircle size={11} /> {vacantCount}
                                </span>
                            )}
                        </>
                    )}
                    <Button
                        type="button" variant="ghost" size="icon-xs"
                        onClick={() => setCollapsed(o => !o)}
                        className="text-muted-foreground"
                    >
                        {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                    </Button>
                </div>
            </div>

            {/* Body */}
            {!collapsed && (
                <div className="p-4 space-y-4 bg-card/50">
                    {isEmpty ? (
                        <p className="py-6 text-center text-xs text-muted-foreground italic">No positions defined yet</p>
                    ) : (
                        deptGroups.map((g, i) => (
                            <div key={g.dept?.id ?? `nd-${i}`}>
                                {g.dept && (
                                    <div className="flex items-center gap-1.5 mb-2 pb-1 border-b border-dashed border-border">
                                        <Layers size={11} className="text-muted-foreground" />
                                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                            {g.dept.name}
                                        </span>
                                        <span className="text-[10px] text-muted-foreground">
                                            · {g.positions.length} position{g.positions.length !== 1 ? "s" : ""}
                                        </span>
                                    </div>
                                )}
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                    {g.positions.map(p => (
                                        <PostCard
                                            key={p.id}
                                            post={p}
                                            dimmed={!matchesQuery(p, query)}
                                            focused={focusedId === p.id}
                                            onHover={() => onPostHover(p)}
                                            onClick={() => onPostClick(p)}
                                        />
                                    ))}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function DetailPanel({ post, pinned, onUnpin }: { post: PositionNode | null; pinned: boolean; onUnpin: () => void }) {
    if (!post) {
        return (
            <div className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center">
                <Eye size={20} className="mx-auto text-muted-foreground/50 mb-2" />
                <p className="text-xs text-muted-foreground">
                    Hover or click any position to see details
                </p>
            </div>
        );
    }
    const vacant = post.holders.length === 0;

    return (
        <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden sticky top-4">
            <div className="px-4 py-3 border-b border-border bg-muted/40 flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">Position</p>
                    <p className="text-base font-bold leading-tight mt-0.5">{post.title}</p>
                    <p className="text-[10px] font-mono text-muted-foreground mt-1">{post.id}</p>
                </div>
                {pinned && (
                    <Button type="button" variant="ghost" size="icon-xs" onClick={onUnpin} title="Unpin">
                        <X size={12} />
                    </Button>
                )}
            </div>
            <div className="p-4 space-y-3">
                <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Scope</p>
                    {post.branch ? (
                        <div className="flex items-center gap-1.5 text-sm">
                            <Building2 size={12} className="text-primary" />
                            <span>{post.branch.name}</span>
                            {post.department && (
                                <>
                                    <span className="text-muted-foreground">/</span>
                                    <Layers size={11} className="text-muted-foreground" />
                                    <span>{post.department.name}</span>
                                </>
                            )}
                        </div>
                    ) : (
                        <div className="flex items-center gap-1.5 text-sm">
                            <Globe2 size={12} className="text-orange-500" />
                            <span className="text-orange-700 dark:text-orange-400">Executive Council (org-wide)</span>
                        </div>
                    )}
                </div>

                <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                        Holders {post.holders.length > 0 && `(${post.holders.length})`}
                    </p>
                    {vacant ? (
                        <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400 italic">
                            <AlertCircle size={12} /> Vacant — no one appointed yet
                        </div>
                    ) : (
                        <div className="space-y-1.5">
                            {post.holders.map(h => (
                                <Link
                                    key={h.user.id}
                                    href={`/office/social/users/${h.user.id}`}
                                    className="flex items-center gap-2 p-1.5 rounded hover:bg-muted transition-colors"
                                >
                                    <HolderAvatar user={h.user} size={28} />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium leading-tight truncate">{h.user.name}</p>
                                        {h.user.userRole && (
                                            <Badge className={`${h.user.userRole.color} text-[9px] px-1 py-0 mt-0.5`}>
                                                {h.user.userRole.label}
                                            </Badge>
                                        )}
                                    </div>
                                </Link>
                            ))}
                        </div>
                    )}
                </div>

                <div className="pt-2 border-t border-border">
                    <p className="text-[10px] text-muted-foreground">
                        {pinned ? "Pinned — click another to switch" : "Click a position to pin"}
                    </p>
                </div>
            </div>
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function OrgExplorer({ structure }: { structure: OrgStructure }) {
    const [query, setQuery]               = useState("");
    const [branchFilter, setBranchFilter] = useState<string | "all">("all");
    const [hovered, setHovered]           = useState<PositionNode | null>(null);
    const [pinned, setPinned]             = useState<PositionNode | null>(null);

    // ── Derived stats ────────────────────────────────────────────────────────
    const stats = useMemo(() => {
        const allPosts: PositionNode[] = [
            ...structure.orgWidePositions,
            ...structure.branches.flatMap(b => b.deptGroups.flatMap(g => g.positions)),
        ];
        const holders = allPosts.reduce((s, p) => s + p.holders.length, 0);
        const vacant  = allPosts.filter(p => p.holders.length === 0).length;
        const branches = structure.branches.length;
        const orgPlusBranches = (structure.orgWidePositions.length > 0 ? 1 : 0) + branches;
        const depts = new Set(
            structure.branches.flatMap(b => b.deptGroups.map(g => g.dept?.id).filter(Boolean) as string[]),
        ).size;
        const coverage = allPosts.length > 0 ? Math.round(((allPosts.length - vacant) / allPosts.length) * 100) : 0;
        return { branches: orgPlusBranches, depts, posts: allPosts.length, holders, vacant, coverage };
    }, [structure]);

    // ── Filtering ────────────────────────────────────────────────────────────
    const visibleOrgWide = structure.orgWidePositions;
    const visibleBranches = branchFilter === "all"
        ? structure.branches
        : structure.branches.filter(b => b.branch.id === branchFilter);
    const showOrgWide = branchFilter === "all" || branchFilter === "__org";

    const detail = pinned ?? hovered;

    return (
        <div className="space-y-4">
            {/* Stats row */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
                <Stat label="Branches"  value={stats.branches} icon={Building2}    accent="bg-blue-100 text-blue-700" />
                <Stat label="Depts"     value={stats.depts}    icon={Layers}       accent="bg-purple-100 text-purple-700" />
                <Stat label="Positions" value={stats.posts}    icon={Briefcase}    accent="bg-indigo-100 text-indigo-700" />
                <Stat label="Holders"   value={stats.holders}  icon={Users}        accent="bg-green-100 text-green-700" />
                <Stat label="Vacant"    value={stats.vacant}   icon={AlertCircle}  accent="bg-amber-100 text-amber-700" />
                <Stat label="Coverage"  value={`${stats.coverage}%`} icon={Activity} accent={stats.coverage >= 80 ? "bg-emerald-100 text-emerald-700" : "bg-orange-100 text-orange-700"} />
            </div>

            {/* Search + filters */}
            <div className="flex flex-col sm:flex-row gap-2.5">
                <div className="relative flex-1">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Search positions or holder names…"
                        className="pl-9 pr-9"
                    />
                    {query && (
                        <Button
                            type="button" variant="ghost" size="icon-xs"
                            onClick={() => setQuery("")}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2"
                        >
                            <X size={12} />
                        </Button>
                    )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                    <Button
                        type="button" variant="outline" size="xs"
                        onClick={() => setBranchFilter("all")}
                        className={branchFilter === "all" ? "bg-primary text-primary-foreground hover:bg-primary" : ""}
                    >
                        All
                    </Button>
                    {structure.orgWidePositions.length > 0 && (
                        <Button
                            type="button" variant="outline" size="xs"
                            onClick={() => setBranchFilter("__org")}
                            className={branchFilter === "__org" ? "bg-orange-500 text-white hover:bg-orange-500" : ""}
                        >
                            <Globe2 size={11} /> Org-wide
                        </Button>
                    )}
                    {structure.branches.map(b => (
                        <Button
                            key={b.branch.id} type="button" variant="outline" size="xs"
                            onClick={() => setBranchFilter(b.branch.id)}
                            className={branchFilter === b.branch.id ? "bg-primary text-primary-foreground hover:bg-primary" : ""}
                        >
                            {b.branch.name}
                        </Button>
                    ))}
                </div>
            </div>

            {/* Main layout: tree + detail */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
                <div className="space-y-3" onMouseLeave={() => !pinned && setHovered(null)}>
                    {showOrgWide && visibleOrgWide.length > 0 && (
                        <BranchPanel
                            branch={{ id: "__org", name: "Executive Council" }}
                            orgWide
                            deptGroups={[{ dept: null, positions: visibleOrgWide }]}
                            query={query}
                            focusedId={detail?.id ?? null}
                            onPostHover={p => !pinned && setHovered(p)}
                            onPostClick={p => setPinned(prev => prev?.id === p.id ? null : p)}
                        />
                    )}
                    {visibleBranches.map(bg => (
                        <BranchPanel
                            key={bg.branch.id}
                            branch={bg.branch}
                            deptGroups={bg.deptGroups}
                            query={query}
                            focusedId={detail?.id ?? null}
                            onPostHover={p => !pinned && setHovered(p)}
                            onPostClick={p => setPinned(prev => prev?.id === p.id ? null : p)}
                        />
                    ))}
                    {visibleBranches.length === 0 && !showOrgWide && (
                        <div className="rounded-lg border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
                            No branches match the current filter.
                        </div>
                    )}
                    {stats.coverage === 100 && (
                        <div className="flex items-center justify-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 pt-2">
                            <CheckCircle2 size={14} /> All positions are filled
                        </div>
                    )}
                </div>

                <DetailPanel post={detail} pinned={!!pinned} onUnpin={() => setPinned(null)} />
            </div>
        </div>
    );
}
