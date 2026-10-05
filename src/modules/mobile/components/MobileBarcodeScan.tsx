"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";

/** The slice of the browser's Shape Detection API this file uses (not in lib.dom yet). */
type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]> };
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code"];

const detectorCtor = (): BarcodeDetectorCtor | null =>
    typeof window !== "undefined" && "BarcodeDetector" in window
        ? (window as unknown as { BarcodeDetector: BarcodeDetectorCtor }).BarcodeDetector
        : null;

/**
 * True once mounted on a browser that can read barcodes from the camera
 * (Chrome on Android; not iPhone Safari or desktop). False on the server and
 * first render, so the scan button never flashes in and out.
 */
export function useCanScanBarcode(): boolean {
    return useSyncExternalStore(
        noSubscribe,
        () => detectorCtor() != null && !!navigator.mediaDevices?.getUserMedia,
        () => false,
    );
}

const noSubscribe = () => () => {};

/**
 * Full-screen back-camera view that reads one barcode, hands it to `onCode`,
 * and closes. Uses the browser's built-in BarcodeDetector — no library. The
 * camera is switched off on every way out (read, close, unmount).
 */
export default function MobileBarcodeScan({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    // Only ever mounted after a tap, so the browser check is safe in the initialiser.
    const [error, setError] = useState<string | null>(() => (detectorCtor() ? null : "This phone cannot scan barcodes."));
    // Read through a ref so a parent re-render never restarts the camera.
    const onCodeRef = useRef(onCode);
    useEffect(() => { onCodeRef.current = onCode; }, [onCode]);

    useEffect(() => {
        const Ctor = detectorCtor();
        if (!Ctor) return;
        let stream: MediaStream | null = null;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let stopped = false;

        const stop = () => {
            stopped = true;
            clearTimeout(timer);
            stream?.getTracks().forEach((t) => t.stop());
        };

        (async () => {
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: { ideal: "environment" } },
                    audio: false,
                });
                if (stopped) { stop(); return; }
                const video = videoRef.current;
                if (!video) return;
                video.srcObject = stream;
                await video.play();
                const detector = new Ctor({ formats: FORMATS });
                const tick = async () => {
                    if (stopped) return;
                    try {
                        const found = video.readyState >= 2 ? await detector.detect(video) : [];
                        const code = found.find((b) => b.rawValue.trim())?.rawValue.trim();
                        if (code && !stopped) {
                            stop();
                            navigator.vibrate?.(60);
                            onCodeRef.current(code);
                            return;
                        }
                    } catch {
                        // A frame the detector could not read — try the next one.
                    }
                    timer = setTimeout(() => void tick(), 150);
                };
                void tick();
            } catch (e) {
                const denied = e instanceof DOMException && e.name === "NotAllowedError";
                setError(denied ? "Camera permission is off. Allow it in the phone's settings." : "Could not open the camera.");
            }
        })();

        return stop;
    }, []);

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
            <div className="flex items-center justify-between px-3 pt-[env(safe-area-inset-top)]">
                <p className="py-3 text-sm">Point the camera at a barcode</p>
                <button type="button" onClick={onClose} className="p-3" aria-label="Close scanner">
                    <X className="size-6" />
                </button>
            </div>
            <div className="relative flex-1 overflow-hidden">
                <video ref={videoRef} className="size-full object-cover" playsInline muted />
                {!error && (
                    <div className="pointer-events-none absolute inset-x-8 top-1/2 h-40 -translate-y-1/2 rounded-xl border-2 border-white/80" />
                )}
                {error && <p className="absolute inset-x-0 top-1/3 px-6 text-center">{error}</p>}
            </div>
        </div>
    );
}
