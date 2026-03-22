"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";

type LiveState = "connecting" | "connected" | "offline";

export function LogsLiveRefresh() {
  const [state, setState] = useState<LiveState>("connecting");

  useEffect(() => {
    const eventSource = new EventSource("/api/agent/logs/stream");

    eventSource.addEventListener("ready", () => setState("connected"));
    eventSource.addEventListener("log_row", () => setState("connected"));
    eventSource.onerror = () => setState("offline");

    return () => {
      eventSource.close();
    };
  }, []);

  const variant = useMemo(() => {
    if (state === "connected") return "default";
    if (state === "connecting") return "secondary";
    return "destructive";
  }, [state]);

  const label =
    state === "connected"
      ? "Live: Bridge Connected"
      : state === "connecting"
        ? "Live: Connecting"
        : "Live: Offline";

  return <Badge variant={variant}>{label}</Badge>;
}
