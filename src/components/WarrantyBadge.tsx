"use client";

interface Props {
    isWarranty: boolean;
    warrantyStatus: string;
    className?: string;
}

const STATUS_CONFIG: Record<string, { label: string; classes: string }> = {
    claimed:   { label: "W Claimed",   classes: "bg-amber-100 text-amber-700 border-amber-200" },
    confirmed: { label: "W Confirmed", classes: "bg-green-100 text-green-700 border-green-200" },
    voided:    { label: "W Voided",    classes: "bg-red-100 text-red-600 border-red-200" },
    none:      { label: "Warranty",    classes: "bg-amber-50 text-amber-600 border-amber-100" },
};

export default function WarrantyBadge({ isWarranty, warrantyStatus, className = "" }: Props) {
    if (!isWarranty) return null;
    const cfg = STATUS_CONFIG[warrantyStatus] ?? STATUS_CONFIG.none;
    return (
        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${cfg.classes} ${className}`}>
            <span>⚙</span> {cfg.label}
        </span>
    );
}
