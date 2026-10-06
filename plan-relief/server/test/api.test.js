// Tests de bout en bout du service : démarre un vrai processus sur un dossier de données
// temporaire et l'interroge en HTTP, comme le ferait le navigateur derrière IIS.
//   npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-relief-test-'));
const port = 4500 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, PLAN_RELIEF_DATA_DIR: dataDir, PORT: String(port), JWT_SECRET: 'secret-de-test-0123456789', COOKIE_SECURE: 'false', MAX_UPLOAD_MB: '1' };
let proc;
let cookie = '';

const DXF = ['0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '8', 'MURS', '10', '0', '20', '0', '11', '5', '21', '0', '0', 'ENDSEC', '0', 'EOF'].join('\n');

async function api(p, init = {}) {
  const res = await fetch(base + p, { ...init, headers: { ...(init.headers || {}), ...(cookie ? { cookie } : {}) } });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const type = res.headers.get('content-type') || '';
  return { status: res.status, body: type.includes('json') ? await res.json() : await res.text() };
}

function uploadForm(name, content, data) {
  const fd = new FormData();
  fd.append('data', JSON.stringify(data));
  fd.append('file', new Blob([content]), name);
  return fd;
}

before(async () => {
  execFileSync(process.execPath, ['scripts/create-local-user.js', 'admin', 'MotDePasse123', 'Admin Test'], { cwd: root, env });
  proc = spawn(process.execPath, ['src/index.js'], { cwd: root, env, stdio: 'pipe' });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Le service ne démarre pas');
});

after(() => {
  proc?.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('la sonde répond sans session et déclare l\'application', async () => {
  const r = await api('/api/health');
  assert.equal(r.body.app, 'plan-relief');
  assert.equal(r.body.mode, 'client-serveur');
});

test('les plans et la recherche sont refusés sans session', async () => {
  assert.equal((await api('/api/plans')).status, 401);
  assert.equal((await api('/api/search?q=x')).status, 401);
});

test('mauvais mot de passe refusé, bon mot de passe accepté', async () => {
  const bad = await api('/api/auth/local', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'faux' }) });
  assert.equal(bad.status, 401);
  assert.equal(cookie, '');
  const ok = await api('/api/auth/local', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'MotDePasse123' }) });
  assert.equal(ok.status, 200);
  assert.match(cookie, /^planrelief_session=/);
});

let planId;
test('import d\'un DXF, puis lecture et téléchargement du fichier d\'origine', async () => {
  const r = await api('/api/plans', {
    method: 'POST',
    body: uploadForm('RDC bâtiment B.dxf', DXF, {
      name: 'RDC', site: 'Siège', building: 'B', floor: 'RDC',
      settings: { unit: 'mm', roles: { MURS: 'mur' } },
      equipment: [
        { kind: 'bloc', label: 'SW-B-01', type: 'SWITCH', layer: 'RESEAU', x: 1, y: 2, attributes: { REPERE: 'SW-B-01', MODELE: 'Cisco C9300' }, indications: ['Alimenté par onduleur UPS-2', 42, ''] },
        { kind: 'texte', label: 'Baie de brassage', layer: 'TEXTE', x: 3, y: 4 },
        { kind: 'texte', label: '', x: 5, y: 6 },
        { kind: 'texte', label: 'sans position' },
      ],
    }),
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  planId = r.body.plan.id;
  assert.equal(r.body.plan.equipmentCount, 2, 'les éléments vides ou sans position sont écartés');
  const full = await api(`/api/plans/${planId}`);
  assert.equal(full.body.settings.unit, 'mm');
  assert.equal(full.body.createdBy, 'Admin Test');
  const file = await api(`/api/plans/${planId}/file`);
  assert.equal(file.body, DXF);
});

test('un DWG est refusé avec une explication', async () => {
  const r = await api('/api/plans', { method: 'POST', body: uploadForm('plan.dwg', 'AC1032xxxxxxxx', {}) });
  assert.equal(r.status, 415);
  assert.match(r.body.error, /DXF/);
});

test('un fichier trop volumineux est refusé', async () => {
  const r = await api('/api/plans', { method: 'POST', body: uploadForm('gros.pdf', '%PDF-' + 'x'.repeat(1.2 * 1024 * 1024), {}) });
  assert.equal(r.status, 413);
});

test('recherche insensible aux accents, mots répartis entre équipement et fiche du plan', async () => {
  let r = await api('/api/search?q=' + encodeURIComponent('cisco'));
  assert.equal(r.body.total, 1);
  assert.equal(r.body.results[0].equipment.label, 'SW-B-01');
  r = await api('/api/search?q=' + encodeURIComponent('BAIE siege'));
  assert.equal(r.body.total, 1);
  r = await api('/api/search?q=' + encodeURIComponent('siège'));
  assert.equal(r.body.total, 0, 'le nom du site seul ne doit pas renvoyer tous les équipements');
  r = await api('/api/search?q=sw&kind=texte');
  assert.equal(r.body.total, 0);
  r = await api('/api/search?q=' + encodeURIComponent('onduleur ups2'));
  assert.equal(r.body.total, 1, 'une indication écrite à côté fait ressortir l\'équipement');
  assert.deepEqual(r.body.results[0].equipment.indications, ['Alimenté par onduleur UPS-2', '42']);
  r = await api('/api/search?q=' + encodeURIComponent('C 9300'));
  assert.equal(r.body.total, 1, 'espaces parasites (OCR) tolérés');
});

test('modification avec contrôle de version (409 si le plan a changé entre-temps)', async () => {
  const cur = (await api(`/api/plans/${planId}`)).body;
  const eq = [...cur.equipment, { kind: 'manuel', label: 'Borne Wi-Fi B-12', type: 'Borne Wi-Fi', x: 10, y: 10 },
    { kind: 'manuel', label: 'Gaine technique', type: 'Gaine', x: 20, y: 10, passage: 'GT-3' }];
  const ok = await api(`/api/plans/${planId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version: cur.version, equipment: eq, notes: 'MAJ', level: '1.4', floorHeight: 3.456 }) });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.level, 1, 'niveau arrondi à l\'entier');
  assert.equal(ok.body.floorHeight, 3.46);
  assert.equal(ok.body.name, 'RDC', 'les champs non envoyés sont conservés');
  assert.equal(ok.body.version, cur.version + 1);
  assert.equal(ok.body.equipment.length, 4);
  assert.equal(ok.body.equipment[3].passage, 'GT-3');
  const stale = await api(`/api/plans/${planId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version: cur.version, name: 'écrasement' }) });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.current.name, 'RDC');
  const found = await api('/api/search?q=wifi');
  assert.equal(found.body.total, 1);
  assert.equal((await api('/api/search?q=passage%20gt3')).body.total, 1);
});

test('équipements ajoutés par catégorie : nettoyés, trouvés par mot-clé et listés par catégorie', async () => {
  const cur = (await api(`/api/plans/${planId}`)).body;
  const eq = [...cur.equipment,
    { kind: 'manuel', label: 'TEL-01', type: 'Téléphonie', category: 'telephonie', x: 30, y: 10, notes: 'Poste 4521' },
    { kind: 'manuel', label: 'X-1', category: 'inconnue', x: 31, y: 10 }];
  const r = await api(`/api/plans/${planId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version: cur.version, equipment: eq }) });
  assert.equal(r.status, 200);
  const tel = r.body.equipment.find((e) => e.label === 'TEL-01');
  assert.equal(tel.category, 'telephonie');
  assert.equal(r.body.equipment.find((e) => e.label === 'X-1').category, undefined, 'catégorie inconnue écartée');
  // Mot-clé de la catégorie, absent du repère et du type saisis.
  assert.equal((await api('/api/search?q=dect')).body.total, 1);
  assert.equal((await api('/api/search?q=4521')).body.total, 1);
  // Catégorie seule, sans mot : toute la catégorie.
  const all = await api('/api/search?category=telephonie');
  assert.equal(all.body.total, 1);
  assert.equal(all.body.results[0].equipment.label, 'TEL-01');
  assert.equal((await api('/api/search?q=tel&category=wifi')).body.total, 0);
});

test('identifiant invalide : jamais de chemin construit à partir de la saisie', async () => {
  assert.equal((await api('/api/plans/..%2F..%2Fusers.json/file')).status, 404);
  assert.equal((await api('/api/plans/not-an-id')).status, 404);
});

test('suppression : le plan part à la corbeille, il n\'est pas effacé', async () => {
  const r = await api(`/api/plans/${planId}`, { method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.equal((await api('/api/plans')).body.length, 0);
  const trashed = fs.readdirSync(path.join(dataDir, 'corbeille'));
  assert.equal(trashed.length, 1);
  assert.ok(fs.existsSync(path.join(dataDir, 'corbeille', trashed[0], 'source.dxf')));
});

test('le compteur de version global avance à chaque écriture (témoin de sauvegarde)', () => {
  const meta = JSON.parse(fs.readFileSync(path.join(dataDir, 'meta.json'), 'utf8'));
  assert.ok(meta.version >= 3);
});

test('un plan.json corrompu empêche le démarrage, avec le nom du fichier', async () => {
  const dir = path.join(dataDir, 'plans', '00000000-0000-4000-8000-000000000000');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plan.json'), '{ cassé');
  const out = await new Promise((resolve) => {
    const p = spawn(process.execPath, ['src/index.js'], { cwd: root, env: { ...env, PORT: String(port + 1) } });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('exit', (code) => resolve({ code, err }));
  });
  assert.notEqual(out.code, 0);
  assert.match(out.err, /plan\.json est illisible/);
  fs.rmSync(dir, { recursive: true });
});
