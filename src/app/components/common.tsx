import {
  Armchair,
  Box,
  Cable,
  Car,
  CircleDot,
  Cog,
  Disc3,
  ExternalLink,
  Frame,
  Fuel,
  Gauge,
  Plug,
  Spline,
  Wind,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { Manifest, RuntimeNode } from '../../shared/manifest';
import {
  FACT_LEVELS,
  GEOMETRY_LEVELS,
  LEVEL_HELP,
  LEVEL_LABELS,
  PLACEMENT_LEVELS,
  type SourceRef,
  type VerificationStatus,
} from '../../shared/verification';


const SYSTEM_ICONS: Record<string, LucideIcon> = {
  car: Car,
  frame: Frame,
  armchair: Armchair,
  engine: Gauge,
  cog: Cog,
  spring: Spline,
  disc: Disc3,
  circle: CircleDot,
  wind: Wind,
  fuel: Fuel,
  zap: Zap,
};

export function SystemIcon({ icon, size = 18 }: { icon: string; size?: number }) {
  const I = SYSTEM_ICONS[icon] ?? Box;
  return <I size={size} strokeWidth={1.8} />;
}

export function KindIcon({ kind, size = 14 }: { kind: RuntimeNode['kind']; size?: number }) {
  if (kind === 'connector') return <Plug size={size} />;
  if (kind === 'harness' || kind === 'hose' || kind === 'pipe') return <Cable size={size} />;
  return <Box size={size} />;
}

const STATUS_LABEL: Record<VerificationStatus, string> = {
  verified: 'Verified',
  partial: 'Partially verified',
  unverified: 'Unverified',
};

export function StatusBadge({ status, short }: { status: VerificationStatus; short?: boolean }) {
  return <span className={`badge ${status}`}>{short ? STATUS_LABEL[status].split(' ')[0] : STATUS_LABEL[status]}</span>;
}

export const STATUS_HEX: Record<VerificationStatus, string> = { verified: '#3ecf8e', partial: '#f5b84a', unverified: '#ff5d6c' };

function Levels({ levels, value }: { levels: readonly string[]; value: string }) {
  const idx = levels.indexOf(value);
  return (
    <div className="levels" aria-label={LEVEL_LABELS[value]}>
      {levels.map((l, i) => (
        <span key={l} className={i <= idx ? 'fill' : ''} title={LEVEL_LABELS[l]} />
      ))}
    </div>
  );
}

export function VerificationCard({ node, manifest }: { node: RuntimeNode; manifest: Manifest }) {
  const v = node.verification;
  const facets: [string, readonly string[], string][] = [
    ['Geometry', GEOMETRY_LEVELS, v.geometry],
    ['Placement', PLACEMENT_LEVELS, v.placement],
    ['Facts', FACT_LEVELS, v.facts],
  ];
  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <StatusBadge status={v.status} />
        <span className="empty">confidence {v.score}/100</span>
      </div>
      {facets.map(([label, levels, value]) => (
        <div className="facet" key={label} title={LEVEL_HELP[value]}>
          <span>{label}</span>
          <Levels levels={levels} value={value} />
          <span className="lvl-name">
            {LEVEL_LABELS[value]} — {LEVEL_HELP[value]}
          </span>
        </div>
      ))}
      {v.notes && <div className="note">{v.notes}</div>}
      <div className="section" style={{ marginTop: 12 }}>
        <h3>Sources ({v.sources.length})</h3>
        {v.sources.length === 0 && <div className="empty">No sources cited yet — this component needs research.</div>}
        {v.sources.map((s, i) => (
          <SourceLine key={i} source={s} manifest={manifest} />
        ))}
      </div>
      <div className="section" style={{ marginTop: 10 }}>
        <h3>Reviews ({v.reviews.length})</h3>
        {v.reviews.length === 0 ? (
          <div className="empty">Not yet reviewed by a mechanic.</div>
        ) : (
          v.reviews.map((r, i) => (
            <div key={i} className="source">
              <div className="s-title">
                {r.verdict === 'approved' ? 'Approved' : 'Changes requested'} — {r.scope.join(', ')}
              </div>
              <div className="s-meta">
                {r.by}
                {r.role ? ` (${r.role})` : ''} · {r.date}
              </div>
              {r.notes && <q>{r.notes}</q>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function SourceLine({ source, manifest }: { source: SourceRef; manifest: Manifest }) {
  const s = manifest.sources[source.ref];
  if (!s) return <div className="source">Unknown source {source.ref}</div>;
  return (
    <div className="source">
      <div className="s-title">
        {s.url ? (
          <a href={s.url} target="_blank" rel="noreferrer">
            {s.title} <ExternalLink size={11} />
          </a>
        ) : (
          s.title
        )}
      </div>
      <div className="s-meta">
        {s.publisher ?? s.type} · reliability {s.reliability}
        {source.locator ? ` · ${source.locator}` : ''}
      </div>
      {source.says && <q>{source.says}</q>}
    </div>
  );
}
