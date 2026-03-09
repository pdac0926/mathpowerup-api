require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');

const app  = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://lecille_math:pdac0926@cluster0.ht2djy2.mongodb.net/?appName=Cluster0';
const DB_NAME   = 'mathpowerup';

// ── Middleware ──────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '5mb' })); // allow avatar base64

// ── MongoDB Connection ──────────────────────────────────
let db;
const client = new MongoClient(MONGO_URI, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true }
});

async function connectDB() {
  await client.connect();
  db = client.db(DB_NAME);
  console.log('✅ Connected to MongoDB:', DB_NAME);
  // Create indexes
  await db.collection('users').createIndex({ username: 1 }, { unique: true });
  await db.collection('pending').createIndex({ username: 1 }, { unique: true });
  await db.collection('history').createIndex({ un: 1, ts: -1 });
  await db.collection('refs').createIndex({ un: 1, dateVal: 1 }, { unique: true });
  await db.collection('online').createIndex({ ts: 1 }, { expireAfterSeconds: 30 });
  await db.collection('notifs').createIndex({ un: 1, ts: -1 });
  // Ensure admin exists
  await db.collection('users').updateOne(
    { username: 'lecille' },
    { $setOnInsert: { username: 'lecille', name: 'Teacher Lecille', password: 'lecille2025', isAdmin: true, totalXP: 0, createdAt: Date.now() }},
    { upsert: true }
  );
  console.log('✅ Admin account ready');
}

// ── Helper ──────────────────────────────────────────────
const col = name => db.collection(name);

// ════════════════════════════════════════════════════════
//  ROUTES
// ════════════════════════════════════════════════════════

// Health check
app.get('/', (_, res) => res.json({ status: 'ok', app: 'Math Power-Up API' }));

// ── USERS ────────────────────────────────────────────────

// GET all students (non-admin)
app.get('/users', async (req, res) => {
  try {
    const users = await col('users').find({ isAdmin: { $ne: true } }, { projection: { password: 0 } }).toArray();
    res.json(users);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET single user
app.get('/users/:username', async (req, res) => {
  try {
    const u = await col('users').findOne({ username: req.params.username.toLowerCase() }, { projection: { password: 0 } });
    res.json(u || null);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET user for login (includes password check)
app.post('/users/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const u = await col('users').findOne({ username: username.toLowerCase() });
    if (!u) return res.json({ error: 'not_found' });
    if (u.password !== password) return res.json({ error: 'wrong_password' });
    const { password: _, ...safe } = u;
    res.json({ user: safe });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST create user
app.post('/users', async (req, res) => {
  try {
    const { username, name, password } = req.body;
    const un = username.toLowerCase();
    const exists = await col('users').findOne({ username: un });
    if (exists) return res.status(409).json({ error: 'exists' });
    const doc = { username: un, name, password, totalXP: 0, avatar: '🧑‍🎓', avatarIdx: 0, createdAt: Date.now() };
    await col('users').insertOne(doc);
    const { password: _, ...safe } = doc;
    res.status(201).json(safe);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT update user
app.put('/users/:username', async (req, res) => {
  try {
    const un = req.params.username.toLowerCase();
    const $set = req.body.$set || req.body;
    delete $set.password; // never update password via this route
    await col('users').updateOne({ username: un }, { $set });
    const u = await col('users').findOne({ username: un }, { projection: { password: 0 } });
    res.json(u || {});
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT update password specifically
app.put('/users/:username/password', async (req, res) => {
  try {
    const un = req.params.username.toLowerCase();
    await col('users').updateOne({ username: un }, { $set: { password: req.body.password } });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE user
app.delete('/users/:username', async (req, res) => {
  try {
    const un = req.params.username.toLowerCase();
    await col('users').deleteOne({ username: un });
    await col('refs').deleteMany({ un });
    await col('history').deleteMany({ un });
    await col('notifs').deleteMany({ un });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET check username exists
app.get('/users/check/uname/:username', async (req, res) => {
  try {
    const un = req.params.username.toLowerCase();
    const u = await col('users').findOne({ username: un });
    const p = await col('pending').findOne({ username: un });
    res.json({ exists: !!(u || p) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET check display name exists
app.get('/users/check/name/:name', async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name).toLowerCase();
    const u = await col('users').findOne({ name: { $regex: new RegExp('^'+name+'$','i') }, isAdmin: { $ne: true } });
    const p = await col('pending').findOne({ name: { $regex: new RegExp('^'+name+'$','i') } });
    res.json({ exists: !!(u || p) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PENDING ──────────────────────────────────────────────

app.get('/pending', async (req, res) => {
  try {
    const p = await col('pending').find({}).sort({ submittedAt: -1 }).toArray();
    res.json(p);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/pending', async (req, res) => {
  try {
    const { username, name, password } = req.body;
    await col('pending').updateOne(
      { username: username.toLowerCase() },
      { $set: { username: username.toLowerCase(), name, password, submittedAt: Date.now() }},
      { upsert: true }
    );
    res.status(201).json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/pending/:username', async (req, res) => {
  try {
    await col('pending').deleteOne({ username: req.params.username.toLowerCase() });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── REFS (Reflections) ────────────────────────────────────

app.get('/refs', async (req, res) => {
  try {
    const filter = req.query.un ? { un: req.query.un.toLowerCase() } : {};
    const refs = await col('refs').find(filter).sort({ ts: -1 }).toArray();
    res.json(refs);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/refs', async (req, res) => {
  try {
    const { un, name, s1, s2, s3, dateVal } = req.body;
    await col('refs').updateOne(
      { un: un.toLowerCase(), dateVal },
      { $set: { un: un.toLowerCase(), name, s1, s2, s3, dateVal, ts: Date.now() }},
      { upsert: true }
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── BADGES ───────────────────────────────────────────────

const DEFAULT_BADGES = [
  { id: 'b1', ico: '🏅', name: 'Ratio Explorer',    xp: 50  },
  { id: 'b2', ico: '⚔️', name: 'Fraction Fighter',  xp: 100 },
  { id: 'b3', ico: '🔧', name: 'Equation Engineer', xp: 200 },
  { id: 'b4', ico: '🛡️', name: 'Geometry Guardian',xp: 300 },
];

app.get('/badges', async (req, res) => {
  try {
    const s = await col('settings').findOne({ _id: 'badges' });
    res.json(s?.data || DEFAULT_BADGES);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/badges', async (req, res) => {
  try {
    await col('settings').updateOne({ _id: 'badges' }, { $set: { data: req.body.data }}, { upsert: true });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── XP BUTTONS ───────────────────────────────────────────

const DEFAULT_XPBTNS = [
  { id: 'xb1', label: 'Good Answer!',  xp: 5,  ico: '⭐' },
  { id: 'xb2', label: 'Excellent!',    xp: 10, ico: '🔥' },
  { id: 'xb3', label: 'Perfect Score!',xp: 20, ico: '🏆' },
];

app.get('/xpbuttons', async (req, res) => {
  try {
    const s = await col('settings').findOne({ _id: 'xpbuttons' });
    res.json(s?.data || DEFAULT_XPBTNS);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/xpbuttons', async (req, res) => {
  try {
    await col('settings').updateOne({ _id: 'xpbuttons' }, { $set: { data: req.body.data }}, { upsert: true });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── HISTORY ──────────────────────────────────────────────

app.get('/history', async (req, res) => {
  try {
    const filter = req.query.un ? { un: req.query.un.toLowerCase() } : {};
    const limit  = Math.min(parseInt(req.query.limit || '500'), 1000);
    const hist = await col('history').find(filter).sort({ ts: -1 }).limit(limit).toArray();
    res.json(hist);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/history', async (req, res) => {
  try {
    const { un, name, type, label, xp } = req.body;
    await col('history').insertOne({ un: un.toLowerCase(), name, type, label, xp, ts: Date.now() });
    res.status(201).json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ONLINE PRESENCE ──────────────────────────────────────

app.post('/heartbeat', async (req, res) => {
  try {
    const { un } = req.body;
    await col('online').updateOne(
      { un: un.toLowerCase() },
      { $set: { un: un.toLowerCase(), ts: new Date() }},
      { upsert: true }
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/heartbeat/:un', async (req, res) => {
  try {
    await col('online').deleteOne({ un: req.params.un.toLowerCase() });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/online', async (req, res) => {
  try {
    const cutoff = new Date(Date.now() - 25000);
    const docs = await col('online').find({ ts: { $gt: cutoff }}).toArray();
    res.json(docs.map(d => d.un));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── NOTIFICATIONS ─────────────────────────────────────────

app.get('/notifs/:username', async (req, res) => {
  try {
    const un = req.params.username.toLowerCase();
    const notifs = await col('notifs').find({ un }).sort({ ts: -1 }).limit(50).toArray();
    res.json(notifs);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/notifs', async (req, res) => {
  try {
    const { un, ico, label, xp } = req.body;
    await col('notifs').insertOne({ un: un.toLowerCase(), ico, label, xp, read: false, ts: Date.now() });
    res.status(201).json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/notifs/:username/read', async (req, res) => {
  try {
    await col('notifs').updateMany({ un: req.params.username.toLowerCase() }, { $set: { read: true }});
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/notifs/:username', async (req, res) => {
  try {
    await col('notifs').deleteMany({ un: req.params.username.toLowerCase() });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── START ────────────────────────────────────────────────
connectDB()
  .then(() => app.listen(PORT, () => console.log(`🚀 Math Power-Up API running on port ${PORT}`)))
  .catch(e => { console.error('❌ DB connection failed:', e); process.exit(1); });
