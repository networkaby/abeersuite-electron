"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { OrgNode } from "@/shared/types/orgChart";

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string) {
    return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

const AVATAR_COLOR: Record<string, string> = {
    R1: "bg-purple-100 text-purple-700",
    R2: "bg-blue-100 text-blue-700",
    R3: "bg-green-100 text-green-700",
    R4: "bg-orange-100 text-orange-700",
    R5: "bg-pink-100 text-pink-700",
};

function avatarBg(role: string | null) {
    return (role ? AVATAR_COLOR[role] : null) ?? "bg-gray-100 text-gray-600";
}

function containsHighlight(node: OrgNode, id: number): boolean {
    return node.id === id || node.children.some(c => containsHighlight(c, id));
}

// ── Avatar (photo or initials fallback) ──────────────────────────────────────

function NodeAvatar({ node, sizePx = 40 }: { node: OrgNode; sizePx?: number }) {
    const [imgError, setImgError] = useState(false);

    if (node.avatarUrl && !imgError) {
        return (
            <div className="rounded-full overflow-hidden shrink-0" style={{ width: sizePx, height: sizePx }}>
                <Image
                    src={node.avatarUrl}
                    alt={node.name}
                    width={sizePx}
                    height={sizePx}
                    className="object-cover w-full h-full"
                    onError={() => setImgError(true)}
                />
            </div>
        );
    }

    return (
        <div
            className={`flex shrink-0 items-center justify-center rounded-full text-sm font-bold ${avatarBg(node.role)}`}
            style={{ width: sizePx, height: sizePx }}
        >
            {initials(node.name)}
        </div>
    );
}

// ── Node wrapper (owns open/close state) ──────────────────────────────────────

function OrgNodeWrapper({
    node,
    highlightId,
    highlightRef,
}: {
    node: OrgNode;
    highlightId?: number;
    highlightRef: React.RefObject<HTMLDivElement | null>;
}) {
    const shouldStartOpen =
        node.children.length > 0 &&
        (highlightId === undefined || containsHighlight(node, highlightId));

    const [open, setOpen] = useState(shouldStartOpen);
    const isHighlighted   = node.id === highlightId;
    const hasChildren     = node.children.length > 0;

    return (
        <div className="flex flex-col items-center">
            {/* Card */}
            <div className="relative" ref={isHighlighted ? highlightRef : undefined}>
                <Link
                    href={`/office/social/users/${node.id}`}
                    className={[
                        "group flex flex-col items-center gap-1.5 border-2 bg-card px-4 py-3 shadow-sm transition-all hover:shadow-md w-44 text-center",
                        isHighlighted
                            ? "border-primary ring-2 ring-primary/20"
                            : "border-border hover:border-primary",
                    ].join(" ")}
                >
                    <NodeAvatar node={node} sizePx={40} />
                    <div>
                        <p className={`text-sm font-semibold leading-tight transition-colors ${isHighlighted ? "text-primary" : "text-foreground group-hover:text-primary"}`}>
                            {node.name}
                        </p>
                        {node.title && (
                            <p className="mt-0.5 text-[11px] text-muted-foreground leading-tight">{node.title}</p>
                        )}
                    </div>
                    {node.userRole && (
                        <Badge className={`${node.userRole.color} text-[10px] px-1.5 py-0`}>
                            {node.userRole.label}
                        </Badge>
                    )}
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

                {hasChildren && (
                    <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        onClick={() => setOpen(o => !o)}
                        className="absolute -bottom-3.5 left-1/2 z-10 -translate-x-1/2 rounded-full text-muted-foreground shadow-sm transition-colors hover:border-primary hover:text-primary"
                        title={open ? "Collapse" : "Expand"}
                    >
                        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </Button>
                )}
            </div>

            {/* Children */}
            {hasChildren && open && (
                <div className="mt-7 flex flex-col items-center">
                    <div className="h-4 w-px bg-border" />
                    {node.children.length === 1 ? (
                        <OrgNodeWrapper
                            node={node.children[0]}
                            highlightId={highlightId}
                            highlightRef={highlightRef}
                        />
                    ) : (
                        <div className="flex flex-col items-center">
                            <div className="h-px bg-border" style={{ width: `${node.children.length * 192}px` }} />
                            <div className="flex gap-0">
                                {node.children.map(child => (
                                    <div key={child.id} className="flex flex-col items-center" style={{ width: "192px" }}>
                                        <div className="h-4 w-px bg-border" />
                                        <OrgNodeWrapper
                                            node={child}
                                            highlightId={highlightId}
                                            highlightRef={highlightRef}
                                        />
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

export default function OrgTree({
    roots,
    highlightId,
}: {
    roots: OrgNode[];
    highlightId?: number;
}) {
    const highlightRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (highlightRef.current) {
            highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
        }
    }, [roots]);

    if (roots.length === 0) return null;

    return (
        <div className="overflow-auto pb-12">
            <div className="flex gap-16 min-w-max pt-4">
                {roots.map(root => (
                    <OrgNodeWrapper
                        key={root.id}
                        node={root}
                        highlightId={highlightId}
                        highlightRef={highlightRef}
                    />
                ))}
            </div>
        </div>
    );
}
