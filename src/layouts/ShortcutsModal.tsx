import { Modal } from '@/components/ui';
import { SHORTCUT_HELP } from '@/components/useShortcuts';
import { usePrefs } from '@/context/PrefsContext';

export function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = usePrefs();
  return (
    <Modal open={open} onClose={onClose} title={t('shell.shortcuts')} subtitle="Work faster at the counter and the desk.">
      <div className="stack" style={{ gap: 0 }}>
        {SHORTCUT_HELP.map(([k, d]) => (
          <div key={k} className="row between" style={{ padding: '9px 0', borderBottom: '1px solid var(--ink-150)' }}>
            <span>{d}</span>
            <span className="row" style={{ gap: 4 }}>
              {k.split('  or  ').map((part, i) => (
                <span key={part} className="row" style={{ gap: 4 }}>
                  {i > 0 && <span className="small muted">or</span>}
                  {part.split(' ').map((p) => <kbd key={p} className="kbd">{p}</kbd>)}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
