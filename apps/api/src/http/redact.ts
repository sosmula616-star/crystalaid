/** Removes anything that looks like a secret from an error text before it leaves the API. */
export function redactSecrets(text: string): string {
  return text
    .replace(/\b(Bearer|Bot|Basic)\s+\S+/gi, '$1 ***')
    .replace(/\/\/[^\s/@:]+:[^\s/@]+@/g, '//***@')
    .replace(/\b([\w-]*(?:token|secret|password|passwd|pwd|api[_-]?key|authorization)[\w-]*)\s*[=:]\s*\S+/gi, '$1=***')
    // Discord bot tokens and similar long opaque strings.
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{20,}/g, '***')
    .replace(/\b[A-Za-z0-9+/_=-]{32,}\b/g, '***');
}
