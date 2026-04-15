# Ticket Checklist Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the checklist "Add item" input being untyped in create mode, support multiple named checklists per ticket (Trello-style), and give each checklist a name.

**Architecture:** Add `checklist_name` column to `ticket_subtasks` (default `'Checklist'`); group subtasks by name in the UI; move draft state inside the modal so both create and edit mode work correctly; pass draft subtasks from create mode to `handleCreateTicket` for DB insertion after ticket creation.

**Tech Stack:** Next.js 14 App Router, TypeScript, React, Postgres (via `postgres` npm package), Tailwind CSS, shadcn/ui, Sonner (toasts)

---

## File Map

| File | Change |
|------|--------|
| `db/schema.sql` | Add `checklist_name` column to `ticket_subtasks` |
| `app/api/tasks/route.ts` | Boot migration + update subtask CRUD + add `renameChecklistItems` / `deleteChecklistItems` actions |
| `lib/db/index.ts` | Update `TicketSubtaskRow` type, map `checklist_name → checklistName` |
| `lib/db/adapter.ts` | Update `TicketSubtaskRecord`, `CreateTicketSubtaskPayload`, `UpdateTicketSubtaskPatch`; add adapter methods |
| `types/tasks.ts` | Add `checklistName` to `TicketSubtask` |
| `hooks/use-tasks.ts` | Replace `subtaskDraft`/`setSubtaskDraft` with per-checklist state; update `addDetailsSubtask`; add `renameDetailsChecklist`, `deleteDetailsChecklist`; update `handleCreateTicket` |
| `components/tasks/modals/ticket-details-modal.tsx` | New multi-checklist UI with per-checklist drafts, progress bars, name editing, add/delete checklist |
| `components/tasks/boards/boards-page-client.tsx` | Wire new modal props for both create and edit mode |

---

### Task 1: DB schema — add `checklist_name` column

**Files:**
- Modify: `db/schema.sql`
- Modify: `app/api/tasks/route.ts` (add boot migration near top of POST handler)

- [ ] **Step 1: Update `db/schema.sql`**

Find the `ticket_subtasks` table definition (around line 121) and add the new column before the closing paren:

```sql
create table if not exists ticket_subtasks (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets(id) on delete cascade,
  title text not null,
  completed boolean not null default false,
  position integer not null default 0,
  checklist_name text not null default 'Checklist',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

- [ ] **Step 2: Add boot migration to the API route**

In `app/api/tasks/route.ts`, find the `export async function POST(req: Request)` handler. Add an idempotent `ALTER TABLE` immediately after the `getSql()` call and before the `action` checks:

```typescript
export async function POST(req: Request) {
  const sql = getSql();
  // Boot migration: add checklist_name if not present
  await sql`ALTER TABLE ticket_subtasks ADD COLUMN IF NOT EXISTS checklist_name text NOT NULL DEFAULT 'Checklist'`;

  const body = (await req.json()) as Json;
  const action = String(body.action || "");
  // ... rest unchanged
```

- [ ] **Step 3: Update `createSubtask` action to persist `checklistName`**

Find the `action === "createSubtask"` block (around line 465) and update it:

```typescript
if (action === "createSubtask") {
  const ticketId = String(body.ticketId || "");
  const title = String(body.title || "").trim();
  const checklistName = String(body.checklistName || "Checklist").trim() || "Checklist";
  if (!ticketId || !title) return fail("Ticket and title are required.");
  const posRows = await sql`select coalesce(max(position), -1) + 1 as pos from ticket_subtasks where ticket_id=${ticketId} and checklist_name=${checklistName}`;
  const rows = await sql`insert into ticket_subtasks (ticket_id, title, position, checklist_name) values (${ticketId}, ${title}, ${Number(posRows[0]?.pos ?? 0)}, ${checklistName}) returning *`;
  return ok({ subtask: rows[0] });
}
```

- [ ] **Step 4: Update `updateSubtask` to support renaming item's checklist**

```typescript
if (action === "updateSubtask") {
  const subtaskId = String(body.subtaskId || "");
  const checklistName = body.checklistName != null ? String(body.checklistName).trim() || null : null;
  const rows = await sql`update ticket_subtasks set title=coalesce(${body.title || null}, title), completed=coalesce(${body.completed ?? null}, completed), checklist_name=coalesce(${checklistName}, checklist_name), updated_at=now() where id=${subtaskId} returning *`;
  return ok({ subtask: rows[0] });
}
```

- [ ] **Step 5: Add `renameChecklistItems` action (bulk rename)**

After the `deleteSubtask` block, add:

```typescript
if (action === "renameChecklistItems") {
  const ticketId = String(body.ticketId || "");
  const oldName = String(body.oldName || "").trim();
  const newName = String(body.newName || "").trim();
  if (!ticketId || !oldName || !newName) return fail("ticketId, oldName, and newName are required.");
  await sql`update ticket_subtasks set checklist_name=${newName}, updated_at=now() where ticket_id=${ticketId} and checklist_name=${oldName}`;
  return ok();
}
```

- [ ] **Step 6: Add `deleteChecklistItems` action (delete whole checklist)**

```typescript
if (action === "deleteChecklistItems") {
  const ticketId = String(body.ticketId || "");
  const checklistName = String(body.checklistName || "").trim();
  if (!ticketId || !checklistName) return fail("ticketId and checklistName are required.");
  await sql`delete from ticket_subtasks where ticket_id=${ticketId} and checklist_name=${checklistName}`;
  return ok();
}
```

- [ ] **Step 7: Commit**

```bash
git add db/schema.sql app/api/tasks/route.ts
git commit -m "feat: add checklist_name column to ticket_subtasks with boot migration"
```

---

### Task 2: Update DB types and adapter

**Files:**
- Modify: `lib/db/index.ts` (lines 81–89 `TicketSubtaskRow`, and lines 312–338 mapping functions)
- Modify: `lib/db/adapter.ts` (lines 163–180 type definitions; add two new adapter methods)

- [ ] **Step 1: Update `TicketSubtaskRow` in `lib/db/index.ts`**

Find `type TicketSubtaskRow` (line 81) and add the new field:

```typescript
type TicketSubtaskRow = {
  id: string;
  ticket_id: string;
  title: string;
  completed?: boolean | null;
  position: number;
  checklist_name: string;
  created_at: string;
  updated_at: string;
};
```

- [ ] **Step 2: Update `listTicketSubtasks` mapping in `lib/db/index.ts`**

Find the `listTicketSubtasks` function (around line 312) and add `checklistName` to the mapping:

```typescript
async listTicketSubtasks(ticketId: string) {
  const data = await post("listTicketSubtasks", { ticketId });
  const rows = Array.isArray(data.rows) ? (data.rows as TicketSubtaskRow[]) : [];
  return rows.map((row) => ({
    id: row.id,
    ticketId: row.ticket_id,
    title: row.title,
    completed: Boolean(row.completed),
    position: row.position,
    checklistName: row.checklist_name ?? "Checklist",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })) as TicketSubtaskRecord[];
},
```

- [ ] **Step 3: Update `createTicketSubtask` mapping in `lib/db/index.ts`**

```typescript
async createTicketSubtask(ticketId: string, payload: CreateTicketSubtaskPayload) {
  const data = await post("createSubtask", { ticketId, ...payload });
  const row = data.subtask;
  return {
    id: row.id,
    ticketId: row.ticket_id,
    title: row.title,
    completed: Boolean(row.completed),
    position: row.position,
    checklistName: row.checklist_name ?? "Checklist",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } as TicketSubtaskRecord;
},
```

- [ ] **Step 4: Update `updateTicketSubtask` mapping in `lib/db/index.ts`**

```typescript
async updateTicketSubtask(subtaskId: string, patch: UpdateTicketSubtaskPatch) {
  const data = await post("updateSubtask", { subtaskId, ...patch });
  const row = data.subtask;
  return {
    id: row.id,
    ticketId: row.ticket_id,
    title: row.title,
    completed: Boolean(row.completed),
    position: row.position,
    checklistName: row.checklist_name ?? "Checklist",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } as TicketSubtaskRecord;
},
```

- [ ] **Step 5: Add `renameTicketChecklist` and `deleteTicketChecklist` to `lib/db/index.ts`**

After `deleteTicketSubtask`, add:

```typescript
async renameTicketChecklist(ticketId: string, oldName: string, newName: string) {
  await post("renameChecklistItems", { ticketId, oldName, newName });
},

async deleteTicketChecklist(ticketId: string, checklistName: string) {
  await post("deleteChecklistItems", { ticketId, checklistName });
},
```

- [ ] **Step 6: Update types in `lib/db/adapter.ts`**

Replace the `TicketSubtaskRecord`, `CreateTicketSubtaskPayload`, and `UpdateTicketSubtaskPatch` definitions:

```typescript
export type TicketSubtaskRecord = {
  id: string;
  ticketId: string;
  title: string;
  completed: boolean;
  position: number;
  checklistName: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateTicketSubtaskPayload = {
  title: string;
  checklistName?: string;
};

export type UpdateTicketSubtaskPatch = {
  title?: string;
  completed?: boolean;
  checklistName?: string;
};
```

- [ ] **Step 7: Add new method signatures to the adapter interface in `lib/db/adapter.ts`**

Find the interface where `listTicketSubtasks`, `createTicketSubtask`, etc. are declared (around line 235) and add:

```typescript
renameTicketChecklist(ticketId: string, oldName: string, newName: string): Promise<void>;
deleteTicketChecklist(ticketId: string, checklistName: string): Promise<void>;
```

- [ ] **Step 8: Commit**

```bash
git add lib/db/index.ts lib/db/adapter.ts
git commit -m "feat: add checklistName to subtask types and adapter"
```

---

### Task 3: Update `TicketSubtask` domain type

**Files:**
- Modify: `types/tasks.ts` (line 77)

- [ ] **Step 1: Add `checklistName` to `TicketSubtask`**

```typescript
export type TicketSubtask = {
  id: string;
  ticketId: string;
  title: string;
  completed: boolean;
  position: number;
  checklistName: string;
  createdAt: string;
  updatedAt: string;
};
```

- [ ] **Step 2: Commit**

```bash
git add types/tasks.ts
git commit -m "feat: add checklistName to TicketSubtask domain type"
```

---

### Task 4: Update `use-tasks.ts` hook

**Files:**
- Modify: `hooks/use-tasks.ts`

The hook currently has:
- `subtaskDraft: string` / `setSubtaskDraft`
- `addDetailsSubtask()` — reads `subtaskDraft` implicitly
- `handleCreateTicket(files)` — no subtask support

We need:
- `subtaskDraftsByChecklist: Record<string, string>` / `setSubtaskDraftForChecklist(name, value)`
- `addDetailsSubtask(checklistName: string)`
- `renameDetailsChecklist(oldName: string, newName: string)`
- `deleteDetailsChecklist(checklistName: string)`
- `handleCreateTicket(files, draftSubtasks)` — create subtasks after ticket creation

- [ ] **Step 1: Update `toTicketSubtask` converter (line 282)**

```typescript
const toTicketSubtask = (row: TicketSubtaskRecord): TicketSubtask => ({
  id: row.id,
  ticketId: row.ticketId,
  title: row.title,
  completed: row.completed,
  position: row.position,
  checklistName: row.checklistName,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});
```

- [ ] **Step 2: Replace `subtaskDraft` state with `subtaskDraftsByChecklist` (line 393)**

Replace:
```typescript
const [subtaskDraft, setSubtaskDraft] = useState("");
```
With:
```typescript
const [subtaskDraftsByChecklist, setSubtaskDraftsByChecklist] = useState<Record<string, string>>({});
const setSubtaskDraftForChecklist = useCallback((checklistName: string, value: string) => {
  setSubtaskDraftsByChecklist((prev) => ({ ...prev, [checklistName]: value }));
}, []);
```

- [ ] **Step 3: Update `addDetailsSubtask` to accept `checklistName` parameter (line 875)**

Replace the entire function:

```typescript
const addDetailsSubtask = async (checklistName: string) => {
  const ticketId = detailsForm?.id;
  const title = (subtaskDraftsByChecklist[checklistName] ?? "").trim();
  if (!ticketId || !title) return;

  setSubtaskDraftsByChecklist((prev) => ({ ...prev, [checklistName]: "" }));
  try {
    const created = await adapter.createTicketSubtask(ticketId, { title, checklistName });
    setSubtasksByTicketId((prev) => {
      const next = [...(prev[ticketId] ?? []), toTicketSubtask(created)].sort(
        (a, b) => a.position - b.position,
      );
      setTicketChecklistCounts(
        ticketId,
        next.filter((item) => item.completed).length,
        next.length,
      );
      return { ...prev, [ticketId]: next };
    });
    toast.success("Task added");
    await createTicketActivity(ticketId, "Task added", `Added subtask "${title}".`, "success");
  } catch (error) {
    setSubtaskDraftsByChecklist((prev) => ({ ...prev, [checklistName]: title }));
    const message = error instanceof Error ? error.message : "Failed to add task.";
    toast.error(message);
  }
};
```

- [ ] **Step 4: Add `renameDetailsChecklist` function (add after `deleteDetailsSubtask`)**

```typescript
const renameDetailsChecklist = async (oldName: string, newName: string) => {
  const ticketId = detailsForm?.id;
  if (!ticketId || !oldName || !newName || oldName === newName) return;

  // Optimistic update
  setSubtasksByTicketId((prev) => {
    const next = (prev[ticketId] ?? []).map((item) =>
      item.checklistName === oldName ? { ...item, checklistName: newName } : item,
    );
    return { ...prev, [ticketId]: next };
  });
  // Also update the draft key if present
  setSubtaskDraftsByChecklist((prev) => {
    if (!(oldName in prev)) return prev;
    const { [oldName]: draft, ...rest } = prev;
    return { ...rest, [newName]: draft };
  });

  try {
    await adapter.renameTicketChecklist(ticketId, oldName, newName);
  } catch (error) {
    // Rollback
    setSubtasksByTicketId((prev) => {
      const next = (prev[ticketId] ?? []).map((item) =>
        item.checklistName === newName ? { ...item, checklistName: oldName } : item,
      );
      return { ...prev, [ticketId]: next };
    });
    const message = error instanceof Error ? error.message : "Failed to rename checklist.";
    toast.error(message);
  }
};
```

- [ ] **Step 5: Add `deleteDetailsChecklist` function**

```typescript
const deleteDetailsChecklist = async (checklistName: string) => {
  const ticketId = detailsForm?.id;
  if (!ticketId) return;

  let previous: TicketSubtask[] = [];
  setSubtasksByTicketId((prev) => {
    previous = prev[ticketId] ?? [];
    const next = previous.filter((item) => item.checklistName !== checklistName);
    setTicketChecklistCounts(
      ticketId,
      next.filter((item) => item.completed).length,
      next.length,
    );
    return { ...prev, [ticketId]: next };
  });
  setSubtaskDraftsByChecklist((prev) => {
    const { [checklistName]: _removed, ...rest } = prev;
    return rest;
  });

  try {
    await adapter.deleteTicketChecklist(ticketId, checklistName);
    toast.success("Checklist removed");
    await createTicketActivity(ticketId, "Checklist removed", `Removed checklist "${checklistName}".`, "warning");
  } catch (error) {
    setSubtasksByTicketId((prev) => ({ ...prev, [ticketId]: previous }));
    setTicketChecklistCounts(
      ticketId,
      previous.filter((item) => item.completed).length,
      previous.length,
    );
    const message = error instanceof Error ? error.message : "Failed to delete checklist.";
    toast.error(message);
  }
};
```

- [ ] **Step 6: Update `handleCreateTicket` signature and body to accept `draftSubtasks`**

Change the function signature from:
```typescript
const handleCreateTicket = async (files: File[] = []) => {
```
to:
```typescript
const handleCreateTicket = async (
  files: File[] = [],
  draftSubtasks: { checklistName: string; title: string }[] = [],
) => {
```

Then after the `await createTicketActivity(created.id, ...)` call (around line 1570), add subtask creation:

```typescript
      await createTicketActivity(created.id, "Ticket created", detailParts.join(" "), "success");

      // Create any draft subtasks from create mode
      if (draftSubtasks.length > 0) {
        const createdSubtasks: TicketSubtask[] = [];
        for (const ds of draftSubtasks) {
          try {
            const sub = await adapter.createTicketSubtask(created.id, {
              title: ds.title,
              checklistName: ds.checklistName,
            });
            createdSubtasks.push(toTicketSubtask(sub));
          } catch {
            // non-fatal; ticket was created, subtask can be added manually
          }
        }
        if (createdSubtasks.length > 0) {
          setSubtasksByTicketId((prev) => ({
            ...prev,
            [created.id]: createdSubtasks,
          }));
          updateActiveBoard((prev) => {
            const ticket = prev.tickets[created.id];
            if (!ticket) return prev;
            return {
              ...prev,
              tickets: {
                ...prev.tickets,
                [created.id]: {
                  ...ticket,
                  checklistTotal: createdSubtasks.length,
                  checklistDone: createdSubtasks.filter((s) => s.completed).length,
                },
              },
            };
          });
        }
      }
```

- [ ] **Step 7: Update the hook's returned object to expose the new functions**

Find the return object (around line 2234) and make these changes:
- Remove `subtaskDraft` and `setSubtaskDraft`
- Add `subtaskDraftsByChecklist`, `setSubtaskDraftForChecklist`, `renameDetailsChecklist`, `deleteDetailsChecklist`

```typescript
    subtaskDraftsByChecklist,
    setSubtaskDraftForChecklist,
    // (remove subtaskDraft, setSubtaskDraft)
    ...
    addDetailsSubtask,
    renameDetailsChecklist,
    deleteDetailsChecklist,
```

- [ ] **Step 8: Commit**

```bash
git add hooks/use-tasks.ts
git commit -m "feat: update use-tasks hook for multi-checklist support"
```

---

### Task 5: Redesign the modal checklist UI

**Files:**
- Modify: `components/tasks/modals/ticket-details-modal.tsx`

This is the largest change. The checklist section needs to:
1. Show checklists grouped by name with editable titles
2. Show a progress bar per checklist
3. Have a per-checklist item draft input
4. Have a delete button per checklist
5. Have an "+ Add checklist" button at the bottom
6. Work in both create mode (local state) and edit mode (DB-backed via props)

- [ ] **Step 1: Update the `Props` type — remove old subtask draft props, add new callbacks**

Replace the subtask-related props in the `Props` type:

```typescript
type Props = {
  mode?: "create" | "edit";
  open: boolean;
  form: TicketDetailsForm;
  board: BoardState;
  attachments: TicketAttachment[];
  attachmentsLoading: boolean;
  attachmentsUploading: boolean;
  subtasks: TicketSubtask[];
  subtasksLoading: boolean;
  // REMOVED: subtaskDraft, onSubtaskDraftChange
  onAddSubtask: (title: string, checklistName: string) => void;
  onToggleSubtask: (subtaskId: string, completed: boolean) => void;
  onDeleteSubtask: (subtaskId: string) => void;
  onRenameChecklist: (oldName: string, newName: string) => void;
  onDeleteChecklist: (checklistName: string) => void;
  comments: TicketComment[];
  commentsLoading: boolean;
  commentDraft: string;
  onCommentDraftChange: (value: string) => void;
  onAddComment: () => void;
  onDeleteComment: (commentId: string) => void;
  activity: TicketActivity[];
  activityLoading: boolean;
  onChange: (patch: Partial<TicketDetailsForm>) => void;
  onUploadAttachments: (files: FileList | File[] | null) => void;
  onDeleteAttachment: (attachmentId: string) => void;
  onSave: (files?: File[], draftSubtasks?: { checklistName: string; title: string }[]) => void;
  onCopy: () => void;
  onDelete: () => void;
  onClose: () => void;
};
```

- [ ] **Step 2: Add local state for checklist management inside the component**

In the `TicketDetailsModal` component body, add:

```typescript
  // Local checklist state (used in both create and edit mode)
  // In create mode: the source of truth
  // In edit mode: drafts only (items come from `subtasks` prop)
  type LocalChecklistItem = { id: string; title: string; completed: boolean; checklistName: string };
  const [localItems, setLocalItems] = useState<LocalChecklistItem[]>([]);
  const [draftsByChecklist, setDraftsByChecklist] = useState<Record<string, string>>({});
  const [checklistNamesState, setChecklistNamesState] = useState<string[]>(["Checklist"]);
  const [editingChecklistName, setEditingChecklistName] = useState<string | null>(null);
  const [checklistNameDraft, setChecklistNameDraft] = useState("");
  const [newChecklistInput, setNewChecklistInput] = useState("");
  const [showAddChecklist, setShowAddChecklist] = useState(false);
```

- [ ] **Step 3: Derive the active checklist names**

After the local state declarations, derive `checklistNames` that combines names from `subtasks` prop and `checklistNamesState`:

```typescript
  // In edit mode: derive checklist names from subtasks prop + any locally added empty checklists
  // In create mode: all items are in localItems
  const activeItems: { id: string; title: string; completed: boolean; checklistName: string }[] =
    isEditing
      ? subtasks.map((s) => ({ id: s.id, title: s.title, completed: s.completed, checklistName: s.checklistName }))
      : localItems;

  // All unique checklist names, preserving order
  const checklistNames: string[] = isEditing
    ? Array.from(
        new Set([
          ...subtasks.map((s) => s.checklistName),
          ...checklistNamesState.filter((n) => !subtasks.some((s) => s.checklistName === n)),
        ]),
      )
    : checklistNamesState;
```

- [ ] **Step 4: Replace the entire checklist section in JSX (lines 258–293)**

Replace the existing `{/* Checklist (Subtasks) */}` section with the multi-checklist UI:

```tsx
              {/* Checklists */}
              <div className="flex flex-col gap-4">
                {checklistNames.map((clName) => {
                  const clItems = activeItems.filter((i) => i.checklistName === clName);
                  const done = clItems.filter((i) => i.completed).length;
                  const total = clItems.length;
                  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                  const draft = draftsByChecklist[clName] ?? "";
                  const isEditingName = editingChecklistName === clName;

                  return (
                    <div key={clName} className="flex flex-col gap-2">
                      {/* Checklist header */}
                      <div className="flex items-center gap-2">
                        <CheckSquareIcon className="size-3.5 text-muted-foreground shrink-0" />
                        {isEditingName ? (
                          <Input
                            autoFocus
                            value={checklistNameDraft}
                            onChange={(e) => setChecklistNameDraft(e.target.value)}
                            className="h-6 text-xs font-semibold flex-1 px-1"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                const newName = checklistNameDraft.trim();
                                if (newName && newName !== clName) {
                                  if (isEditing) {
                                    onRenameChecklist(clName, newName);
                                  } else {
                                    // rename in local state
                                    setLocalItems((prev) =>
                                      prev.map((item) =>
                                        item.checklistName === clName ? { ...item, checklistName: newName } : item,
                                      ),
                                    );
                                    setChecklistNamesState((prev) =>
                                      prev.map((n) => (n === clName ? newName : n)),
                                    );
                                    setDraftsByChecklist((prev) => {
                                      if (!(clName in prev)) return prev;
                                      const { [clName]: d, ...rest } = prev;
                                      return { ...rest, [newName]: d };
                                    });
                                  }
                                }
                                setEditingChecklistName(null);
                              }
                              if (e.key === "Escape") setEditingChecklistName(null);
                            }}
                            onBlur={() => {
                              const newName = checklistNameDraft.trim();
                              if (newName && newName !== clName) {
                                if (isEditing) {
                                  onRenameChecklist(clName, newName);
                                } else {
                                  setLocalItems((prev) =>
                                    prev.map((item) =>
                                      item.checklistName === clName ? { ...item, checklistName: newName } : item,
                                    ),
                                  );
                                  setChecklistNamesState((prev) =>
                                    prev.map((n) => (n === clName ? newName : n)),
                                  );
                                  setDraftsByChecklist((prev) => {
                                    if (!(clName in prev)) return prev;
                                    const { [clName]: d, ...rest } = prev;
                                    return { ...rest, [newName]: d };
                                  });
                                }
                              }
                              setEditingChecklistName(null);
                            }}
                          />
                        ) : (
                          <button
                            className="text-xs font-semibold text-foreground flex-1 text-left hover:text-primary transition-colors cursor-pointer"
                            onClick={() => {
                              setEditingChecklistName(clName);
                              setChecklistNameDraft(clName);
                            }}
                          >
                            {clName}
                          </button>
                        )}
                        <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">
                          {done}/{total}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="size-5 cursor-pointer shrink-0"
                          onClick={() => {
                            if (isEditing) {
                              onDeleteChecklist(clName);
                            } else {
                              setLocalItems((prev) => prev.filter((i) => i.checklistName !== clName));
                              setChecklistNamesState((prev) => prev.filter((n) => n !== clName));
                            }
                          }}
                        >
                          <XIcon className="size-3 text-muted-foreground" />
                        </Button>
                      </div>

                      {/* Progress bar */}
                      {total > 0 && (
                        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      )}

                      {/* Items */}
                      {clItems.length > 0 && (
                        <div className="rounded-lg border divide-y">
                          {clItems.map((item) => (
                            <div key={item.id} className="group flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors">
                              <Checkbox
                                checked={item.completed}
                                onCheckedChange={(c) => {
                                  if (isEditing) {
                                    onToggleSubtask(item.id, Boolean(c));
                                  } else {
                                    setLocalItems((prev) =>
                                      prev.map((i) => i.id === item.id ? { ...i, completed: Boolean(c) } : i),
                                    );
                                  }
                                }}
                              />
                              <span className={cn("flex-1 text-sm", item.completed && "line-through text-muted-foreground")}>
                                {item.title}
                              </span>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="size-6 cursor-pointer opacity-0 group-hover:opacity-100"
                                onClick={() => {
                                  if (isEditing) {
                                    onDeleteSubtask(item.id);
                                  } else {
                                    setLocalItems((prev) => prev.filter((i) => i.id !== item.id));
                                  }
                                }}
                              >
                                <XIcon className="size-3 text-muted-foreground" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Per-checklist add item */}
                      <div className="flex gap-2">
                        <Input
                          value={draft}
                          onChange={(e) => setDraftsByChecklist((prev) => ({ ...prev, [clName]: e.target.value }))}
                          placeholder="Add item..."
                          className="h-8 text-sm flex-1"
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && draft.trim()) {
                              e.preventDefault();
                              if (isEditing) {
                                onAddSubtask(draft.trim(), clName);
                                setDraftsByChecklist((prev) => ({ ...prev, [clName]: "" }));
                              } else {
                                setLocalItems((prev) => [
                                  ...prev,
                                  { id: `local-${Date.now()}-${Math.random()}`, title: draft.trim(), completed: false, checklistName: clName },
                                ]);
                                setDraftsByChecklist((prev) => ({ ...prev, [clName]: "" }));
                              }
                            }
                          }}
                        />
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-8 cursor-pointer"
                          onClick={() => {
                            if (!draft.trim()) return;
                            if (isEditing) {
                              onAddSubtask(draft.trim(), clName);
                              setDraftsByChecklist((prev) => ({ ...prev, [clName]: "" }));
                            } else {
                              setLocalItems((prev) => [
                                ...prev,
                                { id: `local-${Date.now()}-${Math.random()}`, title: draft.trim(), completed: false, checklistName: clName },
                              ]);
                              setDraftsByChecklist((prev) => ({ ...prev, [clName]: "" }));
                            }
                          }}
                        >
                          Add
                        </Button>
                      </div>
                    </div>
                  );
                })}

                {/* Add checklist */}
                {showAddChecklist ? (
                  <div className="flex gap-2">
                    <Input
                      autoFocus
                      value={newChecklistInput}
                      onChange={(e) => setNewChecklistInput(e.target.value)}
                      placeholder="Checklist name..."
                      className="h-8 text-sm flex-1"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const name = newChecklistInput.trim() || `Checklist ${checklistNames.length + 1}`;
                          if (!checklistNames.includes(name)) {
                            setChecklistNamesState((prev) => [...prev, name]);
                          }
                          setNewChecklistInput("");
                          setShowAddChecklist(false);
                        }
                        if (e.key === "Escape") {
                          setNewChecklistInput("");
                          setShowAddChecklist(false);
                        }
                      }}
                    />
                    <Button size="sm" variant="secondary" className="h-8 cursor-pointer"
                      onClick={() => {
                        const name = newChecklistInput.trim() || `Checklist ${checklistNames.length + 1}`;
                        if (!checklistNames.includes(name)) {
                          setChecklistNamesState((prev) => [...prev, name]);
                        }
                        setNewChecklistInput("");
                        setShowAddChecklist(false);
                      }}
                    >
                      Add
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 cursor-pointer"
                      onClick={() => { setNewChecklistInput(""); setShowAddChecklist(false); }}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs cursor-pointer self-start"
                    onClick={() => setShowAddChecklist(true)}
                  >
                    <PlusIcon className="size-3 mr-1" /> Add checklist
                  </Button>
                )}
              </div>
```

- [ ] **Step 5: Remove the sidebar progress bar section (it's now per-checklist inline)**

In the sidebar (right column), remove the checklist progress bar block:

```tsx
              {/* REMOVE this entire block (lines ~478-493):
              {isEditing && form.checklistTotal > 0 && (
                <div className="flex flex-col gap-1.5">
                  ...progress bar...
                </div>
              )}
              */}
```

- [ ] **Step 6: Update the Save button's `onClick` to pass `draftSubtasks` in create mode**

Find the Save/Create button (bottom `DialogFooter`) and update:

```tsx
            <Button onClick={() => {
              if (mode === "create") {
                onSave(createFiles, localItems.map((i) => ({ checklistName: i.checklistName, title: i.title })));
              } else {
                onSave();
              }
            }} className="gap-1.5 cursor-pointer">
              <ClipboardListIcon className="size-3.5" />
              {isEditing ? "Save" : "Create"}
            </Button>
```

- [ ] **Step 7: Commit**

```bash
git add components/tasks/modals/ticket-details-modal.tsx
git commit -m "feat: redesign checklist section to support multiple named checklists"
```

---

### Task 6: Wire the new modal props in `boards-page-client.tsx`

**Files:**
- Modify: `components/tasks/boards/boards-page-client.tsx`

- [ ] **Step 1: Update the create modal wiring (around line 749)**

Replace the current create modal `<TicketDetailsModal>` with:

```tsx
      <TicketDetailsModal
        mode="create"
        open={tasks.modal === "create"}
        form={createTicketForm}
        board={tasks.board}
        attachments={[]}
        attachmentsLoading={false}
        attachmentsUploading={false}
        subtasks={[]}
        subtasksLoading={false}
        onAddSubtask={() => {}}
        onToggleSubtask={() => {}}
        onDeleteSubtask={() => {}}
        onRenameChecklist={() => {}}
        onDeleteChecklist={() => {}}
        comments={[]}
        commentsLoading={false}
        commentDraft=""
        onCommentDraftChange={() => {}}
        onAddComment={() => {}}
        onDeleteComment={() => {}}
        activity={[]}
        activityLoading={false}
        onChange={(patch) =>
          tasks.setCreateForm((prev) => ({
            ...prev,
            title: patch.title ?? prev.title,
            description: patch.description ?? prev.description,
            statusId: patch.statusId ?? prev.statusId,
            priority: patch.priority ?? prev.priority,
            dueDate: patch.dueDate ?? prev.dueDate,
            scheduledFor: patch.scheduledFor ?? prev.scheduledFor,
            tagsText: patch.tagsText ?? prev.tagsText,
            assigneeIds: patch.assigneeIds ?? prev.assigneeIds,
          }))
        }
        onUploadAttachments={() => {}}
        onDeleteAttachment={() => {}}
        onSave={(files, draftSubtasks) => void tasks.handleCreateTicket(files ?? [], draftSubtasks ?? [])}
        onCopy={() => {}}
        onDelete={() => {}}
        onClose={tasks.closeCreateModal}
      />
```

- [ ] **Step 2: Update the edit modal wiring (around line 830)**

Replace the current edit modal `<TicketDetailsModal>` inside the `tasks.detailsForm &&` block:

```tsx
            <TicketDetailsModal
              open={tasks.modal === "details"}
              form={detailsForm}
              board={tasks.board}
              attachments={tasks.detailsAttachments}
              attachmentsLoading={tasks.detailsAttachmentsLoading}
              attachmentsUploading={tasks.detailsAttachmentsUploading}
              subtasks={tasks.detailsSubtasks}
              subtasksLoading={tasks.detailsSubtasksLoading}
              onAddSubtask={(title, checklistName) => void tasks.addDetailsSubtask(checklistName)}
              onToggleSubtask={(subtaskId, completed) =>
                void tasks.toggleDetailsSubtask(subtaskId, completed)
              }
              onDeleteSubtask={(subtaskId) => void tasks.deleteDetailsSubtask(subtaskId)}
              onRenameChecklist={(oldName, newName) => void tasks.renameDetailsChecklist(oldName, newName)}
              onDeleteChecklist={(name) => void tasks.deleteDetailsChecklist(name)}
              comments={tasks.detailsComments}
              commentsLoading={tasks.detailsCommentsLoading}
              commentDraft={tasks.commentDraft}
              onCommentDraftChange={tasks.setCommentDraft}
              onAddComment={() => void tasks.addDetailsComment()}
              onDeleteComment={(commentId) => void tasks.deleteDetailsComment(commentId)}
              activity={tasks.detailsActivity}
              activityLoading={tasks.detailsActivityLoading}
              onChange={(patch) =>
                tasks.setDetailsForm((prev) => (prev ? { ...prev, ...patch } : prev))
              }
              onUploadAttachments={(files) => void tasks.uploadDetailsAttachments(files)}
              onDeleteAttachment={(attachmentId) => void tasks.deleteDetailsAttachment(attachmentId)}
              onSave={() => tasks.handleSaveDetails()}
              onCopy={() => void tasks.handleCopyTicket(detailsForm.id)}
              onDelete={() => void tasks.handleDeleteTicket(detailsForm.id)}
              onClose={tasks.closeDetailsModal}
            />
```

Note: `onAddSubtask` receives `title` from the modal but the hook's `addDetailsSubtask(checklistName)` reads the draft internally — pass `checklistName` only. The `title` param in the callback is unused for edit mode (the hook reads `subtaskDraftsByChecklist[checklistName]`). But wait — in the new modal, we clear the draft and call `onAddSubtask(draft.trim(), clName)` passing the title directly. The hook needs to receive the title directly too. Let me update accordingly.

**Correction:** The `onAddSubtask` callback receives `title` from the modal. The hook's `addDetailsSubtask` should accept the title directly (not read from `subtaskDraftsByChecklist`) in edit mode. Update `addDetailsSubtask` in the hook to accept title as a parameter:

In `hooks/use-tasks.ts`, change the function signature to:
```typescript
const addDetailsSubtask = async (checklistName: string, title?: string) => {
  const ticketId = detailsForm?.id;
  const resolvedTitle = (title ?? subtaskDraftsByChecklist[checklistName] ?? "").trim();
  if (!ticketId || !resolvedTitle) return;
  // use resolvedTitle instead of title
```

And update the boards-page-client edit wiring:
```tsx
onAddSubtask={(title, checklistName) => void tasks.addDetailsSubtask(checklistName, title)}
```

- [ ] **Step 3: Commit**

```bash
git add components/tasks/boards/boards-page-client.tsx
git commit -m "feat: wire multi-checklist props in boards-page-client for create and edit mode"
```

---

### Task 7: TypeScript verification

**Files:** All modified files

- [ ] **Step 1: Run the TypeScript compiler**

```bash
cd c:/Users/Cem/Documents/mission-control && npx tsc --noEmit 2>&1 | head -60
```

Expected: no errors. If errors appear, fix them before proceeding.

Common issues to watch for:
- `subtaskDraft` still referenced somewhere → replace with `subtaskDraftsByChecklist`
- `setSubtaskDraft` still referenced → replace with `setSubtaskDraftForChecklist`
- `onSave` called with wrong arity → update call sites
- Missing `checklistName` in `TicketSubtask` usage

- [ ] **Step 2: Fix any type errors found**

- [ ] **Step 3: Commit fixes if any**

```bash
git add -p
git commit -m "fix: resolve TypeScript errors from checklist refactor"
```

---

### Task 8: Version bump

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update version from `3.4.0` to `3.4.1`**

In `package.json`, find `"version": "3.4.0"` and change to `"version": "3.4.1"`.

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "chore: bump version to 3.4.1"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Fix typing bug in create mode → Task 5 (modal manages own draft state) + Task 6 (create modal wired correctly)
- ✅ Multiple checklists → Tasks 1-6 throughout
- ✅ Named checklists → Task 1 (DB column), Task 5 (editable name in UI)
- ✅ Version bump to 3.4.1 → Task 8

**Placeholder scan:** None found. All code steps have complete implementations.

**Type consistency:**
- `checklistName: string` added consistently across `TicketSubtaskRow` → `TicketSubtaskRecord` → `TicketSubtask`
- `addDetailsSubtask(checklistName, title?)` matches call site in Task 6: `tasks.addDetailsSubtask(checklistName, title)`
- `onSave(files?, draftSubtasks?)` matches call site: `onSave(files ?? [], draftSubtasks ?? [])`
- `onRenameChecklist` / `onDeleteChecklist` added to Props and wired in both create (no-ops) and edit (hook functions)

**Note on Task 6 correction:** The `addDetailsSubtask` in the hook was originally updated to read from `subtaskDraftsByChecklist[checklistName]`. In Task 6, we corrected this: since the modal passes the `title` directly via `onAddSubtask(title, clName)`, the hook should accept title as a second parameter. The hook signature becomes `addDetailsSubtask(checklistName: string, title?: string)` and the boards-page-client calls `tasks.addDetailsSubtask(checklistName, title)`.
