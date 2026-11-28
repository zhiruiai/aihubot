import { useEffect, useState } from 'react';

const compactViewport = () =>
  typeof window === 'undefined' ? undefined : window.matchMedia?.('(max-width: 760px)');

export function useCompactAppsViewport() {
  const [compact, setCompact] = useState(() => compactViewport()?.matches ?? false);
  useEffect(() => {
    const viewport = compactViewport();
    if (!viewport) return;
    const update = () => setCompact(viewport.matches);
    viewport.addEventListener('change', update);
    update();
    return () => viewport.removeEventListener('change', update);
  }, []);
  return compact;
}
