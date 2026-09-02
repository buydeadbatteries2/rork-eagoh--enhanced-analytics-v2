import { useEffect, useState } from "react";

/**
 * Phase D2.3S — ticking wall clock (ms since epoch) for time-sensitive UI.
 *
 * Powers the "Sync Live · 2d 4h left" listing indicator: the countdown is
 * derived from the device clock, so a live sync automatically reverts the
 * button to "Purchase" the moment it expires — no app restart and no refetch
 * required for the label (the underlying dataset only changes on refetch).
 */
export function useSyncClock(intervalMs: number = 30_000): number {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return nowMs;
}
