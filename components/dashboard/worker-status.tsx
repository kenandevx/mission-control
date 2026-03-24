"use client";

import { useState, useEffect } from "react";

interface WorkerMetrics {
  enabled: boolean;
  maxConcurrency: number;
  activeNow: number;
  queuedCount: number;
  lastTickAt: string | null;
}

export function WorkerStatus() {
  const [metrics, setMetrics] = useState<WorkerMetrics | null>(null);

  // Fetch initial metrics
  useEffect(() => {
    fetch("/api/tasks/worker-metrics")
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) setMetrics(data);
      })
      .catch(() => {});
  }, []);

  // SSE updates
  useEffect(() => {
    const es = new EventSource("/api/events");
    es.addEventListener("worker_tick", () => {
      fetch("/api/tasks/worker-metrics")
        .then((res) => res.json())
        .then((data) => {
          if (data.ok) setMetrics(data);
        })
        .catch(() => {});
    });
    return () => es.close();
  }, []);

  if (!metrics) return null;

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className={`inline-block w-2 h-2 rounded-full ${metrics.enabled ? "bg-green-500" : "bg-red-500"}`} />
      <span>Worker {metrics.enabled ? "on" : "off"}</span>
      {metrics.enabled && (
        <>
          <span className="text-muted-foreground">({metrics.activeNow}/{metrics.maxConcurrency} active</span>
          {metrics.queuedCount > 0 && <span className="text-muted-foreground">, {metrics.queuedCount} queued</span>}
          <span className="text-muted-foreground">)</span>
        </>
      )}
    </div>
  );
}