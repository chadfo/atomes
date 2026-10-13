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
  contact.html             Formulaire de demande en huit écrans
  assets/css/site.css      Feuille de style commune : jetons de la charte + composants + pages
  assets/js/atom-logo.js   Logo animé <atom-logo> (à conserver tel quel)
  assets/js/projets.js     Accordéon et galeries de la page Projets
  assets/js/contact.js     Logique du formulaire (étapes, validation, envoi FormSubmit)
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
| contact.html | Formulaire en huit écrans | contact-photo |

Toutes les pages partagent : nav sticky (logo animé + 4 liens, lien actif `aria-current="page"` en blanc),
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
  `width:min(680px,58%)` (À propos, Contact) ou `min(620px,58%)` (Accueil, Projets).
- **Espacements** : padding horizontal des pages `clamp(20px,5vw,48px)` ; nav padding 24 px ; gaps de
  formulaire 22 px.

## Formulaire de contact (contact.html + assets/js/contact.js)

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
   largeur des surfaces, pour ne pas changer la hauteur commune des écrans ; elle se ferme par le « ? », Échap, un
   clic ou quand le focus part. En dessous de 980 px, elle s'insère sous le libellé. Les aides de l'écran suivant se fondent sur la surface habitable créée et sur l'emprise
   ajoutée (après projet moins existant).
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
`visibility:hidden`, écran actif `.is-on`) et prennent tous la hauteur du plus haut (l'écran Détails) : la section,
l'image et les boutons gardent la même place tout au long du formulaire. Le récapitulatif est positionné en absolu
dans cette hauteur et défile à l'intérieur, avec une barre fine et des voiles dégradés en haut et en bas
(`data-defile` posé par contact.js : haut, milieu, bas, aucun). En dessous de 980 px (image au-dessus, hauteur fixe),
les écrans s'affichent en flux normal, sans défilement interne.

Les précisions des choix « Autre » sont enregistrées dans `projets.precisions` (jsonb : type, bien, documents,
calendrier, source), affichées « Autre : … » dans les e-mails, l'objet du mail et l'espace client.
Les règles de cohérence vivent dans `contact.js` : `BIENS_PAR_TYPE` est dupliqué dans la fonction `demande`
(validation) ; la liste des surfaces (`SURFACES`, clés et libellés) l'est dans la fonction (e-mails) et dans
`dossier.js` (récapitulatif) : modifier les trois ensemble.

**Envoi** : si `config.js` est rempli, la fonction `demande` (dossier + espace client + e-mails), FormSubmit en
secours ; sinon FormSubmit seul (`POST https://formsubmit.co/ajax/contact@atomes.studio`, ou formulaire
multipart natif avec `_next = contact.html?envoye=1` s'il y a des pièces jointes). Champs envoyés sous leur
libellé français (voir `champs()`), plus `_template=table`, `_captcha=false`.
**Objet du mail** : `Nouveau projet — <Type> · <1er document> · <Commune> (<Nom>)`, format contractuel.

## Publication

Dépôt GitHub `chadfo/atomes` (public), domaine atomes.studio (DNS chez LWS, HTTPS forcé). Le dossier `site/`
est publié automatiquement par le workflow `.github/workflows/pages.yml` à chaque push sur `main` (Settings →
Pages → Source : « GitHub Actions »). Pour publier une modification : dans VS Code, panneau Source Control,
écrire un message, « Commit », puis « Sync Changes » ; la mise en ligne prend une à deux minutes (onglet
Actions du dépôt). Garder dans `site/` : `.nojekyll`, `CNAME` (contient `atomes.studio`), `robots.txt`,
`sitemap.xml`, `favicon.png`, l'image OG `a5ce3393-….png`, et les balises meta / OG de chaque page.

## Espace client (version 1)

Mise en place détaillée dans **SETUP-ESPACE-CLIENT.md**. Résumé :

- `supabase/migrations/0001_espace_client.sql` : tables `projets` (une ligne par demande, identifiant
  `AAMMJJHHMMSS` à l'heure de Paris, ex. `261012173615`), `modele_etapes` et `etapes` (timeline), `admins` ;
  règles de sécurité (un client ne voit que ses dossiers, l'agence voit tout) ; bucket privé `dossiers`
  (`<id>/client/` pièces du client, `<id>/agence/` documents fournis par l'agence).
- `supabase/functions/demande/index.ts` : fonction appelée par le formulaire. Crée le dossier, dépose les
  pièces, crée ou rattache le compte client (connexion par lien e-mail), envoie l'accusé de réception au
  client et la notification à l'agence (même objet `Nouveau projet — …` qu'avant) via Resend.
- `site/assets/js/config.js` : URL Supabase, clé anon, URL de la fonction. Vide = le formulaire envoie via
  FormSubmit comme avant ; rempli = fonction « demande », FormSubmit en secours si elle ne répond pas.
- `site/dossier/` + `assets/js/dossier.js` : connexion sans mot de passe, liste des dossiers, timeline,
  documents de l'agence (téléchargement par lien temporaire), dépôt de pièces par le client, récapitulatif
  de la demande. **Mode démo sans backend pour travailler le design : `dossier/?demo`** (en local :
  http://localhost:3000/dossier/?demo ; avec `npx serve`, l'adresse `dossier/index.html` est redirigée et perd
  le paramètre).
- Un champ caché anti-robots (`_honey`) est présent dans le formulaire.
- `emails/` : la signature commune à tous les e-mails de l'agence (`signature.html`, à coller aussi dans le
  webmail) et le modèle Supabase du lien de connexion (`supabase-magic-link.html`). La fonction `demande`
  embarque la même signature. Logo : `site/images/logo-signature.gif` (animation du logo d’après `<atom-logo>`, 120 px, boucle de 10 s, encre sombre sur fond blanc) ; `logo-signature.png` en est la version fixe et `logo-mail.png` l’ancien badge, à supprimer quand plus aucun e-mail envoyé n’y fait référence.

## Suite prévue

1. **Espace admin** (`site/admin/`) : liste des demandes, changement d'étape, dépôt des documents de
   l'agence, notes internes, sans passer par le tableau de bord Supabase.
2. Anti-spam (Cloudflare Turnstile) si nécessaire ; notifications au client à chaque changement d'étape.
