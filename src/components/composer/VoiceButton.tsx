import { Loader2, Mic, PhoneOff } from "lucide-react";
import { InputGroupButton } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
import { useVoiceComposer, type VoiceComposerContext } from "./useVoiceComposer";

export function VoiceButton({ context }: { context: VoiceComposerContext }) {
  const { status, connect, disconnect } = useVoiceComposer(context);
  const isConnected = status === "connected";
  const isConnecting = status === "connecting";

  return (
    <InputGroupButton
      type="button"
      size="icon-xs"
      aria-label={isConnected ? "Disconnect voice call" : "Connect voice call"}
      aria-pressed={isConnected}
      onClick={() => void (isConnected ? disconnect() : connect())}
      disabled={isConnecting}
      suppressHydrationWarning
      className={cn(
        isConnected && "text-destructive hover:text-destructive hover:bg-destructive/10",
      )}
    >
      {isConnecting ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : isConnected ? (
        <PhoneOff className="h-4 w-4" />
      ) : (
        <Mic className="h-4 w-4" />
      )}
    </InputGroupButton>
  );
}
