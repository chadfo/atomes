-- =============================================================================
-- atomes.studio — migration 0002 : précisions saisies pour les choix « Autre »
-- À exécuter dans Supabase → SQL Editor, avant de redéployer la fonction « demande ».
-- =============================================================================

alter table public.projets
  add column if not exists precisions jsonb not null default '{}'::jsonb;

comment on column public.projets.precisions is
  'Précisions libres pour les choix « Autre » : {"type": …, "bien": …, "documents": …, "calendrier": …, "source": …}';
