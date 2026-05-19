"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import axios from "axios";
import { Briefcase, Link as LinkIcon, Sparkles, Network, Landmark, Move } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { OrgStructure } from "@/shared/types/orgChart";
import StructureTree from "@/modules/admin/components/StructureTree";
import OrgExplorer from "@/modules/admin/components/OrgExplorer";
import OrgHierarchy from "@/modules/admin/components/OrgHierarchy";
import OrgRegions from "@/modules/admin/components/OrgRegions";
import OrgCanvas from "@/modules/admin/components/OrgCanvas";

type Tab = "structure" | "explorer" | "hierarchy" | "regions" | "canvas";

export default function OrgChartPage() {
    const { data: session } = useSession();
    const [tab, setTab] = useState<Tab>("structure");
    const [structure, setStructure] = useState<OrgStructure | null>(null);
    const [postLoading, setPostLoading] = useState(true);

    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const canManage   = permissions.includes("settings:manage");

    const loadStructure = useCallback(() => {
        axios.get<OrgStructure>("/api/positions/structure")
            .then(r => setStructure(r.data))
            .finally(() => setPostLoading(false));
    }, []);

    useEffect(() => { loadStructure(); }, [loadStructure]);

    const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
        { id: "structure", label: "Structure Chart",  icon: Briefcase },
        { id: "explorer",  label: "Explorer (beta)",   icon: Sparkles },
        { id: "hierarchy", label: "Hierarchy (beta)",  icon: Network },
        { id: "regions",   label: "Regions (beta)",    icon: Landmark },
        { id: "canvas",    label: "Canvas (beta)",     icon: Move },
    ];

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Org Chart</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {tab === "structure"
                            ? "Position hierarchy — click a name to view their profile."
                            : tab === "explorer"
                                ? "Interactive explorer — search, filter, hover for details."
                                : tab === "hierarchy"
                                    ? "True organizational hierarchy — root → branches → departments → positions."
                                    : tab === "regions"
                                        ? "HQ + branches with nested boundaries — bordered containers for each region."
                                        : "Free-form canvas — drag cards around, pan with space-drag, zoom with the wheel."}
                    </p>
                </div>
                <Link href="/office/admin/positions" className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors">
                    <LinkIcon size={11} /> Manage positions
                </Link>
            </div>

            {/* Tab bar */}
            <div className="flex border-b border-border">
                {TABS.map(t => {
                    const Icon = t.icon;
                    const active = tab === t.id;
                    return (
                        <Button
                            key={t.id}
                            type="button"
                            variant="ghost"
                            onClick={() => setTab(t.id)}
                            className={[
                                "h-auto flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-0.5 rounded-none transition-colors",
                                active
                                    ? "border-primary text-primary"
                                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
                            ].join(" ")}
                        >
                            <Icon size={14} />
                            {t.label}
                        </Button>
                    );
                })}
            </div>

            {/* Structure chart */}
            {tab === "structure" && (
                postLoading ? (
                    <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">Loading…</div>
                ) : !structure || (structure.orgWidePositions.length === 0 && structure.branches.every(b => b.deptGroups.length === 0)) ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
                        <Briefcase size={36} className="opacity-20" />
                        <p className="text-sm">No positions defined yet.</p>
                        <Link href="/office/admin/positions" className="text-xs text-primary hover:underline">
                            Create your first position →
                        </Link>
                    </div>
                ) : (
                    <StructureTree structure={structure} />
                )
            )}

            {/* Explorer (beta) — interactive dashboard view */}
            {tab === "explorer" && (
                postLoading ? (
                    <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">Loading…</div>
                ) : !structure ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
                        <Sparkles size={36} className="opacity-20" />
                        <p className="text-sm">No data to explore yet.</p>
                    </div>
                ) : (
                    <OrgExplorer structure={structure} />
                )
            )}

            {/* Hierarchy (beta) — true top-down org chart */}
            {tab === "hierarchy" && (
                postLoading ? (
                    <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">Loading…</div>
                ) : !structure ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
                        <Network size={36} className="opacity-20" />
                        <p className="text-sm">No org structure yet.</p>
                    </div>
                ) : (
                    <OrgHierarchy structure={structure} />
                )
            )}

            {/* Regions (beta) — HQ + branches with nested bordered containers */}
            {tab === "regions" && (
                postLoading ? (
                    <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">Loading…</div>
                ) : !structure ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
                        <Landmark size={36} className="opacity-20" />
                        <p className="text-sm">No org structure yet.</p>
                    </div>
                ) : (
                    <OrgRegions structure={structure} canManage={canManage} onMutated={loadStructure} />
                )
            )}

            {/* Canvas (beta) — custom pan/zoom/drag visualization */}
            {tab === "canvas" && (
                postLoading ? (
                    <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">Loading…</div>
                ) : !structure ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
                        <Move size={36} className="opacity-20" />
                        <p className="text-sm">No org structure yet.</p>
                    </div>
                ) : (
                    <OrgCanvas structure={structure} />
                )
            )}
        </div>
    );
}
