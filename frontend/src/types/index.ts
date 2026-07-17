export interface HealthResponse {
  status: string;
  service: string;
}

export interface AuthUser {
  id: string;
  email: string;
}

export interface Diagnosis {
  root_cause: string;
  explanation: string;
  fix: string;
  kubectl_commands: string[];
  prevention: string;
  confidence: number;
  confidence_reasoning: string;
  source: "llm" | "rule";
  model: string | null;
}

export type StepStatus = "pending" | "running" | "done" | "error";

export interface ProgressStep {
  key: string;
  label: string;
  status: StepStatus;
}

export type InvestigationStatus = "running" | "completed" | "failed";

// One kubeconfig context, as reported by GET /clusters
export interface ClusterInfo {
  context: string;
  cluster: string;
  current: boolean;
}

export interface ClustersResponse {
  status: string;
  clusters: ClusterInfo[];
  current_context: string | null;
  error: string | null;
}

// Row shape read from InsForge `investigations` (history table)
export interface InvestigationRecord {
  id: string;
  created_at: string;
  status: InvestigationStatus;
  root_cause: string | null;
  namespace: string | null;
  cluster: string | null;
  confidence: number | null;
}

// Realtime payload published by the backend trigger
export interface InvestigationEvent {
  id: string;
  status: InvestigationStatus;
  progress: ProgressStep[];
  root_cause: string | null;
  namespace: string | null;
  cluster: string | null;
  confidence: number | null;
  ai_error: string | null;
  created_at: string;
}

export interface InvestigateResponse {
  status: string;
  investigation_id: string | null;
  cluster: string | null;
  diagnosis: Diagnosis | null;
  ai_error: string | null;
  investigation: {
    cluster_reachable: boolean;
    issues_found: number;
    [key: string]: unknown;
  };
}
