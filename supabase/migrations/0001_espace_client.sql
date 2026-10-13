-- =============================================================================
-- atomes.studio — espace client — migration 0001
-- À exécuter une fois dans Supabase → SQL Editor (coller tout le fichier, Run).
-- Crée : projets, modele_etapes, etapes (timeline), admins ; fonctions et
-- déclencheurs ; règles de sécurité (RLS) ; bucket privé « dossiers ».
-- Rejouable sans danger (if not exists / drop policy if exists).
-- =============================================================================

-- ---------- Tables ----------------------------------------------------------

create table if not exists public.projets (
  id                 text primary key check (id ~ '^[0-9]{12}$'),  -- AAMMJJHHMMSS, heure de Paris, ex. 261012173615
  cree_le            timestamptz not null default now(),
  client_id          uuid references auth.users (id) on delete set null,
  -- 01 Vous
  profil             text not null check (profil in ('Particulier', 'Professionnel')),
  societe            text,
  activite           text,
  prenom             text not null,
  nom                text not null,
  email              text not null,
  telephone          text,
  -- 02 Le projet
  type               text not null,
  documents          text[] not null default '{}',   -- documents souhaités
  adresse            text,
  commune            text not null,
  code_postal        text,
  cadastre           text,
  bien               text,
  surface            numeric,
  surface_existante  numeric,
  emprise            numeric,
  surface_terrain    numeric,
  -- 03 Détails
  budget             text,
  calendrier         text,
  message            text,
  source             text,
  -- Suivi (modifié par l'agence)
  etape              text not null default 'traitement',  -- clé de l'étape en cours (cf. modele_etapes) ou 'termine'
  archive            boolean not null default false
);

create index if not exists projets_client_idx on public.projets (client_id);
create index if not exists projets_email_cree_idx on public.projets (email, cree_le);

-- Modèle de la timeline : une ligne par étape, dans l'ordre. Modifiable (libellés, descriptions, ajout d'étapes).
create table if not exists public.modele_etapes (
  cle          text primary key,
  ordre        int not null unique,
  libelle      text not null,
  description  text not null default ''
);

insert into public.modele_etapes (cle, ordre, libelle, description) values
  ('demande',    1, 'Demande reçue',               'Votre demande nous est bien parvenue.'),
  ('traitement', 2, 'Traitement de votre demande', 'Nous étudions votre projet et revenons vers vous sous 48 h ouvrées.'),
  ('devis',      3, 'Réception de votre devis',    'Votre devis est disponible dans vos documents.'),
  ('validation', 4, 'Validation du devis',         'Retournez-nous le devis signé pour lancer la mission.'),
  ('paiement',   5, 'Paiement',                    'Règlement de l''acompte prévu au devis.'),
  ('pieces',     6, 'Réception des pièces',        'Déposez dans votre espace les pièces nécessaires à l''étude : titre de propriété, plans existants, photos…'),
  ('etude',      7, 'Étude et production',         'Nous réalisons la mission : relevés, conception, constitution du dossier.'),
  ('livraison',  8, 'Livraison',                   'Vos documents finaux sont disponibles dans votre espace.')
on conflict (cle) do nothing;

-- Timeline de chaque projet (copiée du modèle à la création, puis mise à jour par le déclencheur ci-dessous).
create table if not exists public.etapes (
  id           bigserial primary key,
  projet_id    text not null references public.projets (id) on delete cascade,
  cle          text not null,
  ordre        int not null,
  libelle      text not null,
  description  text not null default '',
  statut       text not null default 'a_venir' check (statut in ('fait', 'en_cours', 'a_venir')),
  fait_le      timestamptz,
  note         text,                      -- précision visible par le client (facultatif)
  unique (projet_id, cle)
);

create index if not exists etapes_projet_idx on public.etapes (projet_id, ordre);

-- Comptes de l'agence (accès à tout). Créer d'abord l'utilisateur dans Authentication → Users (Add user),
-- puis :  insert into public.admins (user_id) select id from auth.users where email = 'contact@atomes.studio';
create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  ajoute_le  timestamptz not null default now()
);

-- ---------- Fonctions -------------------------------------------------------

create or replace function public.est_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- Retrouve un compte par e-mail (réservé au rôle service, utilisé par la fonction « demande »).
-- Seuls les comptes confirmés et créés par la fonction (app_metadata.origine = 'demande') sont rattachés
-- automatiquement : un compte créé autrement ne peut pas capter le dossier d'un futur client.
create or replace function public.user_id_par_email(p_email text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from auth.users
  where lower(email) = lower(p_email)
    and email_confirmed_at is not null
    and raw_app_meta_data->>'origine' = 'demande'
  limit 1;
$$;
revoke all on function public.user_id_par_email(text) from public, anon, authenticated;
grant execute on function public.user_id_par_email(text) to service_role;

-- À la création d'un projet : copie du modèle (étape 1 faite, étape en cours = projets.etape).
create or replace function public.creer_etapes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.etapes (projet_id, cle, ordre, libelle, description, statut, fait_le)
  select new.id, m.cle, m.ordre, m.libelle, m.description,
         case when m.ordre = 1 then 'fait' when m.cle = new.etape then 'en_cours' else 'a_venir' end,
         case when m.ordre = 1 then new.cree_le end
  from public.modele_etapes m
  order by m.ordre;
  return new;
end $$;

drop trigger if exists trg_creer_etapes on public.projets;
create trigger trg_creer_etapes after insert on public.projets
  for each row execute function public.creer_etapes();

-- Quand l'agence change projets.etape : les étapes précédentes passent à « fait » (datées),
-- la nouvelle à « en cours », les suivantes à « à venir ». 'termine' = tout fait.
create or replace function public.maj_etapes() returns trigger
language plpgsql security definer set search_path = public as $$
declare o int;
begin
  if new.etape = 'termine' then
    update public.etapes set statut = 'fait', fait_le = coalesce(fait_le, now()) where projet_id = new.id;
    return new;
  end if;
  select ordre into o from public.etapes where projet_id = new.id and cle = new.etape;
  if o is null then
    raise exception 'Étape inconnue pour ce projet : %', new.etape;
  end if;
  update public.etapes set statut = 'fait',     fait_le = coalesce(fait_le, now()) where projet_id = new.id and ordre < o;
  update public.etapes set statut = 'en_cours', fait_le = null                     where projet_id = new.id and ordre = o;
  update public.etapes set statut = 'a_venir',  fait_le = null                     where projet_id = new.id and ordre > o;
  return new;
end $$;

drop trigger if exists trg_maj_etapes on public.projets;
create trigger trg_maj_etapes after update of etape on public.projets
  for each row when (old.etape is distinct from new.etape) execute function public.maj_etapes();

-- ---------- Sécurité (RLS) --------------------------------------------------
-- Règle : un client ne voit que ses propres dossiers ; l'agence (table admins) voit et modifie tout.
-- Les créations de dossiers passent par la fonction « demande » (rôle service, hors RLS).

alter table public.projets       enable row level security;
alter table public.etapes        enable row level security;
alter table public.modele_etapes enable row level security;
alter table public.admins        enable row level security;

drop policy if exists "client lit ses projets" on public.projets;
create policy "client lit ses projets" on public.projets
  for select to authenticated
  using (client_id = auth.uid() or public.est_admin());

drop policy if exists "admin cree des projets" on public.projets;
create policy "admin cree des projets" on public.projets
  for insert to authenticated
  with check (public.est_admin());

drop policy if exists "admin modifie les projets" on public.projets;
create policy "admin modifie les projets" on public.projets
  for update to authenticated
  using (public.est_admin()) with check (public.est_admin());

drop policy if exists "admin supprime les projets" on public.projets;
create policy "admin supprime les projets" on public.projets
  for delete to authenticated
  using (public.est_admin());

drop policy if exists "client lit ses etapes" on public.etapes;
create policy "client lit ses etapes" on public.etapes
  for select to authenticated
  using (exists (select 1 from public.projets p
                 where p.id = projet_id and (p.client_id = auth.uid() or public.est_admin())));

drop policy if exists "admin gere les etapes" on public.etapes;
create policy "admin gere les etapes" on public.etapes
  for all to authenticated
  using (public.est_admin()) with check (public.est_admin());

drop policy if exists "modele lisible" on public.modele_etapes;
create policy "modele lisible" on public.modele_etapes
  for select to authenticated using (true);

drop policy if exists "admin gere le modele" on public.modele_etapes;
create policy "admin gere le modele" on public.modele_etapes
  for all to authenticated
  using (public.est_admin()) with check (public.est_admin());

drop policy if exists "admin se voit" on public.admins;
create policy "admin se voit" on public.admins
  for select to authenticated using (user_id = auth.uid());

-- ---------- Stockage : bucket privé « dossiers » ----------------------------
-- Chemins : <id projet>/client/<fichier>  (pièces déposées par le client)
--           <id projet>/agence/<fichier>  (documents fournis par l'agence : devis, plans…)
-- Le client lit les deux dossiers de ses projets et ne dépose que dans « client ».
-- L'agence dépose dans « agence » via l'espace admin ou le tableau de bord Supabase (Storage).

insert into storage.buckets (id, name, public, file_size_limit)
values ('dossiers', 'dossiers', false, 52428800)   -- privé, 50 Mo max par fichier
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists "client lit son dossier" on storage.objects;
create policy "client lit son dossier" on storage.objects
  for select to authenticated
  using (bucket_id = 'dossiers' and (
    public.est_admin() or (
      (storage.foldername(name))[2] in ('client', 'agence') and exists (
        select 1 from public.projets p
        where p.id = (storage.foldername(name))[1] and p.client_id = auth.uid()))));

drop policy if exists "client depose dans son dossier" on storage.objects;
create policy "client depose dans son dossier" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'dossiers' and (
    public.est_admin() or (
      (storage.foldername(name))[2] = 'client'
      and lower(storage.extension(name)) in ('pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif')
      and exists (
        select 1 from public.projets p
        where p.id = (storage.foldername(name))[1] and p.client_id = auth.uid()))));

drop policy if exists "admin modifie le stockage" on storage.objects;
create policy "admin modifie le stockage" on storage.objects
  for update to authenticated
  using (bucket_id = 'dossiers' and public.est_admin())
  with check (bucket_id = 'dossiers' and public.est_admin());

drop policy if exists "admin supprime du stockage" on storage.objects;
create policy "admin supprime du stockage" on storage.objects
  for delete to authenticated
  using (bucket_id = 'dossiers' and public.est_admin());
