// Focus — client bundle (hand-written, no build step).
// Loaded by DSH's module loader; React comes from the shared platform modules.
// A pomodoro / countdown timer. All timer state lives host-side with an absolute endAt, so the
// countdown stays correct across page reloads and DSH restarts. The client only renders it:
// it ticks locally (never re-fetching to count down) and fires one `complete` op at zero.
// Glass follows the wallpaper plugin through what it publishes on <body> — --wp-blur, --wp-tint
// and the wp-still class — and falls back to its own glass values when wallpaper is absent.
// The only network access is /api/focus/*; there are no external fonts or assets.
window.__ModuleLoader__.load({
	id: "dsh-plugin-focus",
	factory: (require) => {
		const React = require("react");
		const ReactDOM = require("react-dom");
		const h = React.createElement;
		const { useState, useEffect, useSyncExternalStore, Fragment } = React;
		const NS = "focus";
		const API = (typeof window !== "undefined" && window.__FOCUS_API__) || "/api/focus/"; // dev hook: point a test page at a local server

		// ------------------------------------------------------------ stores
		const createStore = (init) => {
			let value = init;
			const subs = new Set();
			return {
				get: () => value,
				set: (next) => { value = typeof next === "function" ? next(value) : next; subs.forEach((f) => f()); },
				sub: (f) => { subs.add(f); return () => subs.delete(f); },
			};
		};
		const useStore = (s) => useSyncExternalStore(s.sub, s.get, s.get);
		const stateS = createStore(null); // the host's { settings, timer, sessions }
		const uiS = createStore({ panel: false, toast: null });
		const nowS = createStore(Date.now()); // advanced by the local tick, so the countdown re-renders without a fetch
		const cx = (...a) => a.filter(Boolean).join(" ");
		// The host keeps an absolute endAt while running and the remaining time while idle; same rule, client side.
		const remainingOf = (t, now) => (t?.running ? Math.max(0, t.endAt - now) : Math.max(0, t?.remainingMs ?? 0));
		const fmtTime = (ms) => {
			const s = Math.max(0, Math.ceil(ms / 1000));
			const hh = Math.floor(s / 3600);
			const mm = Math.floor((s % 3600) / 60);
			const ss = s % 60;
			const two = (n) => String(n).padStart(2, "0");
			return (hh > 0 ? hh + ":" + two(mm) : String(mm)) + ":" + two(ss);
		};

		const api = async (path, body) => {
			const res = await fetch(API + path, body === undefined ? { credentials: "same-origin", cache: "no-store" } : { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
			const text = await res.text();
			try { return JSON.parse(text); } catch { return { error: text || "HTTP " + res.status }; }
		};
		let firedFor = null; // the endAt whose zero-crossing has already been handled — fire once per timer
		const refresh = {
			state: () => api("state").then((v) => { if (!v.error) { stateS.set(v); if (!v.timer?.running) firedFor = null; } }).catch(() => {}),
		};
		const toast = (text) => { const at = Date.now(); uiS.set((u) => ({ ...u, toast: { text, at } })); setTimeout(() => uiS.set((u) => (u.toast?.at === at ? { ...u, toast: null } : u)), 4000); };
		const op = async (o) => {
			const r = await api("state", { op: o });
			if (r?.error) { toast(String(r.error)); return false; }
			await refresh.state();
			return true;
		};

		// ------------------------------------------------------------ the tick and the end-of-session chime
		let audioCtx = null; // created lazily on the first user click; never on page load
		const ensureAudio = () => {
			if (audioCtx) return audioCtx;
			try {
				const AC = window.AudioContext || window.webkitAudioContext;
				if (AC) audioCtx = new AC();
			} catch (e) { audioCtx = null; }
			return audioCtx;
		};
		const chime = () => {
			const ac = audioCtx;
			if (!ac) return;
			try {
				if (ac.state === "suspended") ac.resume().catch(() => {});
				const t0 = ac.currentTime + 0.03;
				[[659.25, 0], [987.77, 0.16]].forEach(([freq, dt]) => { // two sine notes, a fifth apart
					const osc = ac.createOscillator();
					const gain = ac.createGain();
					osc.type = "sine";
					osc.frequency.value = freq;
					gain.gain.setValueAtTime(0.0001, t0 + dt);
					gain.gain.exponentialRampToValueAtTime(0.22, t0 + dt + 0.03);
					gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.55);
					osc.connect(gain);
					gain.connect(ac.destination);
					osc.start(t0 + dt);
					osc.stop(t0 + dt + 0.65);
				});
			} catch (e) { /* the chime is best-effort */ }
		};
		const tick = () => {
			const now = Date.now();
			nowS.set(now);
			const t = stateS.get()?.timer;
			// The countdown is pure local math; the only fetch here is the one-shot complete at zero.
			if (t?.running && t.endAt != null && t.endAt - now <= 0 && firedFor !== t.endAt) {
				firedFor = t.endAt;
				api("state", { op: { op: "complete" } }).catch(() => null)
					.then(() => refresh.state())
					.then(() => { toast("Focus session complete — take a break"); if (stateS.get()?.settings?.chime) chime(); });
			}
		};

		// ------------------------------------------------------------ icons and small parts
		const svg = (children, size = 18) => h("svg", { className: "fc-i", viewBox: "0 0 24 24", width: size, height: size, "aria-hidden": "true" }, ...children.map((c, i) => (typeof c === "string" ? h("path", { key: i, d: c }) : c)));
		const IC = {
			timer: (s) => svg([h("circle", { key: "c", cx: 12, cy: 14, r: 7.5 }), "M10 3h4M12 3v3.5", "M12 14V9.5"], s),
			x: (s) => svg(["M6 6l12 12M18 6L6 18"], s),
		};
		const KIND_LABEL = { focus: "Focus", short: "Short break", long: "Long break", custom: "Custom" };
		const Pill = ({ onClick, children, on, disabled }) => h("button", { type: "button", className: cx("fc-pill", on && "on"), onClick, disabled, "aria-pressed": on === undefined ? undefined : !!on }, children);
		const useEscape = (active, fn) => useEffect(() => {
			if (!active) return;
			const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); fn(); } };
			document.addEventListener("keydown", onKey, true);
			return () => document.removeEventListener("keydown", onKey, true);
		}, [active]);

		// ------------------------------------------------------------ the footer button
		const FocusButton = () => {
			const st = useStore(stateS);
			const running = !!st?.timer?.running;
			return h("button", { type: "button", className: "fc-footbtn", title: "Focus timer", "aria-label": "Focus timer" + (running ? " (running)" : ""), onClick: () => uiS.set((u) => ({ ...u, panel: true })) },
				IC.timer(18),
				running ? h("span", { className: "fc-dot", "aria-hidden": "true" }) : null);
		};

		// ------------------------------------------------------------ the panel
		const FocusPanel = () => {
			const ui = useStore(uiS);
			const st = useStore(stateS);
			const now = useStore(nowS);
			const [custom, setCustom] = useState("");
			const close = () => uiS.set((u) => ({ ...u, panel: false }));
			useEscape(!!ui.panel, close);
			useEffect(() => { if (ui.panel) refresh.state(); }, [ui.panel]);
			if (!ui.panel || !st) return null;
			const t = st.timer || {};
			const settings = st.settings || {};
			const total = Math.max(0, t.durationMs || 0);
			const rem = remainingOf(t, now);
			const running = !!t.running;
			const paused = !running && rem > 0 && rem < total;
			const frac = total > 0 ? Math.min(1, Math.max(0, rem / total)) : 0;
			const C = 2 * Math.PI * 80;
			const clampMin = (v, fallback) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 1 && n <= 180 ? n : fallback; };
			const focusMin = clampMin(settings.focusMin, 25);
			const shortMin = clampMin(settings.shortMin, 5);
			const longMin = clampMin(settings.longMin, 15);
			const presets = [["focus", focusMin], ["short", shortMin], ["long", longMin]];
			const customMin = Math.round(Number(custom));
			const customValid = custom !== "" && Number.isFinite(customMin) && customMin >= 1 && customMin <= 180;
			const applyCustom = () => { if (!customValid) return; op({ op: "set", kind: "custom", durationMs: customMin * 60000 }).then((ok) => { if (ok) setCustom(""); }); };
			const sessions = st.sessions?.focus ?? 0;
			const primary = running
				? { label: "Pause", run: () => op({ op: "pause" }) }
				: paused
					? { label: "Resume", run: () => op({ op: "resume" }) }
					: { label: "Start", run: () => op({ op: "start", kind: t.kind || "focus", durationMs: total > 0 ? total : focusMin * 60000 }) };
			return h("div", { className: "fc-modal-wrap", onClick: (e) => { if (e.target === e.currentTarget) close(); } },
				h("div", { role: "dialog", "aria-modal": "true", "aria-label": "Focus timer", className: "fc-modal fc-rise" },
					h("div", { className: "fc-row fc-between" },
						h("h2", null, KIND_LABEL[t.kind] || "Focus"),
						h("button", { type: "button", className: "fc-iconbtn", "aria-label": "Close", onClick: close }, IC.x(16))),
					h("div", { className: "fc-ringwrap" },
						h("svg", { className: "fc-ring", viewBox: "0 0 180 180", width: 180, height: 180, role: "img", "aria-label": fmtTime(rem) + (running ? " remaining" : "") },
							h("circle", { className: "fc-ring-track", cx: 90, cy: 90, r: 80 }),
							h("circle", { className: cx("fc-ring-arc", "fc-accent", running && "run"), cx: 90, cy: 90, r: 80, strokeDasharray: C, strokeDashoffset: C * (1 - frac), transform: "rotate(-90 90 90)" }),
							h("text", { className: "fc-ring-time", x: 90, y: 90, textAnchor: "middle", dominantBaseline: "central" }, fmtTime(rem)))),
					h("div", { className: "fc-row fc-wrap" },
						presets.map(([kind, min]) => h(Pill, { key: kind, on: t.kind === kind && total === min * 60000, onClick: () => op({ op: "set", kind, durationMs: min * 60000 }) }, (kind === "focus" ? "Focus " : kind === "short" ? "Short " : "Long ") + min))),
					h("div", { className: "fc-row" },
						h("input", { className: "fc-input", type: "number", min: 1, max: 180, inputMode: "numeric", "aria-label": "Custom minutes", placeholder: total >= 60000 ? String(Math.round(total / 60000)) : "25", value: custom, onChange: (e) => setCustom(e.target.value), onKeyDown: (e) => { if (e.key === "Enter") applyCustom(); } }),
						h("span", { className: "fc-meta fc-small" }, "min"),
						h("span", { className: "fc-flex" }),
						h(Pill, { disabled: !customValid, onClick: applyCustom }, "Apply")),
					h("div", { className: "fc-row" },
						h(Pill, { on: true, onClick: primary.run }, primary.label),
						h(Pill, { onClick: () => op({ op: "reset" }) }, "Reset")),
					h("div", { className: "fc-meta fc-small fc-center" }, sessions + " focus session" + (sessions === 1 ? "" : "s") + " today")));
		};

		const Toast = () => {
			const ui = useStore(uiS);
			if (!ui.toast) return null;
			return h("div", { className: "fc-toast fc-pop", role: "status" }, ui.toast.text);
		};

		// ------------------------------------------------------------ styles
		// Tokens follow DSH's colour mode (data-ds-dark-theme on <body>). The glass values come from
		// what wallpaper publishes (--wp-blur, --wp-tint, --wp-backdrop); the fallbacks keep the same
		// look when wallpaper is absent. Nothing here styles DSH's own elements.
		const CSS = `
.fc-modal-wrap,.fc-toast,.fc-footbtn{--fc-text:var(--wp-text,#ECEAE4);--fc-strong:var(--wp-strong,#DADDD7);--fc-meta:var(--wp-meta,#A9AEA8);--fc-accent:var(--wp-accent,#7FA7F5);--fc-accent-strong:var(--wp-accent-strong,#E4ECFD);--fc-line:rgba(255,255,255,.09);--fc-backdrop:var(--wp-backdrop,rgba(6,8,8,.45));--fc-pop:rgba(20,24,23,.95);--fc-shadow:rgba(0,0,0,.45);--fc-w05:rgba(255,255,255,.05);--fc-w07:rgba(255,255,255,.07);--fc-w08:rgba(255,255,255,.08);--fc-w10:rgba(255,255,255,.1);--fc-a14:rgba(127,167,245,.14);--fc-a45:rgba(127,167,245,.45);--fc-ease:cubic-bezier(.2,.7,.2,1)}
body:not([data-ds-dark-theme]) .fc-modal-wrap,body:not([data-ds-dark-theme]) .fc-toast,body:not([data-ds-dark-theme]) .fc-footbtn{--fc-text:var(--wp-text,#191E1B);--fc-strong:var(--wp-strong,#232926);--fc-meta:var(--wp-meta,#55605A);--fc-accent:var(--wp-accent,#3F6FD8);--fc-accent-strong:var(--wp-accent-strong,#1C45A8);--fc-line:rgba(0,0,0,.1);--fc-backdrop:var(--wp-backdrop,rgba(40,44,42,.22));--fc-pop:rgba(250,250,247,.97);--fc-shadow:rgba(0,0,0,.16);--fc-w05:rgba(20,26,22,.055);--fc-w07:rgba(20,26,22,.077);--fc-w08:rgba(20,26,22,.088);--fc-w10:rgba(20,26,22,.11);--fc-a14:rgba(63,111,216,.14);--fc-a45:rgba(63,111,216,.45)}
/* the footer button: same size and behaviour as wallpaper's .wp-footbtn */
.fc-footbtn{position:relative;width:32px;height:32px;border-radius:9px;display:inline-flex;align-items:center;justify-content:center;flex:none;background:transparent;border:0;padding:0;color:var(--fc-strong);cursor:pointer;transition:background .16s ease,color .16s ease}
.fc-footbtn:hover{background:var(--fc-w07);color:var(--fc-text)}
.fc-footbtn:focus-visible{outline:2px solid var(--fc-accent);outline-offset:2px}
.fc-i{fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;flex:none}
/* the running dot: a gentle pulse, static while Motion is off */
.fc-dot{position:absolute;top:4px;right:4px;width:7px;height:7px;border-radius:50%;background:var(--fc-accent);pointer-events:none;animation:fc-pulse 1.6s ease-in-out infinite}
/* the panel */
.fc-modal-wrap{position:fixed;inset:0;z-index:1000;background:var(--fc-backdrop);display:flex;align-items:flex-start;justify-content:center;padding:48px 16px;overflow:auto;pointer-events:auto}
.fc-modal{width:420px;max-width:100%;display:flex;flex-direction:column;gap:16px;padding:26px;border-radius:22px;background:rgba(14,18,17,var(--wp-tint,.55));backdrop-filter:blur(var(--wp-blur,22px)) saturate(140%);-webkit-backdrop-filter:blur(var(--wp-blur,22px)) saturate(140%);border:1px solid var(--fc-line);box-shadow:0 30px 60px var(--fc-shadow);color:var(--fc-text);font-family:Geist,system-ui,sans-serif;box-sizing:border-box}
body:not([data-ds-dark-theme]) .fc-modal{background:rgba(250,250,246,var(--wp-tint,.55))}
.fc-modal h2{margin:0;font-size:22px;font-weight:600;letter-spacing:-.02em}
.fc-iconbtn{width:40px;height:40px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;background:transparent;border:0;color:var(--fc-strong);cursor:pointer;flex:none;transition:background .16s ease}
.fc-iconbtn:hover{background:var(--fc-w07)}
.fc-iconbtn:focus-visible{outline:2px solid var(--fc-accent);outline-offset:2px}
/* the progress ring */
.fc-ringwrap{display:flex;justify-content:center}
.fc-ring{display:block;flex:none}
.fc-ring-track,.fc-ring-arc{fill:none;stroke-width:10}
.fc-ring-track{stroke:var(--fc-w07)}
.fc-ring-arc{stroke-linecap:round}
.fc-accent{stroke:var(--fc-accent)}
.fc-ring-arc.run{transition:stroke-dashoffset .9s linear}
body.wp-still .fc-ring-arc{transition:none}
.fc-ring-time{font-family:'Geist Mono',ui-monospace,monospace;font-size:40px;font-weight:500;fill:var(--fc-text)}
/* rows, pills, input */
.fc-row{display:flex;align-items:center;gap:8px;min-width:0}
.fc-between{justify-content:space-between}
.fc-wrap{flex-wrap:wrap}
.fc-flex{flex:1 1 auto}
.fc-center{justify-content:center;text-align:center}
.fc-meta{font-size:12.5px;color:var(--fc-meta);line-height:1.4}
.fc-small{font-size:11.5px}
.fc-pill{display:inline-flex;align-items:center;gap:7px;min-height:36px;padding:0 12px;border-radius:999px;border:1px solid var(--fc-w10);background:transparent;color:var(--fc-strong);font:inherit;font-size:13px;cursor:pointer;white-space:nowrap;box-sizing:border-box;transition:background .18s ease,border-color .18s ease,transform .12s ease}
.fc-pill:hover{background:var(--fc-w08)}
.fc-pill:active{transform:scale(.98)}
.fc-pill.on{background:var(--fc-a14);border-color:var(--fc-a45);color:var(--fc-accent-strong)}
.fc-pill:disabled{opacity:.45;cursor:default}
.fc-pill:disabled:hover{background:transparent}
.fc-pill:focus-visible{outline:2px solid var(--fc-accent);outline-offset:2px}
.fc-input{box-sizing:border-box;min-height:40px;width:96px;padding:8px 10px;border-radius:10px;background:var(--fc-w05);border:1px solid var(--fc-w10);color:var(--fc-text);font:inherit;font-size:14px;outline:none}
.fc-input:focus{border-color:var(--fc-a45)}
.fc-input::-webkit-outer-spin-button,.fc-input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
/* toast */
.fc-toast{position:fixed;right:24px;bottom:24px;z-index:1100;max-width:420px;padding:12px 16px;border-radius:14px;background:var(--fc-pop);border:1px solid var(--fc-w10);color:var(--fc-text);font:14px Geist,system-ui,sans-serif;box-shadow:0 18px 40px var(--fc-shadow);pointer-events:auto}
/* motion: none while Motion is off (body.wp-still) or macOS Reduce Motion is on */
.fc-rise{animation:fc-rise .32s var(--fc-ease) both}
.fc-pop{animation:fc-pop .16s var(--fc-ease) both}
@keyframes fc-rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes fc-pop{from{opacity:0;transform:translateY(4px) scale(.98)}to{opacity:1;transform:none}}
@keyframes fc-pulse{0%,100%{opacity:1}50%{opacity:.35}}
body.wp-still .fc-dot,body.wp-still .fc-rise,body.wp-still .fc-pop{animation:none!important}
@media (prefers-reduced-motion:reduce){.fc-rise,.fc-pop,.fc-dot{animation:none!important}.fc-ring-arc,.fc-ring-arc.run{transition:none}}
`;

		// ------------------------------------------------------------ install
		const installStyles = () => {
			const style = document.createElement("style");
			style.setAttribute("data-plugin", "dsh-plugin-focus");
			style.textContent = CSS;
			document.head.appendChild(style);
			return () => style.remove();
		};
		const startClock = () => { tick(); const iv = setInterval(tick, 1000); return () => clearInterval(iv); };
		const armAudio = () => {
			const onFirstClick = () => { ensureAudio(); document.removeEventListener("click", onFirstClick, true); };
			document.addEventListener("click", onFirstClick, true);
			return () => {
				document.removeEventListener("click", onFirstClick, true);
				if (audioCtx) { try { audioCtx.close(); } catch (e) { /* already closed */ } audioCtx = null; }
			};
		};

		// ------------------------------------------------------------ apply
		function apply(ctx) {
			ctx.effect(() => refresh.state(), "focus: settings");
			ctx.effect(() => installStyles(), "focus: style");
			ctx.effect(() => startClock(), "focus: tick");
			ctx.effect(() => armAudio(), "focus: audio");
			const reg = (slot, opts, comp) => ctx.slots.inject(slot, () => ctx.slots.register({ name: slot, locale: NS, ...opts }, comp));
			reg("sidebar.footer.action", { id: "fc-open", order: 91 }, FocusButton);
			reg("shell.overlay", { id: "fc-overlays", order: 41, inject: () => ({ ctx }) }, (props) => h(Fragment, null, h(FocusPanel, props), h(Toast, null)));
		}
		return { name: "dsh-plugin-focus", inject: ["slots", "locale"], apply };
	}
});
