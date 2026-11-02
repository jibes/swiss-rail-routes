import { useEffect, useRef, useState } from 'react';
import { keyFromScan } from '../core/sync';
import { useT } from '../store';
import { Icon } from './icons';

/** The browser's own reader where there is one (Android, macOS, ChromeOS). */
interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: {
      new (o: { formats: string[] }): Detector;
      getSupportedFormats(): Promise<string[]>;
    };
  }
}

export const canScan = () =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

type Read = (video: HTMLVideoElement) => Promise<string | null>;

/** A reader: BarcodeDetector if it knows QR codes, else jsQR on a downscaled frame. */
async function reader(): Promise<Read> {
  const BD = window.BarcodeDetector;
  if (BD && (await BD.getSupportedFormats().catch((): string[] => [])).includes('qr_code')) {
    const d = new BD({ formats: ['qr_code'] });
    return async (v) => (await d.detect(v))[0]?.rawValue ?? null;
  }
  const { default: jsQR } = await import('jsqr');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  return async (v) => {
    const k = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
    canvas.width = Math.round(v.videoWidth * k);
    canvas.height = Math.round(v.videoHeight * k);
    if (!canvas.width || !canvas.height) return null;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
  };
}

/**
 * The camera, reading QR codes until one holds a sync key (the app's link or a bare key).
 * Asks for the camera only when opened; stops it when closed.
 */
export function QrScanner({
  onKey,
  onClose,
}: {
  onKey: (key: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<'denied' | 'none' | 'other' | null>(null);
  const [wrong, setWrong] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
      } catch (e) {
        const name = e instanceof DOMException ? e.name : '';
        setProblem(
          name === 'NotAllowedError' ? 'denied' : name === 'NotFoundError' ? 'none' : 'other',
        );
        return;
      }
      if (stopped || !video.current) return stream.getTracks().forEach((x) => x.stop());
      video.current.srcObject = stream;
      await video.current.play().catch(() => undefined);
      let read: Read;
      try {
        read = await reader();
      } catch {
        // The decoder did not load (offline before it was ever used): stop the camera.
        stream.getTracks().forEach((x) => x.stop());
        setProblem('other');
        return;
      }
      const tick = async () => {
        if (stopped || !video.current) return;
        const text =
          video.current.readyState >= 2 ? await read(video.current).catch(() => null) : null;
        const key = text ? keyFromScan(text) : null;
        if (key) return onKey(key);
        if (text) setWrong(true);
        timer = setTimeout(() => void tick(), 200);
      };
      void tick();
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((x) => x.stop());
    };
  }, [onKey]);

  return (
    <div className="scanner">
      {problem ? (
        <p role="alert" className="notice red">
          {problem === 'denied'
            ? t('scanDenied')
            : problem === 'none'
              ? t('scanNoCamera')
              : t('scanFailed')}
        </p>
      ) : (
        <>
          <div className="viewfinder">
            <video ref={video} muted playsInline aria-label={t('scanCode')} />
            <span className="frame" aria-hidden="true" />
          </div>
          <p className="muted" aria-live="polite">
            {wrong ? t('scanWrong') : t('scanHint')}
          </p>
        </>
      )}
      <button type="button" className="text-button" onClick={onClose}>
        <Icon name="close" size={18} />
        {t('scanClose')}
      </button>
    </div>
  );
}
