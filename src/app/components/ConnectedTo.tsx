import { Link2, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { LinkInfo, Manifest, RuntimeNode } from '../../shared/manifest';
import { useViewer } from '../store';
import { electricalNeighbours, loadWiring, type ElectricalNeighbour } from '../wiring';
import { KindIcon } from './common';

const TYPE_LABEL: Record<LinkInfo['type'], string> = {
  bolted: 'Bolted',
  clipped: 'Clipped',
  plugged: 'Plugged',
  screwed: 'Screwed',
  pressed: 'Pressed',
  hose: 'Hose',
  pipe: 'Pipe',
  shaft: 'Shaft',
  belt: 'Belt',
  cable: 'Cable',
  harness: 'Harness',
  electrical: 'Wired',
  sealed: 'Sealed',
};

const SHOWN = 12;

function useNeighbours(manifest: Manifest, node: RuntimeNode): ElectricalNeighbour[] | null {
  const [out, setOut] = useState<ElectricalNeighbour[] | null>(null);
  const pub = useViewer((s) => s.wiringPub);
  useEffect(() => {
    setOut(null);
    const p = loadWiring(manifest, pub);
    if (!p) return;
    let alive = true;
    p.then((ix) => alive && setOut(electricalNeighbours(ix, node))).catch(() => alive && setOut([]));
    return () => {
      alive = false;
    };
  }, [manifest, node, pub]);
  return out;
}

/** "Connected to": documented joints, joins seen in the model, and parts wired to this one. */
export function ConnectedTo({ node, manifest }: { node: RuntimeNode; manifest: Manifest }) {
  const nodes = useViewer((s) => s.nodes);
  const st = useViewer.getState();
  const [all, setAll] = useState(false);
  const wired = useNeighbours(manifest, node);
  const links = node.links ?? [];
  const documented = links.filter((l) => l.evidence === 'authored');
  const derived = links.filter((l) => l.evidence === 'derived');
  const electrical = useMemo(() => (wired ?? []).filter((w) => nodes.has(w.node)), [wired, nodes]);
  if (!documented.length && !derived.length && !electrical.length) return null;
  const name = (id: string) => nodes.get(id)?.name ?? id;

  return (
    <div className="section">
      <h3>
        <Link2 size={12} /> Connected to
      </h3>
      {documented.length > 0 && (
        <div className="links">
          {documented.map((l) => {
            const src = l.source ? manifest.sources[l.source.ref] : undefined;
            return (
              <div key={`${l.to}-${l.type}`} className="link-row">
                <span className="link-type">{TYPE_LABEL[l.type]}</span>
                <div className="link-body">
                  <button className="link-btn" onClick={() => st.select(l.to)} onMouseEnter={() => st.hover(l.to)} onMouseLeave={() => st.hover(null)}>
                    {name(l.to)}
                  </button>
                  {l.torque && <span className="mono link-torque">{l.torque}</span>}
                  {l.note && <div className="empty">{l.note}</div>}
                  {src && (
                    <div className="s-meta">
                      {src.title.replace(/\s*\([^)]*\)/g, '')}
                      {l.source?.locator ? ` · ${l.source.locator}` : ''}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {derived.length > 0 && (
        <div className="links">
          <div className="empty" style={{ margin: '6px 0 2px' }}>
            Seen in the model (hose, pipe and cable ends; not from a document):
          </div>
          {derived.map((l) => (
            <div key={`${l.to}-${l.type}`} className="link-row derived">
              <span className="link-type">{TYPE_LABEL[l.type]}</span>
              <div className="link-body">
                <button className="link-btn" onClick={() => st.select(l.to)} onMouseEnter={() => st.hover(l.to)} onMouseLeave={() => st.hover(null)}>
                  {name(l.to)}
                </button>
                {l.note && <div className="empty">{l.note}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
      {electrical.length > 0 && (
        <div className="links">
          <div className="empty" style={{ margin: '6px 0 2px' }}>
            <Zap size={11} /> Wired to ({electrical.length} part{electrical.length === 1 ? '' : 's'}, from the wiring diagrams):
          </div>
          <div className="list">
            {(all ? electrical : electrical.slice(0, SHOWN)).map((w) => (
              <button key={w.node} className="list-item" onClick={() => st.select(w.node)} onMouseEnter={() => st.hover(w.node)} onMouseLeave={() => st.hover(null)}>
                <KindIcon kind={nodes.get(w.node)?.kind ?? 'part'} /> {name(w.node)}
                <span className="meta">
                  {w.wires.size} wire{w.wires.size === 1 ? '' : 's'}
                  {w.via.has('direct') ? '' : ` · via ${[...w.via].join(', ')}`}
                </span>
              </button>
            ))}
          </div>
          {electrical.length > SHOWN && (
            <button className="link-btn" onClick={() => setAll(!all)}>
              {all ? 'Show fewer' : `Show all ${electrical.length}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
