import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Cliente Supabase para uso server-side (Service Role Key).
// Usar este cliente en los handlers del servidor para evitar
// repetir la inicialización y para mantener la clave Privada
// fuera del frontend.

const url = process.env.SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || "";

export const supabaseAdmin: SupabaseClient = createClient(url, key, {
  auth: {
    // No configurar persistencia ni storage en handlers server-side.
  },
});

export default supabaseAdmin;
