/**
 * The events calendar's stylesheet, scoped to this route.
 *
 * `calendar.css` styles the month grid and nothing else, and the grid only
 * exists on `/campus/events`.
 */
import '@/app/styles/calendar.css';
import '@/app/styles/lumen.css';

export default function EventsLayout({ children }) {
  return children;
}
