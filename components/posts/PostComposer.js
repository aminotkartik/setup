'use client';

import { useRef, useState } from 'react';
import { useFormAction } from '@/lib/forms';
import { createPost } from '@/lib/actions/social';
import { LIMITS } from '@/lib/constants';
import { Button, Field, Input, Notice, Select, Textarea } from '@/components/ui';
import { GifPicker } from '@/components/media/GifPicker';
import { Icon } from '@/components/ui/icons';

const KINDS = [
  { value: 'post', label: 'Post' },
  { value: 'discussion', label: 'Discussion' },
  { value: 'poll', label: 'Poll' },
];

/**
 * The one text composer (spec §12).
 *
 * Text, an optional GIF, @mentions and — for discussions and polls — a title.
 * No file picker, no image upload, no attachment surface: those features do not
 * exist on Campus+ and the UI does not pretend otherwise.
 */
export function PostComposer({ communityId = null, defaultKind = 'post', compact = false }) {
  const [kind, setKind] = useState(defaultKind);
  const [gif, setGif] = useState(null);
  const [options, setOptions] = useState(['', '']);
  const [body, setBody] = useState('');
  const formRef = useRef(null);

  const { run, pending, error, fieldErrors } = useFormAction(createPost, {
    onSuccess: () => {
      setBody('');
      setGif(null);
      setOptions(['', '']);
      setKind(defaultKind);
      formRef.current?.reset();
    },
  });

  const isPoll = kind === 'poll';
  const needsTitle = kind !== 'post';

  return (
    <form
      ref={formRef}
      action={run}
      className="card p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        data.set('kind', kind);
        if (gif) data.set('gif', JSON.stringify(gif));
        if (communityId) data.set('community_id', communityId);
        run(data);
      }}
    >
      {!compact ? (
        <div className="mb-3 flex items-center gap-1" role="tablist" aria-label="Post type">
          {KINDS.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={kind === item.value}
              onClick={() => setKind(item.value)}
              className={
                kind === item.value
                  ? 'rounded-full border border-ink bg-white px-3 py-1 text-2xs font-medium text-ink'
                  : 'rounded-full border border-transparent px-3 py-1 text-2xs text-muted hover:text-ink'
              }
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}

      {needsTitle ? (
        <Field
          label={isPoll ? 'Poll question' : 'Discussion title'}
          htmlFor="post-title"
          required
          error={fieldErrors?.title}
          className="mb-3"
        >
          <Input
            id="post-title"
            name="title"
            maxLength={140}
            required
            placeholder={isPoll ? 'What should we decide?' : 'What should the discussion cover?'}
          />
        </Field>
      ) : null}

      <Field
        label={isPoll ? 'Context (optional)' : kind === 'discussion' ? 'Your opening post' : 'Say something'}
        htmlFor="post-body"
        error={fieldErrors?.body}
        hint={isPoll ? undefined : `${body.length}/${LIMITS.post.max}`}
      >
        <Textarea
          id="post-body"
          name="body"
          rows={compact ? 3 : 4}
          maxLength={LIMITS.post.max}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          required={!isPoll}
          placeholder="Share something with campus. Use @username to mention someone."
        />
      </Field>

      {isPoll ? (
        <fieldset className="mt-3">
          <legend className="text-[0.8125rem] font-medium text-ink">Options</legend>
          <div className="mt-2 flex flex-col gap-2">
            {options.map((option, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  name="poll_options"
                  value={option}
                  maxLength={80}
                  placeholder={`Option ${index + 1}`}
                  onChange={(event) => {
                    const next = [...options];
                    next[index] = event.target.value;
                    setOptions(next);
                  }}
                />
                {options.length > 2 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="close"
                    aria-label={`Remove option ${index + 1}`}
                    onClick={() => setOptions(options.filter((_, i) => i !== index))}
                  />
                ) : null}
              </div>
            ))}
          </div>
          {options.length < 6 ? (
            <Button variant="ghost" size="sm" icon="plus" className="mt-2" onClick={() => setOptions([...options, ''])}>
              Add option
            </Button>
          ) : null}
        </fieldset>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <GifPicker value={gif} onPick={setGif} onRemove={() => setGif(null)} />
          {!communityId ? (
            <Select name="visibility" defaultValue="public" className="h-8 w-32 text-2xs" aria-label="Who can see this">
              <option value="public">Everyone</option>
              <option value="campus">Campus only</option>
            </Select>
          ) : null}
        </div>
        <Button type="submit" disabled={pending || (isPoll && options.filter(Boolean).length < 2)}>
          {pending ? 'Posting…' : isPoll ? 'Publish poll' : kind === 'discussion' ? 'Start discussion' : 'Post'}
          {!pending ? <Icon name="send" size={15} /> : null}
        </Button>
      </div>

      {error ? (
        <Notice tone="danger" className="mt-3" icon="flag">
          {error}
        </Notice>
      ) : null}
    </form>
  );
}
