"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, X } from "lucide-react";
import MobileNav from "./MobileNav";
import MobileSignOut from "./MobileSignOut";
import { MOBILE_GROUPS, isOnScreen, screensFor } from "./mobileScreens";

const MenuContext = createContext<{ openMenu: () => void }>({ openMenu: () => { } });

/** Opens the side menu — for the ☰ button in a screen's header. */
export function useMobileMenu() {
    return useContext(MenuContext);
}

export type ShellUser = { name: string; roleLabel: string | null; permissions: string[] };

/**
 * Everything around a phone screen: the side menu (every screen this person holds,
 * grouped, with Sign out at the bottom) and the bottom tab bar (the first few).
 * Both read the one screen list in mobileScreens.ts.
 */
export default function MobileShell({ user, children }: { user: ShellUser; children: ReactNode }) {
    const [open, setOpen] = useState(false);
    const openMenu = useCallback(() => setOpen(true), []);
    const close = useCallback(() => setOpen(false), []);
    const value = useMemo(() => ({ openMenu }), [openMenu]);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open]);

    return (
        <MenuContext.Provider value={value}>
            {/* Bottom padding = the tab bar (h-16) plus the phone's gesture area. */}
            <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col bg-background pb-[calc(4rem+env(safe-area-inset-bottom))]">
                {children}
            </div>
            <MobileNav permissions={user.permissions} />
            <SideMenu user={user} open={open} onClose={close} />
        </MenuContext.Provider>
    );
}

function SideMenu({ user, open, onClose }: { user: ShellUser; open: boolean; onClose: () => void }) {
    const pathname = usePathname();
    const screens = screensFor(user.permissions);
    const item = (active: boolean) =>
        `flex items-center gap-3 rounded-lg px-3 py-3 text-sm active:bg-muted ${active ? "bg-primary/10 font-semibold text-primary" : ""}`;

    return (
        <div className={`fixed inset-0 z-40 ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
            <div
                className={`absolute inset-0 bg-black/40 transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
                onClick={onClose}
            />
            <nav
                role="dialog"
                aria-modal="true"
                aria-label="Menu"
                className={`absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-background shadow-xl transition-transform ${
                    open ? "translate-x-0" : "-translate-x-full"
                }`}
            >
                <div className="flex items-start justify-between border-b px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
                    <div className="min-w-0">
                        <p className="truncate font-semibold">{user.name}</p>
                        {user.roleLabel && <p className="truncate text-xs text-muted-foreground">{user.roleLabel}</p>}
                    </div>
                    <button type="button" onClick={onClose} className="rounded-md p-2 active:bg-muted" aria-label="Close menu">
                        <X className="size-5" />
                    </button>
                </div>

                <div className="flex-1 space-y-4 overflow-y-auto p-2">
                    <Link href="/m" onClick={onClose} className={item(pathname === "/m")}>
                        <Home className="size-5" /> Home
                    </Link>
                    {MOBILE_GROUPS.map((group) => {
                        const inGroup = screens.filter((s) => s.group === group);
                        if (inGroup.length === 0) return null;
                        return (
                            <div key={group}>
                                <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{group}</p>
                                {inGroup.map(({ href, label, icon: Icon }) => (
                                    <Link key={href} href={href} onClick={onClose} className={item(isOnScreen(pathname, href))}>
                                        <Icon className="size-5" /> {label}
                                    </Link>
                                ))}
                            </div>
                        );
                    })}
                </div>

                <div className="border-t p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
                    <MobileSignOut />
                </div>
            </nav>
        </div>
    );
}
