"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useObjectUrls } from "@/shared/hooks";
import {
  AlertTriangle,
  Crop,
  Pencil,
  RotateCcw,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import PostSharePanel from "./PostSharePanel";
import PhotoAdjustDialog from "./PhotoAdjustDialog";
import PostPreviews, { type PreviewItem } from "./PostPreviews";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";

const SHOP_SITE = COMPANY_DETAILS.sites.shop;
import {
  CHANNEL_SPECS,
  GOOGLE_BUTTONS,
  GOOGLE_POST_TYPES,
  POST_CHANNELS,
  postPhotos,
  ratioFits,
  withHashtags,
  hasPhoneNumber,
  channelText,
  hashtagCount,
  INSTAGRAM_HASHTAGS_MAX,
  CHANNEL_MEDIA,
  mediaNoun,
  takesMedia,
  FACEBOOK_PHOTO_MAX_BYTES,
  FACEBOOK_PNG_SOFT_BYTES,
  type PhotoCrop,
  type PostChannel,
  type PostRow,
} from "@/modules/campaigns/lib/post";

/** A channel's copy as the form holds it: null = follows the master; `scheduledAt` a datetime-local string. */
export type CopyForm = {
  caption: string | null;
  scheduledAt: string | null;
  photos: string[] | null;
};

/** Cards in the order people look at them: the networks that post by themselves first. */
const ORDER = [
  "GOOGLE_BUSINESS",
  "FACEBOOK",
  "FACEBOOK_STORY",
  "FACEBOOK_REEL",
  "INSTAGRAM",
  "INSTAGRAM_STORY",
  "INSTAGRAM_REEL",
  "WA_CHANNEL",
  "WA_STATUS",
];

const when = (local: string) =>
  new Date(local).toLocaleString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

const pill = (on: boolean) =>
  `rounded-md border px-2.5 py-1 text-xs ${on ? "border-primary bg-primary/10 font-medium" : "bg-card text-muted-foreground hover:bg-muted/50"}`;

/**
 * The post editor's platform cards (owner, 2026-10-29: "independent card for
 * each platform … full card with all features"). Every platform is a block of
 * its own, under Master, with an on/off switch — the
 * same tick as Master's "Post to". An "on" card shows what goes out there:
 * text, time and photo each follow the Master until Change gives that
 * platform its own (Reset puts it back). Google's post type and button live
 * in its card. With a saved photo, Fit cuts it to the platform's shape, and
 * the card ends with that platform's Post now / Share / Done.
 */
export default function PostPlatformCards({
  channels,
  onToggle,
  copies,
  onChange,
  master,
  post,
  onFit,
  google,
  onGoogle,
  onPostChanged,
  pending,
  productImage,
  onUpload,
  cardFiles,
  onDropCardFile,
  prePick,
  onPrePick,
  head,
  foot,
}: {
  channels: string[];
  onToggle: (channel: string) => void;
  copies: Record<string, CopyForm>;
  onChange: (channel: string, copy: CopyForm | null) => void;
  master: { caption: string; hashtags: string; scheduledAt: string; link: string };
  post: PostRow | null;
  /** Cut a photo to shape — every ticked channel, or `channels`; with `crop`, that frame for one. */
  onFit: (opts?: {
    channels?: string[];
    key?: string;
    crop?: PhotoCrop | null;
  }) => Promise<void>;
  google: { type: string; button: string | null };
  onGoogle: (patch: { type?: string; button?: string | null }) => void;
  onPostChanged: (p: PostRow) => void;
  /** A new post's photos, not uploaded yet — the first is the main one. */
  pending: File[];
  /** The shop product's photo a new post starts from, when no photo was picked. */
  productImage: string | null;
  /** A photo for one platform only, from its card. */
  onUpload: (channel: string, file: File) => Promise<void>;
  /** Before the first save: each card's own photo, waiting. */
  cardFiles: Record<string, File>;
  onDropCardFile: (channel: string) => void;
  /** Before the first save: the Master photo a platform takes instead of the main one. */
  prePick: Record<string, File[]>;
  /** null = follow Master's main photo again. */
  onPrePick: (channel: string, files: File[] | null) => void;
  /** Above the cards and below them, in the same column — the previews sit beside all of it. */
  head?: React.ReactNode;
  foot?: React.ReactNode;
}) {
  const [fitting, setFitting] = useState<string | null>(null);
  // The platform whose card is in view — the preview beside the cards shows that one only.
  const [active, setActive] = useState<string | null>(null);
  const cardEls = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    const seen = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set((e.target as HTMLElement).dataset.channel ?? "", e.isIntersecting ? e.intersectionRect.height : 0);
        const best = [...seen].filter(([c]) => channels.includes(c)).sort((a, b) => b[1] - a[1])[0];
        if (best && best[1] > 0) setActive(best[0]);
      },
      // A card counts while it crosses the upper middle of the screen.
      { rootMargin: "-25% 0px -45% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    for (const el of cardEls.current.values()) io.observe(el);
    return () => io.disconnect();
  }, [channels]);
  const shownChannel = active && channels.includes(active) ? active : (ORDER.find((c) => channels.includes(c)) ?? null);
  const showCard = (c: string) => {
    setActive(c);
    cardEls.current.get(c)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  // Each photo's size once its thumbnail loads, for the shape warning.
  const [dims, setDims] = useState<Record<string, [number, number]>>({});
  const photos = post ? postPhotos(post) : [];
  const canFit = !!post && !!photos[0]?.type.startsWith("image/");
  // Before the first save: the main photo as each platform will get it.
  const firstPending = pending.find((f) => f.type.startsWith("image/")) ?? null;
  const firstList = useMemo(
    () => (firstPending ? [firstPending] : []),
    [firstPending],
  );
  const previewSrc = useObjectUrls(firstList)[0] ?? productImage;
  // Every Master photo waiting for the first save, previewed (same links as Master's strip).
  const pendingUrls = useObjectUrls(pending);
  const fit = async (id: string, opts?: { channels?: string[] }) => {
    setFitting(id);
    try {
      await onFit(opts);
    } finally {
      setFitting(null);
    }
  };
  // Each card's own waiting photo, previewed.
  const cardList = useMemo(
    () => ORDER.flatMap((c) => (cardFiles[c] ? [cardFiles[c]] : [])),
    [cardFiles],
  );
  const cardUrls = useObjectUrls(cardList);
  const cardSrc = (c: string) => {
    const i = ORDER.filter((x) => cardFiles[x]).indexOf(c);
    return i >= 0 ? cardUrls[i] : null;
  };
  // One hidden file box shared by every card's Upload.
  const fileBox = useRef<HTMLInputElement>(null);
  const [uploadFor, setUploadFor] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  // The Adjust editor: which card, from which photo, with the last frame.
  const [adjusting, setAdjusting] = useState<{
    channel: string;
    src: string;
    url: string;
    crop: PhotoCrop | null;
  } | null>(null);
  // What each "on" platform will show, for the previews beside the cards.
  const previews: PreviewItem[] = [];

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
      {head}
      {canFit && (
        <div className="-mb-2 flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={fitting !== null}
            onClick={() => fit("all")}
          >
            <Crop className="mr-1 h-3.5 w-3.5" />{" "}
            {fitting === "all" ? "Fitting…" : "Fit photo for every platform"}
          </Button>
        </div>
      )}
      {ORDER.map((c) => {
        const ch = POST_CHANNELS.find((x) => x.value === c);
        if (!ch) return null;
        const on = channels.includes(c);
        const spec = CHANNEL_SPECS[c as PostChannel];
        const copy = copies[c] ?? null;
        const set = (patch: Partial<CopyForm>) => {
          const next = {
            ...(copy ?? { caption: null, scheduledAt: null, photos: null }),
            ...patch,
          };
          onChange(
            c,
            next.caption === null &&
              next.scheduledAt === null &&
              next.photos === null
              ? null
              : next,
          );
        };
        const ownText = copy?.caption != null;
        const text = withHashtags(
          copy?.caption ?? master.caption,
          master.hashtags,
          c,
        );
        const tooLong = text.length > spec.textMax;
        const ownTime = copy?.scheduledAt != null;
        const time = copy?.scheduledAt ?? master.scheduledAt;
        const ownPhotos = copy?.photos != null;
        const picked = copy?.photos ?? photos.slice(0, 1).map((f) => f.key);
        const offShape = picked.filter(
          (k) => dims[k] && !ratioFits(c, ...dims[k]),
        );
        const shownKey = picked[0];
        const shown = photos.find((f) => f.key === shownKey);
        const srcKey =
          shown?.from && photos.some((f) => f.key === shown.from)
            ? shown.from
            : shownKey;
        const srcPhoto = photos.find((f) => f.key === srcKey);
        const adjustFrom =
          post &&
          srcPhoto &&
          srcPhoto.type.startsWith("image/") &&
          post.photoLinks?.[srcPhoto.key]?.url
            ? {
                src: srcPhoto.key,
                url: post.photoLinks[srcPhoto.key].url as string,
                crop:
                  shown?.from === srcPhoto.key ? (shown.crop ?? null) : null,
              }
            : null;
        const originals = photos.filter((f) => (!f.from || !photos.some((o) => o.key === f.from)) && takesMedia(c, f.type));
        /** Where an original sits in this platform's picks — itself, or a copy cut from it. */
        const pickedAt = (key: string) => picked.findIndex((k) => k === key || photos.find((f) => f.key === k)?.from === key);
        const togglePhoto = (key: string) => {
          const at = pickedAt(key);
          if (at >= 0) return set({ photos: picked.filter((_, i) => i !== at) });
          if (spec.photosMax === 1) return set({ photos: [key] });
          if (picked.length >= spec.photosMax) return;
          set({ photos: [...picked, key] });
        };
        // Before the first save: this platform's own pick of Master photos (several where it takes several).
        const usablePending = pending.filter((f) => takesMedia(c, f.type));
        const preOwn = (prePick[c] ?? []).filter((f) => usablePending.includes(f));
        // Follows the main photo when it can carry it; a video-only platform starts on the first video.
        const preShown = preOwn.length ? preOwn : usablePending.slice(0, 1);
        const prePickToggle = (f: File) => {
          if (spec.photosMax === 1) {
            onPrePick(c, f === pending[0] && takesMedia(c, f.type) ? null : [f]);
            return;
          }
          const next = preShown.includes(f) ? preShown.filter((x) => x !== f) : [...preShown, f].slice(0, spec.photosMax);
          onPrePick(c, next.length === 1 && next[0] === pending[0] ? null : next);
        };
        if (on) {
          // What this platform's sender really sends: its photos (or video), and
          // the shop link where it adds one — Google never (its button carries it),
          // a story has no text. Instagram and the one-photo platforms send the first only.
          const media = post
            ? picked.flatMap((k) => {
                const f = photos.find((x) => x.key === k);
                const u = f && post.photoLinks?.[k]?.url;
                return f && u ? [{ src: u, video: f.type.startsWith("video/") }] : [];
              })
            : cardSrc(c)
              ? [{ src: cardSrc(c)!, video: cardFiles[c]?.type.startsWith("video/") ?? false }]
              : preShown.length
                ? preShown.map((f) => ({ src: pendingUrls[pending.indexOf(f)], video: f.type.startsWith("video/") }))
                : previewSrc
                  ? [{ src: previewSrc, video: false }]
                  : [];
          // The ones whose sender posts every item: feed grid, carousel, stories in order.
          const sendsAll = ["FACEBOOK", "FACEBOOK_STORY", "INSTAGRAM", "INSTAGRAM_STORY"].includes(c);
          // Only what this platform carries: no photos in a reel, no videos on Google.
          const usable = media.filter((m) => (m.video ? CHANNEL_MEDIA[c] !== "photo" : CHANNEL_MEDIA[c] !== "video"));
          const shown = sendsAll ? usable : usable.slice(0, 1);
          previews.push({
            channel: c,
            label: ch.label,
            src: shown[0]?.src ?? null,
            video: shown[0]?.video ?? false,
            count: shown.length || 1,
            srcs: shown.filter((m) => !m.video).map((m) => m.src),
            media: shown,
            text: channelText(c, text, master.link || null, SHOP_SITE),
            time,
            button:
              GOOGLE_BUTTONS.find((b) => b.value === google.button)?.label ??
              null,
          });
        }

        return (
          <section
            key={c}
            data-channel={c}
            ref={(el) => {
              if (el) cardEls.current.set(c, el);
              else cardEls.current.delete(c);
            }}
            className={`scroll-mt-4 overflow-hidden rounded-xl border text-card-foreground shadow-sm transition-shadow ${on ? (tooLong ? "border-destructive bg-card" : "bg-card") : "bg-muted/40"} ${on && shownChannel === c ? "ring-2 ring-primary/60" : ""}`}
          >
            <div
              className="flex items-center gap-3 border-b px-4 py-2.5"
              style={
                on
                  ? {
                      background:
                        "color-mix(in oklab, var(--m-campaigns) 12%, var(--card))",
                    }
                  : undefined
              }
            >
              <h2
                className={`text-base font-semibold ${on ? "" : "text-muted-foreground"}`}
              >
                {ch.label}
              </h2>
              <span className="min-w-0 flex-1 truncate text-xs text-foreground/70">
                {spec.textMax ? `${spec.textMax} chars · ` : "no caption · "}
                {spec.photosMax === 1
                  ? `1 ${mediaNoun(c)}`
                  : `up to ${spec.photosMax} ${mediaNoun(c, true)}`}{" "}
                · best {spec.ratioLabel}
                {ch.mode === "AUTO" || c === "GOOGLE_BUSINESS"
                  ? " · posts by itself once connected"
                  : " · shared from a phone"}
              </span>
              <span
                className={`text-xs font-medium ${on ? "text-primary" : "text-muted-foreground"}`}
              >
                {on ? "On" : "Off"}
              </span>
              <Switch
                checked={on}
                disabled={!ch.ready}
                onCheckedChange={() => onToggle(c)}
                aria-label={`Post to ${ch.label}`}
              />
            </div>

            {on && (
              <div className="grid gap-4 p-4 text-sm lg:grid-cols-2">
                <div className="space-y-3">
                  {spec.textMax === 0 ? (
                    <p className="text-sm text-foreground/70">
                      A story shows no caption — just the photo or video, for 24 hours.
                    </p>
                  ) : (
                  <Row
                    label="Text"
                    own={ownText}
                    note={`${text.length}/${spec.textMax}`}
                    warn={tooLong}
                    onChange={() => set({ caption: master.caption })}
                    onReset={() => set({ caption: null })}
                  >
                    {ownText ? (
                      <Textarea
                        rows={4}
                        value={copy!.caption!}
                        onChange={(e) => set({ caption: e.target.value })}
                      />
                    ) : (
                      <p
                        className={`line-clamp-6 rounded-md border bg-muted/30 p-2 text-sm leading-snug whitespace-pre-line ${text ? "" : "text-muted-foreground"}`}
                      >
                        {text ||
                          "No main text — write it in Master, or Change to write this platform's own."}
                      </p>
                    )}
                    {ownText &&
                      master.hashtags.trim() &&
                      text !== copy!.caption && (
                        <p className="text-xs text-foreground/70">
                          Master hashtags are added under it.
                        </p>
                      )}
                    {tooLong && (
                      <p className="text-xs font-medium text-destructive">
                        Too long here — change it to a shorter copy.
                      </p>
                    )}
                      {c === "FACEBOOK" &&
                        (master.hashtags.match(/#[^\s#]+/g)?.length ?? 0) >
                          3 && (
                          <p className="text-xs text-foreground/70">
                            Facebook works best with 1–3 hashtags; Master has{" "}
                            {master.hashtags.match(/#[^\s#]+/g)?.length}.
                          </p>
                        )}
                    {(c === "INSTAGRAM" || c === "INSTAGRAM_REEL") && hashtagCount(text) > INSTAGRAM_HASHTAGS_MAX && (
                      <p className="text-xs font-medium text-destructive">
                        Instagram allows {INSTAGRAM_HASHTAGS_MAX} hashtags at most — this has {hashtagCount(text)}.
                      </p>
                    )}
                    {(c === "INSTAGRAM" || c === "INSTAGRAM_REEL") && master.link && (
                      <p className="text-xs text-foreground/70">Links do not work on Instagram — the caption says &quot;🔗 Link in bio&quot; instead.</p>
                    )}
                    {c === "GOOGLE_BUSINESS" && hasPhoneNumber(text) && (
                      <p className="flex items-center gap-1 text-xs font-medium text-amber-700">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />{" "}
                        Google may reject a post with a phone number in it —
                        remove it and pick the Call now button.
                      </p>
                    )}
                    {c === "GOOGLE_BUSINESS" && (
                      <p className="text-xs text-foreground/70">
                        No shop link in the text here — Google rejects web
                        addresses in posts. The button carries it.
                      </p>
                    )}
                  </Row>
                  )}
                </div>

                <div className="space-y-3">
                  <Row
                    label="Time"
                    own={ownTime}
                    onChange={() =>
                      set({ scheduledAt: master.scheduledAt || "" })
                    }
                    onReset={() => set({ scheduledAt: null })}
                  >
                    {ownTime ? (
                      <Input
                        type="datetime-local"
                        className="w-60"
                        value={copy!.scheduledAt ?? ""}
                        onChange={(e) => set({ scheduledAt: e.target.value })}
                      />
                    ) : (
                      <p className="text-sm">
                        {time ? (
                          when(time)
                        ) : (
                          <span className="text-muted-foreground">
                            No time — stays a draft
                          </span>
                        )}
                      </p>
                    )}
                  </Row>

                  <Row
                    label={c === "FACEBOOK_REEL" ? "Video" : c === "FACEBOOK_STORY" ? "Photo or video" : "Photo"}
                    own={
                      ownPhotos ||
                      !!cardFiles[c] ||
                      (!post && preOwn.length > 0)
                    }
                    changeLabel={null}
                    onChange={() => undefined}
                    onReset={() => {
                      set({ photos: null });
                      onPrePick(c, null);
                    }}
                    extra={
                      <>
                        {adjustFrom && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-xs"
                            disabled={fitting !== null}
                            onClick={() =>
                              setAdjusting({ channel: c, ...adjustFrom })
                            }
                          >
                            <Crop className="mr-1 h-3 w-3" /> Adjust{" "}
                            {spec.ratio.join(":")}
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs"
                          disabled={uploading !== null}
                          onClick={() => {
                            setUploadFor(c);
                            fileBox.current?.click();
                          }}
                        >
                          <Upload className="mr-1 h-3 w-3" />{" "}
                          {uploading === c ? "Uploading…" : "Upload"}
                        </Button>
                      </>
                    }
                  >
                    {!post && cardSrc(c) ? (
                      <div className="flex items-end gap-3">
                        <div
                          className="relative h-32 shrink-0 overflow-hidden rounded-md border bg-muted"
                          style={{
                            aspectRatio: `${spec.ratio[0]} / ${spec.ratio[1]}`,
                          }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element -- a local preview */}
                          <img
                            src={cardSrc(c)!}
                            alt={`${ch.label} photo`}
                            className="size-full object-cover"
                          />
                          <button
                            type="button"
                            aria-label="Remove this platform's photo"
                            onClick={() => onDropCardFile(c)}
                            className="absolute top-0 right-0 rounded-bl bg-black/60 p-0.5 text-white"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                        <p className="text-xs text-foreground/70">
                          {ch.label}&apos;s own photo — uploads on save. After
                          saving, Adjust lets you frame it.
                        </p>
                      </div>
                    ) : (
                      (() => {
                        // Every photo in Master, ticked where this platform uses it (order = number).
                        const tiles = post
                          ? originals.map((f) => ({
                              id: f.key,
                              name: f.name,
                              src: post.photoLinks?.[f.key]?.url ?? null,
                              video: f.type.startsWith("video/"),
                              at: pickedAt(f.key),
                              main: f.key === post.mediaKey,
                              pick: () => togglePhoto(f.key),
                            }))
                          : pending.flatMap((f, i) =>
                              takesMedia(c, f.type)
                                ? [
                                    {
                                      id: pendingUrls[i] ?? String(i),
                                      name: f.name,
                                      src: pendingUrls[i] ?? null,
                                      video: f.type.startsWith("video/"),
                                      at: preShown.indexOf(f),
                                      main: i === 0,
                                      pick: () => prePickToggle(f),
                                    },
                                  ]
                                : [],
                            );
                        const count = tiles.filter((t) => t.at >= 0).length;
                        const full = spec.photosMax > 1 && count >= spec.photosMax;
                        if (!tiles.length && (CHANNEL_MEDIA[c] === "video" || !(!post && previewSrc)))
                          return (
                            <p className="text-sm text-muted-foreground">
                              {c === "FACEBOOK_REEL"
                                ? "No video yet — Upload one upright MP4 just for the reel"
                                : `No photo yet — add one in Master, or Upload one just for ${ch.label}`}
                              {c === "INSTAGRAM" ? " (Instagram needs one)" : ""}.
                            </p>
                          );
                        if (!tiles.length)
                          return <p className="text-xs text-foreground/70">The shop product&apos;s photo, cut to {spec.ratioLabel} on save.</p>;
                        return (
                          <div className="space-y-1">
                            <div className="flex flex-wrap gap-1.5">
                              {tiles.map((t) => {
                                const sel = t.at >= 0;
                                return (
                                  <button
                                    key={t.id}
                                    type="button"
                                    aria-pressed={sel}
                                    title={t.name}
                                    disabled={!sel && full}
                                    onClick={t.pick}
                                    className={`relative size-16 shrink-0 overflow-hidden rounded-md border-2 bg-muted ${sel ? "border-primary" : "border-transparent opacity-50 hover:opacity-100"} disabled:cursor-not-allowed disabled:opacity-25`}
                                  >
                                    {t.src && !t.video ? (
                                      // eslint-disable-next-line @next/next/no-img-element -- a local preview or a signed private R2 link
                                      <img
                                        src={t.src}
                                        alt={t.name}
                                        className="size-full object-cover"
                                        onLoad={(e) => {
                                          const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
                                          setDims((d) => (d[t.id] ? d : { ...d, [t.id]: [w, h] }));
                                        }}
                                      />
                                    ) : (
                                      <span className="flex size-full items-center justify-center text-[10px]">Video</span>
                                    )}
                                    {sel && (
                                      <span className="absolute top-0.5 left-0.5 rounded bg-primary px-1 text-[10px] text-primary-foreground">
                                        {spec.photosMax > 1 ? t.at + 1 : "✓"}
                                      </span>
                                    )}
                                    {t.main && (
                                      <span className="absolute bottom-0 left-0 rounded-tr bg-black/60 px-1 text-[10px] text-white">Main</span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                            <p className="text-xs text-foreground/70">
                              {spec.photosMax > 1
                                ? `${count} of up to ${spec.photosMax} ticked — the number is their order. Each is cut to ${spec.ratioLabel}${post ? "" : " on save"}.`
                                : CHANNEL_MEDIA[c] === "video"
                                  ? `${ch.label} takes 1 video — click another to swap.`
                                  : `${ch.label} takes 1 ${mediaNoun(c)} — click another to swap. Cut to ${spec.ratioLabel}${post ? "" : " on save"}.`}
                            </p>
                          </div>
                        );
                      })()
                    )}
                      {c === "FACEBOOK" &&
                        (() => {
                          const files = picked.flatMap((k) =>
                            photos.filter((f) => f.key === k),
                          );
                          const big = files.filter(
                            (f) =>
                              f.type.startsWith("image/") &&
                              f.size > FACEBOOK_PHOTO_MAX_BYTES,
                          );
                          const softPng = files.filter(
                            (f) =>
                              f.type === "image/png" &&
                              f.size > FACEBOOK_PNG_SOFT_BYTES &&
                              f.size <= FACEBOOK_PHOTO_MAX_BYTES,
                          );
                          return (
                            <>
                              {big.length > 0 && (
                                <p className="flex items-center gap-1 text-xs font-medium text-destructive">
                                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />{" "}
                                  {big.length === 1
                                    ? "A photo is"
                                    : `${big.length} photos are`}{" "}
                                  over 4 MB — Facebook may refuse it. Adjust or
                                  Fit makes a smaller JPG.
                                </p>
                              )}
                              {softPng.length > 0 && (
                                <p className="flex items-center gap-1 text-xs text-amber-700">
                                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />{" "}
                                  A PNG over 1 MB can look blurry on Facebook —
                                  Fit or Adjust saves a JPG.
                                </p>
                              )}
                            </>
                          );
                        })()}
                    {offShape.length > 0 && (
                      <p className="flex items-center gap-1 text-xs text-amber-700">
                        <AlertTriangle className="h-3.5 w-3.5" /> Not{" "}
                          {spec.ratioLabel} — may be cropped. Fit makes a copy
                          in shape.
                      </p>
                    )}
                  </Row>

                  {c === "GOOGLE_BUSINESS" && (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="w-14 text-xs text-muted-foreground">
                          Type
                        </span>
                        {GOOGLE_POST_TYPES.map((t) => (
                          <button
                            key={t.value}
                            type="button"
                            className={pill(google.type === t.value)}
                            onClick={() => onGoogle({ type: t.value })}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="w-14 text-xs text-muted-foreground">
                          Button
                        </span>
                        <button
                          type="button"
                          className={pill(google.button === null)}
                          onClick={() => onGoogle({ button: null })}
                        >
                          None
                        </button>
                        {GOOGLE_BUTTONS.map((b) => (
                          <button
                            key={b.value}
                            type="button"
                            className={pill(google.button === b.value)}
                            onClick={() => onGoogle({ button: b.value })}
                          >
                            {b.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-1 border-t pt-3 lg:col-span-2">
                  <span className="text-xs font-medium">Post it</span>
                  {post ? (
                    <PostSharePanel
                      post={post}
                      onChanged={onPostChanged}
                      only={c}
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Save the post — then Post now, Share and Done show here.
                    </p>
                  )}
                </div>
              </div>
            )}
          </section>
        );
      })}
      <input
        ref={fileBox}
        type="file"
        accept={
          uploadFor && CHANNEL_MEDIA[uploadFor] === "video"
            ? "video/mp4"
            : uploadFor && CHANNEL_MEDIA[uploadFor] === "photo"
              ? "image/jpeg,image/png,image/webp"
              : "image/jpeg,image/png,image/webp,video/mp4"
        }
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f || !uploadFor) return;
          setUploading(uploadFor);
          try {
            await onUpload(uploadFor, f);
          } finally {
            setUploading(null);
          }
        }}
      />
      {adjusting && (
        <PhotoAdjustDialog
          key={`${adjusting.channel}-${adjusting.src}`}
          open
          onOpenChange={(o) => !o && setAdjusting(null)}
          src={adjusting.url}
          ratio={CHANNEL_SPECS[adjusting.channel as PostChannel].ratio}
          title={`Frame the photo for ${POST_CHANNELS.find((x) => x.value === adjusting.channel)?.label ?? adjusting.channel}`}
          initial={adjusting.crop}
          onSave={(crop) =>
            onFit({ channels: [adjusting.channel], key: adjusting.src, crop })
          }
        />
      )}
      {foot}
      </div>
      <aside className="min-w-0 xl:sticky xl:top-4 xl:max-h-[calc(100dvh-6rem)] xl:self-start xl:overflow-y-auto">
        <PostPreviews items={previews} active={shownChannel} onPick={showCard} />
      </aside>
    </div>
  );
}

/** One line of a platform card: what it is, whether it follows the Master, and Change / Reset. */
function Row({
  label,
  own,
  note,
  warn,
  changeLabel = "Change",
  onChange,
  onReset,
  extra,
  children,
}: {
  label: string;
  own: boolean;
  note?: string;
  warn?: boolean;
  /** null = nothing to change to: no button. */
  changeLabel?: string | null;
  onChange: () => void;
  onReset: () => void;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-semibold">{label}</span>
        <span
          className={`rounded border px-1.5 text-[11px] font-medium ${own ? "border-primary/30 bg-primary/10 text-primary" : "bg-muted text-foreground/70"}`}
        >
          {own ? "Own" : "Master"}
        </span>
        {note && (
          <span
            className={`text-[11px] ${warn ? "font-medium text-destructive" : "text-muted-foreground"}`}
          >
            {note}
          </span>
        )}
        <span className="flex-1" />
        {extra}
        {own ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            onClick={onReset}
          >
            <RotateCcw className="mr-1 h-3 w-3" /> Reset
          </Button>
        ) : changeLabel === null ? null : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            onClick={onChange}
          >
            <Pencil className="mr-1 h-3 w-3" /> {changeLabel}
          </Button>
        )}
      </div>
      {children}
    </div>
  );
}
