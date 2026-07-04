/**
 * CubanSocial — Instagram caption draft generator
 * Called after admin approves an event.
 */

const STYLE_HASHTAGS = {
  'timba':        '#Timba #CubanSalsa',
  'salsa-on1':    '#Salsa #SalsaOn1',
  'salsa-on2':    '#Salsa #SalsaOn2',
  'bachata':      '#Bachata',
  'merengue':     '#Merengue',
  'cumbia':       '#Cumbia',
  'cha-cha-cha':  '#ChaCha',
  'mambo':        '#Mambo',
  'kizomba':      '#Kizomba',
  'reggaeton':    '#Reggaeton',
  'guaracha':     '#Guaracha',
  'son-cubano':   '#SonCubano',
};

/**
 * Format a Date object to "Saturday, June 28 at 8:00 PM" style.
 */
function fmtDate(isoString) {
  const d = new Date(isoString);
  return d.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  }) + ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/**
 * Truncate text at nearest word boundary.
 */
function truncate(str, maxLen = 150) {
  if (!str || str.length <= maxLen) return str || '';
  const cut = str.lastIndexOf(' ', maxLen);
  return str.slice(0, cut > 0 ? cut : maxLen) + '…';
}

/**
 * Generate an Instagram caption draft for an approved event.
 * @param {object} event  - event row from DB
 * @param {object} city   - cities row
 * @param {Array}  styles - dance_styles rows for this event
 * @returns {string} caption text
 */
export function generateInstagramDraft(event, city, styles) {
  const cityName  = city?.name ?? '';
  const startFmt  = fmtDate(event.start_at);
  const endFmt    = event.end_at ? `, until ${fmtDate(event.end_at)}` : '';
  const desc      = truncate(event.description);
  const styleList = styles.map((s) => s.name).join(' | ');
  const costStr   = event.cost_type === 'free'
    ? 'Free admission'
    : event.cost_amount
      ? `$${event.cost_amount}`
      : event.cost_type;
  const addressLine = (!event.is_private && event.address)
    ? `\n${event.address}, ${cityName}`
    : '';

  // Style hashtags
  const styleHashtags = styles
    .map((s) => STYLE_HASHTAGS[s.slug] ?? `#${s.name.replace(/\s+/g, '')}`)
    .join(' ');
  const citySlug = cityName.replace(/\s+/g, '');

  const caption = [
    `${event.name} — ${cityName}`,
    `${startFmt}${endFmt}`,
    '',
    desc,
    '',
    `${styleList} | ${costStr}`,
    addressLine,
    '',
    'More events: CubanSocial.com',
    '',
    `#CubanSocial ${styleHashtags} #${citySlug}Dance #LatinDance #CubanSalsa #Timba`,
  ].filter((l) => l !== null).join('\n').trim();

  return caption;
}
