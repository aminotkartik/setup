import { readIntroSeen } from '@/lib/intro';
import { HomeLaunchGate } from '@/components/layout/HomeLaunchGate';

/**
 * Home launch layout — where the cinematic Campus+ intro lives.
 *
 * The intro is a loading-layer experience, so it is mounted *around* Home
 * (page + route loading state) rather than inside it: the overlay starts the
 * moment Home begins loading, the page streams in behind it untouched, and
 * when the content commits the scene completes its reveal and fades into the
 * interface. The session cookie decides once per browsing session — the very
 * first Home load of a session gets the launch, every later load (including
 * client-side navigation around the already-loaded app) renders Home
 * directly. No Home data, auth or layout logic lives here.
 */
export default async function HomeLaunchLayout({ children }) {
  if (await readIntroSeen()) return children;
  return <HomeLaunchGate>{children}</HomeLaunchGate>;
}
