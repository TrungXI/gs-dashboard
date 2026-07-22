'use client';

import { useEffect, useState } from 'react';
import MatchupCard from './MatchupCard';
import type { MatchupResponse, MatchupBlock } from '../lib/teamForm';

/**
 * Thin fetch shell around <MatchupCard>. Given the two (suffixed) team names of a
 * match, it fetches the H2H matchup narrative and delegates all rendering —
 * loading / error / never-met / normal — to MatchupCard. Reused by both
 * match-detail drawers (MatchDetailDrawer + LiveAnalysisDrawer).
 */
export default function MatchupView({ teamA, teamB }: { teamA: string; teamB: string }) {
  const [matchup, setMatchup] = useState<MatchupBlock | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Guard: same-team or empty → show nothing, skip the fetch (safety no-op).
    if (!teamA || !teamB || teamA === teamB) {
      setLoading(false);
      setMatchup(null);
      setError(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    // Giữ matchup cũ trong lúc reload (đổi trận qua ◀▶) — MatchupCard sẽ phủ mờ
    // thay vì blank trắng rồi reflow.
    const url =
      `/api/gs-team-history?v=2&mode=matchup` +
      `&teamA=${encodeURIComponent(teamA)}&teamB=${encodeURIComponent(teamB)}`;
    fetch(url)
      .then((r) => r.json())
      .then((json: MatchupResponse) => {
        if (!alive) return;
        if (!json.ok) {
          setError(
            json.error === 'no db'
              ? 'Chưa cấu hình ANALYSIS_DATABASE_URL — không kết nối được DB thống kê.'
              : json.error || 'Không tải được dữ liệu đối đầu.',
          );
          setMatchup(null);
          return;
        }
        setMatchup(json.matchup ?? null);
      })
      .catch(() => {
        if (alive) setError('Không tải được dữ liệu đối đầu.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [teamA, teamB]);

  return (
    <div className="px-3 pb-4 md:px-4">
      <MatchupCard matchup={matchup} loading={loading} error={error} />
    </div>
  );
}
