"use client";

// Level-based organizational hierarchy view.
// Inspired by the classic "company hierarchy chart" pattern — each tier sits
// on its own horizontal row, color-coded, with simple connectors between
// levels. Easy to read at a glance; not interactive in the click-to-highlight
// sense, just a clean, animated visual representation of the structure.
//
// Tiers (top to bottom):
//   L1 — Board / Executive Council  (gold)    — org-wide posts
//   L2 — Branches                    (blue)    — each branch
//   L3 — Departments                 (green)   — branch+dept combos
//   L4 — Positions                   (purple)  — every post with holders
//
// Animations: each level fades up with a staggered delay (Tailwind only —
// uses arbitrary inline styles for the animation-delay).

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Crown, Building2, Layers, Briefcase, Users, AlertCircle } from "lucide-react";
import type { OrgStructure, PositionNode } from "@/shared/types/orgChart";

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string) {
    return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

const AVATAR_COLOR: Record<string, string> = {
    R1: "bg-purple-200 text-purple-900",
    R2: "bg-blue-200 text-blue-900",
    R3: "bg-green-200 text-green-900",
    R4: "bg-orange-200 text-orange-900",
};

function Avatar({ user, size = 32 }: { user: PositionNode["holders"][number]["user"]; size?: number }) {
    const [imgErr, setImgErr] = useState(false);
    if (user.avatarUrl && !imgErr) {
        return (
            <Image
                src={user.avatarUrl} alt={user.name} width={size} height={size}
                style={{ width: size, height: size }}
                className="rounded-full object-cover ring-2 ring-white/15 shrink-0"
                onError={() => setImgErr(true)}
            />
        );
    }
    const cls = user.role ? (AVATAR_COLOR[user.role] ?? "bg-gray-200 text-gray-700") : "bg-gray-200 text-gray-700";
    return (
        <div
            style={{ width: size, height: size, fontSize: size * 0.38 }}
            className={`flex shrink-0 items-center justify-center rounded-full font-bold ring-2 ring-white/15 ${cls}`}
        >
            {initials(user.name)}
        </div>
    );
}

// ── Card primitives (per level) ──────────────────────────────────────────────

interface LevelCardProps {
    icon: React.ReactNode;
    name: string;
    title?: string;
    accent: "l1" | "l2" | "l3" | "l4";
    href?: string;
    vacant?: boolean;
    delay?: number;
}

const LEVEL_STYLES: Record<LevelCardProps["accent"], { card: string; name: string; avatar: string }> = {
    l1: {
        card:   "bg-[#1a1200] border-amber-400",
        name:   "text-amber-300",
        avatar: "bg-amber-950/60",
    },
    l2: {
        card:   "bg-[#0d1f2d] border-blue-500",
        name:   "text-sky-300",
        avatar: "bg-blue-950/60",
    },
    l3: {
        card:   "bg-[#121d14] border-emerald-500",
        name:   "text-emerald-300",
        avatar: "bg-emerald-950/60",
    },
    l4: {
        card:   "bg-[#1c1220] border-violet-400",
        name:   "text-violet-300",
        avatar: "bg-violet-950/60",
    },
};

function LevelCard({ icon, name, title, accent, href, vacant, delay = 0 }: LevelCardProps) {
    const s = LEVEL_STYLES[accent];
    const inner = (
        <div
            className={[
                "flex flex-col items-center w-[148px] px-2.5 py-3.5 rounded-xl border-2 shadow-sm",
                "transition-all duration-200 hover:-translate-y-1 hover:shadow-2xl hover:shadow-black/40",
                s.card,
                "opacity-0",
            ].join(" ")}
            style={{
                animation: `orgLevelFadeUp 0.5s ease both`,
                animationDelay: `${delay}ms`,
            }}
        >
            <div className={`flex items-center justify-center w-12 h-12 rounded-full mb-2 text-xl ${s.avatar} ring-2 ring-white/10`}>
                {icon}
            </div>
            <p className={`text-[13px] font-semibold text-center leading-snug ${s.name}`}>{name}</p>
            {title && (
                <p className="text-[11px] text-white/60 text-center mt-0.5 leading-tight">{title}</p>
            )}
            {vacant && (
                <span className="mt-1.5 inline-flex items-center gap-0.5 rounded bg-amber-500/20 text-amber-300 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider">
                    <AlertCircle size={9} /> Vacant
                </span>
            )}
        </div>
    );
    return href ? <Link href={href} className="block">{inner}</Link> : inner;
}

// ── Connector between levels ─────────────────────────────────────────────────

function VConnector({ delay = 0 }: { delay?: number }) {
    return (
        <div
            className="w-0.5 h-8 mx-auto opacity-0"
            style={{
                background: "linear-gradient(to bottom, rgba(56,139,253,0.35), rgba(56,139,253,1))",
                animation: "orgLevelFadeIn 0.4s ease both",
                animationDelay: `${delay}ms`,
            }}
        />
    );
}


// ── Main component ───────────────────────────────────────────────────────────

export default function OrgLevels({ structure }: { structure: OrgStructure }) {
    const { orgWidePositions, branches } = structure;

    // Flatten data per level
    const l1Positions = orgWidePositions;
    const l2Branches = branches.map(bg => ({
        ...bg.branch,
        positionCount: bg.deptGroups.reduce((s, g) => s + g.positions.length, 0),
    }));
    const l3DeptsByBranch: { branchName: string; dept: { id: string; name: string } | null; positionCount: number }[] = [];
    branches.forEach(bg => {
        bg.deptGroups.forEach(g => {
            l3DeptsByBranch.push({ branchName: bg.branch.name, dept: g.dept, positionCount: g.positions.length });
        });
    });
    const l4Positions: { position: PositionNode; context: string }[] = [];
    branches.forEach(bg => {
        bg.deptGroups.forEach(g => {
            g.positions.forEach(p => {
                l4Positions.push({
                    position: p,
                    context: g.dept ? `${bg.branch.name} · ${g.dept.name}` : bg.branch.name,
                });
            });
        });
    });

    return (
        <div className="rounded-xl bg-[#0d1117] p-6 sm:p-10 overflow-x-auto border border-border">
            {/* Keyframes injected once */}
            <style jsx>{`
                @keyframes orgLevelFadeUp {
                    from { opacity: 0; transform: translateY(16px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
                @keyframes orgLevelFadeIn {
                    from { opacity: 0; }
                    to   { opacity: 1; }
                }
            `}</style>

            {/* Header */}
            <div className="text-center mb-10">
                <h2 className="text-2xl sm:text-3xl font-bold tracking-wide text-amber-300" style={{ fontFamily: "ui-serif, Georgia, serif" }}>
                    Organizational Hierarchy
                </h2>
                <p className="text-sm text-white/50 mt-1">
                    Level-based view — Board · Branches · Departments · Positions
                </p>
            </div>

            <div className="flex flex-col items-center gap-0">

                {/* ── LEVEL 1 — Board / Executive Council ─────────────────── */}
                <div className="flex justify-center flex-wrap gap-4">
                    {l1Positions.length === 0 ? (
                        <LevelCard
                            icon={<Crown size={22} className="text-amber-300" />}
                            name="Board of Directors"
                            title="No org-wide positions yet"
                            accent="l1"
                            delay={0}
                        />
                    ) : (
                        l1Positions.map((p, i) => (
                            <LevelCard
                                key={p.id}
                                icon={<Crown size={22} className="text-amber-300" />}
                                name={p.holders[0]?.user.name ?? p.title}
                                title={p.title + (p.holders.length > 1 ? ` (+${p.holders.length - 1})` : "")}
                                accent="l1"
                                vacant={p.holders.length === 0}
                                href={p.holders[0] ? `/office/social/users/${p.holders[0].user.id}` : undefined}
                                delay={i * 80}
                            />
                        ))
                    )}
                </div>

                {l2Branches.length > 0 && <VConnector delay={200} />}

                {/* ── LEVEL 2 — Branches ──────────────────────────────────── */}
                {l2Branches.length > 0 && (
                    <div className="flex justify-center flex-wrap gap-4">
                        {l2Branches.map((b, i) => (
                            <LevelCard
                                key={b.id}
                                icon={<Building2 size={22} className="text-sky-300" />}
                                name={b.name}
                                title={`${b.positionCount} position${b.positionCount !== 1 ? "s" : ""}`}
                                accent="l2"
                                delay={300 + i * 80}
                            />
                        ))}
                    </div>
                )}

                {l3DeptsByBranch.length > 0 && <VConnector delay={500} />}

                {/* ── LEVEL 3 — Departments ───────────────────────────────── */}
                {l3DeptsByBranch.length > 0 && (
                    <div className="flex justify-center flex-wrap gap-4">
                        {l3DeptsByBranch.map((d, i) => (
                            <LevelCard
                                key={`${d.branchName}-${d.dept?.id ?? "no-dept"}-${i}`}
                                icon={<Layers size={22} className="text-emerald-300" />}
                                name={d.dept?.name ?? "Branch-level"}
                                title={`${d.branchName} · ${d.positionCount} pos`}
                                accent="l3"
                                delay={600 + i * 80}
                            />
                        ))}
                    </div>
                )}

                {l4Positions.length > 0 && <VConnector delay={800} />}

                {/* ── LEVEL 4 — Positions (with holders) ──────────────────── */}
                {l4Positions.length > 0 && (
                    <div className="flex justify-center flex-wrap gap-4">
                        {l4Positions.map(({ position, context }, i) => {
                            const holder = position.holders[0];
                            return (
                                <LevelCard
                                    key={position.id}
                                    icon={holder
                                        ? <Avatar user={holder.user} size={44} />
                                        : <Briefcase size={22} className="text-violet-300" />
                                    }
                                    name={holder?.user.name ?? position.title}
                                    title={holder ? position.title : context}
                                    accent="l4"
                                    vacant={!holder}
                                    href={holder ? `/office/social/users/${holder.user.id}` : undefined}
                                    delay={900 + i * 70}
                                />
                            );
                        })}
                    </div>
                )}

                {l4Positions.length === 0 && l1Positions.length === 0 && (
                    <p className="text-white/40 text-sm italic mt-6">No positions defined yet</p>
                )}
            </div>

            {/* Legend */}
            <div className="flex justify-center flex-wrap gap-6 mt-12 pt-6 border-t border-white/10">
                <div className="flex items-center gap-2 text-xs text-white/60">
                    <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                    <Users size={11} /> Level 1 — Board / Executive Council
                </div>
                <div className="flex items-center gap-2 text-xs text-white/60">
                    <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                    <Building2 size={11} /> Level 2 — Branches
                </div>
                <div className="flex items-center gap-2 text-xs text-white/60">
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    <Layers size={11} /> Level 3 — Departments
                </div>
                <div className="flex items-center gap-2 text-xs text-white/60">
                    <div className="w-2.5 h-2.5 rounded-full bg-violet-400" />
                    <Briefcase size={11} /> Level 4 — Positions
                </div>
            </div>
        </div>
    );
}
