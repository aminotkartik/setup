'use client';

/**
 * The Random lobby (spec §29).
 *
 * Joining puts the student in the database-backed queue. Matching happens in SQL
 * (`join_random_queue` pairs the longest-waiting eligible partner and refuses
 * blocked pairs), so the client only polls for the outcome — there is no
 * presence system and no websocket handshake to invent.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, Notice } from '@/components/ui';
import { joinRandomQueue, leaveRandomQueue } from '@/lib/actions/random';
import { RandomChat } from '@/components/random/RandomChat';

export function RandomLobby({ canUseRandom = true, initialSession = null }) {
  const [state, setState] = useState(initialSession ? 'matched' : 'idle');
  const [sessionId, setSessionId] = useState(initialSession?.id || null);
  const [waitingSince, setWaitingSince] = useState(null);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const poll = useRef(null);

  const check = useCallback(async () => {
    const result = await joinRandomQueue();
    if (!result?.ok) {
      setError(result?.error || 'Random is unavailable right now.');
      setState('idle');
      return;
    }
    if (result.state?.status === 'matched' && result.state.session_id) {
      setSessionId(result.state.session_id);
      setState('matched');
      return;
    }
    if (result.state?.status === 'waiting') setState('waiting');
    else setState('idle');
  }, []);

  useEffect(() => {
    if (state !== 'waiting') {
      clearInterval(poll.current);
      return undefined;
    }
    poll.current = setInterval(check, 4000);
    return () => clearInterval(poll.current);
  }, [state, check]);

  useEffect(() => {
    if (state !== 'waiting') return undefined;
    const timer = setInterval(() => {
      setElapsed(waitingSince ? Math.floor((Date.now() - waitingSince) / 1000) : 0);
    }, 1000);
    return () => clearInterval(timer);
  }, [state, waitingSince]);

  const join = async () => {
    setPending(true);
    setError(null);
    const result = await joinRandomQueue();
    setPending(false);
    if (!result?.ok) {
      setError(result?.error || 'You could not join Random right now.');
      return;
    }
    if (result.state?.status === 'matched' && result.state.session_id) {
      setSessionId(result.state.session_id);
      setState('matched');
      return;
    }
    setWaitingSince(Date.now());
    setState('waiting');
  };

  const leave = async () => {
    setPending(true);
    await leaveRandomQueue();
    setPending(false);
    setWaitingSince(null);
    setState('idle');
  };

  const exitSession = () => {
    setSessionId(null);
    setWaitingSince(null);
    setState('idle');
  };

  if (state === 'matched' && sessionId) {
    return <RandomChat sessionId={sessionId} initialMessages={initialSession?.messages || []} expiresAt={initialSession?.expires_at || null} onExit={exitSession} />;
  }

  return (
    <Card className="flex flex-col items-start gap-3 p-4">
      <h2 className="text-sm font-semibold">Chat with a random student</h2>
      <p className="text-[0.8125rem] leading-relaxed text-muted">
        You are matched with another PCCOE student. Neither of you sees the other&apos;s username. Sessions
        are temporary, are not shareable, and end when either side taps Next, End or Block.
      </p>

      {!canUseRandom ? (
        <Notice tone="warning" icon="lock">
          Random is not enabled for your account.
        </Notice>
      ) : state === 'waiting' ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[0.8125rem]">
            Looking for someone to talk to… {elapsed}s
          </p>
          <Button variant="secondary" size="sm" onClick={leave} disabled={pending}>
            Stop waiting
          </Button>
        </div>
      ) : (
        <Button onClick={join} disabled={pending}>
          {pending ? 'Joining…' : 'Find someone'}
        </Button>
      )}

      {error ? <Notice tone="danger">{error}</Notice> : null}

      <p className="text-2xs text-muted">
        Anonymous to the other participant — never untraceable. Reports reach moderators with the session
        context, and abusive accounts can be suspended.
      </p>
    </Card>
  );
}
