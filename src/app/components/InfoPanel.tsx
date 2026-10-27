import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Eye,
  EyeOff,
  Focus,
  Info,
  Maximize2,
  Minimize2,
  ScanEye,
  Wrench,
} from 'lucide-react';
import { memo, useDeferredValue, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Manifest, RuntimeNode } from '../../shared/manifest';
import { sheetVisible, useViewerLayout } from '../layout';
import { navigate } from '../router';
import { descendants, pathTo, useViewer, type SheetStop } from '../store';
import { KindIcon, SourceLine, StatusBadge, STATUS_HEX, VerificationCard } from './common';
import { PartSearch } from './PartSearch';
import { ConnectedTo } from './ConnectedTo';
import { CircuitBrowser, NodeWiring } from './WiringViews';

export function InfoPanel() {
  const tab = useViewer((s) => s.tab);
  const setTab = useViewer((s) => s.setTab);
  const manifest = useViewer((s) => s.manifest);
  const sheet = useViewer((s) => s.sheet);
  const asSheet = useViewerLayout() === 'sheet';
  const panel = useRef<HTMLElement>(null);
  const [height, setHeight] = useState(0);
  // measured before the first paint, so the sheet does not slide down from fully open on load
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return;
    setHeight(el.clientHeight);
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [asSheet]);
  // a bottom sheet is as tall as the screen allows and slides down to show only part of itself
  const offset = asSheet && height ? Math.max(0, height - sheetVisible(sheet, height)) : 0;
  return (
    <aside
      ref={panel}
      className={`panel ${asSheet ? 'sheet' : ''}`}
      style={asSheet ? { transform: `translate3d(0, ${offset}px, 0)`, ['--sheet-offset' as string]: `${offset}px` } : undefined}
      aria-label="Component information"
    >
      {asSheet && <SheetGrip panel={panel} height={height} />}
      <PartSearch />
      <div className="tabs" role="tablist">
        {(
          [
            ['details', 'Explore'],
            ['parts', 'Parts'],
            ['wiring', 'Wiring'],
            ['checks', 'Verification'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'on' : ''}
            onClick={() => {
              setTab(id);
              if (asSheet && sheet === 'peek') useViewer.getState().setSheet('half');
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="panel-body">
        {!manifest ? null : tab === 'details' ? (
          <Details manifest={manifest} />
        ) : tab === 'parts' ? (
          <PartsTree manifest={manifest} />
        ) : tab === 'wiring' ? (
          <CircuitBrowser manifest={manifest} />
        ) : (
          <Checks manifest={manifest} />
        )}
      </div>
    </aside>
  );
}

const STOPS: SheetStop[] = ['peek', 'half', 'full'];

/** Drag handle of the bottom sheet: drag or flick between the stops; a tap opens or lowers it. */
function SheetGrip({ panel, height }: { panel: RefObject<HTMLElement | null>; height: number }) {
  const sheet = useViewer((s) => s.sheet);
  const drag = useRef<{ startY: number; startOff: number; lastY: number; lastT: number; v: number; moved: boolean } | null>(null);
  const offsetOf = (stop: SheetStop) => Math.max(0, height - sheetVisible(stop, height));
  const clampOff = (off: number) => Math.min(offsetOf('peek'), Math.max(0, off));
  const settle = (stop: SheetStop) => {
    const el = panel.current;
    if (el) {
      // animate from wherever the finger left it (React would skip an unchanged transform)
      el.classList.remove('dragging');
      el.style.transform = `translate3d(0, ${offsetOf(stop)}px, 0)`;
    }
    useViewer.getState().setSheet(stop);
  };
  return (
    <div
      className="sheet-grip"
      role="button"
      tabIndex={0}
      aria-label={sheet === 'peek' ? 'Show more of the panel' : 'Show less of the panel'}
      onPointerDown={(e) => {
        if (!panel.current) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        panel.current.classList.add('dragging');
        drag.current = { startY: e.clientY, startOff: offsetOf(sheet), lastY: e.clientY, lastT: e.timeStamp, v: 0, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || !panel.current) return;
        if (Math.abs(e.clientY - d.startY) > 4) d.moved = true;
        panel.current.style.transform = `translate3d(0, ${clampOff(d.startOff + e.clientY - d.startY)}px, 0)`;
        // smoothed velocity in px per ms, for flicks
        d.v = 0.7 * d.v + 0.3 * ((e.clientY - d.lastY) / Math.max(1, e.timeStamp - d.lastT));
        d.lastY = e.clientY;
        d.lastT = e.timeStamp;
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (!d) return;
        if (!d.moved) return settle(sheet === 'peek' ? 'half' : 'peek');
        // where a flick would carry the sheet, snapped to the nearest stop
        const off = clampOff(d.startOff + e.clientY - d.startY + d.v * 180);
        settle(STOPS.reduce((best, s) => (Math.abs(offsetOf(s) - off) < Math.abs(offsetOf(best) - off) ? s : best)));
      }}
      onPointerCancel={() => {
        drag.current = null;
        settle(sheet);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        settle(sheet === 'peek' ? 'half' : sheet === 'half' ? 'full' : 'peek');
      }}
    >
      <span />
    </div>
  );
}

// ---------------------------------------------------------------- details

function Details({ manifest }: { manifest: Manifest }) {
  const selected = useViewer((s) => s.selected);
  const nodes = useViewer((s) => s.nodes);
  // the 3D view reacts to a click first; the details render afterwards in an interruptible background pass
  const shown = useDeferredValue(selected);
  const node = shown ? nodes.get(shown) : null;
  if (!node) return <VehicleOverview manifest={manifest} />;
  return <NodeDetails key={node.id} node={node} manifest={manifest} />;
}

function VehicleOverview({ manifest }: { manifest: Manifest }) {
  const v = manifest.vehicle;
  const st = manifest.stats;
  const total = st.byStatus.verified + st.byStatus.partial + st.byStatus.unverified;
  return (
    <div>
      <div className="crumb-path">
        {v.make} › {v.model} › {v.generation.code}
      </div>
      <h2 className="part-title">
        {v.modelYear} {v.model} {v.variant.name}
      </h2>
      <p className="lede">{v.variant.engine}</p>
      <div className="section">
        <h3>How to explore</h3>
        <div className="list" style={{ fontSize: 13, color: 'var(--muted)', gap: 6 }}>
          <div>• Click any part to see what it is, where it sits and how to reach it.</div>
          <div>• Use the systems on the left as layers; Alt-click (or double-tap) a system to show it alone.</div>
          <div>• “Explode” pulls the systems apart; “Break down” takes a selected assembly apart.</div>
          <div>• Double-click a part to fly to it. Esc clears, / searches.</div>
        </div>
      </div>
      <div className="section">
        <h3>Variant</h3>
        <dl className="kv">
          <dt>Transmission</dt>
          <dd>{v.variant.transmission}</dd>
          <dt>Drive</dt>
          <dd>{v.variant.drive}</dd>
          <dt>Body</dt>
          <dd>{v.variant.body}</dd>
          <dt>Market</dt>
          <dd>{v.variant.market}</dd>
        </dl>
      </div>
      <div className="section">
        <h3>Published data</h3>
        <dl className="kv">
          {v.specs.map((s) => (
            <SpecRow key={s.label} label={s.label} value={s.value} source={s.source?.ref} manifest={manifest} />
          ))}
        </dl>
      </div>
      <div className="section">
        <h3>Model verification</h3>
        <div className="bar" title="verified / partial / unverified">
          <span style={{ width: `${(100 * st.byStatus.verified) / total}%`, background: 'var(--ok)' }} />
          <span style={{ width: `${(100 * st.byStatus.partial) / total}%`, background: 'var(--warn)' }} />
          <span style={{ width: `${(100 * st.byStatus.unverified) / total}%`, background: 'var(--bad)' }} />
        </div>
        <p className="lede" style={{ fontSize: 12.5 }}>
          {st.byStatus.verified} verified · {st.byStatus.partial} partially verified · {st.byStatus.unverified} unverified, across {total} components.
        </p>
        <div className="note">{v.disclaimer}</div>
      </div>
    </div>
  );
}

function SpecRow({ label, value, source, manifest }: { label: string; value: string; source?: string; manifest: Manifest }) {
  const s = source ? manifest.sources[source] : null;
  return (
    <>
      <dt>{label}</dt>
      <dd>
        {value}
        {s && (
          <span className="empty" title={`${s.title} (reliability ${s.reliability})`}>
            {' '}
            [{s.reliability}]
          </span>
        )}
      </dd>
    </>
  );
}

const NodeDetails = memo(function NodeDetails({ node, manifest }: { node: RuntimeNode; manifest: Manifest }) {
  const nodes = useViewer((s) => s.nodes);
  const brokenDown = useViewer((s) => s.brokenDown);
  const isolate = useViewer((s) => s.isolate);
  const access = useViewer((s) => s.access);
  const hiddenParts = useViewer((s) => s.hiddenParts);
  const st = useViewer.getState();
  const path = pathTo(nodes, node.id);
  const system = manifest.systems.find((s) => s.id === node.system);
  const children = node.children.map((c) => nodes.get(c)!).filter(Boolean);
  const subtree = useMemo(() => descendants(nodes, node.id), [nodes, node.id]);
  const connectors = subtree.filter((n) => n.kind === 'connector');
  const linkedHarnesses = manifest.nodes.filter((n) => n.harness?.connects.includes(node.id));
  const counts = { verified: 0, partial: 0, unverified: 0 };
  for (const d of subtree) counts[d.verification.status]++;
  const isBroken = brokenDown.has(node.id);
  const canBreak = children.length > 0 || !!node.detailChunk;

  return (
    <div>
      <div className="crumb-path">
        {path.slice(0, -1).map((p, i) => (
          <span key={p.id}>
            {i > 0 && ' › '}
            <button onClick={() => st.select(p.id)}>{p.name}</button>
          </span>
        ))}
      </div>
      <h2 className="part-title">{node.name}</h2>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="badge neutral" style={{ color: system?.color, borderColor: system?.color }}>
          {system?.name}
        </span>
        <span className="badge neutral">
          <KindIcon kind={node.kind} size={12} /> {node.kind}
        </span>
        <StatusBadge status={node.verification.status} />
      </div>
      {node.fitment && (
        <div className="note" style={{ borderLeftColor: 'var(--accent)' }}>
          Fitted to: {node.fitment}
        </div>
      )}
      {node.summary && (
        <p className="lede">
          {node.summary}
          {node.summaryGeneral && <span className="empty"> (General description of this kind of part, not specific to this vehicle.)</span>}
        </p>
      )}
      {node.function && <p className="lede">{node.function}</p>}

      <div className="actions">
        <button className="btn" onClick={() => st.focus(node.id)} title="Fly to (F)">
          <Focus size={14} /> Focus
        </button>
        <button className={`btn ${isolate === node.id ? 'on' : ''}`} onClick={() => st.setIsolate(isolate === node.id ? null : node.id)} title="Isolate (I)">
          <ScanEye size={14} /> {isolate === node.id ? 'Exit isolate' : 'Isolate'}
        </button>
        {canBreak && (
          <button
            className={`btn ${isBroken ? 'on' : 'primary'}`}
            onClick={() => {
              st.toggleBreakdown(node.id);
              st.focus(node.id);
            }}
            title="Break down / collapse (B)"
          >
            {isBroken ? <Minimize2 size={14} /> : <Maximize2 size={14} />} {isBroken ? 'Collapse' : 'Break down'}
          </button>
        )}
        {node.access && (
          <button
            className={`btn ${access === node.id ? 'on' : ''}`}
            onClick={() => {
              const on = access !== node.id;
              st.setAccess(on ? node.id : null);
              if (on) st.focus(node.id, node.access!.from[0]);
            }}
          >
            <Wrench size={14} /> {access === node.id ? 'Hide access' : 'Show access'}
          </button>
        )}
        <button className="btn" onClick={() => st.toggleHidePart(node.id)} title="Hide (H)">
          {hiddenParts.has(node.id) ? <Eye size={14} /> : <EyeOff size={14} />} {hiddenParts.has(node.id) ? 'Show' : 'Hide'}
        </button>
      </div>

      {node.location && (
        <div className="section">
          <h3>Location</h3>
          <div>{node.location.text}</div>
          <div className="empty">{manifest.zones[node.location.zone]}</div>
        </div>
      )}

      {node.access && (
        <div className="section">
          <h3>
            <Wrench size={12} /> How to reach it
          </h3>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {node.access.from.map((a) => (
              <button key={a} className="btn" onClick={() => st.focus(node.id, a)}>
                {manifest.approaches.find((x) => x.id === a)?.label ?? a}
              </button>
            ))}
          </div>
          {node.access.removeFirst.length > 0 && (
            <>
              <div className="empty" style={{ marginTop: 10 }}>
                Remove or move first:
              </div>
              <div className="list">
                {node.access.removeFirst.map((id, i) => (
                  <button key={id} className="list-item" onClick={() => st.select(id)}>
                    <span className="badge neutral">{i + 1}</span> {nodes.get(id)?.name ?? id}
                  </button>
                ))}
              </div>
            </>
          )}
          {node.access.tools.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 13 }}>
              <span className="empty">Tools: </span>
              {node.access.tools.join(', ')}
            </div>
          )}
          {node.access.notes && <div className="note">{node.access.notes}</div>}
          {node.access.sources.map((s, i) => (
            <SourceLine key={i} source={s} manifest={manifest} />
          ))}
        </div>
      )}

      {(connectors.length > 0 || node.connector || node.harness || linkedHarnesses.length > 0) && (
        <div className="section">
          <h3>Connectors &amp; wiring</h3>
          {node.connector && (
            <dl className="kv">
              <dt>Pins</dt>
              <dd>{node.connector.pins ?? <span className="empty">not yet documented</span>}</dd>
              {node.connector.housing && (
                <>
                  <dt>Housing</dt>
                  <dd>{node.connector.housing}</dd>
                </>
              )}
              {node.connector.mates && (
                <>
                  <dt>Mates with</dt>
                  <dd>
                    <button className="list-item" style={{ padding: 0 }} onClick={() => st.select(node.connector!.mates!)}>
                      {nodes.get(node.connector.mates)?.name}
                    </button>
                  </dd>
                </>
              )}
            </dl>
          )}
          {node.connector && node.connector.pinout.length === 0 && <div className="empty">Pin-out not yet entered (needs the wiring diagram).</div>}
          {node.harness && (
            <div className="list">
              <div className="empty">Connects:</div>
              {node.harness.connects.map((c) => (
                <button key={c} className="list-item" onClick={() => st.select(c)}>
                  <KindIcon kind={nodes.get(c)?.kind ?? 'part'} /> {nodes.get(c)?.name ?? c}
                </button>
              ))}
            </div>
          )}
          {connectors.length > 0 && (
            <div className="list">
              {connectors.map((c) => (
                <button key={c.id} className="list-item" onClick={() => st.select(c.id)}>
                  <KindIcon kind="connector" /> {c.name}
                  <span className="meta">{c.connector?.pins ? `${c.connector.pins}-pin` : ''}</span>
                </button>
              ))}
            </div>
          )}
          {linkedHarnesses.length > 0 && (
            <div className="list">
              <div className="empty">Wired by:</div>
              {linkedHarnesses.map((h) => (
                <button key={h.id} className="list-item" onClick={() => st.select(h.id)}>
                  <KindIcon kind="harness" /> {h.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <ConnectedTo node={node} manifest={manifest} />

      <div className="section">
        <h3>Part numbers</h3>
        {node.partNumbers.length === 0 ? (
          <div className="empty">None recorded yet — to be taken from the {manifest.vehicle.make} parts catalogue, not guessed.</div>
        ) : (
          node.partNumbers.map((p) => (
            <div key={p.number} className="mono">
              {p.number} {p.note && <span className="empty">— {p.note}</span>}
            </div>
          ))
        )}
      </div>

      {node.specs.length > 0 && (
        <div className="section">
          <h3>Specifications</h3>
          <dl className="kv">
            {node.specs.map((s) => (
              <SpecRow key={s.label} label={s.label} value={s.value} source={s.source?.ref} manifest={manifest} />
            ))}
          </dl>
        </div>
      )}

      {node.manufacturing.length > 0 && (
        <div className="section">
          <h3>Manufacturing</h3>
          <dl className="kv">
            {node.manufacturing.map((s) => (
              <SpecRow key={s.label} label={s.label} value={s.value} source={s.source?.ref} manifest={manifest} />
            ))}
          </dl>
        </div>
      )}

      <NodeWiring node={node} manifest={manifest} />

      {node.faults.length > 0 && (
        <div className="section">
          <h3>
            <AlertTriangle size={12} /> Known faults &amp; symptoms
          </h3>
          {node.faults.map((f, i) => (
            <div key={i} className="card" style={{ marginBottom: 6 }}>
              <div style={{ fontWeight: 600 }}>{f.symptom}</div>
              {f.cause && <div className="lede" style={{ marginTop: 2 }}>{f.cause}</div>}
              {f.source && <SourceLine source={f.source} manifest={manifest} />}
            </div>
          ))}
        </div>
      )}

      {children.length > 0 && (
        <div className="section">
          <h3>
            Components ({subtree.length}) · <span style={{ color: 'var(--ok)' }}>{counts.verified}</span> /{' '}
            <span style={{ color: 'var(--warn)' }}>{counts.partial}</span> / <span style={{ color: 'var(--bad)' }}>{counts.unverified}</span>
          </h3>
          <div className="list">
            {children.map((c) => (
              <button key={c.id} className="list-item" onClick={() => st.select(c.id)} onMouseEnter={() => st.hover(c.id)} onMouseLeave={() => st.hover(null)}>
                <span className="dot" style={{ background: STATUS_HEX[c.verification.status] }} />
                {c.name}
                <span className="meta">{c.children.length ? `${c.children.length} parts` : c.kind}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {node.detailChunk && children.length === 0 && <div className="empty">Detailed breakdown available — press “Break down”.</div>}

      {node.size && (
        <div className="section">
          <h3>Modelled size</h3>
          <div className="mono">
            {node.size[0]} × {node.size[1]} × {node.size[2]} mm <span className="empty">(L × W × H, model geometry)</span>
          </div>
        </div>
      )}

      <div className="section">
        <h3>
          <ClipboardCheck size={12} /> Verification
        </h3>
        <VerificationCard node={node} manifest={manifest} />
      </div>
    </div>
  );
});

// ---------------------------------------------------------------- tree

function PartsTree({ manifest }: { manifest: Manifest }) {
  const nodes = useViewer((s) => s.nodes);
  const selected = useViewer((s) => s.selected);
  const hiddenParts = useViewer((s) => s.hiddenParts);
  const hiddenSystems = useViewer((s) => s.hiddenSystems);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const st = useViewer.getState();
  // auto-expand the path to the current selection
  const openSet = useMemo(() => {
    const s = new Set(open);
    if (selected) for (const p of pathTo(nodes, selected).slice(0, -1)) s.add(p.id);
    return s;
  }, [open, selected, nodes]);

  const rows: { n: RuntimeNode; depth: number }[] = [];
  const walk = (id: string, depth: number) => {
    const n = nodes.get(id);
    if (!n) return;
    rows.push({ n, depth });
    if (openSet.has(id)) for (const c of n.children) walk(c, depth + 1);
  };
  for (const s of manifest.systems) walk(s.id, 0);
  const sysColor = new Map(manifest.systems.map((s) => [s.id, s.color]));

  return (
    <div className="tree" role="tree">
      {rows.map(({ n, depth }) => {
        const hidden = hiddenParts.has(n.id) || (n.kind === 'system' && hiddenSystems.has(n.id));
        return (
          <div
            key={n.id}
            className={`tree-row ${selected === n.id ? 'sel' : ''}`}
            style={{ paddingLeft: depth * 14, opacity: hidden ? 0.45 : 1 }}
            onClick={() => st.select(n.id)}
            onDoubleClick={() => st.focus(n.id)}
            onMouseEnter={() => st.hover(n.id)}
            onMouseLeave={() => st.hover(null)}
            role="treeitem"
            aria-selected={selected === n.id}
          >
            <button
              className="twist"
              onClick={(e) => {
                e.stopPropagation();
                const s = new Set(openSet);
                if (s.has(n.id)) s.delete(n.id);
                else s.add(n.id);
                setOpen(s);
              }}
              style={{ visibility: n.children.length ? 'visible' : 'hidden' }}
              aria-label={openSet.has(n.id) ? 'Collapse' : 'Expand'}
            >
              {openSet.has(n.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            <span className="dot" style={{ background: n.kind === 'system' ? sysColor.get(n.id) : STATUS_HEX[n.verification.status], width: 7, height: 7 }} />
            <span className="label" style={{ fontWeight: n.kind === 'system' ? 600 : 400 }}>
              {n.name}
            </span>
            <button
              className={`eye ${hidden ? 'hidden' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                if (n.kind === 'system') st.toggleSystem(n.id);
                else st.toggleHidePart(n.id);
              }}
              aria-label={hidden ? 'Show' : 'Hide'}
            >
              {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- checks

function Checks({ manifest }: { manifest: Manifest }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const st = useViewer.getState();
  const perSystem = manifest.systems.map((s) => {
    const c = { verified: 0, partial: 0, unverified: 0 };
    for (const n of manifest.nodes) if (n.system === s.id && n.kind !== 'system') c[n.verification.status]++;
    return { s, c, total: c.verified + c.partial + c.unverified };
  });
  return (
    <div>
      <p className="lede" style={{ marginTop: 0 }}>
        Two kinds of verification: automated geometry checks run on every data build, and human review of each component against sources.
      </p>
      <div className="actions" style={{ marginTop: 8 }}>
        <button className="btn" onClick={() => st.setColorMode(useViewer.getState().colorMode === 'verification' ? 'realistic' : 'verification')}>
          <ClipboardCheck size={14} /> Colour model by verification
        </button>
        <button className="btn" onClick={() => navigate(`/v/${manifest.vehicle.id}/verification`)}>
          Full report
        </button>
      </div>
      <div className="section">
        <h3>Automated checks</h3>
        {manifest.checks.map((c) => (
          <div key={c.id} className="check">
            <span style={{ color: c.severity === 'error' ? 'var(--bad)' : c.severity === 'warning' ? 'var(--warn)' : 'var(--ok)' }}>
              {c.severity === 'info' ? <Info size={15} /> : <AlertTriangle size={15} />}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div>{c.title}</div>
              {c.detail && (
                <>
                  <button className="list-item" style={{ padding: '2px 0', color: 'var(--muted)', fontSize: 12 }} onClick={() => setOpenId(openId === c.id ? null : c.id)}>
                    {openId === c.id ? 'Hide details' : 'Show details'}
                  </button>
                  {openId === c.id && <pre>{c.detail}</pre>}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="section">
        <h3>Coverage by system</h3>
        {perSystem.map(({ s, c, total }) => (
          <div key={s.id} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
              <span>
                <span className="dot" style={{ background: s.color, marginRight: 6 }} />
                {s.name}
              </span>
              <span className="empty">{total} components</span>
            </div>
            <div className="bar">
              <span style={{ width: `${(100 * c.verified) / Math.max(1, total)}%`, background: 'var(--ok)' }} />
              <span style={{ width: `${(100 * c.partial) / Math.max(1, total)}%`, background: 'var(--warn)' }} />
              <span style={{ width: `${(100 * c.unverified) / Math.max(1, total)}%`, background: 'var(--bad)' }} />
            </div>
          </div>
        ))}
      </div>
      <div className="note">{manifest.vehicle.disclaimer}</div>
    </div>
  );
}

