import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { startInvestigation } from "../services/investigation.service";

export function useInvestigation() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (context?: string) => {
      const token = await getToken();
      if (!token) throw new Error("Your session has expired — please sign in again.");
      return startInvestigation(token, context);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["investigations"] });
    },
  });
}
