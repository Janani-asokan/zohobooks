import { useEffect, useRef } from 'react';

type Handler = (e: KeyboardEvent) => void;

const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
};

/**
 * Global shortcuts. Keys: "alt+n", "mod+k" (Ctrl/⌘), "?", "/", and two-key sequences like "g i".
 * Single keys and sequences are ignored while typing in a field.
 */
export function useShortcuts(map: Record<string, Handler>) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    let prefix = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const combo = `${e.ctrlKey || e.metaKey ? 'mod+' : ''}${e.altKey ? 'alt+' : ''}${e.shiftKey && key.length > 1 ? 'shift+' : ''}${e.altKey ? (e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : key) : key}`;
      const m = ref.current;
      if (m[combo] && (combo.includes('+') || /^f\d+$/.test(combo) || !isTyping(e))) {
        e.preventDefault();
        m[combo]!(e);
        return;
      }
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (prefix) {
        const seq = `${prefix} ${key}`;
        prefix = '';
        clearTimeout(timer);
        if (m[seq]) { e.preventDefault(); m[seq]!(e); }
        return;
      }
      if (Object.keys(m).some((k) => k.startsWith(key + ' '))) {
        prefix = key;
        timer = setTimeout(() => (prefix = ''), 900);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export const SHORTCUT_HELP: Array<[string, string]> = [
  ['Ctrl K  or  /', 'Search everything'],
  ['Alt N', 'New invoice'],
  ['Alt P', 'Open POS billing'],
  ['Alt C', 'New customer'],
  ['Alt I', 'New item'],
  ['g h', 'Go to Home'],
  ['g i', 'Go to Invoices'],
  ['g c', 'Go to Customers'],
  ['g t', 'Go to Items'],
  ['g r', 'Go to Reports'],
  ['Ctrl Enter', 'Save the open form (invoice, POS)'],
  ['Esc', 'Close a dialog'],
  ['?', 'Show this list'],
];
