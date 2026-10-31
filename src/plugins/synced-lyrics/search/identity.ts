// Only used when a source supplies no variant ID. Content digest is stable
// across provider order, cache copies, retries and application restarts.
export const variantDigest = async (text: string) => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
};
