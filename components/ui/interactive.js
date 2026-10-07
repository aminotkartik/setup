/**
 * Two premium interaction surfaces, both pure CSS.
 *
 * `TiltCard` — the cursor-dependent 3D tilt from the supplied Uiverse card,
 * rebuilt for content: shallow angles, an optional specular glare, real links
 * and buttons inside, and no motion at all when the reader prefers reduced
 * motion. Used only on featured, non-repeating surfaces.
 *
 * `WheelSelector` — the spinning selector, used where a small set of options is
 * chosen once and the choice benefits from weight. It is a real radio group, so
 * keyboards, screen readers and the form payload are unchanged.
 */

import { cn } from '@/lib/utils';

export function TiltCard({ children, className = '', cardClassName = '', flat = false, intensity = 'default' }) {
  const angles = intensity === 'soft' ? { x: '4deg', y: '6deg' } : { x: '7deg', y: '9deg' };
  return (
    <div
      className={cn('tilt', flat ? 'tilt-flat' : null, className)}
      style={{ '--tilt-x': angles.x, '--tilt-y': angles.y }}
    >
      <div className="tilt__canvas" aria-hidden="true">
        {Array.from({ length: 25 }).map((_, index) => (
          <button key={index} type="button" tabIndex={-1} />
        ))}
      </div>
      <div className={cn('tilt__card', cardClassName)}>
        {children}
        <span className="tilt-glass" aria-hidden="true" />
      </div>
    </div>
  );
}

/**
 * @param {{ name: string, value: string, label: string, num?: string, note?: string }[]} options
 */
export function WheelSelector({ name, options = [], defaultValue, legend = 'Choose one', className = '', onChange = null }) {
  const selected = options.findIndex((option) => option.value === defaultValue);
  const activeIndex = selected === -1 ? 0 : selected;
  const spinClass = activeIndex === 0 ? 'wheel-1' : activeIndex === options.length - 1 ? 'wheel-3' : 'wheel-2';

  return (
    <fieldset className={cn('wheel', spinClass, options.length > 3 ? null : 'wheel-compact', className)}>
      <legend className="sr-only">{legend}</legend>
      <span className="wheel__hint" aria-hidden="true">
        Pick one
      </span>
      <div className="wheel__panel">
        <div className="wheel__spin">
          {options.map((option, index) => {
            const angle = (index - Math.floor(options.length / 2)) * 26;
            return (
              <span key={option.value} className="contents">
                <input
                  className="wheel__input"
                  type="radio"
                  id={`${name}-${option.value}`}
                  name={name}
                  value={option.value}
                  defaultChecked={index === activeIndex}
                  onChange={onChange ? () => onChange(option.value) : undefined}
                />
                <label className="wheel__option" htmlFor={`${name}-${option.value}`} style={{ '--angle': `${angle}deg` }}>
                  <span className="wheel__num">{option.num || String(index + 1).padStart(2, '0')}</span>
                  <span className="wheel__label">{option.label}</span>
                  {option.note ? <span className="wheel__note">{option.note}</span> : null}
                </label>
              </span>
            );
          })}
        </div>
      </div>
    </fieldset>
  );
}
