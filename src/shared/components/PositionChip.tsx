"use client";

import { Globe2 } from "lucide-react";

/**
 * Compact chip showing a single position (seat) assignment.
 *   ⬤ Branch Manager · Delhi · Sales
 *   🌐 CEO · Org-wide
 *
 * - Left dot is coloured by the position's Role (falls back to neutral when null).
 * - Branch label uses Globe2 + "Org-wide" when the position is org-wide
 *   (branchId == null); otherwise the branch name.
 * - Department appears when set; suppressed when null (dept-agnostic).
 *
 * Shared by Admin → Users and HR & People → Staff Directory, so a seat reads
 * the same on both.
 */
export interface PositionChipPosition {
    id: string;
    title: string;
    branch: { id: string; name: string } | null;
    department: { id: string; name: string } | null;
    roleTemplates: { id: string; label: string; color: string }[];
}

export function PositionChip({ position }: { position: PositionChipPosition }) {
    const primaryRole = position.roleTemplates[0];
    const dotColor = primaryRole?.color
        ? primaryRole.color.split(" ").find((c) => c.startsWith("bg-")) ?? "bg-muted-foreground/40"
        : "bg-muted-foreground/40";
    const roleTitle = position.roleTemplates.map((r) => r.label).join(", ");

    const isOrgWide = position.branch === null;

    return (
        <div
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 text-xs"
            title={roleTitle ? `Roles: ${roleTitle}` : undefined}
        >
            <span className={`h-2 w-2 rounded-full shrink-0 ${dotColor}`} />
            <span className="font-medium text-foreground">{position.title}</span>
            <span className="text-muted-foreground">·</span>
            {isOrgWide ? (
                <span className="inline-flex items-center gap-0.5 text-muted-foreground">
                    <Globe2 size={10} />
                    Org-wide
                </span>
            ) : (
                <span className="text-muted-foreground">{position.branch!.name}</span>
            )}
            {position.department && (
                <>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-muted-foreground">{position.department.name}</span>
                </>
            )}
        </div>
    );
}
