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

export function PositionChip({ position, compact }: {
    position: PositionChipPosition;
    /**
     * Title only, with the branch / department / roles moved into the tooltip.
     * For a dense list where several seats sit side by side and the full chip
     * would wrap every row onto two lines. The default is unchanged, so Admin →
     * Users keeps reading exactly as it did.
     */
    compact?: boolean;
}) {
    const primaryRole = position.roleTemplates[0];
    const dotColor = primaryRole?.color
        ? primaryRole.color.split(" ").find((c) => c.startsWith("bg-")) ?? "bg-muted-foreground/40"
        : "bg-muted-foreground/40";
    const roleTitle = position.roleTemplates.map((r) => r.label).join(", ");

    const isOrgWide = position.branch === null;
    const where = [isOrgWide ? "Org-wide" : position.branch!.name, position.department?.name]
        .filter(Boolean).join(" · ");

    if (compact) {
        return (
            <div
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 text-xs"
                title={[`${position.title} · ${where}`, roleTitle && `Roles: ${roleTitle}`].filter(Boolean).join("\n")}
            >
                <span className={`h-2 w-2 shrink-0 rounded-full ${dotColor}`} />
                <span className="font-medium text-foreground">{position.title}</span>
            </div>
        );
    }

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
