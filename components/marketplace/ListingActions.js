'use client';

/**
 * Seller/buyer controls on a listing (spec §17–§19).
 *
 * "I'm interested" is the one path that releases the seller's contact note, and
 * "Message seller" reuses the ordinary DM system — there is no marketplace chat.
 * Nothing here reveals a contact note on its own: the server decides, once, and
 * the client only renders what came back.
 */

import { useState } from 'react';
import { Button, Notice } from '@/components/ui';
import { ReportDialog } from '@/components/social/ReportDialog';
import { useFormAction } from '@/lib/forms';
import { expressInterest, markListingSold, setListingStatus, rateCounterparty } from '@/lib/actions/marketplace';
import { startConversation } from '@/lib/actions/messaging';
import { ROUTES } from '@/lib/constants';

export function ListingActions({
  listingId,
  sellerId = null,
  sellerUsername = null,
  isSeller = false,
  status = 'active',
  canMessage = true,
  canReport = true,
  canRate = false,
  alreadyInterested = false,
  initialNote = null,
}) {
  const [note, setNote] = useState(initialNote || null);
  const [statusOpen, setStatusOpen] = useState(false);
  const [ratingOpen, setRatingOpen] = useState(false);

  const interest = useFormAction(expressInterest, {
    onSuccess: (result) => setNote(result?.result?.contact_note || 'The seller has been notified.'),
  });
  const message = useFormAction(startConversation, { redirectTo: (result) => result.href || ROUTES.chat });
  const statusChange = useFormAction(setListingStatus, { onSuccess: () => setStatusOpen(false) });
  const sold = useFormAction(markListingSold);
  const rate = useFormAction(rateCounterparty, { onSuccess: () => setRatingOpen(false) });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {!isSeller && status === 'active' ? (
          <form
            action={(formData) => {
              formData.set('listing_id', listingId);
              interest.run(formData);
            }}
          >
            <Button type="submit" disabled={interest.pending}>
              {interest.pending ? 'Sending…' : alreadyInterested || note ? 'Contact seller' : "I'm interested"}
            </Button>
          </form>
        ) : null}

        {!isSeller && canMessage && sellerId ? (
          <form
            action={(formData) => {
              formData.set('profile_id', sellerId);
              message.run(formData);
            }}
          >
            <Button type="submit" variant="secondary" icon="send" disabled={message.pending}>
              Message seller
            </Button>
          </form>
        ) : null}

        {isSeller ? (
          <>
            <Button variant="secondary" size="sm" onClick={() => setStatusOpen((value) => !value)}>
              Change status
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const data = new FormData();
                data.set('id', listingId);
                sold.run(data);
              }}
              disabled={sold.pending}
            >
              {sold.pending ? 'Completing…' : 'Mark as sold'}
            </Button>
          </>
        ) : null}

        {canRate && !isSeller ? (
          <Button variant="ghost" size="sm" icon="star" onClick={() => setRatingOpen((value) => !value)}>
            Rate this exchange
          </Button>
        ) : null}

        {!isSeller && canReport ? (
          <ReportDialog targetType="marketplace_listing" targetRef={listingId} label="this listing" />
        ) : null}
      </div>

      {note ? (
        <Notice tone="success" icon="check">
          Seller&apos;s note: {note}
          {sellerUsername ? (
            <>
              {' '}
              You can also open the conversation from{' '}
              <a href={ROUTES.user(sellerUsername)} className="underline">
                @{sellerUsername}
              </a>
              .
            </>
          ) : null}
        </Notice>
      ) : null}

      {statusOpen && isSeller ? (
        <form
          className="card flex flex-wrap items-end gap-2 p-3"
          action={(formData) => {
            formData.set('id', listingId);
            statusChange.run(formData);
          }}
        >
          <label className="text-2xs text-muted" htmlFor="listing-status">
            New status
          </label>
          <select
            id="listing-status"
            name="status"
            defaultValue="active"
            className="rounded-lg border border-line bg-white px-2 py-1.5 text-[0.8125rem]"
          >
            <option value="active">Available</option>
            <option value="reserved">Reserved</option>
            <option value="sold">Sold</option>
            <option value="removed">Remove listing</option>
          </select>
          <Button type="submit" size="sm" disabled={statusChange.pending}>
            Save
          </Button>
        </form>
      ) : null}

      {ratingOpen ? (
        <form
          className="card flex flex-wrap items-end gap-2 p-3"
          action={(formData) => {
            formData.set('listing_id', listingId);
            rate.run(formData);
          }}
        >
          <label className="text-2xs text-muted" htmlFor="rating-score">
            Rating
          </label>
          <select
            id="rating-score"
            name="score"
            defaultValue="5"
            className="rounded-lg border border-line bg-white px-2 py-1.5 text-[0.8125rem]"
          >
            {[5, 4, 3, 2, 1].map((score) => (
              <option key={score} value={score}>
                {score} / 5
              </option>
            ))}
          </select>
          <input type="hidden" name="ratee_id" value={sellerId} />
          <input type="hidden" name="role" value="buyer" />
          <input
            name="comment"
            maxLength={300}
            placeholder="Optional comment"
            className="min-w-[12rem] flex-1 rounded-lg border border-line bg-white px-2 py-1.5 text-[0.8125rem]"
          />
          <Button type="submit" size="sm" disabled={rate.pending}>
            Submit
          </Button>
        </form>
      ) : null}

      {interest.error ? <Notice tone="danger">{interest.error}</Notice> : null}
      {message.error ? <Notice tone="danger">{message.error}</Notice> : null}
      {statusChange.error ? <Notice tone="danger">{statusChange.error}</Notice> : null}
      {sold.error ? <Notice tone="danger">{sold.error}</Notice> : null}
      {rate.error ? <Notice tone="danger">{rate.error}</Notice> : null}
      {sold.success ? <Notice tone="success">Marked as sold. Both sides can leave a rating now.</Notice> : null}
    </div>
  );
}
