import clsx from 'clsx';
import { useState } from 'react';
import { Users } from 'lucide-react';
import type { Conversation } from '@replyfinch/shared';
import { useAuth } from '../../lib/auth';
import { getSocket } from '../../lib/realtime';
import { useDesk } from '../../lib/store';
import { initials } from '../../lib/format';
import { useWidgetSettings } from '../../pages/settings/ChatWidget';
import { Avatar, Button, Modal, StatusDot, inputClass } from '../ui';

type Target = { agentId: string } | { department: string };

const ERRORS: Record<string, string> = {
  agent_offline: 'That agent just went offline. Pick someone else.',
  conversation_ended: 'This chat has already ended.',
};

/** Hand the chat to a teammate, or back to the queue for a department. */
export function TransferModal({ conversation, onClose }: { conversation: Conversation; onClose: () => void }) {
  const me = useAuth((s) => s.agent?.id);
  const allTeam = useDesk((s) => s.team);
  const team = allTeam.filter((t) => t.id !== me);
  const { data: settings } = useWidgetSettings();
  const [target, setTarget] = useState<Target | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    const res = await getSocket()
      ?.timeout(10_000)
      .emitWithAck('chat:transfer', {
        conversationId: conversation.id,
        ...('agentId' in target ? { toAgentId: target.agentId } : { department: target.department }),
        note: note.trim() || undefined,
      })
      .catch(() => null);
    setBusy(false);
    if (res?.ok) return onClose();
    setError((res && !res.ok && ERRORS[res.error]) || 'Could not transfer the chat. Please try again.');
  };

  const option = (selected: boolean, disabled = false, full = true) =>
    clsx(
      'flex items-center gap-3 rounded-lg border px-3 py-2 text-left',
      full && 'w-full',
      disabled ? 'cursor-default opacity-50' : 'cursor-pointer hover:bg-muted',
      selected ? 'border-primary bg-primary-subtle' : 'border-line',
    );

  return (
    <Modal title="Transfer chat" onClose={onClose}>
      <div className="flex flex-col gap-4 px-6 py-5">
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold">To a teammate</span>
          {team.length === 0 && <span className="text-sm text-ink-2">No one else is on your team yet.</span>}
          <div className="flex max-h-56 flex-col gap-1.5 overflow-y-auto" role="radiogroup" aria-label="Teammates">
            {team.map((t) => {
              const offline = t.status === 'offline';
              const selected = !!target && 'agentId' in target && target.agentId === t.id;
              return (
                <button
                  key={t.id}
                  role="radio"
                  aria-checked={selected}
                  disabled={offline}
                  onClick={() => setTarget({ agentId: t.id })}
                  className={option(selected, offline)}
                >
                  <span className="relative">
                    <Avatar text={initials(t.name)} size={30} />
                    <StatusDot status={t.status} className="absolute -right-0.5 -bottom-0.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{t.name}</span>
                    <span className="block text-xs text-ink-2 capitalize">{t.status}</span>
                  </span>
                  <span className="text-xs text-ink-2">
                    {t.activeChats}/{t.maxChats} chats
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {!!settings?.departments.length && (
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold">Or back to the queue for a department</span>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Departments">
              {settings.departments.map((d) => {
                const selected = !!target && 'department' in target && target.department === d;
                return (
                  <button key={d} role="radio" aria-checked={selected} onClick={() => setTarget({ department: d })} className={option(selected, false, false)}>
                    <Users className="size-3.5 text-ink-2" />
                    <span className="text-sm font-medium">{d}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">Note for your teammate (optional)</span>
          <textarea
            className={clsx(inputClass, 'h-auto py-2')}
            rows={2}
            maxLength={1000}
            placeholder="What have you tried so far?"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <span className="text-xs text-ink-2">Saved as an internal note. The visitor doesn’t see it.</span>
        </label>

        {error && (
          <div role="alert" className="text-sm font-medium text-danger">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!target || busy} onClick={submit}>
            {busy ? 'Transferring…' : 'Transfer'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
