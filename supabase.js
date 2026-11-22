(function initSupabaseModule(globalScope) {
  let supabaseClientInstance = null;

  function isSafeRedirectUrl(url) {
    return typeof url === 'string' && /^https?:\/\//i.test(url.trim());
  }

  function redirectToPortal() {
    const targetUrl = globalScope.CONFIG && globalScope.CONFIG.PORTAL_URL;
    if (isSafeRedirectUrl(targetUrl)) {
      globalScope.location.href = targetUrl;
    }
  }

  function getSupabaseClient() {
    if (supabaseClientInstance) {
      return supabaseClientInstance;
    }

    const cfg = globalScope.CONFIG;
    if (!cfg || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || !cfg.SUPABASE_PROJECT_ID) {
      throw new Error('Configuracao do Supabase ausente ou incompleta em config.js.');
    }

    if (!globalScope.supabase || typeof globalScope.supabase.createClient !== 'function') {
      throw new Error('Biblioteca @supabase/supabase-js nao foi carregada.');
    }

    supabaseClientInstance = globalScope.supabase.createClient(
      cfg.SUPABASE_URL,
      cfg.SUPABASE_ANON_KEY,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          storageKey: `sb-${cfg.SUPABASE_PROJECT_ID}-auth-token`
        }
      }
    );

    return supabaseClientInstance;
  }

  globalScope.getSupabaseClient = getSupabaseClient;
  globalScope.isSafeRedirectUrl = isSafeRedirectUrl;
  globalScope.redirectToPortal = redirectToPortal;
})(window);
