'use client';

/**
 * Direct/group thread (spec §21, §22).
 *
 * - text + GIF (no files), one-level replies are not used in chat: a thread is
 *   the conversation itself.
 * - "Seen" is the only receipt; there is no presence, no typing indicator, no
 *   "delivered" theatre beyond what the database records.
 * - New messages arrive through Supabase Realtime on the private
 *   `conversation:<id>` channel; RLS applies to every row the browser receives.
 * - Autoscroll is intelligent: stay pinned at the bottom unless the reader has
 *   scrolled up, in which case a "New messages" control appears.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Textarea, Notice, Spinner } from '@/components/ui';
import { GifAttachment, GifPicker } from '@/components/media/GifPicker';
import { ReportDialog } from '@/components/social/ReportDialog';
import { useFormAction } from '@/lib/forms';
import { getBrowserClient, isBrowserConfigured } from '@/lib/supabase/client';
import { sendMessage, editMessage, deleteMessage, markConversationRead } from '@/lib/actions/messaging';
import { cn, relativeTime } from '@/lib/utils';
import { LIMITS } from '@/lib/constants';

function mergeMessages(current, incoming) {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    byId.set(message.id, { ...(byId.get(message.id) || {}), ...message });
  }
  return [...byId.values()].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

export function ChatThread({
  conversationId,
  currentUserId,
  initialMessages = [],
  members = [],
  reads: initialReads = [],
  canPost = true,
  canReport = true,
}) {
  // Server-rendered messages and realtime arrivals are merged during render —
  // no state synchronisation effects, no cascading renders.
  const [live, setLive] = useState([]);
  const [reads, setReads] = useState(initialReads);
  const [body, setBody] = useState('');
  const [gif, setGif] = useState(null);
  const [pinned, setPinned] = useState(true);
  const [realtimeStatus, setRealtimeStatus] = useState(() =>
    isBrowserConfigured() ? 'connecting' : 'unconfigured',
  );
  const [editing, setEditing] = useState(null);
  const listRef = useRef(null);
  const formRef = useRef(null);

  const messages = useMemo(() => mergeMessages(initialMessages, live), [initialMessages, live]);

  const scrollToBottom = useCallback((behavior = 'auto') => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  useEffect(() => {
    if (pinned) scrollToBottom();
  }, [messages.length, pinned, scrollToBottom]);

  // Realtime: messages and read receipts for this conversation only.
  useEffect(() => {
    const client = getBrowserClient();
    if (!client) return undefined;
    const channel = client
      .channel(`conversation:${conversationId}`, { config: { private: true } })
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => setLive((current) => mergeMessages(current, [payload.new])),
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => setLive((current) => mergeMessages(current, [payload.new])),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'message_reads', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const row = payload.new;
          if (!row?.user_id) return;
          setReads((current) => [
            ...current.filter((read) => read.user_id !== row.user_id),
            { user_id: row.user_id, last_read_at: row.last_read_at },
          ]);
        },
      )
      .subscribe((status) => setRealtimeStatus(status));

    return () => {
      client.removeChannel(channel);
    };
  }, [conversationId]);

  // Record the Seen receipt whenever this thread is open and has unread content.
  useEffect(() => {
    if (typeof document === 'undefined' || document.visibilityState === 'hidden') return;
    const data = new FormData();
    data.set('conversation_id', conversationId);
    markConversationRead(data);
  }, [conversationId, messages.length]);

  const send = useFormAction(sendMessage, {
    onSuccess: () => {
      setBody('');
      setGif(null);
      formRef.current?.reset();
      setPinned(true);
      scrollToBottom('smooth');
    },
  });

  const edit = useFormAction(editMessage, {
    onSuccess: () => setEditing(null),
  });

  const remove = useFormAction(deleteMessage);

  const memberById = useMemo(() => new Map(members.map((member) => [member.user_id, member])), [members]);

  const otherReadAt = useMemo(() => {
    const otherReads = reads.filter((read) => read.user_id !== currentUserId);
    if (!otherReads.length) return null;
    return otherReads.reduce(
      (latest, read) => (!latest || new Date(read.last_read_at) > new Date(latest) ? read.last_read_at : latest),
      null,
    );
  }, [reads, currentUserId]);

  const myLastMessage = [...messages].reverse().find((message) => message.sender_id === currentUserId && message.status !== 'deleted');
  const seen = Boolean(
    myLastMessage && otherReadAt && new Date(otherReadAt).getTime() >= new Date(myLastMessage.created_at).getTime(),
  );

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };

  const submit = (formData) => {
    formData.set('conversation_id', conversationId);
    if (gif) formData.set('gif', JSON.stringify(gif));
    send.run(formData);
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={listRef}
        onScroll={onScroll}
        className="card flex max-h-[62vh] min-h-[18rem] flex-col gap-3 overflow-y-auto p-4"
        aria-label="Messages"
      >
        {messages.length === 0 ? (
          <p className="m-auto text-center text-[0.8125rem] text-muted">
            No messages yet. Say hello — text and GIFs only.
          </p>
        ) : null}

        {messages.map((message) => {
          const mine = message.sender_id === currentUserId;
          const author = memberById.get(message.sender_id);
          const deleted = message.status === 'deleted' || message.deleted_at;
          const isEditing = editing?.id === message.id;

          return (
            <article key={message.id} className={cn('flex flex-col gap-1', mine ? 'items-end' : 'items-start')}>
              <div className="flex items-center gap-2 text-2xs text-muted">
                <span className="font-medium text-ink">
                  {mine ? 'You' : author?.display_name || (author?.username ? `@${author.username}` : 'Student')}
                </span>
                <time dateTime={message.created_at}>{relativeTime(message.created_at)}</time>
                {message.edited_at && !deleted ? <span>· edited</span> : null}
              </div>

              {isEditing ? (
                <form
                  className="w-full max-w-md"
                  action={(formData) => {
                    formData.set('id', message.id);
                    formData.set('conversation_id', conversationId);
                    edit.run(formData);
                  }}
                >
                  <Textarea name="body" rows={2} defaultValue={message.body} maxLength={LIMITS.message.max} required />
                  <div className="mt-2 flex items-center gap-2">
                    <Button type="submit" size="sm" disabled={edit.pending}>
                      {edit.pending ? 'Saving…' : 'Save'}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <div
                  className={cn(
                    'max-w-[85%] rounded-lg border px-3 py-2',
                    mine ? 'border-line bg-accent-soft' : 'border-line bg-white',
                  )}
                >
                  {deleted ? (
                    <p className="text-[0.8125rem] italic text-muted">This message was deleted.</p>
                  ) : (
                    <>
                      {message.body ? <p className="user-text text-[0.9375rem] leading-relaxed">{message.body}</p> : null}
                      {message.gif?.url ? <GifAttachment gif={message.gif} className="mt-2 max-w-[14rem]" /> : null}
                    </>
                  )}
                </div>
              )}

              {!deleted && !isEditing ? (
                <div className="flex items-center gap-2 text-2xs text-muted">
                  {mine ? (
                    <>
                      <button type="button" className="hover:text-ink" onClick={() => setEditing(message)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="hover:text-ink"
                        onClick={() => {
                          const data = new FormData();
                          data.set('id', message.id);
                          data.set('conversation_id', conversationId);
                          remove.run(data);
                        }}
                      >
                        Delete
                      </button>
                    </>
                  ) : null}
                  {!mine && canReport ? (
                    <ReportDialog targetType="message" targetRef={message.id} label="this message" />
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}

        <div aria-hidden="true" />
      </div>

      {!pinned ? (
        <div className="flex justify-center">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setPinned(true);
              scrollToBottom('smooth');
            }}
          >
            New messages ↓
          </Button>
        </div>
      ) : null}

      <p className="text-2xs text-muted">
        {seen ? 'Seen' : myLastMessage ? 'Sent' : ''}
        {realtimeStatus === 'SUBSCRIBED' ? '' : ' · reconnecting for live updates…'}
      </p>

      {canPost ? (
        <form
          ref={formRef}
          className="card flex flex-col gap-2 p-3"
          action={submit}
        >
          <Textarea
            name="body"
            rows={2}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Write a message…"
            maxLength={LIMITS.message.max}
            aria-label="Message"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <GifPicker value={gif} onPick={setGif} onRemove={() => setGif(null)} />
            <div className="flex items-center gap-2">
              {send.pending ? <Spinner label="Sending" /> : null}
              <Button type="submit" size="sm" icon="send" disabled={send.pending || (!body.trim() && !gif)}>
                Send
              </Button>
            </div>
          </div>
          {send.error ? <Notice tone="danger">{send.error}</Notice> : null}
        </form>
      ) : (
        <Notice tone="warning" icon="lock">
          You cannot send messages in this conversation.
        </Notice>
      )}

      <span className="sr-only" aria-live="polite">
        {messages.length} messages
      </span>
    </div>
  );
}
