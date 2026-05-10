"use client";

import {
    createContext,
    useCallback,
    useContext,
    useLayoutEffect,
    useMemo,
    useState,
    useEffect,
} from "react";

const STORAGE_KEY = "theme";
const MEDIA = "(prefers-color-scheme: dark)";

type Theme = "light" | "dark" | "system";

export type ThemeContextValue = {
    /** Stored preference: light, dark, or system. */
    theme: string;
    setTheme: (theme: string | ((prev: string) => string)) => void;
    /** Resolved light/dark (system → OS preference). */
    resolvedTheme: "light" | "dark";
    forcedTheme?: string;
    themes: string[];
    systemTheme?: "light" | "dark";
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function readStoredTheme(): Theme {
    if (typeof window === "undefined") return "system";
    try {
        const s = localStorage.getItem(STORAGE_KEY);
        if (s === "light" || s === "dark" || s === "system") return s;
    } catch {
        /* private mode */
    }
    return "system";
}

function readSystemPref(): "light" | "dark" {
    if (typeof window === "undefined") return "light";
    return window.matchMedia(MEDIA).matches ? "dark" : "light";
}

function resolve(theme: Theme, systemPref: "light" | "dark"): "light" | "dark" {
    return theme === "system" ? systemPref : theme;
}

export function useTheme(): ThemeContextValue {
    const ctx = useContext(ThemeContext);
    if (!ctx) {
        return {
            theme: "system",
            setTheme: () => {},
            resolvedTheme: "light",
            themes: ["light", "dark", "system"],
            systemTheme: "light",
        };
    }
    return ctx;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [theme, setThemeState] = useState<Theme>(() => readStoredTheme());
    const [systemPref, setSystemPref] = useState<"light" | "dark">(() => readSystemPref());

    useEffect(() => {
        const mq = window.matchMedia(MEDIA);
        const onChange = () => setSystemPref(mq.matches ? "dark" : "light");
        mq.addEventListener("change", onChange);
        return () => mq.removeEventListener("change", onChange);
    }, []);

    const resolvedTheme = useMemo(() => resolve(theme, systemPref), [theme, systemPref]);

    useLayoutEffect(() => {
        const root = document.documentElement;
        root.classList.toggle("dark", resolvedTheme === "dark");
        root.style.colorScheme = resolvedTheme;
    }, [resolvedTheme]);

    const setTheme = useCallback((value: string | ((prev: string) => string)) => {
        setThemeState((prev) => {
            const prevStr = prev as string;
            const nextRaw = typeof value === "function" ? value(prevStr) : value;
            const next = nextRaw as Theme;
            if (next !== "light" && next !== "dark" && next !== "system") return prev;
            try {
                localStorage.setItem(STORAGE_KEY, next);
            } catch {
                /* */
            }
            return next;
        });
    }, []);

    const value = useMemo<ThemeContextValue>(
        () => ({
            theme,
            setTheme,
            resolvedTheme,
            themes: ["light", "dark", "system"],
            systemTheme: systemPref,
        }),
        [theme, setTheme, resolvedTheme, systemPref]
    );

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
