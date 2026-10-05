import clsx from 'clsx';
import { Maximize2, X } from 'lucide-react';
import { useDesk } from '../../lib/store';
import { visitorLabel } from '../../lib/format';

/** Minimized chat windows along the bottom of the screen (like Zendesk's chat tabs). */
export function ChatDock() {
  const tabs = useDesk((s) => s.openTabs);
  const visitors = useDesk((s) => s.visitors);
  const unread = useDesk((s) => s.unread);
  const active = useDesk((s) => s.active);
  const openChat = useDesk((s) => s.openChat);
  const closeChat = useDesk((s) => s.closeChat);
  if (!tabs.length) return null;
  return (
    <div className="absolute bottom-0 left-8 z-20 flex gap-1.5">
      {tabs.map((id) => {
        const v = visitors[id];
        if (!v) return null;
        const isActive = active?.visitorId === id;
        return (
          <div
            key={id}
            className={clsx(
              'flex items-center gap-2 rounded-t-[10px] py-2 pr-2 pl-3 text-[13px] font-semibold text-white',
              isActive ? 'bg-navy' : 'bg-navy-2',
            )}
          >
            <button onClick={() => openChat(id, 'side')} className="flex cursor-pointer items-center gap-2">
              <span className={clsx('size-2 rounded-full', v.left ? 'bg-offline' : 'bg-success')} />
              {visitorLabel(v)}
              {(unread[id] ?? 0) > 0 && (
                <span className="rounded-full bg-danger px-1.5 text-[10px] leading-4 font-bold">{unread[id]}</span>
              )}
              <Maximize2 className="size-3.5 text-on-navy" />
            </button>
            <button onClick={() => closeChat(id)} aria-label="Close chat" className="cursor-pointer rounded p-0.5 text-on-navy hover:text-white">
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
