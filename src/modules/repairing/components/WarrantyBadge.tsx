"use client";

interface Props {
    isWarranty: boolean;
    warrantyStatus: string;
    className?: string;
}

const STATUS_CONFIG: Record<string, { label: string; classes: string }> = {
    CLAIMED: { label: "W Claimed",   classes: "bg-secondary/60 text-secondary-foreground border-border" },
    ACTIVE:  { label: "W Confirmed", classes: "bg-primary/10 text-primary border-primary/40" },
    VOID:    { label: "W Voided",    classes: "bg-destructive/10 text-destructive border-destructive/40" },
    NONE:    { label: "Warranty",    classes: "bg-secondary/40 text-secondary-foreground border-border" },
};

export default function WarrantyBadge({ isWarranty, warrantyStatus, className = "" }: Props) {
    if (!isWarranty) return null;
    const cfg = STATUS_CONFIG[warrantyStatus] ?? STATUS_CONFIG.NONE;
    return (
        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 border ${cfg.classes} ${className}`}>
            <span>⚙</span> {cfg.label}
        </span>
    );
}
