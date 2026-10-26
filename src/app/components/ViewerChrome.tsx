import { Crosshair, Expand, Eye, Layers, Minimize2, Palette, RotateCcw, Scissors, ScanEye, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useViewer, type SectionAxis } from '../store';
import { SystemIcon } from './common';

export function SystemRail() {
  const manifest = useViewer((s) => s.manifest);
  const hidden = useViewer((s) => s.hiddenSystems);
  const st = useViewer.getState();
  if (!manifest) return null;
  return (
    <nav className="rail" aria-label="Systems">
      <div className="rail-title">Systems</div>
      {manifest.systems.map((s) => (
        <button
          key={s.id}
          className={`rail-btn ${hidden.has(s.id) ? 'off' : 'on'}`}
          title={`${s.name} — ${s.summary}\nClick to toggle · Alt-click or double-click to show only this system`}
          onClick={(e) => (e.altKey ? st.soloSystem(s.id) : st.toggleSystem(s.id))}
          onDoubleClick={() => st.soloSystem(s.id)}
          aria-pressed={!hidden.has(s.id)}
        >
          <span className="swatch" style={{ background: s.color }} />
          <SystemIcon icon={s.icon} />
          {s.short}
        </button>
      ))}
      <button className="rail-btn" onClick={() => st.showAllSystems()} title="Show every system">
        <Layers size={18} strokeWidth={1.8} />
        All
      </button>
    </nav>
  );
}

export function ToolDock({ onHome }: { onHome: () => void }) {
  const explode = useViewer((s) => s.explode);
  const xray = useViewer((s) => s.xray);
  const colorMode = useViewer((s) => s.colorMode);
  const section = useViewer((s) => s.section);
  const selected = useViewer((s) => s.selected);
  const isolate = useViewer((s) => s.isolate);
  const brokenDown = useViewer((s) => s.brokenDown);
  const nodes = useViewer((s) => s.nodes);
  const st = useViewer.getState();
  // on phones the palette starts collapsed so the model keeps the screen
  const [open, setOpen] = useState<'explode' | 'section' | 'colour' | null>(() => (window.innerWidth > 980 ? 'explode' : null));
  const sel = selected ? nodes.get(selected) : null;
  const canBreak = !!sel && (sel.children.length > 0 || !!sel.detailChunk);

  const sectionRange: Record<Exclude<SectionAxis, null>, [number, number, string]> = {
    x: [-3620, 880, 'Front ↔ rear (X)'],
    y: [-960, 960, 'Left ↔ right (Y)'],
    z: [0, 1750, 'Height (Z)'],
  };

  return (
    <div className="tools" role="toolbar" aria-label="Viewer tools">
      <button className={`tool ${explode > 0 ? 'on' : ''}`} onClick={() => setOpen(open === 'explode' ? null : 'explode')}>
        <Expand size={16} /> <span className="t-label">Explode</span>
        <span className="k kbd">{Math.round(explode * 100)}%</span>
      </button>
      {open === 'explode' && (
        <div className="tool-extra">
          <input type="range" min={0} max={1} step={0.01} value={explode} aria-label="Explode systems" onChange={(e) => st.setExplode(Number(e.target.value))} />
          <div className="seg">
            <button
              className={explode === 0 ? 'on' : ''}
              onClick={() => {
                st.setExplode(0);
                st.focus(null);
              }}
            >
              Assembled
            </button>
            <button
              className={explode === 1 ? 'on' : ''}
              onClick={() => {
                st.setExplode(1);
                st.focus('*');
              }}
            >
              Exploded
            </button>
          </div>
        </div>
      )}
      <button
        className={`tool ${sel && brokenDown.has(sel.id) ? 'on' : ''}`}
        disabled={!canBreak}
        style={{ opacity: canBreak ? 1 : 0.4 }}
        onClick={() => {
          if (!sel) return;
          st.toggleBreakdown(sel.id);
          st.focus(sel.id);
        }}
        title="Take the selected assembly apart (B)"
      >
        <Minimize2 size={16} style={{ transform: 'rotate(45deg)' }} /> <span className="t-label">Break down</span>
        <span className="k kbd">B</span>
      </button>
      <button className={`tool ${xray ? 'on' : ''}`} onClick={() => st.setXray(!xray)} title="See-through body panels (X)">
        <Eye size={16} /> <span className="t-label">X-ray body</span>
        <span className="k kbd">X</span>
      </button>
      <button className={`tool ${isolate ? 'on' : ''}`} onClick={() => st.setIsolate(isolate ? null : selected)} disabled={!isolate && !selected} title="Show only the selection (I)">
        <ScanEye size={16} /> <span className="t-label">{isolate ? 'Exit isolate' : 'Isolate'}</span>
        <span className="k kbd">I</span>
      </button>
      <button className={`tool ${section.axis ? 'on' : ''}`} onClick={() => setOpen(open === 'section' ? null : 'section')}>
        <Scissors size={16} /> <span className="t-label">Section cut</span>
      </button>
      {open === 'section' && (
        <div className="tool-extra">
          <div className="seg">
            {(['x', 'y', 'z'] as const).map((a) => (
              <button
                key={a}
                className={section.axis === a ? 'on' : ''}
                onClick={() => {
                  if (section.axis === a) st.setSection(null);
                  else {
                    const [lo, hi] = sectionRange[a];
                    st.setSection(a, (lo + hi) / 2);
                  }
                }}
              >
                {a.toUpperCase()}
              </button>
            ))}
          </div>
          {section.axis && (
            <>
              <input
                type="range"
                min={sectionRange[section.axis][0]}
                max={sectionRange[section.axis][1]}
                step={5}
                value={section.offset}
                aria-label="Section position"
                onChange={(e) => st.setSection(section.axis, Number(e.target.value))}
              />
              <span>
                {sectionRange[section.axis][2]}: {section.offset} mm
              </span>
            </>
          )}
        </div>
      )}
      <button className={`tool ${colorMode !== 'realistic' ? 'on' : ''}`} onClick={() => setOpen(open === 'colour' ? null : 'colour')}>
        <Palette size={16} /> <span className="t-label">Colours</span>
      </button>
      {open === 'colour' && (
        <div className="tool-extra">
          <div className="seg">
            {(
              [
                ['realistic', 'Real'],
                ['systems', 'Systems'],
                ['verification', 'Verified'],
              ] as const
            ).map(([m, l]) => (
              <button key={m} className={colorMode === m ? 'on' : ''} onClick={() => st.setColorMode(m)}>
                {l}
              </button>
            ))}
          </div>
          {colorMode === 'verification' && (
            <span>
              <span className="dot" style={{ background: 'var(--ok)' }} /> verified <span className="dot" style={{ background: 'var(--warn)', marginLeft: 6 }} /> partial{' '}
              <span className="dot" style={{ background: 'var(--bad)', marginLeft: 6 }} /> unverified
            </span>
          )}
        </div>
      )}
      <div className="tool-sep" />
      <button
        className="tool"
        onClick={() => {
          st.reset();
          onHome();
        }}
      >
        <RotateCcw size={16} /> <span className="t-label">Reset</span>
      </button>
    </div>
  );
}

const VIEWS: { id: string; label: string; dir: [number, number, number] }[] = [
  { id: 'overview', label: '3/4 front', dir: [1.05, 0.55, 1] },
  { id: 'side', label: 'Side', dir: [1, 0.08, 0] },
  { id: 'front', label: 'Front', dir: [0, 0.12, 1] },
  { id: 'rear', label: 'Rear', dir: [0.25, 0.25, -1] },
  { id: 'top', label: 'Top', dir: [0.001, 1, 0.0005] },
  { id: 'under', label: 'Underside', dir: [0.3, -1, 0.35] },
  { id: 'engine', label: 'Engine bay', dir: [0.25, 1, 0.55] },
];

export function ViewBar({ onView, onZoom }: { onView: (dir: [number, number, number], target?: 'engine') => void; onZoom: (f: number) => void }) {
  return (
    <div className="viewbar" role="toolbar" aria-label="Camera views">
      <Crosshair size={15} color="var(--faint)" style={{ margin: '0 4px 0 6px' }} />
      {VIEWS.map((v) => (
        <button key={v.id} onClick={() => onView(v.dir, v.id === 'engine' ? 'engine' : undefined)}>
          {v.label}
        </button>
      ))}
      <span className="sep" />
      <button onClick={() => onZoom(0.8)} aria-label="Zoom in">
        <ZoomIn size={15} />
      </button>
      <button onClick={() => onZoom(1.25)} aria-label="Zoom out">
        <ZoomOut size={15} />
      </button>
    </div>
  );
}

/** Last pointer position over the 3D view. The tooltip follows it by transform, without re-rendering. */
const tip = { x: 0, y: 0, el: null as HTMLDivElement | null };

export function moveHoverTip(x: number, y: number) {
  tip.x = x;
  tip.y = y;
  if (tip.el) tip.el.style.transform = `translate3d(${x + 14}px, ${y + 14}px, 0)`;
}

export function HoverTip() {
  const hovered = useViewer((s) => (s.hoverTip ? s.hovered : null));
  const nodes = useViewer((s) => s.nodes);
  const manifest = useViewer((s) => s.manifest);
  if (!hovered || !manifest) return null;
  const n = nodes.get(hovered);
  if (!n) return null;
  const sys = manifest.systems.find((s) => s.id === n.system);
  return (
    <div
      className="hovertip"
      ref={(el) => {
        tip.el = el;
        if (el) moveHoverTip(tip.x, tip.y);
      }}
    >
      <div style={{ fontWeight: 600 }}>{n.name}</div>
      <div className="h-sys">
        <span className="dot" style={{ background: sys?.color, width: 7, height: 7 }} />
        {sys?.name}
        {n.location ? ` · ${n.location.text}` : ''}
      </div>
    </div>
  );
}

export function LoadingOverlay() {
  const status = useViewer((s) => s.status);
  const progress = useViewer((s) => s.progress);
  const error = useViewer((s) => s.error);
  // stays mounted for a moment once ready, so it can fade out over the model
  const [gone, setGone] = useState(false);
  useEffect(() => {
    setGone(false);
    if (status !== 'ready') return;
    const t = setTimeout(() => setGone(true), 600);
    return () => clearTimeout(t);
  }, [status]);
  if (gone) return null;
  return (
    <div className={`loading ${status === 'ready' ? 'done' : ''}`}>
      <div className="box">
        {status === 'error' ? (
          <div style={{ color: 'var(--bad)' }}>Could not load this vehicle: {error}</div>
        ) : (
          <>
            <div className="loading-mark" aria-hidden="true" />
            <div style={{ color: 'var(--muted)' }}>Loading vehicle…</div>
            <div className="bar">
              <span style={{ transform: `scaleX(${progress})` }} />
            </div>
            <div className="empty">{Math.round(progress * 100)}%</div>
          </>
        )}
      </div>
    </div>
  );
}
