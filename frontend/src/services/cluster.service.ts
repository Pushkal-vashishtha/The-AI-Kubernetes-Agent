import { api } from "./api";
import type { ClustersResponse } from "../types";

export async function fetchClusters(token: string): Promise<ClustersResponse> {
  const { data } = await api.get<ClustersResponse>("/clusters", {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
}
