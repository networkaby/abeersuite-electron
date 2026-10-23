/**
 * The staff app's Posts screen shares only to WhatsApp — the channels with no
 * posting API, which a phone has to do by hand. Google Business Profile and the
 * rest are shared from the office's Campaigns → Posts.
 */
export const PHONE_POST_CHANNELS = ["WA_CHANNEL", "WA_STATUS"] as const;

/** WhatsApp Business first (the shop's own app), then WhatsApp — the native share tries them in this order. */
export const WHATSAPP_PACKAGES = ["com.whatsapp.w4b", "com.whatsapp"] as const;
