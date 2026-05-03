"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import axios from "axios";
import { Users, Briefcase, Link as LinkIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { OrgNode } from "@/app/api/org-chart/route";
import type { PostNode } from "@/app/api/posts/structure/route";
import OrgTree from "@/modules/admin/components/OrgTree";
import StructureTree from "@/modules/admin/components/StructureTree";

type Tab = "people" | "structure";

export default function OrgChartPage() {
    const { data: session } = useSession();
    const [tab, setTab]         = useState<Tab>("people");
    const [roots, setRoots]     = useState<OrgNode[]>([]);
    const [postRoots, setPostRoots] = useState<PostNode[]>([]);
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
        axios.get<PostNode[]>("/api/posts/structure")
            .then(r => setPostRoots(r.data))
            .finally(() => setPostLoading(false));
    }, []);

    const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
        { id: "people",    label: "People Chart",    icon: Users },
        { id: "structure", label: "Structure Chart",  icon: Briefcase },
    ];

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Org Chart</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {tab === "people"
                            ? "Reporting lines based on who manages whom."
                            : "Position hierarchy — click a name to view their profile."}
                    </p>
                </div>
                {tab === "structure" && (
                    <Link href="/office/posts" className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors">
                        <LinkIcon size={11} /> Manage posts
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
                ) : postRoots.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
                        <Briefcase size={36} className="opacity-20" />
                        <p className="text-sm">No posts defined yet.</p>
                        <Link href="/office/posts" className="text-xs text-primary hover:underline">
                            Create your first post →
                        </Link>
                    </div>
                ) : (
                    <StructureTree roots={postRoots} />
                )
            )}
        </div>
    );
}
