export function absoluteUrl(href: string, base: string) {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

export function cleanUrl(url: string) {
  try {
    const u = new URL(url);

    u.hash = "";
    u.search = "";
    let normalized = u.toString().toLowerCase();

    // remove trailing slash
    normalized = normalized.replace(/\/$/, "");

    return normalized;
  } catch {
    return url.toLowerCase().trim();
  }
}
