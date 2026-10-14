import { useEffect, useRef } from 'react';

export function useClickOutside<T extends HTMLElement>(onOutside: () => void, active = true) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!active) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onOutside, active]);
  return ref;
}
