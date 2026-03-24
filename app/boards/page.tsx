import { BoardsPageClient } from "@/components/tasks/boards/boards-page-client";
import { getBoardsPageData, getSidebarUser, getWorkspaceAssignees } from "@/lib/db/server-data";

export const dynamic = "force-dynamic";

export default async function BoardsPage() {
  const [, initialBoards, initialAssignees] = await Promise.all([getSidebarUser(), getBoardsPageData(), getWorkspaceAssignees()]);
  return <BoardsPageClient initialBoardId={null} initialBoards={initialBoards as never[]} initialAssignees={initialAssignees as never[]} sidebarUser={null} />;
}
