import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link2, Loader2, X } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { CollapsibleSection } from "@/shared/ui/section-heading";
import { Skeleton } from "@/shared/ui/skeleton";
import { useWorkspaceSelector } from "../../hooks/state";
import { workspaceMutations } from "../../mutations";
import { workspaceQueries } from "../../queries";

/** The owner's other Toy Box servers, whose channel leads this server's leads can message. Each
 *  opens its own web app, where it updates and restarts. */
export function LinkedServerSettings() {
  const links = useWorkspaceSelector((workspace) => workspace.settings.serverLinks);
  const linking = useMutation(workspaceMutations.linkServer());
  const { mutate: unlink } = useMutation(workspaceMutations.unlinkServer());
  const [address, setAddress] = useState("");

  return (
    <CollapsibleSection
      title="Linked Servers"
      icon={Link2}
      badge={links.length}
      defaultOpen={false}
    >
      <div className="grid gap-3">
        {links.map((link) => (
          <div key={link} className="flex items-center gap-2">
            <div className="grid min-w-0">
              <div className="flex h-5 items-center gap-2 text-sm">
                <LinkedServer link={link} />
              </div>
              <a
                href={link}
                target="_blank"
                rel="noreferrer"
                className="w-fit max-w-full truncate text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                {link}
              </a>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="ml-auto text-muted-foreground"
              aria-label={`Unlink ${link}`}
              onClick={() => unlink(link)}
            >
              <X />
            </Button>
          </div>
        ))}
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            linking.mutate(address, { onSuccess: () => setAddress("") });
          }}
        >
          <Input
            aria-label="Server address"
            value={address}
            onChange={(event) => {
              setAddress(event.currentTarget.value);
              linking.reset();
            }}
            placeholder="mac-mini.tail1234.ts.net"
            spellCheck={false}
            autoCapitalize="off"
          />
          <Button type="submit" variant="outline" disabled={!address.trim() || linking.isPending}>
            {linking.isPending ? <Loader2 className="animate-spin" /> : <Link2 />}
            Link
          </Button>
        </form>
        {linking.error && <span className="text-xs text-destructive">{linking.error.message}</span>}
      </div>
    </CollapsibleSection>
  );
}

/** A linked server's name and release as it answers, read only while its row is mounted. */
function LinkedServer({ link }: { link: string }) {
  const { data: server, isPending, isError } = useQuery(workspaceQueries.linkedServer(link));
  if (isPending) return <Skeleton className="h-3 w-28" />;
  if (isError) return <span className="text-muted-foreground">Can't reach</span>;
  return (
    <>
      <span className="truncate">{server.name}</span>
      <Badge variant="count">{server.version}</Badge>
    </>
  );
}
