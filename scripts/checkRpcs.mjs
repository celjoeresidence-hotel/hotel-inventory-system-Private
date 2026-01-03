import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

function parseEnvDotenv(path) {
  const txt = fs.readFileSync(path, 'utf8');
  const out = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const env = parseEnvDotenv('./.env');
const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Missing Supabase URL or anon key in .env');
  process.exit(1);
}
const sb = createClient(url, key);

function randomUuid() {
  // Simple v4 UUID generator
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function testPublicRpc(name, args) {
  try {
    const { data, error } = await sb.rpc(name, args);
    return { name, schema: 'public', exists: !error || !!error.message, callable: true, message: error ? error.message : 'ok', data };
  } catch (e) {
    return { name, schema: 'public', exists: false, callable: true, message: String(e?.message || e) };
  }
}

async function testApiRpc(name, args) {
  try {
    const { data, error } = await sb.schema('api').rpc(name, args);
    return { name: `api.${name}`, schema: 'api', exists: !error || !!error.message, callable: true, message: error ? error.message : 'ok', data };
  } catch (e) {
    return { name: `api.${name}`, schema: 'api', exists: false, callable: false, message: String(e?.message || e) };
  }
}

(async () => {
  const id = randomUuid();
  const checks = [];
  // Public wrappers & delete RPCs
  checks.push(await testPublicRpc('soft_delete_record', { _id: id }));
  checks.push(await testPublicRpc('approve_record', { _id: id }));
  checks.push(await testPublicRpc('reject_record', { _id: id, _reason: 'test' }));
  checks.push(await testPublicRpc('edit_config_record', { _previous_version_id: id, _data: { active: false } }));
  checks.push(await testPublicRpc('delete_config_category', { _id: id }));
  checks.push(await testPublicRpc('delete_config_collection', { _id: id }));
  checks.push(await testPublicRpc('delete_config_item', { _id: id }));
  // New RPCs
  checks.push(await testPublicRpc('delete_record', { _id: id }));
  checks.push(await testPublicRpc('get_daily_report_details', { _department: 'kitchen', _date: '2024-01-01' }));
  checks.push(await testPublicRpc('get_room_analytics', { _start_date: '2024-01-01', _end_date: '2024-01-31' }));
  checks.push(await testPublicRpc('get_admin_dashboard_stats', {}));
  checks.push(await testPublicRpc('get_admin_dashboard_intelligence', { _start_date: '2024-01-01', _end_date: '2024-01-31' }));
  // API schema functions (likely not callable from client)
  checks.push(await testApiRpc('soft_delete_record', { _id: id }));
  checks.push(await testApiRpc('hard_delete_record', { _id: id }));

  for (const c of checks) {
    console.log(`${c.name} | schema=${c.schema} | callable=${c.callable} | message=${c.message}`);
  }
})();