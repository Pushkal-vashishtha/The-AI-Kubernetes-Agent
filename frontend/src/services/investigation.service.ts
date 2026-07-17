import { api } from "./api";
import type { InvestigateResponse } from "../types";

// Investigations run kubectl + LLM reasoning — allow a generous timeout.
const INVESTIGATE_TIMEOUT_MS = 180_000;

export async function startInvestigation(
  token: string,
  context?: string,
): Promise<InvestigateResponse> {
  const { data } = await api.post<InvestigateResponse>(
    "/investigate",
    context ? { context } : {},
    {
      headers: { Authorization: `Bearer ${token}` },
      timeout: INVESTIGATE_TIMEOUT_MS,
    },
  );
  return data;
}
