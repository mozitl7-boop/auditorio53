const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Load .env.local like the test script so the script can run in this environment
try {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const env = {};
    envContent.split('\n').forEach((line) => {
      const [key, ...valueParts] = line.split('=');
      if (key && !key.startsWith('#')) {
        const value = valueParts.join('=').replace(/^['"]|['"]$/g, '');
        env[key.trim()] = value.trim();
      }
    });
    Object.assign(process.env, env);
  }
} catch (err) {
  // ignore
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

(async () => {
  try {
    console.log('[Check] Fetching first evento...');
    const { data: eventos } = await supabase
      .from('eventos')
      .select('*')
      .order('fecha', { ascending: true })
      .limit(1);

    if (!eventos || eventos.length === 0) {
      console.log('[Check] No eventos found');
      return;
    }

    const evento = eventos[0];
    const eventoId = evento.id;
    console.log('[Check] Evento:', eventoId, 'titulo=', evento.titulo || '(sin titulo)');

    const { count, error } = await supabase
      .from('registros_asistentes')
      .select('id', { count: 'exact', head: false })
      .eq('id_evento', eventoId);

    if (error) throw error;

    console.log(`[Check] Registros en evento ${eventoId}:`, count);
  } catch (err) {
    console.error('[Check] Error during count check:', err.message || err);
    process.exit(1);
  }
})();
