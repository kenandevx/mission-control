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
import { ContainerLoader } from "@/components/ui/container-loader";
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
  Globe,
  List,
  LayoutGrid,
  Info,
  Save,
  ArrowLeft,
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
  owner: string;
  group: string;
  ownerMismatch: boolean;
};

type FolderNode = {
  id: string;
  name: string;
  children: FolderNode[] | null;
  loading: boolean;
};

type SortField = "name" | "size" | "modified";
type SortDir = "asc" | "desc";
type ViewMode = "list" | "grid";

type DirSizeInfo = {
  size: number;
  fileCount: number;
  folderCount: number;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TEXT_EXTENSIONS = new Set([
  ".md", ".txt", ".json", ".yaml", ".yml", ".toml", ".ts", ".tsx",
  ".js", ".jsx", ".css", ".html", ".sh", ".env", ".log", ".cfg",
  ".conf", ".ini", ".xml", ".csv", ".sql", ".py", ".rb", ".go",
  ".rs", ".java", ".c", ".h", ".cpp", ".hpp", ".mjs", ".cjs",
  ".lock", ".gitignore", ".dockerignore", ".editorconfig",
]);

function isTextFile(name: string): boolean {
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

function parentFolder(id: string): string {
  const idx = id.lastIndexOf("/");
  if (idx <= 0) return "/";
  return id.slice(0, idx);
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
  const res = await fetch(url, { cache: "no-cache" });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error ?? "Failed to fetch");
  return data.items ?? [];
}

async function apiPreview(id: string): Promise<string> {
  const res = await fetch(`/api/file-manager?preview=true&id=${encodeURIComponent(id)}`, { cache: "no-cache" });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error ?? "Failed to preview");
  return data.content ?? "";
}

async function apiSave(id: string, content: string): Promise<void> {
  const res = await fetch("/api/file-manager", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "save", id, content }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error ?? "Failed to save");
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

type ConflictResult = { ok: false; conflicts: string[]; error: string };
type MoveOrCopyResult = { ok: true } | ConflictResult;

async function apiMoveOrCopy(
  action: "move" | "copy",
  ids: string[],
  targetId: string,
  onConflict?: "replace" | "keep-both" | "skip",
): Promise<MoveOrCopyResult> {
  const res = await fetch("/api/file-manager", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ids, targetId, onConflict }),
  });
  const data = await res.json();
  if (res.status === 409 && data.conflicts) {
    return data as ConflictResult;
  }
  if (!data.ok) throw new Error(data.error ?? `Failed to ${action}`);
  return { ok: true };
}

type UploadResult = { ok: true } | ConflictResult;

async function apiUpload(
  parentId: string,
  files: globalThis.File[],
  onConflict?: "replace" | "keep-both" | "skip",
): Promise<UploadResult> {
  const form = new FormData();
  form.set("parentId", parentId);
  if (onConflict) form.set("onConflict", onConflict);
  for (const file of files) {
    form.append("files", file);
  }
  const res = await fetch("/api/file-manager", { method: "POST", body: form });
  const data = await res.json();
  if (res.status === 409 && data.conflicts) {
    return data as ConflictResult;
  }
  if (!data.ok) throw new Error(data.error ?? "Upload failed");
  return { ok: true };
}

async function apiSearch(query: string): Promise<FileItem[]> {
  const res = await fetch(`/api/file-manager?search=${encodeURIComponent(query)}`, { cache: "no-cache" });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error ?? "Search failed");
  return data.items ?? [];
}

async function apiFetchFolders(dirPath: string): Promise<FolderNode[]> {
  const items = await apiFetch(dirPath);
  return items
    .filter((i) => i.type === "folder")
    .map((i) => ({ id: i.id, name: i.name, children: null, loading: false }));
}

async function apiDirSize(id: string): Promise<DirSizeInfo> {
  const res = await fetch(`/api/file-manager?dirsize=true&id=${encodeURIComponent(id)}`, { cache: "no-cache" });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error ?? "Failed to get dir size");
  return { size: data.size, fileCount: data.fileCount, folderCount: data.folderCount };
}

// ─── Sorting ─────────────────────────────────────────────────────────────────

function sortItemsBy(items: FileItem[], field: SortField, dir: SortDir): FileItem[] {
  const sorted = [...items].sort((a, b) => {
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
            <div style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }} className="py-1 flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Loading…</span>
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
  const [globalSearch, setGlobalSearch] = useState(false);
  const [globalResults, setGlobalResults] = useState<FileItem[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [dragging, setDragging] = useState(false);
  const [mutating, setMutating] = useState(false);
  const dragCounterRef = useRef(0);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Inline editor state
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [editOriginalContent, setEditOriginalContent] = useState("");
  const [savingFile, setSavingFile] = useState(false);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);

  // Folder preview state
  const [dirSizeInfo, setDirSizeInfo] = useState<DirSizeInfo | null>(null);
  const [dirSizeLoading, setDirSizeLoading] = useState(false);

  // View mode state
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("fm-view-mode") as ViewMode) || "list";
    }
    return "list";
  });



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

  // Conflict resolution dialog
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);
  const [conflictFiles, setConflictFiles] = useState<string[]>([]);
  const [conflictContext, setConflictContext] = useState<
    | { type: "movecopy"; action: "move" | "copy"; ids: string[]; targetId: string }
    | { type: "upload"; parentId: string; files: globalThis.File[] }
    | null
  >(null);

  // Copy confirmation dialog
  const [copyConfirmOpen, setCopyConfirmOpen] = useState(false);
  const [copyConfirmIds, setCopyConfirmIds] = useState<string[]>([]);
  const [copyConfirmTarget, setCopyConfirmTarget] = useState<string | null>(null);

  const mountedRef = useRef(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const renamingRef = useRef(false);

  // ─── Derived ─────────────────────────────────────────────────────────────

  const filteredItems = useMemo(() => {
    if (globalSearch && globalResults !== null) {
      return sortItemsBy(globalResults, sortField, sortDir);
    }
    let list = items;
    if (searchQuery.trim() && !globalSearch) {
      const q = searchQuery.toLowerCase();
      list = list.filter((i) => i.name.toLowerCase().includes(q));
    }
    return sortItemsBy(list, sortField, sortDir);
  }, [items, searchQuery, sortField, sortDir, globalSearch, globalResults]);

  const anyDialogOpen = createDialogOpen || deleteDialogOpen || moveCopyDialogOpen || conflictDialogOpen || previewItem !== null;

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
    setIsEditing(false);
    setSearchQuery("");
    setGlobalResults(null);
    setGlobalSearch(false);
    fetchDir(p);
  }, [fetchDir]);

  // Debounced global search
  const runGlobalSearch = useCallback((query: string) => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!query.trim()) {
      setGlobalResults(null);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    searchTimerRef.current = setTimeout(() => {
      apiSearch(query.trim())
        .then((results) => { setGlobalResults(results); })
        .catch(() => { setGlobalResults([]); })
        .finally(() => { setSearchLoading(false); });
    }, 300);
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (globalSearch) {
      runGlobalSearch(value);
    }
  }, [globalSearch, runGlobalSearch]);

  const toggleGlobalSearch = useCallback(() => {
    setGlobalSearch((prev) => {
      const next = !prev;
      if (next && searchQuery.trim()) {
        runGlobalSearch(searchQuery);
      } else {
        setGlobalResults(null);
        setSearchLoading(false);
      }
      return next;
    });
  }, [searchQuery, runGlobalSearch]);

  const refresh = useCallback(() => {
    fetchDir(currentPath);
  }, [currentPath, fetchDir]);

  // ─── View mode ─────────────────────────────────────────────────────────────

  const toggleViewMode = useCallback(() => {
    setViewMode((prev) => {
      const next = prev === "list" ? "grid" : "list";
      localStorage.setItem("fm-view-mode", next);
      return next;
    });
  }, []);

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

  // ─── Preview helpers ───────────────────────────────────────────────────────

  const openPreview = useCallback((item: FileItem) => {
    setPreviewItem(item);
    setIsEditing(false);
    setEditContent("");
    setEditOriginalContent("");
    setDirSizeInfo(null);
    setDirSizeLoading(false);

    if (item.type === "folder") {
      // Load dir size
      setDirSizeLoading(true);
      apiDirSize(item.id)
        .then((info) => { setDirSizeInfo(info); })
        .catch(() => { setDirSizeInfo(null); })
        .finally(() => { setDirSizeLoading(false); });
      setPreviewContent(null);
    } else if (isTextFile(item.name)) {
      setPreviewLoading(true);
      setPreviewContent(null);
      apiPreview(item.id)
        .then((content) => { setPreviewContent(content); })
        .catch(() => { setPreviewContent("Error loading file"); })
        .finally(() => { setPreviewLoading(false); });
    } else {
      setPreviewContent(null);
    }
  }, []);

  const hasUnsavedChanges = isEditing && editContent !== editOriginalContent;

  const handleClosePreview = useCallback(() => {
    if (hasUnsavedChanges) {
      setDiscardDialogOpen(true);
    } else {
      setPreviewItem(null);
      setIsEditing(false);
    }
  }, [hasUnsavedChanges]);

  const handleConfirmDiscard = useCallback(() => {
    setDiscardDialogOpen(false);
    setPreviewItem(null);
    setIsEditing(false);
  }, []);

  // ─── Row click / navigate ──────────────────────────────────────────────────

  const handleRowClick = useCallback((item: FileItem) => {
    if (renamingId) return;
    if (item.type === "folder") {
      navigateTo(item.id);
    } else {
      openPreview(item);
    }
  }, [renamingId, navigateTo, openPreview]);

  // ─── Inline editor ────────────────────────────────────────────────────────

  const startEditing = useCallback(() => {
    if (previewContent !== null) {
      setEditContent(previewContent);
      setEditOriginalContent(previewContent);
      setIsEditing(true);
    }
  }, [previewContent]);

  const cancelEditing = useCallback(() => {
    setIsEditing(false);
    setEditContent("");
    setEditOriginalContent("");
  }, []);

  const handleSaveFile = useCallback(async () => {
    if (!previewItem) return;
    setSavingFile(true);
    try {
      await apiSave(previewItem.id, editContent);
      toast.success("File saved");
      setIsEditing(false);
      setPreviewContent(editContent);
      setEditOriginalContent(editContent);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSavingFile(false);
    }
  }, [previewItem, editContent, refresh]);

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
    if (renamingRef.current) return;
    if (!renamingId || !renameValue.trim()) {
      setRenamingId(null);
      return;
    }
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
      const result = await apiMoveOrCopy(moveCopyAction, moveCopyIds, moveCopyTarget);
      if (!result.ok && "conflicts" in result) {
        // Conflicts detected — show resolution dialog
        setMoveCopyDialogOpen(false);
        setConflictFiles(result.conflicts);
        setConflictContext({ type: "movecopy", action: moveCopyAction, ids: moveCopyIds, targetId: moveCopyTarget });
        setConflictDialogOpen(true);
        return;
      }
      setMoveCopyDialogOpen(false);
      toast.success(`${moveCopyAction === "move" ? "Moved" : "Copied"} ${moveCopyIds.length} item${moveCopyIds.length > 1 ? "s" : ""}`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Failed to ${moveCopyAction}`);
    } finally {
      setMutating(false);
    }
  }, [moveCopyAction, moveCopyIds, moveCopyTarget, refresh]);

  // Execute move/copy/upload with a conflict resolution
  const handleConflictResolve = useCallback(async (resolution: "replace" | "keep-both") => {
    setConflictDialogOpen(false);
    setMutating(true);
    try {
      if (conflictContext?.type === "movecopy") {
        await apiMoveOrCopy(conflictContext.action, conflictContext.ids, conflictContext.targetId, resolution);
        toast.success(`${conflictContext.action === "move" ? "Moved" : "Copied"} ${conflictContext.ids.length} item${conflictContext.ids.length > 1 ? "s" : ""}`);
      } else if (conflictContext?.type === "upload") {
        await apiUpload(conflictContext.parentId, conflictContext.files, resolution);
        toast.success(`Uploaded ${conflictContext.files.length} file${conflictContext.files.length > 1 ? "s" : ""}`);
      }
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Operation failed");
    } finally {
      setMutating(false);
      setConflictContext(null);
      setConflictFiles([]);
    }
  }, [conflictContext, refresh]);

  const handleConflictCancel = useCallback(() => {
    setConflictDialogOpen(false);
    setConflictContext(null);
    setConflictFiles([]);
  }, []);

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
      const result = await apiUpload(currentPath, files);
      if (!result.ok && "conflicts" in result) {
        // Conflicts detected — show resolution dialog
        setConflictFiles(result.conflicts);
        setConflictContext({ type: "upload", parentId: currentPath, files });
        setConflictDialogOpen(true);
        return;
      }
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

  // ─── Item icon helper ──────────────────────────────────────────────────────

  const itemIcon = useCallback((item: FileItem, size: string = "h-4 w-4") => {
    if (item.type === "folder") {
      return <Folder className={cn(size, "shrink-0 text-primary/70")} />;
    }
    if (isImageFile(item.name)) {
      return <FileImage className={cn(size, "shrink-0 text-emerald-500/70")} />;
    }
    if (isTextFile(item.name)) {
      return <FileText className={cn(size, "shrink-0 text-muted-foreground")} />;
    }
    return <File className={cn(size, "shrink-0 text-muted-foreground")} />;
  }, []);

  // ─── Dropdown menu for items ───────────────────────────────────────────────

  const renderDropdownMenu = useCallback((item: FileItem) => (
    <DropdownMenuContent align="end">
      <DropdownMenuItem onClick={() => openPreview(item)}>
        <Info className="h-4 w-4 mr-2" />
        Properties
      </DropdownMenuItem>
      <DropdownMenuSeparator />
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
  ), [openPreview, handleDownload, handleCopyPath, startRename, openMoveCopy, openDeleteDialog]);

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
          {currentPath !== "/" && (
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 h-8 w-8"
              onClick={() => navigateTo(parentPath(currentPath))}
              title="Go back (Backspace)"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
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
        <div className="flex items-center gap-1">
          <div className="relative w-52">
            {searchLoading ? (
              <Loader2 className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground animate-spin pointer-events-none" />
            ) : (
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            )}
            <Input
              placeholder={globalSearch ? "Search all folders…" : "Filter…"}
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="h-8 pl-8 text-xs"
            />
          </div>
          <Button
            variant={globalSearch ? "default" : "ghost"}
            size="icon"
            className="h-8 w-8"
            onClick={toggleGlobalSearch}
            title={globalSearch ? "Global search (on)" : "Global search (off)"}
          >
            <Globe className="h-3.5 w-3.5" />
          </Button>
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
          {/* View toggle */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={toggleViewMode}
            title={viewMode === "list" ? "Switch to grid view" : "Switch to list view"}
          >
            {viewMode === "list" ? <LayoutGrid className="h-4 w-4" /> : <List className="h-4 w-4" />}
          </Button>
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

      {/* Content area */}
      <div className="bg-card rounded-xl border overflow-hidden">
        {loading ? (
          <div className="relative min-h-[300px]">
            <ContainerLoader label="Loading files…" />
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
                {searchQuery && globalSearch
                  ? `No files matching "${searchQuery}" across all folders`
                  : searchQuery
                    ? `No files matching "${searchQuery}"`
                    : "This directory has no files or folders. Drag files here or use the toolbar to create one."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : viewMode === "list" ? (
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
                  {globalSearch && globalResults !== null && (
                    <TableHead className="hidden sm:table-cell">
                      <span className="text-muted-foreground">Location</span>
                    </TableHead>
                  )}
                  <TableHead className="w-24 hidden sm:table-cell">
                    <button type="button" className="flex items-center hover:text-foreground transition-colors" onClick={() => handleSort("size")}>
                      Size {sortIndicator("size")}
                    </button>
                  </TableHead>
                  <TableHead className="w-28 hidden lg:table-cell">
                    <span className="text-muted-foreground">Owner</span>
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
                        {itemIcon(item)}
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
                    {globalSearch && globalResults !== null && (
                      <TableCell className="hidden sm:table-cell text-muted-foreground text-xs">
                        <button
                          type="button"
                          className="hover:text-foreground hover:underline transition-colors truncate max-w-40 block text-left"
                          onClick={(e) => { e.stopPropagation(); navigateTo(parentFolder(item.id)); }}
                          title={`Go to ${parentFolder(item.id)}`}
                        >
                          {parentFolder(item.id) === "/" ? "/" : parentFolder(item.id)}
                        </button>
                      </TableCell>
                    )}
                    <TableCell className="hidden sm:table-cell text-muted-foreground text-xs">
                      {item.type === "file" ? formatSize(item.size) : "—"}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-xs">
                      <span className={cn(
                        "inline-flex items-center gap-1 font-mono text-[11px]",
                        item.ownerMismatch ? "text-amber-500" : "text-muted-foreground",
                      )}>
                        {item.ownerMismatch && <AlertCircle className="h-3 w-3 shrink-0" />}
                        {item.owner}:{item.group}
                      </span>
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
                        {renderDropdownMenu(item)}
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {/* Footer: item count */}
            <div className="px-4 py-2 border-t text-xs text-muted-foreground flex items-center gap-2">
              <span>{totalCount} result{totalCount !== 1 ? "s" : ""}</span>
              {globalSearch && globalResults !== null && (
                <>
                  <span>·</span>
                  <span className="flex items-center gap-1"><Globe className="h-3 w-3" /> Global search</span>
                </>
              )}
              {selectedCount > 0 && (
                <>
                  <span>·</span>
                  <span>{selectedCount} selected</span>
                </>
              )}
              {!globalSearch && searchQuery && items.length !== totalCount && (
                <>
                  <span>·</span>
                  <span>{items.length} total</span>
                </>
              )}
            </div>
          </>
        ) : (
          /* Grid view */
          <>
            <div className="p-4">
              <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
                {filteredItems.map((item) => (
                  <div
                    key={item.id}
                    className={cn(
                      "bg-card rounded-lg border p-3 cursor-pointer hover:bg-accent/50 transition-colors relative group",
                      selected.has(item.id) && "ring-2 ring-primary bg-accent/30",
                    )}
                    onClick={() => handleRowClick(item)}
                  >
                    {/* Selection checkbox */}
                    <div
                      className="absolute top-2 left-2 z-10"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Checkbox
                        checked={selected.has(item.id)}
                        onCheckedChange={() => toggleSelect(item.id)}
                        className={cn(
                          "h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity",
                          selected.has(item.id) && "opacity-100",
                        )}
                        aria-label={`Select ${item.name}`}
                      />
                    </div>
                    {/* Dropdown menu */}
                    <div
                      className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-6 w-6">
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        {renderDropdownMenu(item)}
                      </DropdownMenu>
                    </div>
                    {/* Thumbnail / Icon */}
                    <div className="flex items-center justify-center mb-2 pt-2">
                      {item.type === "folder" ? (
                        <Folder className="h-12 w-12 text-primary/60" />
                      ) : isImageFile(item.name) ? (
                        <div className="aspect-square w-full max-w-[100px] mx-auto overflow-hidden rounded-md bg-muted/20">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`/api/file-manager?serve=true&id=${encodeURIComponent(item.id)}`}
                            alt={item.name}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        </div>
                      ) : isTextFile(item.name) ? (
                        <FileText className="h-12 w-12 text-muted-foreground/60" />
                      ) : (
                        <File className="h-12 w-12 text-muted-foreground/60" />
                      )}
                    </div>
                    {/* Name + size */}
                    <p className="text-xs font-medium truncate text-center">{item.name}</p>
                    <p className="text-[10px] text-muted-foreground text-center mt-0.5">
                      {item.type === "file" ? formatSize(item.size) : "Folder"}
                    </p>
                  </div>
                ))}
              </div>
            </div>
            {/* Footer */}
            <div className="px-4 py-2 border-t text-xs text-muted-foreground flex items-center gap-2">
              <span>{totalCount} result{totalCount !== 1 ? "s" : ""}</span>
              {globalSearch && globalResults !== null && (
                <>
                  <span>·</span>
                  <span className="flex items-center gap-1"><Globe className="h-3 w-3" /> Global search</span>
                </>
              )}
              {selectedCount > 0 && (
                <>
                  <span>·</span>
                  <span>{selectedCount} selected</span>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* File/Folder Preview Sheet */}
      <Sheet
        open={previewItem !== null}
        onOpenChange={(open) => {
          if (!open) handleClosePreview();
        }}
      >
        <SheetContent
          className="sm:max-w-xl p-0 flex flex-col gap-0 overflow-hidden"
          showCloseButton={false}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
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
                      {previewItem.type === "folder"
                        ? "Folder"
                        : `${fileExtension(previewItem.name) ? `${fileExtension(previewItem.name)} File` : "File"} · ${formatSize(previewItem.size)}`}
                    </p>
                  )}
                </div>
              </SheetTitle>
            </SheetHeader>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={handleClosePreview}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Folder preview */}
          {previewItem && previewItem.type === "folder" && (
            <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
              {/* Quick actions bar */}
              <div className="flex items-center gap-1.5 px-5 py-2.5 border-b bg-muted/30 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-7 text-xs"
                  onClick={() => { setPreviewItem(null); navigateTo(previewItem.id); }}
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  Open
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-7 text-xs"
                  onClick={() => handleCopyPath(previewItem.id)}
                >
                  <ClipboardCopy className="h-3.5 w-3.5" />
                  Copy path
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
                  className="gap-1.5 h-7 text-xs text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/10"
                  onClick={() => { openDeleteDialog([previewItem.id]); setPreviewItem(null); }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
              </div>

              {/* Folder stats */}
              <div className="flex-1 min-h-0 overflow-auto px-5 py-4">
                <p className="text-xs font-semibold text-foreground mb-3">Folder Statistics</p>
                {dirSizeLoading ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Calculating folder size…</span>
                  </div>
                ) : dirSizeInfo ? (
                  <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <HardDrive className="h-3 w-3" />
                      <span>Total size</span>
                    </div>
                    <span className="text-foreground">{formatSize(dirSizeInfo.size)}{dirSizeInfo.size > 1024 ? ` (${dirSizeInfo.size.toLocaleString()} bytes)` : ""}</span>

                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <File className="h-3 w-3" />
                      <span>Files</span>
                    </div>
                    <span className="text-foreground">{dirSizeInfo.fileCount.toLocaleString()}</span>

                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Folder className="h-3 w-3" />
                      <span>Subfolders</span>
                    </div>
                    <span className="text-foreground">{dirSizeInfo.folderCount.toLocaleString()}</span>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Could not calculate folder size</p>
                )}
              </div>

              {/* Folder details */}
              <div className="border-t bg-muted/20 shrink-0">
                <div className="px-5 py-3">
                  <p className="text-xs font-semibold text-foreground mb-2.5">Details</p>
                  <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
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
                      <Shield className="h-3 w-3" />
                      <span>Permissions</span>
                    </div>
                    <span className="text-foreground font-mono text-[11px]">{previewItem.permissions}</span>

                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Shield className="h-3 w-3" />
                      <span>Owner</span>
                    </div>
                    <span className={cn(
                      "font-mono text-[11px]",
                      previewItem.ownerMismatch ? "text-amber-500 flex items-center gap-1" : "text-foreground",
                    )}>
                      {previewItem.ownerMismatch && <AlertCircle className="h-3 w-3 shrink-0 inline" />}
                      {previewItem.owner}:{previewItem.group}
                      {previewItem.ownerMismatch && (
                        <span className="text-[10px] ml-1 font-sans">(mismatch)</span>
                      )}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* File preview */}
          {previewItem && previewItem.type === "file" && (
            <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
              {/* Quick actions bar / Edit actions bar */}
              {isEditing ? (
                <div className="flex items-center gap-1.5 px-5 py-2.5 border-b bg-muted/30 shrink-0">
                  <Button
                    size="sm"
                    className="gap-1.5 h-7 text-xs"
                    onClick={handleSaveFile}
                    disabled={savingFile}
                  >
                    {savingFile ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    Save
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 h-7 text-xs"
                    onClick={cancelEditing}
                    disabled={savingFile}
                  >
                    <X className="h-3.5 w-3.5" />
                    Cancel
                  </Button>
                  {hasUnsavedChanges && (
                    <span className="text-[10px] text-amber-500 ml-2">Unsaved changes</span>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-1.5 px-5 py-2.5 border-b bg-muted/30 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 h-7 text-xs"
                    onClick={() => handleDownload(previewItem.id)}
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download
                  </Button>
                  {isTextFile(previewItem.name) && previewContent !== null && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 h-7 text-xs"
                      onClick={startEditing}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                  )}
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
              )}

              {/* Preview content area */}
              <div className="flex-1 min-h-0 overflow-hidden">
                {isEditing ? (
                  <div className="h-full flex flex-col p-5">
                    <textarea
                      className="flex-1 w-full rounded-lg border bg-muted/30 p-4 font-mono text-xs leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      spellCheck={false}
                    />
                  </div>
                ) : isImageFile(previewItem.name) ? (
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
                    <div className="relative min-h-[200px]">
                      <ContainerLoader label="Loading preview…" />
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
              {!isEditing && (
                <div className="border-t bg-muted/20 shrink-0">
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

                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Shield className="h-3 w-3" />
                        <span>Owner</span>
                      </div>
                      <span className={cn(
                        "font-mono text-[11px]",
                        previewItem.ownerMismatch ? "text-amber-500 flex items-center gap-1" : "text-foreground",
                      )}>
                        {previewItem.ownerMismatch && <AlertCircle className="h-3 w-3 shrink-0 inline" />}
                        {previewItem.owner}:{previewItem.group}
                        {previewItem.ownerMismatch && (
                          <span className="text-[10px] ml-1 font-sans">(mismatch)</span>
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Discard unsaved changes dialog */}
      <AlertDialog open={discardDialogOpen} onOpenChange={setDiscardDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes to this file. Are you sure you want to close without saving?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDiscard}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
              {deleteIds.length === 1
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

      {/* Conflict Resolution Dialog */}
      <AlertDialog open={conflictDialogOpen} onOpenChange={(open) => { if (!open) handleConflictCancel(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {conflictFiles.length === 1
                ? `"${conflictFiles[0]}" already exists`
                : `${conflictFiles.length} files already exist`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p className="mb-2">
                  The destination already contains {conflictFiles.length === 1 ? "a file" : "files"} with the same name{conflictFiles.length > 1 ? "s" : ""}:
                </p>
                <ul className="list-disc pl-5 text-xs text-muted-foreground max-h-32 overflow-y-auto space-y-0.5">
                  {conflictFiles.slice(0, 10).map((f) => (
                    <li key={f} className="font-mono">{f}</li>
                  ))}
                  {conflictFiles.length > 10 && (
                    <li className="text-muted-foreground/60">…and {conflictFiles.length - 10} more</li>
                  )}
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel onClick={handleConflictCancel}>Cancel</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => handleConflictResolve("keep-both")}
              disabled={mutating}
            >
              {mutating && <Loader2 className="h-4 w-4 animate-spin" />}
              Keep both
            </Button>
            <AlertDialogAction
              onClick={() => handleConflictResolve("replace")}
              disabled={mutating}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {mutating && <Loader2 className="h-4 w-4 animate-spin" />}
              Replace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
