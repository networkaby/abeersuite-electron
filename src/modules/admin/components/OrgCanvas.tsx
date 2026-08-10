"use client";

// Canvas (Beta) — custom pan/zoom/drag visualization of the org structure.
// View-only: drag rearranges the on-screen layout but does not write to the
// database. Edges are derived from branchId / departmentId (HQ → branch →
// dept → position) and are drawn as smooth bezier paths via an SVG overlay
// that flexes automatically as cards move.
//
// Controls:
//   • Drag a card by its body to reposition it.
//   • Drag the empty canvas background to pan.
//   • Mouse wheel to zoom (clamped 0.3 — 2.0).
//   • Toolbar: Reset view (re-fit), Reset layout (re-seed positions).
//
// Layout is in-memory only — refresh the page to reset.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Landmark, Building2, Layers, Briefcase, AlertCircle,
    Maximize2, RotateCcw, ZoomIn, ZoomOut,
} from "lucide-react";
import type { OrgStructure } from "@/shared/types/orgChart";
import { Button } from "@/components/ui/button";

const HQ_BRANCH_ID = "BR-HQ";

// Card dimensions are needed to draw edges from card centers.
const HQ_W = 280, HQ_H = 72;
const BRANCH_W = 200, BRANCH_H = 56;
const DEPT_W = 170, DEPT_H = 44;
const POS_W = 150, POS_H = 44;

// Initial layout geometry.
const HQ_Y = 0;
const BRANCH_Y = 220;
const DEPT_Y = 380;
const BRANCH_GAP = 260; // distance between branch centers
const POS_VERTICAL = 60;

type NodeKind = "hq" | "branch" | "dept" | "position";

interface CanvasNode {
    id: string;
    kind: NodeKind;
    x: number;
    y: number;
    w: number;
    h: number;
    label: string;
    sub?: string | null;
    vacant?: boolean;
}

interface CanvasEdge {
    id: string;
    source: string;
    target: string;
    color: string;
}

// ── Build initial layout ─────────────────────────────────────────────────────

function buildLayout(structure: OrgStructure): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
    const nodes: CanvasNode[] = [];
    const edges: CanvasEdge[] = [];

    const hqGroup = structure.branches.find(b => b.branch.id === HQ_BRANCH_ID);
    const regional = structure.branches.filter(b => b.branch.id !== HQ_BRANCH_ID);
    const hqBranchPositions = hqGroup ? hqGroup.deptGroups.flatMap(g => g.positions) : [];
    const allHqPositions = [...structure.orgWidePositions, ...hqBranchPositions];
    const hqName = hqGroup?.branch.name ?? "Headquarters";

    const branchRowWidth = regional.length > 0
        ? (regional.length - 1) * BRANCH_GAP + BRANCH_W
        : HQ_W;
    const centerX = branchRowWidth / 2;

    // HQ
    nodes.push({
        id: "hq",
        kind: "hq",
        x: centerX - HQ_W / 2,
        y: HQ_Y,
        w: HQ_W,
        h: HQ_H,
        label: hqName,
        sub: `${allHqPositions.length} position${allHqPositions.length === 1 ? "" : "s"}`,
    });

    // HQ positions — laid out as a grid below HQ when no regional branches exist,
    // or as a wide row above the regional row when present.
    const hqPosRowY = regional.length === 0 ? HQ_Y + HQ_H + 60 : -POS_VERTICAL * 2 - 60;
    const hqPosCols = Math.max(3, Math.ceil(Math.sqrt(allHqPositions.length)));
    allHqPositions.forEach((p, i) => {
        const id = `pos-${p.id}`;
        const col = i % hqPosCols;
        const row = Math.floor(i / hqPosCols);
        const startX = centerX - (hqPosCols * (POS_W + 10) - 10) / 2;
        nodes.push({
            id,
            kind: "position",
            x: startX + col * (POS_W + 10),
            y: hqPosRowY + row * (POS_H + 12),
            w: POS_W,
            h: POS_H,
            label: p.holders[0]?.user.name ?? p.title,
            sub: p.holders[0] ? p.title : "Vacant",
            vacant: p.holders.length === 0,
        });
        edges.push({ id: `hq-${id}`, source: "hq", target: id, color: "#f59e0b" });
    });

    // Regional branches + their depts + positions
    regional.forEach((bg, branchIdx) => {
        const branchId = `branch-${bg.branch.id}`;
        const branchX = branchIdx * BRANCH_GAP;
        const posCount = bg.deptGroups.reduce((s, g) => s + g.positions.length, 0);

        nodes.push({
            id: branchId,
            kind: "branch",
            x: branchX,
            y: BRANCH_Y,
            w: BRANCH_W,
            h: BRANCH_H,
            label: bg.branch.name,
            sub: `${posCount} position${posCount === 1 ? "" : "s"}`,
        });
        edges.push({ id: `hq-${branchId}`, source: "hq", target: branchId, color: "#10b981" });

        const deptsWithDept = bg.deptGroups.filter(g => g.dept);
        const noDeptGroup = bg.deptGroups.find(g => !g.dept);

        deptsWithDept.forEach((g, deptIdx) => {
            const deptId = `dept-${bg.branch.id}-${g.dept!.id}`;
            const deptX = branchX + (BRANCH_W - DEPT_W) / 2;
            const deptY = DEPT_Y + deptIdx * (DEPT_H + g.positions.length * (POS_H + 8) + 30);

            nodes.push({
                id: deptId,
                kind: "dept",
                x: deptX,
                y: deptY,
                w: DEPT_W,
                h: DEPT_H,
                label: g.dept!.name,
                sub: `${g.positions.length} position${g.positions.length === 1 ? "" : "s"}`,
            });
            edges.push({ id: `${branchId}-${deptId}`, source: branchId, target: deptId, color: "#10b981" });

            g.positions.forEach((p, posIdx) => {
                const posId = `pos-${p.id}`;
                nodes.push({
                    id: posId,
                    kind: "position",
                    x: deptX + (DEPT_W - POS_W) / 2,
                    y: deptY + DEPT_H + 20 + posIdx * (POS_H + 8),
                    w: POS_W,
                    h: POS_H,
                    label: p.holders[0]?.user.name ?? p.title,
                    sub: p.holders[0] ? p.title : "Vacant",
                    vacant: p.holders.length === 0,
                });
                edges.push({ id: `${deptId}-${posId}`, source: deptId, target: posId, color: "#0ea5e9" });
            });
        });

        // No-dept positions hang directly off the branch.
        if (noDeptGroup) {
            noDeptGroup.positions.forEach((p, posIdx) => {
                const posId = `pos-${p.id}`;
                nodes.push({
                    id: posId,
                    kind: "position",
                    x: branchX + BRANCH_W + 20,
                    y: BRANCH_Y + posIdx * (POS_H + 8),
                    w: POS_W,
                    h: POS_H,
                    label: p.holders[0]?.user.name ?? p.title,
                    sub: p.holders[0] ? p.title : "Vacant",
                    vacant: p.holders.length === 0,
                });
                edges.push({ id: `${branchId}-${posId}`, source: branchId, target: posId, color: "#10b981" });
            });
        }
    });

    return { nodes, edges };
}

// ── Edge path (cubic bezier between card centers, biased vertically) ────────

function bezierPath(a: CanvasNode, b: CanvasNode): string {
    const ax = a.x + a.w / 2;
    const ay = a.y + a.h;        // bottom of source card
    const bx = b.x + b.w / 2;
    const by = b.y;              // top of target card
    const dy = Math.abs(by - ay);
    const c1y = ay + Math.max(40, dy * 0.4);
    const c2y = by - Math.max(40, dy * 0.4);
    return `M ${ax} ${ay} C ${ax} ${c1y}, ${bx} ${c2y}, ${bx} ${by}`;
}

// ── Card renderers ───────────────────────────────────────────────────────────

function HQCard({ node }: { node: CanvasNode }) {
    return (
        <div className="rounded-xl border-2 border-amber-400 dark:border-amber-500 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 shadow-md w-full h-full">
            <div className="flex items-center gap-1.5">
                <Landmark size={13} className="text-amber-600 dark:text-amber-300" />
                <p className="text-[11px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-300 truncate">
                    {node.label}
                </p>
            </div>
            {node.sub && (
                <p className="text-[10px] text-amber-700/70 dark:text-amber-300/70 mt-0.5">{node.sub}</p>
            )}
        </div>
    );
}

function BranchCard({ node }: { node: CanvasNode }) {
    return (
        <div className="rounded-lg border border-emerald-400 dark:border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1.5 shadow-sm w-full h-full">
            <div className="flex items-center gap-1.5">
                <Building2 size={12} className="text-emerald-600 dark:text-emerald-300" />
                <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 truncate">
                    {node.label}
                </p>
            </div>
            {node.sub && (
                <p className="text-[10px] text-emerald-700/70 dark:text-emerald-300/70 mt-0.5">{node.sub}</p>
            )}
        </div>
    );
}

function DeptCard({ node }: { node: CanvasNode }) {
    return (
        <div className="rounded-md border border-emerald-300 dark:border-emerald-700 bg-emerald-50/70 dark:bg-emerald-950/25 px-2 py-1.5 shadow-sm w-full h-full">
            <div className="flex items-center gap-1">
                <Layers size={10} className="text-emerald-600 dark:text-emerald-300" />
                <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 truncate">
                    {node.label}
                </p>
            </div>
            {node.sub && (
                <p className="text-[10px] text-emerald-700/70 dark:text-emerald-300/70">{node.sub}</p>
            )}
        </div>
    );
}

function PositionCard({ node }: { node: CanvasNode }) {
    return (
        <div className={`rounded-md border px-2 py-1.5 shadow-sm w-full h-full ${
            node.vacant
                ? "border-amber-300 dark:border-amber-700 bg-amber-50/70 dark:bg-amber-950/25"
                : "border-sky-300 dark:border-sky-700 bg-sky-50/70 dark:bg-sky-950/25"
        }`}>
            <div className="flex items-center gap-1">
                {node.vacant ? (
                    <AlertCircle size={9} className="text-amber-600 dark:text-amber-300 shrink-0" />
                ) : (
                    <Briefcase size={9} className="text-sky-600 dark:text-sky-300 shrink-0" />
                )}
                <p className={`text-[10px] font-bold leading-tight truncate ${
                    node.vacant ? "text-amber-800 dark:text-amber-200" : "text-sky-800 dark:text-sky-200"
                }`}>
                    {node.label}
                </p>
            </div>
            {node.sub && (
                <p className={`text-[10px] mt-0.5 truncate ${
                    node.vacant ? "text-amber-700/70 dark:text-amber-300/70" : "text-sky-700/70 dark:text-sky-300/70"
                }`}>
                    {node.sub}
                </p>
            )}
        </div>
    );
}

function renderCard(node: CanvasNode) {
    switch (node.kind) {
        case "hq":       return <HQCard       node={node} />;
        case "branch":   return <BranchCard   node={node} />;
        case "dept":     return <DeptCard     node={node} />;
        case "position": return <PositionCard node={node} />;
    }
}

// ── Main canvas component ───────────────────────────────────────────────────

interface DragState {
    type: "node" | "pan";
    nodeId?: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
}

export default function OrgCanvas({ structure }: { structure: OrgStructure }) {
    const initial = useMemo(() => buildLayout(structure), [structure]);
    const [nodes, setNodes] = useState<CanvasNode[]>(initial.nodes);
    const [edges, setEdges] = useState<CanvasEdge[]>(initial.edges);
    const [zoom, setZoom] = useState(0.7);
    const [pan, setPan] = useState({ x: 100, y: 80 });
    const [drag, setDrag] = useState<DragState | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);

    // Re-seed when structure changes (admin adds a branch etc).
    useEffect(() => {
        setNodes(initial.nodes);
        setEdges(initial.edges);
    }, [initial]);

    // Compute the canvas bounds so SVG and scroll area cover all nodes.
    const bounds = useMemo(() => {
        if (nodes.length === 0) return { width: 1200, height: 800, minX: 0, minY: 0 };
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const n of nodes) {
            if (n.x < minX) minX = n.x;
            if (n.y < minY) minY = n.y;
            if (n.x + n.w > maxX) maxX = n.x + n.w;
            if (n.y + n.h > maxY) maxY = n.y + n.h;
        }
        const pad = 200;
        return {
            minX: minX - pad,
            minY: minY - pad,
            width: maxX - minX + pad * 2,
            height: maxY - minY + pad * 2,
        };
    }, [nodes]);

    // ── Drag handlers ───────────────────────────────────────────────────────

    const onNodePointerDown = useCallback((e: React.PointerEvent, nodeId: string) => {
        const node = nodes.find(n => n.id === nodeId);
        if (!node) return;
        e.stopPropagation();
        (e.target as Element).setPointerCapture(e.pointerId);
        setDrag({
            type: "node",
            nodeId,
            startX: e.clientX,
            startY: e.clientY,
            origX: node.x,
            origY: node.y,
        });
    }, [nodes]);

    const onCanvasPointerDown = useCallback((e: React.PointerEvent) => {
        if ((e.target as HTMLElement).closest("[data-node-card]")) return;
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        setDrag({
            type: "pan",
            startX: e.clientX,
            startY: e.clientY,
            origX: pan.x,
            origY: pan.y,
        });
    }, [pan]);

    const onPointerMove = useCallback((e: React.PointerEvent) => {
        if (!drag) return;
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        if (drag.type === "node" && drag.nodeId) {
            const nodeId = drag.nodeId;
            setNodes(prev => prev.map(n =>
                n.id === nodeId
                    ? { ...n, x: drag.origX + dx / zoom, y: drag.origY + dy / zoom }
                    : n,
            ));
        } else if (drag.type === "pan") {
            setPan({ x: drag.origX + dx, y: drag.origY + dy });
        }
    }, [drag, zoom]);

    const onPointerUp = useCallback(() => setDrag(null), []);

    // ── Wheel zoom (centered on cursor) ──────────────────────────────────────

    const onWheel = useCallback((e: React.WheelEvent) => {
        if (!containerRef.current) return;
        e.preventDefault();
        const rect = containerRef.current.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        const newZoom = Math.max(0.3, Math.min(2, zoom * factor));
        // Keep the point under cursor fixed: solve newPan so that
        // (cx - newPan.x) / newZoom == (cx - pan.x) / zoom
        const newPanX = cx - ((cx - pan.x) / zoom) * newZoom;
        const newPanY = cy - ((cy - pan.y) / zoom) * newZoom;
        setZoom(newZoom);
        setPan({ x: newPanX, y: newPanY });
    }, [zoom, pan]);

    // ── Reset helpers ────────────────────────────────────────────────────────

    const resetView = useCallback(() => {
        setZoom(0.7);
        setPan({ x: 100, y: 80 });
    }, []);

    const resetLayout = useCallback(() => {
        const fresh = buildLayout(structure);
        setNodes(fresh.nodes);
        setEdges(fresh.edges);
    }, [structure]);

    const zoomIn  = useCallback(() => setZoom(z => Math.min(2, z * 1.2)), []);
    const zoomOut = useCallback(() => setZoom(z => Math.max(0.3, z * 0.85)), []);

    // Index nodes by id for fast edge lookup.
    const nodeById = useMemo(() => {
        const m = new Map<string, CanvasNode>();
        for (const n of nodes) m.set(n.id, n);
        return m;
    }, [nodes]);

    return (
        <div
            ref={containerRef}
            className="relative rounded-xl border border-border bg-card overflow-hidden"
            style={{ height: "75vh", minHeight: 600 }}
            onWheel={onWheel}
        >
            {/* Toolbar */}
            <div className="absolute top-2 right-2 z-20 flex gap-1 bg-card/80 backdrop-blur rounded-md border border-border p-1 shadow-sm">
                <Button type="button" variant="ghost" size="icon-sm" onClick={zoomOut} title="Zoom out">
                    <ZoomOut size={14} />
                </Button>
                <span className="px-1.5 self-center text-[10px] font-mono text-muted-foreground tabular-nums">
                    {Math.round(zoom * 100)}%
                </span>
                <Button type="button" variant="ghost" size="icon-sm" onClick={zoomIn} title="Zoom in">
                    <ZoomIn size={14} />
                </Button>
                <div className="w-px bg-border mx-0.5" />
                <Button type="button" variant="ghost" size="icon-sm" onClick={resetView} title="Reset view">
                    <Maximize2 size={14} />
                </Button>
                <Button type="button" variant="ghost" size="icon-sm" onClick={resetLayout} title="Reset layout">
                    <RotateCcw size={14} />
                </Button>
            </div>

            {/* Help hint */}
            <div className="absolute bottom-2 left-2 z-20 text-[10px] text-muted-foreground bg-card/80 backdrop-blur rounded px-2 py-1 border border-border">
                Drag cards · drag background to pan · scroll to zoom
            </div>

            {/* Dot grid background */}
            <div
                className="absolute inset-0 pointer-events-none"
                style={{
                    backgroundImage: "radial-gradient(rgba(120,120,120,0.15) 1px, transparent 1px)",
                    backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
                    backgroundPosition: `${pan.x}px ${pan.y}px`,
                }}
            />

            {/* Pan/drag surface */}
            <div
                className="absolute inset-0 cursor-grab active:cursor-grabbing"
                onPointerDown={onCanvasPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
            >
                {/* Transformed world — single transform applies to SVG + cards together. */}
                <div
                    style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                        transformOrigin: "0 0",
                        width: bounds.width,
                        height: bounds.height,
                    }}
                >
                    {/* SVG edge layer */}
                    <svg
                        width={bounds.width}
                        height={bounds.height}
                        style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", overflow: "visible" }}
                    >
                        {edges.map(edge => {
                            const a = nodeById.get(edge.source);
                            const b = nodeById.get(edge.target);
                            if (!a || !b) return null;
                            return (
                                <path
                                    key={edge.id}
                                    d={bezierPath(a, b)}
                                    fill="none"
                                    stroke={edge.color}
                                    strokeWidth={1.5}
                                    strokeOpacity={0.65}
                                    strokeLinecap="round"
                                />
                            );
                        })}
                    </svg>

                    {/* Cards */}
                    {nodes.map(n => (
                        <div
                            key={n.id}
                            data-node-card={n.kind}
                            onPointerDown={(e) => onNodePointerDown(e, n.id)}
                            onPointerMove={onPointerMove}
                            onPointerUp={onPointerUp}
                            onPointerCancel={onPointerUp}
                            style={{
                                position: "absolute",
                                left: n.x,
                                top: n.y,
                                width: n.w,
                                height: n.h,
                                cursor: drag?.nodeId === n.id ? "grabbing" : "grab",
                                touchAction: "none",
                                userSelect: "none",
                            }}
                        >
                            {renderCard(n)}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
