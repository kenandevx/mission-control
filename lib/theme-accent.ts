export const THEME_ACCENT_STORAGE_KEY = "mc-theme-accent";

export type ThemeAccent = {
  id: string;
  label: string;
  swatch: string;
  primary: string;
  primaryForeground: string;
  ring: string;
  secondary: string;
  secondaryForeground: string;
  accent: string;
  accentForeground: string;
  muted: string;
  mutedForeground: string;
  sidebarPrimary: string;
  sidebarPrimaryForeground: string;
  sidebarAccent: string;
  sidebarAccentForeground: string;
  sidebar: string;
  sidebarForeground: string;
  sidebarBorder: string;
  sidebarRing: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  border: string;
  input: string;
  primaryGlow: string;
  chart1: string;
  chart2: string;
  chart3: string;
  chart4: string;
  chart5: string;
};

// Each accent: primary, muted (=accent), primaryGlow (=primary /0.5 alpha), sidebar-accent (=accent), chart spreads
export const THEME_ACCENTS: ThemeAccent[] = [
  {
    id: "purple",
    label: "Purple (Default)",
    swatch: "#8b5cf6",
    primary: "oklch(0.541 0.281 293.009)",
    primaryForeground: "oklch(0.98 0.01 293)",
    ring: "oklch(0.702 0.183 293.541)",
    secondary: "oklch(0.955 0.02 290)",
    secondaryForeground: "oklch(0.25 0.03 285)",
    accent: "oklch(0.94 0.03 290)",
    accentForeground: "oklch(0.25 0.03 285)",
    muted: "oklch(0.94 0.03 290)",
    mutedForeground: "oklch(0.5 0.03 285)",
    sidebarPrimary: "oklch(0.541 0.281 293.009)",
    sidebarPrimaryForeground: "oklch(0.98 0.01 293)",
    sidebarAccent: "oklch(0.94 0.03 290)",
    sidebarAccentForeground: "oklch(0.25 0.03 285)",
    sidebar: "oklch(0.975 0.012 292)",
    sidebarForeground: "oklch(0.18 0.02 285)",
    sidebarBorder: "oklch(0.91 0.015 290)",
    sidebarRing: "oklch(0.702 0.183 293.541)",
    foreground: "oklch(0.18 0.02 285)",
    card: "oklch(0.995 0.004 293)",
    cardForeground: "oklch(0.18 0.02 285)",
    popover: "oklch(0.995 0.004 293)",
    popoverForeground: "oklch(0.18 0.02 285)",
    border: "oklch(0.91 0.015 290)",
    input: "oklch(0.91 0.015 290)",
    primaryGlow: "oklch(0.541 0.281 293.009 / 0.5)",
    chart1: "oklch(0.82 0.12 293)",
    chart2: "oklch(0.72 0.18 200)",
    chart3: "oklch(0.62 0.22 152)",
    chart4: "oklch(0.78 0.12 55)",
    chart5: "oklch(0.65 0.18 330)",
  },
  {
    id: "green",
    label: "Mint Green",
    swatch: "#22c55e",
    primary: "oklch(0.67 0.19 152)",
    primaryForeground: "oklch(0.98 0.01 152)",
    ring: "oklch(0.73 0.16 152)",
    secondary: "oklch(0.958 0.015 152)",
    secondaryForeground: "oklch(0.22 0.02 152)",
    accent: "oklch(0.95 0.025 152)",
    accentForeground: "oklch(0.22 0.02 152)",
    muted: "oklch(0.95 0.025 152)",
    mutedForeground: "oklch(0.50 0.015 152)",
    sidebarPrimary: "oklch(0.67 0.19 152)",
    sidebarPrimaryForeground: "oklch(0.98 0.01 152)",
    sidebarAccent: "oklch(0.95 0.025 152)",
    sidebarAccentForeground: "oklch(0.22 0.02 152)",
    sidebar: "oklch(0.978 0.008 152)",
    sidebarForeground: "oklch(0.18 0.015 152)",
    sidebarBorder: "oklch(0.90 0.01 152)",
    sidebarRing: "oklch(0.73 0.16 152)",
    foreground: "oklch(0.18 0.015 152)",
    card: "oklch(0.992 0.004 152)",
    cardForeground: "oklch(0.18 0.015 152)",
    popover: "oklch(0.992 0.004 152)",
    popoverForeground: "oklch(0.18 0.015 152)",
    border: "oklch(0.90 0.01 152)",
    input: "oklch(0.90 0.01 152)",
    primaryGlow: "oklch(0.67 0.19 152 / 0.5)",
    chart1: "oklch(0.70 0.18 152)",
    chart2: "oklch(0.65 0.20 252)",
    chart3: "oklch(0.60 0.18 293)",
    chart4: "oklch(0.75 0.14 55)",
    chart5: "oklch(0.68 0.16 330)",
  },
  {
    id: "yellow",
    label: "Soft Lemon",
    swatch: "#facc15",
    primary: "oklch(0.76 0.15 95)",
    primaryForeground: "oklch(0.18 0.01 95)",
    ring: "oklch(0.80 0.13 95)",
    secondary: "oklch(0.968 0.012 95)",
    secondaryForeground: "oklch(0.28 0.012 95)",
    accent: "oklch(0.96 0.018 95)",
    accentForeground: "oklch(0.28 0.012 95)",
    muted: "oklch(0.96 0.018 95)",
    mutedForeground: "oklch(0.50 0.012 95)",
    sidebarPrimary: "oklch(0.76 0.15 95)",
    sidebarPrimaryForeground: "oklch(0.18 0.01 95)",
    sidebarAccent: "oklch(0.96 0.018 95)",
    sidebarAccentForeground: "oklch(0.28 0.012 95)",
    sidebar: "oklch(0.985 0.008 95)",
    sidebarForeground: "oklch(0.20 0.01 95)",
    sidebarBorder: "oklch(0.90 0.008 95)",
    sidebarRing: "oklch(0.80 0.13 95)",
    foreground: "oklch(0.20 0.015 95)",
    card: "oklch(0.992 0.003 95)",
    cardForeground: "oklch(0.20 0.015 95)",
    popover: "oklch(0.992 0.003 95)",
    popoverForeground: "oklch(0.20 0.015 95)",
    border: "oklch(0.90 0.008 95)",
    input: "oklch(0.90 0.008 95)",
    primaryGlow: "oklch(0.76 0.15 95 / 0.5)",
    chart1: "oklch(0.78 0.14 95)",
    chart2: "oklch(0.65 0.18 152)",
    chart3: "oklch(0.60 0.16 252)",
    chart4: "oklch(0.72 0.15 18)",
    chart5: "oklch(0.68 0.14 290)",
  },
  {
    id: "blue",
    label: "Sky Blue",
    swatch: "#3b82f6",
    primary: "oklch(0.64 0.2 252)",
    primaryForeground: "oklch(0.98 0.01 252)",
    ring: "oklch(0.70 0.16 252)",
    secondary: "oklch(0.955 0.016 252)",
    secondaryForeground: "oklch(0.22 0.018 252)",
    accent: "oklch(0.95 0.02 252)",
    accentForeground: "oklch(0.22 0.018 252)",
    muted: "oklch(0.95 0.02 252)",
    mutedForeground: "oklch(0.50 0.016 252)",
    sidebarPrimary: "oklch(0.64 0.2 252)",
    sidebarPrimaryForeground: "oklch(0.98 0.01 252)",
    sidebarAccent: "oklch(0.95 0.02 252)",
    sidebarAccentForeground: "oklch(0.22 0.018 252)",
    sidebar: "oklch(0.978 0.008 252)",
    sidebarForeground: "oklch(0.18 0.015 252)",
    sidebarBorder: "oklch(0.90 0.01 252)",
    sidebarRing: "oklch(0.70 0.16 252)",
    foreground: "oklch(0.18 0.015 252)",
    card: "oklch(0.992 0.004 252)",
    cardForeground: "oklch(0.18 0.015 252)",
    popover: "oklch(0.992 0.004 252)",
    popoverForeground: "oklch(0.18 0.015 252)",
    border: "oklch(0.90 0.01 252)",
    input: "oklch(0.90 0.01 252)",
    primaryGlow: "oklch(0.64 0.2 252 / 0.5)",
    chart1: "oklch(0.65 0.18 252)",
    chart2: "oklch(0.68 0.14 196)",
    chart3: "oklch(0.62 0.16 152)",
    chart4: "oklch(0.75 0.13 55)",
    chart5: "oklch(0.66 0.16 330)",
  },
  {
    id: "teal",
    label: "Teal",
    swatch: "#14b8a6",
    primary: "oklch(0.68 0.14 196)",
    primaryForeground: "oklch(0.98 0.01 196)",
    ring: "oklch(0.74 0.12 196)",
    secondary: "oklch(0.956 0.014 196)",
    secondaryForeground: "oklch(0.22 0.014 196)",
    accent: "oklch(0.95 0.018 196)",
    accentForeground: "oklch(0.22 0.014 196)",
    muted: "oklch(0.95 0.018 196)",
    mutedForeground: "oklch(0.50 0.014 196)",
    sidebarPrimary: "oklch(0.68 0.14 196)",
    sidebarPrimaryForeground: "oklch(0.98 0.01 196)",
    sidebarAccent: "oklch(0.95 0.018 196)",
    sidebarAccentForeground: "oklch(0.22 0.014 196)",
    sidebar: "oklch(0.978 0.008 196)",
    sidebarForeground: "oklch(0.18 0.015 196)",
    sidebarBorder: "oklch(0.90 0.01 196)",
    sidebarRing: "oklch(0.74 0.12 196)",
    foreground: "oklch(0.18 0.015 196)",
    card: "oklch(0.992 0.004 196)",
    cardForeground: "oklch(0.18 0.015 196)",
    popover: "oklch(0.992 0.004 196)",
    popoverForeground: "oklch(0.18 0.015 196)",
    border: "oklch(0.90 0.01 196)",
    input: "oklch(0.90 0.01 196)",
    primaryGlow: "oklch(0.68 0.14 196 / 0.5)",
    chart1: "oklch(0.70 0.14 196)",
    chart2: "oklch(0.66 0.16 152)",
    chart3: "oklch(0.62 0.18 252)",
    chart4: "oklch(0.74 0.12 55)",
    chart5: "oklch(0.67 0.15 330)",
  },
  {
    id: "pink",
    label: "Pink",
    swatch: "#ec4899",
    primary: "oklch(0.66 0.22 350)",
    primaryForeground: "oklch(0.98 0.01 350)",
    ring: "oklch(0.72 0.18 350)",
    secondary: "oklch(0.955 0.02 350)",
    secondaryForeground: "oklch(0.22 0.022 350)",
    accent: "oklch(0.95 0.025 350)",
    accentForeground: "oklch(0.22 0.022 350)",
    muted: "oklch(0.95 0.025 350)",
    mutedForeground: "oklch(0.50 0.022 350)",
    sidebarPrimary: "oklch(0.66 0.22 350)",
    sidebarPrimaryForeground: "oklch(0.98 0.01 350)",
    sidebarAccent: "oklch(0.95 0.025 350)",
    sidebarAccentForeground: "oklch(0.22 0.022 350)",
    sidebar: "oklch(0.978 0.01 350)",
    sidebarForeground: "oklch(0.18 0.02 350)",
    sidebarBorder: "oklch(0.90 0.012 350)",
    sidebarRing: "oklch(0.72 0.18 350)",
    foreground: "oklch(0.18 0.02 350)",
    card: "oklch(0.992 0.004 350)",
    cardForeground: "oklch(0.18 0.02 350)",
    popover: "oklch(0.992 0.004 350)",
    popoverForeground: "oklch(0.18 0.02 350)",
    border: "oklch(0.90 0.012 350)",
    input: "oklch(0.90 0.012 350)",
    primaryGlow: "oklch(0.66 0.22 350 / 0.5)",
    chart1: "oklch(0.68 0.20 350)",
    chart2: "oklch(0.65 0.18 252)",
    chart3: "oklch(0.60 0.16 152)",
    chart4: "oklch(0.74 0.14 55)",
    chart5: "oklch(0.67 0.17 196)",
  },
  {
    id: "orange",
    label: "Orange",
    swatch: "#f97316",
    primary: "oklch(0.72 0.18 50)",
    primaryForeground: "oklch(0.98 0.01 50)",
    ring: "oklch(0.78 0.14 50)",
    secondary: "oklch(0.960 0.018 50)",
    secondaryForeground: "oklch(0.25 0.018 50)",
    accent: "oklch(0.96 0.025 50)",
    accentForeground: "oklch(0.25 0.018 50)",
    muted: "oklch(0.96 0.025 50)",
    mutedForeground: "oklch(0.50 0.018 50)",
    sidebarPrimary: "oklch(0.72 0.18 50)",
    sidebarPrimaryForeground: "oklch(0.98 0.01 50)",
    sidebarAccent: "oklch(0.96 0.025 50)",
    sidebarAccentForeground: "oklch(0.25 0.018 50)",
    sidebar: "oklch(0.982 0.01 50)",
    sidebarForeground: "oklch(0.20 0.015 50)",
    sidebarBorder: "oklch(0.90 0.012 50)",
    sidebarRing: "oklch(0.78 0.14 50)",
    foreground: "oklch(0.20 0.015 50)",
    card: "oklch(0.992 0.004 50)",
    cardForeground: "oklch(0.20 0.015 50)",
    popover: "oklch(0.992 0.004 50)",
    popoverForeground: "oklch(0.20 0.015 50)",
    border: "oklch(0.90 0.012 50)",
    input: "oklch(0.90 0.012 50)",
    primaryGlow: "oklch(0.72 0.18 50 / 0.5)",
    chart1: "oklch(0.74 0.16 50)",
    chart2: "oklch(0.66 0.18 152)",
    chart3: "oklch(0.62 0.16 252)",
    chart4: "oklch(0.73 0.13 18)",
    chart5: "oklch(0.68 0.15 290)",
  },
  {
    id: "rose",
    label: "Rose",
    swatch: "#f43f5e",
    primary: "oklch(0.64 0.24 18)",
    primaryForeground: "oklch(0.98 0.01 18)",
    ring: "oklch(0.70 0.20 18)",
    secondary: "oklch(0.955 0.02 18)",
    secondaryForeground: "oklch(0.22 0.022 18)",
    accent: "oklch(0.95 0.025 18)",
    accentForeground: "oklch(0.22 0.022 18)",
    muted: "oklch(0.95 0.025 18)",
    mutedForeground: "oklch(0.50 0.022 18)",
    sidebarPrimary: "oklch(0.64 0.24 18)",
    sidebarPrimaryForeground: "oklch(0.98 0.01 18)",
    sidebarAccent: "oklch(0.95 0.025 18)",
    sidebarAccentForeground: "oklch(0.22 0.022 18)",
    sidebar: "oklch(0.978 0.01 18)",
    sidebarForeground: "oklch(0.18 0.02 18)",
    sidebarBorder: "oklch(0.90 0.012 18)",
    sidebarRing: "oklch(0.70 0.20 18)",
    foreground: "oklch(0.18 0.02 18)",
    card: "oklch(0.992 0.004 18)",
    cardForeground: "oklch(0.18 0.02 18)",
    popover: "oklch(0.992 0.004 18)",
    popoverForeground: "oklch(0.18 0.02 18)",
    border: "oklch(0.90 0.012 18)",
    input: "oklch(0.90 0.012 18)",
    primaryGlow: "oklch(0.64 0.24 18 / 0.5)",
    chart1: "oklch(0.66 0.22 18)",
    chart2: "oklch(0.65 0.18 350)",
    chart3: "oklch(0.60 0.16 152)",
    chart4: "oklch(0.74 0.13 55)",
    chart5: "oklch(0.68 0.15 196)",
  },
  {
    id: "indigo",
    label: "Indigo",
    swatch: "#6366f1",
    primary: "oklch(0.61 0.2 282)",
    primaryForeground: "oklch(0.98 0.01 282)",
    ring: "oklch(0.68 0.16 282)",
    secondary: "oklch(0.954 0.016 282)",
    secondaryForeground: "oklch(0.22 0.018 282)",
    accent: "oklch(0.95 0.02 282)",
    accentForeground: "oklch(0.22 0.018 282)",
    muted: "oklch(0.95 0.02 282)",
    mutedForeground: "oklch(0.50 0.016 282)",
    sidebarPrimary: "oklch(0.61 0.2 282)",
    sidebarPrimaryForeground: "oklch(0.98 0.01 282)",
    sidebarAccent: "oklch(0.95 0.02 282)",
    sidebarAccentForeground: "oklch(0.22 0.018 282)",
    sidebar: "oklch(0.976 0.01 282)",
    sidebarForeground: "oklch(0.18 0.018 282)",
    sidebarBorder: "oklch(0.90 0.01 282)",
    sidebarRing: "oklch(0.68 0.16 282)",
    foreground: "oklch(0.18 0.018 282)",
    card: "oklch(0.992 0.004 282)",
    cardForeground: "oklch(0.18 0.018 282)",
    popover: "oklch(0.992 0.004 282)",
    popoverForeground: "oklch(0.18 0.018 282)",
    border: "oklch(0.90 0.01 282)",
    input: "oklch(0.90 0.01 282)",
    primaryGlow: "oklch(0.61 0.2 282 / 0.5)",
    chart1: "oklch(0.63 0.18 282)",
    chart2: "oklch(0.66 0.16 196)",
    chart3: "oklch(0.60 0.16 152)",
    chart4: "oklch(0.74 0.13 55)",
    chart5: "oklch(0.67 0.15 350)",
  },
  {
    id: "slate",
    label: "Slate",
    swatch: "#64748b",
    primary: "oklch(0.58 0.04 255)",
    primaryForeground: "oklch(0.98 0.005 255)",
    ring: "oklch(0.64 0.04 255)",
    secondary: "oklch(0.952 0.005 255)",
    secondaryForeground: "oklch(0.28 0.006 255)",
    accent: "oklch(0.95 0.006 255)",
    accentForeground: "oklch(0.28 0.006 255)",
    muted: "oklch(0.95 0.006 255)",
    mutedForeground: "oklch(0.52 0.006 255)",
    sidebarPrimary: "oklch(0.58 0.04 255)",
    sidebarPrimaryForeground: "oklch(0.98 0.005 255)",
    sidebarAccent: "oklch(0.95 0.006 255)",
    sidebarAccentForeground: "oklch(0.28 0.006 255)",
    sidebar: "oklch(0.975 0.003 255)",
    sidebarForeground: "oklch(0.20 0.008 255)",
    sidebarBorder: "oklch(0.90 0.003 255)",
    sidebarRing: "oklch(0.64 0.04 255)",
    foreground: "oklch(0.20 0.008 255)",
    card: "oklch(0.990 0.003 255)",
    cardForeground: "oklch(0.20 0.008 255)",
    popover: "oklch(0.990 0.003 255)",
    popoverForeground: "oklch(0.20 0.008 255)",
    border: "oklch(0.90 0.003 255)",
    input: "oklch(0.90 0.003 255)",
    primaryGlow: "oklch(0.58 0.04 255 / 0.5)",
    chart1: "oklch(0.60 0.04 255)",
    chart2: "oklch(0.65 0.12 252)",
    chart3: "oklch(0.62 0.14 196)",
    chart4: "oklch(0.72 0.10 55)",
    chart5: "oklch(0.66 0.12 350)",
  },
];

export function applyThemeAccent(accentId: string, persist = true): void {
  if (typeof window === "undefined") return;
  const root = document.documentElement;
  const a = THEME_ACCENTS.find((x) => x.id === accentId) ?? THEME_ACCENTS[0];
  const s = root.style.setProperty.bind(root.style);
  s("--primary", a.primary);
  s("--primary-foreground", a.primaryForeground);
  s("--ring", a.ring);
  s("--secondary", a.secondary);
  s("--secondary-foreground", a.secondaryForeground);
  s("--accent", a.accent);
  s("--accent-foreground", a.accentForeground);
  s("--muted", a.muted);
  s("--muted-foreground", a.mutedForeground);
  s("--foreground", a.foreground);
  s("--card", a.card);
  s("--card-foreground", a.cardForeground);
  s("--popover", a.popover);
  s("--popover-foreground", a.popoverForeground);
  s("--border", a.border);
  s("--input", a.input);
  s("--sidebar", a.sidebar);
  s("--sidebar-foreground", a.sidebarForeground);
  s("--sidebar-primary", a.sidebarPrimary);
  s("--sidebar-primary-foreground", a.sidebarPrimaryForeground);
  s("--sidebar-accent", a.sidebarAccent);
  s("--sidebar-accent-foreground", a.sidebarAccentForeground);
  s("--sidebar-border", a.sidebarBorder);
  s("--sidebar-ring", a.sidebarRing);
  s("--chart-1", a.chart1);
  s("--chart-2", a.chart2);
  s("--chart-3", a.chart3);
  s("--chart-4", a.chart4);
  s("--chart-5", a.chart5);
  s("--primary-glow", a.primaryGlow);
  // neutralise any hardcoded gradient tints
  s("--tw-gradient-stops", "var(--tw-gradient-from), var(--tw-gradient-to)");
  s("--tw-gradient-from", a.primary + "20");
  s("--tw-gradient-to", a.primary + "10");
  if (persist) localStorage.setItem(THEME_ACCENT_STORAGE_KEY, a.id);
}

export function getStoredThemeAccentId(): string {
  if (typeof window === "undefined") return "purple";
  return localStorage.getItem(THEME_ACCENT_STORAGE_KEY) || "purple";
}
