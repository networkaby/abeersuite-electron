"use client";

// Region-based hierarchy view with nested bordered containers.
// Light theme; uses theme tokens so it works in both light/dark mode.
//
// Structure:
//   ┌── EXECUTIVE COUNCIL (sky border) ──────────────────────┐
//   │  Board · CEO · C-Level  (org-wide, no branchId)        │
//   └──────────────────────────┬─────────────────────────────┘
//                              │  sky→amber gradient
//   ┌── HEADQUARTERS (amber border) ─────────────────────────┐
//   │  HQ-branch-scoped positions (branchId = BR-HQ)         │
//   └──────────────────────────┬─────────────────────────────┘
//                              │  amber→emerald gradient
//          ┌───────────────┬───┴───────┬───────────────┐
//      [Branch 1]      [Branch 2]  [Branch 3]      [Branch 4]
//
// The HQ container is identified as the branch with id === "BR-HQ".
//
// When `canManage` is true:
//  • "+" buttons open OrgRegionsCreateDialog at the matching scope.
//  • Trash buttons next to pills/dept-headers DELETE via guarded endpoints.
//  • Right-click ANY card (HQ pill, branch pill, dept box, position card)
//    opens a small contextual menu with Delete + relevant Add actions —
//    so deletion is discoverable on every node, not just the ones with
//    visible trash icons.
//  • If no BR-HQ exists, a dashed "Create HQ" CTA replaces the HQ panel.

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { extractApiError } from "@/shared/lib/api";
import { Crown, Building2, Briefcase, Users, AlertCircle, Landmark, Plus, Trash2, UserPlus, UserMinus, ArrowRightLeft } from "lucide-react";
import type { OrgStructure, PositionNode } from "@/shared/types/orgChart";
import { classifyPosition, SECTION_LABELS } from "@/modules/admin/lib/orgChartClassification";
import { Button } from "@/components/ui/button";
import OrgRegionsCreateDialog, { type Intent } from "./OrgRegionsCreateDialog";
import OrgAppointDialog from "./OrgAppointDialog";
import OrgTransferDialog from "./OrgTransferDialog";
import { initials } from "@/shared/lib/format/initials";
import { confirmAction } from "@/shared/lib/ui/confirmStore";

const HQ_BRANCH_ID = "BR-HQ";

// ── Avatar / helpers ─────────────────────────────────────────────────────────

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

// ── Context-menu primitive (hand-rolled, no new deps) ────────────────────────

interface MenuItem {
    label: string;
    onClick: () => void;
    danger?: boolean;
    icon?: React.ReactNode;
}

type MenuEntry = MenuItem | { divider: true };

interface MenuState {
    x: number;
    y: number;
    items: MenuEntry[];
}

function isDivider(e: MenuEntry): e is { divider: true } {
    return (e as { divider?: true }).divider === true;
}

function ContextMenu({ menu, onClose }: { menu: MenuState | null; onClose: () => void }) {
    useEffect(() => {
        if (!menu) return;
        const onDocDown = (e: MouseEvent) => {
            if ((e.target as HTMLElement).closest("[data-org-context-menu]")) return;
            onClose();
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        const onScroll = () => onClose();
        document.addEventListener("mousedown", onDocDown);
        document.addEventListener("keydown", onKey);
        document.addEventListener("scroll", onScroll, true);
        return () => {
            document.removeEventListener("mousedown", onDocDown);
            document.removeEventListener("keydown", onKey);
            document.removeEventListener("scroll", onScroll, true);
        };
    }, [menu, onClose]);

    if (!menu) return null;

    // Keep within viewport
    const maxX = window.innerWidth - 220;
    const maxY = window.innerHeight - menu.items.length * 32 - 12;
    const x = Math.min(menu.x, maxX);
    const y = Math.min(menu.y, maxY);

    return (
        <div
            data-org-context-menu
            className="fixed z-50 min-w-[220px] rounded-md border border-border bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10 py-1"
            style={{ left: x, top: y }}
            onContextMenu={e => e.preventDefault()}
        >
            {menu.items.map((it, i) => {
                if (isDivider(it)) {
                    return <div key={`div-${i}`} className="my-1 h-px bg-border/70" />;
                }
                return (
                    <button
                        key={i}
                        type="button"
                        onClick={() => { it.onClick(); onClose(); }}
                        className={[
                            "w-full text-left flex items-center gap-2 px-3 py-1.5 text-[12px]",
                            it.danger
                                ? "text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40"
                                : "text-foreground hover:bg-muted",
                        ].join(" ")}
                    >
                        <span className="w-3.5 inline-flex items-center justify-center">{it.icon}</span>
                        {it.label}
                    </button>
                );
            })}
        </div>
    );
}

// ── Position card ────────────────────────────────────────────────────────────

interface PosCardProps {
    position: PositionNode;
    accent: "gold" | "blue" | "green";
    compact?: boolean;
    canManage?: boolean;
    onContextMenu?: (e: React.MouseEvent, position: PositionNode) => void;
}

const POS_CARD_STYLES: Record<PosCardProps["accent"], { card: string; name: string; title: string; avatar: string; icon: React.ReactNode }> = {
    gold:  { card: "bg-amber-50 dark:bg-amber-950/30 border-amber-400 hover:border-amber-500",     name: "text-amber-900 dark:text-amber-200",   title: "text-amber-700/70 dark:text-amber-300/60",   avatar: "bg-amber-200 dark:bg-amber-900/40",  icon: <Landmark size={18} className="text-amber-600 dark:text-amber-300" /> },
    blue:  { card: "bg-sky-50 dark:bg-sky-950/30 border-sky-400 hover:border-sky-500",             name: "text-sky-900 dark:text-sky-200",       title: "text-sky-700/70 dark:text-sky-300/60",       avatar: "bg-sky-200 dark:bg-sky-900/40",      icon: <Crown size={18} className="text-sky-600 dark:text-sky-300" /> },
    green: { card: "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-400 hover:border-emerald-500", name: "text-emerald-900 dark:text-emerald-200", title: "text-emerald-700/70 dark:text-emerald-300/60", avatar: "bg-emerald-200 dark:bg-emerald-900/40", icon: <Briefcase size={18} className="text-emerald-600 dark:text-emerald-300" /> },
};

function PosCard({ position, accent, compact = false, canManage = false, onContextMenu }: PosCardProps) {
    const s = POS_CARD_STYLES[accent];
    const holder = position.holders[0];
    const vacant = !holder;
    const w = compact ? "w-[88px]" : "w-[120px]";
    const px = compact ? "px-1.5" : "px-2";
    const py = compact ? "py-1.5" : "py-2.5";
    const avatarBox = compact ? "w-8 h-8" : "w-10 h-10";
    const avatarSize = compact ? 28 : 36;
    const nameSize = compact ? "text-[10px]" : "text-[11px]";
    const titleSize = compact ? "text-[10px]" : "text-[10px]";

    const handleContext = (e: React.MouseEvent) => {
        if (!canManage || !onContextMenu) return;
        onContextMenu(e, position);
    };

    const cardInner = (
        <div
            onContextMenu={handleContext}
            className={`flex flex-col items-center ${w} ${px} ${py} rounded-md border shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${s.card}`}
        >
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
                <span className="mt-0.5 text-[10px] text-muted-foreground">+{position.holders.length - 1}</span>
            )}
        </div>
    );

    return holder ? (
        <Link href={`/office/social/users/${holder.user.id}`} className="block" onContextMenu={handleContext}>
            {cardInner}
        </Link>
    ) : cardInner;
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

function DeptBox({
    name, posts, branchId, deptId, canManage, onPosContext, onDeptContext,
}: {
    name: string;
    posts: PositionNode[];
    branchId: string | null;
    deptId: string;
    canManage: boolean;
    onPosContext: (e: React.MouseEvent, position: PositionNode) => void;
    onDeptContext: (e: React.MouseEvent, deptId: string, deptName: string, branchId: string | null) => void;
}) {
    return (
        <div
            className={`rounded-md border border-emerald-300 dark:border-emerald-700/50 bg-emerald-50/40 dark:bg-emerald-950/15 px-1.5 py-1.5 ${canManage ? "cursor-context-menu" : ""}`}
            onContextMenu={(e) => canManage && onDeptContext(e, deptId, name, branchId)}
            title={canManage ? "Right-click for actions" : undefined}
        >
            <div className="flex items-center justify-center mb-1">
                <p className="text-[10px] uppercase tracking-wider text-center font-bold text-emerald-700 dark:text-emerald-300">
                    {name}
                </p>
            </div>
            <div className="flex flex-wrap justify-center gap-1">
                {posts.map(p => (
                    <PosCard
                        key={p.id}
                        position={p}
                        accent="green"
                        compact
                        canManage={canManage}
                        onContextMenu={onPosContext}
                    />
                ))}
            </div>
        </div>
    );
}

// ── Branch container ─────────────────────────────────────────────────────────

function BranchContainer({
    bg, canManage, onPosContext, onDeptContext, onBranchContext,
}: {
    bg: OrgStructure["branches"][number];
    canManage: boolean;
    onPosContext: (e: React.MouseEvent, position: PositionNode) => void;
    onDeptContext: (e: React.MouseEvent, deptId: string, deptName: string, branchId: string | null) => void;
    onBranchContext: (e: React.MouseEvent, branchId: string, branchName: string) => void;
}) {
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
        <div
            className="relative rounded-lg border border-emerald-400 dark:border-emerald-600 bg-emerald-50/50 dark:bg-emerald-950/20 px-2.5 pt-5 pb-2.5 w-[210px] shadow-sm"
            onContextMenu={(e) => {
                // Only fire for clicks on the branch chrome — not bubbled cards.
                if ((e.target as HTMLElement).closest("[data-pos-card], [data-dept-box]")) return;
                if (canManage) onBranchContext(e, bg.branch.id, bg.branch.name);
            }}
        >
            {/* Branch name pill */}
            <div className="flex justify-center -mt-7 mb-2">
                <div
                    className="rounded border border-emerald-500 dark:border-emerald-600 bg-card px-2 py-0.5 shadow-sm"
                    onContextMenu={(e) => { e.stopPropagation(); if (canManage) onBranchContext(e, bg.branch.id, bg.branch.name); }}
                >
                    <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                        <Building2 size={9} /> {bg.branch.name}
                    </p>
                </div>
            </div>

            {branchManagerPosition && (
                <>
                    <div className="flex justify-center mb-2">
                        <PosCard position={branchManagerPosition} accent="green" compact canManage={canManage} onContextMenu={onPosContext} />
                    </div>
                    {(otherDeptGroups.length > 0 || restNonMgrInNoDept.length > 0) && (
                        <div className="h-px bg-emerald-300/60 dark:bg-emerald-700/40 my-1.5" />
                    )}
                </>
            )}

            {restNonMgrInNoDept.length > 0 && (
                <div className="flex flex-wrap justify-center gap-1 mb-2">
                    {restNonMgrInNoDept.map(p => (
                        <PosCard key={p.id} position={p} accent="green" compact canManage={canManage} onContextMenu={onPosContext} />
                    ))}
                </div>
            )}

            {otherDeptGroups.filter(g => g.dept).length > 0 && (
                <div className="grid grid-cols-2 gap-1.5" data-dept-box>
                    {otherDeptGroups
                        .filter(g => g.dept)
                        .map((g, i) => (
                            <DeptBox
                                key={g.dept!.id + i}
                                name={g.dept!.name}
                                posts={g.positions}
                                branchId={bg.branch.id}
                                deptId={g.dept!.id}
                                canManage={canManage}
                                onPosContext={onPosContext}
                                onDeptContext={onDeptContext}
                            />
                        ))}
                </div>
            )}

            {allPositions.length === 0 && (
                <p className="text-[10px] text-muted-foreground italic text-center py-3">No positions</p>
            )}
        </div>
    );
}

// ── HQ container ─────────────────────────────────────────────────────────────

function HQContainer({
    hqBranchPosts,
    hqBranchName,
    hqBranchExists,
    canManage,
    onCreateHQ,
    onPosContext,
    onBranchContext,
}: {
    hqBranchPosts: PositionNode[];
    hqBranchName: string;
    hqBranchExists: boolean;
    canManage: boolean;
    onCreateHQ: () => void;
    onPosContext: (e: React.MouseEvent, position: PositionNode) => void;
    onBranchContext: (e: React.MouseEvent, branchId: string, branchName: string) => void;
}) {

    const headerPill = (
        <div className="flex justify-center -mt-9 mb-2">
            <div
                className="rounded-lg border border-amber-500 bg-card px-4 py-1 shadow-md"
                onContextMenu={(e) => { e.stopPropagation(); if (canManage && hqBranchExists) onBranchContext(e, HQ_BRANCH_ID, hqBranchName); }}
            >
                <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-amber-700 dark:text-amber-300">
                    <Landmark size={12} /> {hqBranchName}
                </p>
            </div>
        </div>
    );

    if (!hqBranchExists) {
        return (
            <div className="relative rounded-xl border-2 border-dashed border-amber-400/70 dark:border-amber-500/60 bg-amber-50/30 dark:bg-amber-950/15 p-8 min-w-[400px] text-center shadow-sm">
                <Landmark size={28} className="mx-auto text-amber-400 dark:text-amber-300 mb-2" />
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-200 mb-1">No Headquarters yet</p>
                <p className="text-[11px] text-amber-700/70 dark:text-amber-300/70 mb-4 max-w-sm mx-auto">
                    Set up your HQ branch to anchor org-wide leadership. We&apos;ll handle the internal id for you.
                </p>
                {canManage && (
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={onCreateHQ}
                        className="border-amber-400 text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950/40"
                    >
                        <Plus size={12} className="mr-1" />
                        Create HQ
                    </Button>
                )}
            </div>
        );
    }

    if (hqBranchPosts.length === 0) {
        return (
            <div className="relative rounded-xl border-2 border-amber-400 dark:border-amber-500 bg-amber-50/50 dark:bg-amber-950/20 p-6 min-w-[400px] text-center shadow-sm">
                {headerPill}
                <p className="text-[11px] text-amber-700/60 dark:text-amber-300/60 italic">
                    No HQ positions yet — right-click the HQ pill to add a department or position.
                </p>
            </div>
        );
    }

    const hqGrouped: Record<string, PositionNode[]> = { board: [], chiefExecutive: [], cLevel: [], other: [] };
    for (const p of hqBranchPosts) hqGrouped[classifyPosition(p.title)].push(p);
    const singleSection = hqGrouped.board.length + hqGrouped.chiefExecutive.length + hqGrouped.cLevel.length === 0;

    const cardsWithMenu = (posts: PositionNode[], accent: "gold" | "blue") =>
        posts.map(p => (
            <PosCard
                key={p.id}
                position={p}
                accent={accent}
                canManage={canManage}
                onContextMenu={onPosContext}
            />
        ));

    return (
        <div className="relative rounded-xl border-2 border-amber-400 dark:border-amber-500 bg-amber-50/50 dark:bg-amber-950/20 p-5 min-w-[400px] shadow-sm">
            {headerPill}

            {singleSection && (
                <>
                    <SectionLabel>HQ Positions</SectionLabel>
                    <div className="flex flex-wrap justify-center gap-2">
                        {cardsWithMenu(hqBranchPosts, "gold")}
                    </div>
                </>
            )}

            {!singleSection && (
                <>
                    {hqGrouped.board.length > 0 && (
                        <>
                            <SectionLabel>{SECTION_LABELS.board}</SectionLabel>
                            <div className="flex flex-wrap justify-center gap-2">{cardsWithMenu(hqGrouped.board, "gold")}</div>
                        </>
                    )}
                    {hqGrouped.chiefExecutive.length > 0 && (
                        <>
                            <SectionLabel>{SECTION_LABELS.chiefExecutive}</SectionLabel>
                            <div className="flex flex-wrap justify-center gap-2">{cardsWithMenu(hqGrouped.chiefExecutive, "blue")}</div>
                        </>
                    )}
                    {hqGrouped.cLevel.length > 0 && (
                        <>
                            <SectionLabel>{SECTION_LABELS.cLevel}</SectionLabel>
                            <div className="flex flex-wrap justify-center gap-2">{cardsWithMenu(hqGrouped.cLevel, "blue")}</div>
                        </>
                    )}
                    {hqGrouped.other.length > 0 && (
                        <>
                            <SectionLabel>HQ Central Departments</SectionLabel>
                            <div className="flex flex-wrap justify-center gap-2">{cardsWithMenu(hqGrouped.other, "gold")}</div>
                        </>
                    )}
                </>
            )}
        </div>
    );
}

// ── Connector lines ──────────────────────────────────────────────────────────

function HQBranchConnector({ branchCount }: { branchCount: number }) {
    if (branchCount === 0) return null;
    return (
        <div className="flex flex-col items-center pointer-events-none">
            <div className="w-0.5 h-8 bg-gradient-to-b from-amber-500 via-amber-400 to-emerald-400" />
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

function BranchTopStem() {
    return <div className="w-0.5 h-6 bg-emerald-400 dark:bg-emerald-500 mb-0" />;
}

// ── Executive Council band (org-wide positions — above HQ) ────────────────────

function ExecCouncilBand({
    posts, canManage, onPosContext, onContext,
}: {
    posts: PositionNode[];
    canManage: boolean;
    onPosContext: (e: React.MouseEvent, p: PositionNode) => void;
    onContext: (e: React.MouseEvent) => void;
}) {
    if (posts.length === 0) return null;

    const grouped: Record<string, PositionNode[]> = { board: [], chiefExecutive: [], cLevel: [], other: [] };
    for (const p of posts) grouped[classifyPosition(p.title)].push(p);

    const hasClassification = grouped.board.length + grouped.chiefExecutive.length + grouped.cLevel.length > 0;

    const cards = (ps: PositionNode[], accent: "gold" | "blue") =>
        ps.map(p => (
            <PosCard key={p.id} position={p} accent={accent} canManage={canManage} onContextMenu={onPosContext} />
        ));

    return (
        <div
            className={`relative rounded-xl border-2 border-sky-400 dark:border-sky-600 bg-sky-50/50 dark:bg-sky-950/20 px-6 py-5 min-w-[400px] shadow-sm ${canManage ? "cursor-context-menu" : ""}`}
            onContextMenu={(e) => { if (canManage) { e.preventDefault(); onContext(e); } }}
        >
            {/* Header pill */}
            <div className="flex justify-center -mt-9 mb-3">
                <div className="rounded-lg border border-sky-500 bg-card px-4 py-1 shadow-md">
                    <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-sky-700 dark:text-sky-300">
                        <Crown size={12} /> Executive Council
                    </p>
                </div>
            </div>

            {!hasClassification && (
                <div className="flex flex-wrap justify-center gap-2">
                    {cards(grouped.other, "blue")}
                </div>
            )}

            {hasClassification && (
                <>
                    {grouped.board.length > 0 && (
                        <>
                            <SectionLabel>{SECTION_LABELS.board}</SectionLabel>
                            <div className="flex flex-wrap justify-center gap-2">{cards(grouped.board, "gold")}</div>
                        </>
                    )}
                    {grouped.chiefExecutive.length > 0 && (
                        <>
                            <SectionLabel>{SECTION_LABELS.chiefExecutive}</SectionLabel>
                            <div className="flex flex-wrap justify-center gap-2">{cards(grouped.chiefExecutive, "blue")}</div>
                        </>
                    )}
                    {grouped.cLevel.length > 0 && (
                        <>
                            <SectionLabel>{SECTION_LABELS.cLevel}</SectionLabel>
                            <div className="flex flex-wrap justify-center gap-2">{cards(grouped.cLevel, "blue")}</div>
                        </>
                    )}
                    {grouped.other.length > 0 && (
                        <>
                            <SectionLabel>{SECTION_LABELS.other}</SectionLabel>
                            <div className="flex flex-wrap justify-center gap-2">{cards(grouped.other, "blue")}</div>
                        </>
                    )}
                </>
            )}
        </div>
    );
}

function ExecToHQConnector() {
    return (
        <div className="flex flex-col items-center pointer-events-none">
            <div className="w-0.5 h-8 bg-gradient-to-b from-sky-400 to-amber-400" />
        </div>
    );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function OrgRegions({
    structure, canManage = false, onMutated,
}: {
    structure: OrgStructure;
    canManage?: boolean;
    onMutated?: () => void;
}) {
    const [intent, setIntent] = useState<Intent | null>(null);
    const [menu, setMenu] = useState<MenuState | null>(null);
    const [appointFor, setAppointFor] = useState<PositionNode | null>(null);
    const [transferFor, setTransferFor] = useState<{
        positionId: string; positionTitle: string; holderId: number; holderName: string;
    } | null>(null);

    const hqBranch = structure.branches.find(b => b.branch.id === HQ_BRANCH_ID);
    const regionalBranches = structure.branches.filter(b => b.branch.id !== HQ_BRANCH_ID);

    const hqBranchPosts = hqBranch
        ? hqBranch.deptGroups.flatMap(g => g.positions)
        : [];
    const hqBranchName = hqBranch?.branch.name ?? "Headquarters";

    const flatBranches = useMemo(
        () => structure.branches.map(b => ({ id: b.branch.id, name: b.branch.name })),
        [structure],
    );
    const flatDepartments = useMemo(() => {
        const seen = new Map<string, { id: string; name: string; branchId: string | null }>();
        for (const b of structure.branches) {
            for (const g of b.deptGroups) {
                if (g.dept && !seen.has(g.dept.id)) {
                    seen.set(g.dept.id, { id: g.dept.id, name: g.dept.name, branchId: b.branch.id });
                }
            }
        }
        return Array.from(seen.values());
    }, [structure]);

    // Deduped suggestion lists for the create-dialog datalists.
    const positionTitleSuggestions = useMemo(() => {
        const set = new Set<string>();
        for (const p of structure.orgWidePositions) set.add(p.title);
        for (const b of structure.branches) {
            for (const g of b.deptGroups) for (const p of g.positions) set.add(p.title);
        }
        return Array.from(set).sort();
    }, [structure]);
    const departmentNameSuggestions = useMemo(() => {
        const set = new Set<string>();
        for (const d of flatDepartments) set.add(d.name);
        return Array.from(set).sort();
    }, [flatDepartments]);

    const handleDelete = useCallback(async (kind: "branch" | "dept" | "position", id: string, label: string) => {
        const noun = kind === "branch" ? "branch" : kind === "dept" ? "department" : "position";
        if (!(await confirmAction({ title: `Delete ${noun} "${label}"?`, body: `This cannot be undone. The server will refuse if the ${noun} still has linked records (e.g. a position can't be deleted while a user still holds it).`, confirmLabel: "Delete" }))) return;
        const endpoint = kind === "branch" ? "branches" : kind === "dept" ? "departments" : "positions";
        try {
            await axios.delete(`/api/${endpoint}/${encodeURIComponent(id)}`);
            toast.success(`${noun.charAt(0).toUpperCase() + noun.slice(1)} ${label} deleted`);
            onMutated?.();
        } catch (err: unknown) {
            toast.error(extractApiError(err, `Failed to delete ${noun}`));
        }
    }, [onMutated]);

    // handleDelete is invoked directly from the context-menu builders below.

    // ── Holder management (assign / unassign) ────────────────────────────────
    const unassignHolder = useCallback(async (positionId: string, userId: number, userName: string, positionTitle: string) => {
        if (!(await confirmAction({ title: `Remove ${userName} from "${positionTitle}"?`, body: `The position stays; only the holder is detached.`, confirmLabel: "Remove" }))) return;
        try {
            await axios.delete(`/api/positions/${encodeURIComponent(positionId)}/holders/${userId}`);
            toast.success(`${userName} removed from ${positionTitle}`);
            onMutated?.();
        } catch (err: unknown) {
            toast.error(extractApiError(err, "Failed to remove holder"));
        }
    }, [onMutated]);

    // ── Context menu openers ────────────────────────────────────────────────

    const openMenu = useCallback((x: number, y: number, items: MenuEntry[]) => {
        setMenu({ x, y, items });
    }, []);

    const onPosContext = useCallback((e: React.MouseEvent, position: PositionNode) => {
        if (!canManage) return;
        e.preventDefault();
        e.stopPropagation();
        const items: MenuEntry[] = [];

        // Group 1 — profile links (per holder)
        for (const h of position.holders) {
            items.push({
                label: `Open ${h.user.name}'s profile`,
                icon: <Users size={12} />,
                onClick: () => { window.location.href = `/office/social/users/${h.user.id}`; },
            });
        }

        // Group 2 — appoint
        if (items.length > 0) items.push({ divider: true });
        items.push({
            label: "Appoint user…",
            icon: <UserPlus size={12} />,
            onClick: () => setAppointFor(position),
        });

        // Group 3 — per-holder move/remove
        if (position.holders.length > 0) {
            items.push({ divider: true });
            for (const h of position.holders) {
                items.push({
                    label: `Transfer / Promote ${h.user.name}…`,
                    icon: <ArrowRightLeft size={12} />,
                    onClick: () => setTransferFor({
                        positionId: position.id, positionTitle: position.title,
                        holderId: h.user.id, holderName: h.user.name,
                    }),
                });
                items.push({
                    label: `Remove ${h.user.name} (keep position)`,
                    icon: <UserMinus size={12} />,
                    onClick: () => unassignHolder(position.id, h.user.id, h.user.name, position.title),
                });
            }
        }

        // Group 4 — destructive
        items.push({ divider: true });
        items.push({
            label: position.holders.length > 0 ? "Delete position (unassign holders first)" : "Delete position",
            icon: <Trash2 size={12} />,
            danger: true,
            onClick: () => handleDelete("position", position.id, position.title),
        });
        openMenu(e.clientX, e.clientY, items);
    }, [canManage, handleDelete, openMenu, unassignHolder]);

    const onDeptContext = useCallback((
        e: React.MouseEvent, deptId: string, deptName: string, branchId: string | null,
    ) => {
        if (!canManage) return;
        e.preventDefault();
        e.stopPropagation();
        openMenu(e.clientX, e.clientY, [
            {
                label: "Add position to this department",
                icon: <Plus size={12} />,
                onClick: () => setIntent({ mode: "position", branchId, departmentId: deptId }),
            },
            { divider: true },
            {
                label: "Delete department",
                icon: <Trash2 size={12} />,
                danger: true,
                onClick: () => handleDelete("dept", deptId, deptName),
            },
        ]);
    }, [canManage, handleDelete, openMenu]);

    const onExecCouncilContext = useCallback((e: React.MouseEvent) => {
        if (!canManage) return;
        e.preventDefault();
        openMenu(e.clientX, e.clientY, [
            {
                label: "Add org-wide position",
                icon: <Plus size={12} />,
                onClick: () => setIntent({ mode: "position", branchId: null, departmentId: null }),
            },
        ]);
    }, [canManage, openMenu]);

    const onBranchContext = useCallback((e: React.MouseEvent, branchId: string, branchName: string) => {
        if (!canManage) return;
        e.preventDefault();
        e.stopPropagation();
        const isHq = branchId === HQ_BRANCH_ID;
        openMenu(e.clientX, e.clientY, [
            {
                label: "Add department to this branch",
                icon: <Plus size={12} />,
                onClick: () => setIntent({ mode: "department", branchId }),
            },
            {
                label: "Add position to this branch",
                icon: <Plus size={12} />,
                onClick: () => setIntent({ mode: "position", branchId, departmentId: null }),
            },
            { divider: true },
            {
                label: isHq ? "Delete HQ branch" : "Delete branch",
                icon: <Trash2 size={12} />,
                danger: true,
                onClick: () => handleDelete("branch", branchId, branchName),
            },
        ]);
    }, [canManage, handleDelete, openMenu]);

    return (
        <div className="rounded-xl bg-gradient-to-br from-amber-50/40 via-card to-emerald-50/40 dark:from-amber-950/10 dark:via-card dark:to-emerald-950/10 p-6 sm:p-10 overflow-x-auto border border-border">
            {/* Legend bar */}
            <div className="flex justify-center flex-wrap gap-4 mb-8 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-sky-500" /> Executive Council (org-wide)</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> Headquarters (HQ branch)</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Regional Branch</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400" /> Branch Manager / Staff</span>
            </div>

            {canManage && (
                <p className="text-center text-[10px] text-muted-foreground mb-3 italic">
                    Tip: right-click any card for actions — Add · Appoint · Transfer · Remove · Delete.
                </p>
            )}

            {/* EXECUTIVE COUNCIL — org-wide positions, sits above HQ */}
            {structure.orgWidePositions.length > 0 && (
                <div className="flex flex-col items-center mb-0">
                    <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-3">Organisation</p>
                    <ExecCouncilBand
                        posts={structure.orgWidePositions}
                        canManage={canManage}
                        onPosContext={onPosContext}
                        onContext={onExecCouncilContext}
                    />
                </div>
            )}

            {/* Connector: Executive Council → HQ */}
            {structure.orgWidePositions.length > 0 && <ExecToHQConnector />}

            {/* HEADQUARTERS — BR-HQ branch positions only */}
            <div className="flex flex-col items-center mb-0">
                {structure.orgWidePositions.length === 0 && (
                    <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-3">Headquarters</p>
                )}
                <HQContainer
                    hqBranchPosts={hqBranchPosts}
                    hqBranchName={hqBranchName}
                    hqBranchExists={!!hqBranch}
                    canManage={canManage}
                    onCreateHQ={() => setIntent({ mode: "branch", forceId: HQ_BRANCH_ID, isHq: true })}
                    onPosContext={onPosContext}
                    onBranchContext={onBranchContext}
                />
            </div>

            {regionalBranches.length > 0 && (
                <HQBranchConnector branchCount={regionalBranches.length} />
            )}

            {(regionalBranches.length > 0 || canManage) && (
                <div className="mt-0">
                    {regionalBranches.length > 0 && (
                        <div className="flex flex-wrap justify-center items-start gap-3">
                            {regionalBranches.map(bg => (
                                <div key={bg.branch.id} className="flex flex-col items-center">
                                    <BranchTopStem />
                                    <BranchContainer
                                        bg={bg}
                                        canManage={canManage}
                                        onPosContext={onPosContext}
                                        onDeptContext={onDeptContext}
                                        onBranchContext={onBranchContext}
                                    />
                                </div>
                            ))}
                        </div>
                    )}
                    <div className="flex items-center justify-center gap-3 mt-6">
                        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                            Regional Branches
                        </p>
                        {canManage && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setIntent({ mode: "branch" })}
                                className="h-7 px-2 text-[11px] border-emerald-400 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                            >
                                <Plus size={12} className="mr-1" />
                                Add branch
                            </Button>
                        )}
                    </div>
                </div>
            )}

            <div className="mt-10 pt-6 border-t border-border/60 flex justify-center flex-wrap gap-6 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                    <Crown size={11} className="text-sky-500" />
                    {structure.orgWidePositions.length} org-wide position{structure.orgWidePositions.length !== 1 ? "s" : ""}
                </span>
                <span className="flex items-center gap-1.5">
                    <Landmark size={11} className="text-amber-500" />
                    {hqBranchPosts.length} HQ branch position{hqBranchPosts.length !== 1 ? "s" : ""}
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

            <OrgRegionsCreateDialog
                intent={intent}
                branches={flatBranches}
                departments={flatDepartments}
                positionTitles={positionTitleSuggestions}
                departmentNames={departmentNameSuggestions}
                onClose={() => setIntent(null)}
                onCreated={() => onMutated?.()}
            />

            <ContextMenu menu={menu} onClose={() => setMenu(null)} />

            <OrgTransferDialog
                open={transferFor !== null}
                sourcePositionId={transferFor?.positionId ?? null}
                sourceTitle={transferFor?.positionTitle ?? null}
                holderUserId={transferFor?.holderId ?? null}
                holderName={transferFor?.holderName ?? null}
                onClose={() => setTransferFor(null)}
                onTransferred={() => onMutated?.()}
            />

            <OrgAppointDialog
                open={appointFor !== null}
                positionId={appointFor?.id ?? null}
                positionTitle={appointFor?.title ?? null}
                existingHolderIds={appointFor?.holders.map(h => h.user.id) ?? []}
                onClose={() => setAppointFor(null)}
                onAppointed={() => onMutated?.()}
            />
        </div>
    );
}
