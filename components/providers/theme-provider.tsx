"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import { useEffect, type ReactNode } from "react";
import { applyThemeAccent, getStoredThemeAccentId } from "@/lib/theme-accent";

type ThemeProviderProps = {
  children: ReactNode;
};

function ThemeAccentBootstrap(): ReactNode {
  useEffect(() => {
    applyThemeAccent(getStoredThemeAccentId(), false);

    const onAccentChanged = (event: Event) => {
      const custom = event as CustomEvent<{ id?: string }>;
      applyThemeAccent(custom.detail?.id || getStoredThemeAccentId(), false);
    };

    window.addEventListener("mc-theme-accent-changed", onAccentChanged as EventListener);
    return () => window.removeEventListener("mc-theme-accent-changed", onAccentChanged as EventListener);
  }, []);

  return null;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      storageKey="mc-theme"
    >
      <ThemeAccentBootstrap />
      {children}
    </NextThemesProvider>
  );
}
