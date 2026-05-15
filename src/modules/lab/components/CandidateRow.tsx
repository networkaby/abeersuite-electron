"use client";

import { useRouter } from "next/navigation";
import {
    User,
    Building2,
    Wrench,
    AlertCircle,
    Phone,
    Mail,
    MapPin,
    CheckCircle2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/shared/lib/format/utils";
import type {
    CustomerCandidate,
    EvidenceTag,
} from "@/modules/lab/lib/buildCandidates";

/**
 * Single candidate row inside the Front Office unified result list.
 *
 * Each row surfaces *why* the candidate matched the current query via a
 * stack of evidence chips (name, phone, device, problem snippet). Tapping
 * the row selects the candidate (opens CustomerContextPanel); tapping a
 * ticket-bearing chip navigates straight to that ticket. The score badge
 * turns green at ≥3 clues so a confident match jumps off the screen.
 */
interface CandidateRowProps {
    candidate: CustomerCandidate;
    isActive: boolean;
    onSelect: (candidate: CustomerCandidate) => void;
}

export default function CandidateRow({
    candidate,
    isActive,
    onSelect,
}: CandidateRowProps) {
    const router = useRouter();
    const clueWord = candidate.matchScore === 1 ? "clue" : "clues";
    const strongMatch = candidate.matchScore >= 3;

    return (
        <button
            type="button"
            onClick={() => onSelect(candidate)}
            className={cn(
                "flex w-full flex-col gap-1.5 rounded-lg px-3 py-2.5 text-left text-sm",
                "transition-colors hover:bg-muted/60 cursor-pointer",
                isActive && "bg-primary/5 ring-1 ring-inset ring-primary/20 hover:bg-primary/5",
            )}
        >
            {/* Top row: icon + name + score */}
            <div className="flex w-full items-center gap-2">
                {candidate.type === "company" ? (
                    <Building2 size={15} className="shrink-0 text-purple-600" />
                ) : (
                    <User size={15} className="shrink-0 text-blue-600" />
                )}
                <span className="flex-1 truncate font-medium">{candidate.name}</span>
                <Badge
                    variant="secondary"
                    className={cn(
                        "shrink-0 text-[10px]",
                        strongMatch &&
                            "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                    )}
                >
                    {candidate.matchScore} {clueWord}
                </Badge>
                {isActive && (
                    <CheckCircle2 size={14} className="shrink-0 text-primary" />
                )}
            </div>

            {/* Second row: phone · email · address */}
            {(candidate.phone || candidate.email || candidate.address) && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-[23px] text-xs text-muted-foreground">
                    {candidate.phone && (
                        <span className="flex items-center gap-1">
                            <Phone size={10} className="shrink-0" />
                            {candidate.phone}
                        </span>
                    )}
                    {candidate.email && (
                        <span className="flex items-center gap-1 max-w-[180px] truncate">
                            <Mail size={10} className="shrink-0" />
                            {candidate.email}
                        </span>
                    )}
                    {candidate.address && (
                        <span className="flex items-center gap-1 max-w-[200px] truncate">
                            <MapPin size={10} className="shrink-0" />
                            {candidate.address}
                        </span>
                    )}
                </div>
            )}

            {/* Evidence chips */}
            {candidate.evidence.length > 0 && (
                <div className="flex flex-wrap gap-1 pl-[23px]">
                    {candidate.evidence.map((ev, i) => (
                        <EvidenceChip
                            key={i}
                            tag={ev}
                            onTicketClick={(ticketId) =>
                                router.push(`/office/repairing/tickets/${ticketId}`)
                            }
                        />
                    ))}
                </div>
            )}
        </button>
    );
}

// ── Internal: evidence chip ────────────────────────────────────────────────

function EvidenceChip({
    tag,
    onTicketClick,
}: {
    tag: EvidenceTag;
    onTicketClick: (ticketId: string) => void;
}) {
    const base =
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium";

    if (tag.kind === "name") {
        return (
            <span
                className={cn(
                    base,
                    "bg-blue-500/10 text-blue-700 dark:text-blue-400",
                )}
                title={`Name contains "${tag.matchedTerm}"`}
            >
                Name: {tag.matchedTerm}
            </span>
        );
    }

    if (tag.kind === "phone") {
        return (
            <span
                className={cn(
                    base,
                    "bg-violet-500/10 text-violet-700 dark:text-violet-400",
                )}
                title={`Phone contains "${tag.matchedTerm}"`}
            >
                <Phone size={9} />
                {tag.matchedTerm}
            </span>
        );
    }

    if (tag.kind === "device") {
        const label = [tag.brand, tag.model].filter(Boolean).join(" ") || "device";
        return (
            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    onTicketClick(tag.ticketId);
                }}
                className={cn(
                    base,
                    "cursor-pointer bg-orange-500/10 text-orange-700 transition-colors hover:bg-orange-500/20 dark:text-orange-400",
                )}
                title={`Open ticket ${tag.ticketId}`}
            >
                <Wrench size={9} />
                {label}
                <span className="opacity-60">· {tag.ticketId}</span>
            </button>
        );
    }

    // tag.kind === "problem"
    return (
        <button
            type="button"
            onClick={(e) => {
                e.stopPropagation();
                onTicketClick(tag.ticketId);
            }}
            className={cn(
                base,
                "cursor-pointer bg-amber-500/10 text-amber-700 transition-colors hover:bg-amber-500/20 dark:text-amber-400",
            )}
            title={`Open ticket ${tag.ticketId}`}
        >
            <AlertCircle size={9} />
            &ldquo;{tag.snippet}&rdquo;
            <span className="opacity-60">· {tag.ticketId}</span>
        </button>
    );
}

