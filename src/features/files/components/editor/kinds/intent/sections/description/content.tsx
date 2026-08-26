import { code } from "@streamdown/code";
import { Streamdown } from "streamdown";
import { cn } from "@/shared/utils";
import type { ListSection, MarkdownSection } from "../../model/index";

/** Render the two literal description forms without introducing another domain type. */
export function IntentMarkdownOrListContent({
  section,
}: {
  section: MarkdownSection | ListSection;
}) {
  if (section.kind === "markdown") {
    return (
      <Streamdown
        mode="static"
        plugins={{ code }}
        className="text-[12px] leading-relaxed text-foreground/90 [&_ol]:my-2 [&_p]:my-2 [&_pre]:my-2 [&_ul]:my-2"
      >
        {section.body}
      </Streamdown>
    );
  }

  const List = section.style === "ordered" ? "ol" : "ul";
  return (
    <List
      className={cn(
        "space-y-1 pl-4 text-[11.5px] text-foreground/90",
        section.style === "ordered" ? "list-decimal" : "list-disc",
      )}
    >
      {section.items.map((item) => (
        <li key={item}>
          <Streamdown
            mode="static"
            plugins={{ code }}
            className="space-y-1 [&_ol]:my-1 [&_p]:my-0 [&_pre]:my-1 [&_ul]:my-1"
          >
            {item}
          </Streamdown>
        </li>
      ))}
    </List>
  );
}
