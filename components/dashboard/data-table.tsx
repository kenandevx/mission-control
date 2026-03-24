"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core"
import { restrictToVerticalAxis } from "@dnd-kit/modifiers"
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  IconChevronLeft,
  IconChevronRight,
  IconChevronsLeft,
  IconChevronsRight,
  IconCircleCheckFilled,
  IconDotsVertical,
  IconGripVertical,
} from "@tabler/icons-react"
import {
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type Row,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table"
import { toast } from "sonner"

import { useIsMobile } from "@/hooks/use-mobile"
import { formatDue, type Assignee, type Ticket } from "@/types/tasks"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"


const STATUS_LABELS: Record<string, string> = {
  backlog: "Backlog",
  in_progress: "In Progress",
  review: "Review",
  done: "Done",
}

const STATUS_BADGE_CLASS: Record<string, string> = {
  backlog: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  in_progress: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  review: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  done: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
}

const STATUS_DOT_CLASS: Record<string, string> = {
  backlog: "bg-slate-500",
  in_progress: "bg-blue-500",
  review: "bg-amber-500",
  done: "bg-emerald-500",
}

type DashboardTableMeta = {
  onEditTicket: (ticketId: string) => void
  assignees: Assignee[]
}

function DragHandle({ id }: { id: string }) {
  const { attributes, listeners } = useSortable({ id })
  return (
    <Button
      {...attributes}
      {...listeners}
      variant="ghost"
      size="icon"
      className="size-7 text-muted-foreground hover:bg-transparent"
    >
      <IconGripVertical className="size-3 text-muted-foreground" />
      <span className="sr-only">Drag to reorder</span>
    </Button>
  )
}

const columns: ColumnDef<Ticket>[] = [
  {
    id: "drag",
    header: () => null,
    cell: ({ row }) => <DragHandle id={row.original.id} />,
  },
  {
    id: "select",
    header: ({ table }) => (
      <div className="flex items-center justify-center">
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
        />
      </div>
    ),
    cell: ({ row }) => (
      <div className="flex items-center justify-center">
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
        />
      </div>
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "title",
    header: "Title",
    cell: ({ row }) => <TableCellViewer item={row.original} />,
    enableHiding: false,
  },
  {
    accessorKey: "statusId",
    header: "Status",
    cell: ({ row }) => {
      const isDone = row.original.statusId === "done"
      return (
        <Badge
          variant="outline"
          className={`px-1.5 ${STATUS_BADGE_CLASS[row.original.statusId] ?? "text-muted-foreground"}`}
        >
          {isDone ? (
            <IconCircleCheckFilled className="fill-emerald-500 text-emerald-500 dark:fill-emerald-400 dark:text-emerald-400" />
          ) : (
            <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT_CLASS[row.original.statusId] ?? "bg-muted-foreground"}`} />
          )}
          {STATUS_LABELS[row.original.statusId] ?? row.original.statusId}
        </Badge>
      )
    },
  },
  {
    accessorKey: "tags",
    header: "Tags",
    cell: ({ row }) =>
      row.original.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {row.original.tags.map((tag) => (
            <Badge
              key={tag}
              variant="secondary"
              className="px-1.5 py-0 h-5 text-xs font-normal"
            >
              {tag}
            </Badge>
          ))}
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">-</span>
      ),
  },
  {
    accessorKey: "assigneeIds",
    header: "Assignees",
    cell: ({ row, table }) => {
      const ids = row.original.assigneeIds
      if (ids.length === 0)
        return <span className="text-xs text-muted-foreground">-</span>
      const meta = table.options.meta as DashboardTableMeta | undefined
      const assigneeById = Object.fromEntries((meta?.assignees ?? []).map((a) => [a.id, a]))
      const knownAssignees = ids
        .map((id) => ({ id, assignee: assigneeById[id] }))
        .filter((item): item is { id: string; assignee: Assignee } =>
          Boolean(item.assignee),
        )
      if (knownAssignees.length === 0) {
        return (
          <span className="text-xs text-muted-foreground tabular-nums">
            {ids.length} assigned
          </span>
        )
      }
      return (
        <div className="flex -space-x-1.5">
          {knownAssignees.slice(0, 3).map(({ id, assignee }) => {
            return (
              <Avatar key={id} className="h-5 w-5 border border-background">
                <AvatarFallback
                  style={{ backgroundColor: assignee.color }}
                  className="text-white text-[10px]"
                >
                  {assignee.initials}
                </AvatarFallback>
              </Avatar>
            )
          })}
          {knownAssignees.length > 3 && (
            <Avatar className="h-5 w-5 border border-background">
              <AvatarFallback className="text-[10px] bg-muted text-muted-foreground">
                +{knownAssignees.length - 3}
              </AvatarFallback>
            </Avatar>
          )}
        </div>
      )
    },
  },
  {
    accessorKey: "dueDate",
    header: "Due",
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        {row.original.dueDate ? formatDue(row.original.dueDate) : "-"}
      </span>
    ),
  },
  {
    id: "checklist",
    header: "Progress",
    cell: ({ row }) => {
      const { checklistDone, checklistTotal } = row.original
      if (checklistTotal === 0)
        return <span className="text-xs text-muted-foreground">-</span>
      return (
        <span className="text-xs text-muted-foreground tabular-nums">
          {checklistDone}/{checklistTotal}
        </span>
      )
    },
  },
  {
    id: "actions",
    cell: ({ row, table }) => {
      const meta = table.options.meta as DashboardTableMeta | undefined
      return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="flex size-8 text-muted-foreground data-[state=open]:bg-muted"
            size="icon"
          >
            <IconDotsVertical />
            <span className="sr-only">Open menu</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-32">
          <DropdownMenuItem onClick={() => meta?.onEditTicket(row.original.id)}>
            Edit
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      )
    },
  },
]

function DraggableRow({ row }: { row: Row<Ticket> }) {
  const { transform, transition, setNodeRef, isDragging } = useSortable({
    id: row.original.id,
  })
  return (
    <TableRow
      data-state={row.getIsSelected() && "selected"}
      data-dragging={isDragging}
      ref={setNodeRef}
      className="relative z-0 data-[dragging=true]:z-10 data-[dragging=true]:opacity-80"
      style={{
        transform: CSS.Transform.toString(transform),
        transition: transition,
      }}
    >
      {row.getVisibleCells().map((cell) => (
        <TableCell key={cell.id}>
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </TableCell>
      ))}
    </TableRow>
  )
}

export function DataTable({
  data: initialData,
  boardId,
}: {
  data: Ticket[]
  boardId: string | null
}) {
  const router = useRouter()
  const [data, setData] = React.useState(() => initialData)
  const [rowSelection, setRowSelection] = React.useState({})
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({})
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    []
  )
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [pagination, setPagination] = React.useState({
    pageIndex: 0,
    pageSize: 10,
  })
  const sortableId = React.useId()
  const sensors = useSensors(
    useSensor(MouseSensor, {}),
    useSensor(TouchSensor, {}),
    useSensor(KeyboardSensor, {})
  )

  const dataIds = React.useMemo<UniqueIdentifier[]>(
    () => data?.map(({ id }) => id) || [],
    [data]
  )

  const handleEditTicket = React.useCallback(
    (ticketId: string) => {
      if (!boardId) {
        toast.error("No board selected for this ticket.")
        return
      }

      router.push(`/boards?board=${boardId}&ticket=${ticketId}`)
    },
    [boardId, router],
  )

  const table = useReactTable({
    data,
    columns,
    meta: {
      onEditTicket: handleEditTicket,
      assignees: [],
    } satisfies DashboardTableMeta,
    state: { sorting, columnVisibility, rowSelection, columnFilters, pagination },
    getRowId: (row) => row.id,
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  })

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (active && over && active.id !== over.id) {
      setData((data) => {
        const oldIndex = dataIds.indexOf(active.id)
        const newIndex = dataIds.indexOf(over.id)
        return arrayMove(data, oldIndex, newIndex)
      })
    }
  }

  return (
    <Card className="h-full w-full">
      <CardHeader className="border-b">
        <CardTitle>All Tickets</CardTitle>
        <CardDescription>Current ticket stream across all task columns</CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <div className="relative flex flex-col gap-4 overflow-auto px-4 py-4 lg:px-6">
        <div className="overflow-hidden rounded-lg border">
          <DndContext
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={handleDragEnd}
            sensors={sensors}
            id={sortableId}
          >
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-muted">
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id} colSpan={header.colSpan}>
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody className="**:data-[slot=table-cell]:first:w-8">
                {table.getRowModel().rows?.length ? (
                  <SortableContext
                    items={dataIds}
                    strategy={verticalListSortingStrategy}
                  >
                    {table.getRowModel().rows.map((row) => (
                      <DraggableRow key={row.id} row={row} />
                    ))}
                  </SortableContext>
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="p-4"
                    >
                      <Empty className="min-h-36 rounded-md bg-muted/10">
                        <EmptyHeader>
                          <EmptyTitle>No tickets yet</EmptyTitle>
                          <EmptyDescription>
                            Create a ticket from Boards to populate this table.
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </DndContext>
        </div>

        <div className="mt-2 flex items-center justify-between px-4">
          <div className="hidden flex-1 text-sm text-muted-foreground lg:flex">
            {table.getFilteredSelectedRowModel().rows.length} of{" "}
            {table.getFilteredRowModel().rows.length} row(s) selected.
          </div>
          <div className="flex w-full items-center gap-8 lg:w-fit">
            <div className="flex w-fit items-center justify-center text-sm font-medium">
              Page {table.getState().pagination.pageIndex + 1} of{" "}
              {table.getPageCount()}
            </div>
            <div className="ml-auto flex items-center gap-2 lg:ml-0">
              <Button
                variant="outline"
                className="hidden h-8 w-8 p-0 lg:flex"
                onClick={() => table.setPageIndex(0)}
                disabled={!table.getCanPreviousPage()}
              >
                <span className="sr-only">Go to first page</span>
                <IconChevronsLeft />
              </Button>
              <Button
                variant="outline"
                className="size-8"
                size="icon"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                <span className="sr-only">Go to previous page</span>
                <IconChevronLeft />
              </Button>
              <Button
                variant="outline"
                className="size-8"
                size="icon"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                <span className="sr-only">Go to next page</span>
                <IconChevronRight />
              </Button>
              <Button
                variant="outline"
                className="hidden size-8 lg:flex"
                size="icon"
                onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                disabled={!table.getCanNextPage()}
              >
                <span className="sr-only">Go to last page</span>
                <IconChevronsRight />
              </Button>
            </div>
          </div>
        </div>
        </div>
      </CardContent>
    </Card>
  )
}

function TableCellViewer({ item }: { item: Ticket }) {
  const isMobile = useIsMobile()

  return (
    <Drawer direction={isMobile ? "bottom" : "right"}>
      <DrawerTrigger asChild>
        <Button variant="link" className="w-fit px-0 text-left text-foreground">
          {item.title}
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader className="gap-1">
          <DrawerTitle>{item.title}</DrawerTitle>
          <DrawerDescription>
            {item.description || "No description provided."}
          </DrawerDescription>
        </DrawerHeader>
        <div className="flex flex-col gap-4 overflow-y-auto px-4 text-sm">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Status</Label>
              <Badge
                variant="outline"
                className="w-fit px-1.5 text-muted-foreground"
              >
                {STATUS_LABELS[item.statusId] ?? item.statusId}
              </Badge>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Due Date</Label>
              <p className="text-muted-foreground">
                {item.dueDate ? formatDue(item.dueDate) : "Not set"}
              </p>
            </div>
          </div>

          {item.tags.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label>Tags</Label>
              <div className="flex flex-wrap gap-1">
                {item.tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="secondary"
                    className="px-1.5 py-0 h-5 text-xs font-normal"
                  >
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {item.assigneeIds.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label>Assignees</Label>
              <div className="flex flex-wrap gap-2">
                {item.assigneeIds.map((id) => (
                  <div key={id} className="flex items-center gap-1.5 text-sm">
                    <Avatar className="h-5 w-5">
                      <AvatarFallback className="text-[10px] bg-muted text-muted-foreground">
                        {id.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    {id}
                  </div>
                ))}
              </div>
            </div>
          )}

          {item.checklistTotal > 0 && (
            <>
              <Separator />
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>
                  {item.checklistDone}/{item.checklistTotal} checklist items
                </span>
                {item.comments > 0 && <span>{item.comments} comments</span>}
                {item.attachments > 0 && (
                  <span>{item.attachments} attachments</span>
                )}
              </div>
            </>
          )}
        </div>
        <DrawerFooter>
          <DrawerClose asChild>
            <Button variant="outline">Close</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
