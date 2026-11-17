import { type UIEvent, useRef, useState } from "react";

export function usePause<T>(live: T) {
  const ref = useRef<HTMLElement>(null);
  const [held, setHeld] = useState<{ rows: T } | null>(null);
  const onScroll = (event: UIEvent<HTMLElement>) => {
    const away = event.currentTarget.scrollTop > 0;
    if (away && !held) setHeld({ rows: live });
    else if (!away && held) setHeld(null);
  };
  const resume = () => {
    ref.current?.scrollTo({ top: 0 });
    setHeld(null);
  };
  return {
    rows: held ? held.rows : live,
    paused: held != null,
    ref,
    onScroll,
    resume,
  };
}
