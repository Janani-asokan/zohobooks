import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';

export interface Fix { lat: number; lng: number; accuracy: number }

/** One location fix. Rejects with a message a shopkeeper can act on. */
export function getPosition(timeout = 20000, maxAge = 0): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('This device can’t share its location.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      (e) => reject(new Error(e.code === e.PERMISSION_DENIED ? 'Location is blocked. Allow location for this site in your browser settings, then try again.'
        : e.code === e.TIMEOUT ? 'Couldn’t get your location in time. Step outside or turn on GPS, then try again.' : 'Couldn’t get your location. Turn on GPS and try again.')),
      // Check-ins need a fresh fix (maxAge 0); background tracking can reuse one up to a minute old.
      { enableHighAccuracy: true, timeout, maximumAge: maxAge },
    );
  });
}

export interface FieldMe {
  day: { id: string; startedAt: string; endedAt: string | null } | null;
  visits: FieldVisit[];
  open: FieldVisit | null;
}
export interface FieldVisit {
  id: string; userId: string; userName: string; customerId: string | null; customerName: string; purpose: string; lat: number | null; lng: number | null; accuracy: number | null;
  checkedInAt: string; checkedOutAt: string | null; outcome: string; orderValue: number; collected: number; notes: string; nextVisit: string | null; minutes: number | null;
}
export const useFieldMe = () => useQuery({ queryKey: ['fieldMe'], queryFn: () => api.get<FieldMe>('/shop/field/me'), staleTime: 60_000 });

/**
 * While the day is started, send the location every 2 minutes as long as the app is open and visible.
 * Browsers pause this when the screen is off or the app is in the background; check-ins always record a fresh fix.
 */
export function useFieldTracker() {
  const me = useFieldMe();
  const onDuty = !!me.data?.day && !me.data.day.endedAt;
  useEffect(() => {
    if (!onDuty) return;
    let stopped = false;
    const send = async () => {
      if (stopped || document.visibilityState !== 'visible') return;
      try { const f = await getPosition(15000, 60000); await api.post('/shop/field/ping', f); } catch { /* try again next round */ }
    };
    void send();
    const t = window.setInterval(send, 120_000);
    const vis = () => document.visibilityState === 'visible' && void send();
    document.addEventListener('visibilitychange', vis);
    return () => { stopped = true; window.clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [onDuty]);
  return onDuty;
}
