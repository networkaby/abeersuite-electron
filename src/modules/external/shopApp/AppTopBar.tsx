import Link from "next/link";
import { Search } from "lucide-react";
import ShopBrandMark from "@/modules/external/shop/ShopBrandMark";
import { APP } from "@/modules/external/shopApp/appPaths";

/**
 * The app's top bar on the tab screens: the logo (or the tab's title), then a
 * search box. The box is a doorway, as in Flipkart and Amazon — tapping it opens
 * the full-screen search with recent searches and suggestions.
 */
export default function AppTopBar({ title }: { title?: string }) {
    return (
        <header className="sticky top-0 z-20 border-b border-border/70 bg-background/95 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] backdrop-blur">
            {title ? (
                <h1 className="mb-3 text-lg font-semibold tracking-tight">{title}</h1>
            ) : (
                <ShopBrandMark className="mb-3 h-8 w-28" />
            )}
            <Link
                href={`${APP}/search`}
                className="flex h-11 items-center gap-2 rounded-xl border border-border/80 bg-muted/50 px-3 text-[15px] text-muted-foreground active:bg-muted"
            >
                <Search className="size-4 shrink-0" />
                Search laptops, printers, CCTV…
            </Link>
        </header>
    );
}
