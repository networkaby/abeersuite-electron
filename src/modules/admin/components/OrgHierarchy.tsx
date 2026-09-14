"use client";

// True top-down organizational hierarchy chart.
// Renders Org root → Executive Council + Branches → Departments → Positions
// as a classic org chart with CSS connector lines (no SVG, no deps).
//
// Hierarchy levels (top to bottom):
//   1. ROOT          — synthetic "Organization" node
//   2. TIER 1        — "Executive Council" (org-wide posts) + each Branch
//   3. TIER 2        — Departments within each branch
//   4. TIER 3        — Position cards (with holder avatars)
//
// Interactive features:
//   • Click any node → highlights the lineage (root → node) and dims the rest
//   • Click again or background → clears focus
//   • Collapse/expand any subtree (chevron on nodes with children)
//   • Zoom controls (+ / − / fit) using CSS transform
//   • Hover on a position → shows its description card overlay
//   • Smooth transitions on every state change
//
// Pattern: each tree row is a flex container; connectors are absolute-positioned
// dotted divs anchored on parent and child nodes.

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
    Building2, Layers, Briefcase, Users, AlertCircle,
    ChevronDown, ChevronRight, ZoomIn, ZoomOut, Maximize2, Landmark,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PositionNode, OrgStructure } from "@/shared/types/orgChart";
import UserAvatar from "@/shared/components/UserAvatar";

// ── Helpers ───────────────────────────────────────────────────────────────────

type NodeId = string; // synthetic for tier 1/2, real IDs for tier 3

// Unique IDs for each rendered node so we can track focus + collapse state.
// The "root" of the org IS the Board / Executive Council — branches are
// its direct children (they report up to the board).
const ID_BOARD = "__board__";
const branchId = (b: string) => `branch::${b}`;
const deptId   = (b: string, d: string | "no-dept") => `dept::${b}::${d}`;

// ── Holder avatar ─────────────────────────────────────────────────────────────

function HolderAvatar({ user, size = 22 }: { user: PositionNode["holders"][number]["user"]; size?: number }) {
    return <UserAvatar avatarUrl={user.avatarUrl} name={user.name} role={user.role} sizePx={size} className="ring-2 ring-card" />;
}

// ── Node card variants ────────────────────────────────────────────────────────

interface NodeCardProps {
    label: string;
    sublabel?: string;
    icon: React.ElementType;
    accent: "root" | "exec" | "branch" | "dept" | "post";
    dim: boolean;
    onClick: () => void;
    onToggle?: () => void;
    collapsed?: boolean;
    hasChildren?: boolean;
    vacant?: boolean;
    children?: React.ReactNode;
}

const ACCENT_STYLES: Record<NodeCardProps["accent"], { card: string; icon: string; text: string }> = {
    root:   { card: "bg-gradient-to-br from-slate-800 to-slate-900 text-white border-slate-700",                 icon: "text-amber-300", text: "text-white" },
    exec:   { card: "bg-gradient-to-br from-orange-500/20 to-amber-500/10 border-orange-400",                    icon: "text-orange-600", text: "text-orange-800 dark:text-orange-300" },
    branch: { card: "bg-gradient-to-br from-primary/15 to-primary/5 border-primary/50",                          icon: "text-primary", text: "text-primary" },
    dept:   { card: "bg-gradient-to-br from-violet-100 to-violet-50 dark:from-violet-900/30 dark:to-violet-950/20 border-violet-300 dark:border-violet-800", icon: "text-violet-600 dark:text-violet-400", text: "text-violet-700 dark:text-violet-300" },
    post:   { card: "bg-card border-border",                                                                     icon: "text-foreground", text: "text-foreground" },
};

function NodeCard({
    label, sublabel, icon: Icon, accent, dim, onClick, onToggle, collapsed, hasChildren, vacant, children,
}: NodeCardProps) {
    const s = ACCENT_STYLES[accent];
    return (
        <div
            onClick={(e) => { e.stopPropagation(); onClick(); }}
            className={[
                "relative inline-flex items-center gap-2 px-3 py-2 rounded-lg border-2 shadow-sm cursor-pointer",
                "transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5",
                s.card,
                dim ? "opacity-30" : "opacity-100",
                accent === "post" ? "min-w-[180px]" : "",
            ].join(" ")}
        >
            <Icon size={accent === "root" ? 18 : 14} className={`${s.icon} shrink-0`} />
            <div className="min-w-0 flex-1">
                <p className={`text-xs font-bold leading-tight uppercase tracking-wider ${s.text}`}>{label}</p>
                {sublabel && <p className="text-[10px] opacity-70 leading-tight mt-0.5">{sublabel}</p>}
                {children}
            </div>
            {vacant && (
                <span className="ml-1 inline-flex items-center gap-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 px-1 py-0.5 text-[10px] font-medium">
                    <AlertCircle size={9} /> Vacant
                </span>
            )}
            {hasChildren && onToggle && (
                <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onToggle(); }}
                    className="ml-1 rounded p-0.5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                    title={collapsed ? "Expand" : "Collapse"}
                >
                    {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                </button>
            )}
        </div>
    );
}

// ── Post card (specialised) ───────────────────────────────────────────────────

function PostCard({ post, dim, focused, onClick }: { post: PositionNode; dim: boolean; focused: boolean; onClick: () => void }) {
    const vacant = post.holders.length === 0;
    return (
        <div
            onClick={(e) => { e.stopPropagation(); onClick(); }}
            className={[
                "relative w-44 rounded-lg border-2 bg-card px-3 py-2 shadow-sm cursor-pointer transition-all duration-300",
                "hover:shadow-lg hover:-translate-y-0.5",
                focused ? "border-primary ring-4 ring-primary/20" : "border-border",
                dim ? "opacity-30" : "opacity-100",
            ].join(" ")}
        >
            <div className="flex items-start gap-1.5">
                <div className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${vacant ? "bg-amber-400" : "bg-emerald-500"}`} />
                <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-foreground leading-tight">{post.title}</p>
                    {vacant ? (
                        <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-400 italic">Vacant</p>
                    ) : (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1">
                            {post.holders.slice(0, 2).map(h => (
                                <Link
                                    key={h.user.id}
                                    href={`/office/social/users/${h.user.id}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-muted transition-colors"
                                    title={h.user.name}
                                >
                                    <HolderAvatar user={h.user} size={18} />
                                    <span className="text-[10px] font-medium text-foreground/80 truncate max-w-[60px]">
                                        {h.user.name.split(" ")[0]}
                                    </span>
                                </Link>
                            ))}
                            {post.holders.length > 2 && (
                                <span className="text-[10px] text-muted-foreground">+{post.holders.length - 2}</span>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ── Connector primitives ──────────────────────────────────────────────────────
// Pure-CSS lines using border tricks: vertical stem + horizontal bar above
// children. Highlighted variant uses primary colour when on the focused path.

function VStem({ h = 24, active }: { h?: number; active?: boolean }) {
    return (
        <div
            className={`mx-auto transition-colors duration-300 ${active ? "bg-primary" : "bg-border"}`}
            style={{ width: 2, height: h }}
        />
    );
}

function HBar({ widthPx, active }: { widthPx: number; active?: boolean }) {
    return (
        <div
            className={`mx-auto transition-colors duration-300 ${active ? "bg-primary" : "bg-border"}`}
            style={{ height: 2, width: widthPx }}
        />
    );
}

// ── Layout sizing constants ──────────────────────────────────────────────────

const POST_W       = 184;  // post card width incl. padding
const POST_GAP     = 16;
const DEPT_COL_GAP = 32;   // gap between dept columns
const BRANCH_GAP   = 56;   // gap between branch columns

// ── Subtree builders ──────────────────────────────────────────────────────────

interface CtxProps {
    focusedPath: Set<NodeId>;
    focusedId: NodeId | null;
    collapsed: Set<NodeId>;
    onFocus: (id: NodeId, path: NodeId[]) => void;
    onToggle: (id: NodeId) => void;
}

function PostsRow({
    posts, ctx, parentPath,
}: {
    posts: PositionNode[];
    ctx: CtxProps;
    parentPath: NodeId[];
}) {
    const width = posts.length * POST_W + (posts.length - 1) * POST_GAP;
    return (
        <div className="flex flex-col items-center" style={{ width }}>
            <VStem h={16} active={posts.some(p => ctx.focusedPath.has(p.id))} />
            <HBar widthPx={posts.length > 1 ? (posts.length - 1) * (POST_W + POST_GAP) : 0} active={posts.some(p => ctx.focusedPath.has(p.id))} />
            <div className="flex justify-between" style={{ width, gap: POST_GAP }}>
                {posts.map(p => (
                    <div key={p.id} className="flex flex-col items-center" style={{ width: POST_W }}>
                        {posts.length > 1 && <VStem h={16} active={ctx.focusedPath.has(p.id)} />}
                        <PostCard
                            post={p}
                            dim={ctx.focusedId !== null && !ctx.focusedPath.has(p.id)}
                            focused={ctx.focusedId === p.id}
                            onClick={() => ctx.onFocus(p.id, [...parentPath, p.id])}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}

function DeptSubtree({
    branchKey, dept, posts, ctx, parentPath,
}: {
    branchKey: string;
    dept: { id: string; name: string } | null;
    posts: PositionNode[];
    ctx: CtxProps;
    parentPath: NodeId[];
}) {
    const id = deptId(branchKey, dept?.id ?? "no-dept");
    const path = [...parentPath, id];
    const onFocusPath = posts.map(p => p.id);
    const subtreeActive = ctx.focusedPath.has(id) || onFocusPath.some(p => ctx.focusedPath.has(p));
    const isCollapsed = ctx.collapsed.has(id);
    const dim = ctx.focusedId !== null && !subtreeActive;

    return (
        <div className="flex flex-col items-center">
            <NodeCard
                label={dept ? dept.name : "Branch-level"}
                sublabel={`${posts.length} position${posts.length !== 1 ? "s" : ""}`}
                icon={Layers}
                accent="dept"
                dim={dim}
                hasChildren={posts.length > 0}
                collapsed={isCollapsed}
                onToggle={() => ctx.onToggle(id)}
                onClick={() => ctx.onFocus(id, path)}
            />
            {!isCollapsed && posts.length > 0 && (
                <PostsRow posts={posts} ctx={ctx} parentPath={path} />
            )}
        </div>
    );
}

function BranchSubtree({
    bg, ctx, parentPath,
}: {
    bg: OrgStructure["branches"][number];
    ctx: CtxProps;
    parentPath: NodeId[];
}) {
    const id = branchId(bg.branch.id);
    const path = [...parentPath, id];
    const allPostIds = bg.deptGroups.flatMap(g => g.positions.map(p => p.id));
    const subtreeActive = ctx.focusedPath.has(id) || allPostIds.some(p => ctx.focusedPath.has(p))
        || bg.deptGroups.some((g, i) => ctx.focusedPath.has(deptId(bg.branch.id, g.dept?.id ?? `no-dept-${i}`)));
    const isCollapsed = ctx.collapsed.has(id);
    const dim = ctx.focusedId !== null && !subtreeActive;

    const allPostsCount = allPostIds.length;
    const vacantCount = bg.deptGroups.flatMap(g => g.positions).filter(p => p.holders.length === 0).length;
    const visibleDeptGroups = bg.deptGroups.filter(g => g.positions.length > 0);

    // Width needed for child row
    const childWidth = visibleDeptGroups.length === 0
        ? 0
        : visibleDeptGroups.reduce((s, g) => s + (g.positions.length * POST_W + (g.positions.length - 1) * POST_GAP), 0)
            + (visibleDeptGroups.length - 1) * DEPT_COL_GAP;

    return (
        <div className="flex flex-col items-center" style={{ minWidth: Math.max(childWidth, 200) }}>
            <NodeCard
                label={bg.branch.name}
                sublabel={`${allPostsCount} position${allPostsCount !== 1 ? "s" : ""}${vacantCount ? ` · ${vacantCount} vacant` : ""}`}
                icon={Building2}
                accent="branch"
                dim={dim}
                hasChildren={visibleDeptGroups.length > 0}
                collapsed={isCollapsed}
                onToggle={() => ctx.onToggle(id)}
                onClick={() => ctx.onFocus(id, path)}
            />
            {!isCollapsed && visibleDeptGroups.length > 0 && (
                <>
                    <VStem h={20} active={subtreeActive} />
                    {visibleDeptGroups.length > 1 && (
                        <HBar widthPx={Math.max(childWidth - visibleDeptGroups[0].positions.length * POST_W / 2 - visibleDeptGroups[visibleDeptGroups.length - 1].positions.length * POST_W / 2, 100)} active={subtreeActive} />
                    )}
                    <div className="flex items-start" style={{ gap: DEPT_COL_GAP }}>
                        {visibleDeptGroups.map((g, i) => (
                            <div key={g.dept?.id ?? `nd-${i}`} className="flex flex-col items-center">
                                {visibleDeptGroups.length > 1 && (
                                    <VStem h={16} active={ctx.focusedPath.has(deptId(bg.branch.id, g.dept?.id ?? `no-dept-${i}`))
                                        || g.positions.some(p => ctx.focusedPath.has(p.id))} />
                                )}
                                <DeptSubtree
                                    branchKey={bg.branch.id}
                                    dept={g.dept}
                                    posts={g.positions}
                                    ctx={ctx}
                                    parentPath={path}
                                />
                            </div>
                        ))}
                    </div>
                </>
            )}
            {!isCollapsed && visibleDeptGroups.length === 0 && (
                <p className="mt-3 text-[10px] text-muted-foreground italic">No positions</p>
            )}
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function OrgHierarchy({ structure }: { structure: OrgStructure }) {
    const [focusedId, setFocusedId]     = useState<NodeId | null>(null);
    const [focusedPath, setFocusedPath] = useState<Set<NodeId>>(new Set());
    const [collapsed, setCollapsed]     = useState<Set<NodeId>>(new Set());
    const [zoom, setZoom]               = useState(1);
    const containerRef = useRef<HTMLDivElement>(null);

    const onFocus = (id: NodeId, path: NodeId[]) => {
        if (focusedId === id) { setFocusedId(null); setFocusedPath(new Set()); return; }
        setFocusedId(id);
        // Every path includes the Board (root) — branches all report up to it.
        setFocusedPath(new Set([ID_BOARD, ...path]));
    };

    const onToggle = (id: NodeId) => {
        setCollapsed(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const ctx: CtxProps = { focusedPath, focusedId, collapsed, onFocus, onToggle };

    const stats = useMemo(() => {
        const allPosts = [
            ...structure.orgWidePositions,
            ...structure.branches.flatMap(b => b.deptGroups.flatMap(g => g.positions)),
        ];
        const holders = allPosts.reduce((s, p) => s + p.holders.length, 0);
        const vacant  = allPosts.filter(p => p.holders.length === 0).length;
        return { posts: allPosts.length, holders, vacant };
    }, [structure]);

    const boardCollapsed = collapsed.has(ID_BOARD);
    const boardActive    = focusedPath.size > 0;
    const branchCount    = structure.branches.length;

    return (
        <div className="space-y-4">
            {/* Controls */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Briefcase size={12} /> {stats.posts} positions</span>
                    <span className="flex items-center gap-1"><Users size={12} /> {stats.holders} holders</span>
                    {stats.vacant > 0 && (
                        <span className="flex items-center gap-1 text-amber-600"><AlertCircle size={12} /> {stats.vacant} vacant</span>
                    )}
                    {focusedId && (
                        <span className="text-primary text-[11px] italic">· path highlighted (click again to clear)</span>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    <Button type="button" variant="outline" size="icon-sm" onClick={() => setZoom(z => Math.max(0.5, z - 0.1))} title="Zoom out">
                        <ZoomOut size={13} />
                    </Button>
                    <span className="text-xs text-muted-foreground font-mono w-12 text-center">{Math.round(zoom * 100)}%</span>
                    <Button type="button" variant="outline" size="icon-sm" onClick={() => setZoom(z => Math.min(2, z + 0.1))} title="Zoom in">
                        <ZoomIn size={13} />
                    </Button>
                    <Button type="button" variant="outline" size="icon-sm" onClick={() => setZoom(1)} title="Reset zoom">
                        <Maximize2 size={13} />
                    </Button>
                </div>
            </div>

            {/* Chart canvas */}
            <div
                ref={containerRef}
                className="relative overflow-auto rounded-lg border border-border bg-gradient-to-br from-muted/40 to-muted/10 p-8"
                style={{ minHeight: 400 }}
                onClick={() => { setFocusedId(null); setFocusedPath(new Set()); }}
            >
                <div
                    className="origin-top mx-auto inline-flex flex-col items-center transition-transform duration-300"
                    style={{ transform: `scale(${zoom})` }}
                >
                    {/* ─────────────────────────────────────────────────────────
                        ROOT — Board of Directors / Executive Council
                        Org-wide posts (CEO, CFO, System Admin, etc.) are the
                        members of the board, shown inline directly under it.
                        Branches report UP to the board (children below).
                       ───────────────────────────────────────────────────────── */}
                    <div
                        onClick={(e) => { e.stopPropagation(); onFocus(ID_BOARD, [ID_BOARD]); }}
                        className={[
                            "rounded-xl border-2 shadow-lg cursor-pointer transition-all duration-300 hover:shadow-xl",
                            "bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border-amber-400/60",
                            "px-6 py-4 min-w-[280px]",
                            focusedId !== null && !boardActive ? "opacity-30" : "opacity-100",
                        ].join(" ")}
                    >
                        {/* Board header */}
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                                <Landmark size={20} className="text-amber-400" />
                                <div>
                                    <p className="text-[10px] uppercase tracking-widest text-amber-400/80 font-medium leading-none">Board of Directors</p>
                                    <p className="text-sm font-bold text-white mt-0.5 leading-tight">Executive Council</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onToggle(ID_BOARD); }}
                                className="rounded p-1 hover:bg-white/10 transition-colors text-white"
                                title={boardCollapsed ? "Expand" : "Collapse"}
                            >
                                {boardCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                            </button>
                        </div>

                        {/* Board members — org-wide posts shown inline */}
                        {!boardCollapsed && structure.orgWidePositions.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-amber-400/20">
                                <p className="text-[10px] uppercase tracking-widest text-amber-400/60 mb-2">
                                    Members · {structure.orgWidePositions.length} seat{structure.orgWidePositions.length !== 1 ? "s" : ""}
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    {structure.orgWidePositions.map(p => {
                                        const vacant = p.holders.length === 0;
                                        const pFocused = focusedId === p.id;
                                        const pDim = focusedId !== null && !focusedPath.has(p.id);
                                        return (
                                            <div
                                                key={p.id}
                                                onClick={(e) => { e.stopPropagation(); onFocus(p.id, [p.id]); }}
                                                className={[
                                                    "rounded-md border-2 bg-white/5 backdrop-blur px-2.5 py-1.5 cursor-pointer transition-all",
                                                    pFocused ? "border-amber-400 ring-2 ring-amber-400/30" : "border-white/20 hover:border-amber-400/60",
                                                    pDim ? "opacity-30" : "opacity-100",
                                                ].join(" ")}
                                            >
                                                <div className="flex items-center gap-1.5">
                                                    <div className={`h-1.5 w-1.5 rounded-full ${vacant ? "bg-amber-400" : "bg-emerald-400"}`} />
                                                    <p className="text-[11px] font-bold text-white leading-tight">{p.title}</p>
                                                </div>
                                                {vacant ? (
                                                    <p className="mt-1 text-[10px] text-amber-400/80 italic">Vacant seat</p>
                                                ) : (
                                                    <div className="mt-1.5 flex items-center gap-1">
                                                        {p.holders.slice(0, 2).map(h => (
                                                            <Link
                                                                key={h.user.id}
                                                                href={`/office/social/users/${h.user.id}`}
                                                                onClick={(e) => e.stopPropagation()}
                                                                className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-white/10 transition-colors"
                                                                title={h.user.name}
                                                            >
                                                                <HolderAvatar user={h.user} size={16} />
                                                                <span className="text-[10px] font-medium text-white/90 truncate max-w-[80px]">
                                                                    {h.user.name}
                                                                </span>
                                                            </Link>
                                                        ))}
                                                        {p.holders.length > 2 && (
                                                            <span className="text-[10px] text-white/60">+{p.holders.length - 2}</span>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {!boardCollapsed && structure.orgWidePositions.length === 0 && (
                            <p className="mt-3 pt-3 border-t border-amber-400/20 text-[10px] text-amber-400/60 italic text-center">
                                No board seats defined yet — create an org-wide post (branchId=null) to populate
                            </p>
                        )}
                    </div>

                    {/* ─────────────────────────────────────────────────────────
                        Branches — children of the board (report up to it)
                       ───────────────────────────────────────────────────────── */}
                    {!boardCollapsed && branchCount > 0 && (
                        <>
                            <VStem h={28} active={boardActive} />
                            {branchCount > 1 && (
                                <HBar widthPx={(branchCount - 1) * 260} active={boardActive} />
                            )}
                            <div className="flex items-start" style={{ gap: BRANCH_GAP }}>
                                {structure.branches.map(bg => (
                                    <div key={bg.branch.id} className="flex flex-col items-center">
                                        {branchCount > 1 && (
                                            <VStem h={16} active={
                                                focusedPath.has(branchId(bg.branch.id))
                                                || bg.deptGroups.some(g => g.positions.some(p => focusedPath.has(p.id)))
                                            } />
                                        )}
                                        <BranchSubtree bg={bg} ctx={ctx} parentPath={[]} />
                                    </div>
                                ))}
                            </div>
                        </>
                    )}

                    {!boardCollapsed && branchCount === 0 && (
                        <p className="mt-6 text-xs text-muted-foreground italic">No branches defined yet</p>
                    )}
                </div>
            </div>

            <p className="text-[11px] text-muted-foreground italic text-center">
                The Board / Executive Council sits at the top — branches report up to it · click any node to highlight its lineage
            </p>
        </div>
    );
}
