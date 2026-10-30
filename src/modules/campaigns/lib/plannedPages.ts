import type { PlannedSection } from "@/modules/campaigns/components/PlannedPage";

/**
 * Sample content for the Campaigns pages that are drawn but not wired yet
 * (owner, 2026-10-23). Each entry is what the page will hold once built; the
 * bracketed values are placeholders, never real figures. Delete a page's entry
 * when it is wired.
 */
export const PLANNED_PAGES: Record<string, { title: string; description: string; sections: PlannedSection[]; footnote?: string }> = {
    media: {
        title: "Media Library",
        description: "Product photos, logo, brand colours and saved post templates in one place.",
        sections: [
            { heading: "Photos", note: "From the product gallery (Cloudinary) and uploads", rows: [
                { title: "HP 15s — front", sub: "Product #[id] · 4:3", right: "Used in 2 posts" },
                { title: "Diwali banner", sub: "Upload · 9:16", right: "Used in 1 post" },
                { title: "Shop front", sub: "Upload · 1:1", right: "—" },
            ] },
            { heading: "Templates", note: "Start a post from a saved layout", rows: [
                { title: "New stock arrived", sub: "Photo + specs + price + shop link" },
                { title: "Festival greeting", sub: "Banner + one line" },
                { title: "Service camp", sub: "Date, place, call button" },
            ] },
        ],
    },
    broadcast: {
        title: "Broadcast",
        description: "One message to each customer's own phone or inbox: app notification, WhatsApp, SMS, email.",
        sections: [
            { heading: "Channels", note: "Each needs its own approval or setup", rows: [
                { title: "App notification", sub: "Customer app and browser", right: "Ready" },
                { title: "WhatsApp message", sub: "Approved marketing template · cost per message", right: "Template needed" },
                { title: "SMS", sub: "TRAI DLT registration, 9 am – 9 pm only", right: "DLT needed" },
                { title: "Email", sub: "Resend · unsubscribe link in every mail", right: "Sender needed" },
                { title: "RCS (rich SMS)", sub: "Through an RCS partner", right: "Later" },
            ] },
            { heading: "Before it goes", rows: [
                { title: "Audience", sub: "A segment, minus everyone who opted out of that channel", right: "[#] customers" },
                { title: "Cost", sub: "WhatsApp ₹[rate] × [#] · SMS ₹[rate] × [#]", right: "₹[total]" },
                { title: "Quiet hours and weekly cap", sub: "From Consent" },
            ] },
        ],
    },
    newsletter: {
        title: "Newsletter",
        description: "Email to customers who asked for offers — blocks for products, coupon, posts and a button.",
        sections: [
            { heading: "Blocks", rows: [
                { title: "Heading + text" },
                { title: "Products", sub: "Photo, name, price, link — picked from the shop" },
                { title: "Coupon", sub: "From Retention → Coupons" },
                { title: "This week's posts" },
                { title: "Button", sub: "Link to a shop page" },
            ] },
            { heading: "Sent", rows: [
                { title: "Weekly offers — October", sub: "[#] subscribers", right: "[open rate]" },
                { title: "Diwali deals", sub: "Draft", right: "—" },
            ] },
        ],
    },
    automations: {
        title: "Automations",
        description: "Messages that send by themselves on any channel when something happens.",
        sections: [
            { heading: "Rules", rows: [
                { title: "Google review request", sub: "Day after a sale · WhatsApp", right: "Off" },
                { title: "Welcome", sub: "First purchase · app + WhatsApp", right: "Off" },
                { title: "Birthday coupon", sub: "On the day · WhatsApp", right: "Off" },
                { title: "Win back", sub: "No visit in 90 days · coupon", right: "Off" },
                { title: "Service / warranty due", sub: "From the warranty end date", right: "Off" },
                { title: "Abandoned cart", sub: "Online shop, after 2 hours", right: "Off" },
                { title: "Festival greeting", sub: "Indian festival calendar", right: "Off" },
            ] },
            { heading: "Safety", rows: [
                { title: "Never twice", sub: "Each rule sends once per customer per event" },
                { title: "Respects opt-outs, quiet hours and the weekly cap" },
            ] },
        ],
    },
    segments: {
        title: "Segments",
        description: "Saved audiences built from POS and shop data, used by broadcasts, newsletters and automations.",
        sections: [
            { heading: "Saved", rows: [
                { title: "Laptop buyers, last 12 months", right: "[#]" },
                { title: "Gold spend tier", right: "[#]" },
                { title: "Printer owners (ink due)", right: "[#]" },
                { title: "Abhayapuri area", right: "[#]" },
            ] },
            { heading: "Build from", rows: [
                { title: "Bought a category / product in the last N days" },
                { title: "Spend tier, customer group, total spent" },
                { title: "Area / pin code" },
                { title: "Has the app, has WhatsApp, has email" },
            ] },
        ],
    },
    consent: {
        title: "Consent",
        description: "Each customer's yes or no per channel, opt-outs, quiet hours and how often we may message.",
        sections: [
            { heading: "Per customer", note: "Kept as a record (DPDP Act 2023)", rows: [
                { title: "WhatsApp offers", sub: "Opted out by replying STOP", right: "No" },
                { title: "Email offers", sub: "Unsubscribe link", right: "Yes" },
                { title: "SMS offers", sub: "National DND list checked", right: "—" },
                { title: "App notifications", sub: "Phone setting", right: "Yes" },
            ] },
            { heading: "Rules", rows: [
                { title: "Quiet hours", sub: "No marketing 9 pm – 9 am", right: "On" },
                { title: "Weekly cap", sub: "At most [N] marketing messages per customer", right: "[N]" },
                { title: "Bills and service messages", sub: "Always allowed — they are not marketing" },
            ] },
        ],
    },
};
