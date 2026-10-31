import { HTML_SANDBOX_PERMISSIONS } from "@/shared/embeddedHtml";

/** A live page in a sandboxed frame, drawn at a quarter of a 960×540 viewport. */
export function PagePreview({ src, title }: { src: string; title: string }) {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-md border bg-background">
      <iframe
        src={src}
        title={title}
        sandbox={HTML_SANDBOX_PERMISSIONS}
        loading="lazy"
        tabIndex={-1}
        width={960}
        height={540}
        className="absolute top-0 left-0 origin-top-left scale-[0.25] border-0"
      />
    </div>
  );
}
