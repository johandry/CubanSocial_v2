/**
 * CubanSocial — .ics calendar file generator
 * No dependencies — pure JS.
 */

/**
 * Escape special characters for iCalendar format.
 */
function icsEscape(str) {
  return (str ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

/**
 * Format a Date to iCal DTSTART/DTEND format (UTC).
 * e.g. "20260628T200000Z"
 */
function toIcsDate(isoStr) {
  const d = new Date(isoStr);
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Generate an .ics file content string for a single event.
 * @param {object} event  DB row
 * @param {object} city   cities row
 * @returns {string} full .ics content
 */
export function generateIcs(event, city) {
  const now = toIcsDate(new Date().toISOString());
  const dtStart = toIcsDate(event.start_at);
  // Default end = start + 3 hours if no end_at
  const dtEnd = event.end_at
    ? toIcsDate(event.end_at)
    : toIcsDate(new Date(new Date(event.start_at).getTime() + 3 * 60 * 60 * 1000).toISOString());

  const location = event.is_private
    ? `${city?.name ?? ''}` 
    : [event.address, city?.name].filter(Boolean).join(', ');

  const uid = `${event.id}@cubansocial.com`;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CubanSocial//CubanSocial.com//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${icsEscape(event.name)}`,
    `DESCRIPTION:${icsEscape(event.description)}`,
    `LOCATION:${icsEscape(location)}`,
    `URL:https://cubansocial.com/event/${event.id}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lines.join('\r\n');
}

/**
 * Trigger a browser download of the .ics file.
 */
export function downloadIcs(event, city) {
  const content = generateIcs(event, city);
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${event.name.replace(/\s+/g, '-')}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
