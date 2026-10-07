/**
 * Two premium interaction surfaces, both pure CSS.
 *
 * `TiltCard` — the cursor-dependent 3D tilt from the supplied Uiverse card,
 * rebuilt for content: the source's 5×5 tracker grid and 125ms step, damped to
 * shallow angles, with a specular glare and no motion at all when the reader
 * prefers reduced motion. Used only on featured, non-repeating surfaces.
 *
 * The tracker cells are inert spans, and the card is pointer-transparent with
 * its real controls switched back on (see interactive.css), so the grid can
 * never swallow the card's own call to action.
 *
 * `WheelSelector` — the spinning selector, used where a small set of options is
 * chosen once and the choice benefits from weight. The options sit on an arc and
 * the arc rotates so the chosen one travels to the marker; the rotation is read
 * from the real radio state, so clicking, tapping, arrow keys and screen readers
 * all animate the same way. Keyboard, focus, labels and the form payload are
 * unchanged.
 */

import { Fragment } from 'react';

import { cn } from '@/lib/utils';

export function TiltCard({ children, className = '', cardClassName = '', flat = false, intensity = 'default' }) {
  const angles = intensity === 'soft' ? { x: '5deg', y: '6deg' } : { x: '8deg', y: '10deg' };
  return (
    <div
      className={cn('tilt', flat ? 'tilt-flat' : null, className)}
      style={{ '--tilt-x': angles.x, '--tilt-y': angles.y }}
    >
      <div className="tilt__canvas" aria-hidden="true">
        {Array.from({ length: 25 }).map((_, index) => (
          <span key={index} />
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
 * Controlled when `onChange` is given (the usual case: the wheel and the theme
 * switch must agree), uncontrolled when it is not, so it can still be rendered
 * from a server component.
 *
 * @param {{ name: string, value: string, label: string, num?: string, note?: string }[]} options
 * @param {string} [value] currently selected value
 * @param {string} [defaultValue] initial value for uncontrolled use
 */
export function WheelSelector({ name, options = [], value, defaultValue, legend = 'Choose one', className = '', onChange = null }) {
  const chosen = value === undefined ? defaultValue : value;
  const selected = options.findIndex((option) => option.value === chosen);
  const activeIndex = selected === -1 ? 0 : selected;

  // Arc geometry: slot i sits at (i - centre) steps from the marker, so the arc
  // has to rotate by the negative of that to bring the chosen slot home. Both
  // are expressed against --wheel-step, which interactive.css owns.
  const centre = (options.length - 1) / 2;
  const geometry = {};
  options.forEach((_, index) => {
    geometry[`--wheel-spin-${index + 1}`] = `calc(var(--wheel-step) * ${centre - index})`;
  });

  return (
    <fieldset className={cn('wheel', className)} style={geometry}>
      <legend className="sr-only">{legend}</legend>
      <span className="wheel__hint" aria-hidden="true">
        Pick one
      </span>
      <div className="wheel__panel">
        <div className="wheel__spin">
          {options.map((option, index) => (
            <Fragment key={option.value}>
              <input
                className="wheel__input"
                type="radio"
                id={`${name}-${option.value}`}
                name={name}
                value={option.value}
                {...(onChange ? { checked: index === activeIndex } : { defaultChecked: index === activeIndex })}
                onChange={onChange ? () => onChange(option.value) : undefined}
              />
              <label
                className="wheel__option"
                htmlFor={`${name}-${option.value}`}
                style={{ '--angle': `calc(var(--wheel-step) * ${index - centre})` }}
              >
                <span className="wheel__num">{option.num || String(index + 1).padStart(2, '0')}</span>
                <span className="wheel__label">{option.label}</span>
                {option.note ? <span className="wheel__note">{option.note}</span> : null}
              </label>
            </Fragment>
          ))}
        </div>
      </div>
    </fieldset>
  );
}
