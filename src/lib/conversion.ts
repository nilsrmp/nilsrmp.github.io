/// <reference types="vite/client" />

export type LocalTarget = 'jpg' | 'jpeg' | 'png' | 'webp' | 'pdf';

const MAX_BYTES = 30 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const MAX_PAGES = 40;
const imageTargets: LocalTarget[] = ['jpg', 'jpeg', 'png', 'webp', 'pdf'];
const pdfTargets: LocalTarget[] = ['png', 'jpg', 'webp'];
type SourceType = 'jpeg' | 'png' | 'webp' | 'pdf';

class ConversionError extends Error {}

function sourceType(file: File): SourceType | undefined {
  const mime = file.type.toLowerCase();
  const supported: Record<string, SourceType> = {
    'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf',
  };
  if (supported[mime]) return supported[mime];
  if (mime && mime !== 'application/octet-stream') return undefined;
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'jpeg';
  if (extension === 'png' || extension === 'webp' || extension === 'pdf') return extension;
  return undefined;
}

export function isLocalFile(file: File): boolean {
  return sourceType(file) !== undefined;
}

export function localTargets(file: File): LocalTarget[] {
  const source = sourceType(file);
  return source ? [...(source === 'pdf' ? pdfTargets : imageTargets)] : [];
}

function checkSize(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new ConversionError('Die Datei enthält ungültige Bildabmessungen.');
  }
  if (width * height > MAX_PIXELS || width > 32767 || height > 32767) {
    throw new ConversionError('Bilder und gerenderte PDF-Seiten dürfen höchstens 40 Megapixel und 32.767 Pixel pro Seite haben.');
  }
}

function canvasFor(width: number, height: number): HTMLCanvasElement {
  checkSize(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

function imageMime(target: Exclude<LocalTarget, 'pdf'>): string {
  return target === 'jpg' || target === 'jpeg' ? 'image/jpeg' : `image/${target}`;
}

function encode(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob || blob.size === 0) reject(new ConversionError('Der Browser konnte das Bild nicht speichern.'));
      else if (blob.type !== mime) reject(new ConversionError(`Dieser Browser unterstützt den Export als ${mime} nicht.`));
      else resolve(blob);
    }, mime, quality);
  });
}

async function validateSignature(file: File, source: SourceType): Promise<void> {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  const valid = source === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : source === 'png' ? [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)
    : source === 'webp' ? ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP'
    : ascii(0, 5) === '%PDF-';
  if (!valid) throw new ConversionError('Der Dateiinhalt stimmt nicht mit dem angegebenen Format überein.');
}

async function convertImage(file: File, source: SourceType, target: LocalTarget, quality: number): Promise<Blob> {
  const url = URL.createObjectURL(file);
  const image = new Image();
  let canvas: HTMLCanvasElement | undefined;
  try {
    image.src = url;
    await image.decode().catch(() => { throw new ConversionError('Das Bild ist beschädigt oder kann von diesem Browser nicht gelesen werden.'); });
    checkSize(image.naturalWidth, image.naturalHeight);
    // Renaming JPEG to JPG is lossless; decode first so damaged or oversized files cannot bypass validation.
    if (source === 'jpeg' && (target === 'jpg' || target === 'jpeg')) return file.slice(0, file.size, 'image/jpeg');
    canvas = canvasFor(image.naturalWidth, image.naturalHeight);
    const context = canvas.getContext('2d');
    if (!context) throw new ConversionError('Der Browser konnte keine Zeichenfläche für das Bild erstellen.');
    if (target === 'jpg' || target === 'jpeg' || target === 'pdf') {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(image, 0, 0);
    if (target !== 'pdf') return await encode(canvas, imageMime(target), quality);
    const { PDFDocument } = await import('pdf-lib');
    const document = await PDFDocument.create();
    const png = await encode(canvas, 'image/png', quality);
    const embedded = await document.embedPng(await png.arrayBuffer());
    // Pixel dimensions are mapped to 96 dpi in PDF points.
    const width = canvas.width * 0.75;
    const height = canvas.height * 0.75;
    const page = document.addPage([width, height]);
    page.drawImage(embedded, { x: 0, y: 0, width, height });
    const bytes = await document.save();
    return new Blob([Uint8Array.from(bytes).buffer], { type: 'application/pdf' });
  } finally {
    image.src = '';
    URL.revokeObjectURL(url);
    if (canvas) releaseCanvas(canvas);
  }
}

async function convertPdf(file: File, target: Exclude<LocalTarget, 'pdf'>, quality: number, stem: string): Promise<{ name: string; blob: Blob }[]> {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const loading = pdfjs.getDocument({
    data: await file.arrayBuffer(),
    // All source data stays in memory; no document URLs or remote assets are requested.
    useSystemFonts: true,
  });
  try {
    const document = await loading.promise;
    if (document.numPages > MAX_PAGES) throw new ConversionError('Die PDF-Konvertierung unterstützt höchstens 40 Seiten pro Datei.');
    const output: { name: string; blob: Blob }[] = [];
    for (let index = 1; index <= document.numPages; index++) {
      const page = await document.getPage(index);
      let canvas: HTMLCanvasElement | undefined;
      try {
        const viewport = page.getViewport({ scale: 1.5 });
        canvas = canvasFor(Math.ceil(viewport.width), Math.ceil(viewport.height));
        const context = canvas.getContext('2d');
        if (!context) throw new ConversionError('Der Browser konnte keine Zeichenfläche für das Bild erstellen.');
        await page.render({ canvas, canvasContext: context, viewport, background: '#ffffff' }).promise;
        output.push({ name: `${stem}-page-${String(index).padStart(2, '0')}.${target}`, blob: await encode(canvas, imageMime(target), quality) });
      } finally {
        if (canvas) releaseCanvas(canvas);
        page.cleanup();
      }
    }
    return output;
  } catch (error) {
    if (error instanceof Error && error.name === 'PasswordException') {
      throw new ConversionError('Diese PDF ist passwortgeschützt. Entferne den Passwortschutz vor der Konvertierung.');
    }
    throw error;
  } finally {
    await loading.destroy();
  }
}

async function performConversion(file: File, target: LocalTarget, quality: number): Promise<{ name: string; blob: Blob }[]> {
  const source = sourceType(file);
  if (!source || !localTargets(file).includes(target)) throw new ConversionError('Diese Konvertierung wird lokal nicht unterstützt.');
  if (file.size === 0) throw new ConversionError('Die Datei ist leer.');
  if (file.size > MAX_BYTES) throw new ConversionError('Die lokale Konvertierung unterstützt Dateien bis 30 MB.');
  if (!Number.isFinite(quality) || quality < 0 || quality > 1) throw new ConversionError('Die Bildqualität muss zwischen 0 und 1 liegen.');
  await validateSignature(file, source);
  const stem = file.name.replace(/\.[^.]+$/, '').replace(/[\/\\\u0000-\u001f]/g, '_') || 'converted';
  if (source === 'pdf') return convertPdf(file, target as Exclude<LocalTarget, 'pdf'>, quality, stem);
  return [{ name: `${stem}.${target}`, blob: await convertImage(file, source, target, quality) }];
}

export async function convertLocal(file: File, target: LocalTarget, quality: number): Promise<{ name: string; blob: Blob }[]> {
  try {
    return await performConversion(file, target, quality);
  } catch (error) {
    if (error instanceof ConversionError) throw error;
    throw new ConversionError('Die Datei konnte nicht konvertiert werden. Möglicherweise ist sie beschädigt oder enthält Inhalte, die dieser Browser nicht unterstützt.');
  }
}
