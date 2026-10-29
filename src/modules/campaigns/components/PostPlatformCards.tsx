"use client";

import { useMemo, useState } from "react";
import { useObjectUrls } from "@/shared/hooks";
import { AlertTriangle, Crop, Pencil, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import PostSharePanel from "./PostSharePanel";
import {
  CHANNEL_SPECS,
  GOOGLE_BUTTONS,
  GOOGLE_POST_TYPES,
  POST_CHANNELS,
  postPhotos,
  ratioFits,
  withHashtags,
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
  "INSTAGRAM",
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
}: {
  channels: string[];
  onToggle: (channel: string) => void;
  copies: Record<string, CopyForm>;
  onChange: (channel: string, copy: CopyForm | null) => void;
  master: { caption: string; hashtags: string; scheduledAt: string };
  post: PostRow | null;
  /** Cut the main photo to shape — `channels`, or every ticked one. */
  onFit: (channels?: string[]) => Promise<void>;
  google: { type: string; button: string | null };
  onGoogle: (patch: { type?: string; button?: string | null }) => void;
  onPostChanged: (p: PostRow) => void;
  /** A new post's photos, not uploaded yet — the first is the main one. */
  pending: File[];
  /** The shop product's photo a new post starts from, when no photo was picked. */
  productImage: string | null;
}) {
  const [fitting, setFitting] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
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
  const fit = async (id: string, list?: string[]) => {
    setFitting(id);
    try {
      await onFit(list);
    } finally {
      setFitting(null);
    }
  };

  return (
    <>
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
        const togglePhoto = (key: string) => {
          const next = picked.includes(key)
            ? picked.filter((k) => k !== key)
            : [...picked, key];
          set({ photos: next.slice(-spec.photosMax) });
        };

        return (
          <section
            key={c}
            className={`overflow-hidden rounded-xl border text-card-foreground shadow-sm ${on ? (tooLong ? "border-destructive bg-card" : "bg-card") : "bg-muted/40"}`}
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
                {spec.textMax} chars ·{" "}
                {spec.photosMax === 1
                  ? "1 photo"
                  : `up to ${spec.photosMax} photos`}{" "}
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
                        {text || "Write the main text in Master."}
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
                  </Row>
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
                    label="Photo"
                    own={ownPhotos}
                    changeLabel={post && photos.length ? "Pick" : undefined}
                    onChange={() => setPicking(picking === c ? null : c)}
                    onReset={() => set({ photos: null })}
                    extra={
                      canFit ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs"
                          disabled={fitting !== null}
                          onClick={() => fit(c, [c])}
                        >
                          <Crop className="mr-1 h-3 w-3" />{" "}
                          {fitting === c
                            ? "Fitting…"
                            : `Fit ${spec.ratio.join(":")}`}
                        </Button>
                      ) : null
                    }
                  >
                    {!post ? (
                      previewSrc ? (
                        <div className="flex items-end gap-3">
                          <div
                            className="h-32 shrink-0 overflow-hidden rounded-md border bg-muted"
                            style={{
                              aspectRatio: `${spec.ratio[0]} / ${spec.ratio[1]}`,
                            }}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element -- a local preview or the product's photo */}
                            <img
                              src={previewSrc}
                              alt={`${ch.label} preview`}
                              className="size-full object-cover"
                            />
                          </div>
                          <p className="text-xs text-foreground/70">
                            Main photo as {spec.ratioLabel}. Cut to this shape
                            on save when &quot;Fit for each channel&quot; is
                            ticked.
                          </p>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          No photo yet — add one in Master
                          {c === "INSTAGRAM" ? " (Instagram needs one)" : ""}.
                        </p>
                      )
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {(picking === c
                          ? photos.map((f) => f.key)
                          : picked
                        ).map((k) => {
                          const f = photos.find((p) => p.key === k);
                          if (!f) return null;
                          const sel = picked.includes(k);
                          const link = post.photoLinks?.[k]?.url;
                          return (
                            <button
                              key={k}
                              type="button"
                              disabled={picking !== c}
                              aria-pressed={sel}
                              onClick={() => togglePhoto(k)}
                              title={f.name}
                              className={`relative shrink-0 overflow-hidden rounded-md border-2 bg-muted ${picking === c ? "size-16" : "h-32"} ${sel ? "border-primary" : "border-transparent opacity-50"}`}
                              style={
                                picking === c
                                  ? undefined
                                  : {
                                      aspectRatio: `${spec.ratio[0]} / ${spec.ratio[1]}`,
                                    }
                              }
                            >
                              {link && !f.type.startsWith("video/") ? (
                                // eslint-disable-next-line @next/next/no-img-element -- a signed private R2 link
                                <img
                                  src={link}
                                  alt={f.name}
                                  className="size-full object-cover"
                                  onLoad={(e) => {
                                    const {
                                      naturalWidth: w,
                                      naturalHeight: h,
                                    } = e.currentTarget;
                                    setDims((d) =>
                                      d[k] ? d : { ...d, [k]: [w, h] },
                                    );
                                  }}
                                />
                              ) : (
                                <span className="flex size-full items-center justify-center bg-muted text-[10px]">
                                  Video
                                </span>
                              )}
                              {sel && picked.length > 1 && (
                                <span className="absolute top-0.5 left-0.5 rounded bg-primary px-1 text-[10px] text-primary-foreground">
                                  {picked.indexOf(k) + 1}
                                </span>
                              )}
                            </button>
                          );
                        })}
                        {!picked.length && picking !== c && (
                          <p className="text-sm text-muted-foreground">
                            No photo — add one in Master.
                          </p>
                        )}
                      </div>
                    )}
                    {picking === c && (
                      <p className="text-xs text-foreground/70">
                        Click photos to pick them for {ch.label}, up to{" "}
                        {spec.photosMax}.
                      </p>
                    )}
                    {offShape.length > 0 && (
                      <p className="flex items-center gap-1 text-xs text-amber-700">
                        <AlertTriangle className="h-3.5 w-3.5" /> Not{" "}
                        {spec.ratioLabel} — may be cropped. Fit makes a copy in
                        shape.
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
    </>
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
  changeLabel?: string;
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
        ) : (
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
