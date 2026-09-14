import { api } from "./api";
import type { InvestigateResponse } from "../types";

// Investigations run kubectl + LLM reasoning — allow a generous timeout.
const INVESTIGATE_TIMEOUT_MS = 180_000;

/**
 * Start an investigation. With no cluster id the backend picks the single
 * cluster it can investigate, or answers asking the user to choose one.
 */
export async function startInvestigation(
  token: string,
  clusterId?: string,
): Promise<InvestigateResponse> {
  const { data } = await api.post<InvestigateResponse>(
    "/investigate",
    clusterId ? { cluster_id: clusterId } : {},
    {
      headers: { Authorization: `Bearer ${token}` },
      timeout: INVESTIGATE_TIMEOUT_MS,
    },
  );
  return data;
}
