import { useEffect, useState } from "react";

/** The current time, refreshed each minute while `active`, so one clock serves a list's countdowns. */
export function useMinuteClock(active: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}
