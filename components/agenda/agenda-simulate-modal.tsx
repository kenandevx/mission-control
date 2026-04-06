"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { IconPlayerPlay, IconLoader2 } from "@tabler/icons-react";
import { ProcessSimulateModal } from "@/components/processes/process-simulate-modal";
import type { AgendaEventFormData } from "./agenda-event-modal";

type AgendaSimulateModalProps = {
  open: boolean;
  formData: AgendaEventFormData;
  onClose: () => void;
};

export function AgendaSimulateModal({ open, formData, onClose }: AgendaSimulateModalProps) {
  const [simulateOpen, setSimulateOpen] = useState(false);
  const [loadingSteps, setLoadingSteps] = useState(false);
  const [steps, setSteps] = useState<Array<{
    title: string;
    instruction: string;
    skillKey?: string;
    agentId?: string;
    modelOverride?: string;
    timeoutSeconds?: number | null;
  }>>([]);
  const [eventName, setEventName] = useState("");

  const handleStartSimulate = async () => {
    setLoadingSteps(true);
    try {
      const builtSteps: typeof steps = [];

      // Request as first step if present
      if (formData.request?.trim()) {
        builtSteps.push({
          title: "Request",
          instruction: `[SIMULATION MODE]\n\n${(formData as Record<string, unknown>).request}`,
          agentId: formData.agentId || undefined,
          modelOverride: formData.modelOverride || undefined,
          timeoutSeconds: formData.executionWindowMinutes ? formData.executionWindowMinutes * 60 : null,
        });
      }

      // Fetch and append steps from each attached process
      for (const pid of formData.processVersionIds) {
        const res = await fetch(`/api/processes/${pid}`, { cache: "reload" });
        const json = await res.json();
        if (!json.ok || !Array.isArray(json.steps)) continue;
        for (const s of json.steps) {
          builtSteps.push({
            title: s.title || s.step_title || "Step",
            instruction: `[SIMULATION MODE]\n\n${s.instruction || ""}`,
            agentId: s.agent_id || s.agentId || formData.agentId || undefined,
            skillKey: s.skill_key || s.skillKey || undefined,
            modelOverride: s.model_override || s.modelOverride || formData.modelOverride || undefined,
            timeoutSeconds: s.timeout_seconds || s.timeoutSeconds || null,
          });
        }
      }

      if (builtSteps.length === 0) {
        // Fallback: just run the request as a single step
        builtSteps.push({
          title: "Agenda Event",
          instruction: `[SIMULATION MODE]\n\n${(formData as Record<string, unknown>).request || "No request or processes attached."}`,
          agentId: formData.agentId || undefined,
          modelOverride: formData.modelOverride || undefined,
        });
      }

      setSteps(builtSteps);
      setEventName(formData.title || "Agenda Event");
      setSimulateOpen(true);
    } finally {
      setLoadingSteps(false);
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="flex flex-col gap-3 p-4 border rounded-xl bg-card">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Simulate this event</p>
            <p className="text-xs text-muted-foreground">
              Run a test execution to preview agent responses and file outputs before scheduling.
            </p>
          </div>
          <Button
            size="sm"
            onClick={handleStartSimulate}
            disabled={loadingSteps}
            className="gap-1.5 cursor-pointer shrink-0"
          >
            {loadingSteps ? (
              <IconLoader2 className="size-3.5 animate-spin" />
            ) : (
              <IconPlayerPlay className="size-3.5" />
            )}
            {loadingSteps ? "Preparing..." : "Run Simulation"}
          </Button>
        </div>
      </div>

      <ProcessSimulateModal
        open={simulateOpen}
        processName={eventName}
        steps={steps}
        autoStart
        onClose={() => {
          setSimulateOpen(false);
          onClose();
        }}
      />
    </>
  );
}
