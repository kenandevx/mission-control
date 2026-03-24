import { IconTrendingDown, IconTrendingUp } from "@tabler/icons-react"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { type BoardState } from "@/types/tasks"

export function SectionCards({ board, logs24h = 0 }: { board: BoardState; logs24h?: number }) {
  const getCountByMatcher = (matcher: (columnId: string) => boolean) =>
    board.columnOrder
      .filter(matcher)
      .reduce((total, columnId) => total + (board.ticketIdsByColumn[columnId]?.length ?? 0), 0)

  const matchBacklog = (columnId: string) => {
    const title = board.columns[columnId]?.title.toLowerCase() ?? ""
    return (
      columnId === "backlog" ||
      title.includes("backlog") ||
      title.includes("planned") ||
      title.includes("todo")
    )
  }

  const matchInProgress = (columnId: string) => {
    const title = board.columns[columnId]?.title.toLowerCase() ?? ""
    return (
      columnId === "in_progress" ||
      title.includes("progress") ||
      title.includes("upcoming") ||
      title.includes("active")
    )
  }

  const matchReview = (columnId: string) => {
    const title = board.columns[columnId]?.title.toLowerCase() ?? ""
    return columnId === "review" || title.includes("review")
  }

  const matchDone = (columnId: string) => {
    const title = board.columns[columnId]?.title.toLowerCase() ?? ""
    return columnId === "done" || title.includes("done") || title.includes("complete")
  }

  const total = Object.keys(board.tickets).length
  const backlog = getCountByMatcher(matchBacklog)
  const inProgress = getCountByMatcher(matchInProgress)
  const inReview = getCountByMatcher(matchReview)
  const done = getCountByMatcher(matchDone)
  const doneRate = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <div className="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-5">
      <Card data-slot="card">
        <CardHeader>
          <CardDescription>Total Tickets</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {total}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              <IconTrendingUp />
              All
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            Across all columns <IconTrendingUp className="size-4" />
          </div>
          <div className="text-muted-foreground">{backlog} in backlog</div>
        </CardFooter>
      </Card>

      <Card data-slot="card">
        <CardHeader>
          <CardDescription>In Progress</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {inProgress}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              <IconTrendingUp />
              Active
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            Currently being worked on
          </div>
          <div className="text-muted-foreground">
            {inReview} awaiting review
          </div>
        </CardFooter>
      </Card>

      <Card data-slot="card">
        <CardHeader>
          <CardDescription>In Review</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {inReview}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              <IconTrendingDown />
              Review
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            Pending approval
          </div>
          <div className="text-muted-foreground">Ready for sign-off</div>
        </CardFooter>
      </Card>

      <Card data-slot="card">
        <CardHeader>
          <CardDescription>Completed</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {done}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              <IconTrendingUp />
              {doneRate}%
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            {doneRate}% completion rate <IconTrendingUp className="size-4" />
          </div>
          <div className="text-muted-foreground">
            {done} of {total} tickets done
          </div>
        </CardFooter>
      </Card>

      <Card data-slot="card">
        <CardHeader>
          <CardDescription>Logs (24h)</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {logs24h}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              <IconTrendingUp />
              Live
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">Recent agent/system log events</div>
          <div className="text-muted-foreground">Last 24 hours across workspace</div>
        </CardFooter>
      </Card>
    </div>
  )
}
