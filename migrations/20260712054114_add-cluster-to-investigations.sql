-- Which kubeconfig context an investigation ran against (multi-cluster support).
ALTER TABLE public.investigations ADD COLUMN IF NOT EXISTS cluster TEXT;

-- Re-create the realtime publish trigger function so live progress events
-- include the cluster name.
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
      'confidence', NEW.confidence,
      'ai_error', NEW.ai_error,
      'created_at', NEW.created_at
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
