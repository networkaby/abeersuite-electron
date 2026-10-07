import { Search } from "lucide-react";
import ShopBrandMark from "@/modules/external/shop/ShopBrandMark";

/**
 * The app's top bar: the logo, then the search box under it. Sticky, and drawn
 * under the phone's status bar (the layout sets viewport-fit=cover). Search
 * opens the shop's results for now — the app's own results screen comes with
 * the shopping phase.
 */
export default function AppTopBar({ title }: { title?: string }) {
    return (
        <header className="sticky top-0 z-20 border-b border-border/70 bg-background/95 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] backdrop-blur">
            {title ? (
                <h1 className="mb-3 text-lg font-semibold tracking-tight">{title}</h1>
            ) : (
                <ShopBrandMark className="mb-3 h-8 w-28" />
            )}
            <form action="/shop" role="search">
                <label className="flex h-11 items-center gap-2 rounded-xl border border-border/80 bg-muted/50 px-3 text-muted-foreground focus-within:border-primary">
                    <Search className="size-4 shrink-0" />
                    <input
                        type="search"
                        name="q"
                        enterKeyHint="search"
                        placeholder="Search laptops, printers, CCTV…"
                        className="min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
                    />
                </label>
            </form>
        </header>
    );
}
