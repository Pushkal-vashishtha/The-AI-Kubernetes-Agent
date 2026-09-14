-- Which backend registered a local (kubeconfig) cluster.
--
-- More than one backend can register local clusters for the same owner: the
-- developer's laptop and the EC2 demo box both do. Without knowing which rows
-- belong to which backend, each one marked the other's clusters offline on
-- every boot, and the production picker listed laptop-only kind clusters that
-- production could never reach.
--
-- NULL for agent clusters (they are not tied to a backend host) and for local
-- rows registered before this column existed; a backend claims an unclaimed
-- row the first time it finds that context in its own kubeconfig.

ALTER TABLE public.clusters
  ADD COLUMN IF NOT EXISTS host TEXT;

-- Hostnames are short; anything this long is a bug, not a hostname.
ALTER TABLE public.clusters
  ADD CONSTRAINT clusters_host_length CHECK (host IS NULL OR char_length(host) <= 253);

-- Boot-time sync looks up one owner's local rows for one host.
CREATE INDEX IF NOT EXISTS clusters_user_mode_host_idx
  ON public.clusters (user_id, mode, host);

-- Readable by the owner, like the other non-secret columns. The table-level
-- grant is column-scoped (agent_token_hash is excluded), so a new column is
-- invisible to clients until it is granted explicitly.
GRANT SELECT (host) ON public.clusters TO authenticated;

-- Carry it in the realtime payload so a status change shows where it applies.
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
      'host', NEW.host,
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
