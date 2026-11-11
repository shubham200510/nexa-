import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey);
export const supabase = isSupabaseConfigured ? createClient(url!, anonKey!, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
}) : null;

export type Room = {
  id: string;
  code: string;
  game: string;
  host_id: string;
  guest_id: string | null;
  status: 'waiting' | 'playing' | 'finished';
  board: (string | null)[];
  current_turn: string | null;
  winner: string | null;
};