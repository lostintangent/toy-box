import { ArrowDown } from "lucide-react";
import { useStickToBottomContext } from "use-stick-to-bottom";
import { Button } from "@/shared/components/ui/button";

export function ScrollToBottomButton() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  if (isAtBottom) return null;

  return (
    <Button
      variant="secondary"
      className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-background shadow-lg"
      onClick={() => scrollToBottom()}
    >
      <ArrowDown className="h-4 w-4" />
      Scroll down
    </Button>
  );
}
