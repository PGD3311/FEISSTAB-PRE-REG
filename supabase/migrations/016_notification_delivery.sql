-- 016_notification_delivery.sql
-- Payment hardening, part 5: the email queue. Workers hold claim tokens, the recipient and message
-- are frozen before the first send, and an uncertain delivery is never retried outside the
-- provider's 24-hour idempotency window. Spec §12.

SET search_path TO pre_registration, public;

-- An alert that a notification couldn't be delivered. Alerts about alerts are only logged.
CREATE OR REPLACE FUNCTION _queue_delivery_alert(p_notification_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = pre_registration, pg_temp
AS $$
DECLARE
  v_kind text;
  v_registration uuid;
BEGIN
  SELECT kind, registration_id INTO v_kind, v_registration FROM notifications WHERE id = p_notification_id;
  IF v_kind IN ('payment_exception_alert', 'delivery_failure_alert') THEN
    RAISE LOG '[NOTIFICATION_FAILED] alert % could not be delivered', p_notification_id;
    RETURN;
  END IF;
  INSERT INTO notifications (kind, dedupe_key, registration_id, related_notification_id)
  VALUES ('delivery_failure_alert', 'delivery_failed:' || p_notification_id, v_registration, p_notification_id)
  ON CONFLICT (dedupe_key) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION claim_notifications(p_limit integer, p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pre_registration, pg_temp
AS $$
DECLARE
  v_held uuid;
  v_claimed jsonb;
BEGIN
  -- Resend keeps idempotency keys for 24 hours. A delivery that may already have gone out, and
  -- is more than 23 hours old, waits for a person instead of risking a duplicate.
  FOR v_held IN
    UPDATE notifications
    SET status = 'needs_check', claim_token = NULL
    WHERE first_attempt_at <= p_now - interval '23 hours'
      AND ((status = 'pending' AND last_outcome = 'uncertain')
        OR (status = 'sending' AND claimed_at < p_now - interval '10 minutes'))
    RETURNING id
  LOOP
    PERFORM _queue_delivery_alert(v_held);
  END LOOP;

  WITH due AS (
    SELECT id FROM notifications
    WHERE (status = 'pending' AND next_attempt_at <= p_now)
       OR (status = 'sending' AND claimed_at < p_now - interval '10 minutes')
    ORDER BY created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE notifications n
    SET status = 'sending',
        claim_token = gen_random_uuid(),
        claimed_at = p_now,
        first_attempt_at = coalesce(n.first_attempt_at, p_now),
        -- Taking over a claim that never finished: its worker may have sent the email before it stopped
        last_outcome = CASE WHEN n.status = 'sending' THEN 'uncertain' ELSE n.last_outcome END
    FROM due
    WHERE n.id = due.id
    RETURNING n.*
  )
  SELECT coalesce(jsonb_agg(to_jsonb(claimed) ORDER BY claimed.created_at), '[]'::jsonb)
  INTO v_claimed
  FROM claimed;

  RETURN v_claimed;
END;
$$;

-- Freezes the recipient and message on the first attempt; later attempts send exactly these
CREATE OR REPLACE FUNCTION freeze_notification(p_id uuid, p_claim_token uuid, p_recipient text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pre_registration, pg_temp
AS $$
DECLARE
  v_frozen jsonb;
BEGIN
  UPDATE notifications
  SET recipient = coalesce(recipient, p_recipient),
      payload = coalesce(payload, p_payload)
  WHERE id = p_id AND claim_token = p_claim_token AND status = 'sending'
  RETURNING jsonb_build_object('recipient', recipient, 'payload', payload) INTO v_frozen;
  RETURN v_frozen;
END;
$$;

CREATE OR REPLACE FUNCTION complete_notification(p_id uuid, p_claim_token uuid, p_outcome text,
  p_provider_message_id text, p_error text, p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pre_registration, pg_temp
AS $$
DECLARE
  v_row notifications%ROWTYPE;
  -- The waits before attempts 2 to 6: six attempts in total, whatever the outcomes
  v_backoff interval[] := ARRAY['5 minutes', '15 minutes', '1 hour', '3 hours', '6 hours']::interval[];
  v_max_attempts integer := array_length(v_backoff, 1) + 1;
  v_attempts integer;
  v_outcome text := p_outcome;
BEGIN
  -- Only the newest claim may finish: an older worker's token no longer matches
  SELECT * INTO v_row FROM notifications
  WHERE id = p_id AND claim_token = p_claim_token AND status = 'sending'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'stale_claim');
  END IF;
  v_attempts := v_row.attempts + 1;

  -- A refusal only proves that this attempt sent nothing. If an earlier attempt with the same key may have
  -- gone out, the key must not change, or the provider could deliver a second copy: treat it as uncertain
  IF v_outcome = 'explicit_failure' AND v_row.last_outcome = 'uncertain' THEN
    v_outcome := 'uncertain';
  END IF;

  IF v_outcome = 'sent' THEN
    UPDATE notifications
    SET status = 'sent', last_outcome = 'sent', attempts = v_attempts, provider_message_id = p_provider_message_id,
        sent_at = p_now, claim_token = NULL, last_error = NULL
    WHERE id = p_id;
    RETURN jsonb_build_object('result', 'sent');
  END IF;

  IF v_outcome = 'explicit_failure' THEN
    IF v_attempts >= v_max_attempts THEN
      UPDATE notifications
      SET status = 'failed', last_outcome = 'explicit_failure', attempts = v_attempts, last_error = p_error,
          claim_token = NULL
      WHERE id = p_id;
      PERFORM _queue_delivery_alert(p_id);
      RETURN jsonb_build_object('result', 'failed');
    END IF;
    -- Nothing was sent, so the next try may use a new provider key
    UPDATE notifications
    SET status = 'pending', last_outcome = 'explicit_failure', attempts = v_attempts,
        send_generation = send_generation + 1, last_error = p_error, claim_token = NULL,
        next_attempt_at = p_now + v_backoff[v_attempts]
    WHERE id = p_id;
    RETURN jsonb_build_object('result', 'retry_scheduled');
  END IF;

  IF v_outcome = 'uncertain' THEN
    -- It may have gone out, and the attempts are used up: a person checks, nothing is sent again
    IF v_attempts >= v_max_attempts THEN
      UPDATE notifications
      SET status = 'needs_check', last_outcome = 'uncertain', attempts = v_attempts, last_error = p_error,
          claim_token = NULL
      WHERE id = p_id;
      PERFORM _queue_delivery_alert(p_id);
      RETURN jsonb_build_object('result', 'needs_check');
    END IF;
    -- Otherwise retry with the same provider key so the provider deduplicates it
    UPDATE notifications
    SET status = 'pending', last_outcome = 'uncertain', attempts = v_attempts, last_error = p_error,
        claim_token = NULL, next_attempt_at = p_now + v_backoff[v_attempts]
    WHERE id = p_id;
    RETURN jsonb_build_object('result', 'retry_scheduled');
  END IF;

  RAISE EXCEPTION 'unknown notification outcome %', p_outcome;
END;
$$;

-- Everything the worker needs to render a notification
CREATE OR REPLACE FUNCTION get_notification_context(p_notification_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pre_registration, pg_temp
AS $$
  SELECT jsonb_build_object(
    'kind', n.kind,
    'order', CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', r.id, 'status', r.status, 'confirmation_number', r.confirmation_number, 'total_cents', r.total_cents) END,
    'listing', CASE WHEN l.id IS NULL THEN NULL ELSE jsonb_build_object(
      'name', l.name, 'feis_date', l.feis_date, 'venue_name', l.venue_name, 'venue_address', l.venue_address,
      'contact_email', l.contact_email) END,
    'purchase', s.snapshot_data -> 'purchase',
    -- The competitor numbers of the order's dancers at this feis (a dancer keeps one number per feis), for
    -- the confirmation; numbers are assigned in the same transaction as the payment, before it is queued
    'numbers', coalesce((
      SELECT jsonb_agg(jsonb_build_object('dancer_id', cn.dancer_id, 'competitor_number', cn.competitor_number)
                       ORDER BY cn.competitor_number)
      FROM competitor_numbers cn
      WHERE cn.feis_listing_id = r.feis_listing_id
        AND cn.dancer_id IN (SELECT re.dancer_id FROM registration_entries re WHERE re.registration_id = r.id)
    ), '[]'::jsonb),
    'family', CASE WHEN h.id IS NULL THEN NULL ELSE jsonb_build_object(
      'first_name', h.first_name, 'last_name', h.last_name, 'phone', h.phone, 'email', u.email) END,
    'exception', CASE WHEN e.id IS NULL THEN NULL ELSE jsonb_build_object(
      'support_ref', e.support_ref, 'severity', e.severity, 'reason', e.reason, 'amount_cents', e.amount_cents,
      'currency', e.currency, 'stripe_account_id', e.stripe_account_id,
      'stripe_checkout_session_id', e.stripe_checkout_session_id,
      'stripe_payment_intent_id', e.stripe_payment_intent_id, 'created_at', e.created_at) END,
    'failed_notification', CASE WHEN f.id IS NULL THEN NULL ELSE jsonb_build_object(
      'kind', f.kind, 'dedupe_key', f.dedupe_key, 'status', f.status, 'last_error', f.last_error,
      'attempts', f.attempts) END
  )
  FROM notifications n
  LEFT JOIN payment_exceptions e ON e.id = n.exception_id
  LEFT JOIN registrations r ON r.id = coalesce(n.registration_id, e.registration_id)
  LEFT JOIN feis_listings l ON l.id = coalesce(r.feis_listing_id, e.feis_listing_id)
  LEFT JOIN registration_snapshots s ON s.registration_id = r.id
  LEFT JOIN households h ON h.id = coalesce(r.household_id, e.household_id)
  LEFT JOIN auth.users u ON u.id = h.user_id
  LEFT JOIN notifications f ON f.id = n.related_notification_id
  WHERE n.id = p_notification_id
$$;

REVOKE ALL ON FUNCTION _queue_delivery_alert(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION claim_notifications(integer, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION freeze_notification(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION complete_notification(uuid, uuid, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_notification_context(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_notifications(integer, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION freeze_notification(uuid, uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION complete_notification(uuid, uuid, text, text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION get_notification_context(uuid) TO service_role;
