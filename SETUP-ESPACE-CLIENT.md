# Mise en place de l'espace client

Ce qu'il faut pour que « Envoyer la demande » crée automatiquement un dossier, stocke les pièces jointes,
ouvre un espace client et envoie les e-mails. Compter une heure, en suivant les étapes dans l'ordre.

## Architecture retenue

| Besoin | Outil | Pourquoi |
|---|---|---|
| Base de données (dossiers, timeline) | Supabase (Postgres) | Hébergé en Europe, règles de sécurité par ligne, gratuit pour démarrer |
| Comptes clients | Supabase Auth, connexion par code reçu par e-mail | Pas de mot de passe à gérer, un client = une adresse e-mail |
| Fichiers (pièces du client, documents de l'agence) | Supabase Storage, bucket privé `dossiers` | Un dossier par projet, liens de téléchargement temporaires, 1 Go gratuit puis 100 Go (offre Pro) |
| Réception du formulaire | Supabase Edge Function `demande` | Code serveur sans serveur à maintenir |
| Suivi du dossier (e-mails au client, discussion, signature, espace agence) | Supabase Edge Function `espace` | Même principe |
| Envoi des e-mails | Resend | 3 000 e-mails/mois gratuits, envoi depuis contact@atomes.studio |
| Lecture des e-mails des clients (contact@, simon@) | Moteur de l'agence, sur ton ordinateur (§ 8) | Le client écrit à l'agence, pas à une adresse technique ; aucun service de plus |
| Signature du devis | Page du site ouverte par un lien reçu par e-mail | Signature électronique simple, sans abonnement (pas de Yousign) |
| Paiement | Virement bancaire | Sans frais ; le numéro de dossier sert de référence |
| Site (vitrine + espace client) | GitHub Pages, inchangé | Statique, gratuit |

Le site continue de fonctionner sans rien de tout cela : tant que `site/assets/js/config.js` est vide, le
formulaire de devis envoie via FormSubmit comme avant. Une fois configuré, FormSubmit reste la roue de secours :
si la fonction ne répond pas, la demande part par FormSubmit ; si la fonction a créé le dossier mais n'a
pas pu te prévenir par e-mail, le formulaire t'envoie quand même la notification FormSubmit avec le numéro
de dossier.

## 1. Supabase

1. Créer un compte sur supabase.com, puis un projet : nom `atomes`, région **West EU (Paris)** ou
   **Central EU (Frankfurt)**, mot de passe de base de données à conserver.
2. Menu **SQL Editor** → New query → coller tout le contenu de chaque fichier de `supabase/migrations/`, dans
   l'ordre (`0001_…`, `0002_…`, `0003_…`, `0004_…`, `0005_…`, puis `0006_…`), → Run à chaque fois. Le résultat doit
   être « Success ». Ceci vaut pour un projet neuf seulement : sur le projet en service, ne plus jamais rejouer
   0001 à 0005 (voir « Mises à jour à appliquer », Discussion).
   Projet créé depuis le 30 mai 2026 (et tout projet à partir du 30 octobre 2026) : Supabase n'ouvre plus d'office
   à l'API les tables que créent ces fichiers. Vérifier ensuite, dans le SQL Editor :
   ```sql
   select has_table_privilege('authenticated', 'public.projets', 'select') as client,
          has_table_privilege('service_role', 'public.projets', 'insert') as fonction;
   ```
   Les deux valeurs (`client`, `fonction`) doivent être `true`. Sinon, lancer (0005 et 0006 le font déjà pour
   `messages`, `questions`, `modifications` et `evenements`) :
   ```sql
   grant select, insert, update, delete on public.projets, public.etapes, public.modele_etapes, public.admins
     to authenticated, service_role;
   grant usage, select on all sequences in schema public to authenticated, service_role;
   ```
3. **Authentication → Sign In / Providers → Email** : laisser le provider Email activé (c'est lui qui
   envoie les codes de connexion). Laisser « Confirm email » tel quel : les comptes sont créés déjà
   confirmés par la fonction.
4. **Authentication → Sign In / Providers → User Signups** (ou « Settings ») : **désactiver « Allow new
   users to sign up »**. Important : sinon n'importe qui pourrait créer un compte avec l'adresse e-mail
   d'un futur client et récupérer son dossier. Les comptes sont créés uniquement par la fonction
   `demande` (ou par toi, voir § 5), et les clients existants continuent de recevoir leurs codes.
5. **Authentication → URL Configuration** : Site URL = `https://atomes.studio` ; Redirect URLs : ajouter
   `https://atomes.studio/dossier/` et `http://localhost:3000/dossier/`.
6. Le modèle de l'e-mail de connexion se personnalise seulement après l'étape 2.4 (Supabase bloque les
   modèles tant qu'aucun SMTP personnalisé n'est configuré) : voir l'étape 2.5.
7. **Project Settings → API Keys** : noter la **Project URL** et la clé publique. Selon la date de
   création du projet elle s'appelle « anon public » (commence par `eyJ…`) ou « Publishable key »
   (commence par `sb_publishable_…`) : les deux conviennent pour le site. Créer aussi une **Secret key**
   (`sb_secret_…`, bouton « Create new API key ») pour la fonction, étape 3. Ne jamais mettre une clé
   secrète (`sb_secret_…` ou `service_role`) dans le site.

## 2. Resend (e-mails)

1. Créer un compte sur resend.com.
2. **Domains → Add domain** : `atomes.studio`, région **eu-west-1 (Irlande)** pour garder les e-mails en
   Europe. Resend affiche les enregistrements DNS à créer chez LWS (panel LWS → domaine → zone DNS) :
   recopier **exactement** ce que Resend affiche, type, nom et valeur. En octobre 2026 : un TXT
   `resend._domainkey` (DKIM) et deux CNAME, `rsend` → `rsend-euw1.forge.rmta.net` et
   `send` → `send.forge.rmta.net`. Chez LWS, le nom se saisit sans `.atomes.studio`, et toute valeur qui
   est un nom de domaine doit se terminer par un point (`send.forge.rmta.net.`), sinon LWS lui ajoute
   `.atomes.studio`. TTL : 15 minutes. Un nom portant un CNAME ne peut porter aucun autre enregistrement.
   Attendre la vérification (quelques minutes à quelques heures). Tant que le domaine n'est pas vérifié,
   Resend n'envoie qu'à ta propre adresse et Supabase répond « Error sending magic link email ».
3. **API Keys → Create** : permission **Sending access** suffit (les fonctions ne font qu'envoyer ; une clé
   **Full access** déjà en place convient aussi). Noter la clé (`re_…`).
4. Dans Supabase, **Authentication → Emails → onglet SMTP Settings** : activer Custom SMTP avec
   host `smtp.resend.com`, port `465`, user `resend`, password = la clé API, sender `contact@atomes.studio`,
   sender name `Atomes studio`. Indispensable : sans SMTP personnalisé, Supabase n'envoie les codes de
   connexion qu'aux membres de ton équipe Supabase, et deux par heure. Les clients ne recevraient rien.
5. Maintenant que le SMTP est configuré, **Authentication → Emails → Templates → Magic link** :
   objet `Votre code de connexion — Atomes studio` ; corps : onglet **Source**, tout effacer, coller le
   contenu de `emails/supabase-magic-link.html` (même mise en page et même signature que les e-mails de la
   fonction `demande` ; l'e-mail ne contient que le code, aucun lien de connexion), puis « Save changes ». Le logo
   de la signature est `https://atomes.studio/images/logo-signature.gif` : il s'affiche dès que le site est publié
   avec le dossier `images/` à jour. Vérifier aussi, dans **Authentication → Sign In / Providers → Email**,
   « Email OTP Length » = **6** et « Email OTP Expiration » = **3600** (une heure, comme le dit l'e-mail).

Resend ne sert qu'à envoyer. Les réponses des clients arrivent à contact@atomes.studio (adresse de réponse de tous les
e-mails), et le moteur de l'agence les range dans les dossiers (§ 8).

## 3. Déployer la fonction « demande »

Par le tableau de bord (sans rien installer) :

1. **Edge Functions → Deploy a new function → Via editor**, nom `demande`.
2. Coller le contenu de `supabase/functions/demande/index.ts`, Deploy.
3. Dans les détails de la fonction (onglet Details), **désactiver « Verify JWT »** (aussi appelé « Verify
   JWT with legacy secret »). La fonction est appelée par les visiteurs du site, sans compte ; elle a ses
   propres protections : champ piège, validation, limites de débit.
4. **Edge Functions → Secrets** : ajouter `RESEND_API_KEY` = la clé Resend et `SB_SECRET_KEY` = la Secret
   key créée à l'étape 1.7. Facultatif : `MAIL_AGENCE` (défaut contact@atomes.studio), `MAIL_FROM`
   (défaut `Atomes studio <contact@atomes.studio>`), `SITE_URL` (défaut https://atomes.studio),
   `ORIGINES_AUTORISEES` (sites autorisés à appeler la fonction, séparés par des virgules ; défaut
   `https://atomes.studio,https://www.atomes.studio,http://localhost:3000`). Les secrets sont communs à toutes les
   fonctions du projet : ceux-ci servent aussi à la fonction `espace` (§ 7).
5. Rien à faire ici, pour information : l'adresse à laquelle le site appelle la fonction est
   `https://zvgkvovqmxmpdijubmaz.supabase.co/functions/v1/demande`. Elle est déjà inscrite dans
   `site/assets/js/config.js` (étape 4).

Autre méthode, à ignorer si tu as déployé par le tableau de bord : en ligne de commande, `npx supabase login`,
`npx supabase link --project-ref zvgkvovqmxmpdijubmaz`, `npx supabase functions deploy demande --no-verify-jwt`,
`npx supabase secrets set RESEND_API_KEY=re_… SB_SECRET_KEY=sb_secret_…`.

## 4. Brancher le site

**Déjà fait le 13 octobre 2026** : `site/assets/js/config.js` contient la Project URL, la clé publique
(`sb_publishable_…`) et les adresses des deux fonctions. À refaire seulement si tu changes de projet Supabase ou
régénères la clé publique :

```js
window.ATOMES_CONFIG = {
  supabaseUrl: 'https://<ref>.supabase.co',
  supabaseAnonKey: '<clé publique, étape 1.7>',
  apiUrl: 'https://<ref>.supabase.co/functions/v1/demande',
  espaceUrl: 'https://<ref>.supabase.co/functions/v1/espace'
};
```

## 5. Ton accès agence

L'espace client refuse les adresses inconnues : ton compte doit être créé depuis Supabase.

1. **Authentication → Users → Add user → Create new user** : e-mail `contact@atomes.studio`, cocher
   « Auto Confirm User », créer.
2. SQL Editor :
   ```sql
   insert into public.admins (user_id) select id from auth.users where email = 'contact@atomes.studio';
   ```
   L'éditeur affiche « Success. No rows returned » (un insert ne renvoie rien). Pour vérifier, lancer :
   ```sql
   select u.email, a.ajoute_le from public.admins a join auth.users u on u.id = a.user_id;
   ```
   qui doit renvoyer une ligne avec contact@atomes.studio. Si elle renvoie 0 ligne, l'utilisateur de
   l'étape 5.1 n'existe pas : le créer, puis relancer l'insert. Tu vois alors tous les dossiers dans
   l'espace client, avec tous les documents.
3. Ouvrir `https://atomes.studio/dossier/` (ou localhost:3000/dossier/), entrer contact@atomes.studio,
   puis le code reçu par e-mail.

## 6. Tester

1. `npx serve site`, ouvrir http://localhost:3000/devis.html (ce port exactement, sinon ajouter l'adresse
   affichée à `ORIGINES_AUTORISEES`), envoyer une demande avec une adresse e-mail à toi (différente de
   contact@atomes.studio) et une pièce jointe.
2. Vérifier : l'écran « Demande envoyée » affiche un numéro de dossier ; deux e-mails arrivent (accusé de
   réception au client, notification à l'agence) ; dans Supabase, **Table Editor → projets** contient la
   ligne et **Storage → dossiers → <numéro> → client** contient le fichier.
3. Se connecter sur /dossier/ avec l'adresse du test : timeline, discussion et documents apparaissent.
4. Le parcours complet (discussion, réponses par e-mail, signature, virement) se teste au § 7, point 5, une fois le
   moteur de l'agence en route (§ 8).

## Mises à jour à appliquer

### Discussion (octobre 2026)

Chaque dossier a désormais une **discussion**, la même dans l'espace agence et dans l'espace client, du plus ancien
au plus récent : tes messages au client (il les reçoit en entier par e-mail, pièces jointes comprises), ses réponses
par e-mail (rangées par le moteur de l'agence), les messages qu'il écrit depuis son espace, avec photos et PDF, et les
étapes clés du dossier (demande reçue, devis envoyé, devis signé, paiement reçu, documents prêts, documents validés,
rétractation, dossier clos). Elle remplace les « Questions au client » et les demandes de modification repérées dans
les e-mails : les questions déjà posées, les réponses et les demandes déjà reçues y sont reprises. Mode d'emploi :
« Au quotidien », Discussion.

La même mise à jour change la **rétractation** (décisions du 21 et du 22 octobre 2026) : le lien « Renoncer au contrat
ici » est désormais en bas de l'espace client et de la page de signature, et mène au formulaire de rétractation du
site (https://atomes.studio/renoncer/) ; l'information sur la rétractation et le formulaire type sont dans les
conditions générales, à la fin de chaque devis (« À savoir »). Côté technique, rien de plus à appliquer : la fonction
`espace` (étape 2) et le site (étape 3) suffisent. Mode d'emploi : « Au quotidien », Rétractation.

**Rétractation et conditions générales** : dès l'étape 3, la page de signature dit à tout client, professionnel
compris, « En signant, vous acceptez nos conditions générales, jointes au devis. », et l'e-mail du devis « Nos
conditions générales figurent à la fin du devis. » ; le client particulier ne reçoit plus l'information sur la
rétractation et le formulaire type que par elles. La séance peut donc avoir lieu avant qu'elles soient prêtes, à deux
conditions : aucun devis en attente de signature (« Validation de votre devis ») dont le PDF ne les contient pas (le
renvoyer avec elles, même montant, sinon le client le signerait sous cette phrase) ; et aucun devis envoyé ensuite
sans les conditions générales complètes (version 1 du 21 octobre 2026, plus aucun « [À COMPLÉTER] ») imprimées à sa
fin. Sans elles, un client particulier pourrait renoncer pendant douze mois au lieu de quatorze jours.

**Avant la séance** : Claude a intégré la discussion à `main` dans ce dépôt, sans la publier. Ne pas faire « Sync
Changes » avant l'étape 3. Les étapes 1 à 3 se font d'affilée, dans la même séance et dans cet ordre.

1. **SQL Editor** → New query → coller tout le contenu de `supabase/migrations/0006_discussion.sql` → Run. Si
   l'éditeur demande de confirmer une opération « destructive » (le fichier contient des `drop … if exists`),
   confirmer. Le résultat doit être « Success ». La migration s'exécute d'un seul bloc, en quelques secondes : pendant
   ce temps, une connexion, une demande de devis ou un passage du moteur attend qu'elle finisse. Si elle échoue, rien
   n'est appliqué :
   - « lock timeout » (« canceling statement due to lock timeout ») : la base était occupée plus de 5 secondes (passage
     du moteur, connexion d'un client) ; relancer une minute plus tard ;
   - « Migration 0005 absente : rien n'a été modifié » : s'arrêter là et prévenir Claude ;
   - « current transaction is aborted » : dans une nouvelle requête, exécuter `rollback;` seul, puis recoller le
     fichier et relancer ;
   - toute autre erreur : rien n'est appliqué ; s'arrêter, copier le message et prévenir Claude.

   Contrôles, dans le SQL Editor, une requête à la fois :
   ```sql
   select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'messages' order by ordinal_position;
   ```
   La liste doit contenir `auteur`, `origine`, `auteur_id`, `mail_etat`, `mail_le`, `cle`, `reprise` et
   `lu_agence_le`.
   ```sql
   select type, count(*) from public.evenements group by type;
   ```
   Étapes clés reprises des dossiers existants : une ligne `demande_recue` dont le nombre est celui des dossiers, puis
   les autres types selon l'avancement des dossiers. Pour comparer (la liste « En cours » de l'espace agence cache les
   dossiers clos) :
   ```sql
   select (select count(*) from public.projets) as dossiers,
          (select count(*) from public.evenements where type = 'demande_recue') as demandes;
   ```
   Les deux nombres doivent être égaux.
   ```sql
   select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' order by 1;
   ```
   Quatre lignes : `admin depose dans les dossiers`, `admin modifie le stockage`, `admin supprime du stockage`,
   `client lit son dossier` (et surtout pas « client depose dans son dossier » : le client ne dépose jamais lui-même).
   ```sql
   select has_table_privilege('anon', 'public.evenements', 'select'),
          has_table_privilege('authenticated', 'public.evenements', 'insert'),
          has_table_privilege('authenticated', 'public.messages', 'insert'),
          has_table_privilege('authenticated', 'public.envois_client', 'select');
   ```
   Quatre fois `false` (`envois_client` : table interne de la fonction, un seul envoi du client à la fois par dossier).
   ```sql
   select relrowsecurity from pg_class where oid = 'public.messages'::regclass;
   ```
   `true` (la lecture des messages reste filtrée dossier par dossier).
   ```sql
   select tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('messages', 'evenements') order by 1, 2;
   ```
   Exactement deux lignes : `evenements | client lit ses evenements` et `messages | client lit ses messages`.
   ```sql
   select public from storage.buckets where id = 'dossiers';
   ```
   `false` (le bucket reste privé).

   Ne passer à l'étape 2 qu'après le « Success » et ces contrôles. Si l'un d'eux ne donne pas ce qui est attendu,
   s'arrêter et prévenir Claude. 0006 peut être rejouée sans rien changer. **Ne plus jamais rejouer 0001 à 0005.** Si
   0005 a été rejouée (elle rend à l'agence l'écriture directe dans messages), rejouer 0006 aussitôt. 0001 rejouée en
   entier échoue d'elle-même sans rien changer. Si une partie d'une migration ancienne a été exécutée, s'arrêter et
   prévenir Claude : 0006 ne répare pas la timeline.
2. **Redéployer la fonction `espace`** (§ 7, point 1). Avant de remplacer le code : **Edge Functions → espace →
   Code**, tout sélectionner, copier, et coller dans un fichier hors du dépôt (par exemple sur le Bureau) : c'est le
   retour arrière (recoller ce code, **Deploy updates**). La migration resterait alors en place : l'ancienne fonction
   et les pages en ligne fonctionnent avec elle ; les envois de la discussion (messages de l'agence et du client),
   « Renvoyer l'e-mail » et le marquage « lu » seraient refusés (« Action inconnue » ou « Requête illisible ») : les
   messages du client resteraient « Nouveau » jusqu'au redéploiement. Le formulaire de rétractation du site refuserait
   lui aussi tout envoi (« Action impossible pour le moment… », qui renvoie à contact@atomes.studio) ; la page de
   signature reprendrait l'ancien texte de la case, et les e-mails du devis l'ancienne information sur la
   rétractation. « Verify JWT » reste désactivé. La fonction `demande` ne change pas.
3. **Publier le site** (VS Code → Sync Changes), attendre le vert dans l'onglet Actions de GitHub, puis une dizaine
   de minutes. Recharger ensuite les onglets de /admin/ et /dossier/ restés ouverts : un onglet ouvert avant la
   publication garde l'ancien script.
4. **Moteur de l'agence** : rien à faire pendant la séance. Claude le met à jour après l'étape 3 (site publié), juste
   après l'un de ses passages (marche à suivre dans son `README.md`, « Mettre à jour le moteur en service »). Jusque-là,
   l'ancien moteur tourne : il est compatible avec la migration, la nouvelle fonction et le nouveau site, et le test
   de l'étape 5 passe avec lui. Une fois fait, `.\moteur etat` affiche « Version : 0.2.0 » et « Dernier passage : …
   (version 0.2.0) » ; sans ligne « Version », c'est l'ancien moteur. Tant que l'ancien tourne, tes messages et ceux
   que le client écrit dans son espace comptent dans sa limite de 30 messages par dossier et par 24 h.
5. **Tester**, depuis https://atomes.studio, sur un dossier de test créé avec ton adresse personnelle (pas une
   adresse en atomes.studio, que le moteur ignore) :
   1. Espace agence, fiche du dossier, **Discussion** : écrire un message, « Envoyer au client ». La page annonce
      « Message envoyé au client par e-mail. » et l'e-mail « Message d'Atomes studio — dossier … » arrive à ton
      adresse personnelle, avec la timeline du dossier.
   2. Y répondre par e-mail : au passage suivant du moteur (5 minutes, ordinateur allumé), la réponse s'affiche dans
      la discussion avec le badge « Nouveau ».
   3. Dans une fenêtre privée, se connecter sur https://atomes.studio/dossier/ avec ton adresse personnelle : la
      discussion montre les deux messages et les étapes clés. Écrire un message avec environ 9,5 Mo de photos en
      plusieurs fichiers, « Envoyer » : « Message envoyé. ». L'avis « Message du client — dossier … » arrive à
      contact@ ; dans l'espace agence, le message s'affiche (« Nouveau ») avec ses photos, aussi sous « Pièces du
      client ».
   4. Espace agence : un message au client avec environ 14 Mo de pièces jointes (PDF ou photos) : l'e-mail arrive
      avec ses pièces.
   5. **Edge Functions → espace → Logs** : ni « CPU Time exceeded » ni « Memory limit exceeded ».
   6. **Affichage de l'espace client**, sur ce dossier. Sur ordinateur (fenêtre privée du point 3, agrandie) : trois
      colonnes, « Avancement » et « Votre demande » à gauche, « Discussion » au milieu, les documents à droite.
      Fenêtre rétrécie : deux colonnes (discussion à droite), puis une seule. La discussion remplit la hauteur de la
      fenêtre et ne bouge pas quand la page défile. Ses messages défilent à l'intérieur, le dernier visible, et
      « Envoyer » reste visible en bas. Sur un écran peu haut (fenêtre de moins de 620 px de haut), elle reste dans
      la page : c'est voulu. Les pièces jointes du point 4 figurent aussi sous « Documents de l'agence ». Sur ton
      téléphone (même connexion, par code) : une seule colonne, dans l'ordre « Avancement », « Discussion », les
      documents, puis « Votre demande ».
   7. **Signature et rétractation**, sur un dossier de test au profil Particulier (au besoin, une nouvelle demande sur
      https://atomes.studio/devis.html avec ton adresse personnelle). Espace agence : envoyer un devis (un PDF
      quelconque, 1 €). L'e-mail « Votre devis est prêt » contient le PDF, le bouton « Lire et signer mon devis » et
      « Nos conditions générales figurent à la fin du devis. », sans information sur la rétractation. La page de
      signature montre la case (texte du 22 octobre, celui de l'article 11.4 des conditions générales), puis, juste
      au-dessus du bouton, « En signant, vous acceptez nos conditions générales, jointes au devis. », et « Renoncer au
      contrat ici » en bas de page. Cocher, saisir le nom, signer : la confirmation ne propose aucun lien de
      rétractation (seul reste celui du bas de page). L'e-mail « Devis signé » contient le devis et une phrase qui
      cite la case cochée, sans bloc de rétractation. Puis, en bas de l'espace client, cliquer « Renoncer au contrat
      ici » : https://atomes.studio/renoncer/ s'ouvre. Saisir ton nom, le numéro du dossier et une autre adresse que
      celle du dossier, « Confirmer la rétractation » : la page répond « Nous ne retrouvons pas de contrat en
      cours… », et rien n'est enregistré ni envoyé. Mettre l'adresse du dossier, et une autre adresse à toi dans
      « Autre adresse pour l'accusé de réception », puis de nouveau « Confirmer la rétractation » : la page affiche
      « Votre rétractation a bien été reçue le … » ; l'accusé de réception arrive aux deux adresses (il reprend ton
      nom, le numéro du dossier, les deux adresses, puis la date et l'heure de réception), « Rétractation —
      dossier … » à contact@ (« par le formulaire du site »), et la fiche du dossier affiche la rétractation.
      Recharger la page et renvoyer le formulaire : « Votre rétractation était déjà enregistrée. ».

   Si un essai échoue : ne rien défaire ; noter le message affiché et l'heure, regarder Edge Functions → espace →
   Logs, puis prévenir Claude. La base reste telle quelle : l'ancienne fonction et l'ancien site fonctionnent avec
   elle. Le retour arrière de la fonction (étape 2) ne se fait que si Claude le demande, car il bloque tous les envois
   de la discussion. S'il faut revenir en arrière pour le site, Claude s'en charge (annulation du commit, puis
   publication).

Entre l'étape 1 et la fin de l'étape 3 (dix minutes comprises) : ne rien faire dans l'espace agence. L'ancien site
montre les questions reprises comme des messages du client ; aucun vrai client à ce jour.

### Connexion par code (19 octobre 2026)

Pour entrer dans l'espace client (https://atomes.studio/dossier/) comme dans l'espace agence (/admin/), on tape son
adresse, puis le code reçu par e-mail (6 chiffres, valable une heure, une seule fois) : plus aucun lien de connexion.
Les e-mails automatiques (fonctions `espace` et `demande`) gardent le simple lien « Suivre mon dossier en ligne », qui
mène à cette page : un e-mail transféré (banque, notaire, entreprise) ne donne accès à rien. Cette mise à jour remplace
le lien direct, publié le 19 octobre au soir puis abandonné : ne pas appliquer ses réglages ; si tu l'as fait, ils sont
défaits ici. Dans la même séance, dans cet ordre :

1. **Supabase → Authentication → Sign In / Providers → Email** : « Email OTP Expiration » = **3600**, enregistrer ;
   puis « Email OTP Length » = **6**, enregistrer. Cet ordre, pour qu'un code court ne soit jamais valable 24 heures,
   même un instant. Si ces valeurs y sont déjà, rien à changer.
2. **Redéployer la fonction `espace`** (§ 7, point 1), puis **la fonction `demande`** (§ 3) : même copier-coller que
   d'habitude. Ce redéploiement couvre aussi les étapes 2 et 3 du moteur (sous-section suivante).
3. Avant de publier, ouvrir **Authentication → Emails → Templates → Magic link**, onglet **Source**. S'il contient
   `#connexion=` (modèle du lien direct), personne ne pourra se connecter entre la publication et l'étape 4 : faire
   alors l'étape 4 dès le vert de l'onglet Actions et la vérification en fenêtre privée, sans attendre les dix
   minutes. S'il contient `ConfirmationURL`, garder l'attente : son lien fonctionne avec les anciennes comme avec les
   nouvelles pages. Puis **publier le site** (VS Code → Sync Changes), attendre le vert dans l'onglet Actions de
   GitHub, puis une dizaine de minutes (dans ce délai, une page restée sur « Chargement… » se répare en la
   rechargeant). Ouvrir https://atomes.studio/dossier/ en fenêtre privée : le bouton doit dire « Recevoir mon code de
   connexion ».
4. **Seulement alors**, **Authentication → Emails → Templates → Magic link** : objet `Votre code de connexion — Atomes
   studio`, corps = contenu de `emails/supabase-magic-link.html` (onglet **Source**, tout remplacer), « Save changes ».
   Jamais avant l'étape 3 : les pages encore en ligne attendraient un lien, et personne ne pourrait se connecter, toi
   compris.
5. **Tester**, en fenêtre privée : ouvrir https://atomes.studio/admin/, entrer contact@atomes.studio, « Recevoir mon
   code de connexion ». Aussitôt, sans attendre l'e-mail, cliquer « Recevoir un nouveau code » : la page demande de
   patienter une minute. Quand l'e-mail arrive, taper d'abord un faux code de 6 chiffres : il est refusé. Puis taper
   le code reçu : l'espace agence s'affiche. Si l'e-mail contient un bouton ou un lien au lieu d'un code, le modèle
   de l'étape 4 n'est pas enregistré : le recoller. (Si un second e-mail arrive quand même, seul son code est
   valable.)

Inchangés : les Redirect URLs (laisser celles déjà ajoutées) et le suivi des clics de Resend (Click Tracking),
désactivé : le garder ainsi.

Pendant la transition, un client qui ouvre le lien d'un e-mail envoyé depuis le 19 octobre au soir, avant cette mise
à jour (adresse en `#connexion=…`), arrive sur la page de connexion, avec un message qui lui demande son adresse, et
se connecte par code, une fois l'étape 4 faite.

### Moteur de l'agence (19 octobre 2026)

Ses étapes 2 à 4 sont faites par la sous-section « Connexion par code » ci-dessus (même redéploiement, même
publication). Si le moteur tourne déjà sur ton ordinateur (`.\moteur etat` : tâche planifiée installée, passage
récent), rien d'autre à faire ici. Sinon, faire son étape 1 (jusqu'au premier passage réel, § 8, point 4) avant
« Connexion par code », puis son étape 5 ; si « Connexion par code » est déjà faite, lancer au § 8, point 4,
`.\moteur courrier --ecrire --depuis AAAA-MM-JJ` avec la date du redéploiement de `espace`, pour ranger les
réponses reçues entre-temps.

Les clients écrivent désormais à contact@atomes.studio ou à simon@atomes.studio : contact@ devient l'adresse de
réponse de tous les e-mails, et le moteur de l'agence, sur ton ordinateur, range dans les dossiers les e-mails des
clients reçus dans ces deux boîtes (§ 8). Dans la même séance, dans cet ordre :

1. **Installer le moteur et faire l'essai** (§ 8, points 1 à 4).
2. **Redéployer la fonction `espace`** (§ 7, point 1) avec le `index.ts` à jour : adresse de réponse contact@, et
   « Rattacher au dossier » d'un message lu par le moteur. Entre les étapes 1 et 2, ne pas cliquer « Rattacher au
   dossier » sur un message du moteur (l'ancienne fonction le rattacherait sans ses pièces).
3. **Redéployer la fonction `demande`** (§ 3, même méthode) : l'accusé de réception a contact@ pour adresse de
   réponse. Elle ne lit plus `JETON_SECRET` ni `REPONSES_DOMAINE` (rien à changer dans les secrets).
4. **Publier le site** (VS Code → Sync Changes), attendre le vert dans l'onglet Actions de GitHub, puis une dizaine
   de minutes : l'espace agence affiche les messages du moteur (« En attente du moteur », « Signature DKIM »).
5. **Lancement automatique du moteur** (§ 8, point 5), puis le test du § 8, point 6.

La réception par Resend (`REPONSES_DOMAINE`, webhook, compte Resend de réception, sous-domaine `r.atomes.studio`),
qui devait rester un mois pour les réponses aux e-mails envoyés avant cette mise à jour, a été retirée dès le
20 octobre 2026 : aucun vrai client n'avait encore reçu d'adresse de réponse en `@r.atomes.studio`. Ce qui a été
supprimé : § 8, point 7. Rien à redéployer.

### Parcours v3 (mis en ligne le 15 octobre 2026)

État au 14 octobre 2026 : le parcours v2 est en ligne (migrations 0001 à 0004, fonctions `espace` et `demande`,
site du 13 octobre). Le parcours v3 (tout par e-mail, signature par lien, virement, espace client en consultation)
s'applique **d'une traite, dans la même séance et dans cet ordre**.

**Avant la séance, par exemple la veille** : sous-domaine de réception chez Resend et enregistrements chez LWS. Plus
à faire, comme les étapes 6 et 7 : la réception par Resend a été retirée le 20 octobre 2026 (§ 7, point 3) ; les
réponses des clients arrivent à contact@ et le moteur de l'agence les range (§ 8).

**Avant de retirer Stripe : paiements par carte encore possibles.** Une session de paiement du parcours v2 reste
valable une heure après le clic du client sur « Payer ». Juste avant l'étape 3, lancer dans le SQL Editor :
```sql
select id, paiement_session from public.projets where paiement_session is not null and paye_le is null;
```
Pour chaque ligne, vérifier sur stripe.com (Paiements, recherche par la référence `cs_…`) que la session est expirée
ou terminée ; sinon, attendre une heure avant l'étape 3. Après l'étape 8, vérifier sur stripe.com qu'aucun paiement
n'est arrivé depuis la bascule. Un paiement par carte arrivé malgré tout se note à la main (Table Editor → `projets`
→ le dossier → `paye_le` = date du paiement, `paiement_ref` = référence `pi_…` du paiement sur stripe.com), puis
« Passer ici » sur « Production de vos documents » : pas « Virement reçu », qui écrirait au client que son virement
est reçu.

**Ne pas faire « Sync Changes » avant les étapes 1 à 3** : les nouvelles pages de l'espace client et de l'espace
agence lisent la table `messages` (migration 0005) et appellent la nouvelle fonction `espace`. Sans elles, elles
afficheraient « Impossible de charger… ».

1. **SQL Editor** : coller `supabase/migrations/0005_parcours_email.sql` → Run. Elle était rejouable jusqu'à la
   discussion ; depuis la migration 0006, ne plus jamais la rejouer (sous-section Discussion, étape 1). Dès ce
   moment, l'ancienne page de l'espace client, encore en ligne, ne pouvait plus déposer de fichiers.
2. **Secrets** : `JETON_SECRET` et les trois `VIREMENT_…` (§ 7, point 2).
3. **Redéployer la fonction `espace`** (§ 7, point 1). « Verify JWT » reste désactivé.
4. **Publier le site** (VS Code → Sync Changes) et attendre le vert dans l'onglet Actions de GitHub, puis une
   dizaine de minutes : les navigateurs peuvent garder l'ancienne page en cache jusqu'à 10 minutes. Cette
   publication met en ligne l'espace client en consultation, la page d'action (`/action/`, ouverte par les liens
   des e-mails) et le nouvel espace agence.
5. **Redéployer la fonction `demande`** avec le `index.ts` à jour (timeline et adresse de réponse dans l'accusé de
   réception).
6. **Webhook de réception** chez Resend, puis secret `RESEND_WEBHOOK_SECRET` : plus à faire (réception retirée le
   20 octobre 2026, § 7, point 3).
7. **Adresses de réponse** (secret `REPONSES_DOMAINE`) : plus à faire, pour la même raison.
8. **Retirer Stripe** (§ 7, point 4).
9. **Tester de bout en bout** (§ 7, point 5).

Entre les étapes 3 et 4 (cache compris), l'ancienne page de l'espace client affiche encore ses boutons (répondre,
signer, payer, valider) : ils renvoient une erreur. Ne rien faire dans l'espace agence pendant ce temps.

**Dossiers en cours au moment de la bascule** (liste « En cours » de l'espace agence ; sans doute aucun à ce
jour) :
- devis envoyé, signé ou non, mais pas encore payé : le renvoyer (« Envoyer le devis au client », même PDF, même
  montant). Le client reçoit le lien de signature puis, une fois signé, la confirmation avec les coordonnées du
  virement et, pour un particulier, l'information sur la rétractation, qu'il n'avait pas reçue jusqu'ici. Un
  particulier qui a signé dans l'ancien espace n'a pas coché la case de démarrage anticipé : si tu ne lui renvoies pas
  le devis, ne commence pas la mission avant la fin de son délai de rétractation (la confirmation de « Virement reçu »
  le rappelle) ;
- documents à valider : « Passer ici » sur « Production de vos documents », puis « Documents prêts : demander la
  validation » : le client reçoit le lien de validation.

## 7. Réponses par e-mail et virement

La fonction `espace` mène le dossier après la demande. Chaque étape importante est annoncée au client par e-mail,
avec la timeline de son dossier. Le client répond simplement aux e-mails : sa réponse et ses pièces jointes
s'ajoutent à la discussion du dossier (par le moteur de l'agence, § 8). Il peut aussi t'écrire depuis son espace
client, avec photos et PDF : ses messages passent par la fonction. Il signe le devis et valide ses documents sur une
page du site ouverte par un lien reçu par e-mail, sans se connecter, et paie par virement avec le numéro de dossier
pour référence : dans son espace, il consulte son dossier et écrit dans la discussion, rien d'autre. La fonction
reçoit aussi les actions de l'espace agence, dont tes messages au client, et les rétractations envoyées sans connexion
par le formulaire du site (https://atomes.studio/renoncer/).

1. **Déployer la fonction `espace`**. Première fois : **Edge Functions → Deploy a new function → Via editor**, nom
   `espace`, coller le contenu de `supabase/functions/espace/index.ts`, Deploy. Mise à jour : **Edge Functions →
   espace → Code**, tout remplacer par le contenu du fichier, **Deploy updates**. Puis, dans ses détails, vérifier
   que **« Verify JWT » est désactivé** : la fonction vérifie elle-même la session de l'agence ou du client, ou le
   lien reçu par e-mail.
2. **Secrets**, dans **Edge Functions → Secrets** (`RESEND_API_KEY` et `SB_SECRET_KEY` y sont déjà). Ils sont pris
   en compte aussitôt, sans redéployer.
   - `JETON_SECRET` : 40 caractères aléatoires. Pour les obtenir : dans VS Code, **Terminal → New Terminal**,
     coller `node -e "console.log(require('crypto').randomBytes(30).toString('base64url'))"`, Entrée, puis copier
     la ligne affichée. Il signe les liens envoyés aux clients.
     **Ne le changer qu'en cas de fuite** : les liens déjà envoyés cesseraient de fonctionner. En garder une copie
     dans un gestionnaire de mots de passe, jamais dans le site ni dans une conversation. Sans lui, aucun lien ne
     peut être envoyé (« Liens indisponibles »).
   - `VIREMENT_IBAN` (tel que sur ton RIB), `VIREMENT_BIC` et `VIREMENT_TITULAIRE` (titulaire du compte, tel que
     sur le RIB). Ils s'affichent dans l'e-mail « Devis signé » et dans l'espace client, avec la référence du
     virement (le numéro de dossier). Sans eux, l'e-mail indique :
     « Les coordonnées bancaires figurent sur votre devis. »
     La fonction vérifie l'IBAN (clé de contrôle) et la présence du titulaire : un IBAN mal recopié, ou sans
     titulaire, n'est jamais envoyé (même phrase de repli) et l'erreur apparaît dans **Edge Functions → espace →
     Logs** (« VIREMENT_IBAN absent ou invalide »). Après le test du point 5, relire les coordonnées de l'e-mail
     « Devis signé » reçu.
   - Anciens secrets de la réception par Resend, `REPONSES_DOMAINE`, `RESEND_WEBHOOK_SECRET` et
     `RESEND_RECEPTION_KEY` : supprimés le 20 octobre 2026, à ne pas recréer. La fonction les lit encore : sans eux,
     son ancienne réception par webhook reste inactive (point 3).
   - Les liens des e-mails (signature, validation) mènent toujours à `SITE_URL` (https://atomes.studio),
     même si l'espace agence est ouvert depuis localhost. Une fois les essais en local finis, tu peux retirer
     localhost des origines autorisées : `ORIGINES_AUTORISEES` = `https://atomes.studio,https://www.atomes.studio`
     (facultatif ; à remettre pour essayer de nouveau le formulaire en local, § 6).
3. **Réception des réponses par Resend : retirée le 20 octobre 2026**, remplacée par le moteur de l'agence (§ 8). Les
   clients répondent à contact@atomes.studio, adresse de réponse de tous les e-mails, et le moteur range leurs e-mails
   dans les dossiers. Plus de sous-domaine `r.atomes.studio`, de webhook ni de compte Resend de réception : rien à
   créer. Ce qui a été supprimé : § 8, point 7.
4. **Retirer Stripe**, si tu l'avais configuré : dans **Edge Functions → Secrets**, supprimer `STRIPE_SECRET_KEY`
   et `STRIPE_WEBHOOK_SECRET` ; sur stripe.com, **Développeurs → Webhooks (Workbench)** → la destination vers
   `…/functions/v1/espace` → la supprimer. Le compte Stripe ne sert plus.
5. **Tester de bout en bout**, une fois le moteur en route (§ 8, points 1 à 5), depuis https://atomes.studio (les
   liens des e-mails mènent toujours au site en ligne, point 2), avec une adresse e-mail personnelle d'une messagerie
   courante (Gmail, Outlook, Orange…), pas en atomes.studio (le moteur ignore les e-mails de l'agence) :
   1. Envoyer une demande sur https://atomes.studio/devis.html, profil **Particulier**. L'accusé de réception
      montre la timeline ; « Répondre » propose contact@atomes.studio.
   2. Répondre à cet e-mail avec une photo jointe. La réponse arrive dans la boîte contact@ ; dans les 5 minutes, le
      moteur la range : la discussion du dossier (espace agence) montre le message, avec le badge « Nouveau », et la
      photo (aucun e-mail ne l'annonce).
   3. Espace agence, **Discussion** : écrire au client, « Envoyer au client ». L'e-mail « Message d'Atomes studio —
      dossier … » arrive à l'adresse du test ; y répondre. Dans les 5 minutes, la réponse s'affiche dans la
      discussion.
   4. Envoyer un devis (un PDF quelconque, 1 €). L'e-mail « Votre devis est prêt » contient le PDF, le bouton
      « Lire et signer mon devis » et « Nos conditions générales figurent à la fin du devis. ». Sur la page qui
      s'ouvre (« En signant, vous acceptez nos conditions générales, jointes au devis. » juste au-dessus du bouton),
      cliquer « Signer et commander avec obligation de paiement » sans cocher la case : un message demande de la
      cocher. Cocher, saisir le nom, signer. L'e-mail « Devis signé » contient la preuve de signature, le devis,
      les coordonnées et la référence du virement, et cite la case cochée. Dans la fiche du dossier, l'adresse
      IP de la signature doit être la tienne (la comparer avec celle qu'affiche une recherche « mon adresse IP ») ;
      sinon, le signaler : la règle qui la choisit est à ajuster.
   5. Espace agence : le dossier est en « Virement attendu ». Cliquer « Virement reçu » : e-mail « Paiement
      reçu », et le dossier passe en production.
   6. Déposer un document, puis « Documents prêts : demander la validation ». Répondre à l'e-mail « Vos documents
      sont prêts » : dans les 5 minutes, la réponse s'affiche dans la discussion et le dossier passe « Message du
      client » dans la liste. Puis, dans le même e-mail, cliquer « Voir et valider mes documents », et « Je valide mes
      documents ».
   7. En bas de la page de signature ou de l'espace client, cliquer « Renoncer au contrat ici » (ou ouvrir
      https://atomes.studio/renoncer/) ; saisir le nom, le numéro du dossier et l'adresse du test, « Confirmer la
      rétractation ». L'accusé de réception arrive à l'adresse du test, « Rétractation — dossier … » à
      contact@atomes.studio, et la fiche affiche la rétractation : le dossier, clos au point 6, s'affiche
      « Rétractation reçue » (reçue après la clôture) dans les dossiers « À traiter ».
   8. Depuis une autre adresse à toi (ni celle du test, ni une adresse en atomes.studio), écrire à
      contact@atomes.studio avec le numéro du dossier dans l'objet : dans les 5 minutes, la fiche montre le message
      avec le badge « À vérifier » (aucun e-mail ne l'annonce). Le supprimer.
   9. Se connecter sur https://atomes.studio/dossier/ avec l'adresse du test, depuis le téléphone ou un autre
      navigateur (dans le même navigateur, la connexion du client remplacerait celle de l'agence) : timeline,
      discussion (messages et étapes clés) et documents s'affichent, sans bouton pour signer, payer ou valider.
      Écrire un message avec une photo depuis la discussion : l'avis « Message du client — dossier … » arrive à
      contact@, et la fiche du dossier montre le message avec le badge « Nouveau ».

   Si une réponse n'arrive pas dans le dossier : voir « En dépannage ». Le dossier de test se supprime ensuite
   comme indiqué dans « À savoir » (RGPD).

## 8. Moteur de l'agence : e-mails des clients reçus sur contact@ et simon@

Le moteur est un programme qui tourne sur ton ordinateur (dossier `atomes-moteur`, à côté de ce dépôt, jamais
publié ; mode d'emploi complet dans son `README.md`). Toutes les 5 minutes, tant que ta session Windows est ouverte,
il lit les nouveaux e-mails de contact@atomes.studio et de simon@atomes.studio, sans rien y changer (rien n'est
marqué lu, déplacé ni supprimé), et range dans la discussion de leur dossier ceux des clients, comme la fonction
`espace` le faisait pour les réponses reçues par Resend (jusqu'au 20 octobre 2026, point 7) : texte sans la
citation, pièces jointes (images et PDF, 25 Mo au plus) dans `<numéro>/client/`. Depuis sa version 0.2.0 (la
discussion), il ne répond plus aux questions et ne note plus de demande de modification : tu lis le message dans la
discussion et tu y réponds depuis l'espace agence. Il n'envoie aucun e-mail : l'original est déjà dans ta boîte.

Règles :
- le numéro de dossier dans l'objet (« Re: Message d'Atomes studio — dossier 261014093512 ») désigne le dossier ;
  sans numéro, l'e-mail va au dernier dossier (le plus récent) de l'adresse de l'expéditeur ;
- un expéditeur inconnu sans numéro de dossier est ignoré, rien n'est enregistré (prospects, fournisseurs,
  publicités) ; les e-mails de l'agence (atomes.studio), les réponses automatiques et les indésirables aussi. Les
  e-mails de l'agence comprennent les avis que le site envoie à contact@ (« Message du client — dossier … ») et tes
  propres réponses écrites depuis ta messagerie : une telle réponse part au client mais n'entre pas dans la
  discussion (voir « Au quotidien », Discussion, case « Déjà envoyé depuis ma messagerie ») ;
- l'e-mail est rangé aussitôt s'il vient de l'adresse du dossier et porte une signature DKIM valable de son
  domaine, contrôlée par le moteur : c'est le cas des messageries courantes (Gmail, Outlook, Orange, Free,
  iCloud…). Sinon (autre adresse, signature absente ou fausse), il s'affiche « À vérifier » dans la fiche :
  « Rattacher au dossier » le confie au moteur (badge « En attente du moteur »), qui range ses pièces à son passage
  suivant ; ou « Supprimer » ;
- ordinateur éteint ou hors ligne : rien n'est perdu, le moteur reprend au dernier e-mail lu ;
- un même e-mail envoyé à contact@ et à simon@ n'est enregistré qu'une fois.

1. **Clé secrète du moteur** : Supabase → **Project Settings → API Keys → Secret keys → New secret key**, nom
   `moteur` → copier la clé `sb_secret_…` (ne pas la coller ailleurs que dans le moteur). Elle ne sert qu'à lui : si
   l'ordinateur est perdu ou volé, la supprimer ici ; le moteur s'arrête, le site continue.
2. **Configurer** : dans le dossier `atomes-moteur`, ouvrir PowerShell (clic droit → Ouvrir dans le terminal) et
   lancer `.\moteur configurer`. Il demande la clé (point 1), puis le serveur IMAP (`mail.atomes.studio`, port
   993, proposés) et le mot de passe de chaque boîte (ceux de LWS). Il vérifie chaque connexion. La clé et les mots
   de passe restent dans le Gestionnaire d'identification de Windows, jamais dans un fichier.
3. **Essai** : `.\moteur courrier`. Le moteur lit les e-mails des 7 derniers jours et montre ce qu'il rangerait,
   sans rien écrire (rapport gardé dans un fichier, chemin affiché).
4. **Premier passage réel** : `.\moteur courrier --ecrire`. Le départ est fixé au dernier e-mail présent : les
   e-mails déjà reçus ne sont pas rangés (pour en rattraper : `.\moteur courrier --ecrire --depuis 2026-10-15`).
5. **Lancement automatique** : `.\moteur installer` (tâche planifiée « Atomes studio\Moteur courrier », toutes les
   5 minutes, session ouverte). Suivi : `.\moteur etat` ; arrêt : `.\moteur desinstaller`.
6. **Tester**, depuis ton adresse personnelle, sur un dossier de test : répondre à un e-mail du dossier (son objet
   contient le numéro) avec une photo jointe ; dans les 5 minutes, la discussion du dossier montre le message et la
   photo. Puis
   écrire depuis une autre adresse, avec le numéro dans l'objet : badge « À vérifier » ; « Rattacher au dossier »,
   puis 5 minutes : la photo est rangée.
7. **Réception par Resend retirée le 20 octobre 2026.** Elle devait rester un mois, pour les réponses aux anciennes
   adresses de dossier en `@r.atomes.studio` ; aucun vrai client n'en ayant encore reçu, elle a été retirée aussitôt.
   Ont été supprimés :
   - dans Supabase (**Edge Functions → Secrets**), les secrets `REPONSES_DOMAINE`, `RESEND_WEBHOOK_SECRET` et
     `RESEND_RECEPTION_KEY` (pris en compte sans redéployer) ;
   - chez Resend, le webhook `email.received` vers la fonction `espace`, le domaine `r.atomes.studio` et le compte
     de réception, s'il était à part ;
   - chez LWS (zone DNS de `atomes.studio`), les enregistrements du sous-domaine `r` : ceux nommés `r` (MX) ou
     finissant par `.r` (ceux de Resend).

   La fonction `espace` garde le code de cette réception, inactif sans ces secrets : ses règles de texte et de pièces
   jointes servent de référence aux tests du moteur. Un e-mail envoyé à une ancienne adresse en `@r.atomes.studio`
   n'est plus reçu.

## Au quotidien : l'espace agence (https://atomes.studio/admin/)

Connexion avec ton compte agence (§ 5), par code reçu par e-mail. Si la page ne propose plus de saisir le code reçu
(rouverte ailleurs : autre onglet, autre appareil), entrer l'adresse puis « J'ai déjà un code » : en redemander un
annulerait le premier (même bouton pour les clients, sur /dossier/). La liste montre les dossiers en cours ; le filtre
« À traiter » ne garde que ceux où c'est à toi d'agir, dont ceux qui ont un message du client non lu. Elle se met à
jour seule toutes les minutes. Chaque étape importante est annoncée au client par e-mail, avec la timeline de son
dossier ; il te répond par e-mail ou depuis la discussion de son espace, et signe ou valide depuis les liens reçus
par e-mail. Dans la fiche d'un dossier, relue seule toutes les 30 secondes et quand tu reviens sur l'onglet :

- **Discussion** : tous les échanges avec le client, du plus ancien au plus récent, entre les étapes clés du dossier
  (demande reçue, devis envoyé, devis signé, paiement reçu, documents prêts, documents validés, rétractation,
  dossier clos). Tes messages sont à droite (« Vous »), ceux du client à gauche, avec son adresse s'il a écrit par
  e-mail, son nom s'il a écrit depuis son espace. Les 40 derniers éléments s'affichent (davantage s'il le faut pour
  montrer tout ce qui reste à traiter : message non lu, à vérifier ou dont l'e-mail n'est pas parti) ; « Afficher les
  messages précédents » montre le reste. Le client voit la même discussion dans son espace, sauf les messages « À
  vérifier ».
  Un message arrivé pendant que tu regardes la fiche s'ajoute au fil sans toucher à ce que tu es en train d'écrire.
  - **Écrire au client** : sous le fil, « Message au client » (5 000 caractères au plus), pièces jointes facultatives
    (PDF ou images, 10 au plus, 50 Mo par fichier), puis « Envoyer au client ». Le message s'ajoute à la discussion
    et part en entier au client par e-mail (« Message d'Atomes studio — dossier … », avec la timeline), pièces
    jointes comprises si elles tiennent en 15 Mo (au-delà, il les télécharge depuis son espace). Il te répond par
    e-mail (le moteur range sa réponse dans la discussion) ou depuis son espace. Tu peux écrire à toute étape,
    dossier clos ou rétractation reçue compris.
  - **E-mail non parti** : si l'e-mail n'a pas pu partir (quota de Resend atteint, panne), la page le dit, le message
    porte le badge « E-mail non parti » et le dossier s'affiche ainsi dans la liste : « Renvoyer l'e-mail » sous le
    message (aussi pour un envoi resté « Envoi en cours » plus de 10 minutes). Le message, lui, est déjà dans la
    discussion : le client le voit dans son espace.
  - **Déjà envoyé depuis ma messagerie** : une réponse écrite depuis ta messagerie part au client mais n'entre pas
    dans la discussion (le moteur ignore les e-mails de l'agence). Pour l'y ajouter, la recopier dans « Message au
    client » et cocher « Déjà envoyé depuis ma messagerie : ajouter à la discussion sans e-mail » : aucun e-mail ne
    part, et le message porte la mention « sans e-mail ».
  - **Messages écrits par le client dans son espace** (texte, photos et PDF ; 10 fichiers et 10 Mo par message,
    30 messages par jour) : ses pièces rejoignent ses documents (« Pièces du client »). Tu reçois à contact@ un avis
    « Message du client — dossier … » avec son texte, au plus un par dossier et par quart d'heure : les messages
    suivants de ce quart d'heure s'affichent dans l'espace agence, sans nouvel e-mail. **Ne réponds pas à cet
    avis** : ta réponse ne parviendrait pas au client. Réponds depuis la fiche.
  - **E-mails du client** : reçus sur contact@ et simon@, ils sont ajoutés à la discussion par le moteur de l'agence
    (§ 8), dans les 5 minutes, ordinateur allumé ; aucun e-mail ne te les annonce (l'original est dans ta boîte).
    Chacun s'affiche avec sa date, son expéditeur, son objet, sa réponse sans la citation de notre e-mail
    (« Message complet » : tout le texte) et ses pièces jointes. Ses pièces jointes, images et PDF de 25 Mo au plus,
    rejoignent ses documents ; lui demander les autres formats en PDF. Les images intégrées au texte (logo de sa
    signature, images de notre e-mail cité, logo d'Atomes studio) ne sont pas rangées. Un message n'est rattaché
    seul que s'il vient de l'adresse du dossier (adresse simple, seule dans l'en-tête From du message) et porte une
    signature DKIM valable du domaine de cette adresse, contrôlée par le moteur ; c'est le cas des messageries
    courantes (Gmail, Outlook, Orange, Free, iCloud…). Sinon il attend, avec le badge « À vérifier » (ses pièces
    jointes y sont listées, « non rangée ») et la raison : adresse différente, ou résultat de la signature DKIM
    (« Signature DKIM : absente », « échec »…). Si c'est bien le client (par exemple depuis une autre adresse, ou
    depuis une messagerie sans DKIM), « Rattacher au dossier » : le message devient visible dans son espace (il
    pourra lire tout l'e-mail, citation comprise, et l'adresse de l'expéditeur ; il n'est pas prévenu) et passe
    « En attente du moteur » ; ses pièces sont rangées au passage suivant du moteur (5 minutes, ordinateur allumé).
    Sinon « Supprimer ». Le faire sans attendre : le moteur ne garde sa copie d'un message à vérifier que 45 jours
    (au-delà, il relit l'e-mail dans ta boîte de réception, s'il y est encore). Un message qui reste « En attente du
    moteur » : voir « En dépannage ».
  - **Nouveau** : un message du client non lu porte le badge « Nouveau », et le dossier s'affiche « Nouveau
    message » (ou « 2 nouveaux messages »…) dans la liste. Un message est marqué lu dès que la fiche l'affiche,
    onglet visible et fenêtre active ; son badge reste jusqu'à ce que tu quittes la fiche.
  - Si l'étape, la signature, le paiement, la rétractation ou l'envoi du devis changent pendant une saisie en cours
    (note pour le client, montant, libellé ou PDF du devis), la fiche ne se redessine pas : un bandeau dit « Le
    dossier a changé : rouvrez la fiche pour le voir à jour. ».
- **E-mail à renvoyer** : si la confirmation du contrat (« Devis signé ») ou l'accusé de réception d'une
  rétractation n'a pas pu partir (quota d'e-mails atteint, panne de Resend), le dossier s'affiche « E-mail à
  renvoyer » et un bandeau en tête de la fiche propose « Renvoyer ». Ces deux e-mails sont des obligations
  légales : les renvoyer sans attendre. Le client, lui, a vu sur la page qu'il le recevrait plus tard. L'accusé d'une
  rétractation est aussi à renvoyer quand il n'est parti que vers l'une de ses deux adresses (celle du dossier, et
  l'autre adresse donnée sur le formulaire du site) : « Renvoyer » l'envoie de nouveau aux deux. Tant que l'accusé
  d'une rétractation reste à renvoyer, un nouveau devis est refusé ; une confirmation restée à renvoyer disparaît
  d'elle-même si le client se rétracte ou si un nouveau devis est envoyé.
- **Devis** : choisir le PDF (15 Mo au plus, conditions générales comprises : voir « À savoir »), le montant à payer à
  la signature (acompte ou total) et son libellé, puis « Envoyer le devis au client ». Le dossier passe à « Validation
  de votre devis » ; le client reçoit le devis en pièce jointe, un bouton « Lire et signer mon devis »,
  valable 30 jours, et la phrase « Nos conditions générales figurent à la fin du devis. ». Si l'e-mail n'a pas pu
  partir, la fiche le dit et donne le lien de signature, à lui transmettre. Il signe sur une page du site, sans se
  connecter : nom, date, adresse IP, navigateur et empreinte du PDF sont enregistrés ; juste au-dessus du bouton, la
  page indique « En signant, vous acceptez nos conditions générales, jointes au devis. ». Un particulier ne peut
  signer qu'après avoir coché la case qui demande le démarrage de la mission avant la fin du délai de rétractation (la
  fiche indique la date de cette demande, sous « Démarrage anticipé »). Le dossier passe alors à « Paiement » et le
  client reçoit la confirmation du contrat : devis signé, coordonnées et référence du virement et, pour un
  particulier, la confirmation de sa demande de démarrage, qui cite la case cochée.
  Chaque envoi crée un nouveau fichier `devis-<numéro>-<AAMMJJHHMMSS>.pdf` : un devis signé n'est jamais remplacé.
  Les versions précédentes restent visibles par le client dans « Documents de l'agence » ; seule la dernière est à
  signer (le lien d'une version précédente ne fonctionne plus). Un nouvel envoi annule la signature en cours, et
  une rétractation enregistrée : c'est un nouveau contrat. Une fois le virement reçu, le devis ne peut plus être
  remplacé.
- **Virement** : le client paie par virement, avec le numéro de dossier pour référence (« Référence du virement »
  dans la fiche). En attendant, le dossier est en « Virement attendu » : c'est au client d'agir. Quand le virement
  apparaît sur ton compte, vérifier le montant et la référence, puis « Virement reçu » : le dossier passe en
  production et le client reçoit « Paiement reçu ».
- **Documents** : déposer les documents produits, puis « Documents prêts : demander la validation » (bouton
  indisponible tant qu'aucun document, hors devis, n'est déposé). Le client
  reçoit la liste des documents et un bouton « Voir et valider mes documents », valable 90 jours. Il valide sur le
  site (dossier clos, ou dépôt avec l'option de suivi), ou demande une modification en répondant à l'e-mail ou
  depuis la discussion de son espace : sa demande s'affiche dans la discussion, et le dossier s'affiche « Message du
  client » dans la liste jusqu'à ta réponse dans la discussion. Lire sa demande, repasser le dossier en production
  avec « Passer ici » si besoin, puis redemander la validation une fois les documents corrigés : c'est une nouvelle
  demande, une validation précédente ne compte plus (pareil après une demande du service instructeur, avec l'option
  de suivi).
- **Rétractation** (client particulier) : pendant 14 jours après la signature, prolongés jusqu'au premier jour
  ouvrable si le dernier tombe un samedi, un dimanche ou un jour férié, le client peut renoncer au contrat sur le
  formulaire de rétractation du site, https://atomes.studio/renoncer/, sans se connecter (lien « Renoncer au contrat
  ici » en bas de l'espace client et de la page de signature ; aucun e-mail ne le contient). Il y saisit ses nom et
  prénom, le numéro du dossier et l'adresse e-mail de sa demande, qui désignent le contrat, et peut donner une autre
  adresse pour l'accusé de réception. Si le numéro et l'adresse ne désignent pas le devis signé d'un particulier, la
  page oppose un seul et même refus, qui renvoie à contact@ : rien n'est enregistré ni envoyé. Sinon, il reçoit un
  accusé de réception (aussi à l'autre adresse), toi « Rétractation — dossier … » (« par le formulaire du site »), et
  le dossier s'affiche « Rétractation reçue » parmi les dossiers à traiter, même s'il était déjà clos (rétractation
  reçue après la clôture) ; l'étape ne change pas. Arrêter la mission ; si un virement a été reçu, rembourser le
  client dans les 14 jours, déduction faite du travail déjà réalisé. Le dossier peut ensuite être classé (« Passer
  ici » sur « Dossier clos » ; déjà clos : « Passer ici » sur l'étape précédente, puis sur « Dossier clos ») : plus
  aucun e-mail de mission ne part à un client qui a renoncé. Une rétractation reçue par lettre, par e-mail ou dans la
  discussion vaut autant : voir « À savoir » et « En dépannage ».
- **Suivi administratif** : cocher la case pour faire apparaître les étapes 8 à 10 chez le client, puis faire
  avancer le dossier avec « Passer ici ». Un e-mail part au client quand le dossier avance vers les documents à
  valider, le dossier déposé, la démarche validée ou le dossier clos. Sur un dossier clos qui n'est pas passé
  par le dépôt, cocher la case le rouvre à l'étape « Dépôt » (confirmation demandée). Décocher la case masque
  les étapes 8 à 10 chez le client sans effacer leurs dates.
- **Note pour le client** : précision affichée sous l'étape en cours, à la place de sa description.
- « Passer ici » permet aussi de revenir en arrière en cas d'erreur (les étapes suivantes repassent à venir).

## Au quotidien : en dépannage, depuis le tableau de bord Supabase

- **Faire avancer un dossier** (de préférence depuis l'espace agence, qui prévient le client) : Table Editor →
  `projets` → colonne `etape` : `traitement`, `devis`, `signature`, `paiement`, `production`, `validation`,
  `depot`, `instruction`, `accordee` ou `clos` (les trois avant-dernières demandent `suivi_administratif` = true).
  Les étapes précédentes passent automatiquement à « fait » avec la date ; aucun e-mail ne part dans ce cas.
  `signature` et `paiement` seulement après l'envoi du devis depuis l'espace agence : c'est cet envoi qui donne au
  client son lien de signature.
- **Transmettre un document au client** (plans, pièces…) : Storage → `dossiers` → `<numéro>` → `agence` →
  Upload file. Le devis passe obligatoirement par l'espace agence (« Envoyer le devis au client ») : c'est le
  seul moyen de le rendre signable, car la fonction `espace` enregistre alors son chemin, son empreinte et le
  montant, et envoie le lien de signature. Il apparaît aussitôt dans l'espace du client sous « Documents de
  l'agence ». Les dossiers `<numéro>/client` et `<numéro>/agence` sont créés par la fonction à la réception ;
  s'ils manquent (dossier créé à la main), Create folder en respectant exactement ces noms en minuscules.
- **Voir les pièces envoyées par le client** (avec sa demande, en réponse aux e-mails ou depuis la discussion de son
  espace) : même endroit, sous-dossier `client`, ou dans l'espace client avec ton compte agence. Les pièces jointes
  de tes messages sont dans `agence/discussion`, à part des documents à valider.
- **Un e-mail d'un client, reçu sur contact@ ou simon@, n'apparaît pas dans le dossier** : `.\moteur etat` (dans
  le dossier `atomes-moteur`) montre le dernier passage et ses erreurs ; `.\moteur courrier --depuis AAAA-MM-JJ`
  (essai, avec la date de l'e-mail : sans `--depuis`, l'essai ne reprend pas les e-mails déjà relevés) dit ce que
  le moteur décide pour les e-mails reçus depuis ce jour et pourquoi (par exemple « expéditeur inconnu » : le client
  a écrit d'une autre adresse sans numéro de dossier dans l'objet ; transférer alors son e-mail n'aide pas, déposer
  ses pièces depuis l'espace agence). Autres causes : ordinateur éteint (le moteur rattrape au démarrage), e-mail
  déplacé hors de la boîte de réception par une règle de ta messagerie avant le passage du moteur. Au-delà de
  30 e-mails du client rangés par le moteur (ou 20 « à vérifier ») pour un même dossier en 24 heures, le moteur
  n'enregistre plus rien (journal : « limite de messages sur 24 h atteinte ») : l'e-mail reste dans ta boîte. Depuis
  sa version 0.2.0, tes messages et ceux que le client écrit dans son espace n'entrent pas dans ce compte. Un
  message qui reste « En attente du moteur » : ordinateur éteint, ou erreur (voir `.\moteur etat` et le journal) ;
  après 10 essais ratés, le moteur le laisse de côté et ses pièces sont à ranger à la main. Journal :
  `%LOCALAPPDATA%\AtomesMoteur\journal\moteur.log`.
- **Un e-mail légal n'est pas parti** (fiche « E-mail à renvoyer ») : « Renvoyer » dans le bandeau de la fiche. Si
  l'envoi échoue encore (quota de Resend atteint pour la journée), réessayer le lendemain, ou écrire au client depuis
  ta messagerie : confirmation du contrat = devis signé en pièce jointe, date de signature, coordonnées et référence
  du virement, et pour un particulier la confirmation de sa demande de démarrage, qui cite la case cochée (textes de
  l'e-mail « Devis signé ») ; accusé de rétractation = nom, numéro de dossier, adresse e-mail de la demande et, s'il y
  en a une, autre adresse pour l'accusé, date de signature du devis, date et heure de réception de la rétractation
  (fiche, « Devis, signature et paiement »). La mention reste dans la fiche jusqu'à un renvoi réussi par « Renvoyer ».
- **L'e-mail d'un message au client n'est pas parti** (badge « E-mail non parti » sous le message, dossier « E-mail
  non parti » dans la liste) : « Renvoyer l'e-mail » sous le message. S'il échoue encore (quota de Resend atteint pour
  la journée), réessayer le lendemain : le message est déjà dans la discussion, seul l'e-mail manque. Un envoi resté
  « Envoi en cours » plus de 10 minutes (fonction interrompue) se renvoie de la même façon.
- **Un client demande un nouveau lien** (« Ce lien a expiré ») : pour signer, renvoyer le devis depuis l'espace
  agence (même PDF, même montant) ; pour valider, « Passer ici » sur « Production de vos documents », puis
  « Documents prêts : demander la validation ». Un nouvel e-mail part avec un nouveau lien. Pour renoncer au contrat,
  il n'y a pas de lien à renvoyer : le formulaire du site (https://atomes.studio/renoncer/) reste ouvert pendant tout
  le délai ; les anciens liens de rétractation, envoyés par les e-mails d'avant cette mise à jour, expirent avec lui.
- **Rétractation reçue par lettre, par e-mail ou dans la discussion** : elle vaut autant que le formulaire du site, si
  elle est claire. En accuser réception au client depuis l'espace agence, tout de suite (un message de la discussion,
  qui part par e-mail ; pas la case « Déjà envoyé depuis ma messagerie »), en reprenant la date et l'heure de son
  envoi ; arrêter la mission ; puis l'enregistrer : Table Editor → `projets` → le dossier → `retracte_le` (date et
  heure de réception) et `retracte_nom`. La fiche et l'espace client l'affichent alors. Le texte de cet accusé est à
  faire valider par l'Ordre (« À savoir »).
- **Modifier les étapes ou leurs textes** : Table Editor → `modele_etapes` (pour les nouveaux dossiers) et
  `etapes` (pour un dossier existant, colonne `note` pour une précision visible par le client). Les étapes des
  dossiers créés avant le parcours v2 sont archivées dans `etapes_v1`.
- **Rattraper un dossier sans compte** (l'e-mail de notification te l'indique en rouge) :
  Authentication → Users → Add user (e-mail du client, Auto Confirm User), puis SQL Editor, en remplaçant
  l'e-mail et le numéro :
  ```sql
  update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"origine":"demande"}'::jsonb
  where email = '<e-mail du client>';
  update public.projets set client_id = (select id from auth.users where email = '<e-mail du client>')
  where id = '<numéro de dossier>';
  ```
  La première ligne marque le compte comme compte client : ses prochaines demandes lui seront rattachées
  automatiquement (par sécurité, la fonction ne rattache que les comptes qu'elle a créés ou marqués ainsi).
- **Créer un dossier à la main** (demande reçue par téléphone) : Table Editor → `projets` → Insert row
  avec `id` (12 chiffres, date et heure), `profil`, `prenom`, `nom`, `email`, `type`, `commune`, `documents` ;
  la timeline se crée seule. Puis rattacher le compte comme ci-dessus.
- **Archiver** : `projets.archive` = true (le dossier reste visible par le client, à masquer plus tard dans
  l'espace admin).

## À savoir

- **À faire valider par l'Ordre des architectes avant d'envoyer un devis à un particulier** :
  - les textes juridiques du parcours, repris mot pour mot dans la fonction `espace`, qui les place dans les
    e-mails et sur la page de signature : la case de démarrage anticipé (texte corrigé le 22 octobre 2026, le même
    qu'à l'article 11.4 des conditions générales), et le choix de la rendre obligatoire pour signer ; le bouton
    « Signer et commander avec obligation de paiement » ; la phrase « En signant, vous acceptez nos conditions
    générales, jointes au devis. », au-dessus du bouton ; la phrase de l'e-mail « Devis signé » qui cite la case
    cochée ; le formulaire de rétractation du site (https://atomes.studio/renoncer/ : nom et prénom, numéro de
    dossier, adresse e-mail de la demande, autre adresse pour l'accusé, bouton « Confirmer la rétractation », phrase
    sur le travail déjà réalisé, refus, accusé de réception), qui répond à l'obligation d'une fonction de
    rétractation en ligne pour les contrats conclus en ligne (depuis juin 2026) ;
  - trois choix de ce formulaire (décisions du 21 octobre 2026) : le lien « Renoncer au contrat ici » en bas de
    l'espace client, de la page de signature et du formulaire seulement (ni dans les e-mails, ni sur les pages du
    site vitrine) ; l'adresse e-mail du dossier exigée pour reconnaître le contrat (une autre adresse reçoit le
    refus, qui renvoie à contact@) ; la retenue du travail déjà réalisé, rappelée sous le bouton (« Si vous avez
    demandé que la mission commence avant la fin du délai, un montant proportionné au travail déjà réalisé reste
    dû. », comme la case corrigée le 22 octobre et l'article 11.5 des conditions générales) ;
  - le médiateur de la consommation : obligatoire avec un particulier ; à désigner (l'Ordre en propose un à ses
    inscrits : à confirmer auprès de lui), puis à indiquer sur le devis, les conditions générales (CGV) et le site ;
  - le devis et les conditions générales : à compléter (attestation d'assurance, missions, rémunération, et les
    « [À COMPLÉTER] » des conditions générales rédigées le 21 octobre 2026) et à accorder avec le parcours (délai de
    rétractation, démarrage anticipé, virement avec la référence du dossier). L'information sur la rétractation et
    le formulaire type ne sont plus donnés qu'en annexes des conditions générales, à la fin de chaque devis (voir
    plus bas) ;
  - le devis signé chez le client, en ta présence : c'est un contrat « hors établissement », avec d'autres règles
    (notamment aucun paiement pendant 7 jours) : à vérifier avant de faire signer lors d'un rendez-vous chez lui ;
  - le texte de l'accusé de réception d'une rétractation reçue par lettre, par e-mail ou dans la discussion (point
    suivant).
- Une rétractation peut aussi arriver dans la discussion ou par e-mail : elle vaut si elle est claire. Accuses-en
  réception tout de suite depuis l'espace agence (un message de la discussion part par e-mail), en reprenant la date
  et l'heure de son envoi. Arrête la mission, puis enregistre-la (« En dépannage »).
- **Chaque devis doit contenir les conditions générales**, avec l'information sur la rétractation et le formulaire
  type (annexes 1 et 2) : c'est là seulement que le client particulier les reçoit (l'e-mail « Votre devis est prêt »
  dit seulement « Nos conditions générales figurent à la fin du devis. », et la page de signature ne les montre plus).
  Sans elles, le délai de rétractation est prolongé de 12 mois (article L221-20 du code de la consommation). Le devis
  est toujours joint aux e-mails « Votre devis est prêt » et « Devis signé » (support durable) : 15 Mo au plus.
  L'espace agence et la fonction refusent un PDF plus lourd (« Devis trop lourd (15 Mo au plus)… ») : l'alléger,
  puis l'envoyer de nouveau.
- Une réponse écrite depuis ta messagerie part au client mais n'entre pas dans la discussion : recopie-la dans
  l'espace agence avec la case « Déjà envoyé depuis ma messagerie » (aucun e-mail ne repart).
- Offre gratuite Supabase : un projet inactif pendant 7 jours est mis en pause (l'espace client ne répond
  plus jusqu'à réactivation manuelle). Prévoir l'offre Pro (25 $/mois) quand le site reçoit des demandes,
  ou accepter ce risque au début.
- Offre gratuite Resend : 3 000 e-mails par mois et 100 par jour (des envois seulement : depuis le 20 octobre 2026,
  Resend ne reçoit plus rien). Au-delà, offre Pro (20 $/mois). Une fois le quota du jour atteint, plus rien ne part
  ce jour-là, pas même les codes de connexion à l'espace client. Chacun de tes messages au client consomme un e-mail
  du quota, comme chaque avis « Message du client » (au plus un par dossier et par quart d'heure : c'est la raison de
  ce regroupement). Surveiller l'usage dans Resend (**Usage**), et regarder la fiche des dossiers « E-mail à
  renvoyer » et « E-mail non parti ».
- Protections anti-abus de la fonction : champ piège, validation de tous les champs, 10 fichiers et 10 Mo
  maximum, images et PDF uniquement, 3 demandes par adresse e-mail et par jour, 30 demandes par heure au
  total (au-delà, FormSubmit prend le relais). Si des demandes automatisées arrivent malgré tout, l'étape
  suivante est Cloudflare Turnstile (vérification invisible). Pour les e-mails reçus, le moteur de l'agence ne
  range que ceux qui concernent un dossier (son numéro dans l'objet, ou l'adresse d'un client) ; un message d'un
  autre expéditeur, ou sans signature DKIM valable, attend ta vérification. Par dossier et par 24 heures :
  30 e-mails du client et 20 à vérifier au plus ; 200 Mo de pièces jointes du client par dossier en tout
  (au-delà, elles ne sont plus rangées : elles restent dans l'e-mail, dans ta boîte). Messages écrits par le client
  dans son espace : 5 000 caractères, 10 fichiers et 10 Mo par message (images et PDF), 30 messages par dossier et
  par 24 heures, et les mêmes 200 Mo par dossier (au-delà, la page lui demande de t'écrire à contact@) ; un seul envoi
  à la fois par dossier (un second envoi simultané, depuis un autre onglet par exemple, reçoit « Un envoi est déjà en
  cours : réessayez dans quelques secondes. »), pour que ces limites tiennent. Elles évitent qu'un afflux de messages
  remplisse la base et le stockage. Le formulaire de rétractation du site n'a pas de limite (choix
  du 21 octobre 2026) : un refus n'enregistre et n'envoie rien, et une rétractation n'est enregistrée qu'une fois.
  Revers relevé le 22 octobre 2026, risque accepté le 23 octobre 2026 : le numéro de dossier (date et heure de la
  demande) se devine, et quelqu'un qui connaît l'adresse e-mail d'un client peut essayer tous les numéros d'une
  journée, jusqu'à rétracter son contrat. Le client reçoit alors un accusé de réception qu'il n'a pas demandé : s'il
  te le signale, préviens Claude pour annuler la rétractation enregistrée.
- Ne jamais activer le CAPTCHA de Supabase (Authentication → Attack Protection) sans la modification du site qui va
  avec : la demande de code serait refusée et plus personne ne pourrait se connecter, toi compris.
- Un e-mail « Votre code de connexion » reçu à contact@ sans l'avoir demandé veut dire que quelqu'un a tapé cette
  adresse sur la page de connexion : ne transmets ce code à personne ; si cela se répète, regarde Authentication → Logs
  dans Supabase.
- Moteur de l'agence : il lit tes boîtes contact@ et simon@ sur ton ordinateur et n'en copie dans Supabase que les
  e-mails des clients (texte et pièces jointes). Les e-mails « à vérifier » gardent une copie locale (dossier
  `%LOCALAPPDATA%\AtomesMoteur\en-attente`) jusqu'à leur traitement, 45 jours au plus. À mentionner aussi dans les
  mentions légales (traitement des e-mails reçus).
- Données : Supabase les héberge en Europe (région choisie à l'étape 1). Resend envoie depuis l'Irlande
  (eu-west-1), mais garde ses journaux et les métadonnées des e-mails aux États-Unis, et conserve les e-mails
  envoyés 30 jours (les e-mails des clients n'y passent plus depuis le 20 octobre 2026 : ils arrivent dans ta
  messagerie, chez LWS. En revanche, les messages écrits par un client dans son espace y passent en entier, dans
  l'avis envoyé à contact@, ainsi que tes messages au client, pièces jointes comprises). Pour le RGPD : mentionner
  dans les mentions légales l'espace client, la discussion (messages, photos et PDF envoyés depuis l'espace client,
  conservés avec le dossier), les e-mails envoyés (Resend), le formulaire de rétractation du site (nom, numéro de
  dossier, adresses saisies), la durée de conservation et, pour la signature du devis et la rétractation, la
  conservation de l'adresse IP et du navigateur (preuve) ; supprimer les dossiers à la demande (Table Editor, la
  suppression du projet supprime sa timeline, ses étapes clés, sa discussion, ses questions, ses demandes de
  modification et son archive ; les fichiers sont à supprimer dans Storage, sous-dossiers `client` et `agence` avec
  `agence/discussion`, et le compte dans Authentication → Users).
- Les sauvegardes quotidiennes de la base sont incluses dans l'offre Pro. En gratuit, exporter de temps en
  temps : Table Editor → `projets` → Export (CSV), idem pour `etapes`, `evenements`, `messages`, `questions` et
  `modifications` ; les fichiers se téléchargent depuis Storage.
- Paiement : uniquement par virement, sans frais ni intermédiaire. La référence demandée au client est le numéro
  de dossier (12 chiffres, par exemple 261014093512) : elle relie chaque virement à son dossier, en comptabilité
  comme dans l'espace agence. Rien n'est automatique : c'est « Virement reçu » qui fait avancer le dossier.
  Mettre aussi ton RIB sur le devis.
- Signature : signature électronique simple, sur une page du site ouverte par le lien reçu par e-mail (pas de
  Yousign, pas d'abonnement). La date, le nom saisi, l'adresse IP (celle que transmet la plateforme, suivie de la
  chaîne X-Forwarded-For complète quand elle contient d'autres valeurs), le navigateur, le montant et l'empreinte
  SHA-256 du PDF signé sont conservés dans le dossier et envoyés par e-mail à l'agence ; pour un particulier,
  aussi la case cochée (texte exact et date). Le client reçoit par e-mail la confirmation du contrat : le devis, la
  date, son nom et l'empreinte, et pour un particulier la confirmation de sa demande de démarrage, qui cite la case
  cochée. La signature porte sur la version et le montant affichés au client : si un nouveau devis est envoyé
  entre-temps, elle est refusée, et le client doit utiliser le lien du dernier e-mail.
- Avis clients : en suspens (pas encore de fiche Google). L'étape « Dossier clos » n'a pas encore de bouton.
