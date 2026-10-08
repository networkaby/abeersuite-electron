"use client";

import { Share2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Share a document through the phone's share sheet (WhatsApp, mail…). Shares
 * the website address of it — the person it is sent to signs in to open it, so
 * a forwarded bill stays private.
 */
export default function AppShareLink({ path, title }: { path: string; title: string }) {
    const share = async () => {
        const url = new URL(path, window.location.origin).toString();
        try {
            if (navigator.share) await navigator.share({ title, url });
            else {
                await navigator.clipboard.writeText(url);
                toast.success("Link copied");
            }
        } catch {
            /* the customer closed the share sheet */
        }
    };
    return (
        <button type="button" onClick={() => void share()} className="flex size-11 items-center justify-center rounded-full active:bg-muted" aria-label="Share">
            <Share2 className="size-5" />
        </button>
    );
}
