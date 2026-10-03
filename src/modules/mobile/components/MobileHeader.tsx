"use client";

import Link from "next/link";
import { ChevronLeft, Menu, RefreshCw } from "lucide-react";
import { useMobileMenu } from "./MobileShell";

const iconButton = "flex size-11 shrink-0 items-center justify-center rounded-full active:bg-muted";

/** Top bar of a phone screen. A main screen gets the ☰ side-menu button; a detail
 *  screen (a party's bills) passes `back` and gets a back arrow instead. Its height
 *  is --m-header (globals.css), which every sticky row under it reads. */
export default function MobileHeader({ title, back, onRefresh, busy }: {
    title: string;
    back?: string;
    onRefresh?: () => void;
    busy?: boolean;
}) {
    const { openMenu } = useMobileMenu();
    return (
        <header className="sticky top-0 z-10 flex h-[var(--m-header)] items-center gap-1 border-b bg-background/95 px-1 pt-[env(safe-area-inset-top)] backdrop-blur">
            {back ? (
                <Link href={back} className={iconButton} aria-label="Back">
                    <ChevronLeft className="size-6" />
                </Link>
            ) : (
                <button type="button" onClick={openMenu} className={iconButton} aria-label="Open menu">
                    <Menu className="size-6" />
                </button>
            )}
            <h1 className="flex-1 truncate px-1 text-lg font-semibold">{title}</h1>
            {onRefresh && (
                <button type="button" onClick={onRefresh} className={iconButton} aria-label="Refresh">
                    <RefreshCw className={`size-5 ${busy ? "animate-spin" : ""}`} />
                </button>
            )}
        </header>
    );
}
