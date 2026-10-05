"use client";

import { useRef } from "react";
import { Camera, Images } from "lucide-react";

/**
 * "Take photo" and "From gallery" — plain file inputs, no native plugin. Chrome,
 * the installed app (TWA) and the Capacitor shell all answer `capture` by opening
 * the back camera (Capacitor through its own file chooser + FileProvider), and the
 * input without it by opening the phone's photo picker.
 */
export default function PhotoPickButtons({ multiple, disabled, onFiles }: {
    /** Gallery may pick several at once (a product's photos); the camera is one shot. */
    multiple: boolean;
    disabled?: boolean;
    onFiles: (files: File[]) => void;
}) {
    const camera = useRef<HTMLInputElement>(null);
    const gallery = useRef<HTMLInputElement>(null);

    const take = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith("image/") || f.type === "");
        e.target.value = ""; // the same photo picked twice still fires
        if (files.length > 0) onFiles(files);
    };

    return (
        <div className="grid gap-2">
            <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={take} />
            <input ref={gallery} type="file" accept="image/*" multiple={multiple} className="hidden" onChange={take} />
            <button
                type="button"
                disabled={disabled}
                onClick={() => camera.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-3 font-medium text-primary-foreground active:opacity-90 disabled:opacity-40"
            >
                <Camera className="size-5" aria-hidden />
                Take photo
            </button>
            <button
                type="button"
                disabled={disabled}
                onClick={() => gallery.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-lg border py-3 font-medium active:bg-muted disabled:opacity-40"
            >
                <Images className="size-5" aria-hidden />
                From gallery
            </button>
        </div>
    );
}
