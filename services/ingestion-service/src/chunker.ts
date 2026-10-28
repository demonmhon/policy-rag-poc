/**
 * Splits Thai/English policy text into overlapping semantic chunks by paragraph/section
 * and character limits.
 */
export function chunkText(text: string, maxChunkSize = 800, overlapSize = 120): string[] {
  if (!text || !text.trim()) {
    return [];
  }

  const effectiveMax = Math.max(50, maxChunkSize);
  const effectiveOverlap = Math.max(0, Math.min(overlapSize, Math.floor(effectiveMax / 2)));
  const step = Math.max(1, effectiveMax - effectiveOverlap);

  const normalized = text.replace(/\r\n/g, '\n').trim();
  const paragraphs = normalized
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let currentChunk = '';

  const splitOversizedBlock = (block: string): void => {
    let start = 0;
    while (start < block.length) {
      const slice = block.slice(start, start + effectiveMax).trim();
      if (slice) {
        chunks.push(slice);
      }
      if (start + effectiveMax >= block.length) {
        break;
      }
      start += step;
    }
  };

  for (const para of paragraphs) {
    const candidate = currentChunk ? `${currentChunk}\n\n${para}` : para;

    if (candidate.length <= effectiveMax) {
      currentChunk = candidate;
      continue;
    }

    if (currentChunk) {
      chunks.push(currentChunk.trim());
      const overlapText = effectiveOverlap > 0 ? currentChunk.slice(-effectiveOverlap).trim() : '';
      const overlappedCandidate = overlapText ? `${overlapText}\n\n${para}` : para;

      if (overlappedCandidate.length <= effectiveMax) {
        currentChunk = overlappedCandidate;
      } else if (para.length <= effectiveMax) {
        currentChunk = para;
      } else {
        splitOversizedBlock(para);
        currentChunk = '';
      }
    } else {
      splitOversizedBlock(para);
      currentChunk = '';
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}
