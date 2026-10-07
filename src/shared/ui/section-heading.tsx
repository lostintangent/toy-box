import type { ReactNode } from "react";
import { Badge } from "./badge";

export function SectionHeading({
  title,
  count,
  detail,
}: {
  title: string;
  count: number | string;
  detail?: ReactNode;
}) {
  return (
    <h3 data-slot="section-heading" className="flex h-4.5 items-center gap-1.5">
      <span className="section-heading">{title}</span>
      <Badge variant="count">{count}</Badge>
      {detail && <span className="ms-auto inline-flex shrink-0">{detail}</span>}
    </h3>
  );
}
