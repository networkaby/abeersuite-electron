import type { CSSProperties } from "react";

// Worker / work colors are stored either as a legacy Tailwind class string
// ("bg-blue-100 text-blue-600") or as a raw hex ("#D442D7"). Hex can't be a Tailwind
// class (purged at build), so it renders via inline style. These helpers keep both
// working — spread the result's className + style onto the element.

const isHex = (c?: string | null): c is string => !!c && c.charCodeAt(0) === 35; // '#'

// Lighten a hex toward white (amt 0–1) for a soft badge background.
function tint(hex: string, amt: number): string {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    const m = (x: number) => Math.round(x + (255 - x) * amt).toString(16).padStart(2, "0");
    return `#${m(r)}${m(g)}${m(b)}`;
}

// Pill / badge — soft tinted bg + the hex as text (legacy → the class string as-is).
export function badgeColor(color?: string | null): { className: string; style?: CSSProperties } {
    return isHex(color)
        ? { className: "", style: { backgroundColor: tint(color, 0.82), color } }
        : { className: color ?? "" };
}

// Solid dot / swatch (legacy → just the bg- class).
export function dotColor(color?: string | null): { className: string; style?: CSSProperties } {
    return isHex(color)
        ? { className: "", style: { backgroundColor: color } }
        : { className: (color ?? "").split(" ").find((c) => c.startsWith("bg-")) ?? "bg-muted" };
}

// Random pleasant hex (random hue, fixed mid saturation/lightness) for new workers.
export function randomHexColor(rand: number): string {
    const h = Math.floor(rand * 360), s = 0.62, l = 0.55;
    const k = (n: number) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))).toString(16).padStart(2, "0");
    return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}
