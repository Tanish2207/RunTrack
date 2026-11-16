/**
 * Dynamic Expo app config (#003): app.json stays committed with PASTE_
 * placeholders, while real client identifiers live in the git-ignored
 * firebase.local.json. Copy firebase.local.example.json → firebase.local.json
 * and fill it in per docs/FIREBASE_SETUP.md. Without that file the app runs
 * with placeholders (repositories fail fast; dev sign-in still previews UI).
 */
const base = require('./app.json');

let local = {};
try {
  local = require('./firebase.local.json');
} catch {
  // No local overrides — placeholders remain and the config guard handles it.
}

const expo = { ...base.expo };
expo.extra = {
  ...(base.expo.extra ?? {}),
  firebase: { ...(base.expo.extra?.firebase ?? {}), ...(local.firebase ?? {}) },
};

module.exports = expo;
