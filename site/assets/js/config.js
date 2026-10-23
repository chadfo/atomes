// Configuration publique du site (valeurs publiques par conception : elles peuvent être lues par tous,
// la sécurité repose sur les règles RLS de Supabase, pas sur le secret de ces valeurs).
// Ne jamais mettre ici une clé secrète (sb_secret_… ou service_role).
// Si apiUrl est vide, le formulaire de devis (devis.html) envoie via FormSubmit comme avant.
// La page Contact (message simple) envoie toujours via FormSubmit, sans passer par Supabase.
window.ATOMES_CONFIG = {
  supabaseUrl: 'https://zvgkvovqmxmpdijubmaz.supabase.co',
  supabaseAnonKey: 'sb_publishable_GabjhmLQGgTnSBKA8MHcpw_O_lg_Kca',
  apiUrl: 'https://zvgkvovqmxmpdijubmaz.supabase.co/functions/v1/demande',
  // Fonction « espace » : actions de l'espace agence, page d'action (liens reçus par e-mail : signer, valider,
  // renoncer), formulaire public de rétractation (renoncer/), coordonnées de virement de l'espace client
  espaceUrl: 'https://zvgkvovqmxmpdijubmaz.supabase.co/functions/v1/espace'
};
