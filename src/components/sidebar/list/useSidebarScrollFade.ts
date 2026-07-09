import { useEffect, useRef } from "react";

export function useSidebarScrollFade(content: string | undefined) {
  const headlineRef = useRef<HTMLDivElement>(null);

  function updateScrollFades() {
    const element = headlineRef.current;
    if (!element) return;

    const left = element.scrollLeft > 0;
    const right = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;

    element.toggleAttribute("data-left-fade", left);
    element.toggleAttribute("data-right-fade", right);
  }

  useEffect(() => {
    const raf = requestAnimationFrame(updateScrollFades);
    let cancelled = false;
    if (document?.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (cancelled) return;
        updateScrollFades();
      });
    }
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
    // React Compiler keeps the dependency-free DOM updater stable.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [content, updateScrollFades]);

  return {
    headlineRef,
    updateScrollFades,
  };
}
