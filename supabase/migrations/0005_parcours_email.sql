-- =============================================================================
-- atomes.studio — migration 0005 : parcours client v3, tout par e-mail
-- Les échanges avec le client passent par e-mail : il répond aux e-mails du dossier (réponses et pièces jointes
-- reçues par Resend, rangées dans la table messages), signe le devis depuis un lien reçu par e-mail (particulier :
-- case de démarrage anticipé obligatoire), peut renoncer au contrat pendant le délai de rétractation, et paie par
-- virement avec le numéro du dossier pour référence (plus de Stripe). L'espace client ne sert plus qu'à consulter :
-- le client n'y dépose plus de fichiers.
-- À exécuter dans Supabase → SQL Editor (après 0004), dans la même séance, avant de redéployer les fonctions
-- « espace » et « demande » et de publier le site (voir SETUP-ESPACE-CLIENT.md, « Mises à jour à appliquer ») :
-- la nouvelle fonction et les nouvelles pages lisent la table messages. Dès l'exécution, l'ancienne page de
-- l'espace client, en ligne jusqu'à la publication, ne peut plus déposer de fichiers.
-- Rejouable sans danger.
-- =============================================================================

-- ---------- Prérequis --------------------------------------------------------
-- Sans 0004, la migration s'arrête ici sans rien modifier.

do $$
begin
  if to_regclass('public.questions') is null or to_regclass('public.modifications') is null
     or not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'projets' and column_name = 'paiement_session') then
    raise exception 'Migration 0004 absente : exécutez d''abord 0004_parcours_client.sql, puis cette migration';
  end if;
end $$;

-- ---------- Colonnes ---------------------------------------------------------

alter table public.projets
  add column if not exists demarrage_anticipe_le timestamptz,   -- particulier : case cochée à la signature
  add column if not exists demarrage_anticipe_texte text,       -- texte exact de la case acceptée
  add column if not exists retracte_le timestamptz,             -- rétractation (renonciation au contrat)
  add column if not exists retracte_nom text,
  add column if not exists retracte_email text,
  add column if not exists retracte_ip text,
  add column if not exists retracte_agent text,
  add column if not exists envois_echoues jsonb not null default '[]'::jsonb;   -- e-mails légaux à renvoyer

-- ---------- Messages du client -----------------------------------------------
-- E-mails reçus du client (réponses), rattachés au dossier par l'adresse de réponse.

create table if not exists public.messages (
  id            bigserial primary key,
  projet_id     text not null references public.projets (id) on delete cascade,
  recu_le       timestamptz not null default now(),
  expediteur    text not null,                      -- adresse de l'expéditeur
  sujet         text,
  texte         text,                               -- réponse seule, sans la citation de l'e-mail d'origine
  texte_complet text,                               -- texte intégral reçu
  pieces        jsonb not null default '[]'::jsonb, -- [{ nom, chemin, taille }] rangées dans <id>/client/
  verifie       boolean not null default false,     -- expéditeur = e-mail du client ET authentification réussie
  etape         text,                               -- étape du dossier à la réception
  resend_id     text unique,                        -- identifiant Resend de l'e-mail reçu (anti-doublon)
  auth          jsonb,                              -- { spf, dkim, dmarc } fournis par Resend
  traite        boolean not null default true,      -- faux tant que le traitement d'un message vérifié n'est pas fini
  traitement_le timestamptz                         -- début du traitement en cours (bail de 10 minutes)
);
-- Table créée par une version précédente de cette migration : colonnes ajoutées.
alter table public.messages
  add column if not exists traite boolean not null default true,
  add column if not exists traitement_le timestamptz;
create index if not exists messages_projet_idx on public.messages (projet_id, recu_le);

-- ---------- Modèle des étapes : paiement par virement ------------------------
-- Nouveau texte de l'étape « Paiement », dans le modèle et dans la timeline des dossiers existants, seulement là où
-- le texte de 0004 est resté tel quel : un texte modifié depuis le tableau de bord est conservé, les notes ne sont
-- pas touchées.

update public.modele_etapes
   set description = 'Réglez par virement le montant indiqué, en précisant la référence de votre dossier.'
 where cle = 'paiement'
   and description = 'Réglez par carte bancaire le montant indiqué pour lancer la production de vos documents.';

update public.etapes
   set description = 'Réglez par virement le montant indiqué, en précisant la référence de votre dossier.'
 where cle = 'paiement'
   and description = 'Réglez par carte bancaire le montant indiqué pour lancer la production de vos documents.';

-- ---------- Sécurité (RLS) ---------------------------------------------------
-- Le client lit les messages vérifiés de ses dossiers. Un message non vérifié (autre expéditeur, ou e-mail dont
-- l'authentification a échoué) n'est visible que de l'agence, qui le rattache au dossier ou le supprime. Le client
-- n'écrit jamais : les messages sont enregistrés par la fonction « espace » (rôle service, hors RLS). L'agence gère
-- tout.

alter table public.messages enable row level security;

drop policy if exists "client lit ses messages" on public.messages;
create policy "client lit ses messages" on public.messages
  for select to authenticated
  using (public.est_admin() or (messages.verifie and exists (
    select 1 from public.projets p where p.id = messages.projet_id and p.client_id = auth.uid())));

drop policy if exists "admin gere les messages" on public.messages;
create policy "admin gere les messages" on public.messages
  for all to authenticated
  using (public.est_admin()) with check (public.est_admin());

-- ---------- Droits d'accès par l'API -----------------------------------------
-- Supabase n'accorde plus d'office de droits sur les nouvelles tables du schéma public (nouveaux projets Supabase
-- depuis le 30 mai 2026, projets existants à partir du 30 octobre 2026) : sans ces lignes, la table messages
-- resterait inaccessible au site et à la fonction « espace ». Les règles RLS ci-dessus décident des lignes
-- visibles ; les visiteurs anonymes n'ont aucun droit sur les messages. Mêmes droits pour les tables questions et
-- modifications, au cas où 0004 aurait été exécutée après ce changement (sans effet sinon).

grant select, insert, update, delete on public.messages, public.questions, public.modifications
  to authenticated, service_role;
grant usage, select on sequence public.messages_id_seq, public.questions_id_seq, public.modifications_id_seq
  to authenticated, service_role;
revoke all on public.messages from anon;
revoke all on sequence public.messages_id_seq from anon;

-- ---------- Stockage : dépôts réservés à l'agence ----------------------------
-- Remplace la politique « client depose dans son dossier » de 0001. Le client ne dépose plus rien depuis le site :
-- ses pièces jointes arrivent par e-mail et la fonction « espace » les range dans <id>/client/ (rôle service, hors
-- RLS). L'agence dépose depuis son espace et garde la modification et la suppression (politiques de 0001). Le client
-- lit toujours les fichiers de ses dossiers (« client lit son dossier », inchangée).

drop policy if exists "client depose dans son dossier" on storage.objects;
drop policy if exists "admin depose dans les dossiers" on storage.objects;
create policy "admin depose dans les dossiers" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'dossiers' and public.est_admin());

-- ---------- Commentaires -----------------------------------------------------

comment on column public.projets.demarrage_anticipe_le is
  'Particulier : date de la demande de démarrage de la mission avant la fin du délai de rétractation (case cochée à la signature du devis)';
comment on column public.projets.demarrage_anticipe_texte is 'Texte exact de la case cochée à la signature';
comment on column public.projets.retracte_le is
  'Particulier : réception de la rétractation (renonciation au contrat depuis le lien « Renoncer au contrat ici ») ; l''étape du dossier ne change pas';
comment on column public.projets.retracte_nom is 'Rétractation : nom saisi';
comment on column public.projets.retracte_email is 'Rétractation : adresse e-mail saisie, pour l''accusé de réception';
comment on column public.projets.retracte_ip is 'Rétractation : adresse IP';
comment on column public.projets.retracte_agent is 'Rétractation : navigateur (User-Agent)';
comment on column public.projets.envois_echoues is
  'E-mails légaux au client qui n''ont pas pu partir pendant une action du client par lien : [{ "quoi": "confirmation" | "retractation", "sujet", "le" }] ; l''espace agence les signale avec un bouton « Renvoyer », et la mention disparaît une fois l''e-mail renvoyé';
comment on column public.projets.paye_le is
  'Paiement reçu : date à laquelle l''agence a confirmé le virement (« Virement reçu »). Avant le parcours v3 : paiement par carte (Stripe) ou marqué par l''agence';
comment on column public.projets.paiement_ref is
  '''virement'' : virement confirmé par l''agence (parcours v3). Avant : ''manuel'' (marqué par l''agence) ou référence Stripe (pi_…, cs_…)';
comment on column public.projets.paiement_session is
  'Inutilisée depuis le parcours v3 (plus de paiement par carte) : dernière session Stripe Checkout (cs_…) du parcours v2, conservée pour l''historique';
comment on column public.modele_etapes.action is
  'Action du client à cette étape (parcours v3, tout par e-mail) : questions = répondre à l''e-mail ; signer = signer le devis depuis le lien reçu par e-mail ; payer = virement, numéro du dossier en référence ; valider = valider ses documents depuis le lien reçu, ou répondre à l''e-mail pour demander une modification';

comment on table public.messages is
  'E-mails reçus du client en réponse aux e-mails du dossier (webhook Resend « email.received », fonction « espace »), rattachés au dossier par l''adresse de réponse. Le client ne lit que les messages vérifiés de ses dossiers';
comment on column public.messages.texte is 'Réponse du client, sans la citation de l''e-mail d''origine';
comment on column public.messages.texte_complet is 'Texte intégral reçu, citation comprise';
comment on column public.messages.pieces is
  'Pièces jointes rangées dans <id>/client/ : [{ "nom", "chemin", "taille", "id_resend" }] ; rangées seulement pour un message vérifié (ou une fois rattaché), notées une à une (une reprise du traitement ne les range pas deux fois). Message à vérifier : noms des pièces annoncées, chemin nul (rien n''est rangé)';
comment on column public.messages.verifie is
  'Vrai si l''expéditeur est l''adresse du client (adresse simple, la même dans le champ « from » de Resend et dans l''en-tête From) et que Resend authentifie l''e-mail (DMARC « pass », ou DKIM « pass » : signature du domaine de l''adresse From ; jamais SPF seul ni des en-têtes écrits par l''expéditeur), ou si l''agence a rattaché le message au dossier ; seuls les messages vérifiés sont visibles par le client';
comment on column public.messages.traite is
  'Faux pendant le traitement d''un message vérifié (pièces jointes, questions, demande de modification) et s''il s''est interrompu : une relivraison de Resend le reprend là où il s''est arrêté (ou, après les nouvelles tentatives, l''agence : « Reprendre le traitement »)';
comment on column public.messages.traitement_le is
  'Début du traitement en cours : pendant 10 minutes, une relivraison du même e-mail est refusée (503) pour que Resend réessaie plus tard';
comment on column public.messages.etape is 'Étape du dossier à la réception (projets.etape)';
comment on column public.messages.resend_id is 'Identifiant Resend de l''e-mail reçu : un même e-mail n''est enregistré qu''une fois';
comment on column public.messages.auth is 'Authentification de l''e-mail fournie par Resend : { "spf", "dkim", "dmarc" }';
