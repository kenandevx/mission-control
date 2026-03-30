"use client";
import { useState, useEffect } from "react";

export type ModelEntry = { id: string; alias: string };

/**
 * Fetch the list of configured models from the OpenClaw backend.
 * Falls back to an empty list while loading.
 */
export function useModels() {
  const [models, setModels] = useState<ModelEntry[]>([]);
  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((data: { models?: ModelEntry[] }) => setModels(data.models ?? []))
      .catch(() => setModels([]));
  }, []);
  return models;
}
