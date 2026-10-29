"use client";

import {
  Bookmark,
  Ellipsis,
  Forward,
  Globe,
  Heart,
  MessageCircle,
  Send,
  Share2,
  ThumbsUp,
} from "lucide-react";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { CHANNEL_SPECS, type PostChannel } from "@/modules/campaigns/lib/post";

/** What one platform will show: its photo, its words, its time. */
export type PreviewItem = {
  channel: string;
  label: string;
  src: string | null;
  /** The first item is a video (story, reel, or a feed video). */
  video?: boolean;
  /** How many photos go out — more than one shows the carousel dots. */
  count: number;
  /** Every photo, in order, where the app shows them together (Facebook's grid). */
  srcs?: string[];
  text: string;
  /** datetime-local string, or "" for a draft. */
  time: string;
  /** Google's button label, or null. */
  button: string | null;
};

const NAME = COMPANY_DETAILS.brandName;
const HANDLE = NAME.toLowerCase().replace(/[^a-z0-9]+/g, ".");

const stamp = (local: string, style: "short" | "clock") => {
  if (!local) return style === "clock" ? "now" : "Just now";
  const d = new Date(local);
  return style === "clock"
    ? d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })
    : d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
};

/**
 * Look-alikes of how each platform shows the post (owner, 2026-10-30: "real
 * preview platform wise", like Buffer's side panel). Drawn here, not fetched —
 * no platform offers a preview API — so shape, crop and where the text cuts
 * off match; the apps' own pixels may differ.
 */
export default function PostPreviews({ items }: { items: PreviewItem[] }) {
  return (
    <section className="rounded-xl border bg-muted/40 text-card-foreground shadow-sm">
      <h2 className="border-b px-4 py-2.5 text-sm font-semibold">Post previews</h2>
      <div className="space-y-5 p-3">
        {items.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Switch a platform on to see how it looks there.
          </p>
        )}
        {items.map((it) => (
          <div key={it.channel} className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">{it.label}</p>
            <Frame it={it} />
          </div>
        ))}
      </div>
    </section>
  );
}

function Frame({ it }: { it: PreviewItem }) {
  switch (it.channel) {
    case "FACEBOOK":
      return <Facebook it={it} />;
    case "INSTAGRAM":
      return <Instagram it={it} />;
    case "GOOGLE_BUSINESS":
      return <Google it={it} />;
    case "WA_STATUS":
      return <WaStatus it={it} />;
    case "FACEBOOK_STORY":
      return <FacebookStory it={it} />;
    case "FACEBOOK_REEL":
      return <FacebookReel it={it} />;
    default:
      return <WaChannel it={it} />;
  }
}

/** The shop's round avatar. */
function Avatar({ size = 32 }: { size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full border bg-white"
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- the shop's own logo */}
      <img src={COMPANY_DETAILS.logoUrl} alt="" className="size-[80%] object-contain" />
    </span>
  );
}

/** The post's first photo or video. */
function Media({ it, className }: { it: PreviewItem; className: string }) {
  if (!it.src) return null;
  return it.video ? (
    <video src={it.src} className={className} muted autoPlay loop playsInline />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element -- a local or signed preview
    <img src={it.src} alt="" className={className} />
  );
}

/** The photo cut to the platform's shape, as the app crops it. */
function Photo({ it }: { it: PreviewItem }) {
  const [w, h] = CHANNEL_SPECS[it.channel as PostChannel]?.ratio ?? [1, 1];
  return (
    <div className="relative w-full bg-neutral-200" style={{ aspectRatio: `${w} / ${h}` }}>
      {it.src ? (
        <Media it={it} className="size-full object-cover" />
      ) : (
        <span className="flex size-full items-center justify-center text-xs text-neutral-500">No photo</span>
      )}
      {it.count > 1 && (
        <span className="absolute top-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white">
          1/{it.count}
        </span>
      )}
    </div>
  );
}

/** Text cut off where the app cuts it, with its own "more" word. */
function Clamp({ text, lines, more, className = "" }: { text: string; lines: number; more: string; className?: string }) {
  const long = text.split("\n").length > lines || text.length > lines * 45;
  return (
    <div className={className}>
      <p className="whitespace-pre-line break-words" style={{ display: "-webkit-box", WebkitLineClamp: lines, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
        {text || <span className="opacity-50">No text</span>}
      </p>
      {long && <span className="font-medium opacity-60">{more}</span>}
    </div>
  );
}

function Facebook({ it }: { it: PreviewItem }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-white text-[13px] text-neutral-900">
      <div className="flex items-center gap-2 px-3 pt-3">
        <Avatar size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{NAME}</p>
          <p className="flex items-center gap-1 text-[11px] text-neutral-500">
            {stamp(it.time, "short")} · <Globe className="h-3 w-3" />
          </p>
        </div>
        <Ellipsis className="h-4 w-4 text-neutral-500" />
      </div>
      <Clamp text={it.text} lines={3} more="See more" className="px-3 py-2" />
      {(it.srcs?.length ?? 0) > 1 ? <FacebookGrid srcs={it.srcs!} /> : it.src && <Photo it={it} />}
      <div className="flex justify-around border-t py-2 text-xs font-medium text-neutral-600">
        <span className="flex items-center gap-1"><ThumbsUp className="h-4 w-4" /> Like</span>
        <span className="flex items-center gap-1"><MessageCircle className="h-4 w-4" /> Comment</span>
        <span className="flex items-center gap-1"><Share2 className="h-4 w-4" /> Share</span>
      </div>
    </div>
  );
}

/**
 * How the Facebook feed lays out several photos: 2 side by side, 3 as one
 * wide on top and two below, 4 as a 2×2 square, 5 or more as two on top and
 * three below with "+N" on the last. Facebook also leans on each photo's own
 * shape, so the app can differ a little; the order and the count match.
 */
function FacebookGrid({ srcs }: { srcs: string[] }) {
  const n = srcs.length;
  const cell = (src: string, i: number, className = "", more = 0) => (
    <div key={`${src}-${i}`} className={`relative overflow-hidden bg-neutral-200 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a local or signed preview */}
      <img src={src} alt="" className="size-full object-cover" />
      {more > 0 && <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-2xl font-semibold text-white">+{more}</span>}
    </div>
  );
  if (n === 2) return <div className="grid aspect-square grid-cols-2 gap-0.5">{srcs.map((s, i) => cell(s, i))}</div>;
  if (n === 3)
    return (
      <div className="grid aspect-square grid-cols-2 grid-rows-2 gap-0.5">
        {cell(srcs[0], 0, "col-span-2")}
        {cell(srcs[1], 1)}
        {cell(srcs[2], 2)}
      </div>
    );
  if (n === 4) return <div className="grid aspect-square grid-cols-2 grid-rows-2 gap-0.5">{srcs.map((s, i) => cell(s, i))}</div>;
  return (
    <div className="grid aspect-square grid-cols-6 grid-rows-2 gap-0.5">
      {cell(srcs[0], 0, "col-span-3")}
      {cell(srcs[1], 1, "col-span-3")}
      {srcs.slice(2, 5).map((s, i) => cell(s, i + 2, "col-span-2", i === 2 ? n - 5 : 0))}
    </div>
  );
}

function Instagram({ it }: { it: PreviewItem }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-white text-[13px] text-neutral-900">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="rounded-full bg-gradient-to-tr from-amber-400 via-pink-500 to-purple-600 p-[2px]">
          <Avatar size={28} />
        </span>
        <p className="flex-1 truncate font-semibold">{HANDLE}</p>
        <Ellipsis className="h-4 w-4" />
      </div>
      <Photo it={it} />
      <div className="flex items-center gap-3 px-3 pt-2.5">
        <Heart className="h-5 w-5" />
        <MessageCircle className="h-5 w-5" />
        <Send className="h-5 w-5" />
        <span className="flex-1" />
        <Bookmark className="h-5 w-5" />
      </div>
      <Clamp text={`${HANDLE}  ${it.text}`} lines={2} more="more" className="px-3 pt-1.5 pb-3" />
    </div>
  );
}

function Google({ it }: { it: PreviewItem }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-white text-[13px] text-neutral-900">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <Avatar size={32} />
        <div className="min-w-0">
          <p className="truncate font-medium">{NAME}</p>
          <p className="text-[11px] text-neutral-500">{stamp(it.time, "short")}</p>
        </div>
      </div>
      {it.src && <Photo it={it} />}
      <Clamp text={it.text} lines={4} more="More" className="px-3 pt-2.5 text-neutral-700" />
      <div className="px-3 pt-2 pb-3">
        {it.button ? (
          <span className="inline-block rounded-full border border-neutral-300 px-4 py-1.5 text-xs font-medium text-blue-700">{it.button}</span>
        ) : null}
      </div>
    </div>
  );
}

function WaStatus({ it }: { it: PreviewItem }) {
  return (
    <div className="relative mx-auto w-[220px] overflow-hidden rounded-xl bg-black text-white" style={{ aspectRatio: "9 / 16" }}>
      <Media it={it} className="absolute inset-0 size-full object-contain" />
      <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/60 to-transparent px-2 pt-2 pb-6">
        <div className="h-0.5 rounded bg-white/50"><div className="h-full w-1/3 rounded bg-white" /></div>
        <div className="mt-2 flex items-center gap-1.5 text-[11px]">
          <Avatar size={24} />
          <span className="font-medium">{NAME}</span>
          <span className="opacity-70">{stamp(it.time, "clock")}</span>
        </div>
      </div>
      {it.text && (
        <Clamp text={it.text} lines={3} more="" className="absolute inset-x-0 bottom-0 bg-black/55 px-3 py-2 text-center text-[11px]" />
      )}
    </div>
  );
}

function WaChannel({ it }: { it: PreviewItem }) {
  return (
    <div className="rounded-lg border p-3" style={{ background: "#efeae2" }}>
      <div className="flex items-start gap-1.5">
        <div className="max-w-[90%] overflow-hidden rounded-lg bg-white p-1 text-[13px] text-neutral-900 shadow-sm">
          {it.src && (
            <div className="overflow-hidden rounded-md">
              <Photo it={it} />
            </div>
          )}
          <Clamp text={it.text} lines={14} more="Read more" className="px-1.5 pt-1" />
          <p className="px-1.5 text-right text-[10px] text-neutral-500">{stamp(it.time, "clock")}</p>
        </div>
        <span className="mt-auto flex h-7 w-7 items-center justify-center rounded-full bg-white/80 text-neutral-500">
          <Forward className="h-3.5 w-3.5" />
        </span>
      </div>
    </div>
  );
}

/**
 * The Page's story, as Facebook shows it: full screen 9:16, the progress bar,
 * the Page's name and time, no caption, and the reply bar at the bottom.
 */
function FacebookStory({ it }: { it: PreviewItem }) {
  return (
    <div className="relative mx-auto w-[220px] overflow-hidden rounded-xl bg-neutral-900 text-white" style={{ aspectRatio: "9 / 16" }}>
      {it.src ? (
        <Media it={it} className="absolute inset-0 size-full object-cover" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-xs text-white/60">No photo or video</span>
      )}
      <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/55 to-transparent px-2 pt-2 pb-8">
        {/* One part per story, the first one playing. */}
        <div className="flex gap-0.5">
          {Array.from({ length: Math.max(1, it.count) }, (_, i) => (
            <div key={i} className="h-0.5 flex-1 rounded bg-white/40">
              {i === 0 && <div className="h-full w-1/3 rounded bg-white" />}
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-[11px]">
          <Avatar size={26} />
          <span className="font-semibold">{NAME}</span>
          <span className="opacity-75">{it.time ? stamp(it.time, "clock") : "Just now"}</span>
          <span className="flex-1" />
          <Ellipsis className="h-4 w-4" />
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/55 to-transparent px-2 pt-6 pb-2">
        <span className="flex-1 rounded-full border border-white/70 px-3 py-1 text-[10px] text-white/80">Send message…</span>
        <ThumbsUp className="h-4 w-4" />
        <Heart className="h-4 w-4" />
      </div>
    </div>
  );
}

/**
 * The Page's reel, as Facebook shows it: a full 9:16 video, the Page with
 * Follow and the caption at the bottom left, Like / Comment / Share down the right.
 */
function FacebookReel({ it }: { it: PreviewItem }) {
  return (
    <div className="relative mx-auto w-[220px] overflow-hidden rounded-xl bg-black text-white" style={{ aspectRatio: "9 / 16" }}>
      {it.src && it.video ? (
        <Media it={it} className="absolute inset-0 size-full object-cover" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-white/60">A reel needs one upright MP4 video</span>
      )}
      <p className="absolute top-2 left-3 text-sm font-semibold">Reels</p>
      <div className="absolute right-2 bottom-16 flex flex-col items-center gap-3 text-[10px]">
        <span className="flex flex-col items-center"><ThumbsUp className="h-5 w-5" />Like</span>
        <span className="flex flex-col items-center"><MessageCircle className="h-5 w-5" />Comment</span>
        <span className="flex flex-col items-center"><Share2 className="h-5 w-5" />Share</span>
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pt-8 pb-3 text-[11px]">
        <div className="flex items-center gap-1.5">
          <Avatar size={24} />
          <span className="font-semibold">{NAME}</span>
          <span className="rounded border border-white/80 px-1.5 text-[10px]">Follow</span>
        </div>
        <Clamp text={it.text} lines={2} more="…more" className="mt-1.5 pr-10" />
      </div>
    </div>
  );
}
