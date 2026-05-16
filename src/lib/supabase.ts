import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const browserToken = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfig = {
  url: url || "",
  isConfigured: Boolean(url && browserToken)
};

export const supabase = supabaseConfig.isConfigured
  ? createClient(url as string, browserToken as string, {
      auth: {
        persistSession: false
      }
    })
  : null;
