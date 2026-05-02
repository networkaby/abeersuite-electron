"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

export default function ShopSearchBar({ className }: { className?: string }) {
    const router = useRouter();
    const pathname = usePathname();
    const [q, setQ] = useState("");

    const go = () => {
        const query = q.trim();
        const basePath = pathname.startsWith("/shop") ? "/shop" : "/";
        const url = new URL(basePath, window.location.origin);
        if (query) url.searchParams.set("q", query);
        router.push(url.pathname + url.search + "#catalog");
    };

    return (
        <div className={className}>
            <div className="relative w-full max-w-md">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search laptops, printers, CCTV…"
                    className="touch-manipulation pl-9 text-base h-11 min-h-11 w-full rounded-full bg-muted/50 border-border/80"
                    enterKeyHint="search"
                    autoComplete="off"
                    onKeyDown={(e) => {
                        if (e.key === "Enter") go();
                    }}
                />
            </div>
        </div>
    );
}
