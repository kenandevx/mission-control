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
import { Textarea } from "@/components/ui/textarea";

type Props = {
  open: boolean;
  mode?: "create" | "edit";
  title: string;
  description: string;
  error: string;
  onTitleChange: (title: string) => void;
  onDescriptionChange: (description: string) => void;
  onSubmit: () => void;
  onClose: () => void;
};

export function CreateBoardModal({
  open,
  mode = "create",
  title,
  description,
  error,
  onTitleChange,
  onDescriptionChange,
  onSubmit,
  onClose,
}: Props) {
  const isEditMode = mode === "edit";

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{isEditMode ? "Update board" : "Create board"}</DialogTitle>
          <DialogDescription>
            {isEditMode ? "Update the board name and description." : "Create a new board to organize your tickets."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-1">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cb-board-name">
              Board name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="cb-board-name"
              placeholder="For example: Marketing Sprint"
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cb-board-description">Description</Label>
            <Textarea
              id="cb-board-description"
              placeholder="What is this board for?"
              value={description}
              onChange={(e) => onDescriptionChange(e.target.value)}
              rows={3}
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter className="pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={onSubmit}>{isEditMode ? "Save changes" : "Create board"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
