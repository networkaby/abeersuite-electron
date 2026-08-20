/**
 * Wire constants for the app's one change channel — shared between the
 * client-only subscriber/publisher (`appChannel.ts`) and the server-side
 * publisher (`serverPublish.ts`). The server side can't import `appChannel.ts`
 * itself: it's `"use client"` and holds browser-only state (window,
 * localStorage, tab leadership). Both sides talk the same channel and event
 * name with the same `{ topics, at }` payload; this file is just the shared
 * spelling of it, so there's one source of truth instead of two copies that
 * could drift apart.
 */
export const CHANGE_CHANNEL_NAME = "app:changes";
export const CHANGE_EVENT_NAME = "changed";
