"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import type { KeyboardEvent as ReactKeyboardEvent, DragEvent } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import { toast } from "sonner";
import {
  Folder,
  File,
  FileText,
  FileImage,
  Download,
  Trash2,
  Copy,
  Scissors,
  Pencil,
  FolderPlus,
  FilePlus,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  MoreHorizontal,
  Upload,
  Home,
  RefreshCw,
  FolderOpen,
  Clock,
  HardDrive,
  Shield,
  Calendar,
  Eye,
  X,
  Image as ImageIcon,
  Search,
  AlertCircle,
  ClipboardCopy,
  Loader2,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type FileItem = {
  id: string;
  name: string;
  type: "file" | "folder";
  size: number;
  modified: string;
  created: string;
  accessed: string;
  permissions: string;
};

type FolderNode = {
  id: string;
  name: string;
  children: FolderNode[] | null;
  loading: boolean;
};

type SortField = "name" | "size" | "modified";
type SortDir = "asc" | "desc";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TEXT_EXTENSIONS = new Set([
  ".md", ".txt", ".json", ".yaml", ".yml", ".toml", ".ts", ".tsx",
  ".js", ".jsx", ".css", ".html", ".sh", ".env", ".log", ".cfg",
  ".conf", ".ini", ".xml", ".csv", ".sql", ".py", ".rb", ".go",
  ".rs", ".java", ".c", ".h", ".cpp", ".hpp", ".mjs", ".cjs",
  ".lock", ".gitignore", ".dockerignore", ".editorconfig",
]);

function isTextFile(name: string): boolean {
  // Files without extension (dotfiles like .env, .gitignore, etc.) are often text
  if (name.startsWith(".") && !name.includes(".", 1)) return true;
  const dot = name.lastIndexOf(".");
  if (dot === -1) return false;
  return TEXT_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp",
]);

function isImageFile(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return false;
  return IMAGE_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot === -1 || dot === 0) return "";
  return name.slice(dot + 1).toUpperCase();
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = now - then;
  if (diff < 0) return "just now";
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function parentPath(p: string): string {
  if (p === "/") return "/";
  const idx = p.lastIndexOf("/");
  return idx <= 0 ? "/" : p.slice(0, idx);
}

function pathSegments(p: string): { label: string; path: string }[] {
  if (p === "/") return [];
  const parts = p.split("/").filter(Boolean);
  return parts.map((part, i) => ({
    label: part,
    path: "/" + parts.slice(0, i + 1).join("/"),
  }));
}

// ─── API helpers ─────────────────────────────────────────────────────────────

async function apiFetch(currentPath: string): Promise<FileItem[]> {
  const url = currentPath === "/"
    ? "/api/file-manager"
    : `/api/file-manager${currentPath}`;
  const res = await fetch(url, { cache: "reload" });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error ?? "Failed to fetch");
  return data.items ?? [];
}

async function apiPreview(id: string): Promise<string> {
  const res = await fetch(`/api/file-manager?preview=true&id=${encodeURIComponent(id)}`, { cache: "reload" });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error ?? "Failed to preview");
  return data.content ?? "";
}

async function apiCreate(parentId: string, name: string, type: "file" | "folder"): Promise<void> {
  const res = await fetch("/api/file-manager", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "create", parentId, name, type }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error ?? "Failed to create");
}

async function apiRename(id: string, newName: string): Promise<void> {
  const res = await fetch("/api/file-manager", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "rename", id, newName }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error ?? "Failed to rename");
}

async function apiDelete(ids: string[]): Promise<void> {
  const res = await fetch("/api/file-manager", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error ?? "Failed to delete");
}

async function apiMoveOrCopy(action: "move" | "copy", ids: string[], targetId: string): Promise<void> {
  const res = await fetch("/api/file-manager", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ids, targetId }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error ?? `Failed to ${action}`);
}

async function apiUpload(parentId: string, files: globalThis.File[]): Promise<void> {
  const form = new FormData();
  form.set("parentId", parentId);
  for (const file of files) {
    form.append("files", file);
  }
  const res = await fetch("/api/file-manager", { method: "POST", body: form });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error ?? "Upload failed");
}

async function apiFetchFolders(dirPath: string): Promise<FolderNode[]> {
  const items = await apiFetch(dirPath);
  return items
    .filter((i) => i.type === "folder")
    .map((i) => ({ id: i.id, name: i.name, children: null, loading: false }));
}

// ─── Sorting ─────────────────────────────────────────────────────────────────

function sortItemsBy(items: FileItem[], field: SortField, dir: SortDir): FileItem[] {
  const sorted = [...items].sort((a, b) => {
    // Folders always first
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;

    let cmp = 0;
    if (field === "name") {
      cmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    } else if (field === "size") {
      cmp = a.size - b.size;
    } else {
      cmp = new Date(a.modified).getTime() - new Date(b.modified).getTime();
    }
    return dir === "asc" ? cmp : -cmp;
  });
  return sorted;
}

// ─── Folder Tree Picker ─────────────────────────────────────────────────────

function FolderTreeNode({
  node,
  selectedId,
  onSelect,
  onExpand,
  depth,
}: {
  node: FolderNode;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onExpand: (node: FolderNode) => void;
  depth: number;
}): React.JSX.Element {
  const isSelected = node.id === selectedId;
  const isExpanded = node.children !== null;

  return (
    <div>
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-sm hover:bg-accent transition-colors",
          isSelected && "bg-accent text-accent-foreground font-medium",
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => {
          onSelect(node.id);
          if (!isExpanded) onExpand(node);
        }}
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform",
            isExpanded && "rotate-90",
          )}
        />
        <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{node.name}</span>
      </button>
      {isExpanded && node.children && (
        <div>
          {node.loading && (
            <div style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }} className="py-1">
              <Skeleton className="h-4 w-24" />
            </div>
          )}
          {node.children.map((child) => (
            <FolderTreeNode
              key={child.id}
              node={child}
              selectedId={selectedId}
              onSelect={onSelect}
              onExpand={onExpand}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FolderPicker({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  const [tree, setTree] = useState<FolderNode[]>([]);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    apiFetchFolders("/").then(setTree).catch(() => {});
    return () => { mountedRef.current = false; };
  }, []);

  const handleExpand = useCallback((node: FolderNode) => {
    if (node.children !== null) return;

    const setLoading = (nodes: FolderNode[], id: string, loading: boolean): FolderNode[] =>
      nodes.map((n) =>
        n.id === id
          ? { ...n, loading }
          : n.children
            ? { ...n, children: setLoading(n.children, id, loading) }
            : n,
      );

    const setChildren = (nodes: FolderNode[], id: string, children: FolderNode[]): FolderNode[] =>
      nodes.map((n) =>
        n.id === id
          ? { ...n, children, loading: false }
          : n.children
            ? { ...n, children: setChildren(n.children, id, children) }
            : n,
      );

    setTree((prev) => setLoading(prev, node.id, true));

    apiFetchFolders(node.id).then((children) => {
      setTree((prev) => setChildren(prev, node.id, children));
    }).catch(() => {
      setTree((prev) => setChildren(prev, node.id, []));
    });
  }, []);

  return (
    <ScrollArea className="h-60 rounded-md border">
      <div className="p-2">
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-sm hover:bg-accent transition-colors",
            selectedId === "/" && "bg-accent text-accent-foreground font-medium",
          )}
          onClick={() => onSelect("/")}
        >
          <Home className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>Root (/)</span>
        </button>
        {tree.map((node) => (
          <FolderTreeNode
            key={node.id}
            node={node}
            selectedId={selectedId}
            onSelect={onSelect}
            onExpand={handleExpand}
            depth={1}
          />
        ))}
      </div>
    </ScrollArea>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function FileManagerClient(): React.JSX.Element {
  const [currentPath, setCurrentPath] = useState("/");
  const [items, setItems] = useState<FileItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameOriginal, setRenameOriginal] = useState("");
  const [previewItem, setPreviewItem] = useState<FileItem | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [dragging, setDragging] = useState(false);
  const [mutating, setMutating] = useState(false); // loading for create/delete/move/upload
  const dragCounterRef = useRef(0);

  // Dialog state
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createType, setCreateType] = useState<"file" | "folder">("folder");
  const [createName, setCreateName] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const [moveCopyDialogOpen, setMoveCopyDialogOpen] = useState(false);
  const [moveCopyAction, setMoveCopyAction] = useState<"move" | "copy">("move");
  const [moveCopyIds, setMoveCopyIds] = useState<string[]>([]);
  const [moveCopyTarget, setMoveCopyTarget] = useState<string | null>(null);

  const mountedRef = useRef(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const renamingRef = useRef(false); // guard against double-fire

  // ─── Derived ─────────────────────────────────────────────────────────────

  const filteredItems = useMemo(() => {
    let list = items;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((i) => i.name.toLowerCase().includes(q));
    }
    return sortItemsBy(list, sortField, sortDir);
  }, [items, searchQuery, sortField, sortDir]);

  const anyDialogOpen = createDialogOpen || deleteDialogOpen || moveCopyDialogOpen || previewItem !== null;

  // ─── Fetch directory ───────────────────────────────────────────────────────

  const fetchDir = useCallback((dirPath: string) => {
    setLoading(true);
    setError(null);
    setSelected(new Set());
    apiFetch(dirPath)
      .then((data) => { setItems(data); })
      .catch((e) => {
        setItems([]);
        setError(e instanceof Error ? e.message : "Failed to load directory");
      })
      .finally(() => { setLoading(false); });
  }, []);

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    fetchDir(currentPath);
    return () => { mountedRef.current = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const navigateTo = useCallback((p: string) => {
    setCurrentPath(p);
    setRenamingId(null);
    setPreviewItem(null);
    setSearchQuery("");
    fetchDir(p);
  }, [fetchDir]);

  const refresh = useCallback(() => {
    fetchDir(currentPath);
  }, [currentPath, fetchDir]);

  // ─── Selection ─────────────────────────────────────────────────────────────

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selected.size === filteredItems.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredItems.map((i) => i.id)));
    }
  }, [selected.size, filteredItems]);

  // ─── Sorting ─────────────────────────────────────────────────────────────

  const handleSort = useCallback((field: SortField) => {
    setSortField((prev) => {
      if (prev === field) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir("asc");
      return field;
    });
  }, []);

  const sortIndicator = useCallback((field: SortField): React.ReactNode => {
    if (sortField !== field) return null;
    return sortDir === "asc"
      ? <ChevronUp className="h-3 w-3 ml-0.5 inline" />
      : <ChevronDown className="h-3 w-3 ml-0.5 inline" />;
  }, [sortField, sortDir]);

  // ─── Row click / navigate ──────────────────────────────────────────────────

  const handleRowClick = useCallback((item: FileItem) => {
    if (renamingId) return;
    if (item.type === "folder") {
      navigateTo(item.id);
    } else {
      setPreviewItem(item);
      if (isTextFile(item.name)) {
        setPreviewLoading(true);
        setPreviewContent(null);
        apiPreview(item.id)
          .then((content) => { setPreviewContent(content); })
          .catch(() => { setPreviewContent("Error loading file"); })
          .finally(() => { setPreviewLoading(false); });
      } else {
        setPreviewContent(null);
      }
    }
  }, [renamingId, navigateTo]);

  // ─── Create ────────────────────────────────────────────────────────────────

  const openCreateDialog = useCallback((type: "file" | "folder") => {
    setCreateType(type);
    setCreateName("");
    setCreateDialogOpen(true);
  }, []);

  const handleCopyPath = useCallback((id: string) => {
    const fullPath = `~/.openclaw${id}`;
    navigator.clipboard.writeText(fullPath).then(() => {
      toast.success("Path copied");
    }).catch(() => {
      toast.error("Failed to copy path");
    });
  }, []);

  const handleCreate = useCallback(async () => {
    if (!createName.trim()) return;
    setMutating(true);
    try {
      await apiCreate(currentPath, createName.trim(), createType);
      setCreateDialogOpen(false);
      toast.success(`${createType === "folder" ? "Folder" : "File"} created`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setMutating(false);
    }
  }, [createName, createType, currentPath, refresh]);

  // ─── Rename ────────────────────────────────────────────────────────────────

  const startRename = useCallback((item: FileItem) => {
    setRenamingId(item.id);
    setRenameValue(item.name);
    setRenameOriginal(item.name);
    setTimeout(() => renameInputRef.current?.select(), 50);
  }, []);

  const confirmRename = useCallback(async () => {
    // Guard against double-fire from blur + Enter
    if (renamingRef.current) return;
    if (!renamingId || !renameValue.trim()) {
      setRenamingId(null);
      return;
    }
    // Skip if name unchanged
    if (renameValue.trim() === renameOriginal) {
      setRenamingId(null);
      return;
    }
    renamingRef.current = true;
    try {
      await apiRename(renamingId, renameValue.trim());
      toast.success("Renamed");
      setRenamingId(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to rename");
      setRenamingId(null);
    } finally {
      renamingRef.current = false;
    }
  }, [renamingId, renameValue, renameOriginal, refresh]);

  const cancelRename = useCallback(() => {
    setRenamingId(null);
  }, []);

  // ─── Delete ────────────────────────────────────────────────────────────────

  const openDeleteDialog = useCallback((ids: string[]) => {
    setDeleteIds(ids);
    setDeleteDialogOpen(true);
  }, []);

  const handleDelete = useCallback(async () => {
    setMutating(true);
    try {
      await apiDelete(deleteIds);
      setDeleteDialogOpen(false);
      setDeleteIds([]);
      toast.success(`Deleted ${deleteIds.length} item${deleteIds.length > 1 ? "s" : ""}`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setMutating(false);
    }
  }, [deleteIds, refresh]);

  // ─── Move / Copy ──────────────────────────────────────────────────────────

  const openMoveCopy = useCallback((action: "move" | "copy", ids: string[]) => {
    setMoveCopyAction(action);
    setMoveCopyIds(ids);
    setMoveCopyTarget(null);
    setMoveCopyDialogOpen(true);
  }, []);

  const handleMoveCopy = useCallback(async () => {
    if (!moveCopyTarget) return;
    setMutating(true);
    try {
      await apiMoveOrCopy(moveCopyAction, moveCopyIds, moveCopyTarget);
      setMoveCopyDialogOpen(false);
      toast.success(`${moveCopyAction === "move" ? "Moved" : "Copied"} ${moveCopyIds.length} item${moveCopyIds.length > 1 ? "s" : ""}`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Failed to ${moveCopyAction}`);
    } finally {
      setMutating(false);
    }
  }, [moveCopyAction, moveCopyIds, moveCopyTarget, refresh]);

  // ─── Download ──────────────────────────────────────────────────────────────

  const handleDownload = useCallback((id: string) => {
    const a = document.createElement("a");
    a.href = `/api/file-manager?download=true&id=${encodeURIComponent(id)}`;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  // ─── Upload (real file content) ────────────────────────────────────────────

  const handleUpload = useCallback(async (fileList: FileList | globalThis.File[] | null) => {
    if (!fileList || (fileList instanceof FileList && fileList.length === 0)) return;
    const files = Array.from(fileList);
    try {
      await apiUpload(currentPath, files);
      toast.success(`Uploaded ${files.length} file${files.length > 1 ? "s" : ""}`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    }
  }, [currentPath, refresh]);

  // ─── Drag and drop ────────────────────────────────────────────────────────

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) setDragging(true);
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setDragging(false);
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setDragging(false);
    if (e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files);
    }
  }, [handleUpload]);

  // ─── Keyboard shortcuts ────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) return;
      // Don't fire shortcuts when dialogs are open
      if (anyDialogOpen) return;

      if (e.key === "Backspace") {
        e.preventDefault();
        if (currentPath !== "/") navigateTo(parentPath(currentPath));
      }
      if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        toggleSelectAll();
      }
      if (e.key === "Delete" && selected.size > 0) {
        e.preventDefault();
        openDeleteDialog(Array.from(selected));
      }
      if (e.key === "F2" && selected.size === 1) {
        e.preventDefault();
        const item = items.find((i) => i.id === Array.from(selected)[0]);
        if (item) startRename(item);
      }
      if (e.key === "F5") {
        e.preventDefault();
        refresh();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [currentPath, navigateTo, toggleSelectAll, selected, openDeleteDialog, anyDialogOpen, items, startRename, refresh]);

  // ─── Breadcrumbs ───────────────────────────────────────────────────────────

  const segments = useMemo(() => pathSegments(currentPath), [currentPath]);
  const selectedCount = selected.size;
  const totalCount = filteredItems.length;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="flex flex-col gap-4 relative"
    >
      {/* Drag overlay */}
      {dragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary/5 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2">
            <Upload className="h-10 w-10 text-primary" />
            <p className="text-sm font-medium text-primary">Drop files to upload</p>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1 text-sm min-w-0 overflow-x-auto">
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 gap-1 px-2"
            onClick={() => navigateTo("/")}
          >
            <Home className="h-4 w-4" />
            <span className="hidden sm:inline">Root</span>
          </Button>
          {segments.map((seg) => (
            <span key={seg.path} className="flex items-center gap-1 shrink-0">
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              <Button
                variant="ghost"
                size="sm"
                className="px-2"
                onClick={() => navigateTo(seg.path)}
              >
                {seg.label}
              </Button>
            </span>
          ))}
        </div>

        <div className="flex-1" />

        {/* Search */}
        <div className="relative w-44">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Filter…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          {selectedCount > 0 && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-xs"
                onClick={() => openMoveCopy("move", Array.from(selected))}
              >
                <Scissors className="h-3.5 w-3.5" />
                Move ({selectedCount})
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-xs"
                onClick={() => openMoveCopy("copy", Array.from(selected))}
              >
                <Copy className="h-3.5 w-3.5" />
                Copy ({selectedCount})
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-xs text-destructive hover:text-destructive"
                onClick={() => openDeleteDialog(Array.from(selected))}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete ({selectedCount})
              </Button>
              <div className="w-px h-5 bg-border mx-1" />
            </>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openCreateDialog("folder")} title="New Folder">
            <FolderPlus className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openCreateDialog("file")} title="New File">
            <FilePlus className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => fileInputRef.current?.click()} title="Upload">
            <Upload className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={refresh} title="Refresh (F5)">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            multiple
            onChange={(e) => { handleUpload(e.target.files); e.target.value = ""; }}
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border overflow-hidden">
        {loading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-4 w-4 rounded" />
                <Skeleton className="h-4 w-4" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-6" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <AlertCircle className="h-10 w-10 mb-3 text-destructive/60" />
            <p className="text-sm font-medium text-foreground">Failed to load</p>
            <p className="text-xs mt-1">{error}</p>
            <Button variant="ghost" size="sm" className="mt-3 gap-1" onClick={refresh}>
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </Button>
          </div>
        ) : filteredItems.length === 0 ? (
          <Empty className="my-8 border-0">
            <EmptyHeader>
              <FolderOpen className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
              <EmptyTitle>{searchQuery ? "No matches" : "Empty folder"}</EmptyTitle>
              <EmptyDescription>
                {searchQuery
                  ? `No files matching "${searchQuery}"`
                  : "This directory has no files or folders. Drag files here or use the toolbar to create one."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10">
                    <Checkbox
                      checked={selectedCount === filteredItems.length && filteredItems.length > 0}
                      onCheckedChange={toggleSelectAll}
                      aria-label="Select all"
                    />
                  </TableHead>
                  <TableHead>
                    <button type="button" className="flex items-center hover:text-foreground transition-colors" onClick={() => handleSort("name")}>
                      Name {sortIndicator("name")}
                    </button>
                  </TableHead>
                  <TableHead className="w-24 hidden sm:table-cell">
                    <button type="button" className="flex items-center hover:text-foreground transition-colors" onClick={() => handleSort("size")}>
                      Size {sortIndicator("size")}
                    </button>
                  </TableHead>
                  <TableHead className="w-28 hidden md:table-cell">
                    <button type="button" className="flex items-center hover:text-foreground transition-colors" onClick={() => handleSort("modified")}>
                      Modified {sortIndicator("modified")}
                    </button>
                  </TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map((item) => (
                  <TableRow
                    key={item.id}
                    className={cn(
                      "cursor-pointer hover:bg-accent transition-colors",
                      selected.has(item.id) && "bg-accent/50",
                    )}
                  >
                    <TableCell
                      className="w-10"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Checkbox
                        checked={selected.has(item.id)}
                        onCheckedChange={() => toggleSelect(item.id)}
                        aria-label={`Select ${item.name}`}
                      />
                    </TableCell>
                    <TableCell onClick={() => handleRowClick(item)}>
                      <div className="flex items-center gap-2 min-w-0">
                        {item.type === "folder" ? (
                          <Folder className="h-4 w-4 shrink-0 text-primary/70" />
                        ) : isImageFile(item.name) ? (
                          <FileImage className="h-4 w-4 shrink-0 text-emerald-500/70" />
                        ) : isTextFile(item.name) ? (
                          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <File className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        {renamingId === item.id ? (
                          <Input
                            ref={renameInputRef}
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e: ReactKeyboardEvent<HTMLInputElement>) => {
                              if (e.key === "Enter") { e.preventDefault(); confirmRename(); }
                              if (e.key === "Escape") { e.preventDefault(); cancelRename(); }
                            }}
                            onBlur={confirmRename}
                            onClick={(e) => e.stopPropagation()}
                            className="h-7 text-sm max-w-60"
                            autoFocus
                          />
                        ) : (
                          <span className="truncate text-sm">{item.name}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-muted-foreground text-xs">
                      {item.type === "file" ? formatSize(item.size) : "—"}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground text-xs">
                      {relativeTime(item.modified)}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {item.type === "file" && (
                            <DropdownMenuItem onClick={() => handleDownload(item.id)}>
                              <Download className="h-4 w-4 mr-2" />
                              Download
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => handleCopyPath(item.id)}>
                            <ClipboardCopy className="h-4 w-4 mr-2" />
                            Copy path
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => startRename(item)}>
                            <Pencil className="h-4 w-4 mr-2" />
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openMoveCopy("copy", [item.id])}>
                            <Copy className="h-4 w-4 mr-2" />
                            Copy to…
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openMoveCopy("move", [item.id])}>
                            <Scissors className="h-4 w-4 mr-2" />
                            Move to…
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => openDeleteDialog([item.id])}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {/* Footer: item count */}
            <div className="px-4 py-2 border-t text-xs text-muted-foreground flex items-center gap-2">
              <span>{totalCount} item{totalCount !== 1 ? "s" : ""}</span>
              {selectedCount > 0 && (
                <>
                  <span>·</span>
                  <span>{selectedCount} selected</span>
                </>
              )}
              {searchQuery && items.length !== totalCount && (
                <>
                  <span>·</span>
                  <span>{items.length} total</span>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* File Preview Sheet */}
      <Sheet open={previewItem !== null} onOpenChange={(open) => { if (!open) setPreviewItem(null); }}>
        <SheetContent className="sm:max-w-xl p-0 flex flex-col gap-0">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b">
            <SheetHeader className="p-0 space-y-0">
              <SheetTitle className="flex items-center gap-2.5 text-sm font-semibold">
                {previewItem?.type === "folder" ? (
                  <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-primary/10">
                    <Folder className="h-4 w-4 text-primary" />
                  </div>
                ) : isImageFile(previewItem?.name ?? "") ? (
                  <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-emerald-500/10">
                    <ImageIcon className="h-4 w-4 text-emerald-500" />
                  </div>
                ) : isTextFile(previewItem?.name ?? "") ? (
                  <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-blue-500/10">
                    <FileText className="h-4 w-4 text-blue-500" />
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted">
                    <File className="h-4 w-4 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate">{previewItem?.name}</p>
                  {previewItem && (
                    <p className="text-xs font-normal text-muted-foreground">
                      {fileExtension(previewItem.name) ? `${fileExtension(previewItem.name)} File` : "File"} · {formatSize(previewItem.size)}
                    </p>
                  )}
                </div>
              </SheetTitle>
            </SheetHeader>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => setPreviewItem(null)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {previewItem && previewItem.type === "file" && (
            <div className="flex flex-col flex-1 min-h-0">
              {/* Quick actions bar */}
              <div className="flex items-center gap-1.5 px-5 py-2.5 border-b bg-muted/30">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-7 text-xs"
                  onClick={() => handleDownload(previewItem.id)}
                >
                  <Download className="h-3.5 w-3.5" />
                  Download
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-7 text-xs"
                  onClick={() => { startRename(previewItem); setPreviewItem(null); }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Rename
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-7 text-xs"
                  onClick={() => { openMoveCopy("copy", [previewItem.id]); }}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-7 text-xs text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/10"
                  onClick={() => { openDeleteDialog([previewItem.id]); setPreviewItem(null); }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
              </div>

              {/* Preview content area */}
              <div className="flex-1 min-h-0 overflow-hidden">
                {isImageFile(previewItem.name) ? (
                  <ScrollArea className="h-full">
                    <div className="p-5 flex justify-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/file-manager?serve=true&id=${encodeURIComponent(previewItem.id)}`}
                        alt={previewItem.name}
                        className="max-w-full max-h-[50vh] rounded-lg border object-contain bg-muted/20"
                      />
                    </div>
                  </ScrollArea>
                ) : isTextFile(previewItem.name) ? (
                  previewLoading ? (
                    <div className="p-5 space-y-2">
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-4 w-5/6" />
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-4 w-full" />
                    </div>
                  ) : (
                    <ScrollArea className="h-full">
                      <div className="p-5">
                        <div className="rounded-lg border bg-muted/30 overflow-hidden">
                          <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/50 text-xs text-muted-foreground">
                            <Eye className="h-3 w-3" />
                            Preview
                          </div>
                          <pre className="text-xs leading-relaxed whitespace-pre-wrap break-words p-4 font-mono">
                            {previewContent}
                          </pre>
                        </div>
                      </div>
                    </ScrollArea>
                  )
                ) : (
                  <div className="flex flex-col items-center justify-center h-full py-12 text-muted-foreground">
                    <File className="h-14 w-14 mb-3 opacity-30" />
                    <p className="text-sm font-medium">No preview available</p>
                    <p className="text-xs mt-1">Download the file to view its contents</p>
                  </div>
                )}
              </div>

              {/* File details — Windows-style properties */}
              <div className="border-t bg-muted/20">
                <div className="px-5 py-3">
                  <p className="text-xs font-semibold text-foreground mb-2.5">Details</p>
                  <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <HardDrive className="h-3 w-3" />
                      <span>Size</span>
                    </div>
                    <span className="text-foreground">{formatSize(previewItem.size)}{previewItem.size > 1024 ? ` (${previewItem.size.toLocaleString()} bytes)` : ""}</span>

                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Folder className="h-3 w-3" />
                      <span>Location</span>
                    </div>
                    <span className="text-foreground truncate font-mono text-[11px]">~/.openclaw{previewItem.id}</span>

                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      <span>Created</span>
                    </div>
                    <span className="text-foreground">{formatDateTime(previewItem.created)}</span>

                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>Modified</span>
                    </div>
                    <span className="text-foreground">{formatDateTime(previewItem.modified)}</span>

                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Eye className="h-3 w-3" />
                      <span>Accessed</span>
                    </div>
                    <span className="text-foreground">{formatDateTime(previewItem.accessed)}</span>

                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Shield className="h-3 w-3" />
                      <span>Permissions</span>
                    </div>
                    <span className="text-foreground font-mono text-[11px]">{previewItem.permissions}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Create Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {createType === "folder" ? "New Folder" : "New File"}
            </DialogTitle>
            <DialogDescription>
              Create a new {createType} in{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">
                {currentPath === "/" ? "/" : currentPath}
              </code>
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder={createType === "folder" ? "folder-name" : "filename.txt"}
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!createName.trim() || mutating}>
              {mutating && <Loader2 className="h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteIds.length === 1 ? "item" : `${deleteIds.length} items`}?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. {deleteIds.length === 1
                ? `"${items.find((i) => i.id === deleteIds[0])?.name ?? deleteIds[0]}" will be permanently deleted.`
                : `${deleteIds.length} items will be permanently deleted.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={mutating}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {mutating && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Move/Copy Dialog */}
      <Dialog open={moveCopyDialogOpen} onOpenChange={setMoveCopyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {moveCopyAction === "move" ? "Move" : "Copy"} {moveCopyIds.length === 1 ? "item" : `${moveCopyIds.length} items`}
            </DialogTitle>
            <DialogDescription>
              Choose a destination folder.
            </DialogDescription>
          </DialogHeader>
          <FolderPicker
            selectedId={moveCopyTarget}
            onSelect={setMoveCopyTarget}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMoveCopyDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleMoveCopy} disabled={!moveCopyTarget || mutating}>
              {mutating && <Loader2 className="h-4 w-4 animate-spin" />}
              {moveCopyAction === "move" ? "Move here" : "Copy here"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
