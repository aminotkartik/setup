'use client';

import { useEffect, useState } from 'react';
import { Button, Card, Input, Notice } from '@/components/ui';
import {
  DEFAULT_DEVICE_COLORS,
  DEVICE_COLOR_FIELDS,
  DEVICE_COLOR_STORAGE_KEY,
  applyDeviceColors,
  clearDeviceColorOverrides,
  contrastRatio,
  deviceAccentInk,
  normalizeDeviceColors,
  normalizeHex,
  readDeviceColors,
  removeDeviceColors,
  writeDeviceColors,
} from '@/lib/device-colors';
import styles from './DeviceColorSettings.module.css';

const HEX_ERROR = 'Use three or six hex digits, with or without the leading #.';
const DEFAULT_STATUS = 'Valid changes apply and save automatically on this device.';

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function DeviceColorSettings() {
  const [colors, setColors] = useState(() => ({ ...DEFAULT_DEVICE_COLORS }));
  const [draft, setDraft] = useState(() => ({ ...DEFAULT_DEVICE_COLORS }));
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState(DEFAULT_STATUS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // The root's pre-paint script has already restored any saved colors. Read
    // the controls after the first stable render rather than cascading a
    // synchronous state update through the effect body.
    const frame = window.requestAnimationFrame(() => {
      const stored = readDeviceColors(browserStorage());
      const initial = stored || { ...DEFAULT_DEVICE_COLORS };
      setColors(initial);
      setDraft(initial);
      if (stored) {
        applyDeviceColors(document.documentElement, stored);
        setStatus('Saved colors loaded from this device.');
      } else {
        clearDeviceColorOverrides(document.documentElement);
      }
      setReady(true);
    });

    const onStorage = (event) => {
      if (event.key !== DEVICE_COLOR_STORAGE_KEY) return;
      const next = readDeviceColors(browserStorage());
      if (next) {
        setColors(next);
        setDraft(next);
        setErrors({});
        applyDeviceColors(document.documentElement, next);
        setStatus('Colors updated from another tab on this device.');
      } else {
        const defaults = { ...DEFAULT_DEVICE_COLORS };
        setColors(defaults);
        setDraft(defaults);
        clearDeviceColorOverrides(document.documentElement);
        setStatus(DEFAULT_STATUS);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  function commit(next, nextDraft = next) {
    const normalized = normalizeDeviceColors(next);
    if (!normalized) return;
    setColors(normalized);
    // Keep the in-progress text (especially #rgb) in the field while saving
    // normalized colors; expanding it mid-keystroke would interrupt typing.
    setDraft(nextDraft);
    setErrors({});
    applyDeviceColors(document.documentElement, normalized);
    const saved = writeDeviceColors(browserStorage(), normalized);
    setStatus(saved ? 'Saved on this device.' : 'Applied for this page; this browser could not save the colors.');
  }

  function updateColor(key, value) {
    const nextDraft = { ...draft, [key]: value };
    setDraft(nextDraft);
    const valid = normalizeHex(value);
    setErrors((previous) => ({ ...previous, [key]: valid ? null : HEX_ERROR }));
    if (!valid) {
      setStatus('Finish the hex value to apply it; the last valid colors are still active.');
      return;
    }
    const next = normalizeDeviceColors(nextDraft);
    if (!next) {
      setStatus('Finish the other hex value to apply these colors.');
      return;
    }
    commit(next, nextDraft);
  }

  function reset() {
    const defaults = { ...DEFAULT_DEVICE_COLORS };
    removeDeviceColors(browserStorage());
    clearDeviceColorOverrides(document.documentElement);
    setColors(defaults);
    setDraft(defaults);
    setErrors({});
    setStatus('The original Campus+ colors are restored on this device.');
  }

  const textContrast = contrastRatio(colors.text, colors.background);
  const sectionContrast = contrastRatio(colors.text, colors.section);
  const previewStyle = {
    '--preview-bg': colors.background,
    '--preview-section': colors.section,
    '--preview-accent': colors.theme,
    '--preview-text': colors.text,
    '--preview-on-accent': deviceAccentInk(colors),
  };

  return (
    <Card className="flex flex-col gap-4 p-4" data-device-color-settings>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Colors on this device</h2>
          <p className="mt-1 max-w-2xl text-[0.8125rem] leading-relaxed text-muted">
            Choose background, section, theme and text colors for this browser. This is not an
            account or site-wide setting: other devices and everyone else keep the original Campus+ palette.
          </p>
        </div>
        <Button type="button" size="sm" variant="secondary" icon="refresh" onClick={reset} disabled={!ready}>
          Reset to site colors
        </Button>
      </div>

      <div className={styles.fields}>
        {DEVICE_COLOR_FIELDS.map(({ key, label }) => {
          const inputId = `device-color-${key}`;
          const hexId = `device-hex-${key}`;
          const errorId = `${hexId}-error`;
          return (
            <div className={styles.field} key={key}>
              <span className="field-label" id={`${inputId}-label`}>{label}</span>
              <div className={`${styles.colorRow} mt-1.5`}>
                <input
                  id={inputId}
                  className={styles.colorInput}
                  type="color"
                  value={colors[key]}
                  aria-label={`${label} picker`}
                  aria-labelledby={`${inputId}-label`}
                  onChange={(event) => updateColor(key, event.target.value)}
                  disabled={!ready}
                />
                <Input
                  id={hexId}
                  className={styles.hexInput}
                  type="text"
                  value={draft[key]}
                  aria-label={`${label} hex`}
                  aria-invalid={Boolean(errors[key])}
                  aria-describedby={errors[key] ? errorId : undefined}
                  onChange={(event) => updateColor(key, event.target.value)}
                  disabled={!ready}
                  maxLength={7}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={DEFAULT_DEVICE_COLORS[key]}
                />
              </div>
              {errors[key] ? (
                <p className={`${styles.error} mt-1.5`} id={errorId} role="alert">{errors[key]}</p>
              ) : (
                <p className="field-hint">Picker or hex value</p>
              )}
            </div>
          );
        })}
      </div>

      <div>
        <span className="field-label">Live preview</span>
        <div className={`${styles.preview} mt-1.5`} style={previewStyle} aria-label="Preview of selected colors">
          <div className={styles.previewHeader}>
            <strong>Campus+</strong>
            <span className={styles.previewMuted}>This browser only</span>
          </div>
          <div className={styles.previewBody}>
            <strong>What&apos;s moving right now</strong>
            <p className={styles.previewMuted}>Your posts, notices and campus conversations stay readable here.</p>
            <span className={styles.previewButton}>Sample action</span>
          </div>
        </div>
      </div>

      {textContrast < 4.5 ? (
        <Notice tone="warning" icon="alert">
          Text and background contrast is {textContrast.toFixed(1)}:1. Choose a lighter or darker
          combination for comfortable reading (4.5:1 or higher is recommended).
        </Notice>
      ) : null}

      {sectionContrast < 4.5 ? (
        <Notice tone="warning" icon="alert">
          Text and section contrast is {sectionContrast.toFixed(1)}:1. Choose a lighter or darker
          combination for comfortable reading (4.5:1 or higher is recommended).
        </Notice>
      ) : null}

      <p className={styles.status} role="status" aria-live="polite">{status}</p>
    </Card>
  );
}
