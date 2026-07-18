"use client";

interface Props {
    isWarranty: boolean;
    warrantyStatus: string;
    className?: string;
}

// Bright, solid colours so the warranty state stands out at a glance (billing
// needs to spot it fast to apply a rebate / free bill manually).
const STATUS_CONFIG: Record<string, { label: string; classes: string }> = {
    CLAIMED: { label: "Warranty Claim", classes: "bg-amber-500 text-white border-amber-600" },
    ACTIVE:  { label: "Warranty",       classes: "bg-green-600 text-white border-green-700" },
    VOID:    { label: "Warranty Void",  classes: "bg-red-600 text-white border-red-700" },
    NONE:    { label: "Warranty",       classes: "bg-blue-600 text-white border-blue-700" },
};

export default function WarrantyBadge({ isWarranty, warrantyStatus, className = "" }: Props) {
    if (!isWarranty) return null;
    const cfg = STATUS_CONFIG[warrantyStatus] ?? STATUS_CONFIG.NONE;
    return (
        <span className={`inline-flex items-center gap-1 rounded-md text-xs font-semibold px-2 py-0.5 border ${cfg.classes} ${className}`}>
            <span>🛡</span> {cfg.label}
        </span>
    );
}
