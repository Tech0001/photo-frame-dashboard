'use strict';
const ical = require('node-ical');
const tune = require('./tune');
const { problem, ymd } = require('./util');
function manualEvents(records, from, to) {
  const events = [];
  for (const record of records) {
    const initial = new Date(record.date + 'T12:00:00'); if (!Number.isFinite(initial.getTime())) continue;
    const day = new Date(initial); day.setHours(0,0,0,0);
    // Daily iterations are bounded by the requested window, including monthly date checks.
    const lower = new Date(Math.max(day.getTime(), from.getTime() - 86400000)); lower.setHours(0,0,0,0);
    for (let cursor = lower, attempts = 0; cursor < to && attempts < 500; cursor.setDate(cursor.getDate() + 1), attempts++) {
      if (cursor < day || record.until && ymd(cursor) > record.until) continue;
      const repeat = record.repeat || 'none';
      if (repeat === 'none' && ymd(cursor) !== ymd(day)) continue;
      if (repeat === 'weekly' && cursor.getDay() !== day.getDay()) continue;
      if (repeat === 'monthly' && cursor.getDate() !== day.getDate()) continue;
      const start = new Date(ymd(cursor) + 'T' + (record.allDay ? '00:00':record.start || '09:00') + ':00');
      const end = new Date(ymd(cursor) + 'T' + (record.allDay ? '00:00':record.end || record.start || '10:00') + ':00');
      if (record.allDay) end.setDate(end.getDate() + Math.max(1, Number(record.days) || 1)); else if (end <= start) end.setHours(end.getHours() + 1);
      if (Number.isFinite(start.getTime()) && end > from && start < to) events.push({ id:'manual-' + record.id + '-' + ymd(cursor), title:record.title, start:start.toISOString(), end:end.toISOString(), allDay:!!record.allDay, people:record.people || [], loc:record.loc || '', notes:record.notes || '', source:'Manual' });
      if (events.length > 5000) throw problem('Too many calendar events');
    }
  }
  return events;
}
function createCalendar(fetcher = fetch) {
  const cache = new Map();
  return async function getEvents({ cfg, secrets, state, from, to }) {
    const events = manualEvents(state.events || [],from,to), feeds = [];
    await Promise.all((cfg.calendars || []).slice(0,20).map(async feed => {
      const url = secrets.ical?.[feed.secret]; if (!url) { feeds.push({ name:feed.name, error:'Not connected' }); return; }
      let cached = cache.get(url);
      if (!cached || Date.now() - cached.at >= tune.get('calendarMin') * 60000) {
        try {
          const response = await fetcher(url, { signal:AbortSignal.timeout(12000) }); if (!response.ok) throw new Error();
          const reader = response.body.getReader(), chunks = []; let bytes = 0;
          try { for (;;) { const {done,value} = await reader.read(); if (done) break; bytes += value.length; if (bytes > 2 * 1024 * 1024) throw new Error(); chunks.push(Buffer.from(value)); } } finally { await reader.cancel(); }
          cached = { at:Date.now(), data:ical.sync.parseICS(Buffer.concat(chunks).toString('utf8')), error:null };
        } catch { cached = { at:Date.now(), data:cached?.data || {}, error:'Calendar unavailable' }; }
        cache.set(url,cached);
      }
      for (const item of Object.values(cached.data)) {
        if (item.type !== 'VEVENT' || item.status === 'CANCELLED') continue;
        let occurrences;
        try { occurrences = ical.expandRecurringEvent(item, { from,to, includeOverrides:true, excludeExdates:true, expandOngoing:true }); } catch { continue; }
        for (const instance of occurrences.slice(0,5000)) {
          const event = instance.event || item, start = instance.start, end = instance.end || new Date(start.getTime() + 3600000);
          if (!start || end <= from || start >= to) continue;
          events.push({ id:'ical-' + (event.uid || '') + '-' + start.getTime(), title:String(event.summary?.val || event.summary || 'Untitled'), start:start.toISOString(), end:end.toISOString(), allDay:!!instance.isFullDay, people:feed.people || [], loc:String(event.location?.val || event.location || ''), notes:String(event.description?.val || event.description || '').slice(0,280), source:feed.name });
        }
      }
      feeds.push({ name:feed.name, error:cached.error });
    }));
    return { events:events.sort((a,b) => a.start.localeCompare(b.start)).slice(0,5000), feeds };
  };
}
module.exports = { getEvents:createCalendar(), createCalendar, manualEvents, reset() {} };
