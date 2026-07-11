import { ALL_MATCHES } from '../lib/processData';
import Dashboard from '../components/Dashboard';

export default function Home() {
  return <Dashboard initialMatches={ALL_MATCHES} />;
}
