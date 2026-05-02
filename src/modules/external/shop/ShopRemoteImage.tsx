"use client";

import Image, { type ImageProps } from "next/image";
import { useEffect, useState } from "react";
import { SHOP_IMAGE_PLACEHOLDER_PATH } from "@/lib/shop/shop-image-placeholder";

export type ShopRemoteImageProps = Omit<ImageProps, "src"> & {
    src: string | null | undefined;
};

/**
 * next/image wrapper: swaps to a local placeholder on load error so broken CDN URLs
 * never show the browser broken-image icon.
 */
export default function ShopRemoteImage({ src, onError, ...rest }: ShopRemoteImageProps) {
    const nextSrc =
        typeof src === "string" && src.length > 0 ? src : SHOP_IMAGE_PLACEHOLDER_PATH;
    const [resolved, setResolved] = useState(nextSrc);

    useEffect(() => {
        setResolved(typeof src === "string" && src.length > 0 ? src : SHOP_IMAGE_PLACEHOLDER_PATH);
    }, [src]);

    return (
        <Image
            {...rest}
            src={resolved}
            onError={(e) => {
                if (resolved !== SHOP_IMAGE_PLACEHOLDER_PATH) {
                    setResolved(SHOP_IMAGE_PLACEHOLDER_PATH);
                }
                onError?.(e);
            }}
        />
    );
}
