import { code } from "@streamdown/code";
import { Markdown } from "@/shared/ui/markdown";
import { cn } from "@/shared/utils";
import type { DescriptionSection } from "../model/index";

/** Render the two literal description forms without introducing another domain type. */
export function DescriptionContent({ section }: { section: DescriptionSection }) {
  if (section.kind === "markdown") {
    return (
      <Markdown plugins={{ code }} className="text-[12px] leading-relaxed text-foreground/90">
        {section.body}
      </Markdown>
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
          <Markdown plugins={{ code }} className="space-y-1">
            {item}
          </Markdown>
        </li>
      ))}
    </List>
  );
}
