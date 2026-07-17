import type { ProgressStep } from "../types";

// Mirrors INVESTIGATION_STEPS in the backend investigation service.
export const INITIAL_STEPS: ProgressStep[] = [
  { key: "pods", label: "Checking Pods", status: "pending" },
  { key: "logs", label: "Reading Logs", status: "pending" },
  { key: "events", label: "Analyzing Events", status: "pending" },
  { key: "deployments", label: "Inspecting Deployments", status: "pending" },
  { key: "network", label: "Checking Networking", status: "pending" },
  { key: "ai", label: "AI Reasoning", status: "pending" },
];
