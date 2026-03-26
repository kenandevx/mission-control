"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import {
  IconSun,
  IconMoon,
  IconDeviceDesktop,
  IconRefresh,
  IconDownload,
  IconTrash,
  IconAlertTriangle,
  IconCircleCheck,
  IconLoader2,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  loadNotificationSettings,
  saveNotificationSettings,
} from "@/components/providers/notification-provider";

// ── Theme options ────────────────────────────────────────────────────────────

type ThemeOption = {
  value: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const themeOptions: ThemeOption[] = [
  { value: "light", label: "Light", icon: IconSun },
  { value: "dark", label: "Dark", icon: IconMoon },
  { value: "system", label: "System", icon: IconDeviceDesktop },
];

// ── Main component ──────────────────────────────────────────────────────────

export function SettingsPageClient() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Update check state
  const [checking, setChecking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<{ behind: number; latestCommit: string } | null>(null);
  const [updating, setUpdating] = useState(false);

  // Danger zone state
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [resetting, setResetting] = useState(false);

  const [uninstallDialogOpen, setUninstallDialogOpen] = useState(false);
  const [uninstallConfirmText, setUninstallConfirmText] = useState("");
  const [uninstalling, setUninstalling] = useState(false);

  // Notification settings
  const [notifEnabled, setNotifEnabled] = useState(true);
  const [notifSound, setNotifSound] = useState(true);

  useEffect(() => {
    setMounted(true);
    const s = loadNotificationSettings();
    setNotifEnabled(s.enabled);
    setNotifSound(s.sound);
  }, []);

  // ── Actions ────────────────────────────────────────────────────────────────

  const checkUpdates = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "checkUpdates" }),
      });
      const json = await res.json();
      if (json.ok) {
        setUpdateInfo({ behind: json.behind, latestCommit: json.latestCommit || "" });
        if (json.behind === 0) toast.success("You're up to date!");
        else toast.info(`${json.behind} update${json.behind === 1 ? "" : "s"} available`);
      } else {
        toast.error(json.error || "Failed to check updates");
      }
    } catch {
      toast.error("Failed to check for updates");
    } finally {
      setChecking(false);
    }
  };

  const runUpdate = async () => {
    setUpdating(true);
    try {
      const res = await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update" }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(json.message || "Update complete!");
        setUpdateInfo(null);
      } else {
        toast.error(json.error || "Update failed");
      }
    } catch {
      toast.error("Update failed — check logs");
    } finally {
      setUpdating(false);
    }
  };

  const runCleanReset = async () => {
    setResetting(true);
    try {
      const res = await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cleanReset" }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(json.message || "Clean reset complete!");
      } else {
        toast.error(json.error || "Clean reset failed");
      }
    } catch {
      toast.error("Clean reset failed");
    } finally {
      setResetting(false);
      setResetDialogOpen(false);
      setResetConfirmText("");
    }
  };

  const runUninstall = async () => {
    setUninstalling(true);
    try {
      const res = await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "uninstall" }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(json.message || "Uninstalled successfully");
      } else {
        toast.error(json.error || "Uninstall failed");
      }
    } catch {
      toast.error("Uninstall failed");
    } finally {
      setUninstalling(false);
      setUninstallDialogOpen(false);
      setUninstallConfirmText("");
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-1 flex-col gap-6 px-3 py-4 sm:px-4 lg:px-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm">Manage preferences and system</p>
      </div>

      {/* ── Appearance ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Customize the look and feel</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            {themeOptions.map((option) => {
              const Icon = option.icon;
              const isActive = mounted && theme === option.value;
              return (
                <Button
                  key={option.value}
                  variant={isActive ? "default" : "outline"}
                  className="cursor-pointer gap-2"
                  onClick={() => setTheme(option.value)}
                >
                  <Icon className="size-4" />
                  {option.label}
                </Button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── Notifications ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <IconCircleCheck className="size-5 text-primary" />
            Notifications
          </CardTitle>
          <CardDescription>Control live notifications for task and event updates</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Enable / disable notifications */}
          <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/10 px-4 py-3">
            <div>
              <p className="text-sm font-semibold">Enable notifications</p>
              <p className="text-xs text-muted-foreground">Show toast alerts when tasks complete, fail, or need approval</p>
            </div>
            <Button
              variant={notifEnabled ? "default" : "outline"}
              size="sm"
              className="cursor-pointer gap-1.5 min-w-[80px]"
              onClick={() => {
                const next = !notifEnabled;
                setNotifEnabled(next);
                saveNotificationSettings({ enabled: next, sound: notifSound });
                toast.success(next ? "Notifications enabled" : "Notifications disabled");
              }}
            >
              {notifEnabled ? "On" : "Off"}
            </Button>
          </div>

          {/* Sound toggle */}
          <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/10 px-4 py-3">
            <div>
              <p className="text-sm font-semibold">Notification sound</p>
              <p className="text-xs text-muted-foreground">Play a chime when notifications appear</p>
            </div>
            <Button
              variant={notifSound ? "default" : "outline"}
              size="sm"
              className="cursor-pointer gap-1.5 min-w-[80px]"
              disabled={!notifEnabled}
              onClick={() => {
                const next = !notifSound;
                setNotifSound(next);
                saveNotificationSettings({ enabled: notifEnabled, sound: next });
                toast.success(next ? "Sound enabled" : "Sound disabled");
              }}
            >
              {notifSound ? "🔊 On" : "🔇 Off"}
            </Button>
          </div>

          {/* What triggers notifications */}
          <div className="rounded-lg border bg-muted/5 px-4 py-3">
            <p className="text-xs font-semibold text-muted-foreground mb-2">Notifications are triggered by:</p>
            <div className="grid grid-cols-2 gap-1.5 text-xs text-muted-foreground">
              <span>🚀 Ticket picked up</span>
              <span>✅ Ticket completed</span>
              <span>❌ Task failed</span>
              <span>📝 Plan ready for approval</span>
              <span>🤖 Agent responded</span>
              <span>🔄 Retry scheduled</span>
              <span>🟢 Agent started</span>
              <span>🔴 System errors</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── System Updates ──────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <IconDownload className="size-5 text-primary" />
            System Updates
          </CardTitle>
          <CardDescription>Check for and install Mission Control updates</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Update status */}
          {updateInfo && (
            <div className={[
              "rounded-lg border px-4 py-3 text-sm",
              updateInfo.behind === 0
                ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
                : "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400",
            ].join(" ")}>
              {updateInfo.behind === 0 ? (
                <div className="flex items-center gap-2">
                  <IconCircleCheck className="size-4" />
                  <span className="font-medium">Up to date</span>
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <IconAlertTriangle className="size-4" />
                    <span className="font-medium">{updateInfo.behind} update{updateInfo.behind === 1 ? "" : "s"} available</span>
                  </div>
                  {updateInfo.latestCommit && (
                    <p className="text-xs opacity-80 pl-6">Latest: {updateInfo.latestCommit}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={checkUpdates}
              disabled={checking || updating}
              className="gap-2 cursor-pointer"
            >
              {checking ? <IconLoader2 className="size-4 animate-spin" /> : <IconRefresh className="size-4" />}
              Check for updates
            </Button>

            {updateInfo && updateInfo.behind > 0 && (
              <Button
                onClick={runUpdate}
                disabled={updating}
                className="gap-2 cursor-pointer"
              >
                {updating ? <IconLoader2 className="size-4 animate-spin" /> : <IconDownload className="size-4" />}
                {updating ? "Updating…" : "Update now"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Danger Zone ─────────────────────────────────────────────── */}
      <Card className="border-destructive/30 bg-destructive/[0.02]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <IconAlertTriangle className="size-5" />
            Danger Zone
          </CardTitle>
          <CardDescription>Irreversible actions — proceed with caution</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Clean Reset */}
          <div className="flex items-center justify-between gap-4 rounded-lg border border-destructive/20 bg-background px-4 py-3">
            <div>
              <p className="text-sm font-semibold">Clean Reset</p>
              <p className="text-xs text-muted-foreground">Wipe the database and start fresh. All data will be deleted.</p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => { setResetDialogOpen(true); setResetConfirmText(""); }}
              disabled={resetting}
              className="shrink-0 cursor-pointer"
            >
              {resetting ? <IconLoader2 className="size-3.5 animate-spin" /> : <IconTrash className="size-3.5" />}
              <span className="ml-1.5">Reset</span>
            </Button>
          </div>

          {/* Uninstall */}
          <div className="flex items-center justify-between gap-4 rounded-lg border border-destructive/20 bg-background px-4 py-3">
            <div>
              <p className="text-sm font-semibold">Uninstall Mission Control</p>
              <p className="text-xs text-muted-foreground">Stop all services, remove Docker volumes and symlinks.</p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => { setUninstallDialogOpen(true); setUninstallConfirmText(""); }}
              disabled={uninstalling}
              className="shrink-0 cursor-pointer"
            >
              {uninstalling ? <IconLoader2 className="size-3.5 animate-spin" /> : <IconTrash className="size-3.5" />}
              <span className="ml-1.5">Uninstall</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Clean Reset Confirmation ────────────────────────────────── */}
      <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <IconAlertTriangle className="size-5" />
              Clean Reset
            </AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              This will <strong>wipe the entire database</strong> — all boards, tickets, events, logs, and settings will be permanently deleted. Services will be restarted with a fresh database.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-2 mt-2">
            <p className="text-sm text-muted-foreground">
              Type <strong className="text-destructive">RESET</strong> to confirm:
            </p>
            <Input
              value={resetConfirmText}
              onChange={(e) => setResetConfirmText(e.target.value)}
              placeholder="Type RESET"
              className="font-mono"
              autoFocus
            />
          </div>
          <AlertDialogFooter className="mt-4">
            <AlertDialogCancel disabled={resetting}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={runCleanReset}
              disabled={resetConfirmText !== "RESET" || resetting}
              className="gap-2 cursor-pointer"
            >
              {resetting ? <IconLoader2 className="size-4 animate-spin" /> : <IconTrash className="size-4" />}
              {resetting ? "Resetting…" : "Confirm Reset"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Uninstall Confirmation ──────────────────────────────────── */}
      <AlertDialog open={uninstallDialogOpen} onOpenChange={setUninstallDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <IconAlertTriangle className="size-5" />
              Uninstall Mission Control
            </AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              This will <strong>stop all services</strong>, remove Docker volumes, and clean up system symlinks. You&apos;ll need to re-run <code className="text-xs bg-muted px-1 py-0.5 rounded">install.sh</code> to use Mission Control again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-2 mt-2">
            <p className="text-sm text-muted-foreground">
              Type <strong className="text-destructive">UNINSTALL</strong> to confirm:
            </p>
            <Input
              value={uninstallConfirmText}
              onChange={(e) => setUninstallConfirmText(e.target.value)}
              placeholder="Type UNINSTALL"
              className="font-mono"
              autoFocus
            />
          </div>
          <AlertDialogFooter className="mt-4">
            <AlertDialogCancel disabled={uninstalling}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={runUninstall}
              disabled={uninstallConfirmText !== "UNINSTALL" || uninstalling}
              className="gap-2 cursor-pointer"
            >
              {uninstalling ? <IconLoader2 className="size-4 animate-spin" /> : <IconTrash className="size-4" />}
              {uninstalling ? "Uninstalling…" : "Confirm Uninstall"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
