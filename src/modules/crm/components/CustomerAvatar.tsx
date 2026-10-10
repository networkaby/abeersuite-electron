"use client";

import Image from "next/image";
import { useState } from "react";
import { Building2, User } from "lucide-react";
import { imageLoaderFor } from "@/shared/lib/cloudinaryImage";
import { groupColor } from "@/shared/lib/format/groupColor";
import { initials } from "@/shared/lib/format/initials";
import { cn } from "@/shared/lib/format/utils";

export interface CustomerAvatarProps {
    name?: string | null;
    avatarUrl?: string | null;
    kind?: "person" | "company" | null;
    phone?: string | null;
    sizePx?: number;
    className?: string;
}

/**
 * Customer avatar circle for WhatsApp chat list, thread headers, and profile modals.
 * Displays CRM profile photo if available, or a deterministic colorful circle with initials.
 */
export function CustomerAvatar({
    name,
    avatarUrl,
    kind,
    phone,
    sizePx = 36,
    className = "",
}: CustomerAvatarProps) {
    const [err, setErr] = useState(false);
    const identifier = name || (phone ? `+91 ${phone}` : "Customer");
    const tone = groupColor(identifier);
    const labelInitials = initials(identifier);

    if (avatarUrl && !err) {
        return (
            <div
                className={cn("rounded-full overflow-hidden shrink-0 border border-border/40 shadow-xs", className)}
                style={{ width: sizePx, height: sizePx }}
            >
                <Image
                    src={avatarUrl}
                    alt={identifier}
                    width={sizePx}
                    height={sizePx}
                    loader={imageLoaderFor(avatarUrl)}
                    className="object-cover w-full h-full"
                    onError={() => setErr(true)}
                />
            </div>
        );
    }

    return (
        <div
            className={cn(
                "flex shrink-0 items-center justify-center rounded-full font-semibold select-none shadow-xs border border-border/20",
                tone.bg,
                tone.text,
                className
            )}
            style={{ width: sizePx, height: sizePx, fontSize: Math.max(11, Math.round(sizePx * 0.36)) }}
            title={identifier}
        >
            {labelInitials && labelInitials !== "?" ? (
                labelInitials
            ) : kind === "company" ? (
                <Building2 style={{ width: sizePx * 0.5, height: sizePx * 0.5 }} />
            ) : (
                <User style={{ width: sizePx * 0.5, height: sizePx * 0.5 }} />
            )}
        </div>
    );
}

export default CustomerAvatar;
