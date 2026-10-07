import Link from 'next/link';
import { Icon } from '@/components/ui/icons';

export const metadata = { title: 'Community rules' };

/**
 * The community rules page. Deliberately short, concrete and human — these are
 * the same reasons the report dialog offers, and the platform is moderated by
 * people (spec §17: no automated moderation).
 */
export default function RulesPage() {
  const rules = [
    ['Keep it respectful', 'No harassment, bullying, hate speech, threats or targeted pile-ons.'],
    ['No spam or advertising', 'Promotions belong in the marketplace, clearly priced and honest.'],
    ['Be honest', 'No impersonation, no fake listings, no scams, no academic dishonesty.'],
    ['Respect privacy', 'Do not share someone else\u2019s personal information, screenshots of DMs or Random identities.'],
    ['Moderation stays moderation', 'Do not repost content that moderators removed.'],
    ['Text stays text', 'Campus+ is text-first by design. No file or image uploads.'],
  ];

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center px-5 py-14">
      <h1 className="text-2xl font-semibold tracking-tight">Community rules</h1>
      <p className="mt-2 text-[0.9375rem] text-muted">
        Campus+ is run by students for students. Reports are reviewed by moderators, and every
        moderation action is logged.
      </p>

      <ol className="card mt-6 divide-y divide-line">
        {rules.map(([title, body], index) => (
          <li key={title} className="flex gap-3 p-4">
            <span className="text-2xs text-muted">{index + 1}</span>
            <div>
              <p className="text-sm font-medium text-ink">{title}</p>
              <p className="mt-0.5 text-[0.8125rem] text-muted">{body}</p>
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-6 flex items-start gap-2 text-[0.8125rem] text-muted">
        <Icon name="shield" size={16} className="mt-0.5 shrink-0" />
        Anything that breaks these rules can be reported from where you see it. Reporting is always
        available, even if you have blocked the person.
      </p>

      <Link href="/login" className="mt-8 text-[0.8125rem] text-muted underline hover:text-ink">
        Back to sign-in
      </Link>
    </div>
  );
}
