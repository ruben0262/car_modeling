/** Viewer UI state. The 3D viewer subscribes to this store; it never owns UI state itself. */
import { create } from 'zustand';
import type { Manifest, RuntimeNode } from '../shared/manifest';
import type { ColorMode } from '../viewer/VehicleModel';

export type SectionAxis = 'x' | 'y' | 'z' | null;
export type PanelTab = 'details' | 'parts' | 'wiring' | 'checks';
/** How far the panel is pulled up on phones (a bottom sheet); ignored where it is a side panel. */
export type SheetStop = 'peek' | 'half' | 'full';

export interface ViewerState {
  manifest: Manifest | null;
  nodes: Map<string, RuntimeNode>;
  status: 'idle' | 'loading' | 'ready' | 'error';
  progress: number;
  error: string | null;
  loadMs: number | null;

  selected: string | null;
  hovered: string | null;
  /** The hover came from the 3D view, so the tooltip shows (hovers in the panel only highlight). */
  hoverTip: boolean;
  hiddenSystems: Set<string>;
  hiddenParts: Set<string>;
  isolate: string | null;
  explode: number;
  brokenDown: Set<string>;
  xray: boolean;
  colorMode: ColorMode;
  section: { axis: SectionAxis; offset: number };
  access: string | null;
  /** Selected wiring-diagram circuit sheet, and the model nodes it highlights. */
  circuit: string | null;
  highlight: Set<string>;
  /** Draw the selected part's (or circuit's) wires in 3D, and the wire emphasised from the panel. */
  wires: boolean;
  wireFocus: string | null;
  /** Wiring publication (model year / issue) shown in the wiring views; null = the vehicle's default. */
  wiringPub: string | null;
  tab: PanelTab;
  sheet: SheetStop;
  /** Camera requests are events, not state: the counter lets the viewer react to repeats. */
  focusRequest: { id: string | null; approach?: string; n: number };

  setManifest(m: Manifest): void;
  setStatus(s: ViewerState['status'], progress?: number, error?: string | null): void;
  setLoadMs(ms: number): void;
  select(id: string | null): void;
  hover(id: string | null, fromCanvas?: boolean): void;
  toggleSystem(id: string): void;
  soloSystem(id: string): void;
  showAllSystems(): void;
  toggleHidePart(id: string): void;
  showAllParts(): void;
  setIsolate(id: string | null): void;
  setExplode(v: number): void;
  toggleBreakdown(id: string): void;
  collapseAll(): void;
  setXray(v: boolean): void;
  setColorMode(m: ColorMode): void;
  setSection(axis: SectionAxis, offset?: number): void;
  setAccess(id: string | null): void;
  setCircuit(id: string | null): void;
  setHighlight(ids: Set<string>): void;
  setWires(v: boolean): void;
  setWireFocus(id: string | null): void;
  setWiringPub(id: string | null): void;
  setTab(t: PanelTab): void;
  setSheet(s: SheetStop): void;
  focus(id: string | null, approach?: string): void;
  reset(): void;
}

/** Layers that start hidden: they frame the car but hide the systems inside it. */
export const DEFAULT_HIDDEN = ['structure', 'interior'];

const initialView = {
  selected: null,
  hovered: null,
  hoverTip: false,
  hiddenSystems: new Set<string>(DEFAULT_HIDDEN),
  hiddenParts: new Set<string>(),
  isolate: null,
  explode: 0,
  brokenDown: new Set<string>(),
  xray: true,
  colorMode: 'realistic' as ColorMode,
  section: { axis: null as SectionAxis, offset: 0 },
  access: null,
  circuit: null as string | null,
  highlight: new Set<string>(),
  wires: true,
  wireFocus: null as string | null,
  wiringPub: null as string | null,
};

export const useViewer = create<ViewerState>((set, get) => ({
  manifest: null,
  nodes: new Map(),
  status: 'idle',
  progress: 0,
  error: null,
  loadMs: null,
  tab: 'details',
  sheet: 'peek',
  focusRequest: { id: null, n: 0 },
  ...initialView,

  setManifest: (m) => set({ manifest: m, nodes: new Map(m.nodes.map((n) => [n.id, n])) }),
  setStatus: (status, progress, error = null) => set({ status, progress: progress ?? get().progress, error }),
  setLoadMs: (ms) => set({ loadMs: ms }),
  select: (id) => set({ selected: id, tab: id ? 'details' : get().tab, access: id && id === get().access ? id : null }),
  hover: (id, fromCanvas = false) => set({ hovered: id, hoverTip: fromCanvas && id !== null }),
  toggleSystem: (id) => {
    const s = new Set(get().hiddenSystems);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    set({ hiddenSystems: s });
  },
  soloSystem: (id) => {
    const all = get().manifest?.systems.map((s) => s.id) ?? [];
    const onlyThis = all.filter((x) => x !== id);
    const already = onlyThis.every((x) => get().hiddenSystems.has(x)) && !get().hiddenSystems.has(id);
    set({ hiddenSystems: already ? new Set() : new Set(onlyThis) });
  },
  showAllSystems: () => set({ hiddenSystems: new Set() }),
  toggleHidePart: (id) => {
    const s = new Set(get().hiddenParts);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    set({ hiddenParts: s, selected: s.has(id) && get().selected === id ? null : get().selected });
  },
  showAllParts: () => set({ hiddenParts: new Set() }),
  setIsolate: (id) => set({ isolate: id }),
  setExplode: (v) => set({ explode: Math.max(0, Math.min(1, v)) }),
  toggleBreakdown: (id) => {
    const s = new Set(get().brokenDown);
    if (s.has(id)) {
      // collapsing an assembly also collapses everything inside it
      const nodes = get().nodes;
      for (const b of [...s]) {
        let cur: string | null = b;
        while (cur) {
          if (cur === id) {
            s.delete(b);
            break;
          }
          cur = nodes.get(cur)?.parent ?? null;
        }
      }
    } else s.add(id);
    // taking an assembly apart first removes whatever blocks it (e.g. the wheel before the caliper)
    const blocked = (get().nodes.get(id)?.access?.removeFirst.length ?? 0) > 0;
    const access = s.has(id) ? (blocked ? id : get().access) : get().access === id ? null : get().access;
    set({ brokenDown: s, access });
  },
  collapseAll: () => set({ brokenDown: new Set() }),
  setXray: (v) => set({ xray: v }),
  setColorMode: (m) => set({ colorMode: m }),
  setSection: (axis, offset) => set({ section: { axis, offset: offset ?? get().section.offset } }),
  setAccess: (id) => set({ access: id }),
  setCircuit: (id) => set({ circuit: id, highlight: id ? get().highlight : new Set() }),
  setHighlight: (ids) => set({ highlight: ids }),
  setWires: (v) => set({ wires: v }),
  setWireFocus: (id) => set({ wireFocus: id }),
  setWiringPub: (id) => set({ wiringPub: id }),
  setTab: (t) => set({ tab: t }),
  setSheet: (sheet) => set({ sheet }),
  focus: (id, approach) => set({ focusRequest: { id, approach, n: get().focusRequest.n + 1 } }),
  reset: () => set({ ...initialView, hiddenSystems: new Set(DEFAULT_HIDDEN), hiddenParts: new Set(), brokenDown: new Set(), highlight: new Set(), focusRequest: { id: null, n: get().focusRequest.n + 1 } }),
}));

/** Ancestors from the root down to (and including) `id`. */
export function pathTo(nodes: Map<string, RuntimeNode>, id: string): RuntimeNode[] {
  const out: RuntimeNode[] = [];
  let cur: string | null = id;
  while (cur) {
    const n = nodes.get(cur);
    if (!n) break;
    out.unshift(n);
    cur = n.parent;
  }
  return out;
}

/** All descendants of a node (depth-first), excluding the node itself. */
export function descendants(nodes: Map<string, RuntimeNode>, id: string): RuntimeNode[] {
  const out: RuntimeNode[] = [];
  const walk = (x: string) => {
    for (const c of nodes.get(x)?.children ?? []) {
      const n = nodes.get(c);
      if (!n) continue;
      out.push(n);
      walk(c);
    }
  };
  walk(id);
  return out;
}
