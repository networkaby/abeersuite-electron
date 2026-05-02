"use client";

import Image, { type ImageProps } from "next/image";
import { startTransition, useLayoutEffect, useMemo, useState } from "react";
import { SHOP_IMAGE_PLACEHOLDER_PATH } from "@/lib/shop/shop-image-placeholder";

export type ShopRemoteImageProps = Omit<ImageProps, "src"> & {
    src: string | null | undefined;
};

/**
 * next/image wrapper: swaps to a local placeholder on load error so broken CDN URLs
 * never show the browser broken-image icon.
 */
export default function ShopRemoteImage({ src, onError, alt = "", ...rest }: ShopRemoteImageProps) {
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
            onError={(e) => {
                if (!usePlaceholder) {
                    setUsePlaceholder(true);
                }
                onError?.(e);
            }}
        />
    );
}
