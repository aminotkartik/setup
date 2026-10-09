/**
 * Campus activity calendar — month grid.
 *
 * Server-rendered from URL state: month navigation is plain links, every event
 * chip links to the existing event detail page, and the current date carries
 * `aria-current`. No animation, so reduced-motion needs no special case. On
 * narrow phones the page defaults to the agenda view instead of this grid.
 */

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { ROUTES } from '@/lib/constants';
import { Icon } from '@/components/ui/icons';
import { monthGrid, monthLabel, monthParam, shiftMonth, WEEKDAY_LABELS } from '@/components/campus/eventMeta';

export function EventCalendar({ year, month, events = [], today, query = {} }) {
  const days = monthGrid(year, month);
  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);

  const hrefFor = (overrides) => {
    const params = new URLSearchParams({ view: 'calendar', ...query, ...overrides });
    for (const [key, value] of [...params.entries()]) {
      if (!value) params.delete(key);
    }
    return `/campus/events?${params.toString()}`;
  };

  const byDay = new Map();
  for (const event of events) {
    const key = String(event.starts_on).slice(0, 10);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(event);
  }

  return (
    <section aria-label={`Events for ${monthLabel(year, month)}`} className="card overflow-hidden">
      <header className="flex items-center justify-between gap-2 border-b border-line bg-surface-2 px-3 py-2.5">
        <Link href={hrefFor({ month: monthParam(prev.year, prev.month) })} className="icon-btn" aria-label={`Previous month, ${monthLabel(prev.year, prev.month)}`}>
          <Icon name="chevronLeft" size={16} />
        </Link>
        <h2 className="text-sm font-semibold" aria-live="polite">{monthLabel(year, month)}</h2>
        <div className="flex items-center gap-1">
          <Link href={hrefFor({ month: undefined })} className="btn btn-quiet btn-sm">Today</Link>
          <Link href={hrefFor({ month: monthParam(next.year, next.month) })} className="icon-btn" aria-label={`Next month, ${monthLabel(next.year, next.month)}`}>
            <Icon name="chevronRight" size={16} />
          </Link>
        </div>
      </header>

      <div role="grid" aria-label="Month view" className="calendar-grid">
        <div role="row" className="calendar-row calendar-head">
          {WEEKDAY_LABELS.map((label) => (
            <span key={label} role="columnheader" className="calendar-head-cell">{label}</span>
          ))}
        </div>
        {[0, 1, 2, 3, 4, 5].map((week) => (
          <div key={week} role="row" className="calendar-row">
            {days.slice(week * 7, week * 7 + 7).map((day) => {
              const inMonth = day.slice(0, 7) === `${year}-${String(month).padStart(2, '0')}`;
              const dayEvents = byDay.get(day) || [];
              const isToday = day === today;
              return (
                <div
                  key={day}
                  role="gridcell"
                  aria-current={isToday ? 'date' : undefined}
                  aria-label={`${day}${dayEvents.length ? `, ${dayEvents.length} event${dayEvents.length === 1 ? '' : 's'}` : ''}`}
                  className={cn('calendar-cell', !inMonth && 'calendar-cell-dim', isToday && 'calendar-cell-today')}
                >
                  <span className="calendar-day" aria-hidden="true">{Number(day.slice(8, 10))}</span>
                  {dayEvents.length ? (
                    <ul className="calendar-events">
                      {dayEvents.slice(0, 3).map((event) => (
                        <li key={event.id}>
                          <Link
                            href={ROUTES.event(event.id)}
                            className="calendar-chip"
                            title={`${event.title} · ${event.location || ''}`}
                          >
                            {event.is_official ? null : <span className="calendar-chip-dot" aria-hidden="true" />}
                            <span className="calendar-chip-text">{event.title}</span>
                          </Link>
                        </li>
                      ))}
                      {dayEvents.length > 3 ? (
                        <li>
                          <Link href={hrefFor({ view: 'agenda', day })} className="calendar-more">
                            +{dayEvents.length - 3} more
                          </Link>
                        </li>
                      ) : null}
                    </ul>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <p className="border-t border-line px-3 py-2 text-2xs text-muted">
        Dotted chips are student-organized events; the rest are official. Every event opens its detail page with RSVP.
      </p>
    </section>
  );
}
