import { Whiteboard } from "@whiteboard/Whiteboard";
import type { EditorProps } from "../index";
import { SvgPaneActions } from "./SvgPaneActions";

/** Adapts the ordinary file lifecycle to the Whiteboard feature. */
export function SvgEditor({ mode, variant, baseUri, file }: EditorProps) {
  return (
    <Whiteboard
      content={file.content ?? ""}
      readOnly={mode === "read"}
      baseUri={baseUri}
      onContentChange={file.save}
      renderActions={(actions) => (
        <SvgPaneActions actions={actions} compact={variant === "compact"} />
      )}
    />
  );
}
