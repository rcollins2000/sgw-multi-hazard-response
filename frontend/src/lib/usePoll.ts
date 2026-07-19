import { useEffect, useRef, useState } from "react";

/*
  usePoll — a small hook that calls `fetcher` immediately then every
  `intervalMs`, dropping stale results if a newer call has already resolved.

  Used to keep live-mode surfaces in sync with the backend pollers without
  smashing a WebSocket into the demo. Cadences:
    - /api/alerts             — 60s   (matches NWS poll cadence)
    - /api/forecasts/water-level — 5min (Prophet fit is expensive; upstream is 6min)

  The hook returns:
    - `data`         — latest successful payload (or null before first response)
    - `error`        — last error string (or null)
    - `updatedAt`    — ISO timestamp of the last successful update
    - `refresh`      — imperative refresh trigger for user-initiated reloads
*/

export type PollResult<T> = Readonly<{
  data: T | null;
  error: string | null;
  updatedAt: string | null;
  refresh: () => void;
}>;

export function usePoll<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
  deps: readonly unknown[] = [],
): PollResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const inflightSeq = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const seq = ++inflightSeq.current;
      try {
        const next = await fetcher();
        if (cancelled || seq !== inflightSeq.current) return;
        setData(next);
        setError(null);
        setUpdatedAt(new Date().toISOString());
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    };
    run();
    const timer = setInterval(run, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // Deliberately excluding `fetcher` from deps — callers pin what re-triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, nonce, ...deps]);

  return { data, error, updatedAt, refresh: () => setNonce((n) => n + 1) };
}
