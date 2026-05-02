import { create } from "zustand";
import { persist } from "zustand/middleware";

type ShopWishlistState = {
    productIds: number[];
    toggle: (productId: number) => void;
    has: (productId: number) => boolean;
    clear: () => void;
};

export const useShopWishlistStore = create<ShopWishlistState>()(
    persist(
        (set, get) => ({
            productIds: [],
            toggle(productId) {
                const cur = get().productIds;
                if (cur.includes(productId)) {
                    set({ productIds: cur.filter((id) => id !== productId) });
                } else {
                    set({ productIds: [...cur, productId] });
                }
            },
            has(productId) {
                return get().productIds.includes(productId);
            },
            clear() {
                set({ productIds: [] });
            },
        }),
        { name: "shop-wishlist-v1" }
    )
);
