import { useQuery } from "@tanstack/react-query";
import { insforge } from "../lib/insforge";
import type { InvestigationRecord } from "../types";

export function useHistory(enabled: boolean) {
  return useQuery({
    queryKey: ["investigations"],
    enabled,
    queryFn: async (): Promise<InvestigationRecord[]> => {
      const { data, error } = await insforge.database
        .from("investigations")
        .select("id, created_at, status, root_cause, namespace, cluster, confidence")
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) throw new Error(error.message);
      return (data ?? []) as InvestigationRecord[];
    },
  });
}
