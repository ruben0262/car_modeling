import { ClipboardCheck, Search } from 'lucide-react';
import { lazy, Suspense } from 'react';
import Home from './pages/Home';
import { navigate, useLocation } from './router';
import { useViewer } from './store';

// three.js is only downloaded once a vehicle is opened
const ViewerPage = lazy(() => import('./pages/ViewerPage'));
const VerificationPage = lazy(() => import('./pages/VerificationPage'));

function TopBar({ vehicleId }: { vehicleId: string | null }) {
  const manifest = useViewer((s) => s.manifest);
  const v = vehicleId && manifest?.vehicle.id === vehicleId ? manifest.vehicle : null;
  return (
    <header className="topbar">
      <button className="brand" onClick={() => navigate('/')}>
        <span className="brand-mark" />
        Vehicle Atlas
      </button>
      <div className="crumbs">
        {v && (
          <>
            <span>{v.make}</span>›<span>{v.model}</span>›<strong>
              {v.modelYear} {v.variant.name}
            </strong>
          </>
        )}
      </div>
      <div className="spacer" />
      {vehicleId && (
        <button className="chip-btn" onClick={() => navigate(`/v/${vehicleId}/verification`)}>
          <ClipboardCheck size={15} /> <span className="t-label">Verification</span>
        </button>
      )}
      <button className="chip-btn" onClick={() => navigate('/')}>
        <Search size={15} /> <span className="t-label">Find a vehicle</span>
      </button>
    </header>
  );
}

export function App() {
  const { path, search } = useLocation();
  const m = path.match(/^\/v\/([a-z0-9-]+)(\/verification)?\/?$/);
  const vehicleId = m?.[1] ?? null;
  return (
    <>
      <TopBar vehicleId={vehicleId} />
      <Suspense fallback={<div className="loading">Loading…</div>}>
        {!m ? <Home /> : m[2] ? <VerificationPage vehicleId={m[1]} /> : <ViewerPage vehicleId={m[1]} initialPart={search.get('part')} />}
      </Suspense>
    </>
  );
}
