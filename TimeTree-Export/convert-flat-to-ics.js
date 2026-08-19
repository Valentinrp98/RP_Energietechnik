const fs = require('fs');

function icsEscape(str) {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function foldLine(line) {
  if (line.length <= 75) return line;
  let out = line.slice(0, 75);
  let rest = line.slice(75);
  while (rest.length > 0) {
    out += '\r\n ' + rest.slice(0, 74);
    rest = rest.slice(74);
  }
  return out;
}

function pad(n) { return String(n).padStart(2, '0'); }

function formatDateUTC(date, allDay) {
  if (allDay) {
    return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
  }
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

function checklistToText(attachment) {
  if (!attachment || !attachment.checklist || !attachment.checklist.length) return null;
  return attachment.checklist
    .map(item => `${item.checked ? '[x]' : '[ ]'} ${item.title}`)
    .join('\\n');
}

function buildVEvent(ev) {
  const start = new Date(ev.start_at);
  const end = new Date(ev.end_at);
  const lines = [];
  lines.push('BEGIN:VEVENT');
  lines.push(foldLine(`UID:${ev.id}@timetree-export`));
  lines.push(`DTSTAMP:${formatDateUTC(new Date(ev.updated_at || ev.created_at || ev.start_at), false)}`);

  if (ev.all_day) {
    const endExclusive = new Date(end.getTime() + 24 * 60 * 60 * 1000);
    lines.push(`DTSTART;VALUE=DATE:${formatDateUTC(start, true)}`);
    lines.push(`DTEND;VALUE=DATE:${formatDateUTC(endExclusive, true)}`);
  } else {
    const tzid = ev.start_timezone && ev.start_timezone !== 'UTC' ? `;TZID=${ev.start_timezone}` : '';
    lines.push(`DTSTART${tzid}:${formatDateUTC(start, false).replace('Z', tzid ? '' : 'Z')}`);
    const etzid = ev.end_timezone && ev.end_timezone !== 'UTC' ? `;TZID=${ev.end_timezone}` : '';
    lines.push(`DTEND${etzid}:${formatDateUTC(end, false).replace('Z', etzid ? '' : 'Z')}`);
  }

  lines.push(foldLine(`SUMMARY:${icsEscape(ev.title || '(Ohne Titel)')}`));
  if (ev.location) lines.push(foldLine(`LOCATION:${icsEscape(ev.location)}`));

  const noteText = ev.note ? icsEscape(ev.note) : null;
  const checklistText = checklistToText(ev.attachment);
  const desc = [noteText, checklistText].filter(Boolean).join('\\n\\n');
  if (desc) lines.push(foldLine(`DESCRIPTION:${desc}`));

  if (ev.recurrences && ev.recurrences.length) {
    for (const rule of ev.recurrences) {
      if (rule.startsWith('RRULE:')) lines.push(rule);
      else if (rule.startsWith('EXDATE:')) lines.push(rule);
    }
  }

  lines.push('END:VEVENT');
  return lines.join('\r\n');
}

function convert(inputFile, outputFile, calendarName, cutoffDateStr) {
  const events = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  const cutoff = cutoffDateStr ? new Date(cutoffDateStr).getTime() : null;

  const seen = new Set();
  const active = [];
  let filteredOut = 0;
  for (const ev of events) {
    if (ev.deactivated_at) continue;
    if (seen.has(ev.id)) continue;
    if (cutoff !== null && ev.start_at < cutoff && !(ev.recurrences && ev.recurrences.length)) {
      filteredOut++;
      continue;
    }
    seen.add(ev.id);
    active.push(ev);
  }

  const lines = [];
  lines.push('BEGIN:VCALENDAR');
  lines.push('VERSION:2.0');
  lines.push('PRODID:-//TimeTree Export//DE');
  lines.push('CALSCALE:GREGORIAN');
  if (calendarName) lines.push(foldLine(`X-WR-CALNAME:${icsEscape(calendarName)}`));

  for (const ev of active) {
    lines.push(buildVEvent(ev));
  }

  lines.push('END:VCALENDAR');
  fs.writeFileSync(outputFile, lines.join('\r\n'), 'utf8');

  console.log(`${outputFile}: ${events.length} roh -> ${active.length} aktiv (${filteredOut} vor Cutoff gefiltert, Rest gelöscht/dupliziert übersprungen)`);
}

const [, , inputFile, outputFile, calendarName, cutoffDateStr] = process.argv;
if (!inputFile || !outputFile) {
  console.log('Usage: node convert-flat-to-ics.js <input.json> <output.ics> [calendarName] [cutoffDateISO]');
  process.exit(1);
}
convert(inputFile, outputFile, calendarName, cutoffDateStr);
