// Focus — client bundle (hand-written, no build step).
// Loaded by DSH's module loader; React and DSH's parts come from the shared platform modules.
// A pomodoro / countdown timer. All timer state lives host-side with an absolute endAt, so the
// countdown stays correct across page reloads and DSH restarts, and the host ends a timer itself.
// The window only shows it: it ticks locally, reads the host's state every few seconds while the
// window is visible (only a changed revision redraws), and says so when a timer ends: a toast with
// the next step, the chime, and a mark on the footer button until the end is seen in the panel.
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
		const { useState, useEffect, useLayoutEffect, useRef, useSyncExternalStore, Fragment } = React;
		const BUNDLE = "dsh-plugin-focus";
		const NS = "focus";
		const IDS = { open: `${BUNDLE}:open`, overlay: `${BUNDLE}:overlay` };
		const API = (typeof window !== "undefined" && window.__FOCUS_API__) || "/api/focus/"; // dev hook: point a test page at a local server
		const POLL_MS = 5000;
		const LATE_MS = 60000; // an end seen this long after it happened is said with its time, without the chime
		const END_HOLD_MS = 12000; // an end's toast stays this long (DSH's toast default is 3 s)
		const UNDO_MS = 60000; // the host keeps a Reset's timer this long for Undo; the panel offers it a little less
		const MIN = 1;
		const MAX = 180;
		// DSH's keyboard shortcut that opens the panel (rebindable in DSH's Keyboard shortcuts): ⇧⌥⌘F, Ctrl+Shift+Alt+F.
		const SHORTCUT_ID = `${BUNDLE}.open`;
		const SHORTCUT_KEYS = { code: "KeyF", modifiers: ["primary", "alt", "shift"] };
		const FOOTER_OUTLET = '[data-slot="sidebar.footer.action"]';

		// ------------------------------------------------------------ words
		const KIND = { focus: "Focus", short: "Short break", long: "Long break", custom: "Custom" };
		const ENDED = { focus: "Focus session", short: "Short break", long: "Long break", custom: "Timer" };
		const TEXT = {
			button: "Focus timer",
			title: "Focus timer",
			close: "Close",
			loading: "Reading the timer…",
			unreachable: (why) => `Focus can't reach its timer: ${why}. Check that the Focus plugin is on in Plugins, then try again.`,
			stale: (why) => `Focus can't reach its timer right now (${why}); this may be out of date. It tries again every few seconds.`,
			retry: "Try again",
			start: "Start", pause: "Pause", resume: "Resume", reset: "Reset", undo: "Undo",
			startNext: (kind) => (kind === "focus" ? "Start focus" : kind === "long" ? "Start long break" : kind === "short" ? "Start short break" : "Start again"),
			nextCaption: (kind) => (KIND[kind] && kind !== "custom" ? `${KIND[kind]} next` : "Custom again"),
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
			doneLate: {
				focus: (at) => `Focus session done at ${at}. Time for a break.`,
				short: (at) => `Break over at ${at}. Ready to focus?`,
				long: (at) => `Break over at ${at}. Ready to focus?`,
				custom: (at) => `Timer done at ${at}.`,
			},
			ended: (kind, at) => `${ENDED[kind] || ENDED.custom} done at ${at}`,
			resetSaid: (kind) => `${ENDED[kind] || ENDED.custom} reset.`,
			notChanged: (why) => `Not changed: ${why}`,
			shortcut: "Open the Focus timer",
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
		// panel: open or not; toast: DSH's toast while the panel is closed; note: a refusal said in the open panel;
		// undo: the Reset the panel can undo ({ rev, until, kind }).
		const uiS = createStore({ panel: false, busy: false, toast: null, note: null, undo: null });
		const nowS = createStore(Date.now()); // advanced by the local tick, so the countdown redraws without a fetch
		const cx = (...a) => a.filter(Boolean).join(" ");
		// The host keeps an absolute endAt while running and the remaining time while idle; same rule, client side.
		// Never more than the timer's length: the window's clock reading can be a tick older than the start.
		const remainingOf = (t, now) => {
			const left = t?.running ? t.endAt - now : t?.remainingMs ?? 0;
			return Math.max(0, Math.min(Number.isFinite(t?.durationMs) ? t.durationMs : Infinity, left));
		};
		const phaseOf = (t, now) => {
			if (!t) return "ready";
			if (t.running) return "running";
			const rem = remainingOf(t, now);
			if (rem > 0 && rem < t.durationMs) return "paused";
			return t.doneAt && !t.running && rem === t.durationMs ? "done" : "ready";
		};
		/** A timer that ended and whose end no window has shown in its panel yet: the footer button keeps a mark. */
		const unseenEnd = (t) => Boolean(t && !t.running && t.doneAt && t.doneSeen === false);

		/** The pomodoro's next step after a timer of `kind` ended: { kind, min } (a custom timer: itself again). */
		const nextOf = (t, settings, focusToday) => {
			const kind = t?.kind;
			if (kind === "focus") return focusToday > 0 && focusToday % 4 === 0 ? { kind: "long", min: settings.longMin || 15 } : { kind: "short", min: settings.shortMin || 5 };
			if (kind === "short" || kind === "long") return { kind: "focus", min: settings.focusMin || 25 };
			return { kind: "custom", ms: t?.durationMs > 0 ? t.durationMs : 25 * 60000 };
		};
		const nextMs = (next) => (next.kind === "custom" ? next.ms : next.min * 60000);

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
		const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";
		let seenDone; // the doneAt already said; undefined until the first read, which never announces
		let pending = null; // an end that came while the window was hidden: { doneAt }, said when it is shown
		let seenSent = null; // the doneAt this window already told the host it showed
		let toastSeq = 0;
		const toast = (text, tone, extra) => uiS.set((u) => ({ ...u, toast: { text, tone, seq: ++toastSeq, ...extra } }));
		const dropToast = (seq) => uiS.set((u) => (u.toast && u.toast.seq === seq ? { ...u, toast: null } : u));
		/** A toast's action: it closes the toast, then runs. */
		const action = (label, run) => { const seq = toastSeq + 1; return { label, onClick: () => { dropToast(seq); run(); } }; };
		/**
		 * The end in DSH's toast, with the pomodoro's next step as its action; `late` says when it ended.
		 * An open panel says it itself (its state, the next step's clock and button), so no toast covers the dialog.
		 */
		const sayEnd = (v, late) => {
			if (uiS.get().panel) return;
			const t = v.timer;
			const kind = TEXT.done[t.kind] ? t.kind : "custom";
			const next = nextOf(t, v.settings || {}, v.sessions?.focus ?? 0);
			toast(late ? TEXT.doneLate[kind](clock(t.doneAt)) : TEXT.done[kind], "success", {
				holdMs: END_HOLD_MS,
				actions: [action(TEXT.startNext(next.kind), () => op({ op: "start", kind: next.kind, durationMs: nextMs(next) }))],
			});
		};
		/** A new state from the host: kept when its revision moved; a timer that ended since the last one is said. */
		const take = (v) => {
			const old = stateS.get();
			if (!old || old.rev !== v.rev || JSON.stringify(old.problems) !== JSON.stringify(v.problems)) stateS.set(v);
			loadS.set((l) => (l.error === null ? l : { error: null }));
			const done = v.timer && !v.timer.running ? v.timer.doneAt : null;
			if (seenDone !== undefined && done && done !== seenDone) {
				const late = Date.now() - done > LATE_MS;
				// An end found late that a panel has shown already (in another window) is not said again.
				const say = !(late && v.timer.doneSeen === true);
				if (say && visible()) sayEnd(v, late);
				else if (say) pending = { doneAt: done }; // hidden: said when the window is shown again, with its time
				// The chime sounds at the end even in a hidden window (it is heard); never for an end found late.
				if (!late && v.settings && v.settings.chime) chime();
			}
			if (seenDone === undefined || done) seenDone = done || seenDone || null;
			markSeen();
		};
		/** An end shown in an open panel of a visible window is seen: the host drops the footer mark in every window. */
		const markSeen = () => {
			const t = stateS.get()?.timer;
			if (!uiS.get().panel || !visible() || !unseenEnd(t) || seenSent === t.doneAt) return;
			seenSent = t.doneAt;
			api("state", { op: { op: "seen" } }).then((r) => { if (r.ok) take(r.value); else seenSent = null; });
		};
		/** Back in view: read the host, say an end that came while hidden (unless it was seen or replaced meanwhile). */
		const sayPending = () => {
			const p = pending;
			pending = null;
			const v = stateS.get();
			const t = v?.timer;
			if (p && t && !t.running && t.doneAt === p.doneAt && t.doneSeen !== true) sayEnd(v, true);
		};
		const refresh = async () => {
			const r = await api("state");
			if (r.ok) take(r.value);
			else loadS.set({ error: r.error });
			return r.ok;
		};
		/**
		 * One op (and maybe a settings patch). A refusal comes back in the host's words: in the open panel, where
		 * the person is looking (never a toast over the dialog), or in DSH's toast when the panel is closed.
		 */
		const send = async (body) => {
			uiS.set((u) => ({ ...u, busy: true, note: null }));
			const r = await api("state", body);
			uiS.set((u) => ({ ...u, busy: false }));
			if (!r.ok) {
				if (uiS.get().panel) uiS.set((u) => ({ ...u, note: { text: TEXT.notChanged(r.error), seq: ++toastSeq } }));
				else toast(TEXT.notChanged(r.error), "warning");
				return false;
			}
			take(r.value);
			return true;
		};
		const op = (o) => send({ op: o });
		/** Reset; a timer that had started can be brought back from the panel for a minute (the host keeps it). */
		const resetTimer = (t, started) => send({ op: { op: "reset" } }).then((ok) => {
			const rev = stateS.get()?.rev;
			uiS.set((u) => ({ ...u, undo: ok && started ? { rev, until: Date.now() + UNDO_MS - 2000, kind: t.kind } : null }));
			return ok;
		});
		const undoReset = () => send({ op: { op: "undo" } }).then((ok) => { uiS.set((u) => ({ ...u, undo: null })); return ok; });

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

		// ------------------------------------------------------------ icons
		const svg = (children, size = 18) => h("svg", { className: "fc-i", viewBox: "0 0 24 24", width: size, height: size, "aria-hidden": "true", focusable: "false" }, ...children.map((c, i) => (typeof c === "string" ? h("path", { key: i, d: c }) : c)));
		const timerIcon = (s) => svg([h("circle", { key: "c", cx: 12, cy: 14, r: 7.5 }), "M10 3h4M12 3v3.5", "M12 14V9.5"], s);

		// ------------------------------------------------------------ the footer button
		let opener = null; // what had the focus when the panel opened; it gets it back on close
		const openPanel = (from) => {
			opener = from || (typeof document !== "undefined" ? document.activeElement : null);
			// The panel says what a toast said (the end, the next step); a toast never covers the dialog.
			uiS.set((u) => ({ ...u, panel: true, toast: null }));
			markSeen();
			refresh();
		};
		const closePanel = () => {
			uiS.set((u) => ({ ...u, panel: false, note: null }));
			const back = opener;
			opener = null;
			if (back && typeof back.focus === "function") setTimeout(() => { try { if (back.isConnected !== false) back.focus(); } catch (e) {} }, 0);
		};
		/**
		 * DSH's folded sidebar (its rail, under 1024 px) lays the footer buttons in one row 36 px wide: two do
		 * not fit. There Focus gives its seat to a button drawn before it in DSH's footer outlet, so the
		 * neighbour stays whole; the panel then opens from DSH's keyboard shortcut or the unfolded sidebar.
		 */
		const seatTaken = (seat) => {
			try {
				const outlet = seat && typeof seat.closest === "function" ? seat.closest(FOOTER_OUTLET) : null;
				if (!outlet) return false;
				let mine = seat;
				while (mine.parentElement && mine.parentElement !== outlet) mine = mine.parentElement;
				if (mine.parentElement !== outlet) return false;
				const hasBox = (el, depth) => {
					const r = el.getBoundingClientRect();
					if (r.width > 0 && r.height > 0) return true;
					if (depth >= 3) return false;
					for (const child of Array.from(el.children || [])) if (hasBox(child, depth + 1)) return true;
					return false;
				};
				for (let s = mine.previousElementSibling; s; s = s.previousElementSibling) if (hasBox(s, 0)) return true;
				return false;
			} catch (e) {
				return false;
			}
		};
		const FocusButton = (props) => {
			const wide = !props || props.wide !== false;
			const st = useStore(stateS);
			const now = useStore(nowS);
			const seat = useRef(null);
			const [giveWay, setGiveWay] = useState(false);
			useLayoutEffect(() => {
				if (wide) { setGiveWay(false); return undefined; }
				const check = () => setGiveWay(seatTaken(seat.current));
				check();
				let watch = null;
				try {
					const outlet = seat.current && typeof seat.current.closest === "function" ? seat.current.closest(FOOTER_OUTLET) : null;
					if (outlet && typeof MutationObserver === "function") { watch = new MutationObserver(check); watch.observe(outlet, { childList: true, subtree: true }); }
				} catch (e) { watch = null; }
				return () => { if (watch) watch.disconnect(); };
			}, [wide]);
			const t = st?.timer;
			const phase = phaseOf(t, now);
			const ended = unseenEnd(t);
			const endWords = ended ? TEXT.ended(t.kind, clock(t.doneAt)) : "";
			const label = phase === "running" ? `${TEXT.button}: ${KIND[t.kind] || KIND.focus}, ${spoken(remainingOf(t, now))} left`
				: phase === "paused" ? `${TEXT.button}: paused, ${spoken(remainingOf(t, now))} left`
					: ended ? `${TEXT.button}: ${endWords}` : TEXT.button;
			const tip = phase === "running" ? `${KIND[t.kind] || KIND.focus} · ${fmtTime(remainingOf(t, now))} left` : phase === "paused" ? `Paused · ${fmtTime(remainingOf(t, now))} left` : ended ? endWords : TEXT.button;
			const dot = phase === "running" ? "fc-dot" : phase === "paused" ? "fc-dot fc-dot-paused" : ended ? "fc-dot fc-dot-done" : null;
			const button = h("button", { type: "button", className: "fc-footbtn", "aria-label": label, "aria-haspopup": "dialog", "data-focus-open": "", "data-focus-mark": ended ? "ended" : phase, onClick: (e) => openPanel(e.currentTarget) },
				timerIcon(18),
				dot ? h("span", { className: dot, "aria-hidden": "true" }) : null);
			// The seat is a box-less span (display: contents) that stays when Focus gives way, so it can watch the row.
			return h("span", { className: "fc-seat", ref: seat, "data-focus-seat": giveWay ? "given" : "kept" },
				giveWay ? null : has("Tooltip") ? h(ui.Tooltip, { label: tip, side: "top", portal: true }, button) : button); // in a portal, so the sidebar never clips it
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
			// Done: the clock shows the next step, which the main button starts, under a line that names it.
			const next = phase === "done" ? nextOf(t, settings, sessions) : null;
			const shown = next ? nextMs(next) : rem;
			const frac = next ? 1 : total > 0 ? Math.min(1, Math.max(0, rem / total)) : 0;
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
			const primary = running ? { label: TEXT.pause, run: () => op({ op: "pause" }) }
				: phase === "paused" ? { label: TEXT.resume, run: () => op({ op: "resume" }) }
					: next ? { label: TEXT.startNext(next.kind), run: () => op({ op: "start", kind: next.kind, durationMs: nextMs(next) }) }
						: { label: TEXT.start, run: () => op({ op: "start", kind: t.kind || "focus", durationMs: total > 0 ? total : 25 * 60000 }) };
			// A preset's new length also applies to the idle timer of that kind when it was not started.
			const savePreset = (kind, key) => (n) => {
				const body = { settings: { [key]: n } };
				if (!t.running && t.kind === kind && rem === total) body.op = { op: "set", kind, durationMs: n * 60000 };
				send(body);
			};
			const problems = Array.isArray(st.problems) ? st.problems : [];
			const customInput = has("Input") ? ui.Input : "input";
			return modal([
				load.error ? h("div", { key: "stale", className: "fc-note fc-error", role: "status", "data-focus-stale": "" }, TEXT.stale(load.error)) : null,
				h("p", { key: "state", className: "fc-state", "aria-live": "polite", "data-focus-state": phase }, stateLine),
				// After a Reset of a started timer: Undo, here where the Reset was pressed, while the host keeps it.
				u.undo && st.rev === u.undo.rev && now < u.undo.until
					? h("div", { key: "undo", className: "fc-row fc-undo", role: "status", "data-focus-undo": "" },
						h("span", { className: "fc-undo-text" }, TEXT.resetSaid(u.undo.kind)),
						Btn({ variant: "outline", disabled: busy, onClick: undoReset, "data-focus-undo-button": "" }, TEXT.undo))
					: null,
				h("div", { key: "ring", className: "fc-ringwrap" },
					h("svg", { className: "fc-ring", viewBox: "0 0 180 180", width: 180, height: 180, "aria-hidden": "true", focusable: "false" },
						h("circle", { className: "fc-ring-track", cx: 90, cy: 90, r: 80 }),
						h("circle", { className: cx("fc-ring-arc", running && "fc-run"), cx: 90, cy: 90, r: 80, strokeDasharray: C, strokeDashoffset: C * (1 - frac), transform: "rotate(-90 90 90)" })),
					h("div", { className: "fc-face" },
						h("div", { className: "fc-time", "data-focus-time": "" }, fmtTime(shown)),
						next ? h("div", { className: "fc-next", "data-focus-next": next.kind }, TEXT.nextCaption(next.kind)) : null)),
				h("div", { key: "presets", className: "fc-row fc-wrap", role: "group", "aria-label": TEXT.lengths },
					presets.map(([kind, min]) => Btn({ key: kind, variant: t.kind === kind && total === min * 60000 ? "primary" : "outline", disabled: lockLength, "aria-pressed": t.kind === kind && total === min * 60000, "data-focus-preset": kind, onClick: () => op({ op: "set", kind, durationMs: min * 60000 }) }, `${KIND[kind]} ${min} ${TEXT.minutes}`))),
				// The custom length: its name beside the field, as the preset lengths have theirs.
				h("div", { key: "custom", className: "fc-row fc-custom" },
					h("label", { className: "fc-row fc-custom-field" },
						h("span", { className: "fc-custom-name" }, TEXT.custom),
						h(customInput, { type: "number", min: MIN, max: MAX, step: 1, inputMode: "numeric", className: "fc-num", "aria-label": TEXT.customLabel, placeholder: `${MIN}–${MAX}`, value: custom, disabled: lockLength, "data-focus-custom": "",
							onChange: (e) => setCustom(e.target.value), onKeyDown: (e) => { if (e.key === "Enter") { e.preventDefault(); applyCustom(); } } }),
						h("span", { className: "fc-meta", "aria-hidden": "true" }, TEXT.minutes)),
					Btn({ variant: "outline", disabled: !customValid || lockLength, onClick: applyCustom, "data-focus-custom-set": "" }, TEXT.set)),
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
				u.note ? h("div", { key: `note:${u.note.seq}`, className: "fc-note fc-error", role: "alert", "data-focus-note": "" }, u.note.text) : null,
			], h(Fragment, null,
				Btn({ variant: "outline", disabled: busy || (phase === "ready" && rem === total), onClick: () => resetTimer(t, phase === "running" || phase === "paused"), "data-focus-reset": "" }, TEXT.reset),
				Btn({ variant: "primary", disabled: busy, onClick: primary.run, "data-modal-autofocus": true, "data-focus-primary": "" }, primary.label)));
		};

		const Banner = () => {
			const u = useStore(uiS);
			if (!u.toast || !has("Toast")) return null;
			const warn = u.toast.tone === "warning";
			const icon = warn && has("IconWarningOutlineRegular") ? h(ui.IconWarningOutlineRegular, { size: 16 }) : undefined;
			const seq = u.toast.seq;
			return h(ui.Toast, { key: `focus:${seq}`, text: u.toast.text, holdMs: u.toast.holdMs || (warn ? 8000 : 6000), ...(u.toast.actions ? { actions: u.toast.actions } : {}), ...(warn ? (icon ? { icon } : {}) : { tone: "success" }),
				onDone: () => dropToast(seq) });
		};

		// ------------------------------------------------------------ styles
		// DSH's tokens for every colour, font, corner and duration; nothing on :root, html or body, and no ground
		// of Focus's own: the footer button sits in DSH's sidebar and the panel is DSH's dialog.
		const RING = "var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))";
		// Green as a mark on a light ground needs DSH's label colour mixed in (DESIGN.md section 4).
		const DONE = "color-mix(in srgb,var(--dsw-alias-state-success-primary) 60%,var(--dsw-alias-label-primary))";
		const ROOTS = ".fc-footbtn,.fc-body";
		const CSS = `
.fc-seat{display:contents}
.fc-footbtn{position:relative;width:32px;height:32px;border-radius:var(--dsw-radius-sm,8px);display:inline-flex;align-items:center;justify-content:center;flex:none;background:transparent;border:0;padding:0;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background var(--ds-transition-duration,.2s) var(--ds-ease-in-out,ease),color var(--ds-transition-duration,.2s) var(--ds-ease-in-out,ease)}
.fc-footbtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.fc-footbtn:active{background:var(--dsw-alias-interactive-bg-active)}
.fc-footbtn:focus-visible{outline:2px solid ${RING};outline-offset:2px}
.fc-i{fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;flex:none}
.fc-dot{position:absolute;top:5px;right:5px;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-business-primary);pointer-events:none;animation:fc-pulse 1.6s ease-in-out infinite}
.fc-dot.fc-dot-paused{background:var(--dsw-alias-label-tertiary);animation:none}
.fc-dot.fc-dot-done{top:4px;right:4px;width:8px;height:8px;background:${DONE};animation:none}
.fc-body{display:flex;flex-direction:column;gap:14px;min-width:0;color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14)}
.fc-state{margin:0;font:var(--dsw-font-s-strong-14,var(--dsw-font-s-14));color:var(--dsw-alias-label-primary)}
.fc-ringwrap{position:relative;display:flex;justify-content:center;align-items:center;height:180px}
.fc-ring{display:block;flex:none}
.fc-ring-track,.fc-ring-arc{fill:none;stroke-width:10}
.fc-ring-track{stroke:var(--dsw-alias-border-l2)}
.fc-ring-arc{stroke:var(--dsw-alias-state-business-primary);stroke-linecap:round}
.fc-ring-arc.fc-run{transition:stroke-dashoffset .9s linear}
.fc-face{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px}
/* the clock face: DSH's font at a display size, which DSH's type ladder (24px at most) does not have */
.fc-time{font:500 40px/1 var(--dsw-font-family);font-variant-numeric:tabular-nums;letter-spacing:-.01em;color:var(--dsw-alias-label-primary)}
.fc-next{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-secondary)}
.fc-row{display:flex;align-items:center;gap:8px;min-width:0}
.fc-wrap{flex-wrap:wrap}
.fc-undo{justify-content:space-between;padding:6px 6px 6px 12px;border-radius:var(--dsw-radius-md,12px);border:.5px solid var(--dsw-alias-border-l3)}
.fc-undo-text{font:var(--dsw-font-s-14);color:var(--dsw-alias-label-primary)}
.fc-custom-field{flex:none;cursor:text}
.fc-custom-name{font:var(--dsw-font-s-14);color:var(--dsw-alias-label-primary)}
.fc-custom .fc-num{width:96px}
.fc-num{width:84px;box-sizing:border-box;font-variant-numeric:tabular-nums}
input.fc-num{min-height:36px;padding:6px 10px;border-radius:var(--dsw-radius-md,12px);border:.5px solid var(--dsw-alias-border-l4);background:transparent;color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14)}
input.fc-num:focus-visible,.fc-num input:focus-visible{outline:2px solid ${RING};outline-offset:1px}
.fc-bad,.fc-bad input{border-color:var(--dsw-alias-state-error-primary)}
.fc-meta{margin:0;font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-secondary)}
.fc-error{color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 85%,var(--dsw-alias-label-primary))}
.fc-note{font:var(--dsw-font-xs-13);padding:10px 12px;border-radius:var(--dsw-radius-md,12px);border:.5px solid var(--dsw-alias-border-l3)}
.fc-settings{display:flex;flex-direction:column;gap:10px;padding-top:12px;border-top:.5px solid var(--dsw-alias-border-l3)}
.fc-switch{justify-content:space-between;cursor:pointer}
.fc-switch-text{font:var(--dsw-font-s-14);color:var(--dsw-alias-label-primary)}
.fc-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));align-items:end;gap:8px 12px}
.fc-fields>.fc-meta{grid-column:1/-1}
.fc-field{display:flex;flex-direction:column;align-items:stretch;gap:4px;min-width:0;font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-secondary)}
.fc-field .fc-num{width:100%}
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
			// Back in view: read the host, say an end that came while hidden, and mark it seen if the panel shows it.
			const onVisible = () => { if (visible()) { tick(); refresh().then(() => { sayPending(); markSeen(); }); } };
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
		/** DSH's keyboard shortcut "Open the Focus timer": the panel's door wherever the footer button is not (the rail). */
		const shortcut = (shortcuts) => {
			const command = (defaults) => ({
				id: SHORTCUT_ID, label: () => TEXT.shortcut, aliases: ["focus", "timer", "pomodoro"], defaults,
				regions: ["page", "editable"], modals: [],
				resolve: () => ({ status: "handled", run: () => { if (!uiS.get().panel) openPanel(null); } }),
			});
			const keys = { "desktop:macos": SHORTCUT_KEYS, "desktop:windows": SHORTCUT_KEYS, "desktop:linux": SHORTCUT_KEYS, "web:macos": SHORTCUT_KEYS, "web:windows": SHORTCUT_KEYS };
			try {
				return shortcuts.register(command(keys));
			} catch (e) {
				// Its keys are taken (DSH refuses a clash): the command is still listed, without keys, to bind in DSH's settings.
				try { return shortcuts.register(command({})); } catch (e2) { return undefined; }
			}
		};

		// ------------------------------------------------------------ apply
		function apply(ctx) {
			ctx.effect(() => { refresh(); return () => { stateS.set(null); seenDone = undefined; pending = null; seenSent = null; uiS.set({ panel: false, busy: false, toast: null, note: null, undo: null }); }; }, "focus: state");
			ctx.effect(() => installStyles(), "focus: style");
			ctx.effect(() => startClock(), "focus: tick");
			ctx.effect(() => armAudio(), "focus: audio");
			const reg = (slot, opts, comp) => ctx.slots.inject(slot, () => ctx.slots.register({ name: slot, locale: NS, ...opts }, comp));
			reg("sidebar.footer.action", { id: IDS.open, order: 91 }, FocusButton);
			reg("shell.overlay", { id: IDS.overlay, order: 41 }, () => h(Fragment, null, h(FocusPanel, null), h(Banner, null)));
			// DSH's shortcuts are a service of their own: used when this DSH has them, and gone with the plugin.
			try {
				if (typeof ctx.inject === "function") ctx.inject(["shortcuts"], (scope) => { scope.effect(() => shortcut(scope.shortcuts), "focus: shortcut"); });
			} catch (e) { /* no shortcut: the footer button is the door */ }
		}
		return { name: BUNDLE, inject: ["slots", "locale"], apply, logic: { seatTaken, phaseOf, nextOf, unseenEnd, SHORTCUT_ID, SHORTCUT_KEYS } };
	},
});
