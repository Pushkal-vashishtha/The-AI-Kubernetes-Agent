import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { insforge } from "../lib/insforge";

/**
 * Keeps the cluster list live. The backend updates a cluster row when an
 * agent connects, disconnects or is removed; a database trigger publishes
 * each change to the user's channel, and we refetch the list.
 *
 * Refetching (rather than patching the cache from the payload) is deliberate:
 * `available` depends on the backend that answers, not just on the row.
 */
export function useClusterEvents(userId: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;

    let active = true;
    const channel = `clusters:user:${userId}`;

    async function connect() {
      try {
        await insforge.realtime.connect();
        const response = await insforge.realtime.subscribe(channel);
        if (!response.ok) {
          console.warn("Cluster realtime subscribe failed:", response.error?.message);
        }
      } catch (error) {
        console.warn("Cluster realtime connection failed:", error);
      }
    }

    const handleUpdate = () => {
      if (active) void queryClient.invalidateQueries({ queryKey: ["clusters"] });
    };

    void connect();
    insforge.realtime.on("cluster_updated", handleUpdate);

    return () => {
      active = false;
      insforge.realtime.off("cluster_updated", handleUpdate);
      insforge.realtime.unsubscribe(channel);
    };
  }, [userId, queryClient]);
}
