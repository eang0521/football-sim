// Home-city climates for game-day weather. Values are typical kickoff conditions by month
// (Sep, Oct, Nov, Dec, Jan, Feb): temperature (°F), chance of rain or snow during the game, and
// average wind (mph). roof: 'dome' is always indoors; 'retract' closes for rain, cold or heat.
const C = (t, p, wind, roof = null) => ({ t, p, wind, roof });
export const CLIMATES = {
  // NFL cities
  Buffalo: C([68, 56, 45, 34, 27, 29], [0.30, 0.35, 0.42, 0.48, 0.48, 0.45], 12),
  Miami: C([86, 83, 78, 74, 71, 73], [0.40, 0.30, 0.18, 0.15, 0.15, 0.15], 9),
  'New England': C([68, 57, 47, 37, 30, 32], [0.28, 0.30, 0.32, 0.33, 0.33, 0.32], 10),
  'New York': C([72, 61, 51, 41, 34, 36], [0.27, 0.27, 0.28, 0.30, 0.30, 0.28], 10),
  Baltimore: C([75, 63, 53, 43, 37, 40], [0.25, 0.24, 0.26, 0.28, 0.27, 0.26], 9),
  Cincinnati: C([74, 61, 50, 39, 33, 36], [0.25, 0.25, 0.30, 0.33, 0.33, 0.32], 8),
  Cleveland: C([70, 59, 47, 36, 30, 32], [0.30, 0.32, 0.38, 0.42, 0.42, 0.40], 12),
  Pittsburgh: C([70, 58, 47, 37, 30, 32], [0.30, 0.30, 0.35, 0.38, 0.38, 0.36], 9),
  Houston: C([88, 80, 70, 62, 58, 62], [0.30, 0.25, 0.25, 0.27, 0.27, 0.25], 8, 'retract'),
  Indianapolis: C([73, 61, 49, 38, 31, 34], [0.27, 0.27, 0.32, 0.35, 0.35, 0.33], 10, 'retract'),
  Jacksonville: C([85, 78, 70, 63, 59, 63], [0.40, 0.28, 0.20, 0.22, 0.22, 0.22], 9),
  Tennessee: C([80, 68, 57, 48, 42, 46], [0.25, 0.25, 0.30, 0.33, 0.33, 0.33], 8),
  Denver: C([72, 60, 47, 40, 38, 40], [0.15, 0.18, 0.18, 0.15, 0.15, 0.18], 9),
  'Kansas City': C([77, 64, 51, 40, 33, 37], [0.25, 0.25, 0.22, 0.22, 0.20, 0.22], 11),
  'Los Angeles': C([80, 76, 70, 65, 65, 66], [0.02, 0.05, 0.10, 0.18, 0.20, 0.22], 7, 'dome'),
  'Las Vegas': C([92, 78, 64, 55, 55, 60], [0.03, 0.04, 0.05, 0.08, 0.08, 0.10], 9, 'dome'),
  Dallas: C([88, 78, 66, 57, 54, 58], [0.18, 0.22, 0.20, 0.20, 0.18, 0.20], 10, 'retract'),
  Philadelphia: C([75, 63, 52, 42, 36, 38], [0.27, 0.26, 0.28, 0.30, 0.30, 0.28], 10),
  Washington: C([77, 65, 54, 44, 38, 41], [0.25, 0.24, 0.26, 0.27, 0.27, 0.26], 9),
  Chicago: C([70, 58, 45, 33, 26, 29], [0.28, 0.30, 0.32, 0.35, 0.33, 0.32], 13),
  Detroit: C([70, 58, 46, 35, 28, 30], [0.28, 0.30, 0.34, 0.38, 0.38, 0.35], 11, 'dome'),
  'Green Bay': C([66, 53, 40, 27, 19, 22], [0.30, 0.30, 0.30, 0.32, 0.30, 0.28], 11),
  Minnesota: C([68, 54, 39, 25, 18, 22], [0.28, 0.28, 0.25, 0.28, 0.25, 0.25], 10, 'dome'),
  Atlanta: C([82, 72, 62, 53, 49, 53], [0.25, 0.22, 0.27, 0.30, 0.30, 0.30], 8, 'dome'),
  Carolina: C([80, 69, 59, 50, 45, 49], [0.25, 0.22, 0.24, 0.27, 0.27, 0.25], 8),
  'New Orleans': C([87, 80, 70, 63, 59, 63], [0.30, 0.20, 0.22, 0.27, 0.27, 0.27], 8, 'dome'),
  'Tampa Bay': C([88, 83, 76, 70, 67, 70], [0.45, 0.25, 0.17, 0.17, 0.17, 0.17], 9),
  Arizona: C([97, 85, 72, 64, 64, 68], [0.08, 0.06, 0.06, 0.10, 0.10, 0.10], 7, 'retract'),
  Seattle: C([68, 58, 48, 42, 42, 45], [0.20, 0.38, 0.52, 0.55, 0.52, 0.48], 8),
  'San Francisco': C([80, 74, 64, 57, 57, 61], [0.04, 0.10, 0.22, 0.32, 0.35, 0.32], 10),
  // fictional league cities
  Portland: C([72, 62, 52, 45, 44, 47], [0.18, 0.35, 0.50, 0.55, 0.52, 0.45], 8),
  'San Antonio': C([90, 82, 70, 62, 60, 65], [0.20, 0.20, 0.15, 0.15, 0.15, 0.15], 9),
  Memphis: C([83, 72, 60, 51, 46, 50], [0.20, 0.22, 0.30, 0.35, 0.32, 0.32], 8),
  'Salt Lake': C([80, 64, 49, 38, 34, 40], [0.12, 0.18, 0.20, 0.22, 0.22, 0.22], 8),
  Birmingham: C([84, 73, 62, 54, 49, 54], [0.22, 0.20, 0.28, 0.32, 0.32, 0.30], 7),
  Orlando: C([88, 83, 76, 71, 68, 72], [0.45, 0.25, 0.15, 0.15, 0.15, 0.15], 9),
  Omaha: C([77, 63, 48, 35, 28, 32], [0.22, 0.20, 0.15, 0.15, 0.12, 0.15], 12),
  Sacramento: C([88, 78, 63, 54, 54, 59], [0.03, 0.08, 0.20, 0.30, 0.35, 0.30], 8),
};
// A city not in the table (e.g. renamed in the editor): a middle-of-the-country climate.
const DEFAULT = C([76, 64, 52, 42, 36, 40], [0.25, 0.25, 0.27, 0.28, 0.27, 0.27], 10);

export const climateFor = (team) => CLIMATES[team?.city] || DEFAULT;

// Season position (fractional months after Sep 1, clamped to Sep–Feb) for a date.
function seasonPos(date) {
  const m = date.getMonth(), d = date.getDate();
  const idx = m >= 8 ? m - 8 : m <= 1 ? m + 4 : m <= 4 ? 5 : 0; // Mar–May → Feb, Jun–Aug → Sep
  if ((m >= 2 && m <= 7)) return idx;
  return Math.max(0, Math.min(5, idx + (d - 15) / 30));
}
const lerp = (arr, x) => { const i = Math.floor(x), f = x - i; return arr[Math.min(5, i)] * (1 - f) + arr[Math.min(5, i + 1)] * f; };

// Typical conditions at this city on this date.
export function climateOn(team, date) {
  const c = climateFor(team), x = seasonPos(date);
  return { tempF: lerp(c.t, x), precip: lerp(c.p, x), wind: c.wind, roof: c.roof };
}

// Rough calendar date of a season game: week 1 is the second week of September, one week apart,
// so week 18 lands in early January; playoff rounds follow the last regular-season week.
export function seasonDate(weekIndex) {
  const d = new Date(2026, 8, 10);
  d.setDate(d.getDate() + 7 * weekIndex);
  return d;
}
