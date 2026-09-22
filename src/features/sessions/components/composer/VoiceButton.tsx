import { Loader2, Mic, PhoneOff } from "lucide-react";
import { InputGroupButton } from "@/shared/components/ui/input-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import { useVoiceComposer, type VoiceComposerContext } from "./useVoiceComposer";

export function VoiceButton({ context }: { context: VoiceComposerContext }) {
  const { status, connect, disconnect } = useVoiceComposer(context);
  const isConnected = status === "connected";
  const isConnecting = status === "connecting";
  const label = isConnected ? "Stop voice" : "Start voice";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <InputGroupButton
            type="button"
            size="icon-xs"
            variant={isConnected ? "destructive-ghost" : "ghost"}
            aria-label={label}
            aria-pressed={isConnected}
            onClick={() => void (isConnected ? disconnect() : connect())}
            disabled={isConnecting}
            suppressHydrationWarning
          >
            {isConnecting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isConnected ? (
              <PhoneOff className="h-4 w-4" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </InputGroupButton>
        }
      />
      <TooltipContent sideOffset={6}>{label}</TooltipContent>
    </Tooltip>
  );
}
