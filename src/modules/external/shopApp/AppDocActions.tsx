"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download, FileImage, FileText, Loader2, Share2 } from "lucide-react";
import { toast } from "sonner";
import AppBottomSheet from "./AppBottomSheet";
import { APP_DOC_SHEET_ID } from "./AppDocFit";
import { jpegToA4Pdf } from "@/shared/lib/print/jpegPdf";

/** The customer app's file add-on (shop-app-native, NsFilePlugin.java) — absent in a browser and in app builds before 2.2.3. */
type NativeFile = {
    save: (o: { data: string; fileName: string; mimeType: string }) => Promise<void>;
    share: (o: { data: string; fileName: string; mimeType: string; text?: string }) => Promise<void>;
};
type CapacitorGlobal = { isNativePlatform?: () => boolean; Plugins?: { NsFile?: NativeFile } };
const capacitor = (): CapacitorGlobal | undefined => (window as { Capacitor?: CapacitorGlobal }).Capacitor;

type Act = "download" | "share";
type Format = "jpg" | "pdf";

/** The document on screen as a JPEG (its full A4 size, not the phone-shrunk view). */
async function captureJpeg(): Promise<{ bytes: Uint8Array; width: number; height: number }> {
    const node = document.getElementById(APP_DOC_SHEET_ID);
    if (!node) throw new Error("The bill has not opened yet");
    const { toJpeg } = await import("html-to-image");
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    const scale = 2; // sharp enough to print
    const url = await toJpeg(node, { quality: 0.92, pixelRatio: scale, backgroundColor: "#ffffff", width, height, style: { zoom: "1", boxShadow: "none" } });
    const bin = atob(url.slice(url.indexOf(",") + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, width: Math.round(width * scale), height: Math.round(height * scale) };
}

function toBase64(bytes: Uint8Array): string {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
}

function browserDownload(file: File) {
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Download and Share for a document shown in the app (a bill, a receipt): pick
 * Image (JPG) or PDF, and the printable page itself is saved to the phone's
 * Downloads or handed to the share sheet (WhatsApp, mail…) as a file. Opened
 * straight from My Bills' Download / Share with `?act=download|share`.
 */
export default function AppDocActions({ fileBase, title }: { fileBase: string; title: string }) {
    const params = useSearchParams();
    const asked = params.get("act");
    const [act, setAct] = useState<Act | null>(asked === "download" || asked === "share" ? asked : null);
    const [busy, setBusy] = useState(false);

    // Once only: Back to this page must not open the choice again.
    useEffect(() => {
        if (!asked) return;
        const url = new URL(window.location.href);
        url.searchParams.delete("act");
        window.history.replaceState(window.history.state, "", url);
    }, [asked]);

    const run = async (format: Format) => {
        if (!act) return;
        const cap = capacitor();
        const native = cap?.Plugins?.NsFile;
        if (cap?.isNativePlatform?.() && !native) {
            toast.error("Update the app to save or share bills");
            setAct(null);
            return;
        }
        setBusy(true);
        try {
            const shot = await captureJpeg();
            const bytes = format === "pdf" ? jpegToA4Pdf(shot.bytes, shot.width, shot.height) : shot.bytes;
            const mimeType = format === "pdf" ? "application/pdf" : "image/jpeg";
            // "Bill INV/26/0042" → "Bill-INV-26-0042.pdf": a name every phone accepts.
            const fileName = `${fileBase.replace(/[^A-Za-z0-9._-]+/g, "-")}.${format}`;
            if (native) {
                const data = toBase64(bytes);
                if (act === "download") {
                    await native.save({ data, fileName, mimeType });
                    toast.success(`Saved to Downloads — ${fileName}`);
                } else {
                    await native.share({ data, fileName, mimeType, text: title });
                }
            } else {
                const file = new File([bytes as BlobPart], fileName, { type: mimeType });
                if (act === "share" && navigator.canShare?.({ files: [file] })) {
                    // Preparing the file can outlast the tap's permission to share; then it downloads.
                    await navigator.share({ files: [file], title }).catch((e: Error) => {
                        if (e.name === "NotAllowedError") browserDownload(file);
                        else throw e;
                    });
                } else browserDownload(file);
            }
            setAct(null);
        } catch (e) {
            // Closing the share sheet is not a failure.
            if ((e as Error).name !== "AbortError") toast.error((e as Error).message || "Could not prepare the file");
        } finally {
            setBusy(false);
        }
    };

    const icon = "flex size-11 items-center justify-center rounded-full active:bg-muted";
    const choice = "flex w-full items-center gap-3 px-4 py-4 text-left text-[15px] active:bg-muted disabled:opacity-50";
    return (
        <>
            <button type="button" onClick={() => setAct("download")} className={icon} aria-label="Download">
                <Download className="size-5" />
            </button>
            <button type="button" onClick={() => setAct("share")} className={`${icon} mr-1`} aria-label="Share">
                <Share2 className="size-5" />
            </button>
            <AppBottomSheet open={act != null} title={act === "share" ? `Share ${title.toLowerCase()} as` : `Download ${title.toLowerCase()} as`} onClose={() => !busy && setAct(null)}>
                <div className="divide-y pb-[env(safe-area-inset-bottom)]">
                    <button type="button" disabled={busy} onClick={() => void run("pdf")} className={choice}>
                        <FileText className="size-5 text-red-600" />
                        <span className="flex-1">
                            <span className="block font-medium">PDF</span>
                            <span className="block text-xs text-muted-foreground">A4 page, ready to print or send</span>
                        </span>
                    </button>
                    <button type="button" disabled={busy} onClick={() => void run("jpg")} className={choice}>
                        <FileImage className="size-5 text-sky-600" />
                        <span className="flex-1">
                            <span className="block font-medium">Image (JPG)</span>
                            <span className="block text-xs text-muted-foreground">A photo of the bill, opens in the gallery</span>
                        </span>
                    </button>
                    {busy && (
                        <p className="flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground">
                            <Loader2 className="size-4 animate-spin" /> Preparing the file…
                        </p>
                    )}
                </div>
            </AppBottomSheet>
        </>
    );
}
