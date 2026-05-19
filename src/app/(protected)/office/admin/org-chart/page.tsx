"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import axios from "axios";
import { Users, Briefcase, Link as LinkIcon, Sparkles, Network, Layers, Landmark } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { OrgNode, OrgStructure } from "@/shared/types/orgChart";
import OrgTree from "@/modules/admin/components/OrgTree";
import StructureTree from "@/modules/admin/components/StructureTree";
import OrgExplorer from "@/modules/admin/components/OrgExplorer";
import OrgHierarchy from "@/modules/admin/components/OrgHierarchy";
import OrgLevels from "@/modules/admin/components/OrgLevels";
import OrgRegions from "@/modules/admin/components/OrgRegions";

type Tab = "people" | "structure" | "explorer" | "hierarchy" | "levels" | "regions";

export default function OrgChartPage() {
    const { data: session } = useSession();
    const [tab, setTab] = useState<Tab>("people");
    const [roots, setRoots] = useState<OrgNode[]>([]);
    const [structure, setStructure] = useState<OrgStructure | null>(null);
    const [loading, setLoading] = useState(true);
    const [postLoading, setPostLoading] = useState(true);

    const currentUserId = session?.user
        ? Number((session.user as { id?: string }).id)
        : undefined;

    useEffect(() => {
        axios.get<OrgNode[]>("/api/org-chart")
            .then(r => setRoots(r.data))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        axios.get<OrgStructure>("/api/positions/structure")
            .then(r => setStructure(r.data))
            .finally(() => setPostLoading(false));
    }, []);

    const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
        { id: "people",    label: "People Chart",     icon: Users },
        { id: "structure", label: "Structure Chart",  icon: Briefcase },
        { id: "explorer",  label: "Explorer (beta)",   icon: Sparkles },
        { id: "hierarchy", label: "Hierarchy (beta)",  icon: Network },
        { id: "levels",    label: "Levels (beta)",     icon: Layers },
        { id: "regions",   label: "Regions (beta)",    icon: Landmark },
    ];

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Org Chart</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {tab === "people"
                            ? "Reporting lines based on who manages whom."
                            : tab === "structure"
                                ? "Position hierarchy — click a name to view their profile."
                                : tab === "explorer"
                                    ? "Interactive explorer — search, filter, hover for details."
                                    : tab === "hierarchy"
                                        ? "True organizational hierarchy — root → branches → departments → positions."
                                        : tab === "levels"
                                            ? "Classic level-based chart — Board · Branches · Departments · Positions."
                                            : "HQ + branches with nested boundaries — bordered containers for each region."}
                    </p>
                </div>
                {tab !== "people" && (
                    <Link href="/office/admin/positions" className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors">
                        <LinkIcon size={11} /> Manage positions
                    </Link>
                )}
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

            {/* People chart */}
            {tab === "people" && (
                loading ? (
                    <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">Loading…</div>
                ) : roots.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
                        <Users size={36} className="opacity-20" />
                        <p className="text-sm">No users yet. Add staff from the Users page.</p>
                    </div>
                ) : (
                    <OrgTree roots={roots} highlightId={currentUserId} />
                )
            )}

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

            {/* Levels (beta) — classic level-based hierarchy chart */}
            {tab === "levels" && (
                postLoading ? (
                    <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">Loading…</div>
                ) : !structure ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
                        <Layers size={36} className="opacity-20" />
                        <p className="text-sm">No org structure yet.</p>
                    </div>
                ) : (
                    <OrgLevels structure={structure} />
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
                    <OrgRegions structure={structure} />
                )
            )}
        </div>
    );
}
