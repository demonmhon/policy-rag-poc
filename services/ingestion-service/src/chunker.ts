/**
 * Splits text into overlapping semantic chunks by paragraph/section and character limits.
 */
export function chunkText(text: string, maxChunkSize = 500, overlapSize = 100): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  const paragraphs = normalized.split(/\n\s*\n/);
  const chunks: string[] = [];
  let currentChunk = '';

  for (const para of paragraphs) {
    if ((currentChunk + '\n\n' + para).length <= maxChunkSize) {
      currentChunk = currentChunk ? `${currentChunk}\n\n${para}` : para;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        const overlapText = currentChunk.slice(-overlapSize);
        currentChunk = `${overlapText}\n\n${para}`;
      } else {
        // Paragraph itself exceeds maxChunkSize
        let start = 0;
        while (start < para.length) {
          chunks.push(para.slice(start, start + maxChunkSize).trim());
          start += maxChunkSize - overlapSize;
        }
        currentChunk = '';
      }
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}
