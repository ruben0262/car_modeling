import { useEffect, useMemo, useState } from 'react';
import type { Catalog, Manifest, RuntimeNode } from '../../shared/manifest';
import { LEVEL_LABELS } from '../../shared/verification';
import { StatusBadge } from '../components/common';
import { asset, navigate } from '../router';

type SortKey = 'name' | 'system' | 'status' | 'score' | 'sources';

export default function VerificationPage({ vehicleId }: { vehicleId: string }) {
  const [m, setM] = useState<Manifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [status, setStatus] = useState<string>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'score', dir: 1 });

  useEffect(() => {
    (async () => {
      const cat: Catalog = await (await fetch(asset('data/catalog.json'))).json();
      const e = cat.vehicles.find((v) => v.id === vehicleId);
      if (!e) throw new Error('unknown vehicle');
      setM(await (await fetch(asset(e.manifest))).json());
    })().catch((e: Error) => setError(e.message));
  }, [vehicleId]);

  const rows = useMemo(() => {
    if (!m) return [];
    const sys = new Map(m.systems.map((s) => [s.id, s.name]));
    const q = filter.toLowerCase();
    const list = m.nodes.filter(
      (n) => n.kind !== 'system' && (status === 'all' || n.verification.status === status) && (!q || `${n.name} ${n.id} ${sys.get(n.system)}`.toLowerCase().includes(q)),
    );
    const val = (n: RuntimeNode): string | number =>
      sort.key === 'name'
        ? n.name
        : sort.key === 'system'
          ? (sys.get(n.system) ?? '')
          : sort.key === 'status'
            ? n.verification.status
            : sort.key === 'sources'
              ? n.verification.sources.length
              : n.verification.score;
    return list.sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir;
    });
  }, [m, filter, status, sort]);

  if (error) return <main className="report"><div className="report-inner" style={{ color: 'var(--bad)' }}>{error}</div></main>;
  if (!m) return <main className="report"><div className="report-inner">Loading…</div></main>;
  const sysName = new Map(m.systems.map((s) => [s.id, s.name]));
  const st = m.stats.byStatus;
  const th = (key: SortKey, label: string) => (
    <th onClick={() => setSort({ key, dir: sort.key === key ? (-sort.dir as 1 | -1) : 1 })}>
      {label}
      {sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
    </th>
  );

  return (
    <main className="report">
      <div className="report-inner">
        <button className="btn" onClick={() => navigate(`/v/${vehicleId}`)}>
          ← Back to the 3D model
        </button>
        <h1 style={{ marginTop: 16 }}>
          Verification report — {m.vehicle.make} {m.vehicle.model} {m.vehicle.modelYear} {m.vehicle.variant.name}
        </h1>
        <p className="lede">
          A component is <b>verified</b> only when its geometry is at least representative, its placement is referenced to the workshop manual or measured, its facts come from OEM documentation, and a named reviewer has approved all three.
        </p>
        <div className="stat-row">
          <div className="stat">
            <div className="n" style={{ color: 'var(--ok)' }}>{st.verified}</div>
            <div className="l">verified</div>
          </div>
          <div className="stat">
            <div className="n" style={{ color: 'var(--warn)' }}>{st.partial}</div>
            <div className="l">partially verified</div>
          </div>
          <div className="stat">
            <div className="n" style={{ color: 'var(--bad)' }}>{st.unverified}</div>
            <div className="l">unverified</div>
          </div>
          <div className="stat">
            <div className="n">{m.checks.filter((c) => c.severity !== 'info').length}</div>
            <div className="l">open automated-check findings</div>
          </div>
        </div>
        <h2 style={{ marginTop: 28, fontSize: 18 }}>Automated checks</h2>
        {m.checks.map((c) => (
          <div key={c.id} className="check">
            <span className={`badge ${c.severity === 'error' ? 'unverified' : c.severity === 'warning' ? 'partial' : 'verified'}`}>{c.severity}</span>
            <div style={{ flex: 1 }}>
              {c.title}
              {c.detail && <pre>{c.detail}</pre>}
            </div>
          </div>
        ))}
        <h2 style={{ marginTop: 28, fontSize: 18 }}>Components</h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <label className="search-box" style={{ height: 38, maxWidth: 340 }}>
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter components…" aria-label="Filter components" />
          </label>
          <div className="seg" style={{ width: 380 }}>
            {['all', 'verified', 'partial', 'unverified'].map((s) => (
              <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
        <table>
          <thead>
            <tr>
              {th('name', 'Component')}
              {th('system', 'System')}
              {th('status', 'Status')}
              <th>Geometry</th>
              <th>Placement</th>
              <th>Facts</th>
              {th('sources', 'Sources')}
              <th>Reviews</th>
              {th('score', 'Score')}
            </tr>
          </thead>
          <tbody>
            {rows.map((n) => (
              <tr key={n.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/v/${vehicleId}?part=${n.id}`)}>
                <td>
                  {n.name}
                  <div className="mono empty">{n.id}</div>
                </td>
                <td>{sysName.get(n.system)}</td>
                <td>
                  <StatusBadge status={n.verification.status} short />
                </td>
                <td>{LEVEL_LABELS[n.verification.geometry]}</td>
                <td>{LEVEL_LABELS[n.verification.placement]}</td>
                <td>{LEVEL_LABELS[n.verification.facts]}</td>
                <td>{n.verification.sources.length}</td>
                <td>{n.verification.reviews.length}</td>
                <td>{n.verification.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
