"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronDown, ChevronRight, Building2, Layers, Briefcase } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PostNode } from "@/app/api/posts/structure/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string) {
    return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

const AVATAR_COLOR: Record<string, string> = {
    R1: "bg-purple-100 text-purple-700", R2: "bg-blue-100 text-blue-700",
    R3: "bg-green-100 text-green-700",   R4: "bg-orange-100 text-orange-700",
    R5: "bg-pink-100 text-pink-700",
};

type HolderUser = PostNode["holders"][number]["user"];

function HolderAvatar({ user }: { user: HolderUser }) {
    const [imgErr, setImgErr] = useState(false);
    if (user.avatarUrl && !imgErr) {
        return (
            <div className="rounded-full overflow-hidden shrink-0 w-8 h-8 border-2 border-card">
                <Image src={user.avatarUrl} alt={user.name} width={32} height={32}
                    className="object-cover w-full h-full" onError={() => setImgErr(true)} />
            </div>
        );
    }
    return (
        <div className={`flex shrink-0 items-center justify-center rounded-full w-8 h-8 text-xs font-bold border-2 border-card ${AVATAR_COLOR[user.role] ?? "bg-gray-100 text-gray-600"}`}>
            {initials(user.name)}
        </div>
    );
}

// ── Post card ─────────────────────────────────────────────────────────────────

function PostCard({ node }: { node: PostNode }) {
    const [open, setOpen] = useState(true);
    const hasChildren = node.children.length > 0;
    const isOrgWide = !node.branchId;

    return (
        <div className="flex flex-col items-center">
            <div
                className={[
                    "border-2 bg-card w-52 text-center px-3 py-2.5 shadow-sm transition-shadow hover:shadow-md",
                    isOrgWide ? "border-orange-400" : "border-border",
                ].join(" ")}
            >
                {/* Post title */}
                <p className="text-sm font-semibold leading-tight text-foreground">{node.title}</p>

                {/* Scope badge */}
                <div className="flex items-center justify-center gap-1 mt-1">
                    {isOrgWide ? (
                        <span className="text-[10px] text-orange-600 flex items-center gap-0.5"><Briefcase size={9} /> Executive Council</span>
                    ) : node.department ? (
                        <span className="text-[10px] text-muted-foreground flex items-center gap-0.5"><Layers size={9} /> {node.department.name}</span>
                    ) : (
                        <span className="text-[10px] text-muted-foreground flex items-center gap-0.5"><Building2 size={9} /> {node.branch?.name}</span>
                    )}
                </div>

                {/* Holders */}
                {node.holders.length === 0 ? (
                    <p className="mt-2 text-[10px] text-muted-foreground italic">Vacant</p>
                ) : (
                    <div className="mt-2 space-y-1">
                        {node.holders.map(h => (
                            <Link
                                key={h.user.id}
                                href={`/users/${h.user.id}`}
                                className="flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-muted transition-colors"
                                title={h.user.name}
                            >
                                <HolderAvatar user={h.user} />
                                <div className="flex-1 min-w-0 text-left">
                                    <p className="text-[11px] font-medium truncate">{h.user.name}</p>
                                    <Badge className={`${h.user.userRole.color} text-[9px] px-1 py-0`}>{h.user.userRole.label}</Badge>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}

                {/* Expand toggle */}
                {hasChildren && (
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setOpen(o => !o)}
                        className="mt-2 mx-auto h-auto items-center justify-center gap-0.5 p-0 text-[10px] text-muted-foreground hover:text-foreground"
                    >
                        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                        {node.children.length} sub-post{node.children.length !== 1 ? "s" : ""}
                    </Button>
                )}
            </div>

            {/* Children */}
            {hasChildren && open && (
                <div className="mt-6 flex flex-col items-center">
                    <div className="h-4 w-px bg-border" />
                    {node.children.length === 1 ? (
                        <PostCard node={node.children[0]} />
                    ) : (
                        <div className="flex flex-col items-center">
                            <div className="h-px bg-border" style={{ width: `${node.children.length * 224}px` }} />
                            <div className="flex gap-0">
                                {node.children.map(child => (
                                    <div key={child.id} className="flex flex-col items-center" style={{ width: "224px" }}>
                                        <div className="h-4 w-px bg-border" />
                                        <PostCard node={child} />
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

// ── Public component ──────────────────────────────────────────────────────────

export default function StructureTree({ roots }: { roots: PostNode[] }) {
    if (roots.length === 0) return null;
    return (
        <div className="overflow-auto pb-12">
            <div className="flex gap-16 min-w-max pt-4">
                {roots.map(root => (
                    <PostCard key={root.id} node={root} />
                ))}
            </div>
        </div>
    );
}
