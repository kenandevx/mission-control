"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
} from "@tabler/icons-react";
import { ProcessEditorModal } from "@/components/processes/process-editor-modal";
import { useProcesses } from "@/hooks/use-processes";

export function ProcessesPageClient() {
  const { processes, agents, skills, loading, createProcess, updateProcess, deleteProcess, duplicateProcess, getProcessDetail } = useProcesses();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingProcessId, setEditingProcessId] = useState<string | null>(null);
  const [editingInitialData, setEditingInitialData] = useState<Parameters<typeof createProcess>[0] | undefined>(undefined);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingName, setDeletingName] = useState("");

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
        })),
      });
    } else {
      setEditingInitialData(undefined);
    }
    setEditorOpen(true);
  };

  const handleDeleteClick = (id: string, name: string) => {
    setDeletingId(id);
    setDeletingName(name);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (deletingId) await deleteProcess(deletingId);
    setDeleteDialogOpen(false);
    setDeletingId(null);
    setDeletingName("");
  };

  const handleDuplicate = async (id: string) => {
    await duplicateProcess(id);
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
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
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
        <div className="rounded-xl border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className="font-semibold">Name</TableHead>
                <TableHead className="font-semibold">Description</TableHead>
                <TableHead className="font-semibold text-center w-24">Steps</TableHead>
                <TableHead className="font-semibold text-center w-24">Version</TableHead>
                <TableHead className="font-semibold text-right w-32">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {processes.map((p) => (
                <TableRow
                  key={p.id}
                  className="cursor-pointer hover:bg-muted/40 transition-colors"
                  onClick={() => handleEdit(p.id)}
                >
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <IconStack2 className="size-4 text-primary shrink-0" />
                      <span className="font-medium">{p.name}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground line-clamp-1">
                      {p.description || "—"}
                    </span>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="secondary" className="tabular-nums">
                      {p.step_count}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="text-sm text-muted-foreground tabular-nums">
                      v{p.version_number ?? 1}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
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
                        className="size-7 text-destructive/70 hover:text-destructive cursor-pointer"
                        onClick={() => handleDeleteClick(p.id, p.name)}
                        title="Delete"
                      >
                        <IconTrash className="size-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete process?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &ldquo;{deletingName}&rdquo; and all its versions. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
