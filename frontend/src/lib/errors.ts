import { isAxiosError } from "axios";

/**
 * Turn any thrown error into a message a beginner can act on —
 * never a stack trace or raw axios internals.
 */
export function friendlyErrorMessage(error: unknown): string {
  if (isAxiosError(error)) {
    if (error.code === "ECONNABORTED") {
      return "The investigation timed out. The cluster or the AI may be slow right now — try again.";
    }
    if (!error.response) {
      return "Cannot reach the backend API. Make sure the backend is running and refresh the page.";
    }
    if (error.response.status === 401) {
      return "Your session has expired — please sign out and sign in again.";
    }
    const message = (error.response.data as { message?: string } | undefined)?.message;
    return message ?? "The investigation failed on the server. Check the backend logs for details.";
  }
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}
