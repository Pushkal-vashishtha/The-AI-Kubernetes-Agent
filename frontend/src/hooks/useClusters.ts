import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { fetchClusters } from "../services/cluster.service";

export function useClusters(enabled: boolean) {
  const { getToken } = useAuth();

  return useQuery({
    queryKey: ["clusters"],
    enabled,
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Your session has expired — please sign in again.");
      return fetchClusters(token);
    },
  });
}
