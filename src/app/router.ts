/** Minimal history router: three routes do not justify a routing library. */
import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}
// guarded so the pure helpers that import this module also load in unit tests (node)
if (typeof window !== 'undefined') window.addEventListener('popstate', emit);

export function navigate(path: string, replace = false) {
  const url = BASE + path;
  const go = () => {
    if (replace) history.replaceState(null, '', url);
    else history.pushState(null, '', url);
    emit();
  };
  // pages cross-fade where the browser can (the new page has to be in the DOM when the callback returns)
  const doc = document as Document & { startViewTransition?: (update: () => void) => unknown };
  if (!replace && doc.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) doc.startViewTransition(() => flushSync(go));
  else go();
}

export function useLocation(): { path: string; search: URLSearchParams } {
  const href = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => location.pathname + location.search,
  );
  const url = new URL(href, location.origin);
  const path = url.pathname.startsWith(BASE) ? url.pathname.slice(BASE.length) || '/' : url.pathname;
  return { path, search: url.searchParams };
}

/** Absolute URL for a file under public/. */
export function asset(path: string): string {
  return import.meta.env.BASE_URL + path.replace(/^\//, '');
}
