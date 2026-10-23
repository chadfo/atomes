# atomes.studio

Site vitrine de l'agence d'architecture Atomes studio (Simon Charles, architecte HMONP, Toulon / Hyères).
HTML statique + CSS + JavaScript vanilla, sans dépendance ni étape de build, publié sur GitHub Pages
(domaine atomes.studio).

## Dossiers

```
site/                      ← racine publiée (tout ce dossier va à la racine du dépôt GitHub Pages)
  index.html               Accueil
  projets.html             Projets (accordéon, galerie par projet)
  a-propos.html            À propos
  contact.html             Contact : question « devis ? », puis message simple (FormSubmit, sans dossier)
  devis.html               Demande de devis en huit écrans (dossier + espace client)
  dossier/                 Espace client : timeline, discussion avec l'agence, documents, récapitulatif
  admin/                   Espace agence
  action/                  Page d'action, ouverte par les liens des e-mails (signer, valider, renoncer)
  renoncer/                Formulaire public de rétractation (lien « Renoncer au contrat ici »)
  assets/css/site.css      Feuille de style commune : jetons de la charte + composants + pages
  assets/js/atom-logo.js   Logo animé <atom-logo> (à conserver tel quel)
  assets/js/projets.js     Accordéon et galeries de la page Projets
  assets/js/contact.js     Page Contact (question devis, validation, envoi FormSubmit)
  assets/js/devis.js       Formulaire de devis (écrans, validation, envoi vers la fonction demande)
  assets/js/config.js      Adresses Supabase et des fonctions (valeurs publiques, jamais de secret)
  assets/js/dossier.js     Espace client
  assets/js/admin.js       Espace agence
  assets/js/action.js      Page d'action
  assets/js/renoncer.js    Formulaire public de rétractation
  images/                  Toutes les photos (.webp)
  favicon.png · a5ce3393-….png (image OG) · robots.txt · sitemap.xml · .nojekyll
supabase/migrations/       Schéma, règles de sécurité, timeline, discussion (0001 à 0006, dans l'ordre)
supabase/functions/        Fonctions demande (formulaire de devis) et espace (suivi du dossier, discussion, e-mails)
emails/                    Signature des e-mails et modèle de l'e-mail de connexion
_archive/claude-design/    Version d'origine produite avec Claude Design (référence, non publiée)
CLAUDE.md                  Instructions projet pour Claude Code
SETUP-ESPACE-CLIENT.md     Mise en place et usage de l'espace client et de l'espace agence
```

## Travailler en local

```
npx serve site
```

puis ouvrir l'adresse affichée (généralement http://localhost:3000). Les pages fonctionnent aussi en
`file://` sauf le menu des polices Google (réseau) ; pour tester l'envoi du formulaire, passer par un serveur.

Il n'y a rien à installer ni à compiler : on édite les fichiers de `site/` et on recharge.

## Conventions

- **Pas de style inline.** Tout passe par `assets/css/site.css`, organisé en : jetons (`:root`), base,
  composants partagés (étiquettes `.lbl`, boutons `.btn` / `.btn--ghost` / `.link-more`, nav, pied de page,
  section image/dégradé/texte `.m-sec` / `.m-img` / `.m-grad` / `.m-txt`), puis une partie par page.
- **Jetons** : `--bg`, `--ink`, `--ink-rgb` (pour `rgba(var(--ink-rgb),.55)`), `--white`, `--surface`,
  `--surface-hover`, `--err`, `--line`, `--font`, `--mono`, `--pad-x`.
- **Pas de `box-sizing:border-box` global** (la mise en page d'origine n'en avait pas) : il est posé
  explicitement là où il faut (champs, texte empilé sous 980 px, encadré de confirmation).
- **Responsive** : menu hamburger sous 640 px (case à cocher `#nav-toggle`) ; sections image/texte empilées
  sous 980 px (image au-dessus, dégradé vertical). Ratios mobiles : 3/2 par défaut, 3/4 pour le portrait
  (`.m-sec--portrait`), 297/210 pour les projets.
- **Images** : `images/<nom>.webp`, 1 200 px de large. Projets : `proj-0N.webp` (principale) puis
  `proj-0N-a.webp`, `-b`… pour la galerie, listées dans un `<template>` à la fin de chaque section de
  `projets.html`. Chaque image a un `alt` descriptif. Le hero de l'accueil est `images/hero.webp`
  (conversion WebP de l'image OG). L'ancien visuel `home-hero.webp` (villa à piscine), qui n'était plus
  utilisé, est rangé dans `_archive/claude-design/`.
- **Le logo** `<atom-logo>` vient de `assets/js/atom-logo.js`, chargé en `defer`.

## Pages

| Page | Contenu | Images |
|---|---|---|
| index.html | Hero plein écran, 4 blocs « philosophie » (image à gauche, 300 px min), CTA | hero, philo-01…04 |
| projets.html | 7 projets en accordéon (un seul ouvert : 35vw, 78vh sous 640 px ; fermé : 400 px), flèches + compteur | proj-0N (+ -a…-d) |
| a-propos.html | Portrait + texte, formation, signature | portrait, signature |
| contact.html | Question « devis ? » puis message simple | philo-02 |
| devis.html | Formulaire de devis en huit écrans | contact-photo |

Toutes les pages partagent : nav sticky (logo animé + 5 liens : Accueil, Projets, À propos, Contact, Devis ;
lien actif `aria-current="page"` en blanc),
pied de page 2 colonnes en IBM Plex Mono (à droite : adresse postale, mail, Instagram, chacun précédé d'une
icône), fond `#171512`.

- **Icônes** : définies une seule fois dans `site.css` (`.ico` + `.ico-house`, `.ico-mail`, `.ico-instagram`),
  en masque SVG coloré par `currentColor` : elles prennent la couleur du texte et suivent le survol. Pour en
  ajouter une : un SVG 16 × 16 en trait de 1,5, encodé dans une règle `.ico-<nom>{--ico:url("data:…")}`.
  Dans le HTML : `<i class="ico ico-mail" aria-hidden="true"></i>` suivi du texte (avec un libellé `.sr-only`
  pour les lecteurs d'écran).

## Charte (à reproduire exactement)

- **Couleurs** : fond `#171512` · encre `#ece7de` · blanc `#ffffff` (actif / survol) · surfaces `#1e1b17`
  (`#221e19` au survol des projets) · traits `rgba(236,231,222,.14)` à `.25` · texte secondaire
  `rgba(236,231,222,.5–.6)` · erreur formulaire `#d8896b`. Aucune autre couleur.
- **Typo** : Archivo 400–700 pour titres et textes (titres `letter-spacing:-0.02em`) ; IBM Plex Mono 400–500
  pour les étiquettes en capitales, `letter-spacing:.12em`, 11–12 px. Google Fonts.
- **Formes** : aucun arrondi, aucune ombre. Boutons pleins `#ece7de` / texte `#171512` (survol `#ffffff`) ou
  contour 1 px `rgba(236,231,222,.35)` (survol `.8`). Champs : fond transparent, bordure 1 px `.25`,
  focus `.75`, padding 13 × 14 px, 15 px Archivo.
- **Mise en page image/texte** : image absolue 50 % gauche + dégradé
  `linear-gradient(270deg,#171512 0%,rgba(23,21,18,.55) 30%,transparent 65%)`, texte à droite
  `width:min(680px,58%)` (À propos, Contact, Devis) ou `min(620px,58%)` (Accueil, Projets).
- **Espacements** : padding horizontal des pages `clamp(20px,5vw,48px)` ; nav padding 24 px ; gaps de
  formulaire 22 px.

## Page Contact (contact.html + assets/js/contact.js)

Prise de contact simple (entreprises, partenaires, presse…), distincte des demandes de devis.
- Question d'abord : « Votre demande concerne-t-elle un devis ? » (Oui | Non).
- **Oui** : court texte et bouton « Faire une demande de devis → » vers devis.html.
- **Non** : Prénom* · Nom* · Email* · Téléphone (facultatif, ≥ 10 chiffres si rempli) · Société ou organisme
  (facultatif) · Votre message* (10 à 5 000 caractères), puis « Envoyer le message ».
- Envoi par FormSubmit (`POST https://formsubmit.co/ajax/contact@atomes.studio`), sans dossier ni Supabase.
  Objet : `Nouveau message — Prénom Nom` ou `Nouveau message — Société (Prénom Nom)`, à garder distinct de
  l'objet des devis (`Nouveau projet — …`). Champ `email` = adresse de réponse, `_template=table`, `_honey`.
- Sur grand écran, les deux panneaux sont superposés (même principe que les écrans du devis) : la section et
  l'image ne bougent pas quand on répond ; les erreurs s'affichent sur la ligne du libellé.
- Les boutons « Nous contacter » de l'accueil mènent ici ; la question oriente les demandes de devis.

## Formulaire de devis (devis.html + assets/js/devis.js)

Huit écrans, un sujet par écran, barre de progression (8 segments 2 px), étiquette « 0N — Titre » et
« 0N / 08 », validation par écran, boutons Retour / Continuer → ; l'envoi n'est possible qu'au récapitulatif.
La touche Entrée passe à l'écran suivant.

1. **Vous** — Particulier | Professionnel (si pro : Société *obligatoire*, Activité) · Prénom* · Nom* · Email* ·
   Téléphone (facultatif, ≥ 10 chiffres si rempli).
2. **Votre projet** — Type de projet* (Construction, Rénovation, Extension, Démolition, Aménagement intérieur,
   Aménagement extérieur, Autre), puis État actuel du bien* limité aux cas cohérents : Construction → terrain nu,
   terrain bâti ; Rénovation, Extension, Aménagement intérieur → maison, appartement, immeuble, local pro,
   annexe / dépendance / garage ; Aménagement extérieur → maison, appartement, immeuble, local pro, terrain nu ;
   Démolition → maison, immeuble, local pro, annexe ; type « Autre » → tous les états. L'état « Autre » est toujours proposé, avec un
   champ de précision obligatoire (de même pour le type).
3. **Le lieu** — Adresse ou emplacement* (une rue, un lieu-dit ou un lotissement suffisent si le terrain n'a pas
   encore de numéro) · Commune* · Code postal* (5 chiffres) · Référence cadastrale.
4. **Les surfaces** — cinq champs fixes, tous facultatifs (« si concerné ») : Surface habitable existante,
   Surface habitable créée, Emprise au sol du bâti existant, Emprise au sol du bâti après projet, Surface de la
   parcelle (colonnes `surface_existante`, `surface`, `emprise_existante`, `emprise`, `surface_terrain`). Un
   bouton « ? » à côté de chaque libellé ouvre la définition du champ (textes de Simon pour la surface habitable
   et l'emprise au sol), une seule à la fois. Sur grand écran, elle s'affiche par-dessus le formulaire, sur toute la
   largeur des surfaces, pour ne pas changer la hauteur commune des écrans ; elle se ferme par le « ? », un clic ou
   quand le focus part. Échap la ferme partout (et ne ramène le focus au « ? » que s'il était perdu). En dessous de
   980 px, les surfaces passent sur une colonne et la définition s'insère sous le libellé. Les aides de l'écran
   suivant se fondent sur la surface habitable créée et sur l'emprise ajoutée (après projet moins existant, si
   l'emprise existante est renseignée ou pour un terrain nu).
5. **Vos besoins** — Documents souhaités (choix multiple, ≥ 1*, tous visibles) : Permis de construire,
   Déclaration préalable, Permis d'aménager, Permis de démolir, Dossier de consultation des entreprises,
   Perspective, Réalisation de plans, Avis d'architecte / étude simple, Autre (précision obligatoire), Je ne
   sais pas encore ; toujours renvoyés dans cet ordre (le premier donne l'objet du mail). Aides contextuelles aux
   seuils : 20 m² (construction neuve), 40 m² (extension en zone urbaine), 150 m² de surface totale après
   travaux ; « Je ne sais pas encore » → message rassurant ; Perspective, plans ou étude simple seuls → « pas de
   dossier administratif ».
6. **Détails** — Démarrage souhaité* (Dès que possible / 3–6 mois / 6–12 mois / Plus tard / Pas encore défini /
   Autre avec précision) · Description* (10 à 5 000 caractères) · Pièces jointes (JPG, PNG, GIF, WEBP, HEIC,
   PDF ; 10 fichiers et 10 Mo max).
7. **Comment nous avez-vous connus** — facultatif (Instagram, Recherche Google, Bouche-à-oreille, Un projet vu
   sur place, Autre avec précision facultative).
8. **Récapitulatif** — toutes les réponses, une section par écran avec un bouton « Modifier », puis « Envoyer la
   demande ». Pas de question sur le budget.

Sur grand écran (> 980 px), les huit écrans sont superposés dans une grille (`.steps`, écrans inactifs en
`visibility:hidden`, écran actif `.is-on`) dont la hauteur est figée à celle du plus haut écran au repos (l'écran
Détails) : devis.js la mesure (`caleHauteur`, variable `--h-ecrans`) en masquant les blocs qui se déplient, au
premier rendu, après le chargement des polices et à chaque redimensionnement. La section, l'image et les boutons
gardent donc la même place tout au long du formulaire, quoi qu'on remplisse. Ce qui se déplie ensuite (précisions
« Autre », pièces jointes, messages d'erreur) et le récapitulatif (positionné en absolu, hors de la mesure)
défilent à l'intérieur de l'écran, avec une barre fine et des voiles dégradés en haut et en bas (`data-defile`
posé par devis.js : haut, milieu, bas, aucun) ; `scroll-padding` garde l'élément focalisé hors des voiles.
L'écran Surfaces ne défile pas : ses définitions s'affichent par-dessus le formulaire. En dessous de 980 px
(image au-dessus, hauteur fixe), les écrans s'affichent en flux normal, sans défilement interne.

Les précisions des choix « Autre » sont enregistrées dans `projets.precisions` (jsonb : type, bien, documents,
calendrier, source), affichées « Autre : … » dans les e-mails, l'objet du mail et l'espace client.
Les règles de cohérence vivent dans `devis.js` : `BIENS_PAR_TYPE` est dupliqué dans la fonction `demande`
(validation) ; la liste des surfaces (`SURFACES`, clés et libellés) l'est dans la fonction (e-mails) et dans
`dossier.js` (récapitulatif) : modifier les trois ensemble.

**Envoi** : si `config.js` est rempli, la fonction `demande` (dossier + espace client + e-mails), FormSubmit en
secours ; sinon FormSubmit seul (`POST https://formsubmit.co/ajax/contact@atomes.studio`, ou formulaire
multipart natif avec `_next = devis.html?envoye=1` s'il y a des pièces jointes). Champs envoyés sous leur
libellé français (voir `champs()`), plus `_template=table`, `_captcha=false`.
**Objet du mail** : `Nouveau projet — <Type> · <1er document> · <Commune> (<Nom>)`, format contractuel.

## Cache des navigateurs

GitHub Pages fait garder chaque fichier 10 minutes par les navigateurs. Quand une page change de structure et
que son script ou la feuille de style changent avec elle, versionner leur adresse dans la page
(`site.css?v=4`, `dossier.js?v=6`…) et augmenter le numéro à la modification suivante du même genre : sinon,
pendant ces 10 minutes, un visiteur peut recevoir la nouvelle page avec l'ancien script. Versions en cours depuis la
rétractation par le formulaire public (22 octobre 2026) : `site.css?v=5` (espace client, espace agence, page
d'action, formulaire de rétractation ; contact et devis, inchangés, gardent `?v=4`), `dossier.js?v=7`,
`admin.js?v=8`, `action.js?v=5`, `renoncer.js?v=1`, `contact.js?v=2` ; accueil, projets et à propos sans numéro.
Le numéro ne protège que dans ce sens : GitHub Pages ignore `?v=` et sert toujours le fichier à jour. Une ancienne
page encore en cache qui redemande son script reçoit donc le nouveau (visiteur qui a rechargé la page peu avant la
publication) et peut rester sur « Chargement… » jusqu'à un rechargement.

## Publication

Dépôt GitHub `chadfo/atomes` (public), domaine atomes.studio (DNS chez LWS, HTTPS forcé). Le dossier `site/`
est publié automatiquement par le workflow `.github/workflows/pages.yml` à chaque push sur `main` (Settings →
Pages → Source : « GitHub Actions »). Pour publier une modification : dans VS Code, panneau Source Control,
écrire un message, « Commit », puis « Sync Changes » ; la mise en ligne prend une à deux minutes (onglet
Actions du dépôt). Garder dans `site/` : `.nojekyll`, `CNAME` (contient `atomes.studio`), `robots.txt`,
`sitemap.xml`, `favicon.png`, l'image OG `a5ce3393-….png`, et les balises meta / OG de chaque page.

## Espace client et espace agence (parcours v3, discussion)

Mise en place détaillée dans **SETUP-ESPACE-CLIENT.md**. Résumé :

**Parcours v3 (14 octobre 2026) : tout par e-mail.** Chaque étape importante est annoncée au client par e-mail,
avec la timeline de son dossier. Le client répond aux e-mails (sa réponse et ses pièces jointes s'ajoutent au
dossier), signe le devis et valide ses documents sur la page d'action ouverte par un lien reçu par e-mail, et paie
par virement, avec le numéro de dossier pour référence. Pas de Yousign ni de Stripe. L'espace client (en
consultation seule jusqu'à la discussion) ne sert toujours ni à signer, ni à payer, ni à valider.

**Discussion (20 octobre 2026, décisions de Simon).** Chaque dossier a une discussion, la même dans l'espace agence
et dans l'espace client, du plus ancien au plus récent, façon messagerie : e-mails du client rangés par le moteur,
messages que le client écrit depuis son espace (texte, photos et PDF, aux limites du formulaire de devis), messages
de l'agence (envoyés en entier au client par e-mail, pièces jointes comprises), entre les étapes clés du dossier
(table `evenements`). Elle remplace les « Questions au client » et les demandes de modification repérées dans les
e-mails, reprises en messages par la migration 0006 (tables `questions` et `modifications` gardées, plus écrites,
à supprimer plus tard). Le client et l'agence écrivent à toute étape, dossier clos ou rétracté compris. Le client
n'écrit toujours jamais directement en base ni dans Storage : ses messages et leurs pièces passent par la fonction
`espace` (envoi multipart), ses e-mails par le moteur. L'agence non plus n'écrit plus directement dans `messages`.
Pas de Realtime : les pages relisent le dossier affiché (voir les pages plus bas).

**Moteur de l'agence (19 octobre 2026 ; version 0.2.0 pour la discussion).** Le client écrit à contact@atomes.studio
(adresse de réponse de tous les e-mails) ou à simon@atomes.studio. Le moteur, programme Python de l'ordinateur de
l'agence (dossier `atomes-moteur`, à côté de ce dépôt, jamais publié ; mode d'emploi dans son README), lit ces deux
boîtes par IMAP toutes les 5 minutes, sans rien y changer, et range les e-mails des clients dans la discussion de
leur dossier : `messages` (`resend_id = imap:<Message-ID>`, 13 colonnes nommées à l'insertion, les colonnes de la
discussion gardant leur valeur par défaut, celle d'un e-mail du client), pièces dans `<id>/client/`. Depuis sa
version 0.2.0, il ne répond plus aux questions et ne note plus de demande de modification, et sa limite de 24 h ne
compte que ses propres lignes (`resend_id like 'imap:%'`). Mêmes règles que la fonction `espace` (texte sans la
citation, pièces, limites) ; vérification de l'expéditeur par sa signature DKIM, contrôlée par le moteur. Il ignore
les e-mails de l'agence, dont les avis « Message du client » du site. La réception par Resend (webhook
`email.received`, anciennes adresses de réponse des dossiers en `r.atomes.studio`), prévue pour la transition, a été
retirée le 20 octobre 2026, aucun vrai client n'ayant encore reçu une telle adresse : le moteur est la seule voie
d'arrivée des e-mails des clients.

**Rétractation et conditions générales (21 et 22 octobre 2026, décisions de Simon).** Le particulier qui a signé son
devis en ligne renonce au contrat sur le formulaire public `renoncer/` (atomes.studio/renoncer/, adresse annoncée par
les conditions générales), sans connexion ni lien reçu par e-mail : un petit lien « Renoncer au contrat ici » y mène
depuis le pied de page de l'espace client, de la page d'action et du formulaire lui-même, et de nulle part ailleurs.
Plus aucun lien de rétractation n'est envoyé ; les anciens restent acceptés jusqu'à la fin du délai. L'information sur
la rétractation et le formulaire type sont dans les conditions générales, imprimées à la fin de chaque devis : la page
de signature et les e-mails ne les montrent plus. Au-dessus du bouton de signature, pour tous les clients : « En
signant, vous acceptez nos conditions générales, jointes au devis. ». Le devis, toujours joint aux e-mails (support
durable), fait 15 Mo au plus.

- `supabase/migrations/0001_espace_client.sql` : tables `projets` (une ligne par demande, identifiant
  `AAMMJJHHMMSS` à l'heure de Paris, ex. `261012173615`), `modele_etapes` et `etapes` (timeline), `admins` ;
  règles de sécurité (un client ne voit que ses dossiers, l'agence voit tout) ; bucket privé `dossiers`
  (`<id>/client/` pièces du client, `<id>/agence/` documents fournis par l'agence).
- `supabase/functions/demande/index.ts` : fonction appelée par le formulaire de devis (devis.html). Crée le dossier, dépose les
  pièces, crée ou rattache le compte client (connexion par code reçu par e-mail), envoie l'accusé de réception au
  client (avec la timeline ; réponse à contact@) et la notification à l'agence (même objet
  `Nouveau projet — …` qu'avant) via Resend.
- `supabase/migrations/0004_parcours_client.sql` : parcours v2. 11 étapes (`modele_etapes`) : Demande reçue ·
  Traitement de votre demande (répondre à nos messages) · Production de votre devis · Validation de votre devis
  (signer) · Paiement (par virement depuis la v3) · Production de vos documents · Validation de vos documents
  (valider ou demander une modification) · Dépôt, Suivi, Démarche administrative validée (option de suivi,
  `projets.suivi_administratif`, masquées sinon) · Dossier clos. Colonnes `optionnelle`, `instantanee` (étape
  faite dès qu'elle est atteinte, date seule) et `action` (questions, signer, payer, valider ; depuis la discussion,
  `questions` veut dire « répondre à nos messages ») ; statuts recalculés par `recalculer_etapes()` à chaque
  changement de `projets.etape` ou de l'option (refus si étape optionnelle sans l'option). Tables `questions` et
  `modifications` (remplacées par la discussion, migration 0006) ; colonnes du devis, de la signature et du paiement
  dans `projets` (celles de Stripe, dont `paiement_session`, inutilisées depuis la v3). Le client lit, n'écrit
  jamais directement (fonction `espace`).
- `supabase/migrations/0005_parcours_email.sql` : parcours v3. Table `messages` (e-mails reçus du client :
  réponse sans la citation, texte complet, pièces jointes, vérifié ou non ; le client ne lit que les messages
  vérifiés de ses dossiers ; `traite` et `traitement_le` : traitement repris après une interruption ; devenue la
  discussion avec 0006) ; colonnes `demarrage_anticipe_le` et `demarrage_anticipe_texte` (case du particulier),
  `retracte_*` (rétractation) et `envois_echoues` (e-mail légal au client à renvoyer) dans `projets` ; texte de
  l'étape Paiement (virement). Storage : seule l'agence dépose depuis le site (politique « admin depose dans les
  dossiers ») ; les pièces du client arrivent par e-mail (moteur) et, depuis la discussion, par la fonction
  `espace`. Elle n'est plus à rejouer : elle rendrait à l'agence l'écriture directe dans `messages` (0006 la retire).
- `supabase/migrations/0006_discussion.sql` : discussion (20 octobre 2026). Une seule transaction (`lock_timeout` de
  5 s : le moteur écrit dans `messages` toutes les 5 minutes), prérequis 0005 (sinon « Migration 0005 absente : rien
  n'a été modifié »), formes rejouables (la rejouer ne change rien), `notify pgrst, 'reload schema'` à la fin.
  - Table `messages`, huit colonnes de plus : `auteur` (`client` par défaut, ou `agence`), `origine` (`email` par
    défaut, e-mail reçu, ou `espace`, message écrit dans un espace ou repris), `auteur_id` (compte qui a écrit
    depuis un espace ; clé étrangère vers `auth.users`, `on delete set null`), `lu_agence_le` (lecture par
    l'agence ; créée une seule fois, avec les messages existants marqués lus ; date d'enregistrement pour un message
    de l'agence), `mail_etat` (`en_cours`, `envoye` ou `echec` ; nul : aucun e-mail) et `mail_le` (début de la
    dernière tentative tant que `en_cours`, puis fin de l'envoi), `cle` (uuid tiré par la page, unique : anti-doublon
    d'un envoi répété), `reprise` (`questions:<id>`, `reponse:<id>` ou `modification:<id>`, unique). Contraintes
    nommées sur `auteur`, `origine` et `mail_etat` ; aucune contrainte nouvelle sur les 13 colonnes que le moteur
    insère. Index partiel des messages du client non lus.
  - Droits : plus aucune écriture directe dans `messages`, même pour l'agence (politique « admin gere les messages »
    retirée ; tous les droits retirés à `public`, `anon` et `authenticated`, lecture rendue à `authenticated`, la RLS
    de 0005 choisissant les lignes : avant de rendre la lecture, RLS activée et toute autre politique que « client lit
    ses messages » retirée, au cas où l'une ou l'autre aurait été changée à la main) ; écriture par le rôle service
    seulement (fonction `espace`, moteur). Politique
    Storage « client depose dans son dossier » retirée au cas où le brouillon v3.1 du `git stash` l'aurait recréée :
    restent « admin depose dans les dossiers », « admin modifie le stockage », « admin supprime du stockage » et
    « client lit son dossier ».
  - Table `evenements` (étapes clés) : `projet_id`, `type` (`demande_recue`, `devis_envoye`, `devis_signe`,
    `paiement_recu`, `documents_prets`, `documents_valides`, `retractation`, `dossier_clos`), `le`, `details`
    (`{ montant_cents, montant_libelle }` pour un devis envoyé, `{}` sinon), unique par dossier, type et date. Mêmes
    droits avant et après le 30 octobre 2026 : tout retiré à `public`, `anon` et `authenticated`, lecture à
    `authenticated` (politique « client lit ses evenements » : l'agence tout, le client ses dossiers), tout au rôle
    service. Notées par le déclencheur `trg_evenements` (fonction `noter_evenements`, `security definer`,
    exécution retirée à `public`, `anon` et `authenticated`) à chaque écriture de `projets` : création, colonne
    qui devient non nulle ou change (`devis_envoye_le`, `signe_le`, `paye_le`, `documents_valides_le`,
    `retracte_le`), passage à « validation » en avançant et sans rétractation (documents prêts), passage à « clos » ;
    une erreur ne bloque jamais l'écriture du dossier (avertissement dans le journal de la base).
  - Table `envois_client` (interne, jamais lue par les pages) : bail d'un envoi du client en cours, une ligne par
    dossier (`projet_id`, clé primaire vers `projets` en cascade ; `pris_le`). RLS activée, aucune politique, aucun
    droit pour `public`, `anon` et `authenticated` (mêmes droits avant et après le 30 octobre 2026), tout au rôle
    service : la fonction `espace` y tient la règle « un seul envoi du client à la fois par dossier ».
  - Reprise (une seule fois, `on conflict do nothing`) : étapes clés des dossiers existants ; questions, un message
    de l'agence par envoi (« Une question / Quelques questions sur votre dossier <id> », réponses proposées en
    « Par exemple : … », sans e-mail connu : `mail_etat` nul) ; réponses et demandes de modification faites dans
    l'espace client v2, en messages du client (« Réponse à : <question> »), sauf celles déjà arrivées par e-mail.
  - Tout ce qui est écrit dans `messages` et `evenements` est lisible par le client sur ses lignes visibles, toutes
    colonnes comprises (la RLS filtre les lignes, pas les colonnes) : jamais de donnée interne dans ces tables.
  - Sur le projet en service, ne plus jamais rejouer 0001 à 0005. Si 0005 a été rejouée (elle rend à l'agence
    l'écriture directe dans messages), rejouer 0006 aussitôt. 0001 rejouée en entier échoue d'elle-même sans rien
    changer. Si une partie d'une migration ancienne a été exécutée, s'arrêter et prévenir Claude : 0006 ne répare pas
    la timeline. Ne jamais appliquer le brouillon v3.1 du `git stash` (`0006_depot_et_copies.sql`).
- `supabase/functions/espace/index.ts` : un seul fichier, comme `demande` (déploiement par copier-coller dans
  l'éditeur Supabase : petites fonctions utilitaires dupliquées, pas de module partagé). Appel : `POST` JSON
  `{ action, projet, … }` (64 Ko au plus, sinon 413 « Requête trop lourde ») avec `Authorization: Bearer <session>`,
  ou `{ action, jeton, … }` pour un lien d'action, ou `{ action: "renoncer_formulaire", … }` sans session ni jeton ;
  `message_client` seulement en `multipart/form-data` (voir plus bas). Jamais le même nom d'action côté client et
  côté agence. Cinq entrées :
  - actions de l'agence, avec sa session : `devis` (PDF de 15 Mo au plus, toujours joint à l'e-mail : au-delà, 413
    sans rien écrire ni envoyer, et la page retire le fichier déposé ; lien de signature), `etape` (lien de
    validation à l'étape « Validation de vos documents »), `option`, `paye` (« Virement reçu »), `message_agence`
    (message de la discussion, envoyé au client par e-mail), `renvoyer_message` (e-mail d'un message de l'agence qui
    n'est pas parti), `messages_lus` (messages du client affichés à l'agence), `rattacher` et `supprimer_message`
    (messages à vérifier ; `rattacher` reprend aussi un traitement interrompu ; message du moteur : marqué vérifié et
    à traiter, le moteur range ses pièces à son passage suivant), `renvoyer` (confirmation du contrat ou accusé de
    rétractation qui n'a pas pu partir) ; chaque action qui écrit au client renvoie `mail` (faux si l'e-mail n'est
    pas parti, ce que l'espace agence signale). L'action `questions` n'existe plus (« Action inconnue ») ;
  - actions par lien, sans compte, avec le jeton reçu par e-mail : `infos`, `signer`, `valider`, et `renoncer` pour
    les anciens liens de rétractation (plus aucun n'est créé) ;
  - action publique `renoncer_formulaire` (formulaire de rétractation, page `renoncer/` ; voir « Rétractation »
    plus bas), sans session ni jeton, traitée avant eux ;
  - actions du client, avec sa session (compte agence : 403 explicite ; autre compte : 404, comme un dossier
    inexistant) : `infos_espace`, en lecture seule (coordonnées du virement), et `message_client` (message de la
    discussion, avec pièces jointes) ;
  - webhook Resend `email.received`, **inactif depuis le 20 octobre 2026** : la réception par Resend (anciennes
    adresses de réponse des dossiers, sous-domaine `r.atomes.studio`) a été retirée, et ses secrets
    `REPONSES_DOMAINE`, `RESEND_WEBHOOK_SECRET` et `RESEND_RECEPTION_KEY` supprimés. Sans `RESEND_WEBHOOK_SECRET`,
    tout appel du webhook (en-têtes `svix-…`) est refusé (« signature invalide », 400) avant toute lecture du corps ;
    avec ce secret, le corps (métadonnées seulement) est lu jusqu'à 256 Ko (au-delà, 413) ; sans `REPONSES_DOMAINE`,
    aucune adresse de dossier n'est reconnue. Le code est gardé tel quel : ses fonctions de texte et de pièces
    jointes (`sansCitation`, `texteDepuisHtml`, `nomSur`, `reponseAutomatique`…) sont la référence des tests de
    parité du moteur (`atomes-moteur/outils/parite`, qui les extrait de ce fichier). Fonctionnement, s'il était
    réactivé : signature Svix vérifiée sur le corps brut ; l'e-mail est lu par l'API de
    Resend (clé `RESEND_RECEPTION_KEY` si la réception est dans un compte Resend à part, sinon `RESEND_API_KEY`),
    rattaché au dossier par son adresse de réponse et enregistré dans `messages`. Il est vérifié si son expéditeur
    est l'adresse du dossier (adresse simple, la même dans le champ `from` de Resend et dans l'en-tête From) et si
    Resend l'authentifie (DMARC « pass », ou DKIM « pass » : signature du domaine de cette adresse ; jamais SPF
    seul ni un en-tête écrit par l'expéditeur) : ses pièces jointes (images et PDF, 25 Mo ; pas les images
    intégrées de la citation ni les petits logos) vont dans `<id>/client/` (depuis la discussion, il ne répond plus
    aux questions et ne note plus de demande de modification : le texte reste dans le message). Sinon, il attend la
    vérification de l'agence (« Rattacher au dossier » ou « Supprimer »). Traitement reprenable : un message vérifié
    est marqué traité à la fin ; une relivraison pendant le traitement reçoit 503, une erreur 500, et la tentative
    suivante de Resend reprend là où il s'est arrêté. Limites par dossier et par 24 h (30 messages, 20 à vérifier,
    200 Mo de pièces ; seuls les e-mails comptent, `origine = 'email'`, comme le moteur ne compte que ses lignes
    `imap:`), un avis « Message à vérifier » par heure au plus ; texte et HTML reçus analysés en temps linéaire.

  **Discussion** (actions `message_client`, `message_agence`, `renvoyer_message`, `messages_lus`) :
  - `message_client` (client, `multipart/form-data` seulement ; en JSON : 400 « Requête illisible ») : champs
    `action`, `projet`, `cle` (uuid), `texte` (facultatif), `fichiers` (0 à 10). Session vérifiée avant toute lecture
    du corps ; corps de 10,5 Mo au plus (taille annoncée, puis octets comptés à la lecture : un envoi sans
    `Content-Length` est arrêté de même ; 413). Refus, dans l'ordre : `cle` mal formée (400), texte de plus de
    5 000 caractères (retours à la ligne comptés `\n`, 400), ni texte ni fichier (400), plus de 10 fichiers (400),
    autre format que JPG, JPEG, PNG, GIF, WEBP, HEIC, HEIF ou PDF (415), plus de 10 Mo en tout (413) ; `cle` déjà
    enregistrée pour ce dossier : `{ deja: true, message }` avant tout dépôt (pour un autre message : 409). Un seul
    envoi du client à la fois par dossier : bail dans `envois_client`, pris avant les contrôles qui suivent et rendu à
    la fin, même après une erreur (un bail de plus de 3 minutes, exécution interrompue, est repris) ; un second envoi
    simultané reçoit 409 « Un envoi est déjà en cours : réessayez dans quelques secondes. » (la page garde brouillon et
    clé). Puis 30 messages de l'espace par dossier et par 24 h (429) ; 200 Mo de pièces du client par dossier (413 ;
    volume lu sur toute la liste de `<id>/client/`, page par page). Pièces
    rangées à plat dans `<id>/client/` sans rien écraser (nom reçu passé par `nomSur`, sinon préfixé
    `<AAMMJJHHMMSS>-<rang>-`, puis numéroté), type déduit de l'extension ; si un dépôt ou l'enregistrement échoue,
    seuls les fichiers de cette requête sont retirés. Message enregistré vérifié et traité, `auth = { controle: "session" }`,
    `auteur_id` = le compte. Puis avis « Message du client — dossier <id> (<nom>) » à contact@ (réponse à contact@,
    alerte en tête : répondre depuis l'espace agence ; texte entier, pièces listées), au plus un par dossier et par
    quart d'heure (`mail_etat` du message : `en_cours`, puis `envoye` ou `echec` ; nul sans avis) ; un échec de
    l'avis est seulement journalisé. Réponse `{ message }` : `id`, `recu_le`, `auteur`, `origine`, `texte`,
    `pieces`, `verifie`.
  - `message_agence` (agence, JSON `{ projet, cle, texte, pieces, sans_mail }`) : mêmes limites de texte et de
    nombre ; pièces déposées d'abord par la page dans `<id>/agence/discussion/<AAMMJJHHMMSS>[-n]-<nom>` (n de 2 à 9
    si le nom est pris), acceptées seulement dans ce dossier, PDF ou image, taille lue dans la liste du stockage
    (toutes ses pages ; 400 « Pièce jointe introuvable : déposez-la de nouveau. » sinon ; liste du stockage en panne :
    503) ; nom montré au client (fil, liste de l'e-mail, nom de la pièce jointe) = nom du fichier déposé sans le
    préfixe `<AAMMJJHHMMSS>[-n]-`, qui ne sert qu'à rendre le chemin unique (le chemin le garde).
    Message enregistré d'abord (`mail_etat` `en_cours`, `mail_le` = début de la tentative), puis e-mail « Message
    d'Atomes studio — dossier <id> » (texte entier, timeline, réponse à contact@, pièces jointes si elles tiennent
    en 15 Mo, sinon à télécharger depuis l'espace client), puis `envoye` ou `echec`. `sans_mail` (« Déjà envoyé
    depuis ma messagerie ») : aucun e-mail, `mail_etat` nul. Réponse `{ id, mail, mail_etat }` ; `cle` déjà
    enregistrée : `{ deja, mail, mail_etat }`.
  - `renvoyer_message` (`{ projet, message }`) : renvoi permis si l'e-mail est en `echec`, ou `en_cours` depuis plus
    de 10 minutes ; réservé par une écriture conditionnelle sur l'état lu (deux clics, deux onglets : un seul
    e-mail ; sinon 409) ; déjà parti : `{ mail: true, deja: true }`. Réponse `{ mail }`.
  - `messages_lus` (`{ projet, ids }`, 100 au plus) : `lu_agence_le` posé sur ces seuls messages, s'ils sont du
    client, de ce dossier et non lus. Réponse `{ lus }`.
  - Journaux de ces actions sans donnée personnelle : étape, dossier, puis un JSON (id du message, nombre et taille
    des pièces, code et statut d'erreur), par exemple `discussion : avis à l'agence 261020094200
    {"message":42,"pieces":2,"code":null,"statut":null}`. Jamais un texte de message, une adresse e-mail, un nom de
    fichier, un chemin de pièce, `error.details` ni `error.hint`.

  **Rétractation** (action `renoncer_formulaire`, décisions de Simon des 21 et 22 octobre 2026 ; L221-21 et D221-5) :
  - `renoncer_formulaire` (JSON `{ action, nom, dossier, email, email_accuse }`, `email_accuse` facultatif, vide =
    absent ; traitée par le routeur avant le jeton et la session, mêmes CORS et même format de réponse que les autres
    actions) : nom de 3 à 120 caractères, numéro de dossier de 12 chiffres (espaces retirés), adresses valides de
    200 caractères au plus (espaces retirés, en minuscules), sinon 400 avec le message du champ. Contrat reconnu
    seulement si le dossier existe, est celui d'un particulier, porte un devis signé et a pour adresse celle saisie ;
    sinon un seul refus, 404, même texte (« Nous ne retrouvons pas de contrat en cours avec ce numéro de dossier et
    cette adresse e-mail… »), sans rien écrire, envoyer ni journaliser : rien ne révèle qu'un numéro existe ni à qui
    il appartient. Déjà rétracté : `{ deja: true, retracte_le }` ; délai écoulé : 410 (« Le délai de rétractation
    est expiré. Si vous pensez que ce n'est pas le cas, écrivez-nous à contact@atomes.studio. ») ; sinon
    `{ retracte_le, mail }`. Pas de limite de fréquence : un refus n'écrit et n'envoie rien, un succès n'a lieu
    qu'une fois (risque d'un numéro deviné accepté par Simon le 23 octobre 2026). Journaux sans le nom, les adresses ni le numéro saisis (erreur inattendue, y compris pendant la
    relecture du dossier ou l'écriture de `envois_echoues` : son code et son statut, jamais l'erreur entière, dont le
    message reprend l'adresse de la requête ; sans clé Resend, l'objet de l'e-mail n'est pas journalisé).
  - Effets, les mêmes qu'avec un ancien lien (`enregistrerRetractation`) : écriture conditionnelle de `retracte_*`
    (dossier pas encore rétracté, même signature ; nom saisi ; `retracte_email` = l'autre adresse si elle est donnée,
    sinon l'adresse saisie ; IP, navigateur), accusé de réception à l'adresse du dossier (avec la timeline) et,
    séparément, à l'autre adresse si elle diffère (sans timeline) ; il reprend le contenu de la déclaration (nom,
    numéro de dossier, adresse e-mail de la demande, autre adresse pour l'accusé, sous les libellés du formulaire),
    puis la date et l'heure de réception ; s'il n'est pas parti vers l'une des deux adresses, mention dans
    `envois_echoues` (« Renvoyer », qui l'envoie de nouveau aux deux) et alerte dans l'avis ; `mail` faux seulement
    s'il n'est parti nulle part ; avis « Rétractation — dossier … » à l'agence, « par le formulaire du site », avec
    l'autre adresse. L'étape ne change pas.
  - Plus aucun lien de rétractation n'est créé (`lienRenoncer` supprimé) : ni dans `infos`, `signer` ou
    `infos_espace`, ni dans les e-mails. L'information sur la rétractation et le formulaire type sont dans les
    conditions générales imprimées à la fin du devis : l'e-mail « Votre devis est prêt » dit « Nos conditions
    générales figurent à la fin du devis. » ; `infos` (mode signer) renvoie `textes = { case, bouton, cgv }`, `cgv`
    étant la phrase affichée au-dessus du bouton ; l'e-mail « Devis signé » d'un particulier confirme sa demande de
    démarrage en citant la case (texte enregistré avec la signature), sans bloc ni lien de rétractation. Le devis,
    support durable de ces conditions, est toujours joint : 15 Mo au plus (`MAX_DEVIS_JOINT`).

  E-mails Resend : timeline du dossier dans chaque e-mail au client, adresse de réponse contact@ (`MAIL_AGENCE`), lien
  « Suivre mon dossier en ligne » ; liens d'action toujours vers `SITE_URL` (jamais vers l'origine de la
  requête). « Verify JWT » désactivé : session, jeton ou signature de Resend vérifiés dans la fonction (rien de tel
  pour l'action publique `renoncer_formulaire`, qui reconnaît le contrat par le numéro et l'adresse du dossier).
  Signature : nom, date, IP (celle ajoutée par la plateforme, chaîne X-Forwarded-For gardée), navigateur, montant,
  empreinte SHA-256 du PDF recalculée au moment de signer ; particulier : case de démarrage anticipé obligatoire. Rétractation : 14 jours après la
  signature, prolongés jusqu'au premier jour ouvrable (week-end, jours fériés français) ; l'étape ne change pas.
  Les textes juridiques (case, bouton, phrase des conditions générales, refus du formulaire de rétractation ;
  formulaire type des anciens liens) viennent de cette fonction, pour les e-mails comme pour la page d'action, qui
  les reçoit d'elle.
- **Liens et adresses de réponse** (secret `JETON_SECRET`) : lien `https://atomes.studio/action/#t=<jeton>`,
  jeton = `base64url(JSON)` + `.` + `base64url(HMAC-SHA256)`, charge utile `{ a, p, e, d }` (action, dossier,
  expiration ; `d` : début de l'empreinte du devis pour signer, du contrat signé pour renoncer, soit
  `SHA-256(date de signature + empreinte du devis signé)`) ; placé dans le fragment, il n'est jamais envoyé au
  serveur des pages. Durées : signer 30 jours (un nouveau devis invalide les anciens liens), valider 90 jours,
  renoncer jusqu'à la fin du délai de rétractation (plus aucun n'est créé ; ceux déjà envoyés restent acceptés, sauf
  celui d'un contrat précédent). Ancienne adresse de réponse, plus reçue depuis le retrait de la réception Resend
  (20 octobre 2026) : `d<id>-<mac>@<REPONSES_DOMAINE>` (`r.atomes.studio`), `mac` = 20 premiers caractères
  hexadécimaux de `HMAC-SHA256(JETON_SECRET, "reponse:" + id)`. Sans `JETON_SECRET` : pas de lien ; sans
  `REPONSES_DOMAINE` (supprimé le 20 octobre 2026) : le webhook n'ajoute plus rien.
- `site/assets/js/config.js` : URL Supabase, clé anon, URL des fonctions `demande` (`apiUrl`) et `espace`
  (`espaceUrl`, aussi pour la page d'action et le formulaire de rétractation). Vide = le formulaire de devis envoie
  via FormSubmit comme avant ; rempli = fonction « demande », FormSubmit en secours si elle ne répond pas.
- `site/dossier/` + `assets/js/dossier.js` : espace client. Connexion sans mot de passe, par code reçu par
  e-mail (voir « Connexion par code » plus bas), liste des dossiers, timeline numérotée et datée (« Depuis le … »
  pour l'étape en cours), sous l'étape en cours une information (devis à signer depuis le lien reçu, montant,
  référence et coordonnées du virement, documents à valider depuis le lien reçu ou modification à demander dans la
  discussion, rétractation reçue), discussion, documents de l'agence et du client, récapitulatif de la demande. Dates
  à l'heure de Paris, « 1er » comme dans les e-mails (« 1er octobre 2026 à 09:05 »).
  - Lecture : `*, etapes(*), messages(id, recu_le, auteur, origine, texte, pieces, verifie), evenements(type, le,
    details)` ; avant la migration 0006 (PGRST200 ou 42703), ancienne lecture, chaque message traité comme un
    e-mail du client. Messages vérifiés seulement.
  - Discussion : messages des deux côtés et étapes clés, du plus ancien au plus récent (à date égale, l'étape clé
    d'abord) ; les 40 derniers éléments, « Afficher les messages précédents » pour le reste. « Message complet »
    d'un e-mail du client : texte intégral (`texte_complet`) lu à l'ouverture du détail seulement, placé sous le
    texte et avant les pièces (même ordre que l'espace agence). Dossier ouvert relu toutes les 30 s (onglet visible)
    et au retour sur l'onglet (messages et étapes clés) ; le fil est mis à jour par élément (`data-id`), sans perdre
    la saisie ni le défilement. Une étape clé nouvelle (devis envoyé, paiement reçu…) fait relire le dossier entier :
    timeline, information sous l'étape, documents et coordonnées de virement à jour ; fil, fenêtre, brouillon et focus
    gardés. Sans ancrage de défilement natif (Safari), la page garde à sa place le champ qui a le focus, sinon le
    premier élément visible resté en place (fil, composeur, blocs suivants) : même règle dans l'espace agence. Une
    réponse arrivée après une déconnexion n'écrit rien dans la page.
  - Composeur : texte (compteur au-delà de 4 500 caractères, 5 000 au plus), photos et PDF (10 fichiers, 10 Mo en
    tout, mêmes refus que le formulaire de devis), glisser-déposer ; brouillon par dossier gardé en mémoire
    seulement (jamais dans un stockage), vidé après l'envoi et à la déconnexion ; envoi multipart à
    `message_client` (session lue au moment de l'appel, délai de 2 minutes ; clé `cle` tirée à la première
    tentative et renouvelée quand le contenu change). Compte agence ouvert sur l'espace client : composeur masqué
    (« écrivez au client depuis l'espace agence »).
  - Tableau de bord (21 octobre 2026), fiche d'un dossier : trois colonnes à partir de 1200 px de large (en-tête du
    dossier, Avancement et Votre demande à gauche ; Discussion au milieu ; Documents de l'agence et Vos documents à
    droite). De 981 à 1199 px, deux colonnes : Discussion à droite, le reste à gauche. Jusqu'à 980 px, une seule,
    comme avant. L'ordre du DOM ne change pas (lecture, tabulation) : les blocs sont placés par `grid-template-areas`
    (`site.css`, « Tableau de bord »). `montrer()` pose `.espace--tableau` sur la section pour cette vue seulement ;
    les autres vues gardent leur colonne de 760 px. À partir de 981 px : colonne de gauche resserrée (timeline sur le
    modèle de `.timeline--compacte`, coordonnées de virement en 12 px : l'IBAN tient sur une ligne), discussion
    encadrée d'un filet, composeur compact (texte sur trois lignes, fichiers et « Envoyer » sur une ligne, erreur et
    annonce juste dessous, puis l'aide), documents en deux lignes (le nom, puis taille, date et « Télécharger »).
    Erreur de la page au-dessus du tableau, collée sous la barre de navigation quand la page défile ; un nouvel essai
    de téléchargement efface l'échec précédent. Écran d'au moins 620 px de haut : la discussion est un panneau
    collant qui remplit l'écran, composeur en bas. Son fil défile seul et garde 80 px au moins (un composeur très
    chargé fait alors défiler le panneau). En trois colonnes, les documents sont collants aussi et défilent seuls si
    la liste est longue. Haut et seuil collant : `--tableau-haut` (142 px : barre de navigation, marge, étiquette
    « Espace client », écart), à recalculer si l'un d'eux change ; hauteur : `--tableau-hauteur` (en `vh`, puis en
    `dvh` si le navigateur la connaît). Écran de moins de 800 px de haut (ordinateur portable) : cadre et composeur
    resserrés. Écran de moins de 620 px de haut : colonnes sans panneau, fil dans la page. Impression : une colonne
    (règles en `screen`).
  - Fil défilant (dans le panneau ; déduit de son `overflow-y` calculé, sans seuil en double avec la feuille de
    style) : tout en bas à l'ouverture d'un dossier et après un envoi. À une mise à jour, il reste en bas s'il y
    était (à 40 px près), sinon il garde sa place : ancrage natif, ou (Safari) compensation par son `scrollTop`.
    Quand sa taille change (polices chargées tard, passage d'une mise en page à l'autre), un `ResizeObserver` le
    remet en bas s'il y était ou s'il devient défilant. La position où la page l'a mis en bas ne compte plus dès que
    le visiteur défile ailleurs ; « Message complet » refermé, il suit de nouveau le bas s'il y est. Focalisable
    (`tabindex="0"`, nom « Discussion ») seulement quand il déborde ; focalisé quand il cesse de défiler (zoom,
    fenêtre réduite), il garde le focus (`tabindex="-1"`) jusqu'à ce qu'il le perde. Panneau des documents qui
    déborde : `tabindex="-1"` (Firefox en ferait sinon un arrêt de tabulation sans nom). Focus au clavier dans un
    panneau collant : l'élément caché sous la barre de navigation ou coupé par le bord d'un panneau est ramené au
    centre (Firefox ne le fait pas lui-même ; rien au clic de souris).
  - Documents de l'agence : fichiers de `<id>/agence/` (liste du stockage) et pièces jointes des messages de
    l'agence, rangées dans `<id>/agence/discussion/` hors de cette liste (nom d'origine, taille, date du message).
    Du plus récent au plus ancien, sans doublon de chemin ; « Aucun document pour le moment… » seulement si les deux
    manquent. Ancienne lecture (avant 0006) : aucune pièce de message. Démo : à partir de `?demo=validation`
    (notice jointe par l'agence).
  - Impression (conditions générales, article 18 : la discussion s'imprime ou s'enregistre en PDF, chaque message
    avec sa date et son heure) : feuille `@media print` des pages à `.espace` (espace client, espace agence, page
    d'action, formulaire de rétractation ; pages vitrine inchangées), encre `#171512` sur papier blanc par les jetons
    (seule exception à la charte), sans barre de navigation, composeur ni boutons ; sans pied de page dans les espaces
    client et agence (il reste sur la page d'action et le formulaire de rétractation : l'imprimé d'une confirmation
    nomme l'agence, son adresse et son e-mail) ; « Message complet » imprimé s'il est ouvert, sans son intitulé ;
    dates et heures lisibles ; une bulle, une étape ou une ligne de document jamais coupée entre deux pages. Fiche en
    une colonne ; `dossier.js` montre tout le fil avant l'impression (`beforeprint`, et `matchMedia('print')` pour un
    navigateur qui passe à l'impression sans cet événement), comme « Afficher les messages précédents » : il reste
    entier ensuite.
  - Aucune autre action. Lien légal « Renoncer au contrat ici » dans le pied de page, sur toutes les vues (connecté
    ou non, quel que soit le dossier), vers le formulaire public `renoncer/` ; la fiche ne parle de rétractation
    qu'une fois celle-ci reçue (« Vous avez renoncé au contrat le … », sous l'étape en cours).
  - **Mode démo sans backend : `dossier/?demo`**, ou `?demo=signature`, `paiement`, `production`, `validation`,
    `suivi`, `clos` pour partir d'une étape, `retracte` pour une rétractation reçue (en local :
    http://localhost:3000/dossier/?demo ; avec `npx serve`, l'adresse `dossier/index.html` est redirigée et perd
    le paramètre) ; messages des deux côtés et étapes clés, et le composeur écrit dans les données de la démo.
- `site/action/` + `assets/js/action.js` : page d'action, ouverte par les liens des e-mails, sans connexion ni
  supabase-js (`fetch` vers la fonction `espace`, avec le jeton). Trois modes : signer le devis, valider les
  documents, et renoncer au contrat pour les anciens liens de rétractation (formulaire et formulaire type ; aucun
  n'est plus envoyé). Signature : case de démarrage anticipé (particulier), nom, puis, juste au-dessus du bouton et
  pour tous les clients, « En signant, vous acceptez nos conditions générales, jointes au devis. » (`textes.cgv` de
  la fonction ; la page garde une copie de secours de cette phrase et du bouton) ; ni information sur la
  rétractation ni formulaire type (dans les conditions générales du devis), ni lien de rétractation après la
  signature. Pied de page : « Renoncer au contrat ici », vers `renoncer/`. Le jeton est lu dans le fragment puis
  effacé de la barre d'adresse ; rien ne se fait sans clic. `noindex`, sans `Referer`.
  **Mode démo : `action/?demo=signer`** (particulier), ou `?demo=signer-pro`, `valider`, `renoncer` ; ses textes
  juridiques sont une copie de ceux de la fonction.
- `site/renoncer/` + `assets/js/renoncer.js` : formulaire public de rétractation (21 et 22 octobre 2026 ; L221-21 et
  D221-5 ; adresse `atomes.studio/renoncer/`, annoncée par les conditions générales, article 11.3 et annexe 1),
  ouvert par le lien « Renoncer au contrat ici » du pied de page de l'espace client, de la page d'action et de la
  page elle-même, ou directement ; sans connexion ni supabase-js. Champs : nom et prénom, numéro de dossier
  (12 chiffres), adresse e-mail de la demande, autre adresse pour l'accusé de réception (facultative) ; bouton
  « Confirmer la rétractation », puis une seule phrase (« Si vous avez demandé que la mission commence avant la fin
  du délai, un montant proportionné au travail déjà réalisé reste dû. ») ; ni motif ni étape de plus. Rien n'est lu au
  chargement ; au clic, formats contrôlés par la page (mêmes règles que la fonction ; message sous le premier champ
  invalide, qui reçoit le focus), puis `POST` JSON à `renoncer_formulaire` (`espaceUrl`, en-tête `apikey`, sans
  `Authorization`). Refus de la fonction (format, contrat introuvable, délai expiré) affichés tels quels sous le
  formulaire, contact@atomes.studio en lien, saisie gardée ; requête qui n'aboutit pas (réseau coupé ou requête
  bloquée), 401 (fonction antérieure, qui exige une session) et erreur du serveur : message d'échec, qui donne aussi
  contact@. Réussite : la confirmation remplace le formulaire (date et heure de réception à l'heure de Paris, dossier,
  nom ; accusé parti, ou « conservez cette page ») ; déjà reçue : « Votre rétractation était déjà enregistrée. ».
  Confirmation focalisée ; son haut caché sous la barre de navigation collante (zoom), elle défile juste sous la barre
  (de même sur la page d'action). Champs sans `name`, formulaire en méthode `dialog` (sans script, « Confirmer la
  rétractation » n'envoie rien et ne recharge pas la page : la saisie reste) ; nom, numéro et adresses jamais dans une
  URL, un stockage ni un journal. `noindex, nofollow`, sans `Referer`, hors sitemap ; même tête de page, barre de
  navigation et pied de page que la page d'action ; étiquette « Votre rétractation », mention « (facultatif) » et
  exemple d'adresse plus foncés qu'ailleurs sur le site (5,2:1). Lien du pied de page (`.footer .lien-legal`, sur ces
  trois pages seulement : ni pages vitrine, ni espace agence, ni e-mails) : texte du DOM « Renoncer au contrat ici »,
  en capitales par la feuille de style, souligné, contraste de 5,96:1, cible de 24 px de haut.
  **Mode démo : `renoncer/?demo`** (rétractation reçue simulée, aucune requête ; « Démonstration : rien n’a été envoyé. » à la place de l'accusé).
- `site/admin/` + `assets/js/admin.js` : espace agence (compte inscrit dans `admins`, même connexion par code que
  l'espace client). Liste filtrable (en cours, à traiter, clos), fiche : étapes (« Passer ici »), option de suivi,
  note pour le client, discussion, envoi du devis (PDF de 15 Mo au plus, refusé avant tout dépôt au-delà ; sous le
  choix du fichier, l'aide « Le devis doit contenir nos conditions générales, droit de rétractation et formulaire
  type compris. » ; un fichier par version,
  `<id>/agence/devis-<id>-<AAMMJJHHMMSS>.pdf`, jamais écrasé ; montant, libellé), état de la signature (démarrage
  anticipé, rétractation), référence et « Virement reçu », documents, demande de validation, pièces du client.
  Chaque opération reste attachée au dossier ouvert au moment du clic, même si une autre fiche est ouverte pendant
  l'envoi. Dates à l'heure de Paris.
  - Lecture : `*, etapes(*), evenements(*), messages(…)` avec toutes les colonnes des messages sauf
    `texte_complet`, lu une fois par message à l'ouverture de « Message complet » ; repli sur l'ancienne lecture
    avant la migration 0006 (PGRST200 ou 42703).
  - Discussion : même fil que l'espace client (messages à vérifier compris, en pointillés), avec « À vérifier »
    (raison, « Rattacher au dossier » ou « Supprimer »), « Traitement incomplet » (« Reprendre le traitement »),
    « En attente du moteur » (signature DKIM), badges « Nouveau », « E-mail non parti » (« Renvoyer l'e-mail ») et
    « Envoi en cours », mention « sans e-mail ». Composeur : texte, 10 pièces jointes PDF ou images de 50 Mo au plus,
    déposées d'abord dans `<id>/agence/discussion/` (réutilisées par un nouvel essai de même clé ; supprimées après
    un refus ou un changement du contenu, si aucun message ne les cite), puis `message_agence` ; case « Déjà envoyé
    depuis ma messagerie »
    (`sans_mail`) ; brouillon par dossier en mémoire, vidé après l'envoi et à la déconnexion ; note, montant,
    libellé et PDF du devis en cours de saisie jamais touchés par un envoi ni par une relecture. Pendant l'envoi, le
    bouton « Envoyer au client » est en `aria-disabled` (jamais `disabled` : il garde le focus ; un second envoi est
    refusé par la page). « Renvoyer l'e-mail » réussi : le badge « E-mail non parti » quitte la bulle aussitôt. La
    fenêtre du fil se souvient de la position de tri de son premier élément : elle ne se réduit pas quand cet élément
    disparaît (message supprimé).
  - Note pour le client : le dossier est relu juste avant l'écriture (comme le devis et « Virement reçu ») ; si son
    étape a changé ailleurs depuis l'affichage, rien n'est écrit, la saisie reste et la page annonce « L'étape du
    dossier a changé : rouvrez la fiche avant d'enregistrer la note. » (bandeau « Le dossier a changé »).
  - Une réponse (action, dépôt, note, devis, « Virement reçu », « Renvoyer l'e-mail ») arrivée après une déconnexion
    n'écrit rien dans la page.
  - Lu : la page envoie `messages_lus` avec les id des messages du client non lus dessinés dans le fil (100 au plus
    par appel ; les suivants après un succès seulement : après un échec, nouvel essai au prochain rendu ou au
    prochain focus, jamais d'appels sans fin), seulement onglet visible et fenêtre active (sinon au retour sur la
    fenêtre). Badge « Nouveau » fixé à l'ouverture de la fiche (complété par les relectures), jusqu'à ce qu'on la
    quitte.
  - Relectures : fiche affichée toutes les 30 s (onglet visible) et au retour sur l'onglet (fil et bandeau ; si
    l'étape, la signature, le paiement, la rétractation ou l'envoi du devis ont changé : fiche redessinée sans
    saisie en cours, sinon bandeau « Le dossier a changé ») ; liste affichée toutes les 60 s, redessinée seulement
    si elle change et jamais sous le focus. Situation de la liste : « Nouveau message », « E-mail non parti » ; à
    l'étape de traitement, « Nouvelle demande » tant que l'agence n'a rien écrit, puis « Réponse attendue » ou
    « Réponse reçue » selon l'auteur du dernier message ; pendant la validation, « Message du client » si le client
    a écrit le dernier depuis le début de l'étape, sinon « Validation attendue ».
  - **Mode démo : `admin/?demo`**, sept dossiers aux discussions cohérentes (e-mails, messages de l'espace,
    à vérifier, non lus, e-mail non parti, sans e-mail). Antoine Garcia : l'accusé de rétractation attend d'être
    renvoyé (quota d'e-mails du jour dépassé) ; tant qu'il ne l'est pas (« Renvoyer »), aucun e-mail ne part de ce
    dossier : un message écrit au client y reste « E-mail non parti ». « Rattacher » un message du moteur : le
    « moteur » de la démo le termine une minute plus tard.
- **Connexion par code** (19 octobre 2026, décision de Simon), espace client et espace agence : étape 1, l'adresse,
  `signInWithOtp({ email, options: { shouldCreateUser: false } })` (sans `emailRedirectTo` depuis la discussion), et
  Supabase envoie un code à usage unique (modèle « Magic link » = `emails/supabase-magic-link.html`, avec seulement
  `{{ .Token }}`, aucun lien) ;
  étape 2, le code saisi sur la page (espaces et tirets retirés, 6 à 10 chiffres acceptés),
  `verifyOtp({ email, token, type: 'email' })`, puis la suite habituelle (SIGNED_IN). Réglages Supabase : « Email OTP
  Length » = 6, « Email OTP Expiration » = 3600 ; un seul code valable à la fois (une nouvelle demande annule le
  précédent). Même affichage dans la page qu'une adresse ait un compte ou non, sauf dans un cas de « J'ai déjà un
  code » (plus bas) : à l'étape 1, l'envoi, une adresse inconnue (422) et un code redemandé moins d'une minute après le précédent
  (429 « For security purposes… », le précédent reste valable) mènent à la même étape 2 ; « Recevoir un nouveau code »
  moins d'une minute après le dernier envoi fait par la page répond « patientez une minute » sans appeler Supabase,
  pour toute adresse. L'API de Supabase, elle, distingue une adresse inconnue (422 contre 200, visible dans les outils
  du navigateur). Erreurs classées par `classer()`, dupliquée dans les deux pages. Étape 2 gardée dans
  `sessionStorage` (`atomes-connexion-dossier`, `atomes-connexion-admin` : adresse et heure de l'envoi, une heure au
  plus), pour l'onglet rechargé au retour de la messagerie ; oubliée à la connexion, à « Modifier l'adresse » et à la
  déconnexion, qui vide aussi l'adresse. « J'ai déjà un code » (étape 1), pour un code reçu quand l'étape 2 n'est pas
  dans l'onglet (navigateur intégré d'une messagerie refermé, autre onglet ou appareil) : étape 2 pour l'adresse
  saisie, sans aucun appel ni rien de mémorisé (un rechargement ramène à l'étape 1). Si la page vient d'envoyer un
  code à cette adresse (même onglet, casse ignorée), elle garde en mémoire l'heure de l'envoi et tient la minute comme
  d'habitude. Sinon (autre onglet ou appareil, onglet rechargé), « Recevoir un nouveau code » appelle Supabase
  aussitôt, et un compte s'y distingue d'une adresse inconnue (429 « For security purposes… » : « patientez une
  minute » ; 422 : notice « nouveau code »). Jamais le code dans une URL, un stockage, un attribut ou un journal. Ancien lien direct (`#connexion=<jeton>`, e-mails
  envoyés depuis le 19 octobre au soir, avant la connexion par code) : fragment retiré avant la création du client
  Supabase (`dossier/` garde `dossier=<id>` en `#<id>`), jeton jamais vérifié, message sur la page de connexion.
  Client Supabase créé avec `detectSessionInUrl: false` : un `#access_token` dans l'adresse (ancien modèle à lien)
  n'ouvre aucune session, seule la connexion par code en ouvre une ; un fragment portant `access_token=`,
  `refresh_token=` ou `type=magiclink|recovery|invite|signup` est en plus retiré de l'adresse (et de l'historique)
  avant la création du client, sans message, au chargement comme sur un changement de fragment ; sur `dossier/`, un
  lien expiré ou déjà utilisé
  (`#error_description`) garde son message. Après une connexion par code (jamais à un SIGNED_IN de retour sur
  l'onglet), le titre de la vue affichée reçoit le focus. Aucun lien ni code d'accès dans les e-mails des fonctions
  (lien simple vers `/dossier/`).
  Démo : après « Se déconnecter », tout code bien formé reconnecte.
- Un champ caché anti-robots (`_honey`) est présent dans les deux formulaires (devis et Contact). La page
  Contact ne charge pas config.js : elle envoie par FormSubmit dans tous les cas.
- `emails/` : la signature commune à tous les e-mails de l'agence (`signature.html`, à coller aussi dans le
  webmail) et le modèle Supabase du code de connexion (`supabase-magic-link.html`). La fonction `demande`
  embarque la même signature. Logo : `site/images/logo-signature.gif` (animation du logo d’après `<atom-logo>`, 120 px, boucle de 10 s, encre sombre sur fond blanc) ; `logo-signature.png` en est la version fixe et `logo-mail.png` l’ancien badge, à supprimer quand plus aucun e-mail envoyé n’y fait référence.

## Suite prévue

1. Moteur de l'agence : modules suivants (plans de situation et de masse, ArchiCAD 27), voir `atomes-moteur/README.md`.
1. Avis clients (quand la fiche Google existera).
2. Anti-spam (Cloudflare Turnstile) si nécessaire.
3. Textes juridiques du parcours (formulaire de rétractation compris), médiateur de la consommation, devis et
   conditions générales (rédigées le 21 octobre 2026 : à compléter, puis à imprimer à la fin de chaque devis, client
   professionnel compris, dès la mise en ligne de la rétractation par le formulaire public) : à faire valider par
   l'Ordre des architectes (SETUP-ESPACE-CLIENT.md, « Mises à jour à appliquer » et « À savoir »).
4. Tables `questions` et `modifications` : à supprimer quand le moteur 0.2.0 sera en service pour de bon (le retour
   à la 0.1.0, qui y écrit encore, n'est possible que tant qu'elles existent).
