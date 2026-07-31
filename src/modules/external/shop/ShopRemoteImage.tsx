"use client";

import Image, { type ImageProps } from "next/image";
import { startTransition, useLayoutEffect, useMemo, useState } from "react";
import { SHOP_IMAGE_PLACEHOLDER_PATH } from "@/shared/lib/shop/shopImagePlaceholder";
import { imageLoaderFor, type ImageFrame } from "@/shared/lib/cloudinaryImage";

export type ShopRemoteImageProps = Omit<ImageProps, "src"> & {
    src: string | null | undefined;
    /**
     * The shape this image renders in. When set, Cloudinary crops/pads to that
     * exact aspect ratio using the framing saved on the image, so the browser
     * never crops and every tile lines up.
     */
    frame?: ImageFrame;
};

/**
 * next/image wrapper: swaps to a local placeholder on load error so broken CDN URLs
 * never show the browser broken-image icon.
 */
export default function ShopRemoteImage({ src, onError, alt = "", frame, ...rest }: ShopRemoteImageProps) {
    const safeSrc = useMemo(
        () => (typeof src === "string" && src.length > 0 ? src : SHOP_IMAGE_PLACEHOLDER_PATH),
        [src]
    );
    const [usePlaceholder, setUsePlaceholder] = useState(false);
    const displaySrc = usePlaceholder ? SHOP_IMAGE_PLACEHOLDER_PATH : safeSrc;

    useLayoutEffect(() => {
        startTransition(() => {
            setUsePlaceholder(false);
        });
    }, [safeSrc]);

    return (
        <Image
            {...rest}
            alt={alt}
            src={displaySrc}
            // Cloudinary resizes its own uploads; the local placeholder falls
            // back to Next's optimizer (loader undefined).
            loader={imageLoaderFor(displaySrc, usePlaceholder ? undefined : frame)}
            onError={(e) => {
                if (!usePlaceholder) {
                    setUsePlaceholder(true);
                }
                onError?.(e);
            }}
        />
    );
}
