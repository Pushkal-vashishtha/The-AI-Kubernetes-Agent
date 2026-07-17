import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { insforge } from "../lib/insforge";
import type { InvestigationEvent } from "../types";

/**
 * Subscribes to the user's InsForge realtime channel and exposes the
 * latest investigation event. The backend updates the investigation row
 * after every step; a database trigger publishes each update here.
 */
export function useLiveProgress(userId: string | null) {
  const [event, setEvent] = useState<InvestigationEvent | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;

    let active = true;
    const channel = `investigations:user:${userId}`;

    async function connect() {
      try {
        await insforge.realtime.connect();
        const response = await insforge.realtime.subscribe(channel);
        if (!response.ok) {
          console.warn("Realtime subscribe failed:", response.error?.message);
        }
      } catch (error) {
        console.warn("Realtime connection failed:", error);
      }
    }

    const handleUpdate = (payload: InvestigationEvent) => {
      if (!active) return;
      setEvent(payload);
      if (payload.status === "completed" || payload.status === "failed") {
        void queryClient.invalidateQueries({ queryKey: ["investigations"] });
      }
    };

    void connect();
    insforge.realtime.on("investigation_updated", handleUpdate);

    return () => {
      active = false;
      insforge.realtime.off("investigation_updated", handleUpdate);
      insforge.realtime.unsubscribe(channel);
    };
  }, [userId, queryClient]);

  return event;
}
