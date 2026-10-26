/**
 * Viewer layout by screen size. The media queries are the same as in styles.css:
 *  - wide:    side panels (desktops, landscape tablets);
 *  - sheet:   the panel is a bottom sheet (phones, portrait tablets);
 *  - compact: slim side panels for very short screens (phones held sideways).
 */
import { useSyncExternalStore } from 'react';
import type { SheetStop } from './store';

export type ViewerLayout = 'wide' | 'sheet' | 'compact';

const COMPACT = '(max-height: 520px)';
const SHEET = '(max-width: 980px) and (min-height: 521px)';

export function viewerLayout(): ViewerLayout {
  if (typeof matchMedia !== 'function') return 'wide';
  if (matchMedia(COMPACT).matches) return 'compact';
  return matchMedia(SHEET).matches ? 'sheet' : 'wide';
}

export function useViewerLayout(): ViewerLayout {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('resize', cb);
      return () => window.removeEventListener('resize', cb);
    },
    viewerLayout,
  );
}

/** Height of the sheet showing at `peek`: the grip, the part search and the tabs, plus the first line below. */
export const SHEET_PEEK = 176;

/** How much of the bottom sheet shows at each stop, for a sheet `height` pixels tall. */
export function sheetVisible(stop: SheetStop, height: number): number {
  if (stop === 'peek') return Math.min(SHEET_PEEK, height);
  if (stop === 'half') return Math.min(height, Math.round(window.innerHeight * 0.52));
  return height;
}
