import type { CloudinaryFolder } from "@/shared/lib/cloudinary";

/**
 * The phone app's Photos screen — what it can put a shop photo on.
 *
 * A product holds a gallery (main photo first, `galleryJson` + `imageUrl`); a
 * brand, group or category holds one image (`imageUrl`) — its storefront tile.
 * Shared by the screen and its APIs under /api/mobile/photos.
 */
export const PHOTO_KINDS = ["product", "brand", "group", "category"] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];
export type MasterPhotoKind = Exclude<PhotoKind, "product">;
export const MASTER_PHOTO_KINDS: readonly MasterPhotoKind[] = ["brand", "group", "category"];

export const PHOTO_KIND_LABEL: Record<PhotoKind, string> = {
    product: "Product",
    brand: "Brand",
    group: "Group",
    category: "Category",
};
export const PHOTO_KIND_PLURAL: Record<PhotoKind, string> = {
    product: "Products",
    brand: "Brands",
    group: "Groups",
    category: "Categories",
};

/** Same Cloudinary folders the office editors use (ShopImageField, ProductGalleryUploader). */
export const PHOTO_FOLDER: Record<PhotoKind, CloudinaryFolder> = {
    product: "shop/products",
    brand: "shop/brands",
    group: "shop/groups",
    category: "shop/categories",
};

export function isMasterPhotoKind(kind: string): kind is MasterPhotoKind {
    return (MASTER_PHOTO_KINDS as readonly string[]).includes(kind);
}

/** A photo uploaded to OUR Cloudinary cloud — the only kind of link the phone may
 *  save, so nobody can point a shop tile at an arbitrary site. */
export function isOwnPhotoUrl(url: string): boolean {
    const cloud = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    return !!cloud && url.startsWith(`https://res.cloudinary.com/${cloud}/image/upload/`);
}
