import { Streamdown, type Components } from "streamdown";

const INLINE_COMPONENTS = { p: "span" } satisfies Components;
const INLINE_ELEMENTS = ["p", "strong", "em", "del", "code", "a", "br"] as const;

export function IntentMarkdownText({ children }: { children: string }) {
  return (
    <Streamdown
      mode="static"
      allowedElements={INLINE_ELEMENTS}
      components={INLINE_COMPONENTS}
      unwrapDisallowed
      className="inline [&_[data-streamdown=inline-code]]:text-[1em]"
    >
      {children}
    </Streamdown>
  );
}
