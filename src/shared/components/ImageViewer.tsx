"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { ChevronLeft, ChevronRight, Download, RotateCw, X, ZoomIn, ZoomOut } from "lucide-react";

const MIN = 1;
const MAX = 8;
const STEP = 1.25;
/** Horizontal drag (px) that flips to the next / previous photo when not zoomed. */
const SWIPE = 50;

/**
 * Full-screen photo viewer: wheel / buttons / two-finger pinch zoom around the
 * cursor, drag pans when zoomed, double-click toggles fit ↔ 2×, rotate for
 * sideways phone shots. Esc or a click on the dark backdrop closes it. Reuses
 * the already-loaded image URL — no extra fetch.
 *
 * One photo: pass `src` (WhatsApp chat). Several: pass `srcs` + `startIndex`
 * (shop product gallery) — arrows, ← / → keys, swipe when not zoomed, "2 / 5".
 * `tools={false}` hides rotate + download (shop customers). `closeOnBack`
 * makes the phone's Back button close the viewer instead of leaving the page.
 */
export function ImageViewer({
    src,
    srcs,
    startIndex = 0,
    alt,
    downloadUrl,
    fileName,
    tools = true,
    closeOnBack = false,
    onClose,
}: {
    src?: string;
    srcs?: string[];
    startIndex?: number;
    alt?: string;
    downloadUrl?: string | null;
    fileName?: string | null;
    tools?: boolean;
    closeOnBack?: boolean;
    onClose: () => void;
}) {
    const list = srcs && srcs.length > 0 ? srcs : src ? [src] : [];
    const count = list.length;
    const [index, setIndex] = useState(() => Math.min(Math.max(0, startIndex), Math.max(0, count - 1)));
    const [scale, setScale] = useState(1);
    const [pos, setPos] = useState({ x: 0, y: 0 });
    const [rot, setRot] = useState(0);
    const drag = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null);
    const stage = useRef<HTMLDivElement>(null);
    const [dragging, setDragging] = useState(false);
    // Fingers down, for pinch: pointerId → last point.
    const touches = useRef(new Map<number, { x: number; y: number }>());
    const pinch = useRef<{ dist: number; scale: number } | null>(null);

    // Mirrors scale + pos for handlers; every write goes through zoomTo / pan.
    const view = useRef({ scale: 1, x: 0, y: 0 });

    /** Zoom to `next`, keeping the point under (cx, cy) — screen coords — still. */
    const zoomTo = useCallback((next: number, cx?: number, cy?: number) => {
        const { scale: prev, x, y } = view.current;
        const s = Math.min(MAX, Math.max(MIN, next));
        let p = { x: 0, y: 0 };
        if (s > MIN) {
            const r = stage.current?.getBoundingClientRect();
            const ox = r && cx != null ? cx - (r.left + r.width / 2) : 0;
            const oy = r && cy != null ? cy - (r.top + r.height / 2) : 0;
            p = { x: ox - ((ox - x) * s) / prev, y: oy - ((oy - y) * s) / prev };
        }
        view.current = { scale: s, ...p };
        setScale(s);
        setPos(p);
    }, []);

    /** Move to another photo — zoom and rotation start fresh. */
    const go = useCallback((delta: number) => {
        if (count < 2) return;
        setIndex((i) => (i + delta + count) % count);
        view.current = { scale: 1, x: 0, y: 0 };
        setScale(1);
        setPos({ x: 0, y: 0 });
        setRot(0);
    }, [count]);

    // Non-passive wheel listener so the page behind does not scroll. Keyed on the
    // element itself: the Radix portal mounts it after this component's first
    // effect, so a plain ref would still be null here and the wheel never zoomed.
    const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null);
    useEffect(() => {
        const el = stageEl;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const cur = view.current.scale;
            zoomTo(e.deltaY < 0 ? cur * STEP : cur / STEP, e.clientX, e.clientY);
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, [stageEl, zoomTo]);

    useEffect(() => {
        if (count < 2) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "ArrowLeft") go(-1);
            else if (e.key === "ArrowRight") go(1);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [count, go]);

    // Phone Back closes the viewer: an extra history entry while open; Back pops
    // it (→ close), and closing any other way pops it ourselves.
    const pushedRef = useRef(false);
    const onCloseRef = useRef(onClose);
    useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
    useEffect(() => {
        if (!closeOnBack) return;
        const onPop = () => {
            pushedRef.current = false;
            onCloseRef.current();
        };
        // Deferred: a mount → unmount → mount (React dev / Strict Mode) cancels the
        // timer instead of pushing and popping an entry — a pop that would land
        // after the remount and close the viewer the moment it opened.
        const t = window.setTimeout(() => {
            window.history.pushState({ ...(window.history.state ?? {}), imageViewer: true }, "");
            pushedRef.current = true;
            window.addEventListener("popstate", onPop);
        }, 0);
        return () => {
            window.clearTimeout(t);
            window.removeEventListener("popstate", onPop);
            if (pushedRef.current) {
                pushedRef.current = false;
                window.history.back();
            }
        };
    }, [closeOnBack]);

    const btn = "flex size-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/25 transition-colors";
    const arrow = "absolute top-1/2 z-10 hidden -translate-y-1/2 sm:flex size-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/25";
    const current = list[index];
    if (!current) return null;

    // Its own Radix dialog: inside a modal (the ticket dialog) a plain portal is
    // click-blocked by that modal; a nested dialog stacks above it and Esc
    // closes only this layer.
    return (
        <DialogPrimitive.Root open onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogPrimitive.Portal>
        <DialogPrimitive.Content
            className="fixed inset-0 z-[1000] flex h-dvh w-screen flex-col bg-black/95 outline-none"
            aria-describedby={undefined}
            onOpenAutoFocus={(e) => e.preventDefault()}
        >
            <DialogPrimitive.Title className="sr-only">{alt ?? "Photo"}</DialogPrimitive.Title>
            {/* Bottom-centre bar, kept away from the window's own close button top-right. */}
            <div className="order-last mx-auto mb-[calc(0.75rem+env(safe-area-inset-bottom))] mt-2 flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 shadow-lg">
                {(fileName ?? alt) && <span className="hidden max-w-48 truncate text-xs text-white/70 sm:inline">{fileName ?? alt}</span>}
                {count > 1 && <span className="text-xs tabular-nums text-white/90">{index + 1} / {count}</span>}
                <span className="w-12 text-center text-xs tabular-nums text-white/70">{Math.round(scale * 100)}%</span>
                <button type="button" className={btn} title="Zoom out" onClick={() => zoomTo(scale / STEP)}><ZoomOut className="size-4" /></button>
                <button type="button" className={btn} title="Zoom in" onClick={() => zoomTo(scale * STEP)}><ZoomIn className="size-4" /></button>
                {tools && <button type="button" className={btn} title="Rotate" onClick={() => setRot((r) => (r + 90) % 360)}><RotateCw className="size-4" /></button>}
                {tools && downloadUrl && (
                    <a href={downloadUrl} download={fileName ?? "image.jpg"} className={btn} title="Download"><Download className="size-4" /></a>
                )}
                <DialogPrimitive.Close className={btn} title="Close (Esc)"><X className="size-5" /></DialogPrimitive.Close>
            </div>
            <div
                ref={(el) => { stage.current = el; setStageEl(el); }}
                className={`relative min-h-0 flex-1 touch-none select-none overflow-hidden ${scale > 1 ? "cursor-grab active:cursor-grabbing" : ""}`}
                onPointerDown={(e) => {
                    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
                    e.currentTarget.setPointerCapture(e.pointerId);
                    if (touches.current.size === 2) {
                        const [a, b] = [...touches.current.values()];
                        pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: view.current.scale };
                        if (drag.current) drag.current.moved = true; // a pinch is never a click / swipe
                        return;
                    }
                    drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y, moved: false };
                    setDragging(true);
                }}
                onPointerMove={(e) => {
                    if (touches.current.has(e.pointerId)) touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
                    const pz = pinch.current;
                    if (pz && touches.current.size === 2) {
                        const [a, b] = [...touches.current.values()];
                        const dist = Math.hypot(a.x - b.x, a.y - b.y);
                        if (pz.dist > 0) zoomTo((pz.scale * dist) / pz.dist, (a.x + b.x) / 2, (a.y + b.y) / 2);
                        return;
                    }
                    const d = drag.current;
                    if (!d) return;
                    const dx = e.clientX - d.x, dy = e.clientY - d.y;
                    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
                    if (view.current.scale > 1) {
                        const p = { x: d.px + dx, y: d.py + dy };
                        view.current = { scale: view.current.scale, ...p };
                        setPos(p);
                    }
                }}
                onPointerUp={(e) => {
                    touches.current.delete(e.pointerId);
                    if (touches.current.size < 2) pinch.current = null;
                    const d = drag.current;
                    if (touches.current.size > 0) return; // still a finger down
                    drag.current = null;
                    setDragging(false);
                    if (!d) return;
                    const dx = e.clientX - d.x;
                    // Not zoomed: a sideways swipe flips the photo.
                    if (view.current.scale === 1 && count > 1 && Math.abs(dx) > SWIPE && Math.abs(dx) > Math.abs(e.clientY - d.y)) {
                        go(dx < 0 ? 1 : -1);
                        return;
                    }
                    // A plain click on the backdrop (not the photo) closes.
                    if (!d.moved && e.target === e.currentTarget) onClose();
                }}
                onPointerCancel={(e) => {
                    touches.current.delete(e.pointerId);
                    pinch.current = null;
                    drag.current = null;
                    setDragging(false);
                }}
                onDoubleClick={(e) => zoomTo(scale > 1 ? 1 : 2, e.clientX, e.clientY)}
            >
                {count > 1 && (
                    <>
                        <button type="button" className={`${arrow} left-3`} title="Previous (←)" onPointerDown={(e) => e.stopPropagation()} onClick={() => go(-1)}>
                            <ChevronLeft className="size-6" />
                        </button>
                        <button type="button" className={`${arrow} right-3`} title="Next (→)" onPointerDown={(e) => e.stopPropagation()} onClick={() => go(1)}>
                            <ChevronRight className="size-6" />
                        </button>
                    </>
                )}
                {/* eslint-disable-next-line @next/next/no-img-element -- signed, expiring link; next/image would cache it */}
                <img
                    key={current}
                    src={current}
                    alt={alt ?? "Photo"}
                    draggable={false}
                    className="absolute left-1/2 top-1/2 max-w-[100vw] max-h-[calc(100dvh-5rem)]"
                    style={{
                        transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px) scale(${scale}) rotate(${rot}deg)`,
                        transition: dragging ? "none" : "transform 120ms ease-out",
                    }}
                />
            </div>
        </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
}
