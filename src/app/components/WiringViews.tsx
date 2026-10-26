import { CircuitBoard, Eye, EyeOff, Plug } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Manifest, PublicationChanges, RuntimeNode } from '../../shared/manifest';
import { describeColour, WIRE_COLOURS, type EwdWire } from '../../shared/wiring';
import { useViewer } from '../store';
import { circuitNodes, describeEnd, loadWiring, pinsOf, publicationOf, routeWires, wiresOfCircuit, wiresOfNode, type WiringIndex } from '../wiring';

function useWiring(manifest: Manifest): { ix: WiringIndex | null; error: string | null } {
  const [ix, setIx] = useState<WiringIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pub = useViewer((s) => s.wiringPub);
  useEffect(() => {
    setIx(null);
    const p = loadWiring(manifest, pub);
    if (!p) return;
    let alive = true;
    p.then((v) => alive && setIx(v)).catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [manifest, pub]);
  return { ix, error };
}

export function WireSwatch({ colour }: { colour: string }) {
  const [main, tracer] = colour.split('-');
  const a = WIRE_COLOURS[main] ?? '#888';
  const b = tracer ? (WIRE_COLOURS[tracer] ?? '#888') : a;
  return (
    <span
      className="wire-swatch"
      title={describeColour(colour)}
      style={{ background: tracer ? `repeating-linear-gradient(135deg, ${a} 0 5px, ${b} 5px 8px)` : a }}
    />
  );
}

/** Toggle for drawing wires in 3D, with how many of the listed wires have a drawable route. */
function WiresToggle({ ix, wires }: { ix: WiringIndex; wires: EwdWire[] }) {
  const on = useViewer((s) => s.wires);
  const st = useViewer.getState();
  const drawable = useMemo(() => routeWires(ix, wires).length, [ix, wires]);
  if (!ix.data.layout || !wires.length) return null;
  return (
    <div className="wires-toggle">
      <button className={`chip-btn ${on ? 'on' : ''}`} onClick={() => st.setWires(!on)} aria-pressed={on}>
        {on ? <Eye size={13} /> : <EyeOff size={13} />} {on ? 'Wires shown in 3D' : 'Show wires in 3D'}
      </button>
      <span className="empty">
        {drawable} of {wires.length} wire{wires.length === 1 ? '' : 's'} drawn along the harness routes (routes estimated)
      </span>
    </div>
  );
}

function WireRow({ ix, wire, from }: { ix: WiringIndex; wire: EwdWire; from: string }) {
  const st = useViewer.getState();
  const others = wire.ends.filter((e) => e !== from && e.replace(/-\d+$/, '') !== from);
  return (
    <div className="wire-row" onMouseEnter={() => st.setWireFocus(wire.id)} onMouseLeave={() => st.setWireFocus(null)}>
      <WireSwatch colour={wire.colour} />
      <span className="mono">{wire.id}</span>
      <span className="empty">
        {wire.colour} · {wire.csa} mm²
      </span>
      <span className="wire-to">
        →{' '}
        {others.length === 0 ? (
          <span className="empty">continues on {wire.sheets.length > 1 ? `${wire.sheets.length} sheets` : 'another sheet'}</span>
        ) : (
          others.map((e) => {
            const d = describeEnd(ix, e);
            const notFitted = d.component && ix.notFitted.has(d.component);
            return d.node ? (
              <button key={e} className="link-btn" onClick={() => st.select(d.node!)} title={`Show ${d.componentName ?? e} in 3D`}>
                {d.label}
              </button>
            ) : (
              <span key={e} title={notFitted ? 'Equipment this variant does not have' : d.component ? 'Not modelled yet' : undefined}>
                {d.label}
                {d.component ? ' ·' : ''}
                {d.component && <span className="empty"> {notFitted ? 'not fitted to this variant' : 'not modelled'}</span>}
              </span>
            );
          })
        )}
      </span>
    </div>
  );
}

function ConnectorPins({ ix, connector, defaultOpen }: { ix: WiringIndex; connector: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const pins = useMemo(() => pinsOf(ix, connector), [ix, connector]);
  const c = ix.data.connectors[connector];
  const used = pins.filter((p) => p.wires.length > 0).length;
  return (
    <div className="conn">
      <button className="conn-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Plug size={13} /> <span className="mono">{connector}</span>
        <span className="empty">
          {used} wired pin{used === 1 ? '' : 's'}
          {c?.mates ? ` · mates ${c.mates}` : ''}
        </span>
        <span className="meta">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="pins">
          {pins.map((p) => {
            const end = `${connector}-${p.pin}`;
            const fuses = ix.fusesByPin.get(end) ?? [];
            return (
              <div key={p.pin} className="pin">
                <span className="pin-no mono">{p.pin}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  {p.signal && <span className="badge neutral" style={{ marginRight: 6 }}>{p.signal}</span>}
                  {fuses.map((f) => (
                    <span key={f.id} className="badge neutral" style={{ marginRight: 6 }}>
                      fuse {f.id}
                      {f.rating ? ` ${f.rating} A` : ''}
                    </span>
                  ))}
                  {p.wires.length === 0 ? <span className="empty">no wire printed on these sheets</span> : p.wires.map((w) => <WireRow key={w.id} ix={ix} wire={w} from={end} />)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ChangesList({ changes, manifest }: { changes: PublicationChanges; manifest: Manifest }) {
  const from = manifest.wiring?.publications.find((p) => p.id === changes.from);
  return (
    <div className="changes">
      <div className="empty">Compared with {from ? `${from.label} (${from.years})` : changes.from}:</div>
      {changes.componentsAdded.length > 0 && (
        <div>
          <strong>Components added:</strong> {changes.componentsAdded.map((c) => `${c.name} (${c.code})`).join(', ')}
        </div>
      )}
      {changes.componentsRemoved.length > 0 && (
        <div>
          <strong>Components removed:</strong> {changes.componentsRemoved.map((c) => `${c.name} (${c.code})`).join(', ')}
        </div>
      )}
      <div>
        <strong>Connections:</strong> {changes.connectionsAdded} added · {changes.connectionsRemoved} removed · {changes.connectionsChanged} with a different colour or size
      </div>
      {changes.examples.length > 0 && (
        <div className="change-rows">
          {changes.examples.slice(0, 30).map((x, i) => (
            <div key={i} className={`change-row ${x.kind}`}>
              <span className="change-kind">{x.kind}</span>
              <span className="mono">{x.ends.join(' ↔ ')}</span>
              <span className="empty">
                {x.was ? `${x.was} → ` : ''}
                {x.wire}
                {x.sheet ? ` · ${x.sheet}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Wiring tab: the wiring diagrams by model year / issue; picking one switches every wiring view. */
function PublicationPicker({ manifest }: { manifest: Manifest }) {
  const pubId = useViewer((s) => s.wiringPub);
  const st = useViewer.getState();
  const [open, setOpen] = useState<string | null>(null);
  const w = manifest.wiring;
  if (!w || w.publications.length < 2) return null;
  const current = publicationOf(manifest, pubId);
  return (
    <div className="section pubs">
      <h3>Wiring by year</h3>
      <div className="list">
        {w.publications.map((p) => {
          const c = p.changes;
          return (
            <div key={p.id} className="pub">
              <button className={`list-item ${current?.id === p.id ? 'sel' : ''}`} onClick={() => st.setWiringPub(p.isDefault ? null : p.id)} aria-pressed={current?.id === p.id}>
                <span className="pub-years">{p.years ?? '—'}</span>
                <span className="pub-label">
                  {p.label}
                  {p.isDefault && <span className="badge neutral pub-badge">used for this car</span>}
                </span>
                <span className="meta">
                  {p.stats.wires} wires{p.lengths ? ` · ${p.lengths} lengths` : ''}
                </span>
              </button>
              {c && (
                <button className="link-btn pub-diff" onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id}>
                  {open === p.id ? '−' : '+'} changes: {c.componentsAdded.length ? `+${c.componentsAdded.length} ` : ''}
                  {c.componentsRemoved.length ? `−${c.componentsRemoved.length} ` : ''}
                  {c.componentsAdded.length || c.componentsRemoved.length ? 'components, ' : ''}
                  {c.connectionsAdded} new / {c.connectionsRemoved} removed / {c.connectionsChanged} changed connections
                </button>
              )}
              {c && open === p.id && <ChangesList changes={c} manifest={manifest} />}
            </div>
          );
        })}
      </div>
      <div className="empty" style={{ marginTop: 6 }}>
        Model years are dated from the parts catalogue's VIN breaks. A 2010 car is newer than every issue in hand; the 2010–2011 diagrams (VIN 216517 onwards) are listed in the
        references but not available here.
      </div>
    </div>
  );
}

/** Wiring section in a component's details: its EWD components, connectors, pins and circuits. */
export function NodeWiring({ node, manifest }: { node: RuntimeNode; manifest: Manifest }) {
  const { ix, error } = useWiring(manifest);
  const st = useViewer.getState();
  const wires = useMemo(() => (ix ? wiresOfNode(ix, node) : []), [ix, node]);
  const isGround = node.generated && node.id.startsWith('ground-');
  if (!manifest.wiring || (node.ewd.length === 0 && !node.connector?.ewd && !node.ewdConnectors?.length && !isGround)) return null;
  return (
    <div className="section">
      <h3>
        <CircuitBoard size={12} /> Wiring ({publicationOf(manifest, useViewer.getState().wiringPub)?.label ?? manifest.wiring.publication.vin})
      </h3>
      {error && <div className="empty">Could not load the wiring data: {error}</div>}
      {!ix && !error && <div className="empty">Loading wiring diagrams…</div>}
      {ix && <WiresToggle ix={ix} wires={wires} />}
      {ix && node.connector?.ewd && <ConnectorPins ix={ix} connector={node.connector.ewd} defaultOpen />}
      {ix && node.ewdConnectors?.map((c, i) => <ConnectorPins key={c} ix={ix} connector={c} defaultOpen={i === 0} />)}
      {ix && isGround && (
        <div className="card" style={{ marginBottom: 8 }}>
          {wires.map((w) => (
            <WireRow key={w.id} ix={ix} wire={w} from={node.name.replace('Ground point ', '')} />
          ))}
        </div>
      )}
      {ix &&
        node.ewd.map((code) => {
          const c = ix.data.components[code];
          if (!c) return null;
          return (
            <div key={code} className="card" style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <strong>{c.name}</strong>
                <span className="mono empty">{code}</span>
              </div>
              {c.connectors.length === 0 && <div className="empty">No connector printed (wired through its fixings or inside another unit).</div>}
              {c.connectors.map((conn, i) => (
                <ConnectorPins key={conn} ix={ix} connector={conn} defaultOpen={node.ewd.length === 1 && i === 0} />
              ))}
              <div className="empty" style={{ marginTop: 6 }}>
                On {c.circuits.length} circuit sheet{c.circuits.length === 1 ? '' : 's'}:{' '}
                {c.circuits.slice(0, 6).map((cid, i) => (
                  <span key={cid}>
                    {i > 0 && ', '}
                    <button
                      className="link-btn"
                      onClick={() => {
                        st.setCircuit(cid);
                        st.setTab('wiring');
                      }}
                    >
                      {cid}
                    </button>
                  </span>
                ))}
                {c.circuits.length > 6 ? ` +${c.circuits.length - 6} more` : ''}
              </div>
            </div>
          );
        })}
      <div className="empty">Pin-outs, wire colours and cross-sections as printed in the {manifest.sources[manifest.wiring.source]?.title ?? 'wiring diagrams'}.</div>
    </div>
  );
}

/** Wiring tab: browse circuit sheets; the selected circuit's components are highlighted in 3D. */
export function CircuitBrowser({ manifest }: { manifest: Manifest }) {
  const { ix, error } = useWiring(manifest);
  const circuit = useViewer((s) => s.circuit);
  const nodes = useViewer((s) => s.nodes);
  const [q, setQ] = useState('');
  const st = useViewer.getState();
  const w = manifest.wiring;
  const sections = useMemo(() => {
    if (!ix) return [];
    const ql = q.trim().toLowerCase();
    const groups = new Map<string, typeof ix.data.circuits>();
    for (const c of ix.data.circuits) {
      if (ql) {
        const names = c.components.map((k) => ix.data.components[k]?.name ?? '').join(' ');
        if (!`${c.id} ${c.section} ${names} ${c.components.join(' ')}`.toLowerCase().includes(ql)) continue;
      }
      if (!groups.has(c.section)) groups.set(c.section, []);
      groups.get(c.section)!.push(c);
    }
    return [...groups];
  }, [ix, q]);

  const circuitWires = useMemo(() => (ix && circuit ? wiresOfCircuit(ix, circuit) : []), [ix, circuit]);
  if (!w) return <div className="empty">No wiring diagrams are attached to this vehicle yet.</div>;
  const selected = ix && circuit ? circuitNodes(ix, circuit) : null;
  const notApplicable = w.notApplicable.reduce((a, n) => a + n.codes.length, 0);
  return (
    <div>
      <p className="lede" style={{ marginTop: 0 }}>
        {w.stats.sheets} circuit sheets · {w.stats.components} components · {w.stats.connectors} connectors · {w.stats.wires} wires. {w.mapped} of {w.relevant} electrical components
        are placed in 3D{notApplicable ? `; ${notApplicable} more are printed for other engines, gearboxes or markets and do not apply to this car` : ''}.
        {w.layout ? ` Every part is wired into the harness network (${w.layout.branches} branches, ${w.layout.inline} in-line connectors, ${w.layout.grounds} ground points).` : ''}
      </p>
      {w.note && <div className="note">{w.note}</div>}
      <PublicationPicker manifest={manifest} />
      <label className="search-box" style={{ height: 38, marginTop: 10 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter circuits, components or codes…" aria-label="Filter circuits" />
      </label>
      {error && <div className="empty">Could not load the wiring data: {error}</div>}
      {!ix && !error && <div className="empty">Loading wiring diagrams…</div>}
      {selected && circuit && (
        <div className="card" style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <strong>{circuit}</strong>
            <button className="btn" onClick={() => st.setCircuit(null)}>
              Clear
            </button>
          </div>
          {ix && <WiresToggle ix={ix} wires={circuitWires} />}
          <div className="list" style={{ marginTop: 6 }}>
            {selected.mapped.map((id) => (
              <button key={id} className="list-item" onClick={() => st.select(id)}>
                <span className="dot" style={{ background: 'var(--warn)' }} /> {nodes.get(id)?.name ?? id}
              </button>
            ))}
            {selected.unmapped.map((u) => (
              <div key={u.code} className="list-item" style={{ cursor: 'default', color: 'var(--faint)' }}>
                <span className="dot" style={{ background: 'var(--faint)' }} /> {u.name}
                <span className="meta">
                  {u.code} · {ix?.notFitted.has(u.code) ? 'not fitted to this variant' : 'not modelled'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="section">
        {sections.map(([section, list]) => (
          <div key={section} style={{ marginBottom: 10 }}>
            <h3>{section}</h3>
            <div className="list">
              {list.map((c) => (
                <button key={c.id} className={`list-item ${circuit === c.id ? 'sel' : ''}`} onClick={() => st.setCircuit(circuit === c.id ? null : c.id)}>
                  {c.title} <span className="meta">sheet {c.sheet} · {c.components.length} parts</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
