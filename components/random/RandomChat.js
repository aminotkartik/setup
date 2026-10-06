'use client';

/**
 * Random — anonymous paired chat (spec §29).
 *
 * Two students, no identities, no public URL, no presence. The partner is shown
 * only as "Anonymous student": Random hides identity from the participant, it
 * does not make anyone untraceable — messages are retained server-side and
 * moderators can act on a report (with permission and an audit entry).
 *
 * Messages travel over a private Realtime broadcast channel; the history comes
 * from `random_messages_view`, which carries no sender identity at all.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Notice, Textarea, Spinner, Card } from '@/components/ui';
import { GifAttachment, GifPicker } from '@/components/media/GifPicker';
import { ReportDialog } from '@/components/social/ReportDialog';
import { getBrowserClient, isBrowserConfigured } from '@/lib/supabase/client';
import { sendRandomMessage, endRandomSession, blockRandomPartner } from '@/lib/actions/random';
import { relativeTime, cn } from '@/lib/utils';
import { LIMITS } from '@/lib/constants';

function merge(current, incoming) {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    if (!message?.id) continue;
    byId.set(message.id, { ...(byId.get(message.id) || {}), ...message });
  }
  return [...byId.values()].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

export function RandomChat({ sessionId, initialMessages = [], expiresAt = null, onExit = null }) {
  const [live, setLive] = useState([]);
  const [body, setBody] = useState('');
  const [gif, setGif] = useState(null);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const [channelState, setChannelState] = useState(() => (isBrowserConfigured() ? 'connecting' : 'unconfigured'));
  const [secondsLeft, setSecondsLeft] = useState(() => {
    if (!expiresAt) return null;
    return Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  });
  const listRef = useRef(null);
  const channelRef = useRef(null);

  const all = merge(initialMessages, live);

  // Realtime broadcast: the partner's client publishes what the database stored.
  useEffect(() => {
    const client = getBrowserClient();
    if (!client) return undefined;
    const channel = client.channel(`random:${sessionId}`, { config: { private: true } });
    channel
      .on('broadcast', { event: 'message' }, (payload) => {
        if (payload?.payload) setLive((current) => merge(current, [payload.payload]));
      })
      .subscribe((status) => setChannelState(status));
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      client.removeChannel(channel);
    };
  }, [sessionId]);

  useEffect(() => {
    if (!expiresAt) return undefined;
    const timer = setInterval(() => {
      setSecondsLeft(Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  const scrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [all.length, scrollToBottom]);

  const submit = async (formData) => {
    setPending(true);
    setError(null);
    const values = new FormData();
    values.set('session_id', sessionId);
    values.set('body', formData.get('body') || '');
    if (gif) values.set('gif', JSON.stringify(gif));
    try {
      const result = await sendRandomMessage(values);
      if (!result?.ok) {
        setError(result?.error || 'That message was not sent.');
        return;
      }
      const stored = result.message || {};
      const optimistic = {
        id: stored.id || `local-${Date.now()}`,
        session_id: sessionId,
        mine: true,
        content: values.get('body'),
        gif: gif || null,
        created_at: stored.created_at || new Date().toISOString(),
      };
      setLive((current) => merge(current, [optimistic]));
      setBody('');
      setGif(null);
      channelRef.current?.send({ type: 'broadcast', event: 'message', payload: optimistic });
    } catch (thrown) {
      setError(thrown?.message || 'That message was not sent.');
    } finally {
      setPending(false);
    }
  };

  const end = async (reason) => {
    const data = new FormData();
    data.set('session_id', sessionId);
    data.set('reason', reason);
    await endRandomSession(data);
    onExit?.();
  };

  const [blockState, setBlockState] = useState('idle');

  const block = async () => {
    setBlockState('pending');
    const data = new FormData();
    data.set('session_id', sessionId);
    const result = await blockRandomPartner(data);
    if (!result?.ok) {
      setError(result?.error || 'That partner could not be blocked.');
      setBlockState('idle');
      return;
    }
    onExit?.();
  };

  const minutes = secondsLeft === null ? null : Math.floor(secondsLeft / 60);
  const seconds = secondsLeft === null ? null : secondsLeft % 60;

  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-wrap items-center justify-between gap-2 p-3">
        <div className="min-w-0">
          <p className="text-[0.875rem] font-medium">Anonymous student</p>
          <p className="text-2xs text-muted">
            Neither of you can see the other&apos;s username. Messages are stored for moderation.
            {minutes !== null ? ` Session ends in ${minutes}:${String(seconds).padStart(2, '0')}.` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => end('left')}>
            Next
          </Button>
          <Button size="sm" variant="ghost" onClick={() => end('ended')}>
            End
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={block}
            disabled={blockState === 'pending' || blockState === 'done'}
          >
            {blockState === 'pending' ? 'Blocking…' : 'Block'}
          </Button>
          <ReportDialog targetType="random_session" targetRef={sessionId} label="this Random session" />
        </div>
      </Card>

      <div
        ref={listRef}
        className="card flex max-h-[52vh] min-h-[16rem] flex-col gap-3 overflow-y-auto p-4"
        aria-label="Anonymous messages"
      >
        {all.length === 0 ? (
          <p className="m-auto text-center text-[0.8125rem] text-muted">
            Say hello. Keep it civil — moderators can review reported sessions.
          </p>
        ) : null}
        {all.map((message) => (
          <article key={message.id} className={cn('flex flex-col gap-1', message.mine ? 'items-end' : 'items-start')}>
            <span className="text-2xs text-muted">
              {message.mine ? 'You' : 'Anonymous'} · {relativeTime(message.created_at)}
            </span>
            <div className={cn('max-w-[85%] rounded-lg border px-3 py-2', message.mine ? 'border-line bg-accent-soft' : 'border-line bg-white')}>
              {message.content ? <p className="user-text text-[0.9375rem] leading-relaxed">{message.content}</p> : null}
              {message.gif?.url ? <GifAttachment gif={message.gif} className="mt-2 max-w-[14rem]" /> : null}
            </div>
          </article>
        ))}
      </div>

      <p className="text-2xs text-muted">
        {channelState === 'SUBSCRIBED' ? 'Connected for live messages.' : 'Reconnecting for live messages…'}
      </p>

      <form
        className="card flex flex-col gap-2 p-3"
        action={(formData) => {
          submit(formData);
        }}
      >
        <Textarea
          name="body"
          rows={2}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Write a message…"
          maxLength={LIMITS.message.max}
          aria-label="Anonymous message"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <GifPicker value={gif} onPick={setGif} onRemove={() => setGif(null)} />
          <div className="flex items-center gap-2">
            {pending ? <Spinner label="Sending" /> : null}
            <Button type="submit" size="sm" icon="send" disabled={pending || (!body.trim() && !gif)}>
              Send
            </Button>
          </div>
        </div>
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </form>

      <Notice tone="neutral" icon="shield">
        Random is anonymous, not untraceable. If someone threatens or abuses you, report the session — a
        moderator with the right permission can review it.
      </Notice>
    </div>
  );
}
