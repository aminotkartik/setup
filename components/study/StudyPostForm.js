'use client';

/**
 * Study partner request composer.
 *
 * A dedicated form (not the generic ActionForm) because availability is a
 * multi-select of coarse categories — checkboxes sharing one field name, read
 * with `getAll()` on the server. Coarse categories are the whole point: the
 * form offers nothing more precise, and validation rejects anything else.
 */

import { useFormAction } from '@/lib/forms';
import { createStudyPost } from '@/lib/actions/campus';
import { BRANCHES, STUDY_AVAILABILITY, STUDY_MODES, STUDY_PURPOSES, YEARS } from '@/lib/constants';
import { Button, Checkbox, Field, Input, LinkButton, Notice, Select, Textarea } from '@/components/ui';

export function StudyPostForm({ cancelHref = '/campus/study' }) {
  const post = useFormAction(createStudyPost);
  const fieldError = (name) => post.fieldErrors?.[name] || null;

  return (
    <form
      action={post.run}
      className="card flex flex-col gap-4 p-4 sm:p-5"
      aria-label="Post a study partner request"
    >
      <Field label="Title" htmlFor="study-title" required error={fieldError('title')}>
        <Input id="study-title" name="title" required maxLength={140} placeholder="DBMS exam prep partner" aria-invalid={Boolean(fieldError('title'))} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Subject or topic" htmlFor="study-subject" required error={fieldError('subject')}>
          <Input id="study-subject" name="subject" required maxLength={120} placeholder="Database Management Systems" aria-invalid={Boolean(fieldError('subject'))} />
        </Field>
        <Field label="Purpose" htmlFor="study-purpose" required error={fieldError('purpose')}>
          <Select id="study-purpose" name="purpose" required defaultValue="" aria-invalid={Boolean(fieldError('purpose'))}>
            <option value="" disabled>Choose a purpose…</option>
            {STUDY_PURPOSES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="What are you looking for?" htmlFor="study-description" hint="At least 10 characters. Say what you want to study and how you like to work." required error={fieldError('description')}>
        <Textarea id="study-description" name="description" required rows={4} maxLength={1500} aria-invalid={Boolean(fieldError('description'))} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Branch" htmlFor="study-branch" hint="Optional">
          <Select id="study-branch" name="branch" defaultValue="">
            <option value="">Any branch</option>
            {BRANCHES.map((branch) => (
              <option key={branch} value={branch}>{branch}</option>
            ))}
          </Select>
        </Field>
        <Field label="Year" htmlFor="study-year" hint="Optional">
          <Select id="study-year" name="year" defaultValue="">
            <option value="">Any year</option>
            {YEARS.map((year) => (
              <option key={year} value={year}>{year}</option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Academic context" htmlFor="study-context" hint="Optional · e.g. “TE Sem 5, DBMS end-sem in December”">
        <Input id="study-context" name="academic_context" maxLength={200} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Collaboration mode" htmlFor="study-mode" required>
          <Select id="study-mode" name="mode" defaultValue="either">
            {STUDY_MODES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Close after" htmlFor="study-expires" hint="Optional · the request hides itself after this date">
          <Input id="study-expires" name="expires_on" type="date" />
        </Field>
      </div>

      <fieldset>
        <legend className="field-label">When are you usually free?</legend>
        <p className="field-hint">Rough categories only — never exact times or places. You can work out details over messages.</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {STUDY_AVAILABILITY.map((slot) => (
            <Checkbox key={slot.value} id={`study-availability-${slot.value}`} name="availability" value={slot.value} label={slot.label} />
          ))}
        </div>
        {fieldError('availability') ? <p className="field-error" role="alert">{fieldError('availability')}</p> : null}
      </fieldset>

      <Notice tone="info" icon="lock">
        Posting is opt-in: your request, subject and rough availability become visible to other students.
        Interested students reach you through Campus+ messages — no contact details are shared.
      </Notice>

      {post.error ? <Notice tone="danger">{post.error}</Notice> : null}
      {post.success ? <Notice tone="success">Published.</Notice> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" loading={post.pending}>{post.pending ? 'Publishing…' : 'Publish request'}</Button>
        <LinkButton href={cancelHref} variant="ghost">Cancel</LinkButton>
      </div>
    </form>
  );
}
