-- =============================================================================
-- atomes.studio — migration 0003 : cinq surfaces fixes (formulaire v4)
-- À exécuter dans Supabase → SQL Editor (après 0002), avant de redéployer la fonction « demande ».
-- =============================================================================

alter table public.projets
  add column if not exists emprise_existante numeric;

comment on column public.projets.surface_existante is 'Surface habitable existante (m²)';
comment on column public.projets.surface           is 'Surface habitable créée (m²)';
comment on column public.projets.emprise_existante is 'Emprise au sol du bâti existant (m²)';
comment on column public.projets.emprise           is 'Emprise au sol du bâti après projet (m²)';
comment on column public.projets.surface_terrain   is 'Surface de la parcelle (m²)';
