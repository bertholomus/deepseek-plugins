/**
 * Time zones without a library. An event's times are kept as wall-clock
 * times in a zone ("2026-10-12T09:30:00" in America/Los_Angeles), the way
 * iCalendar writes them, so a weekly meeting stays at 9:30 across daylight
 * saving. This module turns those into instants and back through the
 * runtime's own zone data (Intl), and maps the zone names other systems use
 * (Windows names from Exchange, prefixed ids from older clients) to IANA ids.
 * A zone an iCalendar file defines itself (VTIMEZONE) and that has no IANA
 * name is a rule object (`ruleZone`, built in ical.js) with `offsetAt(ms)`.
 *
 * @module dsh-plugin-calendar/zones
 */

const MINUTE = 60_000;
const DAY = 86_400_000;

/** Formatters per zone; Intl's are costly to make and cheap to reuse. */
const formatters = new Map();

function formatterFor(tz) {
    let format = formatters.get(tz);
    if (format === undefined) {
        // h23: midnight is 00, never 24 (as some engines write it with hour12 off).
        format = new Intl.DateTimeFormat('en-US', {
            timeZone: tz, hourCycle: 'h23',
            year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
        formatters.set(tz, format);
    }
    return format;
}

/** Whether this runtime knows an IANA zone id (or an alias of one). */
export function isZone(tz) {
    if (typeof tz !== 'string' || tz === '' || tz.length > 64) return false;
    try {
        formatterFor(tz);
        return true;
    } catch {
        return false;
    }
}

/** The zone this computer runs in, as an IANA id ('UTC' if the runtime can't tell). */
export function localZone() {
    try {
        const tz = new Intl.DateTimeFormat().resolvedOptions().timeZone;
        return isZone(tz) ? tz : 'UTC';
    } catch {
        return 'UTC';
    }
}

/** Every zone id the runtime offers, for a zone picker. */
export function zoneIds() {
    try {
        const ids = Intl.supportedValuesOf('timeZone');
        return ids.includes('UTC') ? ids : ['UTC', ...ids];
    } catch {
        return ['UTC'];
    }
}

const pad = (n, width = 2) => String(n).padStart(width, '0');

/**
 * A wall-clock time as its fields. Accepts 'YYYY-MM-DDTHH:MM[:SS]' (a
 * trailing 'Z' or offset is ignored: the zone says how to read it).
 * @returns {{y, mo, d, h, mi, s}|undefined}
 */
export function wallFields(local) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(local ?? ''));
    if (m === null) return undefined;
    const [y, mo, d, h, mi, s] = m.slice(1).map((v) => Number(v ?? 0));
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return undefined;
    return { y, mo, d, h, mi, s: Math.min(s, 59) };
}

/** A wall-clock time in canonical form, 'YYYY-MM-DDTHH:MM:SS', or undefined. */
export function normalLocal(local) {
    const f = wallFields(local);
    return f === undefined ? undefined : `${pad(f.y, 4)}-${pad(f.mo)}-${pad(f.d)}T${pad(f.h)}:${pad(f.mi)}:${pad(f.s)}`;
}

/** The wall clock read as if it were UTC: an instant to do calendar arithmetic on. */
export function wallMs(local) {
    const f = wallFields(local);
    return f === undefined ? NaN : Date.UTC(f.y, f.mo - 1, f.d, f.h, f.mi, f.s);
}

/** wallMs back to a wall-clock string. */
export function wallOf(ms) {
    const d = new Date(ms);
    return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** A rule zone (from a VTIMEZONE) or an IANA id: what the functions below take as `zone`. */
const isRuleZone = (zone) => zone !== null && typeof zone === 'object' && typeof zone.offsetAt === 'function';

/**
 * The zone's offset from UTC at an instant, in minutes east (-420 for
 * Pacific daylight time). An unknown zone counts as UTC.
 */
export function offsetAt(zone, ms) {
    if (isRuleZone(zone)) return zone.offsetAt(ms);
    if (zone === 'UTC' || zone === 'Etc/UTC' || zone === 'GMT' || !isZone(zone)) return 0;
    const parts = {};
    for (const { type, value } of formatterFor(zone).formatToParts(new Date(ms))) parts[type] = value;
    const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    // Whole seconds of the instant: the formatter drops milliseconds.
    return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / MINUTE);
}

/** The wall-clock time in a zone at an instant: 'YYYY-MM-DDTHH:MM:SS'. */
export function toLocal(ms, zone) {
    return wallOf(ms + offsetAt(zone, ms) * MINUTE);
}

/**
 * The instant a wall-clock time in a zone stands for. As RFC 5545 reads
 * DST changes: a time skipped by a spring-forward gap is read with the
 * offset from before the gap (02:30 becomes 03:30), and a time that
 * happens twice in a fall-back is the first of the two.
 * @param local - 'YYYY-MM-DDTHH:MM[:SS]'.
 * @param zone - an IANA id, a rule zone, 'UTC', or null for the fallback.
 * @param fallback - the zone for floating times (no zone): the user's.
 * @returns epoch ms, or NaN for a malformed time.
 */
export function toInstant(local, zone, fallback = localZone()) {
    const wall = wallMs(local);
    if (Number.isNaN(wall)) return NaN;
    const z = zone ?? fallback;
    if (z === 'UTC' || z === 'Etc/UTC' || z === 'GMT') return wall;
    const before = offsetAt(z, wall - DAY);
    const after = offsetAt(z, wall + DAY);
    const want = wallOf(wall);
    const fits = [...new Set([before, after])].map((o) => wall - o * MINUTE).filter((t) => toLocal(t, z) === want);
    if (fits.length > 0) return Math.min(...fits);
    return wall - before * MINUTE;
}

/** The calendar day ('YYYY-MM-DD') of an instant in a zone. */
export function dayIn(ms, zone) {
    return toLocal(ms, zone).slice(0, 10);
}

/** A day ('YYYY-MM-DD') moved by whole days. */
export function addDays(day, n) {
    const ms = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) + n * DAY;
    return new Date(ms).toISOString().slice(0, 10);
}

/** Whole days from one day to another ('2026-10-01' → '2026-10-03' is 2). */
export function daysBetween(from, to) {
    const a = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
    const b = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
    return Math.round((b - a) / DAY);
}

/** Whether a string is a calendar day 'YYYY-MM-DD' that exists. */
export function isDay(day) {
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
    const ms = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
    return new Date(ms).toISOString().slice(0, 10) === day;
}

/**
 * Windows time zone names (Exchange and Microsoft Graph send these) to IANA
 * ids, after CLDR's windowsZones table (each name's "001" zone). The first
 * id the runtime knows wins, so older runtimes get the older alias.
 */
const WINDOWS = {
    'Dateline Standard Time': ['Etc/GMT+12'],
    'UTC-11': ['Etc/GMT+11'],
    'Aleutian Standard Time': ['America/Adak'],
    'Hawaiian Standard Time': ['Pacific/Honolulu'],
    'Marquesas Standard Time': ['Pacific/Marquesas'],
    'Alaskan Standard Time': ['America/Anchorage'],
    'UTC-09': ['Etc/GMT+9'],
    'Pacific Standard Time (Mexico)': ['America/Tijuana'],
    'UTC-08': ['Etc/GMT+8'],
    'Pacific Standard Time': ['America/Los_Angeles'],
    'US Mountain Standard Time': ['America/Phoenix'],
    'Mountain Standard Time (Mexico)': ['America/Mazatlan'],
    'Mountain Standard Time': ['America/Denver'],
    'Yukon Standard Time': ['America/Whitehorse'],
    'Central America Standard Time': ['America/Guatemala'],
    'Central Standard Time': ['America/Chicago'],
    'Easter Island Standard Time': ['Pacific/Easter'],
    'Central Standard Time (Mexico)': ['America/Mexico_City'],
    'Canada Central Standard Time': ['America/Regina'],
    'SA Pacific Standard Time': ['America/Bogota'],
    'Eastern Standard Time (Mexico)': ['America/Cancun'],
    'Eastern Standard Time': ['America/New_York'],
    'Haiti Standard Time': ['America/Port-au-Prince'],
    'Cuba Standard Time': ['America/Havana'],
    'US Eastern Standard Time': ['America/Indiana/Indianapolis', 'America/Indianapolis'],
    'Turks And Caicos Standard Time': ['America/Grand_Turk'],
    'Paraguay Standard Time': ['America/Asuncion'],
    'Atlantic Standard Time': ['America/Halifax'],
    'Venezuela Standard Time': ['America/Caracas'],
    'Central Brazilian Standard Time': ['America/Cuiaba'],
    'SA Western Standard Time': ['America/La_Paz'],
    'Pacific SA Standard Time': ['America/Santiago'],
    'Newfoundland Standard Time': ['America/St_Johns'],
    'Tocantins Standard Time': ['America/Araguaina'],
    'E. South America Standard Time': ['America/Sao_Paulo'],
    'SA Eastern Standard Time': ['America/Cayenne'],
    'Argentina Standard Time': ['America/Argentina/Buenos_Aires', 'America/Buenos_Aires'],
    'Greenland Standard Time': ['America/Nuuk', 'America/Godthab'],
    'Montevideo Standard Time': ['America/Montevideo'],
    'Magallanes Standard Time': ['America/Punta_Arenas'],
    'Saint Pierre Standard Time': ['America/Miquelon'],
    'Bahia Standard Time': ['America/Bahia'],
    'UTC-02': ['Etc/GMT+2'],
    'Mid-Atlantic Standard Time': ['Etc/GMT+2'],
    'Azores Standard Time': ['Atlantic/Azores'],
    'Cape Verde Standard Time': ['Atlantic/Cape_Verde'],
    'UTC': ['Etc/UTC'],
    'Coordinated Universal Time': ['Etc/UTC'],
    'GMT Standard Time': ['Europe/London'],
    'Greenwich Standard Time': ['Atlantic/Reykjavik'],
    'Sao Tome Standard Time': ['Africa/Sao_Tome'],
    'Morocco Standard Time': ['Africa/Casablanca'],
    'W. Europe Standard Time': ['Europe/Berlin'],
    'Central Europe Standard Time': ['Europe/Budapest'],
    'Romance Standard Time': ['Europe/Paris'],
    'Central European Standard Time': ['Europe/Warsaw'],
    'W. Central Africa Standard Time': ['Africa/Lagos'],
    'Jordan Standard Time': ['Asia/Amman'],
    'GTB Standard Time': ['Europe/Bucharest'],
    'Middle East Standard Time': ['Asia/Beirut'],
    'Egypt Standard Time': ['Africa/Cairo'],
    'E. Europe Standard Time': ['Europe/Chisinau'],
    'Syria Standard Time': ['Asia/Damascus'],
    'West Bank Standard Time': ['Asia/Hebron'],
    'South Africa Standard Time': ['Africa/Johannesburg'],
    'FLE Standard Time': ['Europe/Kyiv', 'Europe/Kiev'],
    'Israel Standard Time': ['Asia/Jerusalem'],
    'South Sudan Standard Time': ['Africa/Juba'],
    'Kaliningrad Standard Time': ['Europe/Kaliningrad'],
    'Sudan Standard Time': ['Africa/Khartoum'],
    'Libya Standard Time': ['Africa/Tripoli'],
    'Namibia Standard Time': ['Africa/Windhoek'],
    'Arabic Standard Time': ['Asia/Baghdad'],
    'Turkey Standard Time': ['Europe/Istanbul'],
    'Arab Standard Time': ['Asia/Riyadh'],
    'Belarus Standard Time': ['Europe/Minsk'],
    'Russian Standard Time': ['Europe/Moscow'],
    'E. Africa Standard Time': ['Africa/Nairobi'],
    'Volgograd Standard Time': ['Europe/Volgograd'],
    'Iran Standard Time': ['Asia/Tehran'],
    'Arabian Standard Time': ['Asia/Dubai'],
    'Astrakhan Standard Time': ['Europe/Astrakhan'],
    'Azerbaijan Standard Time': ['Asia/Baku'],
    'Russia Time Zone 3': ['Europe/Samara'],
    'Mauritius Standard Time': ['Indian/Mauritius'],
    'Saratov Standard Time': ['Europe/Saratov'],
    'Georgian Standard Time': ['Asia/Tbilisi'],
    'Caucasus Standard Time': ['Asia/Yerevan'],
    'Afghanistan Standard Time': ['Asia/Kabul'],
    'West Asia Standard Time': ['Asia/Tashkent'],
    'Ekaterinburg Standard Time': ['Asia/Yekaterinburg'],
    'Pakistan Standard Time': ['Asia/Karachi'],
    'Qyzylorda Standard Time': ['Asia/Qyzylorda'],
    'India Standard Time': ['Asia/Kolkata', 'Asia/Calcutta'],
    'Sri Lanka Standard Time': ['Asia/Colombo'],
    'Nepal Standard Time': ['Asia/Kathmandu', 'Asia/Katmandu'],
    'Central Asia Standard Time': ['Asia/Bishkek'],
    'Bangladesh Standard Time': ['Asia/Dhaka'],
    'Omsk Standard Time': ['Asia/Omsk'],
    'Myanmar Standard Time': ['Asia/Yangon', 'Asia/Rangoon'],
    'SE Asia Standard Time': ['Asia/Bangkok'],
    'Altai Standard Time': ['Asia/Barnaul'],
    'W. Mongolia Standard Time': ['Asia/Hovd'],
    'North Asia Standard Time': ['Asia/Krasnoyarsk'],
    'N. Central Asia Standard Time': ['Asia/Novosibirsk'],
    'Tomsk Standard Time': ['Asia/Tomsk'],
    'China Standard Time': ['Asia/Shanghai'],
    'North Asia East Standard Time': ['Asia/Irkutsk'],
    'Singapore Standard Time': ['Asia/Singapore'],
    'W. Australia Standard Time': ['Australia/Perth'],
    'Taipei Standard Time': ['Asia/Taipei'],
    'Ulaanbaatar Standard Time': ['Asia/Ulaanbaatar'],
    'Aus Central W. Standard Time': ['Australia/Eucla'],
    'Transbaikal Standard Time': ['Asia/Chita'],
    'Tokyo Standard Time': ['Asia/Tokyo'],
    'North Korea Standard Time': ['Asia/Pyongyang'],
    'Korea Standard Time': ['Asia/Seoul'],
    'Yakutsk Standard Time': ['Asia/Yakutsk'],
    'Cen. Australia Standard Time': ['Australia/Adelaide'],
    'AUS Central Standard Time': ['Australia/Darwin'],
    'E. Australia Standard Time': ['Australia/Brisbane'],
    'AUS Eastern Standard Time': ['Australia/Sydney'],
    'West Pacific Standard Time': ['Pacific/Port_Moresby'],
    'Tasmania Standard Time': ['Australia/Hobart'],
    'Vladivostok Standard Time': ['Asia/Vladivostok'],
    'Lord Howe Standard Time': ['Australia/Lord_Howe'],
    'Bougainville Standard Time': ['Pacific/Bougainville'],
    'Russia Time Zone 10': ['Asia/Srednekolymsk'],
    'Magadan Standard Time': ['Asia/Magadan'],
    'Norfolk Standard Time': ['Pacific/Norfolk'],
    'Sakhalin Standard Time': ['Asia/Sakhalin'],
    'Central Pacific Standard Time': ['Pacific/Guadalcanal'],
    'Russia Time Zone 11': ['Asia/Kamchatka'],
    'Kamchatka Standard Time': ['Asia/Kamchatka'],
    'New Zealand Standard Time': ['Pacific/Auckland'],
    'UTC+12': ['Etc/GMT-12'],
    'Fiji Standard Time': ['Pacific/Fiji'],
    'Chatham Islands Standard Time': ['Pacific/Chatham'],
    'UTC+13': ['Etc/GMT-13'],
    'Tonga Standard Time': ['Pacific/Tongatapu'],
    'Samoa Standard Time': ['Pacific/Apia'],
    'Line Islands Standard Time': ['Pacific/Kiritimati'],
};

/** A Windows zone name as an IANA id this runtime knows, or undefined. */
export function windowsToIana(name) {
    const ids = WINDOWS[String(name ?? '').trim()];
    return ids?.find((id) => isZone(id));
}

/** An IANA id as the Windows name Exchange expects, or undefined. */
export function ianaToWindows(tz) {
    for (const [name, ids] of Object.entries(WINDOWS)) if (ids.includes(tz)) return name;
    return undefined;
}

/**
 * The IANA id a TZID from a calendar file or service stands for, or
 * undefined when it names none: an IANA id as is; one behind a vendor
 * prefix ("/mozilla.org/20050126_1/America/New_York",
 * "/softwarestudio.org/Olson_20011030_5/America/New_York"); a Windows
 * name; "GMT"/"UTC"/"Z".
 */
export function ianaZone(tzid) {
    const raw = String(tzid ?? '').trim().replace(/^"|"$/g, '');
    if (raw === '') return undefined;
    if (/^(?:Z|UTC|GMT|Etc\/UTC|Etc\/GMT|Coordinated Universal Time)$/i.test(raw)) return 'UTC';
    if (isZone(raw) && raw.includes('/')) return raw;
    const windows = windowsToIana(raw);
    if (windows !== undefined) return windows;
    // A prefixed id: the longest tail that is an IANA id with a slash in it.
    const parts = raw.split('/').filter(Boolean);
    for (let i = 0; i < parts.length - 1; i++) {
        const tail = parts.slice(i).join('/');
        if (isZone(tail) && tail.includes('/')) return tail;
    }
    return undefined;
}
