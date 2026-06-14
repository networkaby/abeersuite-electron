"use client";

import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { badgeColor, randomHexColor } from "@/shared/lib/format/entityColor";

// Random (unlimited) hex by default; the picker / hex box / Random button override.
export const randomColor = () => randomHexColor(Math.random());
export const HEX_RE = /^#[0-9a-fA-F]{6}$/;

// Shared hex color picker (native swatch + hex box + Random + live preview).
// Stored color can be a raw hex ("#D442D7") or a legacy Tailwind class string —
// badgeColor() renders both, so existing class-colored entities keep working.
export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
    return (
        <div className="flex items-center gap-2">
            <input
                type="color"
                aria-label="Pick a custom color"
                value={HEX_RE.test(value) ? value : "#7C9EF0"}
                onChange={(e) => onChange(e.target.value.toUpperCase())}
                className="h-9 w-10 shrink-0 cursor-pointer rounded-md border border-border bg-background p-0.5"
            />
            <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="#D442D7" className="h-9 w-28 font-mono uppercase" />
            <Button type="button" size="sm" variant="outline" onClick={() => onChange(randomColor())} title="Random color">
                <RefreshCw size={13} /> Random
            </Button>
            <Badge {...badgeColor(value)}>Preview</Badge>
        </div>
    );
}
