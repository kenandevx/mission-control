"use client";

import { useEffect, useState } from "react";

export function usePendingApprovalsCount() {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchCount = async () => {
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "countPendingApprovals" }),
      });
      const data = await res.json();
      setCount(data.count || 0);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCount();
  }, []);

  // Listen for ticket_activity to keep count live
  useEffect(() => {
    if (typeof window === "undefined") return;
    const es = new EventSource("/api/events");
    es.addEventListener("ticket_activity", fetchCount);
    return () => es.close();
  }, []);

  return { count, loading, refresh: fetchCount };
}
