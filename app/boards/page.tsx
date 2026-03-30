import { BoardsPageClient } from "@/components/tasks/boards/boards-page-client";
import { getBoardsPageData } from "@/lib/db/server-data";
import { PageReveal } from "@/components/ui/page-reveal";

export const dynamic = "force-dynamic";

// Note: getWorkspaceAssignees (runtime snapshot) is NOT called here — it uses
// execFileSync which blocks SSR. Assignees are loaded client-side instead.
export default async function BoardsPage() {
  const initialBoards = await getBoardsPageData();
  return (
    <PageReveal label="Loading boards…">
      <BoardsPageClient initialBoardId={null} initialBoards={initialBoards as never[]} initialAssignees={[] as never[]} sidebarUser={null} />
    </PageReveal>
  );
}
