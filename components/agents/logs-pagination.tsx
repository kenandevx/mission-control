import Link from "next/link";
import { Button } from "@/components/ui/button";

type LogsPaginationProps = {
  buildHref: (page: number) => string;
  page: number;
  pageCount: number;
  shownCount: number;
  totalCount: number;
};

function getVisiblePages(page: number, pageCount: number) {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const pages = new Set<number>([1, pageCount, page - 1, page, page + 1]);
  if (page <= 3) {
    pages.add(2);
    pages.add(3);
    pages.add(4);
  }
  if (page >= pageCount - 2) {
    pages.add(pageCount - 1);
    pages.add(pageCount - 2);
    pages.add(pageCount - 3);
  }

  return [...pages].filter((value) => value >= 1 && value <= pageCount).sort((a, b) => a - b);
}

export function LogsPagination({
  buildHref,
  page,
  pageCount,
  shownCount,
  totalCount,
}: LogsPaginationProps) {
  const pages = getVisiblePages(page, pageCount);

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card px-4 py-3 text-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground">
          Showing {shownCount} of {totalCount} events.
        </p>
        <div className="flex items-center gap-2">
          {page <= 1 ? (
            <Button variant="outline" size="sm" disabled>
              Previous
            </Button>
          ) : (
            <Button asChild variant="outline" size="sm">
              <Link href={buildHref(page - 1)}>Previous</Link>
            </Button>
          )}
          {page >= pageCount ? (
            <Button variant="outline" size="sm" disabled>
              Next
            </Button>
          ) : (
            <Button asChild variant="outline" size="sm">
              <Link href={buildHref(page + 1)}>Next</Link>
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {pages.map((value, index) => {
          const previous = pages[index - 1];
          const showGap = typeof previous === "number" && value - previous > 1;
          return (
            <div key={value} className="flex items-center gap-2">
              {showGap ? <span className="text-muted-foreground">...</span> : null}
              <Button asChild={value !== page} variant={value === page ? "default" : "outline"} size="sm">
                {value === page ? <span>{value}</span> : <Link href={buildHref(value)}>{value}</Link>}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
