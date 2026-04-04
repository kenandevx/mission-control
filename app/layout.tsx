import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { Providers } from "./providers";
import { getInstanceName } from "@/lib/instance-name";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const instanceName = await getInstanceName();
  return {
    title: instanceName,
    description: `${instanceName} — boards-first workspace with kanban, agenda, processes, and agents.`,
  };
}

const themeAccentBootstrap = `(function(){
  var d=document.documentElement;
  var theme=localStorage.getItem('mc-theme')||'system';
  var accent=localStorage.getItem('mc-theme-accent')||'purple';
  var dark=theme==='dark'||(theme==='system'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);
  if(dark){d.classList.add('dark')}else{d.classList.remove('dark')}

  var H={purple:293,green:152,yellow:95,blue:252,teal:196,pink:350,orange:50,rose:18,indigo:282,slate:255};
  var h=H[accent]||293;
  var wrap=function(v){v=v%360;return v<0?v+360:v};
  var h2=wrap(h-90),h3=wrap(h+130),h4=wrap(h-40),h5=wrap(h+40);
  var S=d.style;
  var set=function(k,v){S.setProperty(k,v,'important')};

  if(!dark){
    set('--background','oklch(0.988 0.006 293)');
    set('--foreground','oklch(0.18 0.02 '+h+')');
    set('--card','oklch(0.995 0.004 '+h+')');
    set('--card-foreground','oklch(0.18 0.02 '+h+')');
    set('--popover','oklch(0.995 0.004 '+h+')');
    set('--popover-foreground','oklch(0.18 0.02 '+h+')');
    set('--primary','oklch(0.541 0.281 '+h+')');
    set('--primary-foreground','oklch(0.98 0.01 '+h+')');
    set('--secondary','oklch(0.935 0.045 '+h+')');
    set('--secondary-foreground','oklch(0.22 0.04 '+h+')');
    set('--muted','oklch(0.945 0.03 '+h+')');
    set('--muted-foreground','oklch(0.45 0.045 '+h+')');
    set('--accent','oklch(0.94 0.03 '+h+')');
    set('--accent-foreground','oklch(0.25 0.03 '+h+')');
    set('--border','oklch(0.91 0.015 '+h+')');
    set('--input','oklch(0.91 0.015 '+h+')');
    set('--ring','oklch(0.702 0.183 '+h+')');
    set('--sidebar','oklch(0.975 0.012 '+h+')');
    set('--sidebar-foreground','oklch(0.18 0.02 '+h+')');
    set('--sidebar-primary','oklch(0.541 0.281 '+h+')');
    set('--sidebar-primary-foreground','oklch(0.98 0.01 '+h+')');
    set('--sidebar-accent','oklch(0.94 0.03 '+h+')');
    set('--sidebar-accent-foreground','oklch(0.25 0.03 '+h+')');
    set('--sidebar-border','oklch(0.91 0.015 '+h+')');
    set('--sidebar-ring','oklch(0.702 0.183 '+h+')');
    set('--chart-1','oklch(0.82 0.12 '+h+')');
    set('--chart-2','oklch(0.72 0.18 '+h2+')');
    set('--chart-3','oklch(0.62 0.22 '+h3+')');
    set('--chart-4','oklch(0.78 0.12 '+h4+')');
    set('--chart-5','oklch(0.65 0.18 '+h5+')');
    set('--primary-glow','oklch(0.541 0.281 '+h+' / 0.5)');
  } else {
    set('--background','oklch(0.13 0.012 '+h+')');
    set('--foreground','oklch(0.96 0.005 '+h+')');
    set('--card','oklch(0.185 0.014 '+h+')');
    set('--card-foreground','oklch(0.96 0.005 '+h+')');
    set('--popover','oklch(0.185 0.014 '+h+')');
    set('--popover-foreground','oklch(0.96 0.005 '+h+')');
    set('--primary','oklch(0.65 0.24 '+h+')');
    set('--primary-foreground','oklch(0.97 0.01 '+h+')');
    set('--secondary','oklch(0.28 0.035 '+h+')');
    set('--secondary-foreground','oklch(0.93 0.02 '+h+')');
    set('--muted','oklch(0.25 0.025 '+h+')');
    set('--muted-foreground','oklch(0.76 0.03 '+h+')');
    set('--accent','oklch(0.26 0.025 '+h+')');
    set('--accent-foreground','oklch(0.95 0.01 '+h+')');
    set('--border','oklch(0.32 0.015 '+h+')');
    set('--input','oklch(0.28 0.015 '+h+')');
    set('--ring','oklch(0.55 0.22 '+h+')');
    set('--sidebar','oklch(0.16 0.014 '+h+')');
    set('--sidebar-foreground','oklch(0.95 0.005 '+h+')');
    set('--sidebar-primary','oklch(0.65 0.24 '+h+')');
    set('--sidebar-primary-foreground','oklch(0.97 0.01 '+h+')');
    set('--sidebar-accent','oklch(0.24 0.02 '+h+')');
    set('--sidebar-accent-foreground','oklch(0.95 0.01 '+h+')');
    set('--sidebar-border','oklch(0.30 0.015 '+h+')');
    set('--sidebar-ring','oklch(0.55 0.22 '+h+')');
    set('--chart-1','oklch(0.78 0.16 '+h+')');
    set('--chart-2','oklch(0.72 0.15 '+h2+')');
    set('--chart-3','oklch(0.70 0.17 '+h3+')');
    set('--chart-4','oklch(0.75 0.14 '+h4+')');
    set('--chart-5','oklch(0.70 0.18 '+h5+')');
    set('--primary-glow','oklch(0.65 0.24 '+h+' / 0.5)');
  }

  set('--destructive',dark?'oklch(0.68 0.2 25)':'oklch(0.577 0.245 27.325)');
  set('--destructive-foreground',dark?'oklch(0.98 0 0)':'oklch(0.985 0 0)');
  set('--tw-gradient-stops','var(--tw-gradient-from), var(--tw-gradient-to)');
  set('--tw-gradient-from',(dark?'oklch(0.65 0.24 '+h+')':'oklch(0.541 0.281 '+h+')')+'20');
  set('--tw-gradient-to',(dark?'oklch(0.65 0.24 '+h+')':'oklch(0.541 0.281 '+h+')')+'10');
})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <script dangerouslySetInnerHTML={{ __html: themeAccentBootstrap }} />
        <Providers>
          {children}
          <Toaster position="bottom-right" />
        </Providers>
      </body>
    </html>
  );
}
