# Mise en place de l'espace client

Ce qu'il faut pour que « Envoyer la demande » crée automatiquement un dossier, stocke les pièces jointes,
ouvre un espace client et envoie les e-mails. Compter une heure, en suivant les étapes dans l'ordre.

## Architecture retenue

| Besoin | Outil | Pourquoi |
|---|---|---|
| Base de données (dossiers, timeline) | Supabase (Postgres) | Hébergé en Europe, règles de sécurité par ligne, gratuit pour démarrer |
| Comptes clients | Supabase Auth, connexion par lien e-mail | Pas de mot de passe à gérer, un client = une adresse e-mail |
| Fichiers (pièces du client, documents de l'agence) | Supabase Storage, bucket privé `dossiers` | Un dossier par projet, liens de téléchargement temporaires, 1 Go gratuit puis 100 Go (offre Pro) |
| Réception du formulaire | Supabase Edge Function `demande` | Code serveur sans serveur à maintenir |
| E-mails (accusé de réception, notification) | Resend | 3 000 e-mails/mois gratuits, envoi depuis contact@atomes.studio |
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
   l'ordre (`0001_…`, `0002_…`, puis `0003_…`), → Run à chaque fois. Le résultat doit être « Success ».
3. **Authentication → Sign In / Providers → Email** : laisser le provider Email activé (c'est lui qui
   envoie les liens de connexion). Laisser « Confirm email » tel quel : les comptes sont créés déjà
   confirmés par la fonction.
4. **Authentication → Sign In / Providers → User Signups** (ou « Settings ») : **désactiver « Allow new
   users to sign up »**. Important : sinon n'importe qui pourrait créer un compte avec l'adresse e-mail
   d'un futur client et récupérer son dossier. Les comptes sont créés uniquement par la fonction
   `demande` (ou par toi, voir § 5), et les clients existants continuent de recevoir leurs liens.
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
3. **API Keys → Create** : noter la clé (`re_…`).
4. Dans Supabase, **Authentication → Emails → onglet SMTP Settings** : activer Custom SMTP avec
   host `smtp.resend.com`, port `465`, user `resend`, password = la clé API, sender `contact@atomes.studio`,
   sender name `Atomes studio`. Indispensable : sans SMTP personnalisé, Supabase n'envoie les liens de
   connexion qu'aux membres de ton équipe Supabase, et deux par heure. Les clients ne recevraient rien.
5. Maintenant que le SMTP est configuré, **Authentication → Emails → Templates → Magic link or OTP** :
   objet `Votre lien de connexion — Atomes studio` ; corps : onglet **Source**, tout effacer, coller le
   contenu de `emails/supabase-magic-link.html` (même mise en page et même signature que les e-mails de la
   fonction `demande`), puis « Save changes ». Le logo de la signature est
   `https://atomes.studio/images/logo-signature.gif` : il s'affiche dès que le site est publié avec le dossier
   `images/` à jour.

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
   `https://atomes.studio,https://www.atomes.studio,http://localhost:3000`).
5. Rien à faire ici, pour information : l'adresse à laquelle le site appelle la fonction est
   `https://zvgkvovqmxmpdijubmaz.supabase.co/functions/v1/demande`. Elle est déjà inscrite dans
   `site/assets/js/config.js` (étape 4).

Autre méthode, à ignorer si tu as déployé par le tableau de bord : en ligne de commande, `npx supabase login`,
`npx supabase link --project-ref zvgkvovqmxmpdijubmaz`, `npx supabase functions deploy demande --no-verify-jwt`,
`npx supabase secrets set RESEND_API_KEY=re_… SB_SECRET_KEY=sb_secret_…`.

## 4. Brancher le site

**Déjà fait le 13 octobre 2026** : `site/assets/js/config.js` contient la Project URL, la clé publique
(`sb_publishable_…`) et l'adresse de la fonction. À refaire seulement si tu changes de projet Supabase ou
régénères la clé publique :

```js
window.ATOMES_CONFIG = {
  supabaseUrl: 'https://<ref>.supabase.co',
  supabaseAnonKey: '<clé publique, étape 1.7>',
  apiUrl: 'https://<ref>.supabase.co/functions/v1/demande'
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
   cliquer sur le lien reçu.

## 6. Tester

1. `npx serve site`, ouvrir http://localhost:3000/devis.html (ce port exactement, sinon ajouter l'adresse
   affichée à `ORIGINES_AUTORISEES`), envoyer une demande avec une adresse e-mail à toi (différente de
   contact@atomes.studio) et une pièce jointe.
2. Vérifier : l'écran « Demande envoyée » affiche un numéro de dossier ; deux e-mails arrivent (accusé de
   réception au client, notification à l'agence) ; dans Supabase, **Table Editor → projets** contient la
   ligne et **Storage → dossiers → <numéro> → client** contient le fichier.
3. Se connecter sur /dossier/ avec l'adresse du test : timeline et documents apparaissent.

## Mises à jour à appliquer

- **13 octobre 2026, formulaires v3 et v4** — trois gestes, dans la même séance, dans cet ordre :
  1. SQL Editor → coller `supabase/migrations/0002_precisions_autre.sql` → Run, puis
     `0003_emprise_existante.sql` → Run (colonnes `precisions` et `emprise_existante`). Sans effet sur ce qui est
     en ligne : peut se faire à l'avance.
  2. Publier le site (VS Code → Sync Changes) et attendre le vert dans l'onglet Actions de GitHub, puis une
     dizaine de minutes : les navigateurs peuvent garder l'ancienne page en cache jusqu'à 10 minutes. Le
     formulaire de devis est désormais sur devis.html ; contact.html devient une page de message simple.
  3. Aussitôt après, redéployer la fonction `demande` avec le `index.ts` à jour.

  Ne pas redéployer la fonction avant la migration : chaque enregistrement échouerait et toutes les demandes
  partiraient par FormSubmit, sans dossier. Ni avant la publication du site : l'ancien formulaire, encore en
  ligne, n'a pas de secours en cas de « Champs invalides » ; une grande partie de ses demandes (« Maison
  existante », « Appartement existant », type ou document « Autre »…) serait refusée avec un message d'erreur,
  sans dossier ni FormSubmit.

  Entre les étapes 2 et 3, la fonction en ligne (celle de la première mise en ligne) accepte les demandes du
  nouveau formulaire mais perd l'état du bien (sauf « Terrain nu » et « Local ou bâtiment pro »), l'emprise au sol
  du bâti existant, le démarrage « Autre » et les précisions des choix « Autre » (le mail n'indique que
  « Autre ») ; les besoins « Réalisation de plans » et « Avis d'architecte / étude simple » sont ignorés, et une
  demande qui ne coche qu'eux part par FormSubmit, sans dossier. Dans le mail, « Emprise du projet » correspond
  alors à l'emprise après projet. Relire les demandes reçues pendant cet intervalle.

- **Parcours client v2 : 11 étapes, actions du client, espace agence, paiement Stripe**, dans cet ordre :
  1. SQL Editor → coller `supabase/migrations/0004_parcours_client.sql` → Run. Les dossiers existants passent
     au nouveau modèle d'étapes (dates conservées). Sans risque pour le site en ligne : l'ancienne page de
     l'espace client affiche les nouvelles étapes.
  2. Déployer la fonction `espace` (voir « 7. Fonction espace et Stripe » ci-dessous), Verify JWT désactivé.
  3. Publier le site (Sync Changes) : l'espace client affiche les actions, l'espace agence est sur
     https://atomes.studio/admin/.
  4. Stripe : d'abord en mode test (carte 4242 4242 4242 4242), puis passage en mode réel (§ 7).

## 7. Fonction espace et Stripe (parcours client v2)

La fonction `espace` reçoit les actions du client (répondre aux questions, signer le devis, payer, valider
les documents ou demander une modification) et celles de l'agence (questions, envoi du devis, étapes, option
de suivi), envoie les e-mails correspondants et reçoit la confirmation de paiement de Stripe.

1. **Edge Functions → Deploy a new function → Via editor**, nom `espace`, coller le contenu de
   `supabase/functions/espace/index.ts`, Deploy. Puis, dans ses détails, **désactiver « Verify JWT »** : la
   fonction vérifie elle-même la session du client ou de l'agence, et Stripe n'envoie pas de session.
2. Les secrets `RESEND_API_KEY` et `SB_SECRET_KEY` sont déjà là (communs aux fonctions).
3. **Stripe, compte** : créer le compte sur stripe.com (entreprise, SIRET, IBAN pour les virements de Stripe
   vers ton compte). Rester d'abord en **mode test** (interrupteur « Test mode » en haut du tableau de bord).
4. **Clé** : Developers → API keys → « Secret key » (`sk_test_…` en mode test) → dans Supabase, Edge
   Functions → Secrets : `STRIPE_SECRET_KEY` = cette clé.
5. **Webhook** : Developers → Webhooks → Add endpoint :
   - Endpoint URL : `https://zvgkvovqmxmpdijubmaz.supabase.co/functions/v1/espace`
   - Événements : `checkout.session.completed` (et `checkout.session.async_payment_succeeded`)
   - Créer, puis « Signing secret » → Reveal (`whsec_…`) → secret Supabase `STRIPE_WEBHOOK_SECRET`.
6. **Tester** : sur un dossier de test, envoyer un devis depuis l'espace agence, le signer dans l'espace
   client, payer avec la carte de test 4242 4242 4242 4242 (date future, n'importe quel code). Le dossier
   passe seul à « Production de vos documents » et les deux e-mails « Paiement reçu » partent.
7. **Passage en réel** : désactiver le mode test, refaire les étapes 4 et 5 en mode réel (clé `sk_live_…`,
   nouveau webhook avec son propre `whsec_…`) et remplacer les deux secrets dans Supabase. Facultatif :
   Settings → Customer emails → « Successful payments » pour que Stripe envoie aussi son reçu au client.

Tant que `STRIPE_SECRET_KEY` est vide, le bouton « Payer par carte » affiche « Le paiement en ligne n'est pas
encore activé » ; l'espace agence permet alors de marquer un dossier comme payé (paiement reçu hors du site).

## Au quotidien : l'espace agence (https://atomes.studio/admin/)

Connexion avec ton compte agence (§ 5), par lien e-mail. La liste montre les dossiers en cours ; le filtre
« À traiter » ne garde que ceux où c'est à toi d'agir. Dans la fiche d'un dossier :

- **Questions au client** : une ou plusieurs questions, à réponse libre ou à choisir (une proposition par
  ligne, au moins deux). Le client reçoit un e-mail et répond dans son espace ; tu reçois ses réponses par
  e-mail et dans la fiche.
- **Devis** : choisir le PDF, le montant à payer à la signature (acompte ou total) et son libellé, puis
  « Envoyer le devis au client ». Le dossier passe à « Validation de votre devis » ; le client lit le devis,
  le signe (« bon pour accord », nom, date, adresse IP et empreinte du PDF sont enregistrés) puis paie par
  carte. Le dossier passe alors seul en production.
- **Documents** : déposer les documents produits, puis « Documents prêts : demander la validation ». Le client
  valide (dossier clos, ou dépôt avec l'option de suivi) ou demande une modification (retour en production,
  message reçu par e-mail).
- **Suivi administratif** : cocher la case pour faire apparaître les étapes 8 à 10 chez le client, puis faire
  avancer le dossier avec « Passer ici ». Un e-mail part au client quand le dossier avance vers les documents à
  valider, le dossier déposé, la démarche validée ou le dossier clos.
- **Note pour le client** : précision affichée sous l'étape en cours, à la place de sa description.
- « Passer ici » permet aussi de revenir en arrière en cas d'erreur (les étapes suivantes repassent à venir).

## Au quotidien : en dépannage, depuis le tableau de bord Supabase

- **Faire avancer un dossier** (de préférence depuis l'espace agence, qui prévient le client) : Table Editor →
  `projets` → colonne `etape` : `traitement`, `devis`, `signature`, `paiement`, `production`, `validation`,
  `depot`, `instruction`, `accordee` ou `clos` (les trois avant-dernières demandent `suivi_administratif` = true).
  Les étapes précédentes passent automatiquement à « fait » avec la date ; aucun e-mail ne part dans ce cas.
- **Transmettre un document au client** (devis, plans…) : Storage → `dossiers` → `<numéro>` → `agence` →
  Upload file. Il apparaît aussitôt dans l'espace du client sous « Documents de l'agence ». Les dossiers
  `<numéro>/client` et `<numéro>/agence` sont créés par la fonction à la réception ; s'ils manquent
  (dossier créé à la main), Create folder en respectant exactement ces noms en minuscules.
- **Voir les pièces déposées par le client** : même endroit, sous-dossier `client`, ou dans l'espace client
  avec ton compte agence.
- **Modifier les étapes ou leurs textes** : Table Editor → `modele_etapes` (pour les nouveaux dossiers) et
  `etapes` (pour un dossier existant, colonne `note` pour une précision visible par le client).
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

- Offre gratuite Supabase : un projet inactif pendant 7 jours est mis en pause (l'espace client ne répond
  plus jusqu'à réactivation manuelle). Prévoir l'offre Pro (25 $/mois) quand le site reçoit des demandes,
  ou accepter ce risque au début.
- Protections anti-abus de la fonction : champ piège, validation de tous les champs, 10 fichiers et 10 Mo
  maximum, images et PDF uniquement, 3 demandes par adresse e-mail et par jour, 30 demandes par heure au
  total (au-delà, FormSubmit prend le relais). Si des demandes automatisées arrivent malgré tout, l'étape
  suivante est Cloudflare Turnstile (vérification invisible).
- Données hébergées en Europe : Supabase (région choisie à l'étape 1) et Resend (région eu-west-1). Pour le
  RGPD : mentionner l'espace client et la durée de conservation dans les mentions légales, et supprimer les
  dossiers à la demande (Table Editor, la suppression du projet supprime sa timeline ; les fichiers sont à
  supprimer dans Storage, et le compte dans Authentication → Users).
- Les sauvegardes quotidiennes de la base sont incluses dans l'offre Pro. En gratuit, exporter de temps en
  temps : Table Editor → `projets` → Export (CSV), idem pour `etapes` ; les fichiers se téléchargent depuis
  Storage.
- Paiement : Stripe prélève des frais sur chaque paiement par carte (environ 1,5 % plus 0,25 € pour une carte
  européenne) et verse le reste sur ton compte bancaire. La signature en ligne est une signature électronique
  simple : date, nom saisi, adresse IP, navigateur et empreinte SHA-256 du PDF signé sont conservés dans le
  dossier et envoyés par e-mail au client et à l'agence.
- Avis clients : en suspens (pas encore de fiche Google). L'étape « Dossier clos » n'a pas encore de bouton.
