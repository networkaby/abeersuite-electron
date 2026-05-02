import { create } from "zustand";
import { persist } from "zustand/middleware";

export type CartLine = { productId: number; quantity: number };

type ShopCartState = {
    lines: CartLine[];
    add: (productId: number, qty?: number) => void;
    setQty: (productId: number, quantity: number) => void;
    remove: (productId: number) => void;
    clear: () => void;
};

export const useShopCartStore = create<ShopCartState>()(
    persist(
        (set, get) => ({
            lines: [],
            add(productId, qty = 1) {
                const lines = [...get().lines];
                const i = lines.findIndex((l) => l.productId === productId);
                if (i >= 0) lines[i] = { productId, quantity: lines[i].quantity + qty };
                else lines.push({ productId, quantity: qty });
                set({ lines });
            },
            setQty(productId, quantity) {
                if (quantity < 1) {
                    set({ lines: get().lines.filter((l) => l.productId !== productId) });
                    return;
                }
                set({
                    lines: get().lines.map((l) =>
                        l.productId === productId ? { ...l, quantity } : l
                    ),
                });
            },
            remove(productId) {
                set({ lines: get().lines.filter((l) => l.productId !== productId) });
            },
            clear() {
                set({ lines: [] });
            },
        }),
        { name: "shop-cart-v1" }
    )
);
