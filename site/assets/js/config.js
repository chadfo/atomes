// Configuration publique du site (valeurs publiques par conception : elles peuvent être lues par tous,
// la sécurité repose sur les règles RLS de Supabase, pas sur le secret de ces valeurs).
// Ne jamais mettre ici une clé secrète (sb_secret_… ou service_role).
// Si apiUrl est vide, le formulaire de contact envoie via FormSubmit comme avant.
window.ATOMES_CONFIG = {
  supabaseUrl: 'https://zvgkvovqmxmpdijubmaz.supabase.co',
  supabaseAnonKey: 'sb_publishable_GabjhmLQGgTnSBKA8MHcpw_O_lg_Kca',
  apiUrl: 'https://zvgkvovqmxmpdijubmaz.supabase.co/functions/v1/demande'
};
