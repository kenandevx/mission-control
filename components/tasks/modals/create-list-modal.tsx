"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  open: boolean;
  title: string;
  error: string;
  onTitleChange: (title: string) => void;
  onSubmit: () => void;
  onClose: () => void;
};

export function CreateListModal({
  open,
  title,
  error,
  onTitleChange,
  onSubmit,
  onClose,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Create list</DialogTitle>
          <DialogDescription>
            Add a new list (column) to your board. For example: "Review", "Blocked", or "Done".
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 py-2">
          <Label htmlFor="cl-list-name">
            List name <span className="text-destructive">*</span>
          </Label>
          <Input
            id="cl-list-name"
            placeholder="For example: Blocked"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            autoFocus
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={onSubmit}>Create list</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
