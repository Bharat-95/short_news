export function absoluteUrl(href: string, base: string) {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

export function cleanUrl(u: string) {
  return u.split("#")[0].split("?")[0];
}
