import zlib from 'zlib';

interface PdfObjectEntry {
  dict: string;
  streamBuf: Buffer | null;
}

interface PageEntry {
  pageId: number;
  contentId: number;
  fontNameMap: Map<string, number>;
}

export interface ParsedPolicyMetadata {
  title: string;
  department: string;
  version: string;
  code?: string;
}

function decodeUtf16BeHex(hex: string): string {
  let clean = hex.replace(/\s+/g, '');
  if (clean.toUpperCase().startsWith('FEFF')) {
    clean = clean.slice(4);
  }
  let out = '';
  for (let i = 0; i + 3 < clean.length; i += 4) {
    out += String.fromCharCode(parseInt(clean.slice(i, i + 4), 16));
  }
  return out;
}

function decodePdfLiteralString(literal: string): string {
  return literal
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');
}

/**
 * Extracts clean UTF-8 Thai and English text from a PDF buffer.
 * Supports CID/Type0 fonts with ToUnicode CMaps, /ActualText spans (used for Thai vowel/tone clusters),
 * and standard PDF literal text operators (Tj / TJ).
 */
export function extractTextFromPdfBuffer(buf: Buffer): string {
  if (!buf || buf.length < 8 || !buf.subarray(0, 8).toString('latin1').startsWith('%PDF-')) {
    throw new Error('Invalid PDF buffer: missing %PDF- header');
  }

  const raw = buf.toString('latin1');
  const objects = new Map<number, PdfObjectEntry>();
  const objRegex = /(\d+)\s+0\s+obj\b([\s\S]*?)endobj/g;
  let match: RegExpExecArray | null;

  let docTitleFromInfo = '';

  while ((match = objRegex.exec(raw)) !== null) {
    const id = Number(match[1]);
    const body = match[2];

    const titleHexMatch = body.match(/\/Title\s*<([0-9A-Fa-f\s]+)>/);
    if (titleHexMatch && !docTitleFromInfo) {
      docTitleFromInfo = decodeUtf16BeHex(titleHexMatch[1]).trim();
    }

    const streamMatch = body.match(/stream\r?\n/);
    let streamBuf: Buffer | null = null;
    let dict = body;

    if (streamMatch && streamMatch.index !== undefined) {
      const start = match.index + match[0].indexOf(streamMatch[0]) + streamMatch[0].length;
      const end = raw.indexOf('endstream', start);
      if (end !== -1) {
        let slice = buf.subarray(start, end);
        if (slice[slice.length - 1] === 0x0a) slice = slice.subarray(0, slice.length - 1);
        if (slice[slice.length - 1] === 0x0d) slice = slice.subarray(0, slice.length - 1);
        dict = body.slice(0, streamMatch.index);
        try {
          streamBuf = zlib.inflateSync(slice);
        } catch {
          streamBuf = slice;
        }
      }
    }

    objects.set(id, { dict, streamBuf });
  }

  // Parse ToUnicode CMaps for Type0 / CID fonts
  const fontMaps = new Map<number, Map<string, string>>();
  for (const [id, obj] of objects.entries()) {
    const tuMatch = obj.dict.match(/\/ToUnicode\s+(\d+)\s+0\s+R/);
    if (!tuMatch) continue;

    const tuId = Number(tuMatch[1]);
    const tuObj = objects.get(tuId);
    if (!tuObj || !tuObj.streamBuf) continue;

    const cmapText = tuObj.streamBuf.toString('latin1');
    const glyphMap = new Map<string, string>();

    const bfcharBlocks = cmapText.match(/beginbfchar[\s\S]*?endbfchar/g) || [];
    for (const block of bfcharBlocks) {
      const pairRe = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
      let pm: RegExpExecArray | null;
      while ((pm = pairRe.exec(block)) !== null) {
        const src = pm[1].toUpperCase();
        const dstHex = pm[2];
        let decoded = '';
        for (let i = 0; i + 3 < dstHex.length; i += 4) {
          const code = parseInt(dstHex.slice(i, i + 4), 16);
          if (code > 0) decoded += String.fromCharCode(code);
        }
        glyphMap.set(src, decoded);
      }
    }

    const bfrangeBlocks = cmapText.match(/beginbfrange[\s\S]*?endbfrange/g) || [];
    for (const block of bfrangeBlocks) {
      const rangeLines = block.split(/\r?\n/);
      for (const line of rangeLines) {
        const rm = line.match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/);
        if (rm) {
          const startCode = parseInt(rm[1], 16);
          const endCode = parseInt(rm[2], 16);
          let targetCode = parseInt(rm[3], 16);
          const padLen = rm[1].length;
          for (let c = startCode; c <= endCode; c++) {
            const key = c.toString(16).toUpperCase().padStart(padLen, '0');
            if (targetCode > 0) {
              glyphMap.set(key, String.fromCharCode(targetCode));
            }
            targetCode++;
          }
        }
      }
    }

    fontMaps.set(id, glyphMap);
  }

  // Locate Page objects and their font & content stream references
  const pages: PageEntry[] = [];
  for (const [id, obj] of objects.entries()) {
    if (/\/Type\s*\/Page\b/.test(obj.dict)) {
      const fontNameMap = new Map<string, number>();
      const fontDictMatch = obj.dict.match(/\/Font\s*<<([\s\S]*?)>>/);
      if (fontDictMatch) {
        const fRe = /\/(\w+)\s+(\d+)\s+0\s+R/g;
        let fm: RegExpExecArray | null;
        while ((fm = fRe.exec(fontDictMatch[1])) !== null) {
          fontNameMap.set(fm[1], Number(fm[2]));
        }
      }
      const contentsMatch = obj.dict.match(/\/Contents\s+(\d+)\s+0\s+R/);
      if (contentsMatch) {
        pages.push({ pageId: id, contentId: Number(contentsMatch[1]), fontNameMap });
      }
    }
  }

  const visualLines: Array<{ y: number | null; text: string }> = [];

  for (const page of pages) {
    const contentObj = objects.get(page.contentId);
    if (!contentObj || !contentObj.streamBuf) continue;

    const content = contentObj.streamBuf.toString('latin1');
    const btBlocks = content.match(/BT[\s\S]*?ET/g) || [];
    let lastY: number | null = null;
    let currentLine = '';
    let activeFontMap: Map<string, string> | null = null;

    for (const bt of btBlocks) {
      const tmMatch = bt.match(/1\s+0\s+0\s+-?1\s+([\d.-]+)\s+([\d.-]+)\s+Tm/);
      const y = tmMatch ? Number(tmMatch[2]) : null;

      // Replace /Span<</ActualText <FEFF...> >> BDC ... EMC while keeping inner /Tf font switches
      const processedBt = bt.replace(
        /\/Span\s*<<\s*\/ActualText\s*<([0-9A-Fa-f]+)>\s*>>\s*BDC([\s\S]*?)EMC/g,
        (_, hex: string, inner: string) => {
          const tfMatches = (inner.match(/\/\w+\s+[\d.]+\s+Tf/g) || []).join('\n');
          const decoded = decodeUtf16BeHex(hex);
          return `${tfMatches}\nACTUALTEXT(${Buffer.from(decoded, 'utf8').toString('base64')})`;
        }
      );

      let blockText = '';
      const tokenRe =
        /\/(\w+)\s+[\d.]+\s+Tf|ACTUALTEXT\(([A-Za-z0-9+/=]+)\)|<([0-9A-Fa-f]+)>\s*Tj|\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*Tj|\[([\s\S]*?)\]\s*TJ/g;
      let tm: RegExpExecArray | null;

      while ((tm = tokenRe.exec(processedBt)) !== null) {
        if (tm[1]) {
          const fObjId = page.fontNameMap.get(tm[1]);
          if (fObjId !== undefined && fontMaps.has(fObjId)) {
            activeFontMap = fontMaps.get(fObjId) || activeFontMap;
          }
        } else if (tm[2]) {
          blockText += Buffer.from(tm[2], 'base64').toString('utf8');
        } else if (tm[3]) {
          const hex = tm[3].toUpperCase();
          if (activeFontMap && activeFontMap.has(hex)) {
            blockText += activeFontMap.get(hex);
          } else if (hex.length % 4 === 0) {
            for (let i = 0; i < hex.length; i += 4) {
              const part = hex.slice(i, i + 4);
              if (activeFontMap && activeFontMap.has(part)) {
                blockText += activeFontMap.get(part);
              } else {
                const code = parseInt(part, 16);
                if (code > 0) blockText += String.fromCharCode(code);
              }
            }
          }
        } else if (tm[4] !== undefined) {
          blockText += decodePdfLiteralString(tm[4]);
        } else if (tm[5] !== undefined) {
          const arrayLitRe = /\(([^)\\]*(?:\\.[^)\\]*)*)\)/g;
          let alm: RegExpExecArray | null;
          while ((alm = arrayLitRe.exec(tm[5])) !== null) {
            blockText += decodePdfLiteralString(alm[1]);
          }
        }
      }

      if (y !== null && lastY !== null && Math.abs(y - lastY) < 2) {
        currentLine += blockText;
      } else {
        if (currentLine.trim()) {
          visualLines.push({ y: lastY, text: currentLine.trim() });
        }
        currentLine = blockText;
        if (y !== null) lastY = y;
      }
    }

    if (currentLine.trim()) {
      visualLines.push({ y: lastY, text: currentLine.trim() });
    }
  }

  // Fallback for simple uncompressed PDFs without Page /Contents indirection
  if (visualLines.length === 0) {
    const fallbackMatches = raw.match(/\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*Tj/g) || [];
    const extracted = fallbackMatches
      .map((m) => {
        const inner = m.match(/\(([\s\S]*)\)\s*Tj/);
        return inner ? decodePdfLiteralString(inner[1]) : '';
      })
      .filter(Boolean);
    return extracted.join('\n').trim();
  }

  // Reconstruct structured paragraphs from visual lines
  const paragraphs: string[] = [];
  if (docTitleFromInfo) {
    paragraphs.push(`# ${docTitleFromInfo}`);
  }

  let currentPara = '';
  let prevY: number | null = null;

  for (const line of visualLines) {
    const text = line.text.trim();
    if (!text) continue;

    // Skip decorative badge or duplicate title lines if docTitleFromInfo is already present
    if (text.includes('SYNTHETIC BANK POLICY CORPUS')) continue;
    if (docTitleFromInfo && docTitleFromInfo.includes(text) && paragraphs.length <= 1) continue;
    if (text.startsWith('รหัสเอกสาร:') && text.includes('ชั้นความลับ:')) continue;

    const isMetaLine = /^(รหัสเอกสาร|หน่วยงานที่รับผิดชอบ|เวอร์ชัน|สถานะ):/.test(text);
    const isSectionHeading = /^หมวดที่\s*\d+/.test(text);
    const isNumberedItem = /^\d+\.\s+/.test(text);
    const yGap = line.y !== null && prevY !== null ? Math.abs(line.y - prevY) : 0;

    if (isMetaLine) {
      if (currentPara) {
        paragraphs.push(currentPara);
        currentPara = '';
      }
      paragraphs.push(`- **${text.replace(':', ':**')}`);
    } else if (isSectionHeading) {
      if (currentPara) {
        paragraphs.push(currentPara);
      }
      currentPara = `## ${text}`;
    } else if (isNumberedItem || (yGap > 28 && !currentPara.startsWith('## '))) {
      if (currentPara) {
        paragraphs.push(currentPara);
      }
      currentPara = text;
    } else {
      if (!currentPara) {
        currentPara = text;
      } else if (currentPara.startsWith('## ') && !currentPara.includes('\n')) {
        currentPara += `\n${text}`;
      } else {
        const endsWithAscii = /[A-Za-z0-9/(-]$/.test(currentPara);
        const startsWithAscii = /^[A-Za-z0-9(]/.test(text);
        const joiner = endsWithAscii || startsWithAscii ? ' ' : '';
        currentPara += `${joiner}${text}`;
      }
    }

    prevY = line.y;
  }

  if (currentPara) {
    paragraphs.push(currentPara);
  }

  return paragraphs.join('\n\n').trim();
}

/**
 * Parses title, department, version, and document code from Markdown or extracted PDF policy content.
 */
export function parsePolicyMetadata(
  content: string,
  fallbackFilename = 'Untitled Policy'
): ParsedPolicyMetadata {
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const deptMatch = content.match(/หน่วยงานที่รับผิดชอบ:\*?\*?\s*([A-Za-z]+)/);
  const versionMatch = content.match(/เวอร์ชัน:\*?\*?\s*([0-9.]+)/);
  const codeMatch = content.match(/รหัสเอกสาร:\*?\*?\s*([A-Z0-9-]+)/);

  return {
    title: titleMatch ? titleMatch[1].trim() : fallbackFilename,
    department: deptMatch ? deptMatch[1].trim() : 'General',
    version: versionMatch ? versionMatch[1].trim() : '2026.1',
    ...(codeMatch ? { code: codeMatch[1].trim() } : {})
  };
}
