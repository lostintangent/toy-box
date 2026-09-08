import { Skeleton } from "@/shared/components/ui/skeleton";

export function TranscriptSkeleton() {
  return (
    <div className="h-full space-y-4 bg-panel p-4">
      <div className="flex justify-end">
        <Skeleton className="h-10 w-48 rounded-lg" />
      </div>
      <div className="flex justify-start">
        <div className="space-y-2">
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
      <div className="flex justify-end">
        <Skeleton className="h-10 w-36 rounded-lg" />
      </div>
      <div className="flex justify-start">
        <div className="space-y-2">
          <Skeleton className="h-4 w-72" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>
      <div className="flex justify-end">
        <Skeleton className="h-10 w-52 rounded-lg" />
      </div>
      <div className="flex justify-start">
        <div className="space-y-2">
          <Skeleton className="h-4 w-60" />
          <Skeleton className="h-4 w-52" />
          <Skeleton className="h-4 w-44" />
        </div>
      </div>
    </div>
  );
}
