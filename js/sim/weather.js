// Game-day weather: precipitation, wind and temperature, and how they affect play.
import { climateOn } from './climate.js';
const BASE = {
  clear: { label: 'Clear', catchK: 1, fumbleK: 1, throwK: 1, footing: 1, speedK: 1, kickYds: 0, fgPen: 0 },
  rain: { label: 'Rain', catchK: 0.96, fumbleK: 1.3, throwK: 1.15, footing: 0.94, speedK: 0.98, kickYds: -3, fgPen: 0.04 },
  snow: { label: 'Snow', catchK: 0.94, fumbleK: 1.38, throwK: 1.2, footing: 0.88, speedK: 0.95, kickYds: -6, fgPen: 0.07 },
  wind: { label: 'Windy', catchK: 0.99, fumbleK: 1.05, throwK: 1, footing: 1, speedK: 1, kickYds: 0, fgPen: 0 },
  cold: { label: 'Cold', catchK: 0.98, fumbleK: 1.2, throwK: 1.05, footing: 0.98, speedK: 1, kickYds: -3, fgPen: 0.02 },
};

export const WEATHER_TYPES = Object.keys(BASE);

// type: a WEATHER_TYPES key to force conditions, or 'random' to roll them for the home team's
// city and the game date (ctx = { home, date }); without a home team, a generic roll.
export function makeWeather(type, rng, ctx = {}) {
  if (!BASE[type] && ctx.home) return climateWeather(rng, ctx.home, ctx.date || new Date());
  if (!BASE[type]) type = rollType(rng);
  const b = BASE[type];
  const windMph = type === 'wind' ? Math.round(rng.range(14, 26)) : Math.round(rng.range(0, type === 'clear' ? 8 : 12));
  const tempF = type === 'snow' ? Math.round(rng.range(18, 31)) : type === 'cold' ? Math.round(rng.range(5, 28))
    : type === 'rain' ? Math.round(rng.range(40, 62)) : Math.round(rng.range(48, 84));
  return { type, ...b, windMph, windDir: rng.range(0, Math.PI * 2), tempF };
}

function rollType(rng) {
  const r = rng.next();
  return r < 0.6 ? 'clear' : r < 0.72 ? 'rain' : r < 0.78 ? 'snow' : r < 0.9 ? 'wind' : 'cold';
}

// Conditions drawn from the home city's climate on the game date (see climate.js).
function climateWeather(rng, home, date) {
  const c = climateOn(home, date);
  const indoor = (label) => ({ type: 'clear', ...BASE.clear, label, windMph: 0, windDir: 0, tempF: 72, indoor: true });
  if (c.roof === 'dome') return indoor('Indoors');
  const tempF = Math.round(rng.normal(c.tempF, 7));
  const wet = rng.chance(c.precip * 0.6); // table values are daily; a game is a ~3-hour window
  if (c.roof === 'retract' && (wet || tempF < 50 || tempF > 88)) return indoor('Indoors (roof closed)');
  const windMph = Math.max(0, Math.round(rng.normal(c.wind, 4)));
  const snow = wet && (tempF <= 32 || (tempF <= 37 && rng.chance(0.4)));
  const type = snow ? 'snow' : wet ? 'rain' : tempF <= 32 ? 'cold' : windMph >= 16 ? 'wind' : 'clear';
  return { type, ...BASE[type], windMph, windDir: rng.range(0, Math.PI * 2), tempF: snow ? Math.min(tempF, 34) : tempF };
}

// Wind component along a team's direction of attack (mph; + = at their back).
export function windAlong(w, dir) { return w ? w.windMph * Math.cos(w.windDir) * dir : 0; }

// Throw accuracy multiplier: wind mostly bothers long throws.
export function throwFactor(w, dist) {
  if (!w) return 1;
  return w.throwK * (1 + w.windMph * (dist > 18 ? 0.014 : 0.005));
}

// Effective field goal distance after wind and conditions.
export function effectiveKickDist(w, dist, dir) {
  if (!w) return dist;
  const along = windAlong(w, dir);
  const cross = Math.abs(w.windMph * Math.sin(w.windDir));
  return dist - along * 0.25 + cross * 0.12 - w.kickYds;
}

export function describeWeather(w) {
  if (!w) return '';
  if (w.indoor) return w.label;
  const wind = w.windMph >= 5 ? `, wind ${w.windMph} mph` : '';
  return `${w.label}, ${w.tempF}°F${wind}`;
}
