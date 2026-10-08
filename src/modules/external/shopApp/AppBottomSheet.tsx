"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * A panel that slides up from the bottom over a dimmed screen — Sort, Filter and
 * other pickers, the way shopping apps show them. Tap the dim area, ✕ or the
 * phone's Escape to close. `footer` stays pinned under the scrolling body
 * (Apply / Clear).
 */
export default function AppBottomSheet({
    open,
    title,
    onClose,
    children,
    footer,
}: {
    open: boolean;
    title: string;
    onClose: () => void;
    children: ReactNode;
    footer?: ReactNode;
}) {
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        // The page under the sheet must not scroll along with it.
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            window.removeEventListener("keydown", onKey);
            document.body.style.overflow = prev;
        };
    }, [open, onClose]);

    return (
        <div className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
            <div className={`absolute inset-0 bg-black/40 transition-opacity ${open ? "opacity-100" : "opacity-0"}`} onClick={onClose} />
            <div
                role="dialog"
                aria-modal="true"
                aria-label={title}
                className={`absolute inset-x-0 bottom-0 mx-auto flex max-h-[85dvh] max-w-xl flex-col rounded-t-2xl bg-background shadow-xl transition-transform duration-200 ${
                    open ? "translate-y-0" : "translate-y-full"
                }`}
            >
                <div className="flex items-center justify-between border-b px-4 py-3">
                    <h2 className="text-base font-semibold">{title}</h2>
                    <button type="button" onClick={onClose} className="-mr-2 rounded-full p-2 active:bg-muted" aria-label="Close">
                        <X className="size-5" />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto">{children}</div>
                {footer && <div className="border-t p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">{footer}</div>}
            </div>
        </div>
    );
}
