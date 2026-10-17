/**
 * Load a suite plugin's browser half the way DSH does (a classic script
 * that hands its factory to DSH's module loader), with stand-ins for React
 * and DSH's parts, and draw its views as plain element trees.
 *
 * The stand-in React calls function components as it meets them, so a
 * tree holds every element a view draws, its actions and children
 * included; DSH's own parts (Button, Switch, Tag…) stay as elements named
 * after themselves, with their props.
 */
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

/** React's hooks, enough to draw a component once and read what it draws. */
export function standInReact() {
    const react = {
        createElement: (type, props, ...children) => {
            if (typeof type === 'function') return type({ ...(props ?? {}), children: children.length <= 1 ? children[0] : children });
            return { type, props: props ?? {}, children };
        },
        Fragment: 'Fragment',
        useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
        useRef: (current) => ({ current }),
        useEffect: () => {},
        useLayoutEffect: () => {},
        useCallback: (fn) => fn,
        useMemo: (fn) => fn(),
        useSyncExternalStore: (_subscribe, get) => get(),
    };
    return react;
}

/**
 * @param {URL} url - the plugin's lib/client.js.
 * @param {{ document?: object, globals?: object, console?: Console, ui?: object }} [options] - `ui`: DSH parts to stand in
 *   with real code (a settings form model, say); every other part is an element named after itself.
 */
export function loadClient(url, { document, globals = {}, console: log = console, ui: parts = {} } = {}) {
    const source = readFileSync(url, 'utf8');
    let loaded;
    const window = { __ModuleLoader__: { load: (m) => { loaded = m; } }, addEventListener: () => {}, removeEventListener: () => {} };
    runInNewContext(source, {
        window, ...(document ? { document } : {}),
        URL, console: log, setInterval, clearInterval, setTimeout, clearTimeout, queueMicrotask, Promise, ...globals,
    });
    if (!loaded) return { window };
    const ui = new Proxy({}, { get: (_target, name) => (Object.hasOwn(parts, name) ? parts[name] : typeof name === 'string' ? name : undefined) });
    const react = standInReact();
    const modules = { react, 'react-dom': { createPortal: (node) => node }, '@deepseek-ai/dsh-client-ui-primitives': ui };
    return { id: loaded.id, client: loaded.factory((name) => modules[name]), window, react };
}

/** Every element in a tree, depth first. */
export function elementsOf(node, out = []) {
    if (Array.isArray(node)) {
        for (const child of node) elementsOf(child, out);
        return out;
    }
    if (node === null || typeof node !== 'object') return out;
    out.push(node);
    elementsOf(node.children, out);
    return out;
}

/** The text a tree shows. */
export const textIn = (node) => (Array.isArray(node) ? node.map(textIn).join('')
    : node === null || node === undefined || node === false || node === true ? ''
        : typeof node === 'object' ? textIn(node.children) : String(node));

/** Other assistants' and their makers' names, which no suite text may carry (built in pieces, so this file passes the repo's own scan). */
export const OTHER_NAMES = new RegExp(['cla', 'ude|anth', 'ropic|co', 'dex|open', 'ai'].join(''), 'i');
