export function logSiteStep(site: string, step: string, data?: unknown) {
  console.log(`[${site}] ${step}`, data || "");
}

export function logError(site: string, step: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[${site}] ERROR at ${step}:`, message);
}
