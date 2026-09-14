import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { createCluster, deleteCluster, rotateClusterToken } from "../services/cluster.service";

function useToken() {
  const { getToken } = useAuth();
  return async () => {
    const token = await getToken();
    if (!token) throw new Error("Your session has expired — please sign in again.");
    return token;
  };
}

export function useCreateCluster() {
  const token = useToken();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (name: string) => createCluster(await token(), name),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["clusters"] }),
  });
}

export function useDeleteCluster() {
  const token = useToken();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => deleteCluster(await token(), id),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["clusters"] }),
  });
}

export function useRotateClusterToken() {
  const token = useToken();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => rotateClusterToken(await token(), id),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["clusters"] }),
  });
}
