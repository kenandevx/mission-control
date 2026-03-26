"use client";

import { useEffect, useRef, useState } from "react";
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
  IconX,
  IconMicrophone,
  IconRobot,
  IconCalendarTime,
  IconCalendarPlus,
} from "@tabler/icons-react";

type RecurrenceType = "none" | "daily" | "weekly" | "monthly";
type TaskType = "one_time" | "repeatable";
type StartDateMode = "now" | "specific";
type EndDateMode = "forever" | "specific";
type Frequency = "daily" | "weekly";

export type AgendaEventFormData = {
  title: string;
  freePrompt: string;
  agentId: string;
  processVersionIds: string[];
  status: "draft" | "active";
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  timezone: string;
  recurrence: RecurrenceType;
  weekdays: string[];
  recurrenceUntil: string;
  editOccurrenceId?: string;
  editScope?: "single" | "this_and_future";
  taskType: TaskType;
  modelOverride: string;
  startDateMode: StartDateMode;
  endDateMode: EndDateMode;
  frequency: Frequency;
};

type AgentOption = { id: string; name: string };
type ProcessOption = { id: string; name: string; version_number: number };

type Props = {
  open: boolean;
  agents?: AgentOption[];
  processes?: ProcessOption[];
  initialData?: Partial<AgendaEventFormData>;
  onClose: () => void;
  onSave: (data: AgendaEventFormData) => void;
};

const EMPTY_AGENTS: AgentOption[] = [];
const EMPTY_PROCESSES: ProcessOption[] = [];

const MODELS = [
  { id: "anthropic/claude-opus-4-6", alias: "Claude Opus 4" },
  { id: "openrouter/deepseek/deepseek-chat-v3", alias: "deepseek3chat" },
  { id: "openrouter/auto", alias: "OpenRouter" },
  { id: "openrouter/deepseek/deepseek-v3.2", alias: "deepseek3.2" },
  { id: "openrouter/minimax/minimax-m2.5", alias: "Minimax2.5" },
  { id: "openrouter/minimax/minimax-m2.7", alias: "Minimax2.7" },
  { id: "openrouter/openai/gpt-5.4", alias: "gpt5.4" },
  { id: "openrouter/openai/gpt-oss-120b", alias: "gptoss120b" },
  { id: "openrouter/openai/gpt-oss-20b:nitro", alias: "gptoss20bnitro" },
  { id: "openrouter/google/gemini-3-flash-preview", alias: "gemini3flash" },
  { id: "openrouter/google/gemini-3.1-pro-preview", alias: "gemini3pro" },
  { id: "openrouter/openai/gpt-5.4-nano", alias: "gpt5.4-nano" },
  { id: "openrouter/openai/gpt-5.4-mini", alias: "gpt5.4-mini" },
  { id: "openrouter/stepfun/step-3.5-flash:free", alias: "Step Flash Free" },
  { id: "openrouter/mistralai/devstral-2512:free", alias: "Devstral Free" },
  { id: "openrouter/qwen/qwen3-coder:free", alias: "Qwen3 Coder" },
  { id: "openrouter/deepseek/deepseek-chat-v3:free", alias: "Deepseek Chat V3 Free" },
];

const TIMEZONES = [
  { value: "Europe/Amsterdam", label: "Europe/Amsterdam (CET)" },
  { value: "Europe/London", label: "Europe/London (GMT)" },
  { value: "Europe/Berlin", label: "Europe/Berlin (CET)" },
  { value: "Europe/Paris", label: "Europe/Paris (CET)" },
  { value: "America/New_York", label: "America/New_York (EST)" },
  { value: "America/Chicago", label: "America/Chicago (CST)" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles (PST)" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo (JST)" },
  { value: "Asia/Dubai", label: "Asia/Dubai (GST)" },
  { value: "UTC", label: "UTC" },
];

const WEEKDAYS = [
  { value: "1", label: "Mon" },
  { value: "2", label: "Tue" },
  { value: "3", label: "Wed" },
  { value: "4", label: "Thu" },
  { value: "5", label: "Fri" },
  { value: "6", label: "Sat" },
  { value: "0", label: "Sun" },
];

const defaultForm: AgendaEventFormData = {
  title: "",
  freePrompt: "",
  agentId: "",
  processVersionIds: [],
  status: "draft",
  startDate: "",
  startTime: "10:00",
  endDate: "",
  endTime: "",
  timezone: "Europe/Amsterdam",
  recurrence: "none",
  weekdays: [],
  recurrenceUntil: "",
  taskType: "one_time",
  modelOverride: "",
  startDateMode: "now",
  endDateMode: "forever",
  frequency: "daily",
};

function parseRecurrence(recurrenceRule: string | null): { type: RecurrenceType; weekdays: string[] } {
  if (!recurrenceRule || recurrenceRule === "none") return { type: "none", weekdays: [] };
  const bydayMatch = recurrenceRule.match(/BYDAY=([^;]+)/);
  if (bydayMatch) {
    const dayMap: Record<string, string> = { SU: "0", MO: "1", TU: "2", WE: "3", TH: "4", FR: "5", SA: "6" };
    const days = bydayMatch[1].split(",").map((d) => dayMap[d] ?? d);
    return { type: "weekly", weekdays: days };
  }
  if (recurrenceRule.includes("FREQ=DAILY")) return { type: "daily", weekdays: [] };
  if (recurrenceRule.includes("FREQ=WEEKLY")) return { type: "weekly", weekdays: [] };
  if (recurrenceRule.includes("FREQ=MONTHLY")) return { type: "monthly", weekdays: [] };
  return { type: "none", weekdays: [] };
}

function buildInitialForm(data: Partial<AgendaEventFormData>): AgendaEventFormData {
  const validTypes: RecurrenceType[] = ["none", "daily", "weekly", "monthly"];
  const isValidType = validTypes.includes(data.recurrence as RecurrenceType);

  const parsed = isValidType
    ? { type: data.recurrence as RecurrenceType, weekdays: data.weekdays ?? [] }
    : parseRecurrence(data.recurrence as unknown as string | null);

  // Derive taskType and frequency from recurrence
  let taskType: TaskType = data.taskType ?? "one_time";
  let frequency: Frequency = data.frequency ?? "daily";
  if (!data.taskType) {
    if (parsed.type === "daily" || parsed.type === "weekly") {
      taskType = "repeatable";
      frequency = parsed.type;
    } else {
      taskType = "one_time";
    }
  }

  // Derive startDateMode / endDateMode
  const startDateMode: StartDateMode = data.startDateMode ?? (data.startDate ? "specific" : "now");
  const endDateMode: EndDateMode = data.endDateMode ?? (data.endDate ? "specific" : "forever");

  return {
    ...defaultForm,
    ...data,
    recurrence: parsed.type,
    weekdays: parsed.weekdays,
    recurrenceUntil: data.recurrenceUntil ?? "",
    taskType,
    frequency,
    modelOverride: data.modelOverride ?? "",
    startDateMode,
    endDateMode,
  };
}

export function AgendaEventModal({ open, agents = EMPTY_AGENTS, processes = EMPTY_PROCESSES, initialData, onClose, onSave }: Props) {
  const isEditing = !!initialData?.title;
  const [form, setForm] = useState<AgendaEventFormData>(initialData ? buildInitialForm(initialData) : defaultForm);
  const [error, setError] = useState("");

  const initialDataRef = useRef(initialData);
  useEffect(() => {
    if (open) {
      initialDataRef.current = initialData;
    }
  }, [open, initialData]);

  useEffect(() => {
    if (open) {
      const data = initialDataRef.current;
      setForm(data ? buildInitialForm(data) : defaultForm);
      setError("");
    }
  }, [open]);

  const updateField = <K extends keyof AgendaEventFormData>(key: K, value: AgendaEventFormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError("");
  };

  const toggleWeekday = (day: string) => {
    const current = form.weekdays;
    updateField(
      "weekdays",
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort()
    );
  };

  const removeProcess = (pid: string) => {
    updateField("processVersionIds", form.processVersionIds.filter((id) => id !== pid));
  };

  const handleSave = () => {
    if (!form.title.trim()) { setError("Title is required"); return; }
    if (form.taskType === "one_time" && !form.startDate) { setError("Date is required for one-time events"); return; }
    if (form.startDateMode === "specific" && !form.startDate) { setError("Start date is required"); return; }
    if (!form.freePrompt.trim() && form.processVersionIds.length === 0) {
      setError("A free prompt or at least one process is required");
      return;
    }

    // Derive recurrence from taskType + frequency
    let derivedRecurrence: RecurrenceType = "none";
    if (form.taskType === "repeatable") {
      derivedRecurrence = form.frequency;
    }

    const saveData: AgendaEventFormData = {
      ...form,
      recurrence: derivedRecurrence,
      // Clear dates based on modes
      startDate: form.startDateMode === "now" && form.taskType === "repeatable" ? "" : form.startDate,
      endDate: form.endDateMode === "forever" ? "" : form.endDate,
    };

    onSave(saveData);
    setForm(defaultForm);
    setError("");
  };

  const handleClose = () => {
    setForm(defaultForm);
    setError("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleClose(); }}>
      <DialogContent className="sm:max-w-[600px] max-h-[92vh] overflow-y-auto p-0">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-0">
          <div className="flex items-center gap-3 mb-1">
            <div className={[
              "flex items-center justify-center size-9 rounded-lg shrink-0",
              isEditing ? "bg-primary/10" : "bg-primary",
            ].join(" ")}>
              <IconCalendarPlus className={[
                "size-4.5",
                isEditing ? "text-primary" : "text-primary-foreground",
              ].join(" ")} />
            </div>
            <div>
              <DialogTitle className="text-lg">
                {isEditing ? "Edit event" : "New agenda event"}
              </DialogTitle>
              <DialogDescription className="text-xs mt-0.5">
                {isEditing
                  ? "Update the event. For recurring events you'll choose how to apply changes."
                  : "Schedule a free prompt, a process, or both to run automatically."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-5 px-6 py-5">
          {/* Title */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="ae-title" className="text-xs font-semibold text-foreground/80">
              Title <span className="text-destructive ml-0.5">*</span>
            </Label>
            <Input
              id="ae-title"
              placeholder="e.g. Morning briefing"
              value={form.title}
              onChange={(e) => updateField("title", e.target.value)}
              className="h-10"
              autoFocus
            />
          </div>

          {/* Free prompt */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="ae-prompt" className="text-xs font-semibold text-foreground/80 flex items-center gap-1.5">
              <IconMicrophone className="size-3.5 text-primary" />
              Free prompt
            </Label>
            <Textarea
              id="ae-prompt"
              placeholder="Give the agent a free-text instruction..."
              value={form.freePrompt}
              onChange={(e) => updateField("freePrompt", e.target.value)}
              rows={3}
              className="resize-none"
            />
            <p className="text-[11px] text-muted-foreground/70">
              A natural-language instruction. Can stand alone or run alongside attached processes.
            </p>
          </div>

          {/* Attached processes (moved up) */}
          <div className="flex flex-col gap-2">
            <Label className="text-xs font-semibold text-foreground/80 flex items-center gap-1.5">
              <svg className="size-3.5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h10M4 18h6" />
              </svg>
              Attached processes
            </Label>

            {form.processVersionIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {form.processVersionIds.map((pid) => {
                  const proc = processes.find((p) => p.id === pid);
                  return (
                    <Badge
                      key={pid}
                      variant="secondary"
                      className="gap-1.5 pl-2.5 pr-1.5 py-1 text-xs font-semibold"
                    >
                      {proc ? `${proc.name}${proc.version_number ? ` v${proc.version_number}` : ""}` : pid}
                      <button
                        type="button"
                        onClick={() => removeProcess(pid)}
                        className="ml-0.5 cursor-pointer hover:text-destructive rounded-sm transition-colors"
                      >
                        <IconX className="size-3" />
                      </button>
                    </Badge>
                  );
                })}
              </div>
            )}

            <Select
              onValueChange={(v) => {
                if (v && !form.processVersionIds.includes(v)) {
                  updateField("processVersionIds", [...form.processVersionIds, v]);
                }
              }}
            >
              <SelectTrigger className="h-10 w-full cursor-pointer">
                <SelectValue placeholder="Attach a process..." />
              </SelectTrigger>
              <SelectContent>
                {processes.filter((p) => !form.processVersionIds.includes(p.id)).length === 0 ? (
                  <SelectItem value="__empty__" disabled>
                    {processes.length === 0 ? "No processes available" : "All processes attached"}
                  </SelectItem>
                ) : (
                  processes
                    .filter((p) => !form.processVersionIds.includes(p.id))
                    .map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}{p.version_number ? ` (v${p.version_number})` : ""}
                      </SelectItem>
                    ))
                )}
              </SelectContent>
            </Select>
          </div>

          <Separator />

          {/* Agent + Model override row */}
          <div className={`grid gap-4 ${form.agentId ? "grid-cols-2" : "grid-cols-1"}`}>
            <div className="flex flex-col gap-2">
              <Label className="text-xs font-semibold text-foreground/80 flex items-center gap-1.5">
                <IconRobot className="size-3.5 text-primary" />
                Agent
              </Label>
              <Select value={form.agentId || "__none__"} onValueChange={(v) => {
                updateField("agentId", v === "__none__" ? "" : v);
                if (v === "__none__") updateField("modelOverride", "");
              }}>
                <SelectTrigger className="h-10 cursor-pointer">
                  <SelectValue placeholder="System default" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">System default</SelectItem>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name || a.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {form.agentId && (
              <div className="flex flex-col gap-2">
                <Label className="text-xs font-semibold text-foreground/80">Model override</Label>
                <Select
                  value={form.modelOverride || "__default__"}
                  onValueChange={(v) => updateField("modelOverride", v === "__default__" ? "" : v)}
                >
                  <SelectTrigger className="h-10 cursor-pointer">
                    <SelectValue placeholder="Agent default" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">Agent default</SelectItem>
                    {MODELS.map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.alias}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Status dropdown */}
          <div className="flex flex-col gap-2">
            <Label className="text-xs font-semibold text-foreground/80">Status</Label>
            <Select value={form.status} onValueChange={(v) => updateField("status", v as "draft" | "active")}>
              <SelectTrigger className="h-10 cursor-pointer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="active">Active</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          {/* Schedule section */}
          <div className="flex flex-col gap-4">
            <Label className="text-xs font-semibold text-foreground/80 flex items-center gap-1.5">
              <IconCalendarTime className="size-3.5 text-primary" />
              Schedule
            </Label>

            {/* Task type toggle */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-[11px] text-muted-foreground font-medium">Task type</Label>
              <div className="flex gap-1.5 h-10">
                {(["one_time", "repeatable"] as const).map((t) => (
                  <Button
                    key={t}
                    size="sm"
                    variant={form.taskType === t ? "default" : "outline"}
                    onClick={() => updateField("taskType", t)}
                    className="flex-1 h-9 cursor-pointer"
                  >
                    {t === "one_time" ? "One-time" : "Repeatable"}
                  </Button>
                ))}
              </div>
            </div>

            {/* One-time: date + time */}
            {form.taskType === "one_time" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ae-ot-date" className="text-[11px] text-muted-foreground font-medium">
                    Date <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="ae-ot-date"
                    type="date"
                    value={form.startDate}
                    onChange={(e) => updateField("startDate", e.target.value)}
                    className="h-10"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ae-ot-time" className="text-[11px] text-muted-foreground font-medium">
                    Time
                  </Label>
                  <Input
                    id="ae-ot-time"
                    type="time"
                    value={form.startTime}
                    onChange={(e) => updateField("startTime", e.target.value)}
                    className="h-10"
                  />
                </div>
              </div>
            )}

            {/* Repeatable: frequency + type-specific fields */}
            {form.taskType === "repeatable" && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label className="text-[11px] text-muted-foreground font-medium">Frequency</Label>
                  <Select value={form.frequency} onValueChange={(v) => updateField("frequency", v as Frequency)}>
                    <SelectTrigger className="h-10 cursor-pointer">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Weekly: weekday toggle */}
                {form.frequency === "weekly" && (
                  <div className="flex gap-1.5 flex-wrap">
                    {WEEKDAYS.map((day) => (
                      <Button
                        key={day.value}
                        size="sm"
                        variant={form.weekdays.includes(day.value) ? "default" : "outline"}
                        onClick={() => toggleWeekday(day.value)}
                        className="h-8 w-11 text-xs font-semibold cursor-pointer"
                      >
                        {day.label}
                      </Button>
                    ))}
                  </div>
                )}

                {/* Time picker */}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ae-rep-time" className="text-[11px] text-muted-foreground font-medium">
                    Time
                  </Label>
                  <Input
                    id="ae-rep-time"
                    type="time"
                    value={form.startTime}
                    onChange={(e) => updateField("startTime", e.target.value)}
                    className="h-10"
                  />
                </div>
              </div>
            )}

            {/* Start date mode */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-[11px] text-muted-foreground font-medium">Start date</Label>
              <div className="flex gap-1.5 h-10">
                {(["now", "specific"] as const).map((m) => (
                  <Button
                    key={m}
                    size="sm"
                    variant={form.startDateMode === m ? "default" : "outline"}
                    onClick={() => updateField("startDateMode", m)}
                    className="flex-1 h-9 cursor-pointer"
                  >
                    {m === "now" ? "Now" : "Specific date"}
                  </Button>
                ))}
              </div>
              {form.startDateMode === "specific" && (
                <Input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => updateField("startDate", e.target.value)}
                  className="h-10 mt-1.5"
                />
              )}
            </div>

            {/* End date mode */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-[11px] text-muted-foreground font-medium">End date</Label>
              <div className="flex gap-1.5 h-10">
                {(["forever", "specific"] as const).map((m) => (
                  <Button
                    key={m}
                    size="sm"
                    variant={form.endDateMode === m ? "default" : "outline"}
                    onClick={() => updateField("endDateMode", m)}
                    className="flex-1 h-9 cursor-pointer"
                  >
                    {m === "forever" ? "Forever" : "Specific date"}
                  </Button>
                ))}
              </div>
              {form.endDateMode === "specific" && (
                <Input
                  type="date"
                  value={form.endDate}
                  onChange={(e) => updateField("endDate", e.target.value)}
                  className="h-10 mt-1.5"
                />
              )}
            </div>

            {/* Timezone */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ae-tz" className="text-[11px] text-muted-foreground font-medium">
                Timezone
              </Label>
              <Select value={form.timezone} onValueChange={(v) => updateField("timezone", v)}>
                <SelectTrigger id="ae-tz" className="h-10 cursor-pointer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((tz) => (
                    <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-xs text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="px-6 pb-6 pt-0 gap-2">
          <Button variant="ghost" onClick={handleClose} className="cursor-pointer">
            Cancel
          </Button>
          <Button onClick={handleSave} className="gap-1.5 cursor-pointer">
            <IconCalendarPlus className="size-3.5" />
            {isEditing ? "Save changes" : "Create event"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
