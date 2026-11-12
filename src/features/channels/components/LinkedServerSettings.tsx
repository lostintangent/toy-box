import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link2, Loader2, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { CollapsibleSection } from "@/shared/ui/section-heading";
import { isLoopbackHostname } from "@/shared/utils";
import { useWorkspaceSelector } from "@workspace/hooks/state";
import { channelMutations } from "../mutations";

/** The owner's other Toy Box servers, whose channel leads this server's leads can message. */
export function LinkedServerSettings() {
  const links = useWorkspaceSelector((workspace) => workspace.settings.serverLinks);
  const linking = useMutation(channelMutations.linkServer());
  const unlinking = useMutation(channelMutations.unlinkServer());
  const [address, setAddress] = useState("");
  const error = (linking.error ?? unlinking.error)?.message.split("\n")[0];

  return (
    <CollapsibleSection
      title="Linked Servers"
      icon={Link2}
      badge={links.length}
      defaultOpen={false}
    >
      <div className="grid gap-3">
        {links.map((link) => (
          <div key={link} className="flex min-h-6 items-center gap-2 text-sm">
            <span className="truncate">{link}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="ml-auto text-muted-foreground"
              aria-label={`Unlink ${link}`}
              disabled={unlinking.isPending}
              onClick={() => unlinking.mutate(link)}
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
        {error && <span className="text-xs text-destructive">{error}</span>}
        <p className="text-xs text-muted-foreground">
          Channel leads here can message the leads on these servers. Linking a server links this one
          there too, and unlinking does the same. A host links over HTTPS, and an http:// address
          links over plain HTTP.
          {isLoopbackHostname(window.location.hostname) &&
            " On localhost, links change only here, so repeat them on the other server."}
        </p>
      </div>
    </CollapsibleSection>
  );
}
