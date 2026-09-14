-- Multi-tenant foundation: clusters are owned by users.
--
-- Until now the backend served whatever contexts lived in the kubeconfig on
-- the server box, so every signed-in user saw (and could investigate) the
-- same clusters. This migration gives each cluster an owner.
--
-- Two modes:
--   'local'  — a kubeconfig context on the backend machine (the original
--              behaviour; kept for local dev and the EC2 demo, synced on boot
--              for the single user named by LOCAL_CLUSTER_OWNER).
--   'agent'  — a read-only agent installed in the user's own cluster that
--              dials out to us. Added in a later phase; the column exists now
--              so the API and RLS shape do not change again.
--
-- Write model matches investigations: only the trusted Express backend writes
-- (admin API key, bypasses RLS); authenticated users read their own rows.

-- 1. Clusters
CREATE TABLE public.clusters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'agent'
    CHECK (mode IN ('local', 'agent')),
  -- kubeconfig context name; only meaningful for mode = 'local'
  context TEXT,
  -- sha256 of the enrolment token. The token itself is shown once, at
  -- creation, and is never stored or returned again.
  agent_token_hash TEXT,
  agent_version TEXT,
  distro TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'online', 'offline')),
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A cluster name is how the user tells their clusters apart, so it must be
-- unique per user (but two users may both call one "production").
CREATE UNIQUE INDEX clusters_user_name_idx
  ON public.clusters (user_id, name);

CREATE INDEX clusters_user_created_idx
  ON public.clusters (user_id, created_at DESC);

-- Agent connections authenticate by token, so that lookup must be indexed.
CREATE UNIQUE INDEX clusters_agent_token_hash_idx
  ON public.clusters (agent_token_hash)
  WHERE agent_token_hash IS NOT NULL;

CREATE TRIGGER clusters_updated_at
  BEFORE UPDATE ON public.clusters
  FOR EACH ROW
  EXECUTE FUNCTION system.update_updated_at();

-- 2. Access control: users read their own clusters; only the backend writes.
ALTER TABLE public.clusters ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_read_own_clusters
  ON public.clusters FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.clusters FROM anon, authenticated;

-- Column-level grant: agent_token_hash is deliberately excluded, so even a
-- `select=*` from an authenticated client cannot read credential material.
GRANT SELECT (
  id, user_id, name, mode, context, agent_version, distro,
  status, last_seen_at, created_at, updated_at
) ON public.clusters TO authenticated;

-- 3. Link investigations to the cluster they ran against.
-- The existing `cluster` text column stays: historical rows recorded only a
-- context name, and the realtime payload already carries it.
ALTER TABLE public.investigations
  ADD COLUMN IF NOT EXISTS cluster_id UUID REFERENCES public.clusters(id) ON DELETE SET NULL;

CREATE INDEX investigations_cluster_idx
  ON public.investigations (cluster_id, created_at DESC);

-- 4. Realtime: one channel per user for cluster status changes, mirroring
-- the investigations channel so the UI can show an agent coming online.
INSERT INTO realtime.channels (pattern, description, enabled)
VALUES ('clusters:user:%', 'Per-user AI K8s cluster status', true)
ON CONFLICT (pattern) DO UPDATE
SET description = EXCLUDED.description,
    enabled = EXCLUDED.enabled;

CREATE OR REPLACE FUNCTION public.notify_cluster_update()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM realtime.publish(
    'clusters:user:' || NEW.user_id::text,
    'cluster_updated',
    jsonb_build_object(
      'id', NEW.id,
      'name', NEW.name,
      'mode', NEW.mode,
      'context', NEW.context,
      'status', NEW.status,
      'distro', NEW.distro,
      'agent_version', NEW.agent_version,
      'last_seen_at', NEW.last_seen_at,
      'created_at', NEW.created_at
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER cluster_realtime_trigger
AFTER INSERT OR UPDATE ON public.clusters
FOR EACH ROW
EXECUTE FUNCTION public.notify_cluster_update();

-- 5. Subscription control: users may only subscribe to their own channel.
CREATE POLICY users_subscribe_own_cluster_channel
  ON realtime.channels FOR SELECT
  TO authenticated
  USING (
    pattern = 'clusters:user:%'
    AND realtime.channel_name() = 'clusters:user:' || (SELECT auth.uid())::text
  );

-- 6. Investigation realtime payload gains cluster_id (additive; the existing
-- `cluster` name field stays so the current frontend keeps working).
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
      'cluster', NEW.cluster,
      'cluster_id', NEW.cluster_id,
      'confidence', NEW.confidence,
      'ai_error', NEW.ai_error,
      'created_at', NEW.created_at
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
