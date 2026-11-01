import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { HandWave } from '@/components/home/HandWave';
import { EmptyStateArt } from '@/components/ui/EmptyStateArt';
import { EmptyState } from '@/components/ui/states';

const read = (file) => fs.readFileSync(file, 'utf8');
const render = (component, props = {}) => renderToStaticMarkup(React.createElement(component, props));

describe('Lumen greeting gesture', () => {
  it('is a keyboard-operable button with decorative, branded inline artwork', () => {
    const html = render(HandWave);
    expect(html).toContain('<button');
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Wave hello"');
    expect(html).toContain('home-pulse__wave-art');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('stroke="currentColor"');
    expect(html).not.toContain('linearGradient');
  });

  it('plays once on arrival and remounts only the artwork for every click', () => {
    const source = read('components/home/HandWave.js');
    const css = read('app/styles/home.css');
    expect(source).toContain('const [wave, setWave] = useState(0)');
    expect(source).toContain('key={wave}');
    expect(source).toContain('setWave((value) => value + 1)');
    expect(source).toContain("window.addEventListener('campus:home-intro-complete', replay)");
    expect(read('components/layout/GalacticIntro.js')).toContain("window.dispatchEvent(new Event('campus:home-intro-complete'))");
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*\.home-pulse__wave-art\s*\{\s*animation: pulse-wave var\(--dur-gesture\) var\(--ease-out\) both;/);
    expect(css).toMatch(/\.home-pulse__wave:focus-visible\s*\{[^}]*outline: 2px solid/);
    expect(css).toMatch(/\.home-pulse__wave\s*\{[\s\S]*?min-width: 44px;[\s\S]*?min-height: 44px;/);
  });
});

describe('Lumen empty-state illustration family', () => {
  const contexts = {
    chat: 'conversation',
    bell: 'notification',
    search: 'discovery',
    tag: 'market',
    users: 'community',
    calendar: 'schedule',
    book: 'document',
    megaphone: 'bulletin',
    shield: 'review',
    building: 'place',
    bus: 'journey',
    lock: 'privacy',
    archive: 'collection',
  };

  it('uses distinct compositions for unrelated contexts', () => {
    const drawings = Object.entries(contexts).map(([icon, variant]) => {
      const html = render(EmptyStateArt, { icon });
      expect(html).toContain(`data-art="${variant}"`);
      expect(html).toContain('viewBox="0 0 120 96"');
      expect(html).toContain('aria-hidden="true"');
      expect(html).not.toContain('<image');
      expect(html).not.toContain('linearGradient');
      return html;
    });
    expect(new Set(drawings).size).toBe(Object.keys(contexts).length);
  });

  it('keeps the existing message and action as the accessible empty state', () => {
    const html = render(EmptyState, {
      icon: 'chat',
      title: 'No messages yet',
      description: 'Start a conversation.',
      action: React.createElement('button', null, 'Start'),
    });
    expect(html).toContain('data-art="conversation"');
    expect(html).toContain('No messages yet');
    expect(html).toContain('Start a conversation.');
    expect(html).toContain('<button>Start</button>');
  });
});

describe('restrained Lumen motion system', () => {
  const tokens = read('app/tokens.css');
  const lumen = read('app/styles/lumen.css');
  const overlays = read('components/ui/overlays.js');

  it('shares panel and gesture timings and has explicit reduced-motion guards', () => {
    expect(tokens).toContain('--dur-panel: 320ms');
    expect(tokens).toContain('--dur-gesture: 720ms');
    expect(lumen).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation: none !important;/);
    expect(lumen).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?transition: none !important;/);
  });

  it('never uses transition-all in the application styles or changed controls', () => {
    for (const file of fs.readdirSync('app/styles')) {
      if (file.endsWith('.css')) expect(read(`app/styles/${file}`), file).not.toMatch(/transition:\s*all/);
    }
    for (const file of ['components/posts/PollBlock.js', 'components/media/GifPicker.js']) {
      expect(read(file), file).not.toContain('transition-all');
    }
  });

  it('keeps dismissal functional while only the outgoing visual remains', () => {
    expect(overlays).toContain('function usePresence(open, exitDuration = 220)');
    expect(overlays).toContain('return { rendered: rendered || open, visible: visible && open }');
    expect(overlays).toContain("event.key === 'Escape'");
    expect(overlays).toContain('document.body.style.overflow = overflow');
    expect(overlays).toContain('previous.focus()');
    expect(lumen).toContain(".dialog-centred[data-state='closed'] {");
    expect(lumen).toContain(".dialog-centred[data-state='closed'] > .dialog");
    expect(lumen).toContain(".cp-menu[data-state='closed']");
  });

  it('animates poll results by transform and gives reactions an explicit SVG state', () => {
    const poll = read('components/posts/PollBlock.js');
    const icons = read('components/ui/icons.js');
    expect(poll).toContain("style={{ '--poll-share': share / 100 }}");
    expect(poll).not.toContain('transition-[width]');
    expect(lumen).toContain('transform: scaleX(var(--poll-share, 0))');
    expect(lumen).toContain('transition: transform var(--dur-panel) var(--ease-out)');
    expect(lumen).toContain(".reaction-control[aria-pressed='true'] .reaction-icon");
    expect(icons).toContain("const FILLED = new Set(['star'])");
  });
});
