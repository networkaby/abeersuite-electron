"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, Home, Plus, Receipt, X } from "lucide-react";
import MobileNav from "./MobileNav";
import MobileSignOut from "./MobileSignOut";
import { MOBILE_GROUPS, isOnScreen, quickEntryFor, screensFor } from "./mobileScreens";
import { PHONE_APP_HOME } from "@/shared/lib/device/phone";

const MenuContext = createContext<{ openMenu: () => void }>({ openMenu: () => { } });

/** Opens the side menu — for the ☰ button in a screen's header. */
export function useMobileMenu() {
    return useContext(MenuContext);
}

export type ShellUser = { name: string; roleLabel: string | null; permissions: string[] };

/**
 * Everything around a phone screen: the side menu (every screen this person holds,
 * grouped, with Sign out at the bottom), the bottom tab bar (the first few) — both
 * from the one screen list in mobileScreens.ts — and the + button for quick
 * Receive / Pay (quickEntryFor).
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
            <QuickEntryButton permissions={user.permissions} />
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
                    <Link href={PHONE_APP_HOME} onClick={onClose} className={item(pathname === PHONE_APP_HOME)}>
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

/** The + over the tab bar: quick Receive / Pay from any screen — but not over the
 *  entry screens themselves, where it would only cover the Save button. */
function QuickEntryButton({ permissions }: { permissions: string[] }) {
    const pathname = usePathname();
    const [open, setOpen] = useState(false);
    const quick = quickEntryFor(permissions);
    const onEntry = pathname.startsWith(`${PHONE_APP_HOME}/quick`) || /\/(pay|receive)$/.test(pathname);
    if ((!quick.pay && !quick.receive) || onEntry) return null;

    const choice = "flex items-center gap-3 rounded-xl border bg-background px-4 py-4 text-left font-medium shadow-sm active:bg-muted";
    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                aria-label="Quick receive or pay"
                className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-30 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg active:scale-95"
            >
                <Plus className="size-7" />
            </button>
            {open && (
                <div className="fixed inset-0 z-40 flex items-end bg-black/40" onClick={() => setOpen(false)}>
                    <div
                        className="mx-auto w-full max-w-xl space-y-2 rounded-t-2xl bg-background p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {quick.receive && (
                            <Link href={`${PHONE_APP_HOME}/quick/receive`} onClick={() => setOpen(false)} className={choice}>
                                <ArrowDownLeft className="size-6 text-emerald-600" />
                                <span>Receive money<span className="block text-xs font-normal text-muted-foreground">From a customer</span></span>
                            </Link>
                        )}
                        {quick.pay && (
                            <Link href={`${PHONE_APP_HOME}/quick/pay`} onClick={() => setOpen(false)} className={choice}>
                                <ArrowUpRight className="size-6 text-destructive" />
                                <span>Make payment<span className="block text-xs font-normal text-muted-foreground">To a supplier, or an expense</span></span>
                            </Link>
                        )}
                        {quick.pay && (
                            <Link href={`${PHONE_APP_HOME}/quick/expense`} onClick={() => setOpen(false)} className={choice}>
                                <Receipt className="size-6 text-amber-600" />
                                <span>Expense<span className="block text-xs font-normal text-muted-foreground">Rent, electricity, tea…</span></span>
                            </Link>
                        )}
                        <button type="button" onClick={() => setOpen(false)} className="w-full rounded-xl py-3 text-sm text-muted-foreground">Cancel</button>
                    </div>
                </div>
            )}
        </>
    );
}
