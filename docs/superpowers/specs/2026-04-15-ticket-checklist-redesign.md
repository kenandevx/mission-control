# Ticket Checklist Redesign

**Date:** 2026-04-15  
**Status:** Approved

## Problem

1. **Typing bug:** In create mode, the checklist "Add item" input is wired with `subtaskDraft=""` and `onSubtaskDraftChange={() => {}}` (no-ops), making it impossible to type.
2. **Single checklist only:** Only one checklist section exists per ticket.
3. **No checklist names:** Checklists have no title, unlike Trello.

## Solution

### DB: Add `checklist_name` column
Add `checklist_name text NOT NULL DEFAULT 'Checklist'` to `ticket_subtasks`. Existing rows automatically get `"Checklist"` as their name. Migration runs via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` in the API route.

### UI: Multiple named checklists (Trello-style)
Each checklist renders as a named group with:
- Editable name (inline input)
- Progress bar (done/total for that checklist)
- Checklist items with checkboxes
- Per-checklist "Add item" input
- Delete button to remove entire checklist

An "+ Add checklist" button appends a new empty checklist.

### Create mode fix
The modal manages all checklist/draft state internally via local React state. On save, draft subtasks are passed to `handleCreateTicket`, which creates them in the DB after ticket creation. The parent (boards-page-client) no longer needs to pass subtask-related props for create mode.

### Edit mode
Live DB-backed CRUD: add/toggle/delete individual items, rename/delete whole checklists. Renaming a checklist updates all its items' `checklist_name` field.

## Architecture

### Data model
```
ticket_subtasks
  id, ticket_id, title, completed, position, created_at, updated_at
+ checklist_name text NOT NULL DEFAULT 'Checklist'
```

### API changes (`app/api/tasks/route.ts`)
- Boot-time migration: `ALTER TABLE ticket_subtasks ADD COLUMN IF NOT EXISTS checklist_name text NOT NULL DEFAULT 'Checklist'`
- `createSubtask`: accept `checklistName`
- `updateSubtask`: accept `checklistName` for rename
- `renameChecklist`: bulk-rename all items in a checklist
- `deleteChecklist`: delete all items with a given `checklist_name` for a ticket

### Type changes
- `TicketSubtaskRow`, `TicketSubtaskRecord`, `CreateTicketSubtaskPayload`, `UpdateTicketSubtaskPatch`, `TicketSubtask` — all gain `checklistName: string`

### Hook changes (`hooks/use-tasks.ts`)
- `addDetailsSubtask(checklistName: string)` — takes which checklist to add to
- `subtaskDraftsByChecklist: Record<string, string>` — replaces single `subtaskDraft`
- `setSubtaskDraftForChecklist(checklistName: string, value: string)`
- `renameDetailsChecklist(oldName: string, newName: string)`
- `deleteDetailsChecklist(checklistName: string)`
- `handleCreateTicket` accepts `draftSubtasks: { checklistName: string; title: string }[]`

### Modal props changes
- Remove: `subtaskDraft`, `onSubtaskDraftChange`
- Add: `onAddSubtask(title: string, checklistName: string)`, `onRenameChecklist(old, new)`, `onDeleteChecklist(name)`
- `onSave` signature extended: `onSave(files?: File[], draftSubtasks?: { checklistName: string; title: string }[])`
- Modal manages draft state internally

## Files Changed
1. `db/schema.sql`
2. `app/api/tasks/route.ts`
3. `lib/db/index.ts`
4. `lib/db/adapter.ts`
5. `types/tasks.ts`
6. `hooks/use-tasks.ts`
7. `components/tasks/modals/ticket-details-modal.tsx`
8. `components/tasks/boards/boards-page-client.tsx`
