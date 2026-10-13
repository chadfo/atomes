-- =============================================================================
-- atomes.studio — migration 0004 : parcours client v2
-- 11 étapes (dont 3 optionnelles : suivi administratif), actions du client à certaines étapes
-- (répondre aux questions, signer le devis, payer par carte, valider les documents ou demander une
-- modification), questions de l'agence, demandes de modification, devis signé, paiement Stripe.
-- À exécuter dans Supabase → SQL Editor (après 0003), avant de déployer la fonction « espace ».
-- Rejouable sans danger.
-- =============================================================================

-- ---------- Colonnes -------------------------------------------------------

alter table public.modele_etapes
  add column if not exists optionnelle boolean not null default false,  -- suivi administratif (masquée sans l'option)
  add column if not exists instantanee boolean not null default false,  -- faite dès qu'elle est atteinte (date seule)
  add column if not exists action text check (action in ('questions', 'signer', 'payer', 'valider'));

alter table public.etapes
  add column if not exists optionnelle boolean not null default false,
  add column if not exists instantanee boolean not null default false,
  add column if not exists action text,
  add column if not exists debut_le timestamptz;                       -- date à laquelle l'étape a commencé

alter table public.projets
  add column if not exists suivi_administratif boolean not null default false,  -- option : étapes 8 à 10
  add column if not exists devis_chemin text,                 -- <id>/agence/<fichier>.pdf
  add column if not exists devis_empreinte text,              -- SHA-256 (hexadécimal) du PDF envoyé au client
  add column if not exists devis_envoye_le timestamptz,
  add column if not exists montant_cents integer check (montant_cents > 0),  -- montant à payer, en centimes
  add column if not exists montant_libelle text,              -- ex. « Acompte de 40 % »
  add column if not exists signe_le timestamptz,              -- signature électronique simple du devis
  add column if not exists signe_nom text,
  add column if not exists signe_ip text,
  add column if not exists signe_agent text,
  add column if not exists signe_empreinte text,
  add column if not exists paye_le timestamptz,               -- paiement par carte (Stripe)
  add column if not exists paiement_ref text,
  add column if not exists documents_valides_le timestamptz;

-- Questions de l'agence (réponses du client via la fonction « espace »)
create table if not exists public.questions (
  id           bigserial primary key,
  projet_id    text not null references public.projets (id) on delete cascade,
  question     text not null check (char_length(question) between 1 and 2000),
  choix        text[],                                   -- réponses proposées ; sans choix, réponse libre
  reponse      text check (char_length(reponse) <= 5000),
  commentaire  text check (char_length(commentaire) <= 5000),
  posee_le     timestamptz not null default now(),
  repondue_le  timestamptz
);
create index if not exists questions_projet_idx on public.questions (projet_id, posee_le);

-- Demandes de modification des documents (étape « Validation de vos documents »)
create table if not exists public.modifications (
  id           bigserial primary key,
  projet_id    text not null references public.projets (id) on delete cascade,
  message      text not null check (char_length(message) between 1 and 5000),
  demandee_le  timestamptz not null default now()
);
create index if not exists modifications_projet_idx on public.modifications (projet_id, demandee_le);

-- ---------- Modèle des étapes v2 --------------------------------------------
-- Remplacé une seule fois (les textes modifiés ensuite dans le tableau de bord sont conservés si on rejoue).

do $$
begin
  if not exists (select 1 from public.modele_etapes where cle = 'signature') then
    delete from public.modele_etapes;
    insert into public.modele_etapes (cle, ordre, libelle, description, optionnelle, instantanee, action) values
      ('demande',      1, 'Demande reçue',                          'Votre demande nous est bien parvenue.', false, true, null),
      ('traitement',   2, 'Traitement de votre demande',            'Nous étudions votre projet et pouvons vous poser quelques questions pour affiner votre demande.', false, false, 'questions'),
      ('devis',        3, 'Production de votre devis',              'Nous préparons votre devis.', false, false, null),
      ('signature',    4, 'Validation de votre devis',              'Votre devis est prêt : lisez-le, puis signez-le en ligne.', false, false, 'signer'),
      ('paiement',     5, 'Paiement',                               'Réglez par carte bancaire le montant indiqué pour lancer la production de vos documents.', false, false, 'payer'),
      ('production',   6, 'Production de vos documents',            'Nous réalisons vos documents.', false, false, null),
      ('validation',   7, 'Validation de vos documents',            'Vos documents sont prêts : vérifiez-les, puis validez-les ou demandez une modification.', false, false, 'valider'),
      ('depot',        8, 'Dépôt de votre démarche administrative', 'Nous déposons votre dossier auprès du service instructeur.', true, false, null),
      ('instruction',  9, 'Suivi de votre démarche administrative', 'Nous suivons l''instruction de votre dossier et répondons aux éventuelles demandes du service instructeur.', true, false, null),
      ('accordee',    10, 'Démarche administrative validée',        'Votre démarche administrative est validée.', true, true, null),
      ('clos',        11, 'Dossier clos',                           'Votre dossier est terminé. Merci de votre confiance.', false, true, null);
  end if;
end $$;

-- ---------- Fonctions -------------------------------------------------------

-- Copie le modèle dans la timeline d'un projet (étapes manquantes seulement).
create or replace function public.copier_modele(p_id text) returns void
language sql security definer set search_path = public as $$
  insert into public.etapes (projet_id, cle, ordre, libelle, description, optionnelle, instantanee, action)
  select p_id, m.cle, m.ordre, m.libelle, m.description, m.optionnelle, m.instantanee, m.action
  from public.modele_etapes m
  on conflict (projet_id, cle) do nothing;
$$;

-- Statuts de la timeline d'après projets.etape (étape atteinte) et l'option de suivi administratif :
-- étapes passées « fait » (datées), étape atteinte « en cours » (ou « fait » si instantanée),
-- suivantes « à venir ». Sans l'option, les étapes optionnelles restent « à venir » (masquées).
create or replace function public.recalculer_etapes(p_id text) returns void
language plpgsql security definer set search_path = public as $$
declare
  courante text; suivi boolean; cree timestamptz; o int; opt boolean;
begin
  select etape, suivi_administratif, cree_le into courante, suivi, cree from public.projets where id = p_id;
  if not found then return; end if;
  select ordre, optionnelle into o, opt from public.etapes where projet_id = p_id and cle = courante;
  if o is null then
    raise exception 'Étape inconnue pour ce projet : %', courante;
  end if;
  if opt and not suivi then
    raise exception 'L''étape « % » fait partie du suivi administratif, qui n''est pas activé pour ce dossier', courante;
  end if;
  update public.etapes set statut = 'fait',
         fait_le = coalesce(fait_le, case when ordre = 1 then cree else now() end),
         debut_le = coalesce(debut_le, fait_le, case when ordre = 1 then cree else now() end)
   where projet_id = p_id and ordre < o and (not optionnelle or suivi);
  update public.etapes set statut = 'a_venir', fait_le = null, debut_le = null
   where projet_id = p_id and ordre < o and optionnelle and not suivi;
  update public.etapes set
         debut_le = case when statut = 'en_cours' then coalesce(debut_le, now()) else now() end,
         fait_le  = case when instantanee then coalesce(fait_le, case when ordre = 1 then cree else now() end) end,
         statut   = case when instantanee then 'fait' else 'en_cours' end
   where projet_id = p_id and ordre = o;
  update public.etapes set statut = 'a_venir', fait_le = null, debut_le = null
   where projet_id = p_id and ordre > o;
end $$;

-- Création d'un projet : copie du modèle puis statuts.
create or replace function public.creer_etapes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.copier_modele(new.id);
  perform public.recalculer_etapes(new.id);
  return new;
end $$;

-- Changement d'étape ou de l'option de suivi : statuts recalculés (erreur si l'étape est inconnue,
-- ou optionnelle sans l'option : la modification est alors refusée).
create or replace function public.maj_etapes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.recalculer_etapes(new.id);
  return new;
end $$;

revoke all on function public.copier_modele(text) from public, anon, authenticated;
revoke all on function public.recalculer_etapes(text) from public, anon, authenticated;

drop trigger if exists trg_maj_etapes on public.projets;
create trigger trg_maj_etapes after update of etape, suivi_administratif on public.projets
  for each row when (old.etape is distinct from new.etape or old.suivi_administratif is distinct from new.suivi_administratif)
  execute function public.maj_etapes();

-- ---------- Dossiers existants : passage au nouveau modèle ------------------
-- Correspondance des anciennes étapes, timeline reconstruite ; dates conservées pour la demande,
-- le traitement et le paiement (les autres étapes ont changé de sens).

do $$
declare
  p record; nouvelle text; d_traitement timestamptz; d_paiement timestamptz;
begin
  alter table public.projets disable trigger trg_maj_etapes;
  for p in select pr.id, pr.etape from public.projets pr
           where not exists (select 1 from public.etapes e where e.projet_id = pr.id and e.cle = 'signature') loop
    select fait_le into d_traitement from public.etapes where projet_id = p.id and cle = 'traitement';
    select fait_le into d_paiement from public.etapes where projet_id = p.id and cle = 'paiement';
    nouvelle := case p.etape
      when 'devis' then 'devis' when 'validation' then 'devis' when 'paiement' then 'paiement'
      when 'pieces' then 'production' when 'etude' then 'production' when 'livraison' then 'validation'
      when 'termine' then 'clos' else 'traitement' end;
    delete from public.etapes where projet_id = p.id;
    update public.projets set etape = nouvelle where id = p.id;
    perform public.copier_modele(p.id);
    update public.etapes set fait_le = d_traitement where projet_id = p.id and cle = 'traitement' and d_traitement is not null;
    update public.etapes set fait_le = d_paiement where projet_id = p.id and cle = 'paiement' and d_paiement is not null;
    perform public.recalculer_etapes(p.id);
  end loop;
  alter table public.projets enable trigger trg_maj_etapes;
end $$;

-- ---------- Sécurité (RLS) --------------------------------------------------
-- Le client lit les questions et demandes de modification de ses dossiers ; il y répond (ou en crée)
-- par la fonction « espace » (rôle service). L'agence gère tout.

alter table public.questions     enable row level security;
alter table public.modifications enable row level security;

drop policy if exists "client lit ses questions" on public.questions;
create policy "client lit ses questions" on public.questions
  for select to authenticated
  using (exists (select 1 from public.projets p
                 where p.id = projet_id and (p.client_id = auth.uid() or public.est_admin())));

drop policy if exists "admin gere les questions" on public.questions;
create policy "admin gere les questions" on public.questions
  for all to authenticated
  using (public.est_admin()) with check (public.est_admin());

drop policy if exists "client lit ses modifications" on public.modifications;
create policy "client lit ses modifications" on public.modifications
  for select to authenticated
  using (exists (select 1 from public.projets p
                 where p.id = projet_id and (p.client_id = auth.uid() or public.est_admin())));

drop policy if exists "admin gere les modifications" on public.modifications;
create policy "admin gere les modifications" on public.modifications
  for all to authenticated
  using (public.est_admin()) with check (public.est_admin());

comment on column public.projets.etape is 'Clé de l''étape atteinte (modele_etapes.cle) : traitement, devis, signature, paiement, production, validation, depot, instruction, accordee, clos';
