"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, RotateCw, X, ZoomIn, ZoomOut } from "lucide-react";

const MIN = 1;
const MAX = 8;
const STEP = 1.25;

/**
 * Full-screen photo viewer: wheel / buttons zoom around the cursor, drag pans
 * when zoomed, double-click toggles fit ↔ 2×, rotate for sideways phone shots.
 * Esc or a click on the dark backdrop closes it. Reuses the already-loaded
 * image URL — no extra fetch.
 */
export function ImageViewer({ src, alt, downloadUrl, fileName, onClose }: {
    src: string;
    alt?: string;
    downloadUrl?: string | null;
    fileName?: string | null;
    onClose: () => void;
}) {
    const [scale, setScale] = useState(1);
    const [pos, setPos] = useState({ x: 0, y: 0 });
    const [rot, setRot] = useState(0);
    const drag = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null);
    const stage = useRef<HTMLDivElement>(null);
    const [dragging, setDragging] = useState(false);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") { e.stopPropagation(); onClose(); }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [onClose]);

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

    // Non-passive wheel listener so the page behind does not scroll.
    useEffect(() => {
        const el = stage.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const cur = view.current.scale;
            zoomTo(e.deltaY < 0 ? cur * STEP : cur / STEP, e.clientX, e.clientY);
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, [zoomTo]);

    const btn = "flex size-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/25 transition-colors";

    return createPortal(
        <div className="fixed inset-0 z-[1000] flex flex-col bg-black/90" role="dialog" aria-modal="true" aria-label={alt ?? "Photo"}>
            <div className="flex items-center justify-end gap-2 p-3">
                <span className="mr-auto truncate text-sm text-white/70">{fileName ?? alt ?? ""}</span>
                <span className="w-12 text-center text-xs tabular-nums text-white/70">{Math.round(scale * 100)}%</span>
                <button type="button" className={btn} title="Zoom out" onClick={() => zoomTo(scale / STEP)}><ZoomOut className="size-4" /></button>
                <button type="button" className={btn} title="Zoom in" onClick={() => zoomTo(scale * STEP)}><ZoomIn className="size-4" /></button>
                <button type="button" className={btn} title="Rotate" onClick={() => setRot((r) => (r + 90) % 360)}><RotateCw className="size-4" /></button>
                {downloadUrl && (
                    <a href={downloadUrl} download={fileName ?? "image.jpg"} className={btn} title="Download"><Download className="size-4" /></a>
                )}
                <button type="button" className={btn} title="Close (Esc)" onClick={onClose}><X className="size-5" /></button>
            </div>
            <div
                ref={stage}
                className={`relative flex-1 select-none overflow-hidden ${scale > 1 ? "cursor-grab active:cursor-grabbing" : ""}`}
                onPointerDown={(e) => {
                    drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y, moved: false };
                    e.currentTarget.setPointerCapture(e.pointerId);
                    setDragging(true);
                }}
                onPointerMove={(e) => {
                    const d = drag.current;
                    if (!d) return;
                    const dx = e.clientX - d.x, dy = e.clientY - d.y;
                    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
                    if (scale > 1) {
                        const p = { x: d.px + dx, y: d.py + dy };
                        view.current = { scale, ...p };
                        setPos(p);
                    }
                }}
                onPointerUp={(e) => {
                    const d = drag.current;
                    drag.current = null;
                    setDragging(false);
                    // A plain click on the backdrop (not the photo) closes.
                    if (d && !d.moved && e.target === e.currentTarget) onClose();
                }}
                onDoubleClick={(e) => zoomTo(scale > 1 ? 1 : 2, e.clientX, e.clientY)}
            >
                {/* eslint-disable-next-line @next/next/no-img-element -- signed, expiring link; next/image would cache it */}
                <img
                    src={src}
                    alt={alt ?? "Photo"}
                    draggable={false}
                    className="absolute left-1/2 top-1/2 max-h-full max-w-full"
                    style={{
                        transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px) scale(${scale}) rotate(${rot}deg)`,
                        transition: dragging ? "none" : "transform 120ms ease-out",
                    }}
                />
            </div>
        </div>,
        document.body,
    );
}
