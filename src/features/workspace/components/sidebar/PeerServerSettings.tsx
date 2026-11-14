import { useQuery } from "@tanstack/react-query";
import { Network } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { CollapsibleSection } from "@/shared/ui/section-heading";
import { Skeleton } from "@/shared/ui/skeleton";
import { workspaceQueries } from "../../queries";

/** The owner's other Toy Box servers on this tailnet that answer, whose channel leads this
 *  server's leads can message. They're read when Settings opens, so the collapsed section still
 *  counts them, and each opens its own web app, where it updates and restarts. */
export function PeerServerSettings() {
  const { data: servers, isPending } = useQuery(workspaceQueries.peerServers);

  return (
    <CollapsibleSection
      title="Peer Servers"
      icon={Network}
      badge={servers?.length}
      defaultOpen={false}
    >
      <div className="grid gap-3">
        {isPending ? (
          <Skeleton className="h-3 w-28" />
        ) : servers?.length ? (
          servers.map((server) => (
            <div key={server.origin} className="grid min-w-0">
              <div className="flex h-5 items-center gap-2 text-sm">
                <span className="truncate">{server.name}</span>
                <Badge variant="count">{server.version}</Badge>
              </div>
              <a
                href={server.origin}
                target="_blank"
                rel="noreferrer"
                className="w-fit max-w-full truncate text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                {server.origin}
              </a>
            </div>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">
            Your other Toy Box Macs on this tailnet show up here.
          </span>
        )}
      </div>
    </CollapsibleSection>
  );
}
