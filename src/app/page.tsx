import Dashboard from '../components/Dashboard';
import { fetchAllMatches } from '../lib/gsMatchesDb';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const matches = await fetchAllMatches().catch(() => []);
  return <Dashboard initialMatches={matches} />;
}
