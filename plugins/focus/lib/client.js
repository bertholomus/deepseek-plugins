// Focus — client bundle (hand-written, no build step).
// Loaded by DSH's module loader; React and DSH's parts come from the shared platform modules.
// A pomodoro / countdown timer. All timer state lives host-side with an absolute endAt, so the
// countdown stays correct across page reloads and DSH restarts, and the host ends a timer itself.
// The window only shows it: it ticks locally, reads the host's state every few seconds while the
// window is visible (only a changed revision redraws), and says so when a timer ends.
// It draws with DSH's own parts (Modal, Button, Switch, Input, Toast, Tooltip) and tokens, reads only
// --wp-blur, --wp-tint and body.wp-still from Wallpaper (here: wp-still), and its only network access
// is /api/focus/*.
if (typeof window !== "undefined" && window.__ModuleLoader__) window.__ModuleLoader__.load({
	id: "dsh-plugin-focus",
	factory: (require) => {
		const React = require("react");
		const ui = require("@deepseek-ai/dsh-client-ui-primitives");
		// A part is there or not; it may be a function or an object (a forwardRef or memo part).
		const has = (name) => ui != null && ui[name] != null;
		const h = React.createElement;
		const { useState, useEffect, useSyncExternalStore, Fragment } = React;
		const BUNDLE = "dsh-plugin-focus";
		const NS = "focus";
		const IDS = { open: `${BUNDLE}:open`, overlay: `${BUNDLE}:overlay` };
		const API = (typeof window !== "undefined" && window.__FOCUS_API__) || "/api/focus/"; // dev hook: point a test page at a local server
		const POLL_MS = 5000;
		const LATE_MS = 60000; // a timer that ended longer ago than this is said with its time, without the chime
		const MIN = 1;
		const MAX = 180;

		// ------------------------------------------------------------ words
		const KIND = { focus: "Focus", short: "Short break", long: "Long break", custom: "Custom" };
		const TEXT = {
			button: "Focus timer",
			title: "Focus timer",
			close: "Close",
			loading: "Reading the timer…",
			unreachable: (why) => `Focus can't reach its timer: ${why}. Check that the Focus plugin is on in Plugins, then try again.`,
			stale: (why) => `Focus can't reach its timer right now (${why}); this may be out of date. It tries again every few seconds.`,
			retry: "Try again",
			start: "Start", pause: "Pause", resume: "Resume", reset: "Reset",
			startNext: (kind) => (kind === "focus" ? "Start focus" : kind === "long" ? "Start long break" : "Start short break"),
			lengths: "Length",
			custom: "Custom",
			customLabel: "Custom length in minutes",
			set: "Set",
			minutes: "min",
			runningHint: "Pause or reset to choose another length.",
			rangeHint: `From ${MIN} to ${MAX} minutes.`,
			chime: "Chime when a timer ends",
			presetsTitle: "Preset lengths (minutes)",
			sessions: (n) => (n === 0 ? "No focus sessions yet today" : n === 1 ? "1 focus session today" : `${n} focus sessions today`),
			done: { focus: "Focus session done. Time for a break.", short: "Break over. Ready to focus?", long: "Break over. Ready to focus?", custom: "Timer done." },
			doneAt: (kind, at) => `${kind} timer ended at ${at}.`,
			notChanged: (why) => `Not changed: ${why}`,
		};
		const clock = (ms) => { try { return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); } catch (e) { return ""; } };
		const fmtTime = (ms) => {
			const s = Math.max(0, Math.ceil(ms / 1000));
			const hh = Math.floor(s / 3600);
			const mm = Math.floor((s % 3600) / 60);
			const ss = s % 60;
			const two = (n) => String(n).padStart(2, "0");
			return (hh > 0 ? hh + ":" + two(mm) : String(mm)) + ":" + two(ss);
		};
		// Said in whole minutes, so a screen reader's label changes once a minute, not every second.
		const spoken = (ms) => { const m = Math.max(1, Math.ceil(ms / 60000)); return m === 1 ? "1 minute" : `${m} minutes`; };

		// ------------------------------------------------------------ stores
		const createStore = (init) => {
			let value = init;
			const subs = new Set();
			return {
				get: () => value,
				set: (next) => { const v = typeof next === "function" ? next(value) : next; if (Object.is(v, value)) return; value = v; subs.forEach((f) => f()); },
				sub: (f) => { subs.add(f); return () => subs.delete(f); },
			};
		};
		const useStore = (s) => useSyncExternalStore(s.sub, s.get, s.get);
		const stateS = createStore(null); // the host's { settings, timer, sessions, rev, problems }
		const loadS = createStore({ error: null }); // why the last read failed, in words
		const uiS = createStore({ panel: false, busy: false, toast: null });
		const nowS = createStore(Date.now()); // advanced by the local tick, so the countdown redraws without a fetch
		const cx = (...a) => a.filter(Boolean).join(" ");
		// The host keeps an absolute endAt while running and the remaining time while idle; same rule, client side.
		const remainingOf = (t, now) => (t?.running ? Math.max(0, t.endAt - now) : Math.max(0, t?.remainingMs ?? 0));
		const phaseOf = (t, now) => {
			if (!t) return "ready";
			if (t.running) return "running";
			const rem = remainingOf(t, now);
			if (rem > 0 && rem < t.durationMs) return "paused";
			return t.doneAt && !t.running && rem === t.durationMs ? "done" : "ready";
		};

		/** The pomodoro's next step after a timer of `kind` ended: { kind, min }, or null for a custom timer. */
		const nextOf = (kind, settings, focusToday) => {
			if (kind === "focus") return focusToday > 0 && focusToday % 4 === 0 ? { kind: "long", min: settings.longMin || 15 } : { kind: "short", min: settings.shortMin || 5 };
			if (kind === "short" || kind === "long") return { kind: "focus", min: settings.focusMin || 25 };
			return null;
		};

		// ------------------------------------------------------------ the host
		const api = async (path, body) => {
			let res;
			try {
				res = await fetch(API + path, body === undefined
					? { credentials: "same-origin", cache: "no-store" }
					: { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
			} catch (e) {
				return { ok: false, error: "the window has no connection to DSH" };
			}
			let value = null;
			try { value = JSON.parse(await res.text()); } catch (e) { value = null; }
			if (!res.ok || !value || value.error) {
				const why = (value && value.error) || (res.status === 404 || !value ? "the plugin's host side is not answering" : `DSH answered ${res.status}`);
				return { ok: false, status: res.status, error: why };
			}
			return { ok: true, value };
		};
		let seenDone; // the doneAt already shown; undefined until the first read, which never announces
		let toastSeq = 0;
		const toast = (text, tone) => uiS.set((u) => ({ ...u, toast: { text, tone, seq: ++toastSeq } }));
		/** A new state from the host: kept when its revision moved; a timer that ended since the last one is said. */
		const take = (v) => {
			const old = stateS.get();
			if (!old || old.rev !== v.rev || JSON.stringify(old.problems) !== JSON.stringify(v.problems)) stateS.set(v);
			loadS.set((l) => (l.error === null ? l : { error: null }));
			const done = v.timer && !v.timer.running ? v.timer.doneAt : null;
			if (seenDone !== undefined && done && done !== seenDone) {
				// Seen at once (the window was open): said and chimed. Seen later (the window was hidden): said with its time.
				const late = Date.now() - done > LATE_MS;
				toast(late ? TEXT.doneAt(KIND[v.timer.kind] || KIND.custom, clock(done)) : TEXT.done[v.timer.kind] || TEXT.done.custom, "success");
				if (!late && v.settings && v.settings.chime) chime();
			}
			if (seenDone === undefined || done) seenDone = done || seenDone || null;
		};
		const refresh = async () => {
			const r = await api("state");
			if (r.ok) take(r.value);
			else loadS.set({ error: r.error });
			return r.ok;
		};
		/** One op (and maybe a settings patch); a refusal comes back as a banner, in the host's words. */
		const send = async (body) => {
			uiS.set((u) => ({ ...u, busy: true }));
			const r = await api("state", body);
			uiS.set((u) => ({ ...u, busy: false }));
			if (!r.ok) { toast(TEXT.notChanged(r.error), "warning"); return false; }
			take(r.value);
			return true;
		};
		const op = (o) => send({ op: o });

		// ------------------------------------------------------------ the chime
		let audioCtx = null; // created lazily on the first click in the window; never on page load
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

		// ------------------------------------------------------------ the tick and the reads
		let nudged = null; // the endAt the host was already asked about
		const tick = () => {
			const now = Date.now();
			nowS.set(now);
			const t = stateS.get()?.timer;
			// The host ends the timer itself; at zero the window asks it to check now, once, so the end shows at once.
			if (t?.running && t.endAt != null && t.endAt - now <= 0 && nudged !== t.endAt) {
				nudged = t.endAt;
				send({ op: { op: "complete" } });
			}
		};
		const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";

		// ------------------------------------------------------------ icons
		const svg = (children, size = 18) => h("svg", { className: "fc-i", viewBox: "0 0 24 24", width: size, height: size, "aria-hidden": "true", focusable: "false" }, ...children.map((c, i) => (typeof c === "string" ? h("path", { key: i, d: c }) : c)));
		const timerIcon = (s) => svg([h("circle", { key: "c", cx: 12, cy: 14, r: 7.5 }), "M10 3h4M12 3v3.5", "M12 14V9.5"], s);

		// ------------------------------------------------------------ the footer button
		let opener = null; // what had the focus when the panel opened; it gets it back on close
		const openPanel = (from) => {
			opener = from || (typeof document !== "undefined" ? document.activeElement : null);
			uiS.set((u) => ({ ...u, panel: true }));
			refresh();
		};
		const closePanel = () => {
			uiS.set((u) => ({ ...u, panel: false }));
			const back = opener;
			opener = null;
			if (back && typeof back.focus === "function") setTimeout(() => { try { if (back.isConnected !== false) back.focus(); } catch (e) {} }, 0);
		};
		const FocusButton = () => {
			const st = useStore(stateS);
			const now = useStore(nowS);
			const t = st?.timer;
			const phase = phaseOf(t, now);
			const label = phase === "running" ? `${TEXT.button}: ${KIND[t.kind] || KIND.focus}, ${spoken(remainingOf(t, now))} left`
				: phase === "paused" ? `${TEXT.button}: paused, ${spoken(remainingOf(t, now))} left` : TEXT.button;
			const tip = phase === "running" ? `${KIND[t.kind] || KIND.focus} · ${fmtTime(remainingOf(t, now))} left` : phase === "paused" ? `Paused · ${fmtTime(remainingOf(t, now))} left` : TEXT.button;
			const button = h("button", { type: "button", className: "fc-footbtn", "aria-label": label, "aria-haspopup": "dialog", "data-focus-open": "", onClick: (e) => openPanel(e.currentTarget) },
				timerIcon(18),
				phase === "running" ? h("span", { className: "fc-dot", "aria-hidden": "true" }) : phase === "paused" ? h("span", { className: "fc-dot fc-dot-paused", "aria-hidden": "true" }) : null);
			return has("Tooltip") ? h(ui.Tooltip, { label: tip, side: "top" }, button) : button;
		};

		// ------------------------------------------------------------ the panel: DSH's own dialog
		const Btn = (props, label) => (has("Button") ? h(ui.Button, props, label) : h("button", { type: "button", className: "fc-btn", ...props }, label));

		const MinutesField = ({ label, value, onCommit, disabled, field }) => {
			const [draft, setDraft] = useState(String(value));
			const [bad, setBad] = useState(false);
			useEffect(() => { setDraft(String(value)); setBad(false); }, [value]);
			const commit = () => {
				const n = Number(draft);
				if (draft.trim() === "" || !Number.isFinite(n) || Math.round(n) < MIN || Math.round(n) > MAX) { setBad(true); return; }
				setBad(false);
				if (Math.round(n) !== value) onCommit(Math.round(n));
			};
			const input = has("Input") ? ui.Input : "input";
			return h("label", { className: "fc-field" },
				h("span", { className: "fc-field-name" }, label),
				h(input, { type: "number", min: MIN, max: MAX, step: 1, inputMode: "numeric", className: cx("fc-num", bad && "fc-bad"), value: draft, disabled, "aria-invalid": bad || undefined, "data-focus-field": field,
					onChange: (e) => { setDraft(e.target.value); setBad(false); },
					onBlur: commit,
					onKeyDown: (e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } } }));
		};

		const FocusPanel = () => {
			const u = useStore(uiS);
			const st = useStore(stateS);
			const load = useStore(loadS);
			const now = useStore(nowS);
			const [custom, setCustom] = useState("");
			if (!u.panel) return null;
			const modal = (body, footer) => h(ui.Modal, { open: true, title: TEXT.title, closeLabel: TEXT.close, onClose: closePanel, className: "fc-dialog", footer }, h("div", { className: "fc-body", "data-focus-panel": "" }, body));
			if (!st) {
				return modal(load.error
					? h("div", { className: "fc-note fc-error", role: "alert", "data-focus-error": "" }, TEXT.unreachable(load.error))
					: h("p", { className: "fc-state" }, TEXT.loading),
				load.error ? Btn({ variant: "primary", onClick: () => refresh(), "data-modal-autofocus": true }, TEXT.retry) : null);
			}
			const t = st.timer || {};
			const settings = st.settings || {};
			const sessions = st.sessions?.focus ?? 0;
			const total = Math.max(0, t.durationMs || 0);
			const rem = remainingOf(t, now);
			const phase = phaseOf(t, now);
			const running = phase === "running";
			const frac = total > 0 ? Math.min(1, Math.max(0, rem / total)) : 0;
			const C = 2 * Math.PI * 80;
			const presets = [["focus", settings.focusMin || 25], ["short", settings.shortMin || 5], ["long", settings.longMin || 15]];
			const customMin = Math.round(Number(custom));
			const customValid = custom.trim() !== "" && Number.isFinite(customMin) && customMin >= MIN && customMin <= MAX;
			const busy = u.busy;
			const lockLength = running || busy;
			const applyCustom = () => { if (customValid && !lockLength) send({ op: { op: "set", kind: "custom", durationMs: customMin * 60000 } }).then((ok) => { if (ok) setCustom(""); }); };
			const stateLine = phase === "running" ? `${KIND[t.kind] || KIND.focus} · running, ends at ${clock(t.endAt)}`
				: phase === "paused" ? `${KIND[t.kind] || KIND.focus} · paused, ${fmtTime(rem)} left`
					: phase === "done" ? `${KIND[t.kind] || KIND.focus} · done at ${clock(t.doneAt)}`
						: `${KIND[t.kind] || KIND.focus} · ready, ${fmtTime(total)}`;
			// After a timer ends, the main button offers the pomodoro's next step: a break after focus (a long one
			// after every fourth session today), focus after a break; a custom timer offers itself again.
			const next = phase === "done" ? nextOf(t.kind, settings, sessions) : null;
			const primary = running ? { label: TEXT.pause, run: () => op({ op: "pause" }) }
				: phase === "paused" ? { label: TEXT.resume, run: () => op({ op: "resume" }) }
					: next ? { label: TEXT.startNext(next.kind), run: () => op({ op: "start", kind: next.kind, durationMs: next.min * 60000 }) }
						: { label: TEXT.start, run: () => op({ op: "start", kind: t.kind || "focus", durationMs: total > 0 ? total : 25 * 60000 }) };
			// A preset's new length also applies to the idle timer of that kind when it was not started.
			const savePreset = (kind, key) => (n) => {
				const body = { settings: { [key]: n } };
				if (!t.running && t.kind === kind && rem === total) body.op = { op: "set", kind, durationMs: n * 60000 };
				send(body);
			};
			const problems = Array.isArray(st.problems) ? st.problems : [];
			return modal([
				load.error ? h("div", { key: "stale", className: "fc-note fc-error", role: "status", "data-focus-stale": "" }, TEXT.stale(load.error)) : null,
				h("p", { key: "state", className: "fc-state", "aria-live": "polite", "data-focus-state": phase }, stateLine),
				h("div", { key: "ring", className: "fc-ringwrap" },
					h("svg", { className: "fc-ring", viewBox: "0 0 180 180", width: 180, height: 180, "aria-hidden": "true", focusable: "false" },
						h("circle", { className: "fc-ring-track", cx: 90, cy: 90, r: 80 }),
						h("circle", { className: cx("fc-ring-arc", running && "fc-run"), cx: 90, cy: 90, r: 80, strokeDasharray: C, strokeDashoffset: C * (1 - frac), transform: "rotate(-90 90 90)" })),
					h("div", { className: "fc-time", "data-focus-time": "" }, fmtTime(rem))),
				h("div", { key: "presets", className: "fc-row fc-wrap", role: "group", "aria-label": TEXT.lengths },
					presets.map(([kind, min]) => Btn({ key: kind, variant: t.kind === kind && total === min * 60000 ? "primary" : "outline", disabled: lockLength, "aria-pressed": t.kind === kind && total === min * 60000, "data-focus-preset": kind, onClick: () => op({ op: "set", kind, durationMs: min * 60000 }) }, `${KIND[kind]} ${min} ${TEXT.minutes}`)),
					h("span", { className: "fc-row fc-custom" },
						h(has("Input") ? ui.Input : "input", { type: "number", min: MIN, max: MAX, step: 1, inputMode: "numeric", className: "fc-num", "aria-label": TEXT.customLabel, placeholder: TEXT.custom, value: custom, disabled: lockLength, "data-focus-custom": "",
							onChange: (e) => setCustom(e.target.value), onKeyDown: (e) => { if (e.key === "Enter") { e.preventDefault(); applyCustom(); } } }),
						Btn({ variant: "outline", disabled: !customValid || lockLength, onClick: applyCustom, "data-focus-custom-set": "" }, TEXT.set))),
				running ? h("p", { key: "hint", className: "fc-meta" }, TEXT.runningHint) : custom.trim() !== "" && !customValid ? h("p", { key: "hint", className: "fc-meta fc-error" }, TEXT.rangeHint) : null,
				h("p", { key: "sessions", className: "fc-meta", "data-focus-sessions": "" }, TEXT.sessions(sessions)),
				h("div", { key: "settings", className: "fc-settings" },
					// DSH's Switch has no text of its own: its words sit beside it, in a label, so a click on them switches it too.
					h("label", { className: "fc-row fc-switch", "data-focus-chime": "" },
						h("span", { className: "fc-switch-text" }, TEXT.chime),
						has("Switch")
							? h(ui.Switch, { checked: settings.chime !== false, label: TEXT.chime, disabled: busy, onChange: (on) => send({ settings: { chime: !!on } }) })
							: h("input", { type: "checkbox", checked: settings.chime !== false, disabled: busy, onChange: (e) => send({ settings: { chime: e.target.checked } }) })),
					h("div", { className: "fc-fields", role: "group", "aria-label": TEXT.presetsTitle },
						h("span", { className: "fc-meta" }, TEXT.presetsTitle),
						h(MinutesField, { label: KIND.focus, field: "focusMin", value: settings.focusMin || 25, disabled: busy, onCommit: savePreset("focus", "focusMin") }),
						h(MinutesField, { label: KIND.short, field: "shortMin", value: settings.shortMin || 5, disabled: busy, onCommit: savePreset("short", "shortMin") }),
						h(MinutesField, { label: KIND.long, field: "longMin", value: settings.longMin || 15, disabled: busy, onCommit: savePreset("long", "longMin") }))),
				problems.length ? h("div", { key: "problems", className: "fc-note fc-error", role: "status", "data-focus-problems": "" }, problems.join(" ")) : null,
			], h(Fragment, null,
				Btn({ variant: "outline", disabled: busy || (phase === "ready" && rem === total), onClick: () => op({ op: "reset" }), "data-focus-reset": "" }, TEXT.reset),
				Btn({ variant: "primary", disabled: busy, onClick: primary.run, "data-modal-autofocus": true, "data-focus-primary": "" }, primary.label)));
		};

		const Banner = () => {
			const u = useStore(uiS);
			if (!u.toast || !has("Toast")) return null;
			const warn = u.toast.tone === "warning";
			const icon = warn && has("IconWarningOutlineRegular") ? h(ui.IconWarningOutlineRegular, { size: 16 }) : undefined;
			return h(ui.Toast, { key: `focus:${u.toast.seq}`, text: u.toast.text, holdMs: warn ? 8000 : 6000, ...(warn ? (icon ? { icon } : {}) : { tone: "success" }),
				onDone: () => uiS.set((x) => (x.toast && x.toast.seq === u.toast.seq ? { ...x, toast: null } : x)) });
		};

		// ------------------------------------------------------------ styles
		// DSH's tokens for every colour, font, corner and duration; nothing on :root, html or body, and no ground
		// of Focus's own: the footer button sits in DSH's sidebar and the panel is DSH's dialog.
		const RING = "var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))";
		const ROOTS = ".fc-footbtn,.fc-body";
		const CSS = `
.fc-footbtn{position:relative;width:32px;height:32px;border-radius:var(--dsw-radius-sm,8px);display:inline-flex;align-items:center;justify-content:center;flex:none;background:transparent;border:0;padding:0;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background var(--ds-transition-duration,.2s) var(--ds-ease-in-out,ease),color var(--ds-transition-duration,.2s) var(--ds-ease-in-out,ease)}
.fc-footbtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.fc-footbtn:active{background:var(--dsw-alias-interactive-bg-active)}
.fc-footbtn:focus-visible{outline:2px solid ${RING};outline-offset:2px}
.fc-i{fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;flex:none}
.fc-dot{position:absolute;top:5px;right:5px;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-business-primary);pointer-events:none;animation:fc-pulse 1.6s ease-in-out infinite}
.fc-dot.fc-dot-paused{background:var(--dsw-alias-label-tertiary);animation:none}
.fc-body{display:flex;flex-direction:column;gap:14px;min-width:0;color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14)}
.fc-state{margin:0;font:var(--dsw-font-s-strong-14,var(--dsw-font-s-14));color:var(--dsw-alias-label-primary)}
.fc-ringwrap{position:relative;display:flex;justify-content:center;align-items:center;height:180px}
.fc-ring{display:block;flex:none}
.fc-ring-track,.fc-ring-arc{fill:none;stroke-width:10}
.fc-ring-track{stroke:var(--dsw-alias-border-l2)}
.fc-ring-arc{stroke:var(--dsw-alias-state-business-primary);stroke-linecap:round}
.fc-ring-arc.fc-run{transition:stroke-dashoffset .9s linear}
/* the clock face: DSH's font at a display size, which DSH's type ladder (24px at most) does not have */
.fc-time{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:500 40px/1 var(--dsw-font-family);font-variant-numeric:tabular-nums;letter-spacing:-.01em;color:var(--dsw-alias-label-primary)}
.fc-row{display:flex;align-items:center;gap:8px;min-width:0}
.fc-wrap{flex-wrap:wrap}
.fc-custom{flex:1 1 150px}
.fc-num{width:84px;box-sizing:border-box;font-variant-numeric:tabular-nums}
input.fc-num{min-height:36px;padding:6px 10px;border-radius:var(--dsw-radius-md,12px);border:.5px solid var(--dsw-alias-border-l4);background:transparent;color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14)}
input.fc-num:focus-visible,.fc-num input:focus-visible{outline:2px solid ${RING};outline-offset:1px}
.fc-bad,.fc-bad input{border-color:var(--dsw-alias-state-error-primary)}
.fc-meta{margin:0;font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-secondary)}
.fc-error{color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 85%,var(--dsw-alias-label-primary))}
.fc-note{font:var(--dsw-font-xs-13);padding:10px 12px;border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-bg-layer-2,transparent)}
.fc-settings{display:flex;flex-direction:column;gap:10px;padding-top:12px;border-top:.5px solid var(--dsw-alias-border-l3)}
.fc-switch{justify-content:space-between;cursor:pointer}
.fc-switch-text{font:var(--dsw-font-s-14);color:var(--dsw-alias-label-primary)}
.fc-fields{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px}
.fc-fields>.fc-meta{flex:1 0 100%}
.fc-field{display:inline-flex;align-items:center;gap:6px;font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-secondary)}
.fc-field .fc-num{width:72px}
.fc-btn{min-height:36px;padding:0 14px;border-radius:var(--dsw-radius-md,12px);border:.5px solid var(--dsw-alias-border-l4);background:transparent;color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14);cursor:pointer}
.fc-btn:focus-visible{outline:2px solid ${RING};outline-offset:2px}
@keyframes fc-pulse{0%,100%{opacity:1}50%{opacity:.35}}
/* motion: none while Wallpaper's Motion switch is off (body.wp-still) or the system asks for less */
body.wp-still :is(${ROOTS}),body.wp-still :is(${ROOTS})::before,body.wp-still :is(${ROOTS})::after,body.wp-still :is(${ROOTS}) *,body.wp-still :is(${ROOTS}) *::before,body.wp-still :is(${ROOTS}) *::after{animation:none!important;transition:none!important}
@media (prefers-reduced-motion:reduce){:is(${ROOTS}),:is(${ROOTS})::before,:is(${ROOTS})::after,:is(${ROOTS}) *,:is(${ROOTS}) *::before,:is(${ROOTS}) *::after{animation:none!important;transition:none!important}}
`;

		// ------------------------------------------------------------ install
		const installStyles = () => {
			try {
				const style = document.createElement("style");
				style.setAttribute("data-plugin", BUNDLE);
				style.setAttribute("data-plugin-css", `${BUNDLE}/client.css`);
				style.textContent = CSS;
				document.head.appendChild(style);
				return () => style.remove();
			} catch (e) {
				return undefined;
			}
		};
		const startClock = () => {
			tick();
			const iv = setInterval(tick, 1000);
			// The host's state, read while the window is visible; only a moved revision redraws.
			const poll = setInterval(() => { if (visible()) refresh(); }, POLL_MS);
			const onVisible = () => { if (visible()) { refresh(); tick(); } };
			try { document.addEventListener("visibilitychange", onVisible); } catch (e) {}
			return () => { clearInterval(iv); clearInterval(poll); try { document.removeEventListener("visibilitychange", onVisible); } catch (e) {} };
		};
		const armAudio = () => {
			const onFirstClick = () => { ensureAudio(); document.removeEventListener("click", onFirstClick, true); };
			try { document.addEventListener("click", onFirstClick, true); } catch (e) {}
			return () => {
				try { document.removeEventListener("click", onFirstClick, true); } catch (e) {}
				if (audioCtx) { try { audioCtx.close(); } catch (e) { /* already closed */ } audioCtx = null; }
			};
		};

		// ------------------------------------------------------------ apply
		function apply(ctx) {
			ctx.effect(() => { refresh(); return () => { stateS.set(null); seenDone = undefined; uiS.set({ panel: false, busy: false, toast: null }); }; }, "focus: state");
			ctx.effect(() => installStyles(), "focus: style");
			ctx.effect(() => startClock(), "focus: tick");
			ctx.effect(() => armAudio(), "focus: audio");
			const reg = (slot, opts, comp) => ctx.slots.inject(slot, () => ctx.slots.register({ name: slot, locale: NS, ...opts }, comp));
			reg("sidebar.footer.action", { id: IDS.open, order: 91 }, FocusButton);
			reg("shell.overlay", { id: IDS.overlay, order: 41 }, () => h(Fragment, null, h(FocusPanel, null), h(Banner, null)));
		}
		return { name: BUNDLE, inject: ["slots", "locale"], apply };
	},
});
