export function logSiteStep(site: string, step: string, data?: any) {
  console.log(`[${site}] ${step}`, data || "");
}

export function logError(site: string, step: string, err: any) {
  console.error(`[${site}] ERROR at ${step}:`, err?.message || err);
}
