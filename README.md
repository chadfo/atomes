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
  dossier/                 Espace client : consultation (timeline, documents, échanges, récapitulatif)
  admin/                   Espace agence
  action/                  Page d'action, ouverte par les liens des e-mails (signer, valider, renoncer)
  assets/css/site.css      Feuille de style commune : jetons de la charte + composants + pages
  assets/js/atom-logo.js   Logo animé <atom-logo> (à conserver tel quel)
  assets/js/projets.js     Accordéon et galeries de la page Projets
  assets/js/contact.js     Page Contact (question devis, validation, envoi FormSubmit)
  assets/js/devis.js       Formulaire de devis (écrans, validation, envoi vers la fonction demande)
  assets/js/config.js      Adresses Supabase et des fonctions (valeurs publiques, jamais de secret)
  assets/js/dossier.js     Espace client
  assets/js/admin.js       Espace agence
  assets/js/action.js      Page d'action
  images/                  Toutes les photos (.webp)
  favicon.png · a5ce3393-….png (image OG) · robots.txt · sitemap.xml · .nojekyll
supabase/migrations/       Schéma, règles de sécurité et timeline (0001 à 0005, dans l'ordre)
supabase/functions/        Fonctions demande (formulaire de devis) et espace (suivi du dossier, e-mails)
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
(`site.css?v=3`, `dossier.js?v=5`…) et augmenter le numéro à la modification suivante du même genre : sinon,
pendant ces 10 minutes, un visiteur peut recevoir la nouvelle page avec l'ancien script. Le numéro ne protège que
dans ce sens : GitHub Pages ignore `?v=` et sert toujours le fichier à jour. Une ancienne page encore en cache qui
redemande son script reçoit donc le nouveau (visiteur qui a rechargé la page peu avant la publication) et peut
rester sur « Chargement… » jusqu'à un rechargement.

## Publication

Dépôt GitHub `chadfo/atomes` (public), domaine atomes.studio (DNS chez LWS, HTTPS forcé). Le dossier `site/`
est publié automatiquement par le workflow `.github/workflows/pages.yml` à chaque push sur `main` (Settings →
Pages → Source : « GitHub Actions »). Pour publier une modification : dans VS Code, panneau Source Control,
écrire un message, « Commit », puis « Sync Changes » ; la mise en ligne prend une à deux minutes (onglet
Actions du dépôt). Garder dans `site/` : `.nojekyll`, `CNAME` (contient `atomes.studio`), `robots.txt`,
`sitemap.xml`, `favicon.png`, l'image OG `a5ce3393-….png`, et les balises meta / OG de chaque page.

## Espace client et espace agence (parcours v3)

Mise en place détaillée dans **SETUP-ESPACE-CLIENT.md**. Résumé :

**Parcours v3 (14 octobre 2026) : tout par e-mail.** Chaque étape importante est annoncée au client par e-mail,
avec la timeline de son dossier. Le client répond aux e-mails (sa réponse et ses pièces jointes s'ajoutent au
dossier), signe le devis et valide ses documents sur la page d'action ouverte par un lien reçu par e-mail, et paie
par virement, avec le numéro de dossier pour référence. L'espace client ne sert plus qu'à consulter. Pas de
Yousign ni de Stripe.

**Moteur de l'agence (19 octobre 2026).** Le client écrit à contact@atomes.studio (adresse de réponse de tous les
e-mails) ou à simon@atomes.studio. Le moteur, programme Python de l'ordinateur de l'agence (dossier
`atomes-moteur`, à côté de ce dépôt, jamais publié ; mode d'emploi dans son README), lit ces deux boîtes par IMAP
toutes les 5 minutes, sans rien y changer, et range les e-mails des clients dans leur dossier : `messages`
(`resend_id = imap:<Message-ID>`), pièces dans `<id>/client/`, réponses aux questions, demandes de modification.
Mêmes règles que la fonction `espace` (texte sans la citation, pièces, limites) ; vérification de l'expéditeur par
sa signature DKIM, contrôlée par le moteur. Le webhook Resend ne sert plus qu'aux réponses envoyées aux anciennes
adresses de dossier (`r.atomes.studio`), le temps de la transition.

- `supabase/migrations/0001_espace_client.sql` : tables `projets` (une ligne par demande, identifiant
  `AAMMJJHHMMSS` à l'heure de Paris, ex. `261012173615`), `modele_etapes` et `etapes` (timeline), `admins` ;
  règles de sécurité (un client ne voit que ses dossiers, l'agence voit tout) ; bucket privé `dossiers`
  (`<id>/client/` pièces du client, `<id>/agence/` documents fournis par l'agence).
- `supabase/functions/demande/index.ts` : fonction appelée par le formulaire de devis (devis.html). Crée le dossier, dépose les
  pièces, crée ou rattache le compte client (connexion par code reçu par e-mail), envoie l'accusé de réception au
  client (avec la timeline ; réponse à contact@) et la notification à l'agence (même objet
  `Nouveau projet — …` qu'avant) via Resend.
- `supabase/migrations/0004_parcours_client.sql` : parcours v2. 11 étapes (`modele_etapes`) : Demande reçue ·
  Traitement de votre demande (répondre aux questions) · Production de votre devis · Validation de votre devis
  (signer) · Paiement (par virement depuis la v3) · Production de vos documents · Validation de vos documents
  (valider ou demander une modification) · Dépôt, Suivi, Démarche administrative validée (option de suivi,
  `projets.suivi_administratif`, masquées sinon) · Dossier clos. Colonnes `optionnelle`, `instantanee` (étape
  faite dès qu'elle est atteinte, date seule) et `action` (questions, signer, payer, valider) ; statuts recalculés
  par `recalculer_etapes()` à chaque changement de `projets.etape` ou de l'option (refus si étape optionnelle
  sans l'option). Tables `questions` et `modifications` ; colonnes du devis, de la signature et du paiement dans
  `projets` (celles de Stripe, dont `paiement_session`, inutilisées depuis la v3). Le client lit, n'écrit jamais
  directement (fonction `espace`).
- `supabase/migrations/0005_parcours_email.sql` : parcours v3. Table `messages` (e-mails reçus du client :
  réponse sans la citation, texte complet, pièces jointes, vérifié ou non ; le client ne lit que les messages
  vérifiés de ses dossiers ; `traite` et `traitement_le` : traitement repris après une interruption) ; colonnes
  `demarrage_anticipe_le` et `demarrage_anticipe_texte` (case du particulier), `retracte_*` (rétractation) et
  `envois_echoues` (e-mail légal au client à renvoyer) dans `projets` ; texte de l'étape Paiement (virement).
  Storage : seule l'agence dépose depuis le site (politique « admin depose dans les dossiers ») ; les pièces du
  client arrivent par e-mail.
- `supabase/functions/espace/index.ts` : un seul fichier, comme `demande` (déploiement par copier-coller dans
  l'éditeur Supabase : petites fonctions utilitaires dupliquées, pas de module partagé). Quatre entrées :
  - actions de l'agence, avec sa session : `questions`, `devis` (PDF joint à l'e-mail, lien de signature),
    `etape` (lien de validation à l'étape « Validation de vos documents »), `option`, `paye` (« Virement reçu »),
    `rattacher` et `supprimer_message` (messages à vérifier ; `rattacher` reprend aussi un traitement interrompu ;
    message du moteur : marqué vérifié et à traiter, le moteur range ses pièces à son passage suivant),
    `renvoyer` (confirmation du contrat ou accusé de rétractation qui n'a pas pu partir) ; chaque action qui écrit
    au client renvoie `mail` (faux si l'e-mail n'est pas parti, ce que l'espace agence signale) ;
  - actions par lien, sans compte, avec le jeton reçu par e-mail : `infos`, `signer`, `valider`, `renoncer` ;
  - `infos_espace`, pour l'espace client, en lecture seule : coordonnées du virement, lien de rétractation ;
  - webhook Resend `email.received` (anciennes adresses de réponse, pendant la transition vers le moteur ;
    signature Svix vérifiée sur le corps brut) : l'e-mail est lu par l'API de
    Resend (clé `RESEND_RECEPTION_KEY` si la réception est dans un compte Resend à part, sinon `RESEND_API_KEY`),
    rattaché au dossier par son adresse de réponse et enregistré dans `messages`. Il est vérifié si son expéditeur
    est l'adresse du dossier (adresse simple, la même dans le champ `from` de Resend et dans l'en-tête From) et si
    Resend l'authentifie (DMARC « pass », ou DKIM « pass » : signature du domaine de cette adresse ; jamais SPF
    seul ni un en-tête écrit par l'expéditeur) : ses pièces jointes (images et PDF, 25 Mo ; pas les images
    intégrées de la citation ni les petits logos) vont dans `<id>/client/`, et il sert de réponse aux questions
    en attente et, à l'étape de validation, de demande de modification. Sinon, il attend la vérification de
    l'agence (« Rattacher au dossier » ou « Supprimer »). Traitement reprenable : un message vérifié est marqué
    traité à la fin ; une relivraison pendant le traitement reçoit 503, une erreur 500, et la tentative suivante
    de Resend reprend là où il s'est arrêté. Limites par dossier et par 24 h (30 messages, 20 à vérifier, 200 Mo
    de pièces), un avis « Message à vérifier » par heure au plus ; texte et HTML reçus analysés en temps linéaire.

  E-mails Resend : timeline du dossier dans chaque e-mail au client, adresse de réponse contact@ (`MAIL_AGENCE`), lien
  « Suivre mon dossier en ligne » ; liens d'action toujours vers `SITE_URL` (jamais vers l'origine de la
  requête). « Verify JWT » désactivé : session, jeton ou signature de Resend vérifiés dans la fonction.
  Signature : nom, date, IP (celle ajoutée par la plateforme, chaîne X-Forwarded-For gardée), navigateur, montant,
  empreinte SHA-256 du PDF recalculée au moment de signer ; particulier : case de démarrage anticipé obligatoire. Rétractation : 14 jours après la
  signature, prolongés jusqu'au premier jour ouvrable (week-end, jours fériés français) ; l'étape ne change pas.
  Les textes juridiques (case, bouton, information et formulaire de rétractation) viennent de cette fonction,
  pour les e-mails comme pour la page d'action, qui les reçoit d'elle.
- **Liens et adresses de réponse** (secret `JETON_SECRET`) : lien `https://atomes.studio/action/#t=<jeton>`,
  jeton = `base64url(JSON)` + `.` + `base64url(HMAC-SHA256)`, charge utile `{ a, p, e, d }` (action, dossier,
  expiration ; `d` : début de l'empreinte du devis pour signer, du contrat signé pour renoncer, soit
  `SHA-256(date de signature + empreinte du devis signé)`) ; placé dans le fragment, il n'est jamais envoyé au
  serveur des pages. Durées : signer 30 jours (un nouveau devis invalide les anciens liens), valider 90 jours,
  renoncer jusqu'à la fin du délai de rétractation (le lien d'un contrat précédent ne vaut plus). Ancienne adresse de
  réponse, encore reçue par le webhook pendant la transition : `d<id>-<mac>@<REPONSES_DOMAINE>` (`r.atomes.studio`),
  `mac` = 20 premiers caractères hexadécimaux de `HMAC-SHA256(JETON_SECRET, "reponse:" + id)`. Sans `JETON_SECRET` :
  pas de lien ; sans `REPONSES_DOMAINE` : le webhook n'ajoute plus rien.
- `site/assets/js/config.js` : URL Supabase, clé anon, URL des fonctions `demande` (`apiUrl`) et `espace`
  (`espaceUrl`, aussi pour la page d'action). Vide = le formulaire de devis envoie via FormSubmit comme avant ;
  rempli = fonction « demande », FormSubmit en secours si elle ne répond pas.
- `site/dossier/` + `assets/js/dossier.js` : consultation seule. Connexion sans mot de passe, par code reçu par
  e-mail (voir « Connexion par code » plus bas), liste des dossiers, timeline numérotée et datée (« Depuis le … »
  pour l'étape en cours), sous l'étape en cours une information
  (questions posées par e-mail, devis à signer depuis le lien reçu, montant, référence et coordonnées du virement,
  documents à valider, rétractation), échanges (questions et réponses, messages du client, demandes de
  modification), documents de l'agence et du client, récapitulatif de la demande. Aucune action, sauf le lien
  légal « Renoncer au contrat ici » vers la page d'action (particulier signé, pendant le délai). **Mode démo
  sans backend : `dossier/?demo`**, ou `?demo=signature`, `paiement`, `production`, `validation`, `suivi`,
  `clos` pour partir d'une étape, `retracte` pour une rétractation reçue (en local :
  http://localhost:3000/dossier/?demo ; avec `npx serve`, l'adresse `dossier/index.html` est redirigée et perd
  le paramètre).
- `site/action/` + `assets/js/action.js` : page d'action, ouverte par les liens des e-mails, sans connexion ni
  supabase-js (`fetch` vers la fonction `espace`, avec le jeton). Trois modes : signer le devis, valider les
  documents, renoncer au contrat. Le jeton est lu dans le fragment puis effacé de la barre d'adresse ; rien ne se
  fait sans clic. `noindex`, sans `Referer`. **Mode démo : `action/?demo=signer`** (particulier), ou
  `?demo=signer-pro`, `valider`, `renoncer` ; ses textes juridiques sont une copie de ceux de la fonction.
- `site/admin/` + `assets/js/admin.js` : espace agence (compte inscrit dans `admins`, même connexion par code que
  l'espace client). Liste filtrable (en cours, à traiter, clos), fiche : étapes (« Passer ici »), option de suivi,
  note pour le client, questions (et
  retrait d'une question sans réponse), messages du client (« À vérifier » : rattacher au dossier ou supprimer ;
  messages du moteur : « En attente du moteur », signature DKIM),
  envoi du devis (un fichier par version, `<id>/agence/devis-<id>-<AAMMJJHHMMSS>.pdf`, jamais écrasé ; montant,
  libellé), état de la signature (démarrage anticipé, rétractation), référence et « Virement reçu », documents,
  demande de validation, modifications demandées. Chaque opération reste attachée au dossier ouvert au moment
  du clic, même si une autre fiche est ouverte pendant l'envoi.
  **Mode démo : `admin/?demo`**.
- **Connexion par code** (19 octobre 2026, décision de Simon), espace client et espace agence : étape 1, l'adresse,
  `signInWithOtp({ email, options: { emailRedirectTo, shouldCreateUser: false } })`, et Supabase envoie un code à usage
  unique (modèle « Magic link » = `emails/supabase-magic-link.html`, avec seulement `{{ .Token }}`, aucun lien) ;
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
  `emailRedirectTo` reste pour un ancien modèle à lien (`#access_token`, traité par supabase-js). Aucun lien ni code
  d'accès dans les e-mails des fonctions (lien simple vers `/dossier/`).
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
3. Textes juridiques du parcours, médiateur de la consommation, devis et conditions générales : à faire valider
   par l'Ordre des architectes (SETUP-ESPACE-CLIENT.md, « À savoir »).
