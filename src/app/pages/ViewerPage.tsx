import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { Catalog, Manifest } from '../../shared/manifest';
import { Viewer } from '../../viewer/Viewer';
import type { DisplayState } from '../../viewer/VehicleModel';
import { InfoPanel } from '../components/InfoPanel';
import { HoverTip, LoadingOverlay, moveHoverTip, SystemRail, ToolDock, ViewBar } from '../components/ViewerChrome';
import { sheetVisible, viewerLayout } from '../layout';
import { asset, navigate } from '../router';
import { pathTo, useViewer, type ViewerState } from '../store';
import { circuitNodes, loadWiring, prepareWiring, routeWires, wiresOfCircuit, wiresOfNode } from '../wiring';

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

function displayOf(s: ViewerState): DisplayState {
  const removed = new Set<string>();
  if (s.access) for (const id of s.nodes.get(s.access)?.access?.removeFirst ?? []) removed.add(id);
  return {
    hiddenSystems: s.hiddenSystems,
    hiddenParts: s.hiddenParts,
    selected: s.selected,
    hovered: s.hovered,
    isolate: s.isolate,
    xray: s.xray,
    colorMode: s.colorMode,
    removed,
    related: s.highlight,
  };
}

/** Pushes store changes into the imperative viewer. */
function sync(v: Viewer, s: ViewerState, p: ViewerState) {
  const model = v.model;
  if (!model) return;
  if (
    s.selected !== p.selected ||
    s.hovered !== p.hovered ||
    s.hiddenSystems !== p.hiddenSystems ||
    s.hiddenParts !== p.hiddenParts ||
    s.isolate !== p.isolate ||
    s.xray !== p.xray ||
    s.colorMode !== p.colorMode ||
    s.access !== p.access ||
    s.highlight !== p.highlight
  )
    v.applyDisplay(displayOf(s));
  if (s.explode !== p.explode || s.brokenDown !== p.brokenDown || s.access !== p.access) {
    model.applyExplode(s.explode, s.brokenDown, displayOf(s).removed);
    v.invalidate();
  }
  // selecting or breaking down something inside a lazily loaded assembly pulls its detail chunk
  const needDetail = new Set<string>();
  if (s.selected && s.selected !== p.selected) for (const n of pathTo(s.nodes, s.selected)) if (n.detailChunk && n.id !== s.selected) needDetail.add(n.id);
  if (s.brokenDown !== p.brokenDown) for (const id of s.brokenDown) if (s.nodes.get(id)?.detailChunk) needDetail.add(id);
  for (const id of needDetail)
    model.ensureDetail(id).then(() => {
      const now = useViewer.getState();
      v.applyDisplay(displayOf(now));
      model.applyExplode(now.explode, now.brokenDown, displayOf(now).removed);
      v.invalidate();
    });
  if (s.section !== p.section) v.setSection(s.section.axis, s.section.offset);
  if ((s.circuit !== p.circuit || s.wiringPub !== p.wiringPub) && s.circuit && s.manifest) {
    const id = s.circuit;
    loadWiring(s.manifest, s.wiringPub)?.then((ix) => {
      if (useViewer.getState().circuit !== id) return;
      useViewer.getState().setHighlight(new Set(circuitNodes(ix, id).mapped));
    });
  }
  if (s.selected !== p.selected || s.circuit !== p.circuit || s.wires !== p.wires || s.manifest !== p.manifest || s.wiringPub !== p.wiringPub) updateWires(v, s);
  if (s.wireFocus !== p.wireFocus) v.focusWire(s.wireFocus);
  if (s.focusRequest !== p.focusRequest) focus(v, s);
}

/** Draws the wires of the selected circuit sheet, or of the selected part, along the harnesses. */
function updateWires(v: Viewer, s: ViewerState) {
  const node = s.selected ? s.nodes.get(s.selected) : null;
  const wanted = s.wires && s.manifest?.wiring && (s.circuit || (node && (node.ewd.length || node.ewdConnectors?.length || node.id.startsWith('ground-'))));
  if (!wanted) {
    v.setWires([]);
    return;
  }
  const key = `${s.circuit}|${s.selected}|${s.wiringPub}`;
  loadWiring(s.manifest!, s.wiringPub)?.then((ix) => {
    const now = useViewer.getState();
    if (`${now.circuit}|${now.selected}|${now.wiringPub}` !== key || !now.wires) return;
    const wires = now.circuit ? wiresOfCircuit(ix, now.circuit) : node ? wiresOfNode(ix, node) : [];
    v.setWires(routeWires(ix, wires).map((r) => ({ id: r.wire.id, colour: r.wire.colour, points: r.points })));
    v.focusWire(now.wireFocus);
  });
}

function focus(v: Viewer, s: ViewerState) {
  const { id, approach } = s.focusRequest;
  if (!id) {
    v.home();
    return;
  }
  // without an explicit approach, look at a part from the side a mechanic would reach it
  const via = approach ?? s.nodes.get(id)?.access?.from[0];
  const dirOf = () => {
    const a = via ? s.manifest?.approaches.find((x) => x.id === via) : null;
    return a ? new THREE.Vector3(...a.dir) : undefined;
  };
  // wait for explode/break-down motion to settle so the framing matches the final layout
  const started = performance.now();
  const go = () => {
    const model = v.model;
    if (!model) return;
    if (model.animating && performance.now() - started < 1500) {
      setTimeout(go, 90);
      return;
    }
    v.frame(id === '*' ? model.boundsAll() : model.boundsOf(id), dirOf(), true, id === '*' ? 0.95 : approach ? 1.6 : 1.35);
  };
  setTimeout(go, 40);
}

export default function ViewerPage({ vehicleId, initialPart }: { vehicleId: string; initialPart?: string | null }) {
  const host = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLDivElement>(null);
  const labelText = useRef<HTMLSpanElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const manifest = useViewer((s) => s.manifest);
  const loadMs = useViewer((s) => s.loadMs);
  const ready = useViewer((s) => s.status === 'ready');
  const sheet = useViewer((s) => s.sheet);

  useEffect(() => {
    const store = useViewer.getState();
    store.reset();
    store.setStatus('loading', 0);
    let cancelled = false;
    const t0 = performance.now();
    // the label's anchor is the selection's centre; bounds are only recomputed when the model changes
    const anchor = { id: null as string | null, revision: -1, at: new THREE.Vector3(), empty: true };
    const updateLabel = () => {
      const s = useViewer.getState();
      const el = label.current;
      if (!el) return;
      const v = viewerRef.current;
      if (!s.selected || !v?.model) {
        el.style.display = 'none';
        return;
      }
      if (anchor.id !== s.selected || anchor.revision !== v.model.revision) {
        const box = v.model.boundsOf(s.selected);
        anchor.empty = box.isEmpty();
        if (!anchor.empty) box.getCenter(anchor.at);
        anchor.revision = v.model.revision;
        if (anchor.id !== s.selected && labelText.current) labelText.current.textContent = s.nodes.get(s.selected)?.name ?? '';
        anchor.id = s.selected;
      }
      const pt = anchor.empty ? null : v.project(anchor.at);
      if (!pt) {
        el.style.display = 'none';
        return;
      }
      el.style.display = 'block';
      el.style.transform = `translate3d(${pt.x}px, ${pt.y}px, 0)`;
    };
    const v = new Viewer(host.current!, {
      onHover: (id) => useViewer.getState().hover(id, true),
      onPointer: moveHoverTip,
      onSelect: (id, e) => {
        const st = useViewer.getState();
        if (!id) {
          if (!e.double) st.select(null);
          return;
        }
        st.select(id);
        if (e.double) st.focus(id);
      },
      onFrame: updateLabel,
    });
    viewerRef.current = v;
    // the model centres in the space the panels leave free; a bottom sheet changes that as it slides
    const placeModel = (animate: boolean) => {
      const layout = viewerLayout();
      if (layout === 'wide') return v.setInsets({ left: 290, right: 416, top: 70, bottom: 64 }, animate);
      if (layout === 'compact') return v.setInsets({ left: 84, right: 312, top: 8, bottom: 8 }, animate);
      const sheet = useViewer.getState().sheet;
      // the sheet spans the viewer less an 8 px margin; fully open it hides the model, which stays framed as for half
      const visible = sheetVisible(sheet === 'full' ? 'half' : sheet, (host.current?.clientHeight ?? window.innerHeight) - 8);
      v.setInsets({ left: 0, right: 0, top: 76, bottom: visible + 8 }, animate);
    };
    const updateInsets = () => placeModel(false);
    updateInsets();
    window.addEventListener('resize', updateInsets);
    const unsub = useViewer.subscribe((s, p) => {
      sync(v, s, p);
      if (s.sheet !== p.sheet) placeModel(true);
      // on a phone, picking a part raises the sheet enough to read about it
      if (s.selected && s.selected !== p.selected && s.sheet === 'peek' && viewerLayout() === 'sheet') s.setSheet('half');
      if (s.selected !== p.selected) {
        updateLabel();
        const url = new URL(location.href);
        if (s.selected) url.searchParams.set('part', s.selected);
        else url.searchParams.delete('part');
        history.replaceState(null, '', url);
      }
    });

    (async () => {
      const catalog = await fetchJson<Catalog>(asset('data/catalog.json'));
      const entry = catalog.vehicles.find((x) => x.id === vehicleId);
      if (!entry) throw new Error(`unknown vehicle "${vehicleId}"`);
      const m = await fetchJson<Manifest>(asset(entry.manifest));
      if (cancelled) return;
      useViewer.getState().setManifest(m);
      await v.loadVehicle(m, import.meta.env.BASE_URL, (loaded, total) => {
        if (!cancelled) useViewer.getState().setStatus('loading', total ? loaded / total : 0);
      });
      if (cancelled) return;
      const s = useViewer.getState();
      v.applyDisplay(displayOf(s));
      v.model!.applyExplode(s.explode, s.brokenDown);
      await v.prepare();
      if (cancelled) return;
      s.setStatus('ready', 1);
      s.setLoadMs(Math.round(performance.now() - t0));
      performance.mark('vehicle-ready');
      if (initialPart && s.nodes.has(initialPart)) {
        s.select(initialPart);
        s.focus(initialPart);
      } else v.intro();
      const idle = window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 300));
      idle(() => v.model?.prefetchDetail());
      // the first part with wires then draws them without fetching and indexing the netlist first
      idle(() => prepareWiring(m));
      // handles for browser tests and screenshots
      Object.assign(window as unknown as Record<string, unknown>, { __viewer: v, __store: useViewer });
    })().catch((e: Error) => {
      if (!cancelled) useViewer.getState().setStatus('error', 0, e.message);
    });

    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const st = useViewer.getState();
      const sel = st.selected;
      switch (e.key.toLowerCase()) {
        case 'escape':
          if (st.access) st.setAccess(null);
          else if (st.isolate) st.setIsolate(null);
          else st.select(null);
          break;
        case 'f':
          if (sel) st.focus(sel);
          break;
        case 'i':
          st.setIsolate(st.isolate ? null : sel);
          break;
        case 'h':
          if (sel) st.toggleHidePart(sel);
          break;
        case 'b':
        case 'e':
          if (sel && (st.nodes.get(sel)?.children.length || st.nodes.get(sel)?.detailChunk)) {
            st.toggleBreakdown(sel);
            st.focus(sel);
          }
          break;
        case 'x':
          st.setXray(!st.xray);
          break;
        case '0':
          st.focus(null);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);

    return () => {
      cancelled = true;
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', updateInsets);
      unsub();
      v.dispose();
      viewerRef.current = null;
    };
  }, [vehicleId, initialPart]);

  const onView = (dir: [number, number, number], target?: 'engine') => {
    const v = viewerRef.current;
    if (!v?.model) return;
    // engine bay: bulkhead to bumper, full width, sump to bonnet (three.js frame, metres)
    const box =
      target === 'engine'
        ? new THREE.Box3(new THREE.Vector3(-0.8, 0.2, -0.5), new THREE.Vector3(0.8, 1.1, 0.88))
        : new THREE.Box3(new THREE.Vector3(-0.96, 0, -3.62), new THREE.Vector3(0.96, 1.74, 0.88));
    v.frame(box, new THREE.Vector3(...dir), true, target ? 1.15 : 0.95);
  };

  const v = manifest?.vehicle;
  return (
    <div className={`viewer-root ${ready ? 'ready' : ''}`} data-sheet={sheet}>
      <div className="viewer-host" ref={host} />
      <div className="title-block">
        <div className="eyebrow">{v ? `${v.make} · ${v.generation.code} · ${v.variant.market}` : ' '}</div>
        <h1>{v ? `${v.model} ${v.variant.name}` : ' '}</h1>
        {v && (
          <div className="sub">
            <span className="badge neutral">{v.modelYear} model year</span>
            <span className="badge neutral">{v.variant.drive.split(' (')[0]}</span>
            <button className="badge partial" style={{ cursor: 'pointer', background: 'rgba(245,184,74,0.1)' }} onClick={() => navigate(`/v/${v.id}/verification`)}>
              Schematic model · verification in progress
            </button>
          </div>
        )}
      </div>
      <SystemRail />
      <ToolDock onHome={() => viewerRef.current?.home()} />
      <InfoPanel />
      <ViewBar onView={onView} onZoom={(f) => viewerRef.current?.zoomBy(f)} />
      <HoverTip />
      <div className="anchor-label" ref={label}>
        <div className="pin" />
        <span className="tag" ref={labelText} />
      </div>
      <LoadingOverlay />
      {manifest && (
        <div className="perf" data-testid="perf">
          {(manifest.stats.bytes / 1024).toFixed(0)} KB · {manifest.stats.triangles.toLocaleString()} tris{loadMs !== null ? ` · ready in ${loadMs} ms` : ''}
        </div>
      )}
    </div>
  );
}
