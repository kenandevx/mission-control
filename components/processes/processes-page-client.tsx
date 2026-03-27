"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
import {
  IconStack2,
  IconPlus,
  IconPencil,
  IconTrash,
  IconCopy,
  IconPlayerPlay,
} from "@tabler/icons-react";
import { ProcessEditorModal } from "@/components/processes/process-editor-modal";
import { ProcessSimulateModal } from "@/components/processes/process-simulate-modal";
import { useProcesses } from "@/hooks/use-processes";

export function ProcessesPageClient() {
  const { processes, agents, skills, loading, createProcess, updateProcess, deleteProcess, duplicateProcess, getProcessDetail } = useProcesses();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingProcessId, setEditingProcessId] = useState<string | null>(null);
  const [editingInitialData, setEditingInitialData] = useState<Parameters<typeof createProcess>[0] | undefined>(undefined);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingName, setDeletingName] = useState("");
  const [tiedEvents, setTiedEvents] = useState<{ id: string; title: string }[]>([]);
  const [simulateOpen, setSimulateOpen] = useState(false);
  const [simulateProcessId, setSimulateProcessId] = useState<string | null>(null);
  const [simulateProcessName, setSimulateProcessName] = useState("");

  const handleSave = async (data: Parameters<typeof createProcess>[0]) => {
    if (editingProcessId) {
      await updateProcess(editingProcessId, data);
    } else {
      await createProcess(data);
    }
    setEditorOpen(false);
    setEditingProcessId(null);
    setEditingInitialData(undefined);
  };

  const handleNew = () => {
    setEditingProcessId(null);
    setEditingInitialData(undefined);
    setEditorOpen(true);
  };

  const handleEdit = async (processId: string) => {
    setEditingProcessId(processId);
    const detail = await getProcessDetail(processId);
    if (detail) {
      setEditingInitialData({
        name: detail.name,
        description: detail.description,
        status: "published",
        steps: detail.steps.map((s) => ({
          id: s.id || crypto.randomUUID(),
          title: s.title,
          instruction: s.instruction,
          skillKey: s.skill_key ?? "",
          agentId: s.agent_id ?? "",
          timeoutSeconds: s.timeout_seconds,
          modelOverride: s.model_override ?? "",
        })),
        versionLabel: detail.version_label || "",
      });
    } else {
      setEditingInitialData(undefined);
    }
    setEditorOpen(true);
  };

  const handleDeleteClick = async (id: string, name: string) => {
    setDeletingId(id);
    setDeletingName(name);
    setTiedEvents([]);
    // Check for tied agenda events
    try {
      const res = await fetch(`/api/processes/${id}`, { cache: "reload" });
      const json = await res.json();
      if (json.ok && Array.isArray(json.tiedEvents)) {
        setTiedEvents(json.tiedEvents);
      }
    } catch { /* ignore */ }
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (deletingId) await deleteProcess(deletingId);
    setDeleteDialogOpen(false);
    setDeletingId(null);
    setDeletingName("");
    setTiedEvents([]);
  };

  const handleDuplicate = async (id: string) => {
    await duplicateProcess(id);
  };

  const handleSimulate = (id: string, name: string) => {
    setSimulateProcessId(id);
    setSimulateProcessName(name);
    setSimulateOpen(true);
  };

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Processes</h2>
          <p className="text-sm text-muted-foreground">
            Reusable step-by-step execution blueprints for agenda events.
          </p>
        </div>
        <Button onClick={handleNew} className="gap-1.5 cursor-pointer">
          <IconPlus className="size-3.5" />
          New Process
        </Button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Card key={i} className="border-muted/60">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Skeleton className="size-4 rounded" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Skeleton className="size-7 rounded" />
                    <Skeleton className="size-7 rounded" />
                    <Skeleton className="size-7 rounded" />
                    <Skeleton className="size-7 rounded" />
                  </div>
                </div>
                <div className="mt-1 pl-6 space-y-1.5">
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-4/5" />
                </div>
              </CardHeader>
              <CardContent className="pt-0 flex items-center justify-between">
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-3 w-8" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : processes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center border rounded-xl bg-muted/20">
          <IconStack2 className="size-12 text-muted-foreground/40 mb-4" />
          <p className="font-semibold text-foreground mb-1">No processes yet</p>
          <p className="text-sm text-muted-foreground max-w-xs mb-5">
            Create reusable step-by-step blueprints that can be attached to agenda events.
          </p>
          <Button onClick={handleNew} className="gap-1.5 cursor-pointer">
            <IconPlus className="size-3.5" />
            Create your first process
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {processes.map((p) => (
            <Card
              key={p.id}
              className="cursor-pointer hover:border-primary/40 transition-colors group"
              onClick={() => handleEdit(p.id)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <IconStack2 className="size-4 text-primary shrink-0" />
                    <span className="font-semibold text-sm truncate">{p.name}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 cursor-pointer"
                      onClick={() => handleEdit(p.id)}
                      title="Edit"
                    >
                      <IconPencil className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 cursor-pointer"
                      onClick={() => handleDuplicate(p.id)}
                      title="Duplicate"
                    >
                      <IconCopy className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 cursor-pointer"
                      onClick={() => handleSimulate(p.id, p.name)}
                      title="Simulate"
                    >
                      <IconPlayerPlay className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 text-destructive/70 hover:text-destructive cursor-pointer"
                      onClick={() => handleDeleteClick(p.id, p.name)}
                      title="Delete"
                    >
                      <IconTrash className="size-3.5" />
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2 mt-1 pl-6">
                  {p.description || "No description"}
                </p>
              </CardHeader>
              <CardContent className="pt-0 flex items-center justify-between">
                <Badge variant="secondary" className="tabular-nums text-xs">
                  {p.step_count} {p.step_count === 1 ? "step" : "steps"}
                </Badge>
                <span className="text-xs text-muted-foreground tabular-nums">
                  v{p.version_number ?? 1}
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ProcessEditorModal
        open={editorOpen}
        agents={agents}
        skills={skills}
        initialData={editingInitialData}
        onClose={() => { setEditorOpen(false); setEditingProcessId(null); setEditingInitialData(undefined); }}
        onSave={handleSave}
      />

      <ProcessSimulateModal
        open={simulateOpen}
        processId={simulateProcessId ?? undefined}
        processName={simulateProcessName}
        onClose={() => { setSimulateOpen(false); setSimulateProcessId(null); setSimulateProcessName(""); }}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete process?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &ldquo;{deletingName}&rdquo; and all its versions. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {tiedEvents.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
              <p className="font-semibold text-amber-700 dark:text-amber-400 mb-1.5">
                ⚠️ {tiedEvents.length} agenda event{tiedEvents.length === 1 ? "" : "s"} use this process:
              </p>
              <ul className="list-disc pl-5 text-xs text-amber-600 dark:text-amber-400/80 space-y-0.5">
                {tiedEvents.map((e) => (
                  <li key={e.id}>{e.title}</li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground mt-2">
                All future occurrences of these events will be cancelled. Past runs are kept.
              </p>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {tiedEvents.length > 0 ? "Delete process & cancel events" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
