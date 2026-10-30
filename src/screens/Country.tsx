import { CountryProfile } from '../components/CountryProfile';
import { BY_ID } from '../data';
import { go } from '../lib/router';

export default function Country({ id }: { id?: string }) {
  if (!id || !BY_ID[id]) { go('/atlas'); return null; }
  return <CountryProfile key={id} id={id} />;
}
