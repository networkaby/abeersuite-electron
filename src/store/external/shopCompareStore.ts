import { create } from "zustand";
import { persist } from "zustand/middleware";

const MAX = 4;

type ShopCompareState = {
    productIds: number[];
    add: (productId: number) => boolean;
    remove: (productId: number) => void;
    clear: () => void;
};

export const useShopCompareStore = create<ShopCompareState>()(
    persist(
        (set, get) => ({
            productIds: [],
            add(productId) {
                const cur = get().productIds;
                if (cur.includes(productId)) return true;
                if (cur.length >= MAX) return false;
                set({ productIds: [...cur, productId] });
                return true;
            },
            remove(productId) {
                set({ productIds: get().productIds.filter((id) => id !== productId) });
            },
            clear() {
                set({ productIds: [] });
            },
        }),
        { name: "shop-compare-v1" }
    )
);

export const SHOP_COMPARE_MAX = MAX;
