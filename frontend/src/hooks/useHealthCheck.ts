import { useQuery } from "@tanstack/react-query";
import { getHealth } from "../services/health.service";

export function useHealthCheck() {
  return useQuery({
    queryKey: ["health"],
    queryFn: getHealth,
    refetchInterval: 30_000,
    retry: 1,
  });
}
