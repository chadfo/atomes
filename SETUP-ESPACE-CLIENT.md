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
| Suivi du dossier (e-mails au client, signature, réponses) | Supabase Edge Function `espace` | Même principe ; reçoit aussi les réponses des clients |
| E-mails (envoi, et réception des réponses aux anciennes adresses de dossier) | Resend | 3 000 e-mails/mois gratuits (envoyés et reçus), envoi depuis contact@atomes.studio, réponses reçues sur r.atomes.studio jusqu'à leur retrait (§ 8) |
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
   l'ordre (`0001_…`, `0002_…`, `0003_…`, `0004_…`, puis `0005_…`), → Run à chaque fois. Le résultat doit être
   « Success ».
   Projet créé depuis le 30 mai 2026 (et tout projet à partir du 30 octobre 2026) : Supabase n'ouvre plus d'office
   à l'API les tables que créent ces fichiers. Vérifier ensuite, dans le SQL Editor :
   ```sql
   select has_table_privilege('authenticated', 'public.projets', 'select') as client,
          has_table_privilege('service_role', 'public.projets', 'insert') as fonction;
   ```
   Les deux valeurs (`client`, `fonction`) doivent être `true`. Sinon, lancer (0005 le fait déjà pour `messages`,
   `questions` et `modifications`) :
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
3. **API Keys → Create** : permission **Full access** (la fonction `espace` lit les réponses reçues ; une clé
   « Sending access » ne sait qu'envoyer). Noter la clé (`re_…`).
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
   « Email OTP Length » = **8** et « Email OTP Expiration » = **3600** (une heure, comme le dit l'e-mail).

La réception des réponses des clients (sous-domaine `r.atomes.studio`) se règle plus loin, au § 7.

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
   fonctions du projet : `JETON_SECRET` et `REPONSES_DOMAINE` (§ 7) servent aussi à celle-ci.
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
3. Se connecter sur /dossier/ avec l'adresse du test : timeline et documents apparaissent.
4. Le parcours complet (réponses par e-mail, signature, virement) se teste au § 7, point 7.

## Mises à jour à appliquer

### Connexion par code (19 octobre 2026)

Pour entrer dans l'espace client (https://atomes.studio/dossier/) comme dans l'espace agence (/admin/), on tape son
adresse, puis le code reçu par e-mail (8 chiffres, valable une heure, une seule fois) : plus aucun lien de connexion.
Les e-mails automatiques (fonctions `espace` et `demande`) gardent le simple lien « Suivre mon dossier en ligne », qui
mène à cette page : un e-mail transféré (banque, notaire, entreprise) ne donne accès à rien. Cette mise à jour remplace
le lien direct, publié le 19 octobre au soir puis abandonné : ne pas appliquer ses réglages ; si tu l'as fait, ils sont
défaits ici. Dans la même séance, dans cet ordre :

1. **Supabase → Authentication → Sign In / Providers → Email** : « Email OTP Expiration » = **3600**, enregistrer ;
   puis « Email OTP Length » = **8**, enregistrer. Cet ordre, pour qu'un code court ne soit jamais valable 24 heures,
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
   patienter une minute. Quand l'e-mail arrive, taper d'abord un faux code de 8 chiffres : il est refusé. Puis taper
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

Garder pour l'instant `REPONSES_DOMAINE`, le webhook de Resend et le compte Resend de réception : un client qui
répond à un e-mail envoyé avant cette mise à jour écrit encore à l'adresse de son dossier, en `@r.atomes.studio`, et
sa réponse continue de s'ajouter au dossier. Les retirer dans un mois (§ 8, point 7).

### Parcours v3 (mis en ligne le 15 octobre 2026)

État au 14 octobre 2026 : le parcours v2 est en ligne (migrations 0001 à 0004, fonctions `espace` et `demande`,
site du 13 octobre). Le parcours v3 (tout par e-mail, signature par lien, virement, espace client en consultation)
s'applique **d'une traite, dans la même séance et dans cet ordre**.

**Avant la séance, par exemple la veille** : § 7, point 3 (sous-domaine de réception chez Resend, enregistrements
chez LWS). Leur vérification peut prendre quelques heures ; ce point ne change rien au site ni à ta messagerie.

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

1. **SQL Editor** : coller `supabase/migrations/0005_parcours_email.sql` → Run. Elle est rejouable : sans risque si
   elle a déjà été faite. Dès ce moment, l'ancienne page de l'espace client, encore en ligne, ne peut plus déposer
   de fichiers.
2. **Secrets** : `JETON_SECRET` et les trois `VIREMENT_…` (§ 7, point 2). Pas encore `REPONSES_DOMAINE`.
3. **Redéployer la fonction `espace`** (§ 7, point 1). « Verify JWT » reste désactivé.
4. **Publier le site** (VS Code → Sync Changes) et attendre le vert dans l'onglet Actions de GitHub, puis une
   dizaine de minutes : les navigateurs peuvent garder l'ancienne page en cache jusqu'à 10 minutes. Cette
   publication met en ligne l'espace client en consultation, la page d'action (`/action/`, ouverte par les liens
   des e-mails) et le nouvel espace agence.
5. **Redéployer la fonction `demande`** avec le `index.ts` à jour (timeline et adresse de réponse dans l'accusé de
   réception).
6. **Webhook de réception** chez Resend (§ 7, point 4), puis secret `RESEND_WEBHOOK_SECRET`.
7. **Adresses de réponse** : secret `REPONSES_DOMAINE` (§ 7, point 5), seulement quand Resend affiche la réception
   vérifiée.
8. **Retirer Stripe** (§ 7, point 6).
9. **Tester de bout en bout** (§ 7, point 7).

Entre les étapes 3 et 4 (cache compris), l'ancienne page de l'espace client affiche encore ses boutons (répondre,
signer, payer, valider) : ils renvoient une erreur. Ne rien faire dans l'espace agence pendant ce temps.

Jusqu'à l'étape 7, les e-mails partent avec contact@atomes.studio comme adresse de réponse : les réponses des
clients arrivent dans ta messagerie, comme avant, sans s'ajouter au dossier.

**Dossiers en cours au moment de la bascule** (liste « En cours » de l'espace agence ; sans doute aucun à ce
jour) :
- devis envoyé, signé ou non, mais pas encore payé : le renvoyer (« Envoyer le devis au client », même PDF, même
  montant). Le client reçoit le lien de signature puis, une fois signé, la confirmation avec les coordonnées du
  virement et, pour un particulier, l'information sur la rétractation, qu'il n'avait pas reçue jusqu'ici. Un
  particulier qui a signé dans l'ancien espace n'a pas coché la case de démarrage anticipé : si tu ne lui renvoies pas
  le devis, ne commence pas la mission avant la fin de son délai de rétractation (la confirmation de « Virement reçu »
  le rappelle) ;
- documents à valider : « Passer ici » sur « Production de vos documents », puis « Documents prêts : demander la
  validation » : le client reçoit le lien de validation ;
- questions sans réponse : après l'étape 7, les retirer et les poser de nouveau, pour que le client puisse
  répondre à l'e-mail.

## 7. Réponses par e-mail et virement

La fonction `espace` mène le dossier après la demande. Chaque étape importante est annoncée au client par e-mail,
avec la timeline de son dossier. Le client répond simplement aux e-mails : sa réponse et ses pièces jointes
s'ajoutent au dossier. Il signe le devis et valide ses documents sur une page du site ouverte par un lien reçu par
e-mail, sans se connecter, et paie par virement avec le numéro de dossier pour référence. L'espace client ne sert
plus qu'à consulter. La fonction reçoit aussi les actions de l'espace agence.

1. **Déployer la fonction `espace`**. Première fois : **Edge Functions → Deploy a new function → Via editor**, nom
   `espace`, coller le contenu de `supabase/functions/espace/index.ts`, Deploy. Mise à jour : **Edge Functions →
   espace → Code**, tout remplacer par le contenu du fichier, **Deploy updates**. Puis, dans ses détails, vérifier
   que **« Verify JWT » est désactivé** : la fonction vérifie elle-même la session de l'agence ou du client, le
   lien reçu par e-mail ou la signature de Resend.
2. **Secrets**, dans **Edge Functions → Secrets** (`RESEND_API_KEY` et `SB_SECRET_KEY` y sont déjà). Ils sont pris
   en compte aussitôt, sans redéployer.
   - `JETON_SECRET` : 40 caractères aléatoires. Pour les obtenir : dans VS Code, **Terminal → New Terminal**,
     coller `node -e "console.log(require('crypto').randomBytes(30).toString('base64url'))"`, Entrée, puis copier
     la ligne affichée. Il signe les liens envoyés aux clients et les adresses de réponse des dossiers.
     **Ne le changer qu'en cas de fuite** : les liens déjà envoyés cesseraient de fonctionner, et les réponses aux
     e-mails déjà envoyés ne s'ajouteraient plus aux dossiers. En garder une copie dans un gestionnaire de mots de
     passe, jamais dans le site ni dans une conversation. Sans lui, aucun lien ne peut être envoyé (« Liens
     indisponibles »).
   - `VIREMENT_IBAN` (tel que sur ton RIB), `VIREMENT_BIC` et `VIREMENT_TITULAIRE` (titulaire du compte, tel que
     sur le RIB). Ils s'affichent dans l'e-mail « Devis signé » et dans l'espace client, avec la référence du
     virement (le numéro de dossier). Sans eux, l'e-mail indique :
     « Les coordonnées bancaires figurent sur votre devis. »
     La fonction vérifie l'IBAN (clé de contrôle) et la présence du titulaire : un IBAN mal recopié, ou sans
     titulaire, n'est jamais envoyé (même phrase de repli) et l'erreur apparaît dans **Edge Functions → espace →
     Logs** (« VIREMENT_IBAN absent ou invalide »). Après le test du point 7, relire les coordonnées de l'e-mail
     « Devis signé » reçu.
   - `REPONSES_DOMAINE` : pas maintenant, au point 5.
   - Vérifier dans Resend, **API Keys**, que la clé mise dans `RESEND_API_KEY` a la permission **Full access** :
     une clé « Sending access » envoie, mais ne peut pas lire les réponses reçues. Sinon, créer une clé
     « Full access », la mettre dans `RESEND_API_KEY`, et garder l'ancienne, qui sert au SMTP de Supabase (§ 2.4).
   - `RESEND_RECEPTION_KEY` : seulement si la réception est dans un compte Resend à part (point 3, recommandé) : la
     clé API **Full access** de ce compte-là, qui sert à lire les réponses reçues.
   - Les liens des e-mails (signature, validation, rétractation) mènent toujours à `SITE_URL` (https://atomes.studio),
     même si l'espace agence est ouvert depuis localhost. Une fois les essais en local finis, tu peux retirer
     localhost des origines autorisées : `ORIGINES_AUTORISEES` = `https://atomes.studio,https://www.atomes.studio`
     (facultatif ; à remettre pour essayer de nouveau le formulaire en local, § 6).
3. **Resend, sous-domaine de réception**. Les réponses des clients arrivent sur un sous-domaine réservé,
   `r.atomes.studio` : ta messagerie contact@atomes.studio (LWS) n'est pas touchée.
   Recommandé : créer ce sous-domaine dans un second compte Resend (ou une seconde équipe), réservé à la réception
   et gratuit lui aussi, plutôt que dans le compte des envois. Chez Resend, chaque e-mail reçu compte dans le quota
   du compte (100 par jour en gratuit, envois compris), et n'importe qui peut écrire à n'importe quelle adresse en
   `@r.atomes.studio` : des e-mails reçus en nombre bloqueraient sinon tous les envois de la journée (devis,
   confirmations, codes de connexion à l'espace client). Avec un second compte, les points 3.1 à 3.4 et le webhook
   du point 4 se font dans ce compte-là, et sa clé API (**Full access**) va dans le secret `RESEND_RECEPTION_KEY`
   (point 2). Autre solution : l'offre Pro de Resend pour un seul compte.
   1. **Domains → Add Domain** : `r.atomes.studio`, région **eu-west-1 (Irlande)**, comme au § 2.
   2. Créer chez LWS (zone DNS de `atomes.studio`) les enregistrements affichés par Resend, en recopiant exactement
      type, nom, valeur et priorité. Mêmes règles qu'au § 2 : nom saisi sans `.atomes.studio`, ici terminé par `.r`
      (par exemple `resend._domainkey.r`) ; valeur terminée par un point quand c'est un nom de domaine ; TTL
      15 minutes.
   3. Sur la page du domaine `r.atomes.studio`, activer la réception (**Enable Receiving**), si elle ne l'est pas
      déjà. Resend affiche un enregistrement **MX** de plus, pour `r.atomes.studio` lui-même. Le créer chez LWS :
      type MX, nom `r`, valeur affichée par Resend suivie d'un point, priorité affichée (10). Puis, si Resend le
      propose, cliquer **I've added the record**.
   4. Attendre que le domaine et la réception passent à **Verified** (quelques minutes à quelques heures). Si rien
      ne bouge, relire chaque enregistrement chez LWS.
4. **Resend, webhook de réception**, une fois la nouvelle fonction `espace` déployée (point 1) :
   **Webhooks → Add Webhook** ; URL `https://zvgkvovqmxmpdijubmaz.supabase.co/functions/v1/espace` ; événement
   **`email.received`** seulement ; **Add**. Ouvrir le webhook créé, copier son **Signing Secret** (`whsec_…`) →
   secret Supabase `RESEND_WEBHOOK_SECRET`. L'offre gratuite de Resend n'autorise qu'un webhook : c'est celui-ci.
5. **Activer les adresses de réponse**, quand le point 3 est vérifié et le point 4 fait : secret
   `REPONSES_DOMAINE` = `r.atomes.studio`. Dès lors, chaque e-mail au client a pour adresse de réponse celle de son
   dossier (`d<numéro>-<code>@r.atomes.studio`) : le client clique sur « Répondre », et sa réponse s'ajoute au
   dossier. Pas avant : tant que la réception n'est pas vérifiée, les réponses des clients leur reviendraient en
   erreur. Sans ce secret, les réponses vont à contact@atomes.studio, comme avant.
6. **Retirer Stripe**, si tu l'avais configuré : dans **Edge Functions → Secrets**, supprimer `STRIPE_SECRET_KEY`
   et `STRIPE_WEBHOOK_SECRET` ; sur stripe.com, **Développeurs → Webhooks (Workbench)** → la destination vers
   `…/functions/v1/espace` → la supprimer. Le compte Stripe ne sert plus.
7. **Tester de bout en bout**, depuis https://atomes.studio (depuis localhost, les liens des e-mails mèneraient à
   localhost), avec une adresse e-mail à toi, différente de contact@atomes.studio :
   1. Envoyer une demande sur https://atomes.studio/devis.html, profil **Particulier**. L'accusé de réception
      montre la timeline ; « Répondre » propose une adresse en `@r.atomes.studio`.
   2. Répondre à cet e-mail avec une photo jointe. En quelques instants, « Réponse du client — dossier … » arrive à
      contact@atomes.studio, et la fiche du dossier (espace agence) montre le message et la photo.
   3. Espace agence : poser une question, puis y répondre depuis l'e-mail reçu. La réponse s'affiche sous la
      question.
   4. Envoyer un devis (un PDF quelconque, 1 €). L'e-mail « Votre devis est prêt » contient le PDF, le bouton
      « Lire et signer mon devis », l'information sur la rétractation et le formulaire type. Sur la page qui s'ouvre
      (information et formulaire type au-dessus de la case), cliquer « Signer et commander avec obligation de
      paiement » sans cocher la case : un message demande de la cocher. Cocher, saisir le nom, signer. L'e-mail
      « Devis signé » contient la preuve de signature, le devis, les coordonnées et la référence du virement,
      l'information sur la rétractation et le lien « Renoncer au contrat ici ». Dans la fiche du dossier, l'adresse
      IP de la signature doit être la tienne (la comparer avec celle qu'affiche une recherche « mon adresse IP ») ;
      sinon, le signaler : la règle qui la choisit est à ajuster.
   5. Espace agence : le dossier est en « Virement attendu ». Cliquer « Virement reçu » : e-mail « Paiement
      reçu », et le dossier passe en production.
   6. Déposer un document, puis « Documents prêts : demander la validation ». Répondre à l'e-mail « Vos documents
      sont prêts » : la fiche affiche « Modification demandée ». Puis, dans le même e-mail, cliquer « Voir et
      valider mes documents », et « Je valide mes documents ».
   7. Dans l'e-mail « Devis signé », cliquer « Renoncer au contrat ici », remplir, « Confirmer la rétractation ».
      L'accusé de réception arrive à l'adresse du test, « Rétractation — dossier … » à contact@atomes.studio, et la
      fiche affiche la rétractation : le dossier, clos au point 6, s'affiche « Rétractation reçue » (reçue après la
      clôture) dans les dossiers « À traiter ».
   8. Depuis contact@atomes.studio, écrire à l'adresse de réponse du dossier (celle que propose « Répondre » au
      point 1) : « Message à vérifier — dossier … » arrive, et la fiche montre le message avec le badge
      « À vérifier ». Le supprimer.
   9. Se connecter sur https://atomes.studio/dossier/ avec l'adresse du test, depuis le téléphone ou un autre
      navigateur (dans le même navigateur, la connexion du client remplacerait celle de l'agence) : timeline,
      documents et échanges s'affichent, sans aucun bouton d'action.

   Si une réponse n'arrive pas dans le dossier : voir « En dépannage ». Le dossier de test se supprime ensuite
   comme indiqué dans « À savoir » (RGPD).

## 8. Moteur de l'agence : e-mails des clients reçus sur contact@ et simon@

Le moteur est un programme qui tourne sur ton ordinateur (dossier `atomes-moteur`, à côté de ce dépôt, jamais
publié ; mode d'emploi complet dans son `README.md`). Toutes les 5 minutes, tant que ta session Windows est ouverte,
il lit les nouveaux e-mails de contact@atomes.studio et de simon@atomes.studio, sans rien y changer (rien n'est
marqué lu, déplacé ni supprimé), et range dans leur dossier ceux des clients, comme la fonction `espace` le fait
pour les réponses reçues par Resend : texte sans la citation, pièces jointes (images et PDF, 25 Mo au plus) dans
`<numéro>/client/`, réponse aux questions en attente, demande de modification à l'étape « Validation de vos
documents ». Il n'envoie aucun e-mail : l'original est déjà dans ta boîte.

Règles :
- le numéro de dossier dans l'objet (« Re: Quelques questions sur votre dossier 261014093512 ») désigne le dossier ;
  sans numéro, l'e-mail va au dernier dossier (le plus récent) de l'adresse de l'expéditeur ;
- un expéditeur inconnu sans numéro de dossier est ignoré, rien n'est enregistré (prospects, fournisseurs,
  publicités) ; les e-mails de l'agence (atomes.studio), les réponses automatiques et les indésirables aussi ;
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
   contient le numéro) avec une photo jointe ; dans les 5 minutes, la fiche montre le message et la photo. Puis
   écrire depuis une autre adresse, avec le numéro dans l'objet : badge « À vérifier » ; « Rattacher au dossier »,
   puis 5 minutes : la photo est rangée.
7. **Dans un mois**, quand plus personne ne répond aux anciennes adresses en `@r.atomes.studio` : supprimer les
   secrets `REPONSES_DOMAINE`, `RESEND_WEBHOOK_SECRET` et `RESEND_RECEPTION_KEY`, le webhook chez Resend, le
   domaine `r.atomes.studio` dans le compte Resend de réception (puis ce compte), et chez LWS les enregistrements du
   sous-domaine `r` (MX et ceux de Resend).

## Au quotidien : l'espace agence (https://atomes.studio/admin/)

Connexion avec ton compte agence (§ 5), par code reçu par e-mail. Si la page ne propose plus de saisir le code reçu
(rouverte ailleurs : autre onglet, autre appareil), entrer l'adresse puis « J'ai déjà un code » : en redemander un
annulerait le premier (même bouton pour les clients, sur /dossier/). La liste montre les dossiers en cours ; le filtre
« À traiter » ne garde que ceux où c'est à toi d'agir. Le client n'agit plus dans son espace : chaque étape
importante lui est annoncée par e-mail, avec la timeline de son dossier, et il répond à l'e-mail. Dans la fiche
d'un dossier :

- **Questions au client** : une ou plusieurs questions, à réponse libre ou à choisir (une proposition par
  ligne, au moins deux). Le client reçoit un e-mail qui les liste (les propositions y servent d'exemples de
  réponse) et **répond simplement à l'e-mail**, avec des pièces jointes s'il le souhaite. Sa réponse est
  enregistrée pour les questions en attente ; tu la reçois par e-mail et dans la fiche. Une question restée sans
  réponse peut être retirée (« Retirer la question »). Dans la liste, un dossier dont une question attend le
  client reste « À traiter » quand c'est à toi d'agir ; le nombre de questions sans réponse s'affiche à côté de
  l'étape.
- **Messages du client** : chaque e-mail reçu du client s'affiche dans la fiche (date, expéditeur, objet, texte,
  pièces jointes) et t'est transmis (« Réponse du client — dossier … »). Ses pièces jointes, images et PDF de
  25 Mo au plus, rejoignent ses documents ; lui demander les autres formats en PDF. Les images intégrées au texte
  (logo de sa signature, images de notre e-mail cité, logo d'Atomes studio) ne sont pas rangées : l'e-mail
  « Réponse du client » les cite à part. Un message n'est rattaché seul que s'il vient de l'adresse du dossier
  (adresse simple, la même dans l'expéditeur affiché et dans l'en-tête du message) et que Resend l'authentifie
  (DMARC, ou signature DKIM du domaine de cette adresse) ; c'est le cas des messageries courantes (Google,
  Microsoft, Orange, Free…). Sinon il attend, avec le badge « À vérifier » (ses pièces jointes y sont listées, « non
  rangée »), et tu reçois « Message à vérifier — dossier … » (un seul par heure et par dossier ; aucun pour un
  e-mail que SPF, DKIM et DMARC rejettent tous, visible quand même dans la fiche) : si c'est bien le client (par
  exemple depuis une autre adresse, ou depuis un domaine sans DKIM), « Rattacher au dossier » (ses pièces jointes
  sont rangées, sa réponse enregistrée, et le message devient visible dans son espace ; il n'est pas prévenu) ;
  sinon « Supprimer ». Le faire sans attendre : Resend ne garde les e-mails reçus que 30 jours. Un message au
  badge « Traitement incomplet » (pièces jointes ou réponse interrompues, par exemple par une panne, et que Resend
  n'a pas pu reprendre) : « Reprendre le traitement ».
- **Messages lus par le moteur** (e-mails reçus sur contact@ et simon@, § 8) : mêmes règles, sans e-mail
  « Réponse du client » ni « Message à vérifier » (l'original est dans ta boîte). Un message « À vérifier » indique
  l'adresse différente ou le résultat de la signature DKIM (« Signature DKIM : absente », « échec »…). « Rattacher
  au dossier » le marque « En attente du moteur » : ses pièces sont rangées et sa réponse enregistrée au passage
  suivant du moteur (5 minutes, ordinateur allumé).
- **E-mail à renvoyer** : si la confirmation du contrat (« Devis signé ») ou l'accusé de réception d'une
  rétractation n'a pas pu partir (quota d'e-mails atteint, panne de Resend), le dossier s'affiche « E-mail à
  renvoyer » et un bandeau en tête de la fiche propose « Renvoyer ». Ces deux e-mails sont des obligations
  légales : les renvoyer sans attendre. Le client, lui, a vu sur la page qu'il le recevrait plus tard. Tant que
  l'accusé d'une rétractation reste à renvoyer, un nouveau devis est refusé ; une confirmation restée à renvoyer
  disparaît d'elle-même si le client se rétracte ou si un nouveau devis est envoyé.
- **Devis** : choisir le PDF, le montant à payer à la signature (acompte ou total) et son libellé, puis
  « Envoyer le devis au client ». Le dossier passe à « Validation de votre devis » ; le client reçoit le devis en
  pièce jointe et un bouton « Lire et signer mon devis », valable 30 jours (un particulier, aussi l'information sur
  la rétractation et le formulaire type). Si l'e-mail n'a pas pu partir, la fiche le dit et donne le lien de
  signature, à lui transmettre. Il signe sur une page du site, sans se
  connecter : nom, date, adresse IP, navigateur et empreinte du PDF sont enregistrés. Un particulier ne peut signer
  qu'après avoir coché la case qui demande le démarrage de la mission avant la fin du délai de rétractation (la
  fiche indique la date de cette demande, sous « Démarrage anticipé »). Le dossier passe alors à « Paiement » et le
  client reçoit la confirmation du contrat : devis signé, coordonnées et référence du virement et, pour un
  particulier, l'information sur la rétractation, le formulaire type et le lien « Renoncer au contrat ici ».
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
  site (dossier clos, ou dépôt avec l'option de suivi), ou répond à l'e-mail pour demander une modification : à
  cette étape, toute réponse est enregistrée comme demande de modification, et la fiche affiche « Modification
  demandée ». Lire sa demande, repasser le dossier en production avec « Passer ici » si besoin, puis redemander la
  validation une fois les documents corrigés : c'est une nouvelle demande, une validation précédente ne compte
  plus (pareil après une demande du service instructeur, avec l'option de suivi).
- **Rétractation** (client particulier) : pendant 14 jours après la signature, prolongés jusqu'au premier jour
  ouvrable si le dernier tombe un samedi, un dimanche ou un jour férié, le client peut renoncer au contrat avec le
  lien « Renoncer au contrat ici » (e-mail de confirmation, page de signature, espace client). Il reçoit un accusé
  de réception, toi « Rétractation — dossier … », et le dossier s'affiche « Rétractation reçue » parmi les dossiers
  à traiter, même s'il était déjà clos (rétractation reçue après la clôture) ; l'étape ne change pas. Arrêter la
  mission ; si un virement a été reçu, rembourser le client dans les 14 jours, déduction faite du travail déjà
  réalisé. Le dossier peut ensuite être classé (« Passer ici » sur « Dossier clos » ; déjà clos : « Passer ici » sur
  l'étape précédente, puis sur « Dossier clos ») : plus aucun e-mail de mission ne part à un client qui a renoncé.
  Une rétractation reçue par lettre ou par simple e-mail vaut autant : voir « En dépannage ».
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
- **Voir les pièces envoyées par le client** (avec sa demande ou en réponse aux e-mails) : même endroit,
  sous-dossier `client`, ou dans l'espace client avec ton compte agence.
- **Une réponse du client n'apparaît pas dans le dossier** : dans Resend, **Emails → Receiving** liste les e-mails
  reçus sur `r.atomes.studio`. S'il n'y est pas, le client a écrit ailleurs (par exemple à contact@atomes.studio :
  il est alors dans ta messagerie), ou l'enregistrement MX de `r` est à vérifier chez LWS. S'il y est :
  **Webhooks** → le webhook → le message, pour voir son état. Après correction (par exemple `RESEND_WEBHOOK_SECRET`
  mal recopié), **Replay** le renvoie. Resend réessaie seul pendant environ un jour, et prévient par e-mail s'il
  désactive le webhook après des échecs répétés. Un message avec beaucoup de pièces jointes peut être traité en
  plusieurs fois : les tentatives refusées en « 503 » pendant ce temps sont normales. Au-delà de 30 messages du
  client (ou 20 messages à vérifier) pour un même dossier en 24 heures, la fonction n'enregistre plus rien : l'e-mail
  reste lisible dans Resend (Logs : « limite de messages du dossier atteinte »).
- **Un e-mail d'un client, reçu sur contact@ ou simon@, n'apparaît pas dans le dossier** : `.\moteur etat` (dans
  le dossier `atomes-moteur`) montre le dernier passage et ses erreurs ; `.\moteur courrier` (essai) dit ce que le
  moteur décide pour les e-mails récents et pourquoi (par exemple « expéditeur inconnu » : le client a écrit d'une
  autre adresse sans numéro de dossier dans l'objet ; transférer alors son e-mail n'aide pas, déposer ses pièces
  depuis l'espace agence). Autres causes : ordinateur éteint (le moteur rattrape au démarrage), e-mail déplacé
  hors de la boîte de réception par une règle de ta messagerie avant le passage du moteur. Journal :
  `%LOCALAPPDATA%\AtomesMoteur\journal\moteur.log`.
- **Un e-mail légal n'est pas parti** (fiche « E-mail à renvoyer ») : « Renvoyer » dans le bandeau de la fiche. Si
  l'envoi échoue encore (quota de Resend atteint pour la journée), réessayer le lendemain, ou écrire au client
  depuis ta messagerie : confirmation du contrat = devis signé en pièce jointe, date de signature, coordonnées et
  référence du virement, et pour un particulier l'information sur la rétractation et le formulaire type (textes de
  l'e-mail « Devis signé ») ; accusé de rétractation = nom, numéro de dossier, date de signature du devis, date et
  heure de réception de la rétractation (fiche, « Devis, signature et paiement »). La mention reste dans la fiche
  jusqu'à un renvoi réussi par « Renvoyer ».
- **Un client demande un nouveau lien** (« Ce lien a expiré ») : pour signer, renvoyer le devis depuis l'espace
  agence (même PDF, même montant) ; pour valider, « Passer ici » sur « Production de vos documents », puis
  « Documents prêts : demander la validation ». Un nouvel e-mail part avec un nouveau lien. Le lien de
  rétractation, lui, expire avec le délai.
- **Rétractation reçue par lettre ou par simple e-mail** : elle vaut autant que le lien. En accuser réception au
  client par e-mail, puis l'enregistrer : Table Editor → `projets` → le dossier → `retracte_le` (date et heure de
  réception) et `retracte_nom`. La fiche et l'espace client l'affichent alors.
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
    e-mails et sur la page de signature : la case de démarrage anticipé, et le choix de la rendre obligatoire pour
    signer ; le bouton « Signer et commander avec obligation de paiement » ; l'information sur la rétractation ;
    le formulaire type de rétractation ; la page « Renoncer au contrat » (nom, e-mail, bouton « Confirmer la
    rétractation », accusé de réception), qui répond à l'obligation d'une fonction de rétractation en ligne pour
    les contrats conclus en ligne (depuis juin 2026) ;
  - le médiateur de la consommation : obligatoire avec un particulier ; à désigner (l'Ordre en propose un à ses
    inscrits : à confirmer auprès de lui), puis à indiquer sur le devis, les conditions générales (CGV) et le site ;
  - le devis et les CGV : à compléter (attestation d'assurance, missions, rémunération) et à accorder avec le
    parcours (délai de rétractation, démarrage anticipé, virement avec la référence du dossier). L'information sur
    la rétractation doit être donnée avant la signature avec le formulaire type : l'e-mail « Votre devis est prêt »
    et la page de signature d'un particulier les montrent ; les mettre aussi dans le devis ou les CGV ;
  - le devis signé chez le client, en ta présence : c'est un contrat « hors établissement », avec d'autres règles
    (notamment aucun paiement pendant 7 jours) : à vérifier avant de faire signer lors d'un rendez-vous chez lui.
- Offre gratuite Supabase : un projet inactif pendant 7 jours est mis en pause (l'espace client ne répond
  plus jusqu'à réactivation manuelle). Prévoir l'offre Pro (25 $/mois) quand le site reçoit des demandes,
  ou accepter ce risque au début.
- Offre gratuite Resend : 3 000 e-mails par mois et 100 par jour, envoyés et reçus confondus, et un seul webhook.
  Au-delà, offre Pro (20 $/mois). Une fois le quota du jour atteint, plus rien ne part ce jour-là, pas même les
  codes de connexion à l'espace client : d'où le compte de réception séparé (§ 7, point 3). Surveiller l'usage dans
  Resend (**Usage**), et regarder la fiche des dossiers « E-mail à renvoyer ».
- Protections anti-abus de la fonction : champ piège, validation de tous les champs, 10 fichiers et 10 Mo
  maximum, images et PDF uniquement, 3 demandes par adresse e-mail et par jour, 30 demandes par heure au
  total (au-delà, FormSubmit prend le relais). Si des demandes automatisées arrivent malgré tout, l'étape
  suivante est Cloudflare Turnstile (vérification invisible). Pour les e-mails reçus, la fonction `espace`
  n'accepte que les envois signés par Resend, adressés à une adresse de dossier valide ; un message d'un autre
  expéditeur, ou mal authentifié, attend ta vérification. Par dossier et par 24 heures : 30 messages du client et
  20 messages à vérifier au plus ; un seul e-mail « Message à vérifier » par heure ; 200 Mo de pièces jointes du
  client par dossier en tout (au-delà, « non rangée »). Ces limites évitent qu'un afflux d'e-mails remplisse la
  base et le stockage, mais chaque e-mail reçu compte quand même dans le quota de Resend.
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
  (eu-west-1), mais garde ses journaux et les métadonnées des e-mails aux États-Unis, et conserve les e-mails,
  réponses des clients comprises, 30 jours. Pour le RGPD : mentionner dans les mentions légales l'espace client,
  les e-mails échangés (Resend), la durée de conservation et, pour la signature du devis et la rétractation, la
  conservation de l'adresse IP et du navigateur (preuve) ; supprimer les dossiers à la demande (Table Editor, la
  suppression du projet supprime sa timeline, ses questions, ses messages, ses demandes de modification et son
  archive ; les fichiers sont à supprimer dans Storage, et le compte dans Authentication → Users).
- Les sauvegardes quotidiennes de la base sont incluses dans l'offre Pro. En gratuit, exporter de temps en
  temps : Table Editor → `projets` → Export (CSV), idem pour `etapes`, `questions`, `messages` et
  `modifications` ; les fichiers se téléchargent depuis Storage.
- Paiement : uniquement par virement, sans frais ni intermédiaire. La référence demandée au client est le numéro
  de dossier (12 chiffres, par exemple 261014093512) : elle relie chaque virement à son dossier, en comptabilité
  comme dans l'espace agence. Rien n'est automatique : c'est « Virement reçu » qui fait avancer le dossier.
  Mettre aussi ton RIB sur le devis.
- Signature : signature électronique simple, sur une page du site ouverte par le lien reçu par e-mail (pas de
  Yousign, pas d'abonnement). La date, le nom saisi, l'adresse IP (celle que transmet la plateforme, suivie de la
  chaîne X-Forwarded-For complète quand elle contient d'autres valeurs), le navigateur, le montant et l'empreinte
  SHA-256 du PDF signé sont conservés dans le dossier et envoyés par e-mail à l'agence ; pour un particulier,
  aussi la case cochée (texte exact et date). Le client reçoit par e-mail la confirmation du contrat : le devis,
  la date, son nom et l'empreinte. La signature porte sur la version et le montant affichés au client : si un
  nouveau devis est envoyé entre-temps, elle est refusée, et le client doit utiliser le lien du dernier e-mail.
- Avis clients : en suspens (pas encore de fiche Google). L'étape « Dossier clos » n'a pas encore de bouton.
