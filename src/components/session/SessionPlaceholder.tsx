import { MessageSquare } from "lucide-react";

// ============================================================================
// Session Placeholder Component
// ============================================================================

export function SessionPlaceholder() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="text-center space-y-4">
        <MessageSquare className="h-16 w-16 mx-auto text-muted-foreground/50" />
        <div className="space-y-2">
          <h3 className="text-lg font-semibold text-foreground">No session selected</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            Select an existing session from the sidebar, or create a new session, in order to start
            building.
          </p>
        </div>
      </div>
    </div>
  );
}
