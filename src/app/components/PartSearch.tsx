import { Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RuntimeNode } from '../../shared/manifest';
import { buildIndex, search } from '../../shared/search';
import { viewerLayout } from '../layout';
import { pathTo, useViewer } from '../store';

export function PartSearch() {
  const manifest = useViewer((s) => s.manifest);
  const nodes = useViewer((s) => s.nodes);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const index = useMemo(() => {
    if (!manifest) return null;
    const sysName = new Map(manifest.systems.map((s) => [s.id, s.name]));
    return buildIndex(
      manifest.nodes
        .filter((n) => n.kind !== 'system')
        .map((n) => ({
          item: n,
          fields: [
            { text: n.name, weight: 3 },
            { text: n.aliases.join(' '), weight: 2.5 },
            { text: n.id.replace(/-/g, ' '), weight: 1.5 },
            { text: sysName.get(n.system) ?? '', weight: 0.8 },
            { text: n.location?.text ?? '', weight: 0.6 },
            { text: n.partNumbers.map((p) => p.number).join(' '), weight: 2 },
          ],
        })),
    );
  }, [manifest]);

  const results = useMemo(() => (index && q.trim() ? search(index, q, 30) : []), [index, q]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest('input, textarea');
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const choose = (n: RuntimeNode) => {
    const st = useViewer.getState();
    st.select(n.id);
    st.focus(n.id);
    if (viewerLayout() === 'sheet') st.setSheet('half');
    setOpen(false);
    input.current?.blur();
  };

  const sysColor = useMemo(() => new Map(manifest?.systems.map((s) => [s.id, s.color]) ?? []), [manifest]);

  return (
    <div className="panel-search">
      <label className="search-box">
        <Search size={17} color="var(--muted)" />
        <input
          ref={input}
          value={q}
          placeholder="Search parts: battery, turbo, fuse box, ABS…"
          aria-label="Search components"
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            // on a phone the results need the room (the keyboard takes the bottom half)
            if (viewerLayout() === 'sheet') useViewer.getState().setSheet('full');
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(results.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter' && results[active]) choose(results[active].item);
            else if (e.key === 'Escape') {
              setQ('');
              input.current?.blur();
            }
          }}
        />
        {q ? (
          <button className="twist" style={{ border: 0, background: 'none', cursor: 'pointer', color: 'var(--muted)' }} onClick={() => setQ('')} aria-label="Clear search">
            <X size={15} />
          </button>
        ) : (
          <span className="kbd">/</span>
        )}
      </label>
      {open && q.trim() && (
        <div className="search-results" role="listbox">
          {results.length === 0 && <div className="empty" style={{ padding: 10 }}>No component matches “{q}”.</div>}
          {results.map((r, i) => {
            const path = pathTo(nodes, r.item.id)
              .slice(0, -1)
              .map((p) => p.name)
              .join(' › ');
            return (
              <button
                key={r.item.id}
                className={`result ${i === active ? 'active' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(r.item)}
                role="option"
                aria-selected={i === active}
              >
                <span className="dot" style={{ background: sysColor.get(r.item.system) }} />
                <span style={{ minWidth: 0 }}>
                  <div className="r-name">{r.item.name}</div>
                  <div className="r-meta">{path}</div>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
