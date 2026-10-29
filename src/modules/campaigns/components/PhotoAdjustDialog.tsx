"use client";

import { useRef, useState } from "react";
import { Crosshair, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PhotoCrop } from "@/modules/campaigns/lib/post";

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/**
 * Frame one photo for one platform (owner, 2026-10-29: "adjust photo for each
 * platform like we do in ecommerce", kept free). The frame is the platform's
 * shape; drag it, or click where the important part is, and zoom in. All drawn
 * in the browser — nothing is cut until Save, when the server cuts exactly the
 * framed part with our own sharp (postPhotoFit.ts). "Automatic" lets the server
 * choose the busiest part instead.
 */
export default function PhotoAdjustDialog({
  open,
  onOpenChange,
  src,
  ratio,
  title,
  initial,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: string;
  ratio: [number, number];
  title: string;
  /** The frame this platform's copy was cut with last time, if any. */
  initial: PhotoCrop | null;
  /** null = the automatic cut. */
  onSave: (crop: PhotoCrop | null) => Promise<void>;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<[number, number] | null>(null);
  // Frame centre (fractions) and zoom (1 = the biggest frame that fits).
  const [center, setCenter] = useState({ x: 0.5, y: 0.5 });
  const [zoom, setZoom] = useState(1);
  const [saving, setSaving] = useState(false);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(
    null,
  );

  const want = ratio[0] / ratio[1];
  const frame = (() => {
    if (!size) return null;
    const [w, h] = size;
    const cw = Math.min(1, (h * want) / w) / zoom;
    const ch = (cw * w) / want / h;
    return {
      x: clamp(center.x - cw / 2, 0, 1 - cw),
      y: clamp(center.y - ch / 2, 0, 1 - ch),
      w: cw,
      h: ch,
    };
  })();

  function loaded(w: number, h: number) {
    setSize([w, h]);
    if (initial) {
      const full = Math.min(1, (h * want) / w);
      setZoom(clamp(full / initial.w, 1, 5));
      setCenter({ x: initial.x + initial.w / 2, y: initial.y + initial.h / 2 });
    }
  }

  const fractionAt = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return {
      x: clamp((e.clientX - r.left) / r.width, 0, 1),
      y: clamp((e.clientY - r.top) / r.height, 0, 1),
    };
  };

  async function save(crop: PhotoCrop | null) {
    setSaving(true);
    try {
      await onSave(crop);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Drag the frame, or click the important part. Only what is inside the
            frame goes out.
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-center">
          <div
            ref={box}
            className="relative touch-none overflow-hidden rounded-md bg-muted select-none"
            onPointerDown={(e) => {
              if (!frame) return;
              const p = fractionAt(e);
              const inside =
                p.x >= frame.x &&
                p.x <= frame.x + frame.w &&
                p.y >= frame.y &&
                p.y <= frame.y + frame.h;
              if (!inside) setCenter(p);
              drag.current = {
                x: p.x,
                y: p.y,
                cx: inside ? frame.x + frame.w / 2 : p.x,
                cy: inside ? frame.y + frame.h / 2 : p.y,
              };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!drag.current) return;
              const p = fractionAt(e);
              setCenter({
                x: drag.current.cx + p.x - drag.current.x,
                y: drag.current.cy + p.y - drag.current.y,
              });
            }}
            onPointerUp={() => (drag.current = null)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- a signed private R2 link or a local preview */}
            <img
              src={src}
              alt=""
              draggable={false}
              className="block max-h-[60vh] max-w-full"
              onLoad={(e) =>
                loaded(
                  e.currentTarget.naturalWidth,
                  e.currentTarget.naturalHeight,
                )
              }
            />
            {frame && (
              <div
                className="pointer-events-none absolute cursor-move rounded-sm border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
                style={{
                  left: `${frame.x * 100}%`,
                  top: `${frame.y * 100}%`,
                  width: `${frame.w * 100}%`,
                  height: `${frame.h * 100}%`,
                }}
              >
                <Crosshair className="absolute top-1/2 left-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 text-white/80" />
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 text-sm">
          <span className="text-xs font-medium">Zoom</span>
          <input
            type="range"
            min={1}
            max={4}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="flex-1"
            aria-label="Zoom"
          />
          <span className="w-10 text-right text-xs text-muted-foreground">
            {zoom.toFixed(1)}×
          </span>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => void save(null)}
          >
            <Wand2 className="mr-1.5 h-4 w-4" /> Automatic
          </Button>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={saving || !frame}
              onClick={() => frame && void save(frame)}
            >
              {saving ? "Cutting…" : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
