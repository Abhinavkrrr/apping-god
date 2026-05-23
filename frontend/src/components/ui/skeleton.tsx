import { cn } from "@/lib/utils/cn";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-slate-200/70", className)}
      {...props}
    />
  );
}

export function CardSkeleton() {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 space-y-3">
      <Skeleton className="h-5 w-1/3" />
      <Skeleton className="h-3 w-2/3" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  );
}

export function TileSkeleton() {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 space-y-2">
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="h-7 w-1/3" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  );
}

export function RowSkeleton() {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 flex items-center gap-3">
      <Skeleton className="h-4 w-4" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <Skeleton className="h-8 w-16" />
    </div>
  );
}

export function PageSkeleton({ title, rowCount = 6 }: { title: string; rowCount?: number }) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-3 w-2/3" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => <TileSkeleton key={i} />)}
      </div>
      <div className="space-y-2">
        {Array.from({ length: rowCount }).map((_, i) => <RowSkeleton key={i} />)}
      </div>
      <div className="sr-only">Loading {title}…</div>
    </div>
  );
}
