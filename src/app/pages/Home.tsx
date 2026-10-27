import { ArrowRight, Cable, ClipboardCheck, Layers, Link2, Search, Wrench } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Catalog, CatalogEntry } from '../../shared/manifest';
import { searchCatalog } from '../../shared/catalog';
import { FACT_LEVELS, GEOMETRY_LEVELS, LEVEL_LABELS, PLACEMENT_LEVELS } from '../../shared/verification';
import { HeroScanner, largest, shortName, srcSet } from '../components/HeroScanner';
import { CountUp, Reveal, useInView } from '../components/motion';
import { asset, navigate } from '../router';

// warm the viewer bundle (and three.js) as soon as someone shows interest in a vehicle
const prefetchViewer = () => void import('./ViewerPage');
const openVehicle = (v: CatalogEntry, part?: string) => navigate(`/v/${v.id}${part ? `?part=${part}` : ''}`);

export default function Home() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [make, setMake] = useState<string | null>(null);

  useEffect(() => {
    fetch(asset('data/catalog.json'))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setCatalog)
      .catch((e: Error) => setError(e.message));
  }, []);

  const makes = useMemo(() => [...new Set(catalog?.vehicles.map((v) => v.make) ?? [])].sort(), [catalog]);
  const results = useMemo(() => {
    const list = catalog ? searchCatalog(catalog.vehicles, q) : [];
    return make ? list.filter((v) => v.make === make) : list;
  }, [catalog, q, make]);
  // the hero shows the most complete vehicle that has rendered images
  const featured = [...(catalog?.vehicles ?? [])].filter((v) => v.media).sort((a, b) => b.stats.parts - a.stats.parts)[0] ?? catalog?.vehicles[0] ?? null;

  // the hero's background drifts only while it is on screen
  const hero = useRef<HTMLElement>(null);
  const [heroOnScreen, setHeroOnScreen] = useState(true);
  useEffect(() => {
    const el = hero.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setHeroOnScreen(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <main className="home">
      <section ref={hero} className={`hero ${heroOnScreen ? '' : 'idle'}`}>
        <div className="hero-bg" aria-hidden="true">
          <span className="aurora a1" />
          <span className="aurora a2" />
          <span className="hero-grid" />
        </div>
        <div className="hero-inner">
          <div className="hero-copy">
            <span className="eyebrow-chip">
              <span className="live-dot" /> Interactive 3D anatomy of real vehicles
            </span>
            <h1>
              <span className="line">Every component.</span>
              <span className="line grad">Where it is, how to reach it.</span>
            </h1>
            <p className="lead">
              Take a car apart system by system, down to individual parts, connectors and harnesses — with every detail traced to the manufacturer's own documents.
            </p>
            <VehicleSearch catalog={catalog} q={q} setQ={setQ} results={results} />
            {featured && (
              <div className="hero-actions">
                <button className="btn-cta" onClick={() => openVehicle(featured)} onPointerEnter={prefetchViewer} onFocus={prefetchViewer}>
                  Open the {featured.model} in 3D <ArrowRight size={17} />
                </button>
                <button className="btn-ghost" onClick={() => document.getElementById('verified')?.scrollIntoView({ behavior: 'smooth' })}>
                  How it is verified
                </button>
              </div>
            )}
            {catalog && <HeroStats catalog={catalog} />}
          </div>
          <div className="hero-visual">{featured?.media && <HeroScanner entry={featured} />}</div>
        </div>
      </section>

      <section className="home-section" id="vehicles">
        <Reveal className="section-head">
          <span className="kicker">The atlas</span>
          <h2>Vehicles</h2>
          <div className="filters">
            <button className={!make ? 'on' : ''} onClick={() => setMake(null)}>
              All makes
            </button>
            {makes.map((m) => (
              <button key={m} className={make === m ? 'on' : ''} onClick={() => setMake(make === m ? null : m)}>
                {m}
              </button>
            ))}
          </div>
        </Reveal>
        {error && <div style={{ color: 'var(--bad)' }}>Could not load the vehicle catalogue: {error}</div>}
        <div className={`grid ${results.length === 1 ? 'single' : ''}`}>
          {results.map((v) => (
            <VehicleCard key={v.id} v={v} />
          ))}
          {catalog && results.length === 0 && <div className="empty">No vehicle matches “{q}” yet.</div>}
        </div>
      </section>

      {featured && <Features v={featured} />}

      <footer className="home-foot">
        <span className="brand-mark small" />
        <p>
          Vehicle Atlas shows where parts are and how they connect, with the source of every fact. Shapes are simplified where no measured geometry exists yet, and nothing is
          marked verified without a named reviewer. It is not a substitute for the workshop manual.
        </p>
      </footer>
    </main>
  );
}

function VehicleSearch({ catalog, q, setQ, results }: { catalog: Catalog | null; q: string; setQ: (q: string) => void; results: CatalogEntry[] }) {
  const input = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);
  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target as HTMLElement)?.closest('input, textarea')) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // example searches taken from the catalogue itself
  const examples = useMemo(() => [...new Set((catalog?.vehicles ?? []).flatMap((v) => [`${v.model} ${v.modelYear}`, v.aliases[0]]).filter(Boolean))].slice(0, 3), [catalog]);
  const shown = focused && q.trim() ? results.slice(0, 5) : [];
  return (
    <div className="hero-search">
      <label className="search-box">
        <Search size={19} color="var(--muted)" />
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => {
            setFocused(true);
            prefetchViewer();
          }}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(shown.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter' && results[active]) openVehicle(results[active]);
            else if (e.key === 'Escape') setQ('');
          }}
          placeholder="Search by make, model, year or engine"
          aria-label="Search vehicles"
          role="combobox"
          aria-expanded={shown.length > 0}
          aria-controls="vehicle-suggest"
          enterKeyHint="go"
        />
        <span className="kbd">/</span>
      </label>
      {focused && q.trim() && (
        <div className="suggest" id="vehicle-suggest" role="listbox">
          {shown.map((v, i) => (
            <button
              key={v.id}
              role="option"
              aria-selected={i === active}
              className={`suggest-row ${i === active ? 'active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => openVehicle(v)}
            >
              {v.media?.images.hero ? <img src={asset(v.media.images.hero.files[0].url)} alt="" /> : <span className="suggest-ph" />}
              <span>
                <strong>
                  {v.make} {v.model} {v.variant}
                </strong>
                <small>
                  {v.modelYear} · {v.engine.split(' (')[0]} · {v.market}
                </small>
              </span>
              <ArrowRight size={15} />
            </button>
          ))}
          {shown.length === 0 && <div className="empty">No vehicle matches “{q}” yet.</div>}
        </div>
      )}
      {examples.length > 0 && (
        <div className="try">
          Try
          {examples.map((t) => (
            <button key={t} onClick={() => setQ(t)}>
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function HeroStats({ catalog }: { catalog: Catalog }) {
  const [ref, seen] = useInView<HTMLDListElement>('0px');
  const sum = (f: (v: CatalogEntry) => number) => catalog.vehicles.reduce((a, v) => a + f(v), 0);
  const stats: [number, string][] = [
    [sum((v) => v.stats.parts), 'components in 3D'],
    [sum((v) => v.highlights.wires), 'wires from the diagrams'],
    [sum((v) => v.highlights.joints), 'documented joints'],
    [sum((v) => v.highlights.sources), 'sources cited'],
  ];
  return (
    <dl className="hero-stats" ref={ref}>
      {stats.map(([n, label]) => (
        <div key={label}>
          <dt>
            <CountUp value={n} run={seen} />
          </dt>
          <dd>{label}</dd>
        </div>
      ))}
    </dl>
  );
}

function VehicleCard({ v }: { v: CatalogEntry }) {
  const [ref, seen] = useInView<HTMLButtonElement>();
  const total = v.stats.verified + v.stats.partial + v.stats.unverified;
  const pct = (n: number) => `${(100 * n) / Math.max(1, total)}%`;
  const hero = v.media?.images.hero;
  const xray = v.media?.images.xray;
  return (
    <button ref={ref} className={`vcard ${seen ? 'in' : ''}`} onPointerEnter={prefetchViewer} onFocus={prefetchViewer} onClick={() => openVehicle(v)}>
      {hero && (
        <span className="vcard-media" aria-hidden="true">
          <img className="v-solid" src={largest(hero)} srcSet={srcSet(hero)} sizes="(max-width: 760px) 92vw, 520px" alt="" loading="lazy" decoding="async" />
          {xray && <img className="v-xray" src={largest(xray)} srcSet={srcSet(xray)} sizes="(max-width: 760px) 92vw, 520px" alt="" loading="lazy" decoding="async" />}
        </span>
      )}
      <span className="vcard-body">
        <span className="make">
          {v.make} · {v.generation}
        </span>
        <h2>
          {v.model} {v.variant}
        </h2>
        <span className="meta">
          {v.modelYear} model year · {v.engine.split(' (')[0]}
        </span>
        <span className="meta">
          {v.transmission.split(' (')[0]} · {v.drive.split(' (')[0]} · {v.market}
        </span>
        <span className="bar grow" title="verified / partially verified / unverified components">
          <span style={{ width: pct(v.stats.verified), background: 'var(--ok)' }} />
          <span style={{ width: pct(v.stats.partial), background: 'var(--warn)' }} />
          <span style={{ width: pct(v.stats.unverified), background: 'var(--bad)' }} />
        </span>
        <span className="meta">
          {total} components · {v.systems.length} systems · {(v.stats.bytes / 1024 / 1024).toFixed(1)} MB to load
        </span>
        <span className="vcard-cta">
          Open in 3D <ArrowRight size={15} />
        </span>
      </span>
    </button>
  );
}

function Features({ v }: { v: CatalogEntry }) {
  const img = v.media?.images ?? {};
  const total = v.stats.verified + v.stats.partial + v.stats.unverified;
  const [barRef, barSeen] = useInView<HTMLDivElement>();
  return (
    <>
      <section className="home-section feature">
        {img.exploded && (
          <Reveal className="feature-media">
            <img src={largest(img.exploded)} srcSet={srcSet(img.exploded)} sizes="(max-width: 860px) 92vw, 560px" alt={`The ${v.model} with its systems pulled apart`} loading="lazy" decoding="async" />
          </Reveal>
        )}
        <Reveal className="feature-copy" delay={80}>
          <span className="kicker">
            <Layers size={14} /> Layer by layer
          </span>
          <h2>Take it apart the way a mechanic would.</h2>
          <p>
            {v.systems.length} systems as independent layers, like an anatomy atlas. Show one on its own, pull them all apart, or break a single assembly down to its pieces — the
            caliper, the turbocharger, the clutch.
          </p>
          <ul className="system-chips">
            {v.systems.map((s, i) => (
              <li key={s.id} style={{ ['--c' as string]: s.color, transitionDelay: `${120 + i * 40}ms` }}>
                {s.short}
              </li>
            ))}
          </ul>
        </Reveal>
      </section>

      <section className="home-section feature flip">
        {img.wiring && (
          <Reveal className="feature-media fade-edges">
            <img src={largest(img.wiring)} srcSet={srcSet(img.wiring)} sizes="(max-width: 860px) 92vw, 560px" alt="The engine control module and its wires drawn along the harness" loading="lazy" decoding="async" />
          </Reveal>
        )}
        <Reveal className="feature-copy" delay={80}>
          <span className="kicker">
            <Cable size={14} /> Wiring
          </span>
          <h2>Every wire, traced along the harness.</h2>
          <p>
            Connector pin-outs, wire colours and routes from the manufacturer's wiring diagrams, drawn in 3D from one part to the next — for each model year of the diagrams.
          </p>
          <div className="mini-stats">
            <span>
              <b>{v.highlights.wires.toLocaleString('en-GB')}</b> wires
            </span>
            <span>
              <b>{v.highlights.wiringIssues}</b> diagram issues
            </span>
            <span>
              <b>{v.highlights.connectors}</b> connectors modelled
            </span>
          </div>
        </Reveal>
      </section>

      <section className="home-section">
        <div className="trio">
          {(
            [
              [Wrench, 'Where and how to reach', 'Each part records where it sits, the approach — bonnet, underside, wheel arch, cabin — and what has to come off first.'],
              [Link2, 'What it is joined to', `${v.highlights.joints} documented joints with the manual's torque and page, plus the hoses, pipes and cables between parts.`],
              [Search, 'Found by mechanic terms', 'Search for “fuse box”, “turbo” or “ABS”: synonyms, wiring codes and part numbers all lead to the part.'],
            ] as const
          ).map(([Icon, title, text], i) => (
            <Reveal key={title} className="trio-card" delay={i * 90}>
              <span className="trio-icon">
                <Icon size={19} />
              </span>
              <h3>{title}</h3>
              <p>{text}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="home-section feature" id="verified">
        <Reveal className="feature-copy">
          <span className="kicker">
            <ClipboardCheck size={14} /> Verification
          </span>
          <h2>Verified, not guessed.</h2>
          <p>
            Every fact cites a source and a page. Each part's geometry, placement and facts are graded separately, the build checks dimensions, interference, duplicates and wiring
            on every change — and nothing counts as verified until a named reviewer signs it off.
          </p>
          <button className="btn-ghost" onClick={() => navigate(`/v/${v.id}/verification`)}>
            Open the verification report <ArrowRight size={15} />
          </button>
        </Reveal>
        <Reveal className="verify-panel" delay={80}>
          <div className="verify-head">
            <strong>
              {v.model} {v.variant}
            </strong>
            <span className="empty">{v.highlights.sources} sources cited</span>
          </div>
          <div ref={barRef} className={`bar big grow ${barSeen ? 'in' : ''}`}>
            <span style={{ width: `${(100 * v.stats.verified) / total}%`, background: 'var(--ok)' }} />
            <span style={{ width: `${(100 * v.stats.partial) / total}%`, background: 'var(--warn)' }} />
            <span style={{ width: `${(100 * v.stats.unverified) / total}%`, background: 'var(--bad)' }} />
          </div>
          <dl className="verify-counts">
            <div>
              <dt style={{ color: 'var(--ok)' }}>
                <CountUp value={v.stats.verified} run={barSeen} />
              </dt>
              <dd>verified</dd>
            </div>
            <div>
              <dt style={{ color: 'var(--warn)' }}>
                <CountUp value={v.stats.partial} run={barSeen} />
              </dt>
              <dd>partially verified</dd>
            </div>
            <div>
              <dt style={{ color: 'var(--bad)' }}>
                <CountUp value={v.stats.unverified} run={barSeen} />
              </dt>
              <dd>unverified</dd>
            </div>
          </dl>
          <ul className="facets">
            {(
              [
                ['Geometry', GEOMETRY_LEVELS],
                ['Placement', PLACEMENT_LEVELS],
                ['Facts', FACT_LEVELS],
              ] as const
            ).map(([label, levels]) => (
              <li key={label}>
                <b>{label}</b> {levels.map((l) => LEVEL_LABELS[l]).join(' → ')}
              </li>
            ))}
          </ul>
          {v.media?.hotspots.length ? (
            <div className="verify-try">
              Try one:{' '}
              {v.media.hotspots.slice(0, 3).map((h) => (
                <button key={h.id} className="link-btn" onClick={() => openVehicle(v, h.id)}>
                  {shortName(h.name)}
                </button>
              ))}
            </div>
          ) : null}
        </Reveal>
      </section>
    </>
  );
}
