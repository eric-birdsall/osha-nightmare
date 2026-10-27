import { campaignLevel } from '../world/campaign.js';
import { receivingOrder } from '../world/receiving-orders.js';
import { CONFIG } from '../config.js';
import { ORDERS, WAREHOUSE_VERSION } from '../world/level.js';

// Best times, kept in this browser per level and per mode ('single' / 'coop'). A run's score is
// its time plus a penalty per incident. Each level has a version (the warehouse's, plus a hash of
// its order), so changing an order or re-baking the warehouse drops that level's old times rather
// than comparing runs of different levels.

const KEY = 'osha.records';

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

// A level: one order, or 'shift' (Full Shift: all five back to back, with medal targets that are
// the five orders' added up)
const sum = (k) => ORDERS.reduce((t, o) => t + (o.medals?.[k] ?? 0), 0);
export const FULL_SHIFT = { id: 'shift', title: 'Full Shift', medals: { gold: sum('gold'), silver: sum('silver'), bronze: sum('bronze') } };
export const levelDef = (id) => (campaignLevel(id) || receivingOrder(id) || (id === 'shift' ? FULL_SHIFT : ORDERS.find((o) => o.id === id)));

// What a run of the level depends on: the warehouse, and the orders' lines and docks (not the
// medal targets, which can be retuned without making old times incomparable)
function levelVersion(id) {
  const combined = campaignLevel(id);
  const orders = combined ? [combined.shipping, combined.receiving] : receivingOrder(id) ? [receivingOrder(id)] : id === 'shift' ? ORDERS : ORDERS.filter((x) => x.id === id);
  return `${WAREHOUSE_VERSION}:wrap-v2:${hash(JSON.stringify(orders.map((o) => [o.lines, o.dock, o.pallets, !!o.tutorial])))}`;
}

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

function save(all) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // private window or storage blocked: bests just don't stick
  }
}

export const scoreOf = ({ time, incidents }) => time + incidents * CONFIG.score.incidentPenalty;

// This mode's best run of a level ({ total, time, incidents }), or null
export function best(mode, id) {
  const r = load()[`${mode}:${id}`];
  return r && r.version === levelVersion(id) ? r : null;
}

// Record a finished run. Returns { total, best, isNewBest }.
export function submit(mode, id, run) {
  const total = scoreOf(run);
  const all = load();
  const key = `${mode}:${id}`;
  const prev = best(mode, id);
  const isNewBest = !prev || total < prev.total;
  if (isNewBest) {
    all[key] = { version: levelVersion(id), total, time: run.time, incidents: run.incidents };
    save(all);
  }
  return { total, best: isNewBest ? total : prev.total, isNewBest };
}

// 'gold' | 'silver' | 'bronze' | null for a total on this level (targets in orders.json)
export function medalFor(id, total) {
  const m = levelDef(id)?.medals;
  if (!m) return null;
  return ['gold', 'silver', 'bronze'].find((k) => total <= m[k]) ?? null;
}

// The next medal up and its target, for "Silver at 2:30"
export function nextMedal(id, total) {
  const m = levelDef(id)?.medals;
  if (!m) return null;
  const k = ['bronze', 'silver', 'gold'].find((k) => total > m[k]);
  return k ? { medal: k, at: m[k] } : null;
}

// 83.4 -> "1:23.4"
export function fmtTime(s) {
  const t = Math.floor(s * 10) / 10; // tenths, rounded down (so 59.96 doesn't read 0:60.0)
  const m = Math.floor(t / 60);
  const r = t - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`;
}
