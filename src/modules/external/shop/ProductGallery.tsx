"use client";

import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/utils";

export default function ProductGallery({ urls, alt }: { urls: string[]; alt: string }) {
    const safe = urls.filter(Boolean);
    const [i, setI] = useState(0);
    const main = safe[i] ?? safe[0];

    if (safe.length === 0) {
        return (
            <div className="flex aspect-square items-center justify-center rounded-2xl border border-dashed border-border bg-muted/40 text-muted-foreground text-sm">
                No images
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
            <div className="flex gap-2 lg:flex-col lg:max-h-[520px] lg:overflow-y-auto lg:w-[88px] shrink-0 overflow-x-auto pb-1 lg:pb-0">
                {safe.map((u, idx) => (
                    <button
                        key={`${u}-${idx}`}
                        type="button"
                        onClick={() => setI(idx)}
                        className={cn(
                            "relative size-16 shrink-0 overflow-hidden rounded-xl border-2 transition-colors lg:size-20",
                            i === idx ? "border-primary ring-2 ring-primary/20" : "border-transparent hover:border-border"
                        )}
                    >
                        <Image src={u} alt="" fill className="object-cover" sizes="80px" />
                    </button>
                ))}
            </div>
            <div className="relative min-h-[320px] flex-1 overflow-hidden rounded-2xl border border-border/80 bg-muted/20 lg:aspect-square lg:min-h-0">
                {main ? (
                    <Image
                        src={main}
                        alt={alt}
                        fill
                        priority
                        className="object-cover"
                        sizes="(max-width:1024px)100vw,45vw"
                    />
                ) : null}
            </div>
        </div>
    );
}
