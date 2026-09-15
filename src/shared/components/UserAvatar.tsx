"use client";

import Image from "next/image";
import { useState } from "react";
import { imageLoaderFor } from "@/shared/lib/cloudinaryImage";
import { initials } from "@/shared/lib/format/initials";

const AVATAR_COLOR: Record<string, string> = {
    R1: "bg-purple-100 text-purple-700",
    R2: "bg-blue-100 text-blue-700",
    R3: "bg-green-100 text-green-700",
    R4: "bg-orange-100 text-orange-700",
    R5: "bg-pink-100 text-pink-700",
};

export default function UserAvatar({
    avatarUrl, name, role, sizePx = 32, className = "",
}: {
    avatarUrl?: string | null;
    name: string;
    role?: string | null;
    sizePx?: number;
    className?: string;
}) {
    const [err, setErr] = useState(false);
    const bg = AVATAR_COLOR[role ?? ""] ?? "bg-gray-100 text-gray-600";

    if (avatarUrl && !err) {
        return (
            <div
                className={`rounded-full overflow-hidden shrink-0 ${className}`}
                style={{ width: sizePx, height: sizePx }}
            >
                <Image
                    src={avatarUrl}
                    alt={name}
                    width={sizePx}
                    height={sizePx}
                    // Avatars are Cloudinary uploads: let Cloudinary do the resize.
                    loader={imageLoaderFor(avatarUrl)}
                    className="object-cover w-full h-full"
                    onError={() => setErr(true)}
                />
            </div>
        );
    }

    return (
        <div
            className={`flex shrink-0 items-center justify-center rounded-full font-bold ${bg} ${className}`}
            style={{ width: sizePx, height: sizePx, fontSize: Math.max(10, sizePx * 0.32) }}
        >
            {initials(name)}
        </div>
    );
}
