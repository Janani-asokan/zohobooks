import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, BrainCircuit, CalendarClock, HeartPulse, IndianRupee, Lightbulb, Loader2, MapPinned, PackageX, RefreshCw, ShoppingCart, Snowflake, TrendingUp, Wallet, type LucideIcon } from 'lucide-react';
import { api } from '@/api/client';
import { usePrefs } from '@/context/PrefsContext';

interface Part { key: string; label: string; score: number; max: number; value: string; tip: string }
interface Health { score: number; grade: string; parts: Part[] }
interface Briefing {
  greeting: string; tip: string | null; method: 'ai' | 'rules'; cached?: boolean; date: string;
  actions: Array<{ ref: string; kind: 'collect' | 'reorder' | 'expiry' | 'followup' | 'clear'; title: string; detail: string; link: string; cta: string; phone?: string }>;
}
const KIND: Record<string, { icon: LucideIcon; tone: string }> = {
  collect: { icon: IndianRupee, tone: 'rose' }, reorder: { icon: ShoppingCart, tone: 'gold' }, expiry: { icon: CalendarClock, tone: 'violet' },
  followup: { icon: MapPinned, tone: 'sage' }, clear: { icon: Snowflake, tone: 'blue' },
};
const PART_ICON: Record<string, LucideIcon> = { collections: Wallet, cash: IndianRupee, growth: TrendingUp, stock: PackageX, margin: HeartPulse };
const LABEL = { en: { title: 'Today’s plan', sub: 'Written by AI from your books every morning', refresh: 'Refresh' }, hi: { title: 'आज की योजना', sub: 'हर सुबह आपके हिसाब से AI द्वारा तैयार', refresh: 'फिर से' }, ta: { title: 'இன்றைய திட்டம்', sub: 'உங்கள் கணக்குகளிலிருந்து AI தயாரித்தது', refresh: 'புதுப்பி' } };

/** Health score ring: 0–100, coloured by grade. */
function Gauge({ score, grade }: { score: number; grade: string }) {
  const r = 52; const c = 2 * Math.PI * r; const off = c * (1 - score / 100);
  const color = score >= 80 ? 'var(--green-600, #3d8b5a)' : score >= 60 ? '#7d8c77' : score >= 40 ? '#d08a2c' : 'var(--red-500)';
  return (
    <svg viewBox="0 0 128 128" className="hs-gauge" role="img" aria-label={`Business health ${score} out of 100, ${grade}`}>
      <circle cx="64" cy="64" r={r} fill="none" stroke="var(--ink-100)" strokeWidth="12" />
      <circle cx="64" cy="64" r={r} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 64 64)" className="hs-arc" />
      <text x="64" y="62" textAnchor="middle" className="hs-num">{score}</text>
      <text x="64" y="82" textAnchor="middle" className="hs-grade">{grade}</text>
    </svg>
  );
}

export function TodayPanel({ aiOn }: { aiOn: boolean }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { lang: uiLang } = usePrefs();
  const lang = (['en', 'hi', 'ta'].includes(uiLang) ? uiLang : 'en') as 'en' | 'hi' | 'ta';
  const L = LABEL[lang];
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.get<Health>('/shop/insights/health'), staleTime: 5 * 60_000 });
  const brief = useQuery({ queryKey: ['briefing', lang], queryFn: () => api.post<Briefing & { health: Health }>('/shop/ai/briefing', { lang }), staleTime: 30 * 60_000, retry: false });
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => setOpen(null), [lang]);
  const refresh = async () => {
    setRefreshing(true);
    try { const r = await api.post<Briefing>('/shop/ai/briefing', { lang, refresh: true }); qc.setQueryData(['briefing', lang], r); qc.invalidateQueries({ queryKey: ['health'] }); }
    catch { /* the card shows the last plan */ } finally { setRefreshing(false); }
  };
  const h = health.data;
  const b = brief.data;

  return (
    <section className="today">
      <div className="card hs-card">
        <div className="hs-head"><HeartPulse size={16} /> Business health</div>
        {!h ? <div className="skeleton" style={{ height: 150 }} /> : (
          <div className="hs-body">
            <Gauge score={h.score} grade={h.grade} />
            <ul className="hs-parts">
              {h.parts.map((p) => { const I = PART_ICON[p.key] ?? HeartPulse; return (
                <li key={p.key} onClick={() => setOpen(open === p.key ? null : p.key)} title={p.tip}>
                  <span className="hs-pi"><I size={13} /></span>
                  <span className="hs-pl">{p.label}</span>
                  <span className="hs-bar"><span style={{ width: `${(p.score / p.max) * 100}%` }} className={p.score < 10 ? 'low' : p.score < 15 ? 'mid' : ''} /></span>
                  <span className="hs-ps">{p.score}</span>
                  {open === p.key && <span className="hs-tip">{p.value}. {p.tip}</span>}
                </li>
              ); })}
            </ul>
          </div>
        )}
        {h && (() => { const weak = [...h.parts].sort((a, b) => a.score - b.score)[0]!; const I = PART_ICON[weak.key] ?? HeartPulse; return (
          <div className="hs-win"><span className="hs-win-ic"><I size={16} /></span><div><strong>Biggest win: {weak.label.toLowerCase()}</strong><div className="small">{weak.value}. {weak.tip}</div></div></div>
        ); })()}
        <div className="small muted" style={{ marginTop: 8 }}>Five checks, 20 points each, from your own books. Tap a row for details.</div>
      </div>

      <div className="card brief-card">
        <div className="brief-head">
          <span className="ai-badge"><BrainCircuit size={17} /></span>
          <div style={{ flex: 1, minWidth: 0 }}><h3>{L.title}</h3><p className="small muted">{aiOn ? L.sub : 'Your most useful jobs for today, from your books'}</p></div>
          <button className="icon-btn" onClick={refresh} disabled={refreshing} title={L.refresh} aria-label={L.refresh}>{refreshing ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}</button>
        </div>
        {brief.isLoading ? <div className="stack" style={{ gap: 8 }}><div className="skeleton" style={{ height: 18, width: '70%' }} /><div className="skeleton" style={{ height: 56 }} /><div className="skeleton" style={{ height: 56 }} /></div>
          : brief.isError ? <div className="small muted"><AlertTriangle size={13} /> {(brief.error as Error).message}</div>
          : b && (
            <>
              <p className="brief-greet">{b.greeting}</p>
              {b.actions.length === 0 ? <div className="small muted">Nothing urgent today. A good day to add new items or call your best customers.</div> : (
                <ol className="brief-list">
                  {b.actions.map((a, i) => { const k = KIND[a.kind] ?? KIND.collect!; return (
                    <li key={a.ref} style={{ animationDelay: `${i * 70}ms` }}>
                      <span className={`brief-ic tone-${k.tone}`}><k.icon size={16} /></span>
                      <div style={{ flex: 1, minWidth: 0 }}><strong>{a.title}</strong>{a.detail && <div className="small muted">{a.detail}</div>}</div>
                      <button className="btn btn-soft btn-sm" onClick={() => navigate(a.kind === 'collect' ? `${a.link}?remind=1` : a.link)}>{a.cta} <ArrowRight size={13} /></button>
                    </li>
                  ); })}
                </ol>
              )}
              {b.tip && <div className="brief-tip"><Lightbulb size={14} /> {b.tip}</div>}
            </>
          )}
      </div>
    </section>
  );
}
