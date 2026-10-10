// Scoped to the widget's shadow root, so host-page CSS can't leak in or out.
export const styles = `
:host { all: initial; }
* { box-sizing: border-box; font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.rf { --navy:#14213D; --gold:#FFC93C; --primary:#2F5BEA; --primary-subtle:#EAF0FE; --canvas:#F5F7FB;
  --surface:#fff; --muted:#F0F2F7; --border:#E3E7EF; --text:#121826; --text-2:#5B6475; --success:#1F9D55; --danger:#DC2626;
  --brand: var(--navy); --on-brand: #fff; --on-brand-2: #C7CFE2; --launcher-icon: var(--gold); --on-primary: #fff;
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483000; color: var(--text); font-size: 14px; line-height: 1.45; }
.rf.left { right: auto; left: 20px; }
.rf.left .panel { right: auto; left: 0; }
.launcher { width: 56px; height: 56px; border-radius: 28px; border: 0; cursor: pointer; background: var(--brand); color: var(--launcher-icon);
  display: grid; place-items: center; box-shadow: 0 8px 24px rgba(20,33,61,.28); position: relative; transition: transform .15s; }
.launcher:hover { transform: translateY(-2px); }
.badge[hidden] { display: none; }
.launcher svg { width: 26px; height: 26px; }
.badge { position: absolute; top: -2px; right: -2px; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px;
  background: var(--danger); color: #fff; font-size: 11px; font-weight: 700; display: grid; place-items: center; border: 2px solid #fff; }
.panel { position: absolute; right: 0; bottom: 72px; width: 370px; height: 580px; max-height: calc(100vh - 110px);
  background: var(--surface); border-radius: 18px; overflow: hidden; display: flex; flex-direction: column;
  box-shadow: 0 16px 48px rgba(20,33,61,.24); border: 1px solid var(--border); }
.panel[hidden] { display: none; }
.rf.popup { position: fixed; inset: 0; right: 0; bottom: 0; }
.rf.popup .panel { position: absolute; inset: 0; width: 100%; height: 100%; max-height: none; border-radius: 0; border: 0; box-shadow: none; }
.rf.popup .launcher { display: none; }
.popout { margin-left: auto; }
.popout + .close { margin-left: 0; }
.popped { margin: auto; text-align: center; display: flex; flex-direction: column; gap: 8px; align-items: stretch; padding: 24px 8px; }
.popped-title { font-weight: 700; font-size: 15px; }
.popped-text { color: var(--text-2); font-size: 13px; margin-bottom: 8px; }
@media (max-width: 480px) {
  .popout { display: none; }
  .popout + .close { margin-left: auto; }
  .rf { right: 12px; bottom: 12px; }
  .rf.left { right: auto; left: 12px; }
  .panel { position: fixed; inset: 0; width: auto; height: auto; max-height: none; border-radius: 0; }
}
.header { background: var(--brand); color: var(--on-brand); padding: 16px 16px 18px; display: flex; gap: 12px; align-items: center; }
.logo { width: 40px; height: 40px; border-radius: 12px; background: var(--gold); display: grid; place-items: center; flex: none; }
.logo svg { width: 22px; height: 22px; }
.title { font-weight: 700; font-size: 15px; }
.subtitle { font-size: 12px; color: var(--on-brand-2); display: flex; align-items: center; gap: 6px; }
.dot { width: 7px; height: 7px; border-radius: 4px; background: var(--success); display: inline-block; }
.dot.off { background: #9AA3B2; }
.close { margin-left: auto; background: transparent; border: 0; color: var(--on-brand-2); cursor: pointer; padding: 6px; border-radius: 8px; }
.close:hover { background: rgba(127,127,127,.18); color: var(--on-brand); }
.body { flex: 1; overflow-y: auto; background: var(--canvas); padding: 16px; display: flex; flex-direction: column; gap: 10px; }
form.prechat { display: flex; flex-direction: column; gap: 10px; }
.intro { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; color: var(--text-2); font-size: 13px; }
label { font-size: 12px; font-weight: 600; color: var(--text-2); display: flex; flex-direction: column; gap: 4px; }
input, select, textarea { font-size: 14px; color: var(--text); border: 1px solid var(--border); border-radius: 10px; padding: 9px 11px;
  background: var(--surface); outline: none; width: 100%; resize: none; }
input:focus, select:focus, textarea:focus { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-subtle); }
.btn { background: var(--primary); color: var(--on-primary); border: 0; border-radius: 10px; padding: 11px 14px; font-weight: 600; font-size: 14px; cursor: pointer; }
.btn:disabled { opacity: .6; cursor: default; }
.btn.ghost { background: transparent; color: var(--text-2); padding: 6px 8px; font-weight: 500; font-size: 12px; }
.error { color: var(--danger); font-size: 12px; }
.msg { display: flex; flex-direction: column; max-width: 82%; gap: 3px; }
.msg .meta { font-size: 11px; color: var(--text-2); }
.msg .bubble { padding: 9px 12px; border-radius: 14px; white-space: pre-wrap; word-wrap: break-word; }
.msg.visitor { align-self: flex-end; align-items: flex-end; }
.msg.visitor .bubble { background: var(--primary); color: var(--on-primary); border-bottom-right-radius: 4px; }
.msg.agent .bubble { background: var(--surface); border: 1px solid var(--border); border-bottom-left-radius: 4px; }
.msg.bot .bubble { background: var(--muted); border-bottom-left-radius: 4px; }
.msg.pending .bubble { opacity: .6; }
.system { align-self: center; font-size: 11px; color: var(--text-2); background: var(--muted); border-radius: 999px; padding: 3px 10px; }
.typing { font-size: 12px; color: var(--text-2); min-height: 18px; padding: 0 16px 4px; background: var(--canvas); }
.composer { border-top: 1px solid var(--border); padding: 10px; display: flex; gap: 8px; align-items: flex-end; background: var(--surface); }
.composer textarea { border-radius: 12px; max-height: 120px; }
.send { width: 40px; height: 40px; flex: none; border-radius: 12px; border: 0; background: var(--primary); color: var(--on-primary); cursor: pointer; display: grid; place-items: center; }
.send:disabled { opacity: .5; }
.footer { display: flex; justify-content: space-between; align-items: center; padding: 4px 10px 8px; background: var(--surface); font-size: 11px; color: var(--text-2); }
.footer b { color: var(--text); }
`;
