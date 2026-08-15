import LiveVideoWall from '../../components/LiveVideoWall';

export const dynamic = 'force-dynamic';

export default function VideoWallPage() {
  return (
    <div className="min-h-screen bg-[#0d0d0d] text-white">
      <LiveVideoWall />
    </div>
  );
}
