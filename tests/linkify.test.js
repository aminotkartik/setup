import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  containsLinkableUrl,
  extractUrlCandidates,
  isLinkableUrl,
  normalizeLinkHref,
  segmentRichText,
  segmentTextLinks,
} from '@/lib/linkify';
import { LinkifiedText } from '@/components/content/LinkifiedText';
import { renderTextWithMentions } from '@/components/posts/richText';
import { ContentCard } from '@/components/content/ContentCard';
import { ExternalLink } from '@/components/content/ExternalLink';

const links = (text, options) => segmentRichText(text, options).filter((s) => s.type === 'link');
const htmlOf = (node) => renderToStaticMarkup(React.createElement(React.Fragment, null, node));

describe('url detection and validation (lib/linkify)', () => {
  it('leaves plain text untouched', () => {
    expect(segmentTextLinks('Hello campus, no links here.')).toEqual([
      { type: 'text', value: 'Hello campus, no links here.' },
    ]);
    expect(containsLinkableUrl('Hello campus')).toBe(false);
  });

  it('detects one HTTPS and one HTTP URL', () => {
    expect(links('See https://pccoepune.org/notice.pdf now')).toEqual([
      { type: 'link', value: 'https://pccoepune.org/notice.pdf', href: 'https://pccoepune.org/notice.pdf' },
    ]);
    expect(links('Old http://example.com/page link')[0].href).toBe('http://example.com/page');
  });

  it('normalises www. URLs to https while preserving the typed label', () => {
    const [link] = links('Portfolio: www.example.com/me');
    expect(link.value).toBe('www.example.com/me');
    expect(link.href).toBe('https://www.example.com/me');
    expect(normalizeLinkHref('www.example.com')).toBe('https://www.example.com/');
    expect(normalizeLinkHref('example.com')).toBeNull(); // never invent a scheme for bare hosts
  });

  it('supports multiple URLs and URLs at the start, middle and end', () => {
    const segments = links('https://a.example.com first, then www.b.example.com/x and https://c.example.com end');
    expect(segments.map((s) => s.value)).toEqual([
      'https://a.example.com',
      'www.b.example.com/x',
      'https://c.example.com',
    ]);
  });

  it('keeps paths, query strings, fragments and encoded characters', () => {
    const [link] = links('Open https://example.com/a%20b/c?q=one%20two&x=1#section-2 please');
    expect(link.href).toBe('https://example.com/a%20b/c?q=one%20two&x=1#section-2');
  });

  it('excludes trailing sentence punctuation and unmatched closing brackets', () => {
    expect(links('Read https://example.com/a, then rest')[0].value).toBe('https://example.com/a');
    expect(links('Read https://example.com/a.')[0].value).toBe('https://example.com/a');
    expect(links('(see https://example.com/a)')[0].value).toBe('https://example.com/a');
    expect(links('[see https://example.com/a]')[0].value).toBe('https://example.com/a');
    // Balanced brackets that belong to the URL are kept.
    expect(links('Wiki https://example.com/a_(b) end')[0].value).toBe('https://example.com/a_(b)');
    // The stripped punctuation is preserved as text, not swallowed.
    expect(segmentTextLinks('Read https://example.com/a.').at(-1)).toEqual({ type: 'text', value: '.' });
  });

  it('preserves multiline text and surrounding whitespace', () => {
    const text = 'Line one\nVisit https://example.com/x\n\n  Line three  ';
    const segments = segmentTextLinks(text);
    const rebuilt = segments.map((s) => s.value).join('');
    expect(rebuilt).toBe(text);
    expect(segments.some((s) => s.type === 'link')).toBe(true);
  });

  it('returns nothing for empty or missing text', () => {
    expect(segmentTextLinks('')).toEqual([]);
    expect(segmentTextLinks(null)).toEqual([]);
    expect(segmentTextLinks(undefined)).toEqual([]);
    expect(LinkifiedText({ text: null })).toBeTruthy(); // renders an empty fragment, never throws
    expect(htmlOf(LinkifiedText({ text: '' }))).toBe('');
  });

  it('rejects dangerous protocols and never upgrades them to https', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      '//evil.example.com/phish',
      'ftp://example.com/file',
    ]) {
      expect(links(`Click ${bad} now`), bad).toEqual([]);
      expect(isLinkableUrl(bad), bad).toBe(false);
    }
  });

  it('rejects malformed and credential-bearing URLs', () => {
    for (const bad of [
      'https://',
      'www.',
      'https://example',
      'https://.example.com',
      'http://exa mple.com',
      'https://user:secret@example.com/path',
      'https://example.com:99999/',
    ]) {
      expect(links(`Go to ${bad} please`), bad).toEqual([]);
    }
    expect(extractUrlCandidates('See https://example.com/a.')).toEqual(['https://example.com/a']);
  });

  it('does not treat emails as URLs but still links a following URL', () => {
    const segments = segmentRichText('Mail me at asha@example.com or see https://example.com', { mentions: true });
    expect(segments.filter((s) => s.type === 'link')).toHaveLength(1);
    expect(segments.filter((s) => s.type === 'mention')).toHaveLength(0);
  });

  it('links mentions, keeps URLs winning over an @ in their path', () => {
    const segments = segmentRichText('Thanks @Asha_K, mirror at https://example.com/@asha_k', { mentions: true });
    expect(segments.filter((s) => s.type === 'mention')).toEqual([
      { type: 'mention', value: '@Asha_K', username: 'asha_k' },
    ]);
    expect(segments.filter((s) => s.type === 'link')[0].value).toBe('https://example.com/@asha_k');
  });
});

describe('rendering', () => {
  it('renders a safe external anchor with new-tab protections', () => {
    const html = htmlOf(LinkifiedText({ text: 'Portfolio www.example.com/me!' }));
    expect(html).toContain('<a href="https://www.example.com/me"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain('class="rich-link"');
    expect(html).toContain('>www.example.com/me'); // visible label is what the author typed
    expect(html).toContain('(opens in a new tab)');
    expect(html.endsWith('!')).toBe(true);
  });

  it('escapes HTML/script injection instead of rendering it', () => {
    const html = htmlOf(
      LinkifiedText({ text: '<script>alert(1)</script> <img src=x onerror=alert(2)> https://example.com' }),
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('href="https://example.com/"');
  });

  it('renders mentions and links together without nesting (post renderer)', () => {
    const html = htmlOf(renderTextWithMentions('Hi @asha_k, notes at https://example.com/notes.'));
    expect(html).toContain('href="/user/asha_k"');
    expect(html).toContain('class="mention"');
    expect(html).toContain('href="https://example.com/notes"');
    expect(html).not.toMatch(/<a[\s>][^>]*>(?:(?!<\/a>).)*<a[\s>]/s);
  });

  it('keeps an existing stored record working without any rewrite', () => {
    // A bio exactly as an old row might hold it: plain text, no stored markup.
    const storedBio = 'Third-year CS. Portfolio: https://example.com/me\nBuilding with www.example.dev';
    const html = htmlOf(LinkifiedText({ text: storedBio, mentions: true }));
    expect(html).toContain('href="https://example.com/me"');
    expect(html).toContain('href="https://www.example.dev/"');
    expect(html).toContain('\n'); // newline preserved for pre-wrap rendering
  });

  it('inside a clickable card the inline link is not nested in the card link', () => {
    const html = htmlOf(
      ContentCard({
        href: '/market/listing/123',
        title: 'Calculator for sale',
        description: 'Barely used. Details at https://example.com/calc, grab it!',
      }),
    );
    expect(html).toContain('href="https://example.com/calc"');
    expect(html).toContain('href="/market/listing/123"'); // card navigation still available via title
    expect(html).not.toMatch(/<a[\s>][^>]*>(?:(?!<\/a>).)*<a[\s>]/s); // no nested anchors anywhere
  });

  it('a card without URLs keeps its whole-card link behaviour', () => {
    const html = htmlOf(ContentCard({ href: '/x', title: 'Plain', description: 'No links here.' }));
    expect(html.startsWith('<a ')).toBe(true);
    expect(html).toContain('href="/x"');
  });

  it('dedicated URL fields (ExternalLink) normalise www. and drop bad schemes', () => {
    expect(htmlOf(ExternalLink({ url: 'www.example.com', children: 'site' }))).toContain('href="https://www.example.com/"');
    const bad = htmlOf(ExternalLink({ url: 'javascript:alert(1)', children: 'click' }));
    expect(bad).not.toContain('<a');
    expect(bad).toContain('click');
  });
});

describe('theming', () => {
  it('rich links use the shared accent token, are underlined and have focus/visited styles', () => {
    const css = fs.readFileSync('app/globals.css', 'utf8');
    const block = css.match(/\.rich-link\s*\{[^}]*\}/)?.[0] || '';
    // --c-accent-ink is a light-dark() pair (see the token contract tested in
    // contrast.test.js), so the same rule serves dark and light themes.
    expect(block).toContain('var(--c-accent-ink)');
    expect(block).toContain('text-decoration: underline');
    expect(block).toContain('overflow-wrap: anywhere'); // long URLs wrap on mobile
    expect(css).toContain('.rich-link:visited');
    expect(css).toMatch(/\.rich-link:focus-visible\s*\{[^}]*var\(--cp-focus\)/);
    expect(css).toMatch(/\.mention:focus-visible/);
  });
});
