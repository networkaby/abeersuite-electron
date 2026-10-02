"use client";

import Link from "next/link";
import { ChevronLeft, Menu, RefreshCw } from "lucide-react";
import { useMobileMenu } from "./MobileShell";

/** Top bar of a phone screen. A main screen gets the ☰ side-menu button; a detail
 *  screen (a party's bills) passes `back` and gets a back arrow instead. */
export default function MobileHeader({ title, back, onRefresh, busy }: {
    title: string;
    back?: string;
    onRefresh?: () => void;
    busy?: boolean;
}) {
    const { openMenu } = useMobileMenu();
    return (
        <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-2 py-2 backdrop-blur">
            {back ? (
                <Link href={back} className="rounded-md p-2 active:bg-muted" aria-label="Back">
                    <ChevronLeft className="size-5" />
                </Link>
            ) : (
                <button type="button" onClick={openMenu} className="rounded-md p-2 active:bg-muted" aria-label="Open menu">
                    <Menu className="size-5" />
                </button>
            )}
            <h1 className="flex-1 truncate font-semibold">{title}</h1>
            {onRefresh && (
                <button type="button" onClick={onRefresh} className="rounded-md p-2 active:bg-muted" aria-label="Refresh">
                    <RefreshCw className={`size-5 ${busy ? "animate-spin" : ""}`} />
                </button>
            )}
        </header>
    );
}
