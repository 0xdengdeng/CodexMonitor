export function imageGenerationIdsMatch(anchorId: string, incomingId: string) {
  const anchor = anchorId.trim();
  const incoming = incomingId.trim();
  if (!anchor || !incoming) {
    return false;
  }
  return (
    anchor === incoming ||
    anchor.endsWith(`:${incoming}`) ||
    incoming.endsWith(`:${anchor}`)
  );
}
