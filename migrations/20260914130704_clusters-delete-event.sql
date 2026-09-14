-- Publish cluster deletions to the owner's realtime channel.
--
-- The cluster trigger only fired on INSERT and UPDATE, so removing a cluster
-- never reached subscribers: a dashboard open in a second tab (or on another
-- device) kept showing a cluster whose token had already been revoked, until
-- the page was reloaded.
--
-- Deletions reuse the existing `cluster_updated` event, with status
-- 'deleted' and `deleted: true`, so clients that simply refetch on that event
-- need no change. `deleted` is a payload value only; it is never stored.

CREATE OR REPLACE FUNCTION public.notify_cluster_deleted()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM realtime.publish(
    'clusters:user:' || OLD.user_id::text,
    'cluster_updated',
    jsonb_build_object(
      'id', OLD.id,
      'name', OLD.name,
      'mode', OLD.mode,
      'context', OLD.context,
      'host', OLD.host,
      'status', 'deleted',
      'deleted', true,
      'distro', OLD.distro,
      'agent_version', OLD.agent_version,
      'last_seen_at', OLD.last_seen_at,
      'created_at', OLD.created_at
    )
  );
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER cluster_realtime_delete_trigger
AFTER DELETE ON public.clusters
FOR EACH ROW
EXECUTE FUNCTION public.notify_cluster_deleted();
