-- =============================================================================
-- atomes.studio — migration 0004 : parcours client v2
-- 11 étapes (dont 3 optionnelles : suivi administratif), actions du client à certaines étapes
-- (répondre aux questions, signer le devis, payer par carte, valider les documents ou demander une
-- modification), questions de l'agence, demandes de modification, devis signé, paiement Stripe.
-- À exécuter dans Supabase → SQL Editor (après 0003), dans la même séance que le déploiement de la
-- fonction « espace » et la publication du site (voir SETUP-ESPACE-CLIENT.md, « Mises à jour à appliquer »).
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
  add column if not exists paiement_session text,             -- dernière session Stripe Checkout (cs_…), réutilisée ou expirée
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
      ('signature',    4, 'Validation de votre devis',              'Votre devis est prêt : lisez-le, puis signez-le en ligne.', false, false, 'signer'),
      ('paiement',     5, 'Paiement',                               'Réglez par carte bancaire le montant indiqué pour lancer la production de vos documents.', false, false, 'payer'),
      ('production',   6, 'Production de vos documents',            'Nous réalisons vos documents.', false, false, null),
      ('validation',   7, 'Validation de vos documents',            'Vos documents sont prêts : vérifiez-les, puis validez-les ou demandez une modification.', false, false, 'valider'),
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
-- suivantes « à venir ». Sans l'option, les étapes optionnelles restent « à venir » (masquées) ; leurs dates
-- sont conservées et réapparaissent si l'option est réactivée.
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
  update public.etapes set statut = 'a_venir'
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
  -- Option activée sur un dossier qui a dépassé le dépôt sans y passer (ex. dossier clos) : ces étapes
  -- s'afficheraient faites à tort ; il faut repasser le dossier à « Dépôt » dans la même modification.
  if new.suivi_administratif and not old.suivi_administratif and new.etape = old.etape and exists (
       select 1 from public.etapes e
        where e.projet_id = new.id and e.optionnelle and e.fait_le is null
          and e.ordre < (select ordre from public.etapes where projet_id = new.id and cle = new.etape)) then
    raise exception 'Le suivi administratif ne peut être activé sur ce dossier qu''en le repassant à l''étape « Dépôt »';
  end if;
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
-- Correspondance des anciennes étapes ; timeline reconstruite avec les dates et les notes reprises
-- (demande, traitement, devis, validation → signature, paiement, etude → production, livraison → validation
-- et clos). Les anciennes lignes sont archivées dans etapes_v1 (illisible par les clients).

create table if not exists public.etapes_v1 (
  projet_id   text not null references public.projets (id) on delete cascade,
  cle         text not null,
  ordre       int not null,
  libelle     text,
  statut      text,
  fait_le     timestamptz,
  note        text,
  archive_le  timestamptz not null default now(),
  primary key (projet_id, cle)
);
alter table public.etapes_v1 enable row level security;   -- aucune politique : réservé à l'agence (tableau de bord)
revoke all on public.etapes_v1 from anon, authenticated;

do $$
declare
  p record; nouvelle text; debut timestamptz; note_courante text;
begin
  alter table public.projets disable trigger trg_maj_etapes;
  for p in select pr.id, pr.etape, pr.cree_le from public.projets pr
           where not exists (select 1 from public.etapes e where e.projet_id = pr.id and e.cle = 'signature') loop
    insert into public.etapes_v1 (projet_id, cle, ordre, libelle, statut, fait_le, note)
      select projet_id, cle, ordre, libelle, statut, fait_le, note from public.etapes where projet_id = p.id
      on conflict do nothing;
    nouvelle := case p.etape
      when 'devis' then 'devis' when 'validation' then 'devis' when 'paiement' then 'paiement'
      when 'pieces' then 'production' when 'etude' then 'production' when 'livraison' then 'validation'
      when 'termine' then 'clos' else 'traitement' end;
    delete from public.etapes where projet_id = p.id;
    update public.projets set etape = nouvelle where id = p.id;
    perform public.copier_modele(p.id);
    -- dates (et notes des étapes passées) reprises par correspondance
    update public.etapes e set fait_le = a.fait_le,
           note = case when e.cle = nouvelle or e.cle = 'clos' or a.statut = 'en_cours' then null else a.note end
      from (values ('demande', 'demande'), ('traitement', 'traitement'), ('devis', 'devis'), ('validation', 'signature'),
                   ('paiement', 'paiement'), ('etude', 'production'), ('livraison', 'validation'), ('livraison', 'clos')) m(ancienne, cible)
      join public.etapes_v1 a on a.cle = m.ancienne
     where a.projet_id = p.id and e.projet_id = p.id and e.cle = m.cible;
    -- étape en cours : sa note (visible par le client) et son début (fin de la dernière étape faite)
    note_courante := null;
    select note into note_courante from public.etapes_v1 where projet_id = p.id and statut = 'en_cours';
    select coalesce(max(a.fait_le), p.cree_le) into debut from public.etapes_v1 a
     where a.projet_id = p.id and a.statut = 'fait'
       and a.ordre < coalesce((select ordre from public.etapes_v1 where projet_id = p.id and statut = 'en_cours'), 1000);
    update public.etapes set statut = 'en_cours', debut_le = debut, note = note_courante
     where projet_id = p.id and cle = nouvelle;
    perform public.recalculer_etapes(p.id);
  end loop;
  alter table public.projets enable trigger trg_maj_etapes;
end $$;

-- ---------- Sécurité (RLS) --------------------------------------------------
-- Le client lit les questions et demandes de modification de ses dossiers ; il y répond (ou en crée)
-- par la fonction « espace » (rôle service). L'agence gère tout.

drop policy if exists "client lit ses etapes" on public.etapes;
create policy "client lit ses etapes" on public.etapes
  for select to authenticated
  using (exists (select 1 from public.projets p
                 where p.id = projet_id
                   and ((p.client_id = auth.uid() and (not etapes.optionnelle or p.suivi_administratif))
                        or public.est_admin())));

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
