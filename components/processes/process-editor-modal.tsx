"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  IconGripVertical,
  IconTrash,
  IconPlus,
  IconStack2,
  IconRobot,
  IconCode,
  IconClock,
  IconFileText,
} from "@tabler/icons-react";

export type ProcessStep = {
  id: string;
  title: string;
  instruction: string;
  skillKey: string;
  agentId: string;
  timeoutSeconds: number | null;
};

export type ProcessFormData = {
  name: string;
  description: string;
  steps: ProcessStep[];
  status: "draft" | "published";
};

type AgentOption = { id: string; name: string; model: string | null };
type SkillOption = { key: string; name: string; description: string };

type Props = {
  open: boolean;
  initialData?: Partial<ProcessFormData>;
  agents?: AgentOption[];
  skills?: SkillOption[];
  onClose: () => void;
  onSave: (data: ProcessFormData) => void | Promise<void>;
};

const emptyStep = (): ProcessStep => ({
  id: crypto.randomUUID(),
  title: "",
  instruction: "",
  skillKey: "",
  agentId: "",
  timeoutSeconds: null,
});

const EMPTY_AGENTS: AgentOption[] = [];
const EMPTY_SKILLS: SkillOption[] = [];

export function ProcessEditorModal({ open, initialData, agents = EMPTY_AGENTS, skills = EMPTY_SKILLS, onClose, onSave }: Props) {
  const [form, setForm] = useState<ProcessFormData>({
    name: "",
    description: "",
    steps: [emptyStep()],
    status: "published",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const initialDataRef = useRef(initialData);
  useEffect(() => {
    if (open) initialDataRef.current = initialData;
  }, [open, initialData]);

  useEffect(() => {
    if (open) {
      const data = initialDataRef.current;
      setForm({
        name: data?.name ?? "",
        description: data?.description ?? "",
        steps: data?.steps?.map((s) => ({ ...s, id: s.id || crypto.randomUUID() })) ?? [emptyStep()],
        status: "published",
      });
      setError("");
      setDragIndex(null);
      setDragOverIndex(null);
    }
  }, [open]);

  const isEditing = !!initialData?.name;

  const handleSave = async () => {
    if (!form.name.trim()) { setError("Process name is required"); return; }
    if (form.steps.length === 0) { setError("At least one step is required"); return; }
    setSaving(true);
    try {
      await onSave({ ...form, status: "published" });
    } catch {
      // error handled by parent via toast
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setForm({ name: "", description: "", steps: [emptyStep()], status: "published" });
    setError("");
    onClose();
  };

  const updateStep = (index: number, patch: Partial<ProcessStep>) => {
    setForm((prev) => ({
      ...prev,
      steps: prev.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    }));
  };

  const addStep = () => {
    setForm((prev) => ({ ...prev, steps: [...prev.steps, emptyStep()] }));
  };

  const deleteStep = (index: number) => {
    if (form.steps.length <= 1) return;
    setForm((prev) => ({ ...prev, steps: prev.steps.filter((_, i) => i !== index) }));
  };

  // ── Drag and drop ──────────────────────────────────────────────────────────
  const handleDragStart = useCallback((index: number) => {
    setDragIndex(index);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  }, []);

  const handleDrop = useCallback((dropIndex: number) => {
    if (dragIndex === null || dragIndex === dropIndex) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }
    setForm((prev) => {
      const steps = [...prev.steps];
      const [moved] = steps.splice(dragIndex, 1);
      steps.splice(dropIndex, 0, moved);
      return { ...prev, steps };
    });
    setDragIndex(null);
    setDragOverIndex(null);
  }, [dragIndex]);

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDragOverIndex(null);
  }, []);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleClose(); }}>
      <DialogContent className="sm:max-w-[640px] max-h-[92vh] overflow-y-auto p-0">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-0">
          <div className="flex items-center gap-3 mb-1">
            <div className={[
              "flex items-center justify-center size-9 rounded-lg shrink-0",
              isEditing ? "bg-primary/10" : "bg-primary",
            ].join(" ")}>
              <IconStack2 className={[
                "size-4.5",
                isEditing ? "text-primary" : "text-primary-foreground",
              ].join(" ")} />
            </div>
            <div>
              <DialogTitle className="text-lg">
                {isEditing ? "Edit process" : "New process"}
              </DialogTitle>
              <DialogDescription className="text-xs mt-0.5">
                {isEditing
                  ? "Update the process steps. Changes create a new version."
                  : "Build a reusable step-by-step blueprint for agenda events."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-5 px-6 py-5">
          {/* Name */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="pe-name" className="text-xs font-semibold text-foreground/80">
              Name <span className="text-destructive ml-0.5">*</span>
            </Label>
            <Input
              id="pe-name"
              placeholder="e.g. Website health check"
              value={form.name}
              onChange={(e) => { setForm((prev) => ({ ...prev, name: e.target.value })); setError(""); }}
              className="h-10"
              autoFocus
            />
          </div>

          {/* Description */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="pe-desc" className="text-xs font-semibold text-foreground/80 flex items-center gap-1.5">
              <IconFileText className="size-3.5 text-primary" />
              Description
            </Label>
            <Textarea
              id="pe-desc"
              placeholder="What does this process do?"
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              rows={2}
              className="resize-none"
            />
          </div>

          <Separator />

          {/* Steps */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-foreground/80 flex items-center gap-1.5">
                <IconStack2 className="size-3.5 text-primary" />
                Steps
              </Label>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 h-8 text-xs cursor-pointer"
                onClick={addStep}
              >
                <IconPlus className="size-3" />
                Add Step
              </Button>
            </div>

            <div className="flex flex-col gap-2">
              {form.steps.map((step, index) => (
                <div
                  key={step.id}
                  draggable
                  onDragStart={() => handleDragStart(index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDrop={() => handleDrop(index)}
                  onDragEnd={handleDragEnd}
                  className={[
                    "group rounded-xl border bg-card transition-all duration-150",
                    dragIndex === index ? "opacity-40 scale-[0.98]" : "",
                    dragOverIndex === index && dragIndex !== index
                      ? "ring-2 ring-primary/40 border-primary/40"
                      : "",
                  ].join(" ")}
                >
                  {/* Step header */}
                  <div className="flex items-center gap-2 px-3 py-2.5 border-b bg-muted/20 rounded-t-xl">
                    <div className="cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-colors">
                      <IconGripVertical className="size-4" />
                    </div>
                    <Badge variant="outline" className="size-6 p-0 flex items-center justify-center text-[10px] font-bold tabular-nums shrink-0">
                      {index + 1}
                    </Badge>
                    <Input
                      placeholder="Step title"
                      value={step.title}
                      onChange={(e) => updateStep(index, { title: e.target.value })}
                      className="h-8 border-0 bg-transparent shadow-none focus-visible:ring-0 px-1 text-sm font-medium"
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 shrink-0 text-muted-foreground/40 hover:text-destructive cursor-pointer"
                      onClick={() => deleteStep(index)}
                      disabled={form.steps.length === 1}
                    >
                      <IconTrash className="size-3.5" />
                    </Button>
                  </div>

                  {/* Step body */}
                  <div className="px-3 py-3 flex flex-col gap-3">
                    <Textarea
                      placeholder="Instruction for this step..."
                      value={step.instruction}
                      onChange={(e) => updateStep(index, { instruction: e.target.value })}
                      rows={2}
                      className="resize-none text-sm"
                    />

                    <div className="grid grid-cols-3 gap-2">
                      {/* Skill */}
                      <div className="flex flex-col gap-1">
                        <Label className="text-[10px] text-muted-foreground font-medium flex items-center gap-1">
                          <IconCode className="size-2.5" />
                          Skill
                        </Label>
                        <Select
                          value={step.skillKey || "__none__"}
                          onValueChange={(v) => updateStep(index, { skillKey: v === "__none__" ? "" : v })}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="None" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">None</SelectItem>
                            {skills.map((s) => (
                              <SelectItem key={s.key} value={s.key}>{s.name || s.key}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Agent */}
                      <div className="flex flex-col gap-1">
                        <Label className="text-[10px] text-muted-foreground font-medium flex items-center gap-1">
                          <IconRobot className="size-2.5" />
                          Agent
                        </Label>
                        <Select
                          value={step.agentId || "__default__"}
                          onValueChange={(v) => updateStep(index, { agentId: v === "__default__" ? "" : v })}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Default" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__default__">Default</SelectItem>
                            {agents.map((a) => (
                              <SelectItem key={a.id} value={a.id}>{a.name || a.id}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Timeout */}
                      <div className="flex flex-col gap-1">
                        <Label className="text-[10px] text-muted-foreground font-medium flex items-center gap-1">
                          <IconClock className="size-2.5" />
                          Timeout (s)
                        </Label>
                        <Input
                          type="number"
                          placeholder="∞"
                          value={step.timeoutSeconds ?? ""}
                          onChange={(e) => updateStep(index, { timeoutSeconds: e.target.value ? Number(e.target.value) : null })}
                          min={10}
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Add step bottom button */}
            <Button
              variant="ghost"
              className="w-full border border-dashed border-border/60 hover:border-primary/40 hover:bg-primary/5 h-10 text-xs text-muted-foreground gap-1.5 cursor-pointer"
              onClick={addStep}
            >
              <IconPlus className="size-3.5" />
              Add another step
            </Button>
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-xs text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="px-6 pb-6 pt-0 gap-2">
          <Button variant="ghost" onClick={handleClose} disabled={saving} className="cursor-pointer">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving} className="gap-1.5 cursor-pointer">
            {saving ? (
              <>
                <svg className="size-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" d="M12 2a10 10 0 0 1 10 10" />
                </svg>
                Saving...
              </>
            ) : (
              <>
                <IconStack2 className="size-3.5" />
                {isEditing ? "Save changes" : "Create process"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
