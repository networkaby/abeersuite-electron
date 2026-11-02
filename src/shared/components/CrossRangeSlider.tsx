"use client";

import { useRef, type KeyboardEvent, type PointerEvent } from "react";

/**
 * Two-thumb min / max slider whose thumbs MAY CROSS.
 *
 *   min ≤ max → keeps the inside: the part between the thumbs is blue.
 *   min > max → keeps the OUTSIDE (≤ max or ≥ min): both ends are blue and the
 *               skipped middle is amber.
 *
 * A thumb parked at its own end means "no limit" on that side — the caller maps
 * that to an empty value. Radix's slider sorts its thumbs, so it cannot show a
 * crossed range; this one keeps "min" and "max" as two independent thumbs.
 */
export function CrossRangeSlider({
    lo, hi, step, min, max, onChange, className = "", ariaLabel,
}: {
    /** Track ends. */
    lo: number;
    hi: number;
    step: number;
    /** Current thumbs (already clamped to [lo, hi] by the caller is fine). */
    min: number;
    max: number;
    onChange: (min: number, max: number) => void;
    className?: string;
    ariaLabel?: string;
}) {
    const trackRef = useRef<HTMLDivElement>(null);
    const span = hi - lo || 1;
    const pct = (v: number) => ((Math.min(hi, Math.max(lo, v)) - lo) / span) * 100;
    const snap = (v: number) => {
        const s = Math.round((v - lo) / step) * step + lo;
        return Math.min(hi, Math.max(lo, Number(s.toFixed(6))));
    };
    const valueAt = (clientX: number) => {
        const r = trackRef.current?.getBoundingClientRect();
        if (!r || r.width === 0) return lo;
        return snap(lo + ((clientX - r.left) / r.width) * span);
    };
    const set = (which: "min" | "max", v: number) => (which === "min" ? onChange(v, max) : onChange(min, v));

    const drag = (which: "min" | "max") => (e: PointerEvent<HTMLButtonElement>) => {
        e.preventDefault();
        e.stopPropagation();
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        el.focus();
        const move = (ev: globalThis.PointerEvent) => set(which, valueAt(ev.clientX));
        const up = () => {
            el.removeEventListener("pointermove", move);
            el.removeEventListener("pointerup", up);
            el.removeEventListener("pointercancel", up);
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
        el.addEventListener("pointercancel", up);
    };
    // Click on the track moves the nearer thumb there.
    const onTrackDown = (e: PointerEvent<HTMLDivElement>) => {
        const v = valueAt(e.clientX);
        set(Math.abs(v - min) <= Math.abs(v - max) ? "min" : "max", v);
    };
    const onKey = (which: "min" | "max") => (e: KeyboardEvent<HTMLButtonElement>) => {
        const cur = which === "min" ? min : max;
        const big = step * 10;
        const next =
            e.key === "ArrowLeft" || e.key === "ArrowDown" ? cur - step
                : e.key === "ArrowRight" || e.key === "ArrowUp" ? cur + step
                    : e.key === "PageDown" ? cur - big
                        : e.key === "PageUp" ? cur + big
                            : e.key === "Home" ? lo
                                : e.key === "End" ? hi
                                    : null;
        if (next == null) return;
        e.preventDefault();
        set(which, snap(next));
    };

    const a = pct(min);
    const b = pct(max);
    const crossed = min > max;
    const thumb = (which: "min" | "max", at: number, value: number) => (
        <button
            type="button"
            role="slider"
            aria-label={`${ariaLabel ?? "Range"} ${which}`}
            aria-valuemin={lo}
            aria-valuemax={hi}
            aria-valuenow={value}
            onPointerDown={drag(which)}
            onKeyDown={onKey(which)}
            style={{ left: `${at}%` }}
            className={`absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border bg-white shadow-sm outline-none hover:ring-4 hover:ring-ring/30 focus-visible:ring-4 focus-visible:ring-ring/40 active:cursor-grabbing ${crossed ? "border-amber-500" : "border-primary"}`}
        />
    );

    return (
        <div className={`relative h-4 touch-none select-none ${className}`} onPointerDown={onTrackDown}>
            <div ref={trackRef} className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-muted">
                {crossed ? (
                    <>
                        {/* kept: start → max, and min → end; skipped middle in amber */}
                        <div className="absolute inset-y-0 bg-primary" style={{ left: 0, width: `${b}%` }} />
                        <div className="absolute inset-y-0 bg-amber-400" style={{ left: `${b}%`, width: `${a - b}%` }} />
                        <div className="absolute inset-y-0 bg-primary" style={{ left: `${a}%`, right: 0 }} />
                    </>
                ) : (
                    <div className="absolute inset-y-0 bg-primary" style={{ left: `${a}%`, width: `${b - a}%` }} />
                )}
            </div>
            {thumb("min", a, min)}
            {thumb("max", b, max)}
        </div>
    );
}
