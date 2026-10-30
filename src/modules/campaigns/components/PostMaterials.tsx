"use client";

import { useEffect, useRef, useState } from "react";
import { useObjectUrls } from "@/shared/hooks";
import axios from "axios";
import { toast } from "sonner";
import { ImagePlus, Package, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/shared/components/SearchableSelect";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import {
  POST_CAPTION_MAX,
  POST_CHANNELS,
  POST_MEDIA_TYPES,
  checkPostMedia,
  postPhotos,
  type PostProduct,
  type PostRow,
} from "@/modules/campaigns/lib/post";
import { uploadPostFile } from "@/modules/campaigns/lib/postUpload";

/** A post holds this many photos in all (Instagram's carousel). */
const PHOTOS_MAX = 10;

/**
 * Block 1 of the post editor, "Master" — the raw materials every channel draws from
 * (owner, 2026-10-29: "row materials first"): the main text, the shop link and
 * one photo strip. Before the first save the photos wait in the browser
 * (`pending`, uploaded on Save); once saved, adding or removing one goes to
 * the post at once. The first photo is the main one.
 */
export default function PostMaterials({
  caption,
  link,
  onCaption,
  onLink,
  post,
  onPostChanged,
  pending,
  onPending,
  fitOnSave,
  onFitOnSave,
  fromProduct,
  onPickProduct,
  onClearProduct,
  channels,
  onToggleChannel,
  when,
  onWhen,
  hashtags,
  onHashtags,
  campaigns,
  campaignId,
  onCampaign,
}: {
  caption: string;
  link: string;
  onCaption: (v: string) => void;
  onLink: (v: string) => void;
  post: PostRow | null;
  onPostChanged: (p: PostRow) => void;
  pending: File[];
  onPending: (files: File[]) => void;
  fitOnSave: boolean;
  onFitOnSave: (on: boolean) => void;
  fromProduct: PostProduct | null;
  onPickProduct: () => void;
  onClearProduct: () => void;
  channels: string[];
  onToggleChannel: (channel: string) => void;
  /** The master time, as a datetime-local string; empty = a draft. */
  when: string;
  onWhen: (v: string) => void;
  hashtags: string;
  onHashtags: (v: string) => void;
  campaigns: { value: number; label: string }[];
  campaignId: number | null;
  onCampaign: (v: number | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // Which photo is open large (index into the strip), or none.
  const [viewing, setViewing] = useState<number | null>(null);
  const previews = useObjectUrls(pending);

  // One list to draw, whether the photos are saved or still waiting.
  const saved = post ? postPhotos(post) : [];
  const tiles = post
    ? saved.map((f) => ({
        id: f.key,
        name: f.name,
        video: f.type.startsWith("video/"),
        src: post.photoLinks?.[f.key]?.url ?? "",
      }))
    : pending.map((f, i) => ({
        id: previews[i],
        name: f.name,
        video: f.type.startsWith("video/"),
        src: previews[i],
      }));

  async function add(files: FileList | null) {
    const ok = Array.from(files ?? []).filter((f) => {
      const bad = checkPostMedia(f.type, f.size);
      if (bad) toast.error(`${f.name}: ${bad}`);
      return !bad;
    });
    const room = PHOTOS_MAX - tiles.length;
    if (ok.length > room)
      toast.warning(
        `A post holds ${PHOTOS_MAX} photos — ${ok.length - room} left out.`,
      );
    const take = ok.slice(0, Math.max(0, room));
    if (!take.length) return;
    if (!post) return onPending([...pending, ...take]);
    setBusy(true);
    try {
      let row = post;
      for (const f of take)
        row = await uploadPostFile(post.id, f, !!row.mediaKey);
      onPostChanged(row);
      toast.success(take.length > 1 ? "Photos added" : "Photo added");
    } catch (e) {
      toast.error(extractApiError(e, "Upload failed"));
    } finally {
      setBusy(false);
    }
  }

  /** Make photo `i` the main one — every platform that follows Master gets it. */
  async function makeMain(i: number) {
    if (i === 0 && mainIsFirst) return;
    if (!post)
      return onPending([pending[i], ...pending.filter((_, j) => j !== i)]);
    setBusy(true);
    try {
      onPostChanged(
        (
          await axios.patch<PostRow>(`/api/campaigns/posts/${post.id}/media`, {
            main: tiles[i].id,
          })
        ).data,
      );
      toast.success(
        "Main photo changed — use Fit photo for every platform to cut it for each.",
      );
    } catch (e) {
      toast.error(extractApiError(e, "Failed to change the main photo"));
    } finally {
      setBusy(false);
    }
  }

  // Photos chosen before the page finished loading never reached `add` (the
  // box was there, its handler not yet) — pick them up once it is ready.
  useEffect(() => {
    const box = input.current;
    if (box?.files?.length) {
      void add(box.files);
      box.value = "";
    }
    // Once, on the first ready render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function removeAt(i: number) {
    if (!post) return onPending(pending.filter((_, j) => j !== i));
    setBusy(true);
    try {
      // The main photo goes by itself; any other by its key.
      const key = i === 0 && post.mediaKey ? undefined : tiles[i].id;
      onPostChanged(
        (
          await axios.delete<PostRow>(`/api/campaigns/posts/${post.id}/media`, {
            params: key ? { key } : undefined,
          })
        ).data,
      );
    } catch (e) {
      toast.error(extractApiError(e, "Failed to remove the photo"));
    } finally {
      setBusy(false);
    }
  }

  const mainIsFirst = !post || !!post.mediaKey;
  const shown = viewing !== null ? tiles[viewing] : null;

  return (
    <section
      className="rounded-xl border text-card-foreground shadow-sm"
      style={{
        background: "color-mix(in oklab, var(--m-campaigns) 4%, var(--muted))",
      }}
    >
      <div
        className="flex flex-wrap items-center gap-2 rounded-t-xl border-b px-4 py-2.5"
        style={{
          background:
            "color-mix(in oklab, var(--m-campaigns) 12%, var(--card))",
        }}
      >
        <h2 className="flex-1 text-sm font-semibold">1 · Master</h2>
        {!post && !fromProduct && (
          <Button variant="outline" size="sm" onClick={onPickProduct}>
            <Package className="mr-1.5 h-4 w-4" /> From a product
          </Button>
        )}
      </div>

      <div className="space-y-4 p-4">
        {!post && fromProduct && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 p-2 text-sm">
            <Package className="h-4 w-4 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">
              From <span className="font-medium">{fromProduct.name}</span>
              <span className="text-muted-foreground">
                {pending.length
                  ? " — your photos are used instead of its own"
                  : fromProduct.imageUrl
                    ? " — its photo is added when you save"
                    : " — it has no photo; add one below"}
              </span>
            </span>
            <Button variant="ghost" size="sm" onClick={onPickProduct}>
              Change
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Not from a product"
              onClick={onClearProduct}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Label className="mr-1">Post to</Label>
          {POST_CHANNELS.map((c) => (
            <label
              key={c.value}
              className={`flex items-center gap-2 text-sm ${c.ready ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
            >
              <Checkbox
                className="bg-card"
                checked={channels.includes(c.value)}
                disabled={!c.ready}
                onCheckedChange={() => onToggleChannel(c.value)}
              />
              {c.label}
              {!c.ready && (
                <span className="text-xs text-muted-foreground">
                  · needs approval
                </span>
              )}
            </label>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex justify-between">
                <Label htmlFor="post-caption">Main text</Label>
                <span className="text-xs text-muted-foreground">
                  {caption.length}/{POST_CAPTION_MAX} · every channel uses it
                  unless given its own
                </span>
              </div>
              <Textarea
                className="bg-card"
                id="post-caption"
                rows={7}
                value={caption}
                maxLength={POST_CAPTION_MAX}
                placeholder="New HP 15s laptops in stock — Core i5, 16 GB, 512 GB SSD. Free bag and 1-year shop support."
                onChange={(e) => onCaption(e.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="post-hashtags">
                  Hashtags · Instagram &amp; Facebook only
                </Label>
                <Input
                  id="post-hashtags"
                  className="bg-card"
                  value={hashtags}
                  maxLength={500}
                  placeholder="#Abhayapuri #Bongaigaon #CCTV"
                  onChange={(e) => onHashtags(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="post-link">Shop link · added at the end</Label>
                <Input
                  className="bg-card"
                  id="post-link"
                  value={link}
                  maxLength={300}
                  placeholder="/shop"
                  onChange={(e) => onLink(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex justify-between">
                <Label>Photos</Label>
                <span className="text-xs text-muted-foreground">
                  {tiles.length}/{PHOTOS_MAX} · click to view · first is the
                  main
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {tiles.map((t, i) => (
                  <div
                    key={t.id}
                    className="relative size-20 overflow-hidden rounded-md border bg-muted"
                    title={t.name}
                  >
                    <button
                      type="button"
                      className="size-full"
                      aria-label={`View ${t.name}`}
                      onClick={() => setViewing(i)}
                    >
                      {t.video || !t.src ? (
                        <span className="flex size-full items-center justify-center text-xs">
                          {t.video ? "Video" : "…"}
                        </span>
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element -- a local preview or a signed private R2 link
                        <img
                          src={t.src}
                          alt={t.name}
                          className="size-full object-cover"
                        />
                      )}
                    </button>
                    {i === 0 && mainIsFirst ? (
                      <span className="pointer-events-none absolute bottom-0 left-0 rounded-tr bg-primary px-1 text-[10px] text-primary-foreground">
                        Main
                      </span>
                    ) : (
                      !t.video && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void makeMain(i)}
                          className="absolute bottom-0 left-0 rounded-tr bg-black/60 px-1 text-[10px] text-white hover:bg-primary"
                        >
                          Make main
                        </button>
                      )
                    )}
                    <button
                      type="button"
                      aria-label="Remove this photo"
                      disabled={busy}
                      onClick={() => void removeAt(i)}
                      className="absolute top-0 right-0 rounded-bl bg-black/60 p-0.5 text-white"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {tiles.length < PHOTOS_MAX && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => input.current?.click()}
                    className="flex size-20 flex-col items-center justify-center gap-1 rounded-md border border-dashed bg-card text-xs text-muted-foreground hover:bg-muted/50"
                  >
                    <ImagePlus className="h-5 w-5" />
                    {busy ? "Uploading…" : tiles.length ? "More" : "Add photo"}
                  </button>
                )}
                <input
                  ref={input}
                  type="file"
                  multiple
                  accept={POST_MEDIA_TYPES.join(",")}
                  className="hidden"
                  onChange={(e) => {
                    void add(e.target.files);
                    e.target.value = "";
                  }}
                />
              </div>
              {!post && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={fitOnSave}
                    onChange={(e) => onFitOnSave(e.target.checked)}
                  />
                  Fit for each channel on save
                  <span className="text-xs text-muted-foreground">
                    (Google 4:3 · FB 1:1 · Status 9:16 · IG 4:5)
                  </span>
                </label>
              )}
              <p className="text-xs text-muted-foreground">
                JPG, PNG, WebP or MP4 up to 16 MB.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="post-when">Schedule time · empty = draft</Label>
                <Input
                  id="post-when"
                  type="datetime-local"
                  className="bg-card"
                  value={when}
                  onChange={(e) => onWhen(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Campaign (optional)</Label>
                <div className="rounded-md bg-card">
                  <SearchableSelect<number>
                    value={campaignId}
                    options={campaigns}
                    onChange={onCampaign}
                    placeholder="— a regular post —"
                    ariaLabel="Campaign"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Dialog
        open={viewing !== null}
        onOpenChange={(o) => !o && setViewing(null)}
      >
        <DialogContent className="max-w-3xl">
          <DialogTitle className="truncate text-sm">
            {shown
              ? `${shown.name}${viewing === 0 && mainIsFirst ? " · main photo" : ""}`
              : "Photo"}
          </DialogTitle>
          {shown &&
            (shown.video ? (
              <video
                src={shown.src}
                className="max-h-[75vh] w-full rounded-md bg-black object-contain"
                controls
                playsInline
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- a local preview or a signed private R2 link
              <img
                src={shown.src}
                alt={shown.name}
                className="max-h-[75vh] w-full rounded-md bg-muted object-contain"
              />
            ))}
          {tiles.length > 1 && (
            <div className="flex justify-between">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setViewing(
                    (v) => ((v ?? 0) - 1 + tiles.length) % tiles.length,
                  )
                }
              >
                ← Previous
              </Button>
              <span className="self-center text-xs text-muted-foreground">
                {(viewing ?? 0) + 1} / {tiles.length}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setViewing((v) => ((v ?? 0) + 1) % tiles.length)}
              >
                Next →
              </Button>
            </div>
          )}
          {shown && !shown.video && !(viewing === 0 && mainIsFirst) && (
            <div className="flex justify-center">
              <Button
                size="sm"
                disabled={busy}
                onClick={() => {
                  void makeMain(viewing!);
                  setViewing(0);
                }}
              >
                Make this the main photo
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
