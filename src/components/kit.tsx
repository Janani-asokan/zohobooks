import { useState, type ReactNode } from 'react';
import { Lightbulb, X } from 'lucide-react';
import { initials } from '@/lib/format';

/* Small shared building blocks for the v2 look: item thumbnails, module hints, image downscaling. */

const TILE = ['#5b5bf0', '#7b4ff0', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#8b5cf6', '#f97316'];
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);
export const tileColor = (seed: string) => TILE[Math.abs(hash(seed || '?')) % TILE.length]!;

export function Thumb({ name, image, size, large }: { name: string; image?: string; size?: number; large?: boolean }) {
  const c = tileColor(name);
  return (
    <span className={`thumb ${large ? 'lg' : ''}`} style={{ ...(size ? { width: size, height: size } : {}), background: image ? 'var(--ink-100)' : `linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 70%, #000))` }}>
      {image ? <img src={image} alt="" /> : initials(name || '?')}
    </span>
  );
}

const readHidden = (id: string) => {
  try {
    return localStorage.getItem(`ledgerly.hint.${id}`) === '1';
  } catch {
    return false;
  }
};

/** Dismissible "how this module works" banner. */
export function Hint({ id, title, children, icon: Icon = Lightbulb }: { id: string; title: string; children: ReactNode; icon?: typeof Lightbulb }) {
  const [hidden, setHidden] = useState(() => readHidden(id));
  if (hidden) return null;
  return (
    <div className="hint no-print" role="note">
      <span className="hint-icon"><Icon size={17} /></span>
      <div style={{ minWidth: 0 }}>
        <strong className="hint-title">{title}</strong>
        <div className="hint-body">{children}</div>
      </div>
      <button
        className="icon-btn hint-close"
        aria-label="Dismiss tip"
        title="Got it — hide this tip"
        onClick={() => {
          setHidden(true);
          try {
            localStorage.setItem(`ledgerly.hint.${id}`, '1');
          } catch {
            /* ignore */
          }
        }}
      >
        <X size={16} />
      </button>
    </div>
  );
}

export const resetHints = () => {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith('ledgerly.hint.')).forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
};

/** Downscale a picked image to a small JPEG data URL so it can be stored with the item. */
export function downscaleImage(file: File, max = 420, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('Please choose an image file'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the image'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Unsupported image'));
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

/** Read a localStorage flag safely. */
export function useLocalFlag(key: string, initial = false) {
  const [v, setV] = useState(() => {
    try {
      const s = localStorage.getItem(key);
      return s === null ? initial : s === '1';
    } catch {
      return initial;
    }
  });
  const set = (n: boolean) => {
    setV(n);
    try {
      localStorage.setItem(key, n ? '1' : '0');
    } catch {
      /* ignore */
    }
  };
  return [v, set] as const;
}
