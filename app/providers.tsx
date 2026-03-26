"use client";

import { useEffect, useRef } from "react";
import { ThemeProvider } from "@/components/providers/theme-provider";

function StartupEventHook() {
  const mountedRef = useRef(false);
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    const fired = sessionStorage.getItem("mission-control-startup-event-fired");
    if (fired) return;
    sessionStorage.setItem("mission-control-startup-event-fired", "1");

    const payload = {
      runtimeAgentId: "main",
      agentId: "main",
      level: "info",
      type: "system",
      eventType: "system.startup",
      message: "Mission Control session startup",
      channelType: "internal",
    };

    void fetch("/api/agent/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {
      sessionStorage.removeItem("mission-control-startup-event-fired");
    });
  }, []);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <StartupEventHook />
      {children}
    </ThemeProvider>
  );
}
