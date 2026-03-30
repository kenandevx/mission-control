"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import { useEffect, type ReactNode } from "react";
import { applyThemeAccent, getStoredThemeAccentId } from "@/lib/theme-accent";

type ThemeProviderProps = {
  children: ReactNode;
};

function ThemeAccentBootstrap(): ReactNode {
  useEffect(() => {
    const applyCurrent = (id?: string) => applyThemeAccent(id || getStoredThemeAccentId(), false);
    applyCurrent();

    const onAccentChanged = (event: Event) => {
      const custom = event as CustomEvent<{ id?: string }>;
      applyCurrent(custom.detail?.id);
    };

    const observer = new MutationObserver(() => {
      applyCurrent();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    window.addEventListener("mc-theme-accent-changed", onAccentChanged as EventListener);
    return () => {
      observer.disconnect();
      window.removeEventListener("mc-theme-accent-changed", onAccentChanged as EventListener);
    };
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
