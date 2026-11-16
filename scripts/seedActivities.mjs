/**
 * RunTrack demo-data seeder.
 *
 * Signs in with a real Email/Password account (created in the app) and writes
 * realistic walk / trail / run / cycle activities to Firestore so History and
 * Detail look alive for demos. Routes are generated around two anchor points:
 * Lodha Luxuria, Majiwada (Thane) and VJTI / Five Gardens (Matunga).
 *
 * Rules compliance (firestore.rules): activities are create-only and must be
 * attributed to the signed-in user; the script never updates or deletes.
 *
 * Idempotent: each seed uses a fixed document ID and is skipped if it already
 * exists, so re-running never duplicates or errors.
 *
 * Usage (from the repo root):
 *   node scripts/seedActivities.mjs --email you@example.com --password secret
 *   node scripts/seedActivities.mjs --dry-run   # plan only, no writes, no auth
 *   Omitting --email/--password prompts for them interactively.
 */

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { createInterface } from 'node:readline/promises';
import { readFileSync } from 'node:fs';

/* ── Configuration from app.json ─────────────────────────────────────────── */

const appJson = JSON.parse(
  readFileSync(new URL('../app.json', import.meta.url), 'utf8'),
);
const firebaseConfig = appJson.expo?.extra?.firebase;

function missingConfig() {
  const required = ['apiKey', 'authDomain', 'projectId', 'storageBucket',
    'messagingSenderId', 'appId'];
  return required.filter((key) => !firebaseConfig?.[key] ||
    String(firebaseConfig[key]).includes('PASTE_'));
}

/* ── Deterministic RNG + helpers ─────────────────────────────────────────── */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rough standard normal from the sum of three uniforms. */
function gauss(rand) {
  return (rand() + rand() + rand() - 1.5) * 0.8165;
}

function haversineMeters(a, b) {
  const R = 6_371_000;
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const METERS_PER_DEG = 111_320;

/** Measured polyline length of the generated points, in km. */
function measureKm(points) {
  let meters = 0;
  for (let i = 1; i < points.length; i++) meters += haversineMeters(points[i - 1], points[i]);
  return meters / 1000;
}

function offsetLatLng(lat, lng, eastMeters, northMeters) {
  return {
    lat: lat + northMeters / METERS_PER_DEG,
    lng: lng + eastMeters / (METERS_PER_DEG * Math.cos(lat * (Math.PI / 180))),
  };
}

/* ── Route generation ────────────────────────────────────────────────────── */

/**
 * An organic-looking closed loop: a base circle whose radius wobbles with a
 * few harmonics plus per-point GPS-style jitter. Points are ordered by angle,
 * then measured with haversine so distanceKm always matches the drawn line.
 */
function buildLoop({
  centerLat, centerLng, loopKm, stepMeters, seed,
  wobbleCount = 3, wobbleAmp = 0.15, jitterMeters = 2, phase = 0,
}) {
  const rand = mulberry32(seed);
  const baseRadius = (loopKm * 1000) / (2 * Math.PI);
  const count = Math.max(8, Math.round((loopKm * 1000) / stepMeters));
  const points = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * 2 * Math.PI;
    // Low-frequency harmonics shape the loop. High-frequency wobble would
    // inflate the measured distance (the path gains radial velocity), and
    // white-noise offsets would tear the polyline apart point to point.
    const radius = baseRadius *
      (1 + wobbleAmp * Math.sin(wobbleCount * angle + phase) +
        wobbleAmp * 0.4 * Math.sin((wobbleCount + 2) * angle + phase * 2));
    // GPS-style drift: smooth wandering plus a little white noise.
    const driftX = jitterMeters * (Math.sin(11 * angle + phase) + 0.3 * gauss(rand));
    const driftY = jitterMeters * (Math.sin(13 * angle + phase * 3) + 0.3 * gauss(rand));
    points.push(offsetLatLng(
      centerLat, centerLng,
      Math.cos(angle) * radius + driftX,
      Math.sin(angle) * radius + driftY,
    ));
  }
  return points;
}

/** RoutePoint[] with epoch-ms timestamps and m/s speeds, plus measured km. */function buildRoute({ points, startMs, endMs, speedNoiseSeed = 7 }) {
  const rand = mulberry32(speedNoiseSeed);
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) {
    cumulative.push(cumulative[i - 1] + haversineMeters(points[i - 1], points[i]));
  }
  const total = cumulative[cumulative.length - 1];
  const spanMs = endMs - startMs;
  const route = [];
  for (let i = 0; i < points.length; i++) {
    const fraction = total > 0 ? cumulative[i] / total : i / points.length;
    const timestamp = Math.round(startMs + fraction * spanMs);
    const point = { lat: points[i].lat, lng: points[i].lng, timestamp };
    if (i > 0) {
      const dtSec = (timestamp - route[i - 1].timestamp) / 1000;
      const segmentMeters = cumulative[i] - cumulative[i - 1];
      if (dtSec > 0) {
        const speed = Math.max(0, segmentMeters / dtSec + gauss(rand) * 0.08);
        point.speed = Math.round(speed * 100) / 100;
      }
    }
    route.push(point);
  }
  if (route.length > 0) route[route.length - 1].timestamp = endMs;
  return { route, totalKm: total / 1000 };
}

/* ── Demo plan ───────────────────────────────────────────────────────────── */

// Anchor areas supplied by the user:
const THANE_HOME = { lat: 19.2017, lng: 72.9743 };  // Lodha Luxuria, Majiwada
const UPVAN_LAKE = { lat: 19.2206, lng: 72.9753 };  // Upvan Lake, Thane
const YEOR_TRAIL = { lat: 19.226, lng: 72.97 };    // Yeoor hills, SGNP edge
const THANE_CREEK = { lat: 19.21, lng: 72.98 };     // Kalwa / creek side
const VJTI_MATUNGA = { lat: 19.0226, lng: 72.8569 }; // VJTI campus
const FIVE_GARDENS = { lat: 19.0252, lng: 72.8572 }; // Five Gardens, Matunga
const KING_CIRCLE = { lat: 19.028, lng: 72.858 };   // King Circle, Matunga

const CALORIES_PER_KM = { run: 72, walk: 52, cycle: 26 };

/** Trails are recorded as slower, longer walks; cycles ride at ~20-24 km/h. */
const PLAN = [
  {
    slug: 'thane-upvan-lake-walk', label: 'Upvan Lake morning walk', type: 'walk',
    center: UPVAN_LAKE, loopKm: 4.2, paceSecPerKm: 780, dayOffset: 2, hour: 6, minute: 45,
  },
  {
    slug: 'matunga-five-gardens-walk', label: 'Five Gardens lunchtime walk', type: 'walk',
    center: FIVE_GARDENS, loopKm: 2.4, paceSecPerKm: 800, dayOffset: 4, hour: 13, minute: 10,
  },
  {
    slug: 'thane-majiwada-evening-walk', label: 'Evening walk around Majiwada', type: 'walk',
    center: THANE_HOME, loopKm: 3.1, paceSecPerKm: 760, dayOffset: 6, hour: 19, minute: 30,
  },
  {
    slug: 'matunga-vjti-evening-walk', label: 'Walk after college near VJTI', type: 'walk',
    center: VJTI_MATUNGA, loopKm: 3.6, paceSecPerKm: 820, dayOffset: 8, hour: 17, minute: 20,
  },
  {
    slug: 'thane-upvan-lake-run', label: 'Morning run around Upvan Lake', type: 'run',
    center: UPVAN_LAKE, loopKm: 6.2, paceSecPerKm: 372, dayOffset: 7, hour: 6, minute: 30,
  },
  {
    slug: 'matunga-vjti-run', label: 'Evening run near campus', type: 'run',
    center: VJTI_MATUNGA, loopKm: 5.1, paceSecPerKm: 395, dayOffset: 11, hour: 18, minute: 5,
  },
  {
    slug: 'yeoor-hills-trail-walk', label: 'Yeoor hills trail hike', type: 'walk',
    center: YEOR_TRAIL, loopKm: 7.6, paceSecPerKm: 900, dayOffset: 12, hour: 7, minute: 15,
    wobbleAmp: 0.22, wobbleCount: 5, jitterMeters: 5, stepMeters: 4,
  },
  {
    slug: 'thane-creek-cycle', label: 'Long ride along Thane creek', type: 'cycle',
    center: THANE_CREEK, loopKm: 16.5, paceSecPerKm: 168, dayOffset: 9, hour: 7, minute: 0,
    stepMeters: 8, jitterMeters: 6,
  },
  {
    slug: 'yeoor-ghodbunder-cycle', label: 'Hill ride toward Yeoor', type: 'cycle',
    center: THANE_HOME, loopKm: 11.8, paceSecPerKm: 182, dayOffset: 14, hour: 6, minute: 40,
    stepMeters: 8, wobbleAmp: 0.2, wobbleCount: 4,
  },
  {
    slug: 'matunga-king-circle-cycle', label: 'Matunga–King Circle loop ride', type: 'cycle',
    center: KING_CIRCLE, loopKm: 9.7, paceSecPerKm: 175, dayOffset: 3, hour: 6, minute: 55,
    stepMeters: 8,
  },
];

const STEP_METERS = { walk: 3, run: 3, cycle: 8, trail: 4 };

function startDate({ dayOffset, hour, minute }) {
  const date = new Date();
  date.setDate(date.getDate() - dayOffset);
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
}

function planActivities() {
  return PLAN.map((entry) => {
    const stepMeters = entry.stepMeters ?? STEP_METERS[entry.type];
    const points = buildLoop({
      centerLat: entry.center.lat,
      centerLng: entry.center.lng,
      loopKm: entry.loopKm,
      stepMeters,
      seed: hashSlug(entry.slug),
      wobbleAmp: entry.wobbleAmp,
      wobbleCount: entry.wobbleCount,
      jitterMeters: entry.jitterMeters,
      phase: entry.phase ?? hashSlug(entry.slug) % 6,
    });
    const startMs = startDate(entry);
    // Duration derives from the measured polyline distance, then the route
    // timestamps are stretched to it, so stats and map always agree.
    const durationSec = Math.round(measureKm(points) * entry.paceSecPerKm);
    const endMs = startMs + durationSec * 1000;
    const timed = buildRoute({
      points, startMs, endMs, speedNoiseSeed: hashSlug(entry.slug) + 1,
    });
    const distanceKm = Math.round(timed.totalKm * 100) / 100;
    return {
      ...entry,
      docIdSuffix: entry.slug,
      distanceKm,
      durationSec,
      avgPaceSecPerKm: Math.round((durationSec / distanceKm) * 10) / 10,
      caloriesEstimate: Math.round(distanceKm * CALORIES_PER_KM[entry.type]),
      route: timed.route,
      startMs,
      endMs,
    };
  });
}

function hashSlug(slug) {
  let hash = 2166136261;
  for (const char of slug) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/* ── Firestore writes ────────────────────────────────────────────────────── */

function activityDocument(uid, planned) {
  return {
    userId: uid,
    type: planned.type,
    startTime: Timestamp.fromMillis(planned.startMs),
    endTime: Timestamp.fromMillis(planned.endMs),
    durationSec: planned.durationSec,
    distanceKm: planned.distanceKm,
    avgPaceSecPerKm: planned.avgPaceSecPerKm,
    caloriesEstimate: planned.caloriesEstimate,
    route: planned.route,
    createdAt: serverTimestamp(),
  };
}

function paceLabel(secPerKm) {
  const total = Math.round(secPerKm);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')} /km`;
}

/* ── CLI ─────────────────────────────────────────────────────────────────── */

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1] ?? '';
  }
  return args;
}

async function promptIfMissing(rl, args, key, question) {
  if (args[key]) return args[key];
  return (await rl.question(question)).trim();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const missing = missingConfig();
  if (missing.length > 0) {
    console.error(
      `\n✖ app.json still has placeholder Firebase config (missing: ${missing.join(', ')}).\n` +
      '  Complete steps 1-6 of docs/FIREBASE_SETUP.md first, then re-run.\n');
    process.exit(1);
  }

  const planned = planActivities();
  console.log(`\nPlanned ${planned.length} demo activities:\n`);
  for (const entry of planned) {
    console.log(
      `  ${entry.label.padEnd(34)} ${entry.type.padEnd(6)} ` +
      `${entry.distanceKm.toFixed(2)} km  ${paceLabel(entry.avgPaceSecPerKm)}  ` +
      `${entry.route.length} pts  ${new Date(entry.startMs).toLocaleString()}`);
  }
  if (args['dry-run']) {
    console.log('\n(dry run — nothing was written)\n');
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const email = await promptIfMissing(rl, args, 'email', '\nAccount email: ');
  const password = await promptIfMissing(rl, args, 'password', 'Account password: ');
  rl.close();
  if (!email || !password) {
    console.error('\n✖ Email and password are required (use the account you signed up with in the app).');
    process.exit(1);
  }

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  let credential;
  try {
    credential = await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    console.error(`\n✖ Sign-in failed: ${error.code ?? error}. ` +
      'Create the account in the app first (Sign Up screen), then re-run.');
    process.exit(1);
  }
  const uid = credential.user.uid;
  const db = getFirestore(app);

  console.log(`\nSigned in as ${email} (uid ${uid}). Seeding…\n`);
  let created = 0;
  let skipped = 0;
  for (const entry of planned) {
    const ref = doc(db, 'activities', `seed-${uid}-${entry.docIdSuffix}`);
    const existing = await getDoc(ref);
    if (existing.exists()) {
      console.log(`  ⏭  ${entry.label} — already seeded, skipping`);
      skipped++;
      continue;
    }
    try {
      await setDoc(ref, activityDocument(uid, entry));
      console.log(`  ✔  ${entry.label} — written (${entry.route.length} route points)`);
      created++;
    } catch (error) {
      console.error(`  ✖  ${entry.label} — ${error.code ?? error.message ?? error}`);
      if (error.code === 'permission-denied') {
        console.error('     Deploy firestore.rules first (step 4 of docs/FIREBASE_SETUP.md).');
      }
    }
  }

  console.log(
    `\nDone: ${created} written, ${skipped} skipped, ` +
    `${planned.length - created - skipped} failed.\n` +
    `Open the app → History tab (pull to refresh) to see them, or inspect them at:\n` +
    `https://console.firebase.google.com/project/${firebaseConfig.projectId}/firestore/data/~2Factivities\n` +
    `To remove demo data later, delete the docs whose IDs start with "seed-" in the console ` +
    `(the app itself can never delete activities).\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
