-- Investigation history + realtime progress for the AI Kubernetes Agent.
--
-- Write model: only the trusted Express backend writes rows (admin API key,
-- bypasses RLS). Authenticated users can only read their own history.
-- Realtime: every insert/update is published to the owner's channel
-- 'investigations:user:<user_id>' via a trigger.

-- 1. History table
CREATE TABLE public.investigations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),
  progress JSONB NOT NULL DEFAULT '[]'::jsonb,
  root_cause TEXT,
  namespace TEXT,
  confidence INTEGER CHECK (confidence BETWEEN 0 AND 100),
  issues_found INTEGER,
  diagnosis JSONB,
  ai_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX investigations_user_created_idx
  ON public.investigations (user_id, created_at DESC);

CREATE TRIGGER investigations_updated_at
  BEFORE UPDATE ON public.investigations
  FOR EACH ROW
  EXECUTE FUNCTION system.update_updated_at();

-- 2. Access control: users read their own rows; only the backend writes.
ALTER TABLE public.investigations ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_read_own_investigations
  ON public.investigations FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

REVOKE INSERT, UPDATE, DELETE ON public.investigations FROM anon, authenticated;
GRANT SELECT ON public.investigations TO authenticated;

-- 3. Realtime channel pattern: one channel per user.
INSERT INTO realtime.channels (pattern, description, enabled)
VALUES ('investigations:user:%', 'Per-user AI K8s investigation progress', true)
ON CONFLICT (pattern) DO UPDATE
SET description = EXCLUDED.description,
    enabled = EXCLUDED.enabled;

-- 4. Publish every investigation change to the owner's channel.
CREATE OR REPLACE FUNCTION public.notify_investigation_update()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM realtime.publish(
    'investigations:user:' || NEW.user_id::text,
    'investigation_updated',
    jsonb_build_object(
      'id', NEW.id,
      'status', NEW.status,
      'progress', NEW.progress,
      'root_cause', NEW.root_cause,
      'namespace', NEW.namespace,
      'confidence', NEW.confidence,
      'ai_error', NEW.ai_error,
      'created_at', NEW.created_at
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER investigation_realtime_trigger
AFTER INSERT OR UPDATE ON public.investigations
FOR EACH ROW
EXECUTE FUNCTION public.notify_investigation_update();

-- 5. Subscription control: users may only subscribe to their own channel.
ALTER TABLE realtime.channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_subscribe_own_investigation_channel
  ON realtime.channels FOR SELECT
  TO authenticated
  USING (
    pattern = 'investigations:user:%'
    AND realtime.channel_name() = 'investigations:user:' || (SELECT auth.uid())::text
  );
