"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { ChevronDown, ChevronRight, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { OrgNode } from "@/app/api/org-chart/route";

function initials(name: string) {
    return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

function avatarColor(role: string) {
    const colors: Record<string, string> = {
        R1: "bg-purple-100 text-purple-700",
        R2: "bg-blue-100 text-blue-700",
        R3: "bg-green-100 text-green-700",
        R4: "bg-orange-100 text-orange-700",
        R5: "bg-pink-100 text-pink-700",
    };
    return colors[role] ?? "bg-gray-100 text-gray-600";
}

function OrgCard({ node }: { node: OrgNode }) {
    const [open, setOpen] = useState(true);
    const hasChildren = node.children.length > 0;

    return (
        <div className="flex flex-col items-center">
            {/* Card */}
            <div className="relative">
                <Link
                    href={`/users/${node.id}`}
                    className="group flex flex-col items-center gap-1.5 rounded-none border-2 border-border bg-card px-4 py-3 shadow-sm transition-all hover:border-primary hover:shadow-md w-44 text-center"
                >
                    {/* Avatar */}
                    <div className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold ${avatarColor(node.role)}`}>
                        {initials(node.name)}
                    </div>

                    {/* Name + title */}
                    <div>
                        <p className="text-sm font-semibold text-foreground leading-tight group-hover:text-primary transition-colors">
                            {node.name}
                        </p>
                        {node.title && (
                            <p className="mt-0.5 text-[11px] text-muted-foreground leading-tight">{node.title}</p>
                        )}
                    </div>

                    {/* Role badge */}
                    <Badge className={`${node.userRole.color} text-[10px] px-1.5 py-0`}>
                        {node.userRole.label}
                    </Badge>

                    {/* Dept + branch chips */}
                    {(node.departments.length > 0 || node.branches.length > 0) && (
                        <div className="flex flex-wrap justify-center gap-1 mt-0.5">
                            {node.departments.map(d => (
                                <span key={d.id} className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 leading-none">
                                    {d.name}
                                </span>
                            ))}
                            {node.branches.map(b => (
                                <span key={b.id} className="text-[10px] bg-orange-50 text-orange-700 border border-orange-200 px-1.5 py-0.5 leading-none">
                                    {b.name}
                                </span>
                            ))}
                        </div>
                    )}
                </Link>

                {/* Expand/collapse toggle */}
                {hasChildren && (
                    <button
                        onClick={() => setOpen(o => !o)}
                        className="absolute -bottom-3.5 left-1/2 -translate-x-1/2 z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 border-border bg-card text-muted-foreground shadow-sm hover:border-primary hover:text-primary transition-colors"
                        title={open ? "Collapse" : "Expand"}
                    >
                        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </button>
                )}
            </div>

            {/* Children */}
            {hasChildren && open && (
                <div className="mt-7 flex flex-col items-center">
                    {/* Vertical line down from card */}
                    <div className="h-4 w-px bg-border" />

                    {node.children.length === 1 ? (
                        <OrgCard node={node.children[0]} />
                    ) : (
                        <div className="flex flex-col items-center">
                            {/* Horizontal bar */}
                            <div
                                className="h-px bg-border"
                                style={{ width: `${node.children.length * 192}px` }}
                            />
                            {/* Vertical drops + children */}
                            <div className="flex gap-0">
                                {node.children.map(child => (
                                    <div key={child.id} className="flex flex-col items-center" style={{ width: "192px" }}>
                                        <div className="h-4 w-px bg-border" />
                                        <OrgCard node={child} />
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default function OrgChartPage() {
    const [roots, setRoots] = useState<OrgNode[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        axios.get<OrgNode[]>("/api/org-chart")
            .then(r => setRoots(r.data))
            .catch(() => {/* toast handled by layout */})
            .finally(() => setLoading(false));
    }, []);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">
                Loading org chart…
            </div>
        );
    }

    if (roots.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
                <Users size={36} className="opacity-20" />
                <p className="text-sm">No users yet. Add staff from the Users page.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Org Chart</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Click any card to view the full profile. Use the toggle to collapse branches.
                </p>
            </div>

            <div className="overflow-auto pb-12">
                <div className="flex gap-16 min-w-max pt-4">
                    {roots.map(root => (
                        <OrgCard key={root.id} node={root} />
                    ))}
                </div>
            </div>
        </div>
    );
}
