import { useEffect, useSyncExternalStore } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
}

const serverSnapshot: AuthState = { session: null, user: null, loading: true };
let currentState: AuthState = serverSnapshot;
let started = false;
let authEventSeen = false;
const listeners = new Set<() => void>();

function publish(session: Session | null) {
  currentState = {
    session,
    user: session?.user ?? null,
    loading: false,
  };
  for (const listener of listeners) listener();
}

function startAuthStore() {
  if (started || typeof window === "undefined") return;
  started = true;

  supabase.auth.onAuthStateChange((_event, session) => {
    authEventSeen = true;
    publish(session);
  });

  void supabase.auth.getSession().then(({ data, error }) => {
    if (authEventSeen) return;
    if (error) {
      console.error("auth_session_load_failed", error.message);
      publish(null);
      return;
    }
    publish(data.session);
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAuth(): AuthState {
  useEffect(startAuthStore, []);
  return useSyncExternalStore(
    subscribe,
    () => currentState,
    () => serverSnapshot,
  );
}
