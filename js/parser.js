/**
 * CubanSocial — Client-side event text parser
 * Slice 3: extracts fields from pasted WhatsApp / social media text.
 */

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------
const MONTH_MAP = {
  jan:0, feb:1, mar:2, apr:3, may:4, jun:5,
  jul:6, aug:7, sep:8, oct:9, nov:10, dec:11,
  january:0, february:1, march:2, april:3, june:5,
  july:6, august:7, september:8, october:9, november:10, december:11,
};

const WEEKDAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

function parseTime(str) {
  // Returns {hours, minutes} or null
  const m = str.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const ampm = m[3]?.toLowerCase();
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  return { hours: h, minutes: min };
}

// ---------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------

/**
 * Parse raw event text and return a partial event object.
 * @param {string} rawText
 * @param {string[]} knownCities   Array of city names (from DB)
 * @param {string[]} knownStyles   Array of dance style names (from DB)
 * @returns {object} partial form fields
 */
export function parseEventText(rawText, knownCities = [], knownStyles = []) {
  const text = rawText;
  const lower = text.toLowerCase();
  const result = {};

  // --- Date ---
  // Pattern: "June 28", "Jun 28", "6/28", "6-28"
  const datePatterns = [
    // "Month DD[, YYYY]"
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2})(?:[,\s]+(\d{4}))?\b/i,
    // "MM/DD[/YYYY]" or "MM-DD"
    /\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{4}))?\b/,
    // "this Friday" / "next Saturday"
    /\b(this|next)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  ];

  for (const pat of datePatterns) {
    const m = text.match(pat);
    if (!m) continue;

    const now = new Date();
    let date;

    if (pat === datePatterns[0]) {
      const month = MONTH_MAP[m[1].toLowerCase()];
      const day   = parseInt(m[2], 10);
      const year  = m[3] ? parseInt(m[3], 10) : now.getFullYear();
      date = new Date(year, month, day);
      if (date < now) date.setFullYear(date.getFullYear() + 1);
    } else if (pat === datePatterns[1]) {
      const month = parseInt(m[1], 10) - 1;
      const day   = parseInt(m[2], 10);
      const year  = m[3] ? parseInt(m[3], 10) : now.getFullYear();
      date = new Date(year, month, day);
      if (date < now) date.setFullYear(date.getFullYear() + 1);
    } else {
      const modifier = m[1].toLowerCase();
      const targetDay = WEEKDAYS.indexOf(m[2].toLowerCase());
      const today = now.getDay();
      let diff = targetDay - today;
      if (modifier === 'next' || diff <= 0) diff += 7;
      date = new Date(now);
      date.setDate(now.getDate() + diff);
    }

    result.date = date.toISOString().slice(0, 10);
    break;
  }

  // --- Time ---
  const timePattern = /\bat\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i;
  const timeMatch = text.match(timePattern);
  if (timeMatch) {
    const t = parseTime(timeMatch[1]);
    if (t) {
      const hh = String(t.hours).padStart(2, '0');
      const mm = String(t.minutes).padStart(2, '0');
      result.startTime = `${hh}:${mm}`;
      if (result.date) result.start_at = `${result.date}T${hh}:${mm}`;
    }
  }

  // --- Cost ---
  if (/\bfree\b/i.test(text))             result.cost_type = 'free';
  else if (/\bpotluck\b/i.test(text))     result.cost_type = 'potluck';
  else if (/\btips?\b/i.test(text))       result.cost_type = 'tips';
  else if (/\$\d+/i.test(text))           result.cost_type = 'paid';
  const costAmount = text.match(/\$(\d+(?:\.\d{1,2})?)/);
  if (costAmount) result.cost_amount = parseFloat(costAmount[1]);

  // --- Dance styles (case-insensitive match against DB list) ---
  result.dance_style_ids = [];
  for (const style of knownStyles) {
    // Match exact word boundaries (handles "Cha-cha-chá" etc.)
    const escaped = style.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\b`, 'i').test(text)) {
      result.dance_style_ids.push(style.id);
    }
  }

  // --- City ---
  for (const city of knownCities) {
    if (lower.includes(city.name.toLowerCase())) {
      result.city_id = city.id;
      break;
    }
  }

  // --- Address heuristic ---
  const addressMatch = text.match(/\d{2,5}\s+[A-Za-z0-9\s]{4,50}(?:St|Ave|Blvd|Rd|Dr|Ln|Way|Pl|Ct|Circle|Court)\b/i);
  if (addressMatch) result.address = addressMatch[0].trim();

  // Count filled required fields
  const REQUIRED = ['date', 'city_id', 'startTime'];
  result._filledCount = REQUIRED.filter((f) => result[f] !== undefined).length;

  return result;
}
