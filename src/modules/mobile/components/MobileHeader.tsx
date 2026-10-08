"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft, Menu, RefreshCw } from "lucide-react";
import { useMobileMenu } from "./MobileShell";

const iconButton = "flex size-11 shrink-0 items-center justify-center rounded-full active:bg-muted";

/** Top bar of a phone screen. A main screen gets the ☰ side-menu button; a detail
 *  screen (a party's bills) passes `back` and gets a back arrow instead — an address,
 *  or a function for a screen laid over the list (the voucher sheet). Its height
 *  is --m-header (globals.css), which every sticky row under it reads.
 *  The customer app shares it: `menu={false}` for its tab screens (no side menu
 *  there), `actions` for its own buttons on the right (cart, share). */
export default function MobileHeader({ title, back, onRefresh, busy, menu = true, actions }: {
    title: string;
    back?: string | (() => void);
    onRefresh?: () => void;
    busy?: boolean;
    menu?: boolean;
    actions?: ReactNode;
}) {
    const { openMenu } = useMobileMenu();
    return (
        <header className="sticky top-0 z-10 flex h-[var(--m-header)] items-center gap-1 border-b bg-background/95 px-1 pt-[env(safe-area-inset-top)] backdrop-blur">
            {typeof back === "function" ? (
                <button type="button" onClick={back} className={iconButton} aria-label="Back">
                    <ChevronLeft className="size-6" />
                </button>
            ) : back ? (
                <Link href={back} className={iconButton} aria-label="Back">
                    <ChevronLeft className="size-6" />
                </Link>
            ) : menu ? (
                <button type="button" onClick={openMenu} className={iconButton} aria-label="Open menu">
                    <Menu className="size-6" />
                </button>
            ) : (
                <span className="w-2" />
            )}
            <h1 className="flex-1 truncate px-1 text-lg font-semibold">{title}</h1>
            {actions}
            {onRefresh && (
                <button type="button" onClick={onRefresh} className={iconButton} aria-label="Refresh">
                    <RefreshCw className={`size-5 ${busy ? "animate-spin" : ""}`} />
                </button>
            )}
        </header>
    );
}
