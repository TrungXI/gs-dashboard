import Dashboard from '../components/Dashboard';
import { fetchMatchesPage, fetchMatchFilterOptions } from '../lib/gsMatchesDb';
import type { FilterOptions } from '../lib/gsMatchesDb';
import type { Match } from '../types/match';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

export default async function Home() {
  let initialMatches: Match[] = [];
  let initialTotal = 0;
  let initialOptions: FilterOptions | null = null;

  try {
    const [page, options] = await Promise.all([
      fetchMatchesPage({ type: 'all', date: 'all', team: 'all', limit: PAGE_SIZE, offset: 0 }),
      fetchMatchFilterOptions(),
    ]);
    initialMatches = page.matches;
    initialTotal = page.total;
    initialOptions = options;
  } catch {
    // DB unavailable — Dashboard renders empty and can retry client-side.
  }

  return (
    <Dashboard
      initialMatches={initialMatches}
      initialTotal={initialTotal}
      initialOptions={initialOptions}
      pageSize={PAGE_SIZE}
    />
  );
}
