// Investigation history persistence (InsForge).
// Failures here must never break an investigation — log and continue.

import insforgeAdmin from "../core/insforge.js";
import logger from "../core/logger.js";

export async function createInvestigationRecord(userId, progress, cluster = null) {
  if (!insforgeAdmin) return null;

  const { data, error } = await insforgeAdmin.database
    .from("investigations")
    .insert([{ user_id: userId, status: "running", progress, cluster }])
    .select();

  if (error) {
    logger.warn(`Could not create investigation record: ${error.message}`);
    return null;
  }

  return data?.[0] ?? null;
}

export async function updateInvestigationRecord(id, fields) {
  if (!insforgeAdmin || !id) return;

  const { error } = await insforgeAdmin.database
    .from("investigations")
    .update(fields)
    .eq("id", id);

  if (error) {
    logger.warn(`Could not update investigation record ${id}: ${error.message}`);
  }
}
