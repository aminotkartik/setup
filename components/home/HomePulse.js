import { ROUTES } from '@/lib/constants';
import { LinkButton } from '@/components/ui';
import { SearchEntry } from '@/components/search/SearchEntry';

/**
 * The threshold — the first thing a student sees on Home.
 *
 * Deliberately *not* a card: this is the environment, and the greeting is set
 * as editorial display type directly over it. Three things live here and
 * nothing else:
 *
 *   - who you are and when it is (a small live marker, the name at display
 *     size, one line of context),
 *   - the two ways in (Explore, and the search door),
 *   - a thin column of counts, each one a real length of something this page
 *     already loaded — never a fabricated metric, and never a number that
 *     implies activity the database does not have.
 *
 * The counts are rendered from `stats`, so the page decides which of them exist;
 * a module with nothing in it simply does not appear.
 */
export function HomePulse({ user, stats = [] }) {
  const name = (user.profile.display_name || user.profile.username).split(' ')[0];
  const context =
    user.profile.branch && user.profile.show_branch_year
      ? `${user.profile.branch} · everything happening around campus right now`
      : 'Everything happening around campus right now';

  return (
    <section className="home-pulse" aria-labelledby="home-greeting">
      <span className="home-pulse__aurora" aria-hidden="true" />

      <div className="home-pulse__grid">
        <div className="min-w-0">
          <p className="home-pulse__eyebrow">
            <span className="home-pulse__dot" aria-hidden="true" />
            PCCOE · Campus feed
          </p>
          <h1 id="home-greeting" className="home-pulse__title">
            Good to see you,
            <span className="home-pulse__name">{name}</span>
          </h1>
          <p className="home-pulse__lead">{context}</p>

          <div className="home-pulse__actions">
            <LinkButton href={ROUTES.explore} size="md" variant="sheen" icon="search">
              Explore campus
            </LinkButton>
            <div className="home-pulse__search">
              <SearchEntry />
            </div>
          </div>
        </div>

        {stats.length ? (
          <dl className="home-pulse__stats" aria-label="Campus right now">
            {stats.map((stat) => (
              <div className="home-pulse__stat" key={stat.label} data-empty={stat.value === 0 ? 'true' : undefined}>
                <dt>{stat.label}</dt>
                <dd>{stat.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>

      <span className="home-pulse__horizon" aria-hidden="true" />
    </section>
  );
}

/**
 * A zone heading: the page's spine. One per movement — the feed, and anything
 * else that needs to announce itself further down.
 */
export function HomeZone({ eyebrow, title, note = null, aside = null, id = null }) {
  return (
    <header className="home-zone">
      <div className="min-w-0">
        <p className="home-zone__eyebrow">{eyebrow}</p>
        <h2 id={id} className="home-zone__title">
          {title}
        </h2>
      </div>
      {note ? <p className="home-zone__note">{note}</p> : null}
      {aside}
    </header>
  );
}

/**
 * The page's exit: a rule, one line of plain speaking, and nothing else. It
 * exists so the feed ends deliberately rather than trailing off into the shell.
 */
export function HomeCoda({ children }) {
  return (
    <p className="home-coda">
      <span>{children}</span>
    </p>
  );
}
