import { api } from "./api";
import type { ClustersResponse, CreateClusterResponse } from "../types";

const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

export async function fetchClusters(token: string): Promise<ClustersResponse> {
  const { data } = await api.get<ClustersResponse>("/clusters", auth(token));
  return data;
}

export async function createCluster(token: string, name: string): Promise<CreateClusterResponse> {
  const { data } = await api.post<CreateClusterResponse>("/clusters", { name }, auth(token));
  return data;
}

export async function deleteCluster(token: string, id: string): Promise<void> {
  await api.delete(`/clusters/${encodeURIComponent(id)}`, auth(token));
}

/** The one-liner a user runs against their own cluster. */
export function installCommand(token: string): string {
  const base = String(api.defaults.baseURL ?? "").replace(/\/+$/, "");
  return `curl -sSL ${base}/install.sh | bash -s -- --token ${token}`;
}

/** A cluster pod cannot reach a backend that is only listening on localhost. */
export function apiIsLocalOnly(): boolean {
  return /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(String(api.defaults.baseURL ?? ""));
}
