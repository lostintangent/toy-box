import type { ReactNode } from "react";
import { createFileServeUrl } from "../../../../model/paths";
import type { EditorProps } from "../index";

// Media renders from the file's URL rather than its text, and each external revision reloads it.

export function ImageViewer({ title, file }: EditorProps) {
  return (
    <MediaFrame>
      <img src={mediaUrl(file)} alt={title} className="max-h-full max-w-full object-contain" />
    </MediaFrame>
  );
}

export function VideoViewer({ file }: EditorProps) {
  return (
    <MediaFrame>
      <video src={mediaUrl(file)} controls playsInline className="max-h-full max-w-full" />
    </MediaFrame>
  );
}

function mediaUrl({ source, revision }: EditorProps["file"]): string {
  return `${createFileServeUrl(source)}?v=${revision}`;
}

function MediaFrame({ children }: { children: ReactNode }) {
  return <div className="flex h-full items-center justify-center p-4">{children}</div>;
}
