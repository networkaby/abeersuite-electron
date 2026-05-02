"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

export default function ShopSearchBar({ className }: { className?: string }) {
    const router = useRouter();
    const [q, setQ] = useState("");

    const go = () => {
        const query = q.trim();
        const url = new URL("/shop", window.location.origin);
        if (query) url.searchParams.set("q", query);
        router.push(url.pathname + url.search + "#catalog");
    };

    return (
        <div className={className}>
            <div className="relative w-full max-w-md">
                <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground pointer-events-none" />
                <Input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search laptops, printers, CCTV…"
                    className="pl-9 h-10 w-full rounded-full bg-muted/50 border-border/80"
                    onKeyDown={(e) => {
                        if (e.key === "Enter") go();
                    }}
                />
            </div>
        </div>
    );
}
