"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SetupState = {
  bridgeEmail: string;
};

const initialState: SetupState = {
  bridgeEmail: "",
};

export default function SetupPage() {
  const router = useRouter();
  const [state, setState] = useState<SetupState>(initialState);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const response = await fetch("/api/setup", { cache: "reload" });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Failed to load setup.");
        }

        if (!active) return;

        const settings = (payload.settings || {}) as Partial<SetupState>;
        setState({
          bridgeEmail: settings.bridgeEmail || "",
        });
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load setup.");
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, []);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSaving(true);

    try {
      const response = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...state,
          setupCompleted: true,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to save setup.");
      }

      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save setup.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading setup…</div>;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <form onSubmit={onSubmit} className="w-full max-w-lg space-y-4 rounded-lg border bg-card p-6 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold">Workspace setup required</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Complete this once to isolate your runtime agent configuration.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Mandatory fields: none. You can finish setup immediately and update values later in Settings.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="bridgeEmail">Bridge email (optional)</Label>
          <Input
            id="bridgeEmail"
            value={state.bridgeEmail}
            onChange={(event) => setState((prev) => ({ ...prev, bridgeEmail: event.target.value }))}
            placeholder="you@company.com"
          />
          <p className="text-xs text-muted-foreground">
            Usually your dashboard login email. Also used by `dashboard-bridge --email ...`.
          </p>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <Button type="submit" className="w-full" disabled={saving}>
          {saving ? "Saving…" : "Complete setup"}
        </Button>
      </form>
    </main>
  );
}
