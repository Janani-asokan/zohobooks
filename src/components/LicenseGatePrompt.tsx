import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { Field, Modal } from '@/components/ui';
import { fmtDate, money } from '@/lib/format';

export interface LicenseBlock {
  code: 'license_blocked' | 'license_capacity' | 'license_override_reason' | 'license_override_forbidden';
  message: string;
  details: {
    licenses?: Array<{ licenseId: string; licenseNumber: string; label: string; statusLabel: string; graceEnds: string }>;
    capacity?: Array<{ licenseId: string; licensed: number; billed: number; excess: number; overageRate: number; overageAmount: number; unit: string; suggestedCapacity: number }>;
    canOverride?: boolean;
    canBillOverage?: boolean;
  };
}
export type LicenseChoice = { licenseOverride?: { reason: string }; licenseOverage?: 'bill' | 'allow' };

export const isLicenseBlock = (code: string) => code.startsWith('license_');

/** Shown when issuing an invoice is stopped by a warehouse licence: bill the overage, override with a reason, or stop. */
export function LicenseGatePrompt({ block, onClose, onRetry }: { block: LicenseBlock; onClose: () => void; onRetry: (c: LicenseChoice) => void }) {
  const [reason, setReason] = useState('');
  const d = block.details ?? {};
  const cap = d.capacity?.[0];
  const reasonOk = reason.trim().length >= 10;
  const override = (): LicenseChoice => ({ licenseOverride: { reason: reason.trim() }, ...(cap && !d.licenses?.length ? { licenseOverage: 'allow' as const } : {}) });

  return (
    <Modal open title={cap ? 'Over the licensed capacity' : 'Licence not valid'} onClose={onClose}
      footer={<>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        {cap && d.canBillOverage && <button className="btn btn-primary" onClick={() => onRetry({ licenseOverage: 'bill' })}>Bill the overage ({money(cap.overageAmount)} + GST)</button>}
        {d.canOverride && <button className="btn btn-danger" disabled={!reasonOk} onClick={() => onRetry(override())}>Override and issue</button>}
      </>}>
      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <ShieldAlert size={20} style={{ color: 'var(--red-600)', flexShrink: 0, marginTop: 2 }} />
        <p style={{ margin: 0 }}>{block.message}</p>
      </div>
      {d.licenses && d.licenses.length > 0 && (
        <ul className="support-list" style={{ marginTop: 10 }}>
          {d.licenses.map((l) => (
            <li key={l.licenseId} className="small">
              <strong>{l.label} {l.licenseNumber}</strong> · {l.statusLabel}{l.statusLabel === 'Expired' ? ` (grace ended ${fmtDate(l.graceEnds)})` : ''}
              {' · '}<Link to={`/app/licenses/${l.licenseId}`} target="_blank">Open licence</Link>
            </li>
          ))}
        </ul>
      )}
      {cap && (
        <p className="small" style={{ marginTop: 10 }}>
          Billed <strong>{cap.billed}</strong> {cap.unit} · licensed {cap.licensed} · extra {cap.excess} at {money(cap.overageRate)} = {money(cap.overageAmount)}.
          {' '}To stop this happening, upgrade the licence to about {cap.suggestedCapacity} {cap.unit} from the <Link to={`/app/licenses/${cap.licenseId}`} target="_blank">licence page</Link>.
        </p>
      )}
      {d.canOverride ? (
        <Field label="Reason for overriding (kept in the audit trail)" hint="At least 10 characters, e.g. the renewal application number" className="span-all">
          <textarea className="textarea" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      ) : (
        <p className="small muted" style={{ marginTop: 10 }}>Only a Compliance Manager, Manager or the owner can override this.</p>
      )}
    </Modal>
  );
}
