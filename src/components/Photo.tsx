import { useState, type ReactNode } from 'react';

/**
 * A photo slot: shows /public/img/<file> when it exists, otherwise the drawn illustration.
 * Drop a real photo with the same name into public/img and it appears without code changes.
 */
export function Photo({ src, alt, fallback, className }: { src: string; alt: string; fallback: ReactNode; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return <img className={className} src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}

/** Hero illustration: a billing tablet with an invoice, coins, a parcel and a shopping bag. */
export function HeroArt() {
  return (
    <svg viewBox="0 0 520 520" className="lp-art" role="img" aria-label="Illustration of a tablet showing a GST invoice">
      <defs>
        <linearGradient id="ha-rose" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#b04d60" /><stop offset="1" stopColor="#d98290" /></linearGradient>
        <linearGradient id="ha-sage" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#7d8c77" /><stop offset="1" stopColor="#a2ae9d" /></linearGradient>
        <linearGradient id="ha-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#c98a3c" /><stop offset="1" stopColor="#e9c17a" /></linearGradient>
      </defs>
      <circle cx="260" cy="270" r="210" fill="#f0b8b8" opacity=".45" />
      <circle cx="260" cy="270" r="160" fill="#fbe3e5" />
      {/* parcel */}
      <g className="lp-bob" style={{ animationDelay: '-1s' }}>
        <rect x="70" y="300" width="120" height="104" rx="12" fill="#d8c3a5" />
        <rect x="70" y="300" width="120" height="30" rx="10" fill="#c8ae8a" />
        <rect x="122" y="300" width="16" height="104" fill="#f0e3cf" />
      </g>
      {/* tablet */}
      <g className="lp-bob">
        <rect x="170" y="110" width="210" height="300" rx="26" fill="#54463a" />
        <rect x="184" y="126" width="182" height="268" rx="16" fill="#fff" />
        <rect x="200" y="146" width="80" height="12" rx="6" fill="url(#ha-rose)" />
        <rect x="300" y="146" width="48" height="12" rx="6" fill="#eef2eb" />
        <rect x="200" y="172" width="148" height="8" rx="4" fill="#ece2d9" />
        <rect x="200" y="186" width="110" height="8" rx="4" fill="#ece2d9" />
        <rect x="200" y="212" width="148" height="26" rx="8" fill="#fbe9ea" />
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <rect x="200" y={250 + i * 30} width="92" height="9" rx="4" fill="#dccfc3" />
            <rect x="314" y={250 + i * 30} width="34" height="9" rx="4" fill="#b3a596" />
          </g>
        ))}
        <rect x="200" y="346" width="148" height="30" rx="10" fill="url(#ha-sage)" />
        <text x="274" y="366" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff" fontFamily="Poppins, sans-serif">₹ 4,955.00</text>
      </g>
      {/* coins */}
      <g className="lp-bob" style={{ animationDelay: '-2s' }}>
        <ellipse cx="410" cy="392" rx="40" ry="12" fill="#b07a2f" />
        <rect x="370" y="360" width="80" height="32" fill="url(#ha-gold)" />
        <ellipse cx="410" cy="360" rx="40" ry="12" fill="#f2d38f" />
        <ellipse cx="410" cy="342" rx="40" ry="12" fill="#b07a2f" />
        <rect x="370" y="318" width="80" height="24" fill="url(#ha-gold)" />
        <ellipse cx="410" cy="318" rx="40" ry="12" fill="#f2d38f" />
        <text x="410" y="324" textAnchor="middle" fontSize="16" fontWeight="700" fill="#8f5512">₹</text>
      </g>
      {/* bag */}
      <g className="lp-bob" style={{ animationDelay: '-3s' }}>
        <path d="M392 150c0-22 14-36 30-36s30 14 30 36" fill="none" stroke="#a9475a" strokeWidth="8" strokeLinecap="round" />
        <rect x="372" y="150" width="100" height="96" rx="16" fill="url(#ha-rose)" />
        <path d="M402 190l14 14 26-30" fill="none" stroke="#fff" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      {/* sparkles */}
      <g fill="#a2ae9d"><circle cx="110" cy="160" r="8" className="lp-twinkle" /><circle cx="460" cy="250" r="6" className="lp-twinkle" style={{ animationDelay: '-1.2s' }} /><circle cx="150" cy="440" r="5" className="lp-twinkle" style={{ animationDelay: '-.6s' }} /></g>
    </svg>
  );
}

/** Small scene for a "who it is for" card: a big icon on a soft gradient, used until a photo is added. */
export function SceneArt({ icon, tone }: { icon: ReactNode; tone: 'rose' | 'sage' | 'cocoa' }) {
  return <div className={`lp-scene lp-scene-${tone}`} aria-hidden="true"><span className="lp-scene-ring" /><span className="lp-scene-icon">{icon}</span></div>;
}
