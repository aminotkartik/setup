'use client';

/**
 * Home launch gate — the loading layer around the cinematic intro.
 *
 * The Home layout wraps its children in this gate on the first Home load of a
 * browsing session (the server already checked the session cookie, so every
 * later visit renders the plain page). While the intro is up:
 *
 *   - Home is already rendering behind it — data fetching, auth, RLS and the
 *     feed are untouched; the overlay only delays *reveal*, never *loading*.
 *   - `HomeReadySignal` (mounted by the Home page) marks the moment the Home
 *     content commits, and the loader uses that to end on a deliberate hold
 *     and fade instead of idling on a finished logo.
 *   - The loader fails safe on its own (max display time, click/Escape to
 *     skip), so a slow or failed load can never trap anyone on the splash.
 *
 * The session mark is written as soon as the intro *starts* — one launch per
 * session, no replays when navigating around the app or reloading.
 */

import { useEffect, useRef, useState } from 'react';
import CampusIntroLoader from '@/components/ui/CampusIntroLoader';

const INTRO_COOKIE = 'campus_intro';
const SESSION_KEY = 'campus_intro_seen';

/* ── Home-content readiness bus ────────────────────────────────────────────
   The page (a child that may commit before this gate's effects run) signals
   readiness through a sticky module-level flag, so effect ordering can never
   drop the signal. */

let contentReady = false;
const readyListeners = new Set();

function markContentReady() {
  contentReady = true;
  readyListeners.forEach((listener) => listener());
  readyListeners.clear();
}

/** Mounts with the Home page content — its mount *is* the ready signal. */
export function HomeReadySignal() {
  useEffect(() => {
    markContentReady();
  }, []);
  return null;
}

/* ── Session state ──────────────────────────────────────────────────────────
   Written from the client (this is launch chrome, not account state): a
   session cookie so the server skips the overlay on later loads, mirrored in
   sessionStorage so remounts inside a tab never replay it either. */

function introSeenStored() {
  if (typeof window === 'undefined') return false;
  try {
    if (window.sessionStorage.getItem(SESSION_KEY) === '1') return true;
  } catch {
    // Storage can be unavailable in hardened privacy modes — the cookie below
    // still covers the session.
  }
  return document.cookie.includes(`${INTRO_COOKIE}=1`);
}

function markIntroSeen() {
  try {
    window.sessionStorage.setItem(SESSION_KEY, '1');
  } catch {
    // Same as above: cookie remains the source of truth.
  }
  // Session cookie on purpose — no max-age, no expires.
  document.cookie = `${INTRO_COOKIE}=1; path=/; samesite=lax`;
}

/**
 * Renders the cinematic launch over `children` until the scene has faded.
 */
export function HomeLaunchGate({ children }) {
  const [showIntro, setShowIntro] = useState(() => !introSeenStored());
  const [ready, setReady] = useState(() => contentReady);
  const completedRef = useRef(false);

  useEffect(() => {
    // The intro counts as seen from the moment it starts: it must never replay
    // when the user reloads mid-scene or navigates back to Home.
    if (showIntro) markIntroSeen();
  }, [showIntro]);

  useEffect(() => {
    const listener = () => setReady(true);
    if (contentReady) {
      listener();
    } else {
      readyListeners.add(listener);
    }
    return () => {
      readyListeners.delete(listener);
    };
  }, []);

  const handleComplete = () => {
    if (completedRef.current) return;
    completedRef.current = true;
    setShowIntro(false);
  };

  return (
    <>
      {showIntro ? <CampusIntroLoader ready={ready} onComplete={handleComplete} /> : null}
      {/* The interface renders underneath the whole time; while the launch
          scene owns the screen it is inert so focus and taps cannot land on
          what the student cannot yet see. */}
      <div inert={showIntro ? true : undefined}>{children}</div>
    </>
  );
}
