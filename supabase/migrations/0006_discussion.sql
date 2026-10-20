-- =============================================================================
-- atomes.studio — migration 0006 : discussion client-agence
-- Chaque dossier a une discussion, la même dans l'espace agence et dans l'espace client. La table messages reçoit,
-- en plus des e-mails du client rangés par le moteur de l'agence, les messages de l'agence (envoyés au client par
-- e-mail) et ceux que le client écrit depuis son espace, avec photos et PDF. Tous sont enregistrés par la fonction
-- « espace » ou par le moteur (rôle service) : ni le client ni l'agence n'écrivent directement dans la table.
-- Les « Questions au client » et les demandes de modification détectées dans les e-mails sont abandonnées : leurs
-- lignes sont reprises en messages (fin du fichier). Les tables questions et modifications restent telles quelles
-- (la fonction et le moteur en service avant la mise à jour y écrivent encore), ne sont plus écrites ensuite et
-- seront supprimées plus tard.
-- Nouvelle table evenements : étapes clés du dossier (demande reçue, devis envoyé, devis signé, paiement reçu,
-- documents prêts, documents validés, rétractation, dossier clos), notées par un déclencheur sur projets et
-- montrées dans la discussion. Nouvelle table envois_client (interne) : un seul envoi du client à la fois par dossier.
-- Tout ce qui est écrit dans messages et evenements est lisible par le client sur ses lignes visibles (la RLS filtre
-- les lignes, pas les colonnes) : jamais de donnée interne dans ces deux tables.
--
-- Ordre de mise en ligne (voir SETUP-ESPACE-CLIENT.md, « Mises à jour à appliquer ») : 1. cette migration, dans
-- Supabase → SQL Editor (coller tout le fichier, Run) ; 2. redéployer la fonction « espace » ; 3. publier le site ;
-- 4. essai. La nouvelle fonction et les nouvelles pages lisent ce que crée cette migration. La fonction, les pages
-- et le moteur en service continuent de fonctionner après elle ; seul l'affichage diffère jusqu'à la publication
-- (l'ancien site montre les questions reprises comme des messages du client) : enchaîner les étapes 1 à 3.
-- Une seule transaction : en cas d'erreur, rien n'est appliqué (si l'éditeur répond ensuite « current transaction
-- is aborted », exécuter rollback; seul, puis recoller le fichier). Rejouable : la rejouer ne change rien.
-- Ne plus jamais rejouer 0001 à 0005. Si 0005 a été rejouée (elle rend à l'agence l'écriture directe dans messages),
-- rejouer 0006 aussitôt. 0001 rejouée en entier échoue d'elle-même sans rien changer. Si une partie d'une migration
-- ancienne a été exécutée, s'arrêter et prévenir Claude : 0006 ne répare pas la timeline.
-- Brouillon v3.1 du git stash (0006_depot_et_copies.sql, abandonné, jamais publié) : ne jamais l'appliquer, il
-- rendrait au client le dépôt direct dans le stockage et à l'agence l'écriture directe dans messages. S'il l'a été,
-- cette migration retire sa politique de dépôt et ses droits ; ses colonnes (messages.source, messages.message_id,
-- projets.dernier_avis_depot) restent en place, inutilisées.
-- =============================================================================

begin;
-- Le moteur écrit dans messages toutes les 5 minutes : échouer vite (rien n'est appliqué ; réessayer une minute plus
-- tard) plutôt que bloquer la table.
set local lock_timeout = '5s';

-- ---------- Prérequis --------------------------------------------------------
-- Sans 0005 (table messages et son traitement reprenable), la migration s'arrête ici sans rien modifier.

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'messages' and column_name = 'traitement_le') then
    raise exception 'Migration 0005 absente : rien n''a été modifié';
  end if;
end $$;

-- ---------- Messages : colonnes de la discussion -----------------------------
-- Le moteur en service insère 13 colonnes nommées, sans connaître celles-ci, et doit continuer à passer : chaque
-- nouvelle colonne est facultative ou a un défaut qui décrit un e-mail du client, et aucune contrainte nouvelle ne
-- porte sur ses colonnes.

alter table public.messages
  add column if not exists auteur text not null default 'client',  -- client | agence
  add column if not exists origine text not null default 'email',  -- email (e-mail reçu) | espace (écrit dans un espace)
  add column if not exists auteur_id uuid,                         -- compte qui a écrit le message depuis un espace
  add column if not exists mail_etat text,                         -- en_cours | envoye | echec ; nul : aucun e-mail
  add column if not exists mail_le timestamptz,                    -- début de la dernière tentative, puis fin de l'envoi
  add column if not exists cle uuid,                               -- clé anti-doublon tirée par la page
  add column if not exists reprise text;                           -- questions:<id> | reponse:<id> | modification:<id>

-- Lu par l'agence : colonne créée une seule fois, avec les messages existants marqués lus (déjà vus). Rejouer la
-- migration n'y touche plus : les e-mails rangés depuis par le moteur restent non lus.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'messages' and column_name = 'lu_agence_le') then
    alter table public.messages add column lu_agence_le timestamptz;
    update public.messages set lu_agence_le = now();
  end if;
end $$;

-- Contraintes nommées, ajoutées si elles manquent.
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.messages'::regclass and conname = 'messages_auteur_check') then
    alter table public.messages add constraint messages_auteur_check check (auteur in ('client', 'agence'));
  end if;
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.messages'::regclass and conname = 'messages_origine_check') then
    alter table public.messages add constraint messages_origine_check check (origine in ('email', 'espace'));
  end if;
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.messages'::regclass and conname = 'messages_mail_etat_check') then
    alter table public.messages
      add constraint messages_mail_etat_check check (mail_etat in ('en_cours', 'envoye', 'echec'));
  end if;
  -- Compte supprimé : le message reste, sans auteur_id. (Jamais de seconde clé étrangère vers projets :
  -- l'embarquement messages(*) deviendrait ambigu pour l'API.)
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.messages'::regclass and conname = 'messages_auteur_id_fkey') then
    alter table public.messages add constraint messages_auteur_id_fkey
      foreign key (auteur_id) references auth.users (id) on delete set null;
  end if;
end $$;

create unique index if not exists messages_cle_idx on public.messages (cle);
create unique index if not exists messages_reprise_idx on public.messages (reprise);
create index if not exists messages_non_lus_idx on public.messages (projet_id)
  where auteur = 'client' and lu_agence_le is null;

-- ---------- Messages : droits ------------------------------------------------
-- Lecture inchangée (« client lit ses messages », 0005 : l'agence lit tout, le client les messages vérifiés de ses
-- dossiers). Plus aucune écriture directe par l'API, même pour l'agence : un message passe toujours par la fonction
-- « espace » (e-mail jamais annoncé à tort, limites contrôlées) ou par le moteur, avec la clé serveur (rôle service,
-- hors RLS). Tous les droits sont retirés (ceux de 0005, ceux reçus d'office à la création de la table et ceux
-- qu'aurait rendus le brouillon v3.1), puis la lecture est rendue à authenticated ; le rôle service garde les siens
-- (rappelés ici). Avant de rendre la lecture : RLS activée et politiques réduites à « client lit ses messages » (une RLS
-- désactivée ou une politique ajoutée à la main, « pour tous » par exemple, ouvriraient au client les messages des
-- autres dossiers).

drop policy if exists "admin gere les messages" on public.messages;
revoke all on table public.messages from public, anon, authenticated;
revoke all on sequence public.messages_id_seq from public, anon, authenticated;
alter table public.messages enable row level security;
do $$
declare
  x record;
begin
  for x in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'messages' and policyname <> 'client lit ses messages' loop
    execute format('drop policy %I on public.messages', x.policyname);
  end loop;
end $$;
grant select on table public.messages to authenticated;
grant select, insert, update, delete on table public.messages to service_role;
grant usage, select on sequence public.messages_id_seq to service_role;

-- ---------- Stockage ---------------------------------------------------------
-- Le client ne dépose jamais lui-même : ses pièces passent par la fonction « espace » (limites contrôlées) ou par le
-- moteur. Politique de dépôt du client retirée au cas où le brouillon v3.1 l'aurait recréée (sans effet sinon : 0005
-- l'avait déjà retirée). Restent quatre politiques : admin depose dans les dossiers, admin modifie le stockage, admin
-- supprime du stockage, client lit son dossier.

drop policy if exists "client depose dans son dossier" on storage.objects;

-- ---------- Envois du client : un seul à la fois par dossier ------------------
-- Bail pris par la fonction « espace » (message_client) avant de compter les messages du jour, le volume du dossier et
-- les avis, puis rendu : deux envois simultanés ne dépassent plus ces limites (le second reçoit 409). Un bail de plus de
-- 3 minutes (exécution interrompue) est repris. Table interne, jamais lue par les pages : aucun droit pour anon ni
-- authenticated et aucune politique (mêmes droits avant et après le 30 octobre 2026) ; le rôle service seul y écrit.

create table if not exists public.envois_client (
  projet_id  text primary key references public.projets (id) on delete cascade,
  pris_le    timestamptz not null
);
alter table public.envois_client enable row level security;
revoke all on table public.envois_client from public, anon, authenticated;
grant select, insert, update, delete on table public.envois_client to service_role;

-- ---------- Étapes clés ------------------------------------------------------

create table if not exists public.evenements (
  id         bigserial primary key,
  projet_id  text not null references public.projets (id) on delete cascade,
  type       text not null constraint evenements_type_check check (type in ('demande_recue', 'devis_envoye',
               'devis_signe', 'paiement_recu', 'documents_prets', 'documents_valides', 'retractation', 'dossier_clos')),
  le         timestamptz not null,
  details    jsonb not null default '{}'::jsonb,   -- lisible par le client : jamais d'adresse IP ni de navigateur
  unique (projet_id, type, le)
);
create index if not exists evenements_projet_idx on public.evenements (projet_id, le);

-- Mêmes droits avant et après le 30 octobre 2026 (jusque-là, Supabase donne encore tous les droits d'office aux
-- nouvelles tables et séquences, à anon compris) : tout est retiré, puis la lecture est donnée à authenticated (la
-- RLS décide des lignes : l'agence lit tout, le client les étapes clés de ses dossiers) et tous les droits au rôle
-- service. Le déclencheur écrit en tant que propriétaire de la table.
alter table public.evenements enable row level security;
revoke all on table public.evenements from public, anon, authenticated;
revoke all on sequence public.evenements_id_seq from public, anon, authenticated;
grant select on table public.evenements to authenticated;
grant select, insert, update, delete on table public.evenements to service_role;
grant usage, select on sequence public.evenements_id_seq to service_role;

drop policy if exists "client lit ses evenements" on public.evenements;
create policy "client lit ses evenements" on public.evenements
  for select to authenticated
  using (public.est_admin() or exists (
    select 1 from public.projets p where p.id = evenements.projet_id and p.client_id = auth.uid()));

-- Étapes clés notées à chaque écriture de projets : création (demande reçue) ; colonne qui devient non nulle ou change
-- (devis envoyé, avec son montant ; devis signé ; paiement reçu ; documents validés ; rétractation) ; passage à
-- l'étape « validation » en avançant et sans rétractation (documents prêts : c'est alors que l'e-mail part) ; passage
-- à « clos ». Datées comme les colonnes de projets, ou de now() comme la timeline (recalculer_etapes) : la reprise ne
-- double rien. Une erreur n'empêche jamais l'écriture du dossier (demande, signature, paiement…) : l'étape clé
-- manque alors, signalée seulement dans le journal de la base.
create or replace function public.noter_evenements() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    if tg_op = 'INSERT' then
      insert into public.evenements (projet_id, type, le) values (new.id, 'demande_recue', new.cree_le)
      on conflict do nothing;
    else
      if new.devis_envoye_le is not null and new.devis_envoye_le is distinct from old.devis_envoye_le then
        insert into public.evenements (projet_id, type, le, details)
        values (new.id, 'devis_envoye', new.devis_envoye_le,
                jsonb_build_object('montant_cents', new.montant_cents, 'montant_libelle', new.montant_libelle))
        on conflict do nothing;
      end if;
      if new.signe_le is not null and new.signe_le is distinct from old.signe_le then
        insert into public.evenements (projet_id, type, le) values (new.id, 'devis_signe', new.signe_le)
        on conflict do nothing;
      end if;
      if new.paye_le is not null and new.paye_le is distinct from old.paye_le then
        insert into public.evenements (projet_id, type, le) values (new.id, 'paiement_recu', new.paye_le)
        on conflict do nothing;
      end if;
      if new.documents_valides_le is not null and new.documents_valides_le is distinct from old.documents_valides_le then
        insert into public.evenements (projet_id, type, le) values (new.id, 'documents_valides', new.documents_valides_le)
        on conflict do nothing;
      end if;
      if new.retracte_le is not null and new.retracte_le is distinct from old.retracte_le then
        insert into public.evenements (projet_id, type, le) values (new.id, 'retractation', new.retracte_le)
        on conflict do nothing;
      end if;
      -- En avançant seulement (ordres lus dans la timeline du dossier) : un retour en arrière n'envoie aucun e-mail.
      if new.etape = 'validation' and old.etape is distinct from new.etape and new.retracte_le is null
         and (select e.ordre from public.etapes e where e.projet_id = new.id and e.cle = new.etape)
           > (select e.ordre from public.etapes e where e.projet_id = new.id and e.cle = old.etape) then
        insert into public.evenements (projet_id, type, le) values (new.id, 'documents_prets', now())
        on conflict do nothing;
      end if;
      if new.etape = 'clos' and old.etape is distinct from new.etape then
        insert into public.evenements (projet_id, type, le) values (new.id, 'dossier_clos', now())
        on conflict do nothing;
      end if;
    end if;
  exception when others then
    raise warning 'dossier % : étape clé non notée : %', new.id, sqlerrm;
  end;
  return new;
end $$;
revoke all on function public.noter_evenements() from public, anon, authenticated;

-- Après trg_creer_etapes à la création, avant trg_maj_etapes à la modification (ordre alphabétique) : un refus de
-- maj_etapes annule aussi l'étape clé (même transaction).
drop trigger if exists trg_evenements on public.projets;
create trigger trg_evenements after insert or update on public.projets
  for each row execute function public.noter_evenements();

-- ---------- Commentaires -----------------------------------------------------

comment on table public.messages is
  'Discussion de chaque dossier, la même dans l''espace agence et dans l''espace client : e-mails du client rangés par le moteur de l''agence (reçus par Resend jusqu''au 20 octobre 2026), messages écrits depuis l''espace client ou l''espace agence, questions et demandes de modification reprises par la migration 0006. Écrite seulement par la fonction « espace » et par le moteur (rôle service) : ni le client ni l''agence n''y écrivent directement. L''agence lit tout ; le client lit les messages vérifiés de ses dossiers, toutes colonnes comprises (la RLS filtre les lignes, pas les colonnes) : jamais de donnée interne dans cette table';
comment on column public.messages.recu_le is
  'Date du message, qui ordonne la discussion : réception de l''e-mail par la messagerie de l''agence, enregistrement d''un message écrit dans un espace, ou date d''origine d''un message repris';
comment on column public.messages.expediteur is
  'Adresse de l''expéditeur : celle de l''e-mail reçu, celle du dossier pour un message écrit par le client depuis son espace, contact@atomes.studio pour un message de l''agence';
comment on column public.messages.sujet is
  'Objet de l''e-mail reçu, ou de l''e-mail envoyé au client pour un message de l''agence ; nul pour un message écrit par le client depuis son espace';
comment on column public.messages.texte is
  'Texte du message : réponse du client sans la citation de l''e-mail d''origine, ou message écrit dans un espace (5 000 caractères au plus) ; nul pour un message qui n''a que des pièces jointes';
comment on column public.messages.texte_complet is
  'E-mail reçu : texte intégral, citation comprise (lu à la demande : « Message complet ») ; nul pour un message écrit dans un espace ou repris';
comment on column public.messages.pieces is
  'Pièces jointes : [{ "nom", "chemin", "taille", … }]. Pièces du client rangées dans <id>/client/ (e-mail vérifié ou rattaché, message écrit depuis l''espace client) ; message à vérifier : pièces annoncées, chemin nul (rien n''est rangé). Pièces de l''agence déposées dans <id>/agence/discussion/';
comment on column public.messages.verifie is
  'Vrai pour un message de l''agence, un message écrit par le client depuis son espace et un message repris. E-mail : vrai si l''expéditeur est l''adresse du dossier et que son authentification a réussi (moteur : signature DKIM alignée sur le domaine de l''adresse ; Resend, jusqu''au 20 octobre 2026 : DMARC « pass » ou DKIM « pass »), ou si l''agence l''a rattaché au dossier. Seuls les messages vérifiés sont visibles par le client';
comment on column public.messages.etape is
  'Étape du dossier (projets.etape) à la réception de l''e-mail ou à l''écriture du message ; nulle pour un message repris';
comment on column public.messages.resend_id is
  'Identifiant unique de l''e-mail reçu (anti-doublon) : « imap:<Message-ID> » pour le moteur de l''agence, qui ne reprend que ces lignes ; identifiant Resend avant le 20 octobre 2026 ; nul pour un message écrit dans un espace ou repris';
comment on column public.messages.auth is
  'Contrôle de l''expéditeur. E-mail : { "spf", "dkim", "dmarc" } (Resend), avec "dkim_domaine" et "controle": "moteur" pour le moteur ; message écrit par le client depuis son espace : { "controle": "session" } ; nul pour un message de l''agence ou repris';
comment on column public.messages.traite is
  'Faux tant que le traitement d''un e-mail vérifié ou rattaché (rangement des pièces jointes) n''est pas fini, ou s''il s''est interrompu : le moteur reprend les lignes « imap: » à son passage suivant (« En attente du moteur »). Vrai pour les messages écrits dans un espace et pour les messages repris';
comment on column public.messages.traitement_le is
  'Début du traitement en cours d''un e-mail (bail de 10 minutes)';
comment on column public.messages.auteur is
  '''client'' (défaut : e-mail reçu, ou message écrit depuis l''espace client) ou ''agence'' (message écrit depuis l''espace agence, ou questions reprises)';
comment on column public.messages.origine is
  '''email'' (défaut : e-mail reçu) ou ''espace'' (message écrit depuis l''espace client ou l''espace agence, ou repris des questions et des demandes de modification)';
comment on column public.messages.auteur_id is
  'Compte (auth.users) qui a écrit le message depuis un espace ; nul pour un e-mail reçu, un message repris, ou si le compte a été supprimé. Lisible par le client';
comment on column public.messages.lu_agence_le is
  'Message du client : date à laquelle l''agence l''a lu (nul : non lu, « Nouveau »), posée par la fonction « espace » pour les seuls messages affichés à l''agence. Message de l''agence : date d''enregistrement. Messages antérieurs à la migration 0006 marqués lus. Lisible par le client';
comment on column public.messages.mail_etat is
  'E-mail lié au message : ''en_cours'' (envoi commencé), ''envoye'' (accepté par Resend, ce qui ne garantit pas la remise), ''echec'' (non parti : « Renvoyer l''e-mail ») ; nul : aucun e-mail. Message de l''agence : e-mail au client (nul si l''agence l''a déjà envoyé depuis sa messagerie) ; message écrit par le client depuis son espace : avis à contact@ (au plus un par dossier et par quart d''heure, nul sinon) ; nul pour un e-mail reçu ou un message repris';
comment on column public.messages.mail_le is
  'Tant que mail_etat vaut ''en_cours'' : début de la dernière tentative d''envoi (renvoi permis 10 minutes plus tard) ; ensuite : fin de l''envoi';
comment on column public.messages.cle is
  'Clé (uuid, unique) tirée par la page pour chaque message écrit dans un espace : un envoi répété (double clic, nouvel essai après une coupure) n''enregistre qu''un message';
comment on column public.messages.reprise is
  'Message repris par la migration 0006 (unique) : ''questions:<id>'' (questions d''un même e-mail, id de la première), ''reponse:<id>'' (réponse donnée dans l''espace client du parcours v2, id de la question), ''modification:<id>'' (demande de modification du parcours v2) ; nul pour tout autre message';

comment on table public.evenements is
  'Étapes clés de chaque dossier, montrées dans la discussion des deux espaces : notées par le déclencheur trg_evenements (fonction noter_evenements) à chaque écriture de projets, reprises pour les dossiers existants par la migration 0006. Elles gardent ce que les remises à zéro de projets effacent (nouveau devis, nouvelle validation). Lisibles par l''agence et par le client de chaque dossier, toutes colonnes comprises : jamais de donnée interne (ni adresse IP, ni navigateur)';
comment on column public.evenements.type is
  'demande_recue, devis_envoye, devis_signe, paiement_recu, documents_prets, documents_valides, retractation ou dossier_clos';
comment on column public.evenements.le is
  'Date de l''étape clé : colonne de projets (cree_le, devis_envoye_le, signe_le, paye_le, documents_valides_le, retracte_le), ou passage à l''étape « validation » en avançant et sans rétractation (documents_prets) ou à « clos » (dossier_clos), daté comme la timeline';
comment on column public.evenements.details is
  'Précisions lisibles par le client : { "montant_cents", "montant_libelle" } pour devis_envoye, {} sinon ; jamais d''adresse IP ni de navigateur';

comment on table public.envois_client is
  'Bail d''un envoi du client en cours (fonction « espace ») : un seul à la fois par dossier ; interne, jamais lue par les pages';
comment on column public.envois_client.pris_le is
  'Début de l''envoi en cours ; un bail de plus de 3 minutes est repris par l''envoi suivant';

comment on table public.questions is
  'Questions de l''agence au client (parcours v2 et v3), remplacées le 20 octobre 2026 par la discussion (table messages) : reprises en messages par la migration 0006, plus écrites une fois la fonction « espace » et le moteur mis à jour ; à supprimer plus tard';
comment on table public.modifications is
  'Demandes de modification des documents (parcours v2 et v3), remplacées le 20 octobre 2026 par la discussion (table messages) : reprises en messages par la migration 0006, plus écrites une fois la fonction « espace » et le moteur mis à jour ; à supprimer plus tard';
comment on column public.modele_etapes.action is
  'Action du client à cette étape : questions = répondre à nos messages (discussion du dossier, par e-mail ou depuis l''espace client) ; signer = signer le devis depuis le lien reçu par e-mail ; payer = virement, numéro du dossier en référence ; valider = valider ses documents depuis le lien reçu par e-mail, ou demander une modification dans la discussion';

-- ---------- Reprise : étapes clés des dossiers existants ---------------------
-- D'après les colonnes de projets : demande reçue, devis envoyé (montant du devis en cours), devis signé, paiement
-- reçu, documents validés, rétractation ; dossier clos à la date de l'étape « clos » de la timeline. Documents prêts au
-- début de l'étape « validation », si elle a vraiment eu lieu (une étape sautée a debut_le = fait_le, posés par la même
-- mise à jour) et sans rétractation antérieure, seulement pour un dossier qui n'a encore aucune étape clé (dossier
-- d'avant cette migration) : ensuite, seul le déclencheur les note, en avançant (debut_le est aussi posé par un retour
-- en arrière). Mêmes dates que le déclencheur : rejouer ne double rien, et rattrape une étape clé qu'une erreur aurait
-- empêché de noter. Ce qu'un nouveau devis ou une nouvelle validation a effacé dans projets ne peut pas être repris.

insert into public.evenements (projet_id, type, le, details)
select p.id, x.type, x.le, x.details
  from public.projets p
  cross join lateral (values
    ('demande_recue', p.cree_le, '{}'::jsonb),
    ('devis_envoye', p.devis_envoye_le,
       jsonb_build_object('montant_cents', p.montant_cents, 'montant_libelle', p.montant_libelle)),
    ('devis_signe', p.signe_le, '{}'::jsonb),
    ('paiement_recu', p.paye_le, '{}'::jsonb),
    ('documents_valides', p.documents_valides_le, '{}'::jsonb),
    ('retractation', p.retracte_le, '{}'::jsonb),
    ('documents_prets', (select e.debut_le from public.etapes e
                          where e.projet_id = p.id and e.cle = 'validation' and e.debut_le is not null
                            and (e.fait_le is null or e.debut_le < e.fait_le)
                            and (p.retracte_le is null or p.retracte_le > e.debut_le)
                            and not exists (select 1 from public.evenements v where v.projet_id = p.id)), '{}'::jsonb),
    ('dossier_clos', (select e.fait_le from public.etapes e
                       where e.projet_id = p.id and e.cle = 'clos' and e.statut = 'fait'), '{}'::jsonb)
  ) as x (type, le, details)
 where x.le is not null
on conflict do nothing;

-- ---------- Reprise : questions et demandes de modification ------------------
-- En messages de la discussion, une seule fois (colonne reprise, unique). Le recu_le des messages existants n'est
-- jamais modifié : c'est son égalité avec repondue_le ou demandee_le qui écarte les réponses et les demandes reçues
-- par e-mail (parcours v3), déjà présentes. Une question retirée par l'agence a disparu : elle ne peut pas être
-- reprise.

-- Questions : un message de l'agence par e-mail envoyé (questions d'un même envoi : même posee_le), dans l'ordre,
-- séparées par une ligne vide, chacune avec ses réponses proposées. Aucun e-mail connu (mail_etat et mail_le nuls) :
-- rien ne prouve que l'e-mail est parti. Un envoi déjà repris ne l'est pas deux fois, même si sa première question a
-- été retirée depuis (son id ne sert qu'à la clé de reprise).
insert into public.messages (projet_id, recu_le, expediteur, sujet, texte, verifie, traite, auteur, origine,
                             lu_agence_le, mail_etat, mail_le, reprise)
select q.projet_id, q.posee_le, 'contact@atomes.studio',
       case when count(*) > 1 then 'Quelques questions' else 'Une question' end || ' sur votre dossier ' || q.projet_id,
       string_agg(q.question || case when coalesce(cardinality(q.choix), 0) > 0
                                     then E'\nPar exemple\u00a0: ' || array_to_string(q.choix, ' · ') else '' end,
                  E'\n\n' order by q.id),
       true, true, 'agence', 'espace', now(), null, null, 'questions:' || min(q.id)
  from public.questions q
 where not exists (select 1 from public.messages m
                    where m.projet_id = q.projet_id and m.reprise like 'questions:%' and m.recu_le = q.posee_le)
 group by q.projet_id, q.posee_le
on conflict do nothing;

-- Réponses données dans l'espace client (parcours v2) : un message du client par question répondue, avec la question,
-- sauf si un message du dossier porte exactement la date de la réponse (réponse par e-mail, déjà présente).
insert into public.messages (projet_id, recu_le, expediteur, texte, verifie, traite, auteur, origine, lu_agence_le,
                             reprise)
select q.projet_id, q.repondue_le, p.email,
       concat_ws(E'\n\n', E'Réponse à\u00a0: ' || q.question,
                 case when btrim(coalesce(q.reponse, ''), E' \t\r\n') <> '' then q.reponse end,
                 case when btrim(coalesce(q.commentaire, ''), E' \t\r\n') <> '' then q.commentaire end),
       true, true, 'client', 'espace', now(), 'reponse:' || q.id
  from public.questions q
  join public.projets p on p.id = q.projet_id
 where q.repondue_le is not null
   and not exists (select 1 from public.messages m where m.projet_id = q.projet_id and m.recu_le = q.repondue_le)
on conflict do nothing;

-- Demandes de modification faites dans l'espace client (parcours v2) : un message du client chacune, sauf si un
-- message du dossier porte exactement leur date (demande par e-mail, déjà présente).
insert into public.messages (projet_id, recu_le, expediteur, texte, verifie, traite, auteur, origine, lu_agence_le,
                             reprise)
select x.projet_id, x.demandee_le, p.email, x.message, true, true, 'client', 'espace', now(), 'modification:' || x.id
  from public.modifications x
  join public.projets p on p.id = x.projet_id
 where not exists (select 1 from public.messages m where m.projet_id = x.projet_id and m.recu_le = x.demandee_le)
on conflict do nothing;

notify pgrst, 'reload schema';
commit;
