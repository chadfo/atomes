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
  assets/css/site.css      Feuille de style commune : jetons de la charte + composants + pages
  assets/js/atom-logo.js   Logo animé <atom-logo> (à conserver tel quel)
  assets/js/projets.js     Accordéon et galeries de la page Projets
  assets/js/contact.js     Page Contact (question devis, validation, envoi FormSubmit)
  assets/js/devis.js       Formulaire de devis (écrans, validation, envoi vers la fonction demande)
  images/                  Toutes les photos (.webp)
  favicon.png · a5ce3393-….png (image OG) · robots.txt · sitemap.xml · .nojekyll
_archive/claude-design/    Version d'origine produite avec Claude Design (référence, non publiée)
CLAUDE.md                  Instructions projet pour Claude Code
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
(`site.css?v=2`, `contact.js?v=2`…) et augmenter le numéro à la modification suivante du même genre : sinon,
pendant ces 10 minutes, un visiteur peut recevoir la nouvelle page avec l'ancien script.

## Publication

Dépôt GitHub `chadfo/atomes` (public), domaine atomes.studio (DNS chez LWS, HTTPS forcé). Le dossier `site/`
est publié automatiquement par le workflow `.github/workflows/pages.yml` à chaque push sur `main` (Settings →
Pages → Source : « GitHub Actions »). Pour publier une modification : dans VS Code, panneau Source Control,
écrire un message, « Commit », puis « Sync Changes » ; la mise en ligne prend une à deux minutes (onglet
Actions du dépôt). Garder dans `site/` : `.nojekyll`, `CNAME` (contient `atomes.studio`), `robots.txt`,
`sitemap.xml`, `favicon.png`, l'image OG `a5ce3393-….png`, et les balises meta / OG de chaque page.

## Espace client et espace agence (parcours v2)

Mise en place détaillée dans **SETUP-ESPACE-CLIENT.md**. Résumé :

- `supabase/migrations/0001_espace_client.sql` : tables `projets` (une ligne par demande, identifiant
  `AAMMJJHHMMSS` à l'heure de Paris, ex. `261012173615`), `modele_etapes` et `etapes` (timeline), `admins` ;
  règles de sécurité (un client ne voit que ses dossiers, l'agence voit tout) ; bucket privé `dossiers`
  (`<id>/client/` pièces du client, `<id>/agence/` documents fournis par l'agence).
- `supabase/functions/demande/index.ts` : fonction appelée par le formulaire de devis (devis.html). Crée le dossier, dépose les
  pièces, crée ou rattache le compte client (connexion par lien e-mail), envoie l'accusé de réception au
  client et la notification à l'agence (même objet `Nouveau projet — …` qu'avant) via Resend.
- `supabase/migrations/0004_parcours_client.sql` : parcours v2. 11 étapes (`modele_etapes`) : Demande reçue ·
  Traitement de votre demande (répondre aux questions) · Production de votre devis · Validation de votre devis
  (signer) · Paiement (payer par carte) · Production de vos documents · Validation de vos documents (valider ou
  demander une modification) · Dépôt, Suivi, Démarche administrative validée (option de suivi,
  `projets.suivi_administratif`, masquées sinon) · Dossier clos. Colonnes `optionnelle`, `instantanee` (étape
  faite dès qu'elle est atteinte, date seule) et `action` (questions, signer, payer, valider) ; statuts recalculés
  par `recalculer_etapes()` à chaque changement de `projets.etape` ou de l'option (refus si étape optionnelle
  sans l'option). Tables `questions` et `modifications` ; colonnes du devis, de la signature et du paiement dans
  `projets`. Le client lit, n'écrit jamais directement (fonction `espace`).
- `supabase/functions/espace/index.ts` : actions du client (`repondre`, `signer`, `payer`, `paiement`,
  `valider`, `modifier`) et de l'agence (`questions`, `devis`, `etape`, `option`, `paye`), webhook Stripe
  (`checkout.session.completed`, signature vérifiée, idempotent), e-mails Resend. « Verify JWT » désactivé :
  la session est vérifiée dans la fonction. Signature : case « bon pour accord », nom, date, IP, navigateur,
  empreinte SHA-256 du PDF recalculée au moment de signer. Paiement : Stripe Checkout, carte uniquement.
- `site/assets/js/config.js` : URL Supabase, clé anon, URL des fonctions `demande` (`apiUrl`) et `espace`
  (`espaceUrl`). Vide = le formulaire de devis envoie via FormSubmit comme avant ; rempli = fonction « demande »,
  FormSubmit en secours si elle ne répond pas.
- `site/dossier/` + `assets/js/dossier.js` : connexion sans mot de passe, liste des dossiers, timeline numérotée
  et datée (« Depuis le … » pour l'étape en cours), actions à l'étape en cours (questions, signature, paiement,
  validation ou modification), échanges (réponses, demandes de modification), documents de l'agence, dépôt de
  pièces, récapitulatif de la demande. **Mode démo sans backend : `dossier/?demo`**, ou `?demo=signature`,
  `paiement`, `production`, `validation`, `suivi`, `clos` pour partir d'une étape (en local :
  http://localhost:3000/dossier/?demo ; avec `npx serve`, l'adresse `dossier/index.html` est redirigée et perd
  le paramètre).
- `site/admin/` + `assets/js/admin.js` : espace agence (compte inscrit dans `admins`). Liste filtrable (en
  cours, à traiter, clos), fiche : étapes (« Passer ici »), option de suivi, note pour le client, questions (et
  retrait d'une question sans réponse), envoi du devis (un fichier par version, `<id>/agence/devis-<id>-<AAMMJJHHMMSS>.pdf`,
  jamais écrasé ; montant, libellé), état de la signature et du paiement, « Marquer comme payé », documents,
  demande de validation, modifications demandées. Chaque opération reste attachée au dossier ouvert au moment
  du clic, même si une autre fiche est ouverte pendant l'envoi.
  **Mode démo : `admin/?demo`**.
- Un champ caché anti-robots (`_honey`) est présent dans les deux formulaires (devis et Contact). La page
  Contact ne charge pas config.js : elle envoie par FormSubmit dans tous les cas.
- `emails/` : la signature commune à tous les e-mails de l'agence (`signature.html`, à coller aussi dans le
  webmail) et le modèle Supabase du lien de connexion (`supabase-magic-link.html`). La fonction `demande`
  embarque la même signature. Logo : `site/images/logo-signature.gif` (animation du logo d’après `<atom-logo>`, 120 px, boucle de 10 s, encre sombre sur fond blanc) ; `logo-signature.png` en est la version fixe et `logo-mail.png` l’ancien badge, à supprimer quand plus aucun e-mail envoyé n’y fait référence.

## Suite prévue

1. Avis clients (quand la fiche Google existera).
2. Anti-spam (Cloudflare Turnstile) si nécessaire.
