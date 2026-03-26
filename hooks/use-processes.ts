"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export type ProcessSummary = {
  id: string;
  name: string;
  description: string;
  status: "draft" | "published" | "archived";
  created_by: string | null;
  created_at: string;
  updated_at: string;
  latest_version_id: string | null;
  version_number: number | null;
  step_count: number;
};

export type ProcessStep = {
  id: string;
  title: string;
  instruction: string;
  skillKey: string;
  agentId: string;
  timeoutSeconds: number | null;
  modelOverride: string;
};

export type ProcessDetail = ProcessSummary & {
  version_label: string | null;
  versions: { id: string; version_number: number; created_at: string; published_at: string | null; version_label: string }[];
  steps: {
    id: string;
    step_order: number;
    title: string;
    instruction: string;
    skill_key: string | null;
    agent_id: string | null;
    timeout_seconds: number | null;
    model_override: string | null;
  }[];
};

export type ProcessFormData = {
  name: string;
  description: string;
  versionLabel: string;
  steps: ProcessStep[];
  status: "draft" | "published";
};

export type AgentOption = { id: string; name: string; model: string | null; status: string };
export type SkillOption = { key: string; name: string; description: string };

async function apiFetch(path: string, body: Record<string, unknown>) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function apiGet(path: string) {
  const res = await fetch(path, { cache: "reload" });
  return res.json();
}

export function useProcesses() {
  const [processes, setProcesses] = useState<ProcessSummary[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [skills, setSkills] = useState<SkillOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadProcesses = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [procsJson, agentsJson, skillsJson] = await Promise.all([
        apiGet("/api/processes"),
        apiGet("/api/agents"),
        apiGet("/api/skills"),
      ]);

      if (procsJson.ok) setProcesses(procsJson.processes ?? []);
      else setError(procsJson.error ?? "Failed to load processes");

      if (agentsJson.agents) setAgents(agentsJson.agents);
      if (skillsJson.skills) setSkills(skillsJson.skills);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void loadProcesses();
  }, [loadProcesses]);

  const createProcess = async (data: ProcessFormData) => {
    const json = await apiFetch("/api/processes", {
      action: "createProcess",
      name: data.name,
      description: data.description,
      versionLabel: data.versionLabel,
      status: data.status,
      steps: data.steps.map((s, i) => ({
        title: s.title,
        instruction: s.instruction,
        skillKey: s.skillKey || null,
        agentId: s.agentId || null,
        timeoutSeconds: s.timeoutSeconds || null,
        modelOverride: s.modelOverride || null,
        stepOrder: i,
      })),
    });
    if (json.ok) {
      await loadProcesses();
      toast.success("Process created");
      return json.process;
    } else {
      toast.error(json.error ?? "Failed to create process");
      throw new Error(json.error);
    }
  };

  const updateProcess = async (id: string, data: ProcessFormData) => {
    const json = await apiFetch(`/api/processes/${id}`, {
      name: data.name,
      description: data.description,
      versionLabel: data.versionLabel,
      steps: data.steps.map((s, i) => ({
        title: s.title,
        instruction: s.instruction,
        skillKey: s.skillKey || null,
        agentId: s.agentId || null,
        timeoutSeconds: s.timeoutSeconds || null,
        modelOverride: s.modelOverride || null,
        stepOrder: i,
      })),
      status: data.status,
      action: undefined,
    });
    if (json.ok) {
      await loadProcesses();
      toast.success("Process updated");
      return json;
    } else {
      toast.error(json.error ?? "Failed to update process");
      throw new Error(json.error);
    }
  };

  const deleteProcess = async (id: string) => {
    const res = await fetch(`/api/processes/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (json.ok) {
      setProcesses((prev) => prev.filter((p) => p.id !== id));
      toast.success("Process deleted");
    } else {
      toast.error(json.error ?? "Failed to delete process");
    }
  };

  const duplicateProcess = async (id: string) => {
    const json = await apiFetch("/api/processes", { action: "duplicateProcess", processId: id });
    if (json.ok) {
      await loadProcesses();
      toast.success("Process duplicated");
    } else {
      toast.error(json.error ?? "Failed to duplicate process");
    }
  };

  const getProcessDetail = async (id: string): Promise<ProcessDetail | null> => {
    const res = await fetch(`/api/processes/${id}`, { cache: "reload" });
    const json = await res.json();
    if (json.ok && json.process) {
      return {
        ...json.process,
        version_label: json.process.version_label ?? null,
        versions: json.versions ?? [],
        steps: json.steps ?? [],
      } as ProcessDetail;
    }
    return null;
  };

  return {
    processes,
    agents,
    skills,
    loading,
    error,
    loadProcesses,
    createProcess,
    updateProcess,
    deleteProcess,
    duplicateProcess,
    getProcessDetail,
  };
}
