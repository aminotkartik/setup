'use client';

/**
 * One form renderer for every create/edit surface.
 *
 * Pages describe their fields; this component owns the boring parts that must be
 * identical everywhere: loading state, disabled submit, inline field errors,
 * success notice, cancel link and the GIF field wired to the single GifPicker.
 * Validation itself always runs again on the server — this is presentation.
 */

import { useRef, useState } from 'react';
import { Button, Checkbox, Field, Input, Notice, Select, Switch, Textarea, LinkButton } from '@/components/ui';
import { GifPicker, GifAttachment } from '@/components/media/GifPicker';
import { useFormAction } from '@/lib/forms';

export function ActionForm({
  action,
  fields = [],
  hidden = {},
  submitLabel = 'Save',
  pendingLabel = 'Saving…',
  successMessage = 'Saved.',
  cancelHref = null,
  cancelLabel = 'Cancel',
  resetOnSuccess = true,
  redirectTo = null,
  encTypeNote = null,
  intro = null,
}) {
  const formRef = useRef(null);
  const [gif, setGif] = useState(null);
  const [gifCleared, setGifCleared] = useState(false);
  const { run, pending, error, fieldErrors, success } = useFormAction(action, {
    resetOnSuccess,
    redirectTo,
  });

  const gifField = fields.find((field) => field.type === 'gif');

  const submit = (formData) => {
    for (const [key, value] of Object.entries(hidden)) formData.set(key, value);
    if (gifField) {
      if (gif) formData.set(gifField.name, JSON.stringify(gif));
      else if (gifCleared) formData.set(gifField.name, '');
      else formData.delete(gifField.name);
    }
    run(formData);
  };

  const renderField = (field) => {
    const id = `field-${field.name}`;
    const fieldError = fieldErrors?.[field.name] || null;

    if (field.type === 'gif') {
      return (
        <Field key={field.name} label={field.label || 'GIF'} hint={field.hint} error={fieldError}>
          <div className="flex flex-wrap items-center gap-2">
            <GifPicker
              value={gif}
              onPick={(picked) => {
                setGif(picked);
                setGifCleared(false);
              }}
              onRemove={() => {
                setGif(null);
                setGifCleared(true);
              }}
              label={field.label || 'Attach a GIF'}
            />
            {gif ? <GifAttachment gif={gif} className="max-w-[10rem]" /> : null}
          </div>
        </Field>
      );
    }

    if (field.type === 'checkbox' || field.type === 'switch') {
      const Control = field.type === 'switch' ? Switch : Checkbox;
      return (
        <Control
          key={field.name}
          id={id}
          name={field.name}
          label={field.label}
          note={field.hint}
          defaultChecked={field.defaultChecked}
        />
      );
    }

    if (field.type === 'select') {
      return (
        <Field key={field.name} label={field.label} htmlFor={id} hint={field.hint} error={fieldError} required={field.required}>
          <Select id={id} name={field.name} required={field.required} defaultValue={field.defaultValue ?? ''} aria-invalid={Boolean(fieldError)}>
            <option value="">{field.placeholder || 'Choose…'}</option>
            {(field.options || []).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      );
    }

    if (field.type === 'textarea') {
      return (
        <Field key={field.name} label={field.label} htmlFor={id} hint={field.hint} error={fieldError} required={field.required}>
          <Textarea
            id={id}
            name={field.name}
            rows={field.rows || 5}
            required={field.required}
            maxLength={field.maxLength}
            defaultValue={field.defaultValue}
            placeholder={field.placeholder}
            invalid={Boolean(fieldError)}
          />
        </Field>
      );
    }

    return (
      <Field key={field.name} label={field.label} htmlFor={id} hint={field.hint} error={fieldError} required={field.required}>
        <Input
          id={id}
          name={field.name}
          type={field.type || 'text'}
          required={field.required}
          maxLength={field.maxLength}
          min={field.min}
          max={field.max}
          step={field.step}
          defaultValue={field.defaultValue}
          placeholder={field.placeholder}
          inputMode={field.inputMode}
          invalid={Boolean(fieldError)}
        />
      </Field>
    );
  };

  return (
    <form ref={formRef} action={submit} className="card flex flex-col gap-4 p-4 sm:p-5">
      {encTypeNote ? <p className="text-2xs text-muted">{encTypeNote}</p> : null}
      {intro ? <div className="text-[0.8125rem] leading-relaxed text-muted">{intro}</div> : null}
      {fields.map(renderField)}

      {error ? (
        <Notice tone="danger" icon="flag">
          {error}
        </Notice>
      ) : null}
      {success ? (
        <Notice tone="success" icon="checkCircle">
          {successMessage}
        </Notice>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <Button type="submit" tone="accent" loading={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
        {cancelHref ? (
          <LinkButton href={cancelHref} variant="ghost" size="md">
            {cancelLabel}
          </LinkButton>
        ) : null}
      </div>
    </form>
  );
}
