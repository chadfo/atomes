# CLAUDE.md — atomes.studio

Site vitrine de l'agence d'architecture Atomes studio (Simon Charles, architecte HMONP, Toulon / Hyères). Quatre pages : index, projets, a-propos, contact. HTML statique + CSS + JS vanilla, sans build. Hébergé sur GitHub Pages, domaine atomes.studio. Lire README.md pour la structure, la charte et le contrat du formulaire.

## Règles
- Palette stricte : fond #171512, encre #ece7de, blanc #ffffff pour actif/hover, surfaces #1e1b17 (#221e19 au survol des projets), erreurs #d8896b. Pas d'autre couleur, pas d'arrondi, pas d'ombre.
- Typo : Archivo (titres, textes) + IBM Plex Mono (étiquettes en capitales, letter-spacing .12em). Google Fonts.
- Français, ton sobre. Ne pas réécrire les textes existants sans demande explicite.
- Responsive : nav hamburger < 640 px ; sections image/texte empilées < 980 px.
- Le formulaire de contact (huit écrans, récapitulatif avant envoi) envoie vers la fonction `demande`, FormSubmit en secours. Garder le format de l'objet du mail `Nouveau projet — Type · Document · Commune (Nom)` ; pour un choix « Autre », la valeur devient `Autre : précision`. Chaque choix fermé (type, état du bien, documents, démarrage, source) a une option « Autre » avec un champ de précision, enregistré dans `projets.precisions`. Les règles de cohérence type → état du bien → surfaces vivent dans `contact.js` : `BIENS_PAR_TYPE` est dupliqué dans la fonction `demande`, `surfacesPour` dans la fonction et dans `dossier.js` : modifier les trois ensemble, ainsi que les listes fermées (DOCS, CALENDRIERS, SOURCES). Pas de question sur le budget (choix de Simon).
- Garder .nojekyll, robots.txt, sitemap.xml, favicon.png, l'image OG et les meta de chaque page.
- Le logo `<atom-logo>` (site/assets/js/atom-logo.js) est à conserver tel quel.

## Code
- Pas de style inline : tout dans `site/assets/css/site.css` (jetons `:root`, composants partagés, puis une partie par page). Utiliser les jetons (`var(--ink)`, `rgba(var(--ink-rgb),.55)`, `var(--pad-x)`…).
- Pas de `box-sizing:border-box` global (la mise en page d'origine n'en a pas) ; le poser explicitement là où il faut.
- Images : `site/images/<nom>.webp`, avec `alt` descriptif, `width`/`height` et `loading="lazy"` hors premier écran. Galerie d'un projet : `<template>` en fin de section dans projets.html.
- JS : un fichier par page (`projets.js`, `contact.js`), chargé en `defer`, sans dépendance.
- `_archive/claude-design/` est la version d'origine (Claude Design) : référence uniquement, ne pas la modifier ni la publier.

## Démarrer
`npx serve site` puis ouvrir l'URL affichée. Rien à installer ni à compiler.

## Publication
Dépôt `chadfo/atomes`, branche `main` ; `site/` est déployé par `.github/workflows/pages.yml` (GitHub Actions) à chaque push. Commits en français ; ne pousser que sur demande de Simon.

## Espace client
- Backend : Supabase (Postgres + Auth par lien e-mail + Storage privé + Edge Function `demande`) et Resend pour les e-mails. Schéma et règles dans `supabase/migrations/`, fonction dans `supabase/functions/demande/index.ts`, guide dans SETUP-ESPACE-CLIENT.md.
- Identifiant de dossier : `AAMMJJHHMMSS` à l'heure de Paris, généré côté serveur (seconde suivante en cas de collision). Ne pas changer ce format.
- Fichiers : bucket privé `dossiers`, chemins `<id>/client/…` et `<id>/agence/…`. Jamais de bucket public, jamais la clé `service_role` dans `site/`.
- Front : `site/dossier/` + `assets/js/dossier.js` (supabase-js UMD depuis jsDelivr, version épinglée). Construire le DOM avec `textContent`, jamais `innerHTML` avec des données utilisateur. Mode démo : `?demo`.
- Le formulaire garde FormSubmit en secours : ne pas retirer ce chemin.

## État et suite
- Priorité 1 faite (octobre 2026) : images en vraies balises `<img>`, suppression de support.js / image-slot.js / JSON base64, styles extraits en CSS, formulaire et accordéon réécrits en JS vanilla.
- Espace client v1 écrit (octobre 2026), en attente de la configuration Supabase / Resend par Simon (voir SETUP-ESPACE-CLIENT.md) puis test de bout en bout.
- Suite : espace admin (`site/admin/`), notifications au client à chaque changement d'étape, anti-spam.
