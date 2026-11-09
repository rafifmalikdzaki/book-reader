import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

import { Document, Page, pdfjs } from 'react-pdf';

if (typeof window !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
  try {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString();
  } catch {
    pdfjs.GlobalWorkerOptions.workerSrc = '/static/vendor/pdfjs/build/pdf.worker.mjs';
  }
}

export const PDF_DOCUMENT_OPTIONS = {
  cMapUrl: '/static/vendor/pdfjs/web/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/static/vendor/pdfjs/web/standard_fonts/',
  wasmUrl: '/static/vendor/pdfjs/web/wasm/',
};

export interface RawOutlineNode {
  title: string;
  dest?: string | unknown[] | null;
  items?: RawOutlineNode[];
}

export interface PdfOutlineItem {
  id: string;
  title: string;
  pageNumber: number | null;
  level: number;
  items: PdfOutlineItem[];
}

export type PdfTextItemLike = { str: string } | { type?: string; str?: string };

export interface PdfPageLike {
  pageNumber?: number;
  originalWidth?: number;
  originalHeight?: number;
  width?: number;
  height?: number;
  getTextContent?: () => Promise<{ items: PdfTextItemLike[] }>;
}

export interface PdfDocumentLike {
  numPages: number;
  getOutline?: () => Promise<RawOutlineNode[] | null>;
  getDestination?: (dest: string) => Promise<unknown[] | null>;
  getPageIndex?: (...args: never[]) => Promise<number>;
  getPage?: (pageNumber: number) => Promise<PdfPageLike>;
}

async function resolveDestPage(doc: PdfDocumentLike, dest: unknown): Promise<number | null> {
  try {
    let resolved = dest;
    if (typeof resolved === 'string' && doc.getDestination) {
      resolved = await doc.getDestination(resolved);
    }
    if (!Array.isArray(resolved) || resolved.length === 0) return null;
    const first = resolved[0];
    if (typeof first === 'number' && Number.isFinite(first)) {
      return Math.max(1, first + 1);
    }
    if (typeof first === 'object' && first !== null && doc.getPageIndex) {
      const getIndex = doc.getPageIndex as (ref: unknown) => Promise<number>;
      const idx = await getIndex(first);
      return Number.isFinite(idx) ? Math.max(1, idx + 1) : null;
    }
    return null;
  } catch {
    return null;
  }
}

export async function extractPdfOutline(doc: PdfDocumentLike): Promise<PdfOutlineItem[]> {
  if (!doc.getOutline) return [];
  try {
    const raw = await doc.getOutline();
    if (!raw || !Array.isArray(raw)) return [];

    const walk = async (
      nodes: RawOutlineNode[],
      level: number,
      prefix: string,
    ): Promise<PdfOutlineItem[]> => {
      const out: PdfOutlineItem[] = [];
      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i]!;
        const id = `${prefix}${i}`;
        const pageNumber = await resolveDestPage(doc, node.dest);
        const children =
          node.items && node.items.length > 0
            ? await walk(node.items, Math.min(3, level + 1), `${id}.`)
            : [];
        out.push({
          id,
          title: (node.title || 'Untitled section').trim(),
          pageNumber,
          level,
          items: children,
        });
      }
      return out;
    };

    return await walk(raw, 1, 'sec-');
  } catch {
    return [];
  }
}

/** Finds the outline item ID whose `pageNumber` is closest to and `<= currentPage`. */
export function findActiveOutlineId(
  items: PdfOutlineItem[],
  currentPage: number,
): string | null {
  let bestId: string | null = null;
  let bestPage = -1;

  const visit = (list: PdfOutlineItem[]) => {
    for (const item of list) {
      if (item.pageNumber !== null && item.pageNumber <= currentPage && item.pageNumber >= bestPage) {
        bestPage = item.pageNumber;
        bestId = item.id;
      }
      if (item.items.length > 0) visit(item.items);
    }
  };
  visit(items);
  return bestId;
}

export { Document as PdfDocument, Page as PdfPage };
