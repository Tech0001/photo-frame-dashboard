'use strict';
// Reads iCal feeds (e.g. Google Calendar "secret address in iCal format") plus the manual events you
// add at /admin, expands repeats, and returns one flat list in the shape the dashboard expects.
const ical = require('node-ical');
const { ymd, uid } = require('./util');

const tune = require('./tune');
const feedTtl = () => tune.get('calendarMin') * 60 * 1000;   // /admin > Settings > Refresh rates
const feedCache = new Map(); // url -> { at, data, error }

async function fetchFeed(url) {
  const hit = feedCache.get(url);
  if (hit && Date.now() - hit.at < feedTtl()) return hit;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20000);
    const res = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'frame-hub/0.1' } });
    clearTimeout(timer);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    const data = ical.sync.parseICS(text);
    const entry = { at: Date.now(), data, error: null };
    feedCache.set(url, entry);
    return entry;
  } catch (e) {
    // keep serving the last good copy if there is one
    const entry = { at: Date.now() - feedTtl() + 30000, data: hit ? hit.data : {}, error: String(e.message || e) };
    feedCache.set(url, entry);
    return entry;
  }
}

/** People named in the title ("Jordan: dentist", "Maya's piano") win over the calendar default. */
function peopleFor(title, calendarPeople, allPeople) {
  const t = (title || '').toLowerCase();
  const hit = allPeople.filter((p) => new RegExp('(^|[^a-z])' + p.name.toLowerCase().replace(/[^a-z0-9]/g, '') + '($|[^a-z])').test(t.replace(/[^a-z0-9]+/g, ' ')));
  if (hit.length) return hit.map((p) => p.id);
  return calendarPeople && calendarPeople.length ? calendarPeople : allPeople.map((p) => p.id);
}

function norm(inst, ev, calName, calendarPeople, allPeople) {
  const title = ev.summary && ev.summary.val ? ev.summary.val : String(ev.summary || '(no title)');
  const start = inst.start, end = inst.end || inst.start;
  const out = {
    id: 'i-' + (ev.uid || '') + '-' + start.getTime(),
    title,
    start: start.toISOString(),
    end: end.toISOString(),
    allDay: !!inst.isFullDay,
    people: peopleFor(title, calendarPeople, allPeople),
    source: calName
  };
  if (ev.location) out.loc = String(ev.location.val || ev.location);
  if (ev.description) {
    const d = String(ev.description.val || ev.description).trim();
    if (d) out.notes = d.length > 280 ? d.slice(0, 277) + '…' : d;
  }
  return out;
}

async function feedEvents(cal, url, from, to, allPeople) {
  const entry = await fetchFeed(url);
  const out = [];
  for (const ev of Object.values(entry.data)) {
    if (!ev || ev.type !== 'VEVENT') continue;
    if (ev.status && String(ev.status).toUpperCase() === 'CANCELLED') continue;
    let insts = [];
    try {
      insts = ical.expandRecurringEvent(ev, { from, to, includeOverrides: true, excludeExdates: true, expandOngoing: true });
    } catch (e) { continue; }
    for (const inst of insts) {
      if (!inst.start) continue;
      out.push(norm(inst, inst.event || ev, cal.name || 'Calendar', cal.people, allPeople));
    }
  }
  return { events: out, error: entry.error };
}

/** Manual events from state. repeat: none | daily | weekly | monthly (until optional). */
function manualEvents(list, from, to) {
  const out = [];
  const addDay = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  for (const e of list) {
    if (!e.date || !e.title) continue;
    const [Y, M, D] = e.date.split('-').map(Number);
    const first = new Date(Y, M - 1, D);
    const until = e.until ? new Date(e.until + 'T23:59:59') : null;
    const mk = (day) => {
      let start, end;
      if (e.allDay) {
        start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
        end = addDay(start, Math.max(1, +e.days || 1));
      } else {
        const [sh, sm] = (e.start || '09:00').split(':').map(Number);
        const [eh, em] = (e.end || e.start || '10:00').split(':').map(Number);
        start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), sh, sm);
        end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), eh, em);
        if (end <= start) end = new Date(start.getTime() + 3600000);
      }
      return { id: 'm-' + e.id + '-' + ymd(day), title: e.title, start: start.toISOString(), end: end.toISOString(),
        allDay: !!e.allDay, people: e.people && e.people.length ? e.people : [], loc: e.loc || undefined, notes: e.notes || undefined, source: 'manual', manualId: e.id };
    };
    const rep = e.repeat || 'none';
    if (rep === 'none') { const ev = mk(first); if (new Date(ev.end) >= from && new Date(ev.start) <= to) out.push(ev); continue; }
    // walk from the first occurrence, bounded to the window
    for (let day = new Date(first), n = 0; day <= to && n < 4000; n++) {
      if (until && day > until) break;
      const ev = mk(day);
      if (new Date(ev.end) >= from) out.push(ev);
      if (rep === 'daily') day = addDay(day, 1);
      else if (rep === 'weekly') day = addDay(day, 7);
      else { day = new Date(day.getFullYear(), day.getMonth() + 1, first.getDate()); }
    }
  }
  return out;
}

async function getEvents({ cfg, secrets, state, from, to }) {
  const all = state.people.map((p) => ({ id: p.id, name: p.name }));
  const events = [], feeds = [];
  for (const cal of cfg.calendars || []) {
    const url = secrets.ical && secrets.ical[cal.secret];
    if (!url) { feeds.push({ name: cal.name, ok: false, error: 'no URL in secrets.json for "' + cal.secret + '"' }); continue; }
    const r = await feedEvents(cal, url, from, to, all);
    events.push(...r.events);
    feeds.push({ name: cal.name, ok: !r.error, error: r.error, count: r.events.length });
  }
  events.push(...manualEvents(state.events, from, to));
  events.forEach((e) => { if (!e.id) e.id = uid('e'); });
  events.sort((a, b) => a.start.localeCompare(b.start));
  return { events, feeds };
}

/** Fetch and parse one feed right now (no cache) and say how many events it holds. */
async function testFeed(url) {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20000);
    const res = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'frame-hub/0.1' } });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, error: 'the server answered HTTP ' + res.status };
    const data = ical.sync.parseICS(await res.text());
    const events = Object.values(data).filter((e) => e && e.type === 'VEVENT').length;
    return events ? { ok: true, events } : { ok: false, error: 'it loaded, but holds no events (is it really an iCal link?)' };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

module.exports = { getEvents, manualEvents, testFeed };
