// Page Contact — formulaire de demande en huit écrans, envoi vers la fonction « demande »
// (création du dossier et de l'espace client) avec FormSubmit en secours.
// Format de l'objet du mail contractuel : `Nouveau projet — <Type> · <1er document> · <Commune> (<Nom>)`.
(() => {
  const form = document.getElementById('demande');
  if (!form) return;

  const ENDPOINT_AJAX = 'https://formsubmit.co/ajax/contact@atomes.studio';
  const ENDPOINT_FORM = 'https://formsubmit.co/contact@atomes.studio';
  const MAX_BYTES = 10 * 1024 * 1024;
  const MAX_FICHIERS = 10;
  const EXT_OK = /\.(jpe?g|png|gif|webp|heic|heif|pdf)$/i;
  const cfg = window.ATOMES_CONFIG || {};
  const API = cfg.apiUrl ? cfg : null;

  const STEPS = ['Vous', 'Votre projet', 'Le lieu', 'Les surfaces', 'Vos besoins', 'Détails', 'Comment nous avez-vous connus', 'Récapitulatif'];
  const DERNIERE = STEPS.length - 1;

  // ---- Règles de cohérence : états possibles selon le type de projet (« Autre » toujours possible) ----
  const BIENS_PAR_TYPE = {
    'Construction': ['Terrain nu', 'Terrain bâti', 'Autre'],
    'Rénovation': ['Maison', 'Appartement', 'Local ou bâtiment pro', 'Annexe, dépendance ou garage', 'Autre'],
    'Extension': ['Maison', 'Appartement', 'Local ou bâtiment pro', 'Annexe, dépendance ou garage', 'Autre'],
    'Démolition': ['Maison', 'Local ou bâtiment pro', 'Annexe, dépendance ou garage', 'Autre'],
    'Aménagement intérieur': ['Maison', 'Appartement', 'Local ou bâtiment pro', 'Annexe, dépendance ou garage', 'Autre'],
    'Aménagement extérieur': ['Maison', 'Appartement', 'Local ou bâtiment pro', 'Terrain nu', 'Autre'],
    'Autre': ['Terrain nu', 'Terrain bâti', 'Maison', 'Appartement', 'Local ou bâtiment pro', 'Annexe, dépendance ou garage', 'Autre']
  };
  // Choix « Autre » → champ de précision (nom de l'input) ; la précision est obligatoire sauf pour la source.
  const AUTRE = { type: 'typeAutre', bien: 'bienAutre', docs: 'docsAutre', calendrier: 'calendrierAutre', source: 'sourceAutre' };

  // Surfaces demandées selon le type et l'état du bien : { cle, libelle, requis }.
  // Obligatoires : la surface qui détermine l'autorisation (créée pour une construction, existante pour une rénovation,
  // un aménagement intérieur ou une démolition, les deux pour une extension) ; jamais de terrain pour un appartement.
  const surfacesPour = (type, bien) => {
    const appart = bien === 'Appartement';
    const L = [];
    const add = (cle, libelle, requis) => L.push({ cle, libelle, requis });
    switch (type) {
      case 'Construction':
        add('surface', 'Surface créée', true);
        if (bien === 'Terrain bâti') add('surfaceExistante', 'Surface du bâti existant', false);
        add('emprise', 'Emprise au sol du projet', false);
        add('surfaceTerrain', 'Surface du terrain', false);
        break;
      case 'Extension':
        add('surfaceExistante', 'Surface existante', true);
        add('surface', 'Surface créée', true);
        add('emprise', 'Emprise au sol de l’extension', false);
        if (!appart) add('surfaceTerrain', 'Surface du terrain', false);
        break;
      case 'Rénovation':
      case 'Aménagement intérieur':
        add('surfaceExistante', 'Surface existante', true);
        add('surface', 'Surface créée, le cas échéant', false);
        break;
      case 'Aménagement extérieur':
        add('emprise', 'Surface aménagée (terrasse, piscine, abri…)', false);
        if (!appart) add('surfaceTerrain', 'Surface du terrain', false);
        break;
      case 'Démolition':
        add('surfaceExistante', 'Surface à démolir', true);
        if (!appart) add('surfaceTerrain', 'Surface du terrain', false);
        break;
      default:
        add('surfaceExistante', 'Surface existante', false);
        add('surface', 'Surface créée', false);
        add('emprise', 'Emprise au sol', false);
        if (!appart) add('surfaceTerrain', 'Surface du terrain', false);
    }
    return L;
  };
  const SURFACES = ['surface', 'surfaceExistante', 'emprise', 'surfaceTerrain'];

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const crea = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt !== undefined) n.textContent = txt; return n; };

  const el = {
    progress: $('.progress', form),
    bars: $$('.progress-bars span', form),
    stepNum: $$('[data-step-num]', form),
    stepTitle: $('[data-step-title]', form),
    steps: $$('.step', form),
    pro: $('[data-pro]', form),
    blocBien: $('[data-bloc-bien]', form),
    docHint: $('[data-doc-hint]', form),
    message: form.elements.message,
    recapFinal: $('[data-recap-final]', form),
    dropzone: $('.dropzone', form),
    fileInput: $('input[type="file"]', form),
    filesLabel: $('[data-files-label]', form),
    files: $('[data-files]', form),
    filesRefused: $('[data-files-refused]', form),
    back: $('[data-back]', form),
    next: $('[data-next]', form),
    submit: $('[data-submit]', form),
    sendErr: $('[data-send-err]', form),
    liveStatus: $('[data-live-status]', form),
    liveAlert: $('[data-live-alert]', form),
    apiNote: $('[data-api-note]'),
    sent: $('[data-sent]'),
    sentDossier: $('[data-sent-dossier]'),
    sentNum: $('[data-sent-num]'),
    sentMailOk: $('[data-sent-mail-ok]'),
    sentMailKo: $('[data-sent-mail-ko]'),
    sentCompteKo: $('[data-sent-compte-ko]'),
    sentFichiers: $('[data-sent-fichiers]'),
    sentFichiersListe: $('[data-sent-fichiers-liste]'),
    reset: $('[data-reset]')
  };

  const initial = () => ({
    step: 0, profil: 'Particulier', type: '', bien: '', docs: [], calendrier: '', source: '',
    fichiers: [], fichiersRefuses: '', survol: false, tried: false, sent: false, envoi: false, erreurEnvoi: '',
    dossier: '', mails: null, fichiersEchoues: [], compte: true
  });
  let s = initial();

  const val = (name) => (form.elements[name] ? form.elements[name].value : '');
  const surfacesActives = () => surfacesPour(s.type, s.bien);
  const estAutre = (g) => (g === 'docs' ? s.docs.includes('Autre') : s[g] === 'Autre');
  // Valeur affichée : « Autre : précision » quand le choix est « Autre »
  const aff = (v, g) => (v === 'Autre' && val(AUTRE[g]).trim() ? 'Autre : ' + val(AUTRE[g]).trim() : v);

  // ---- Validation, un écran à la fois ----
  const validate = (step) => {
    const e = {};
    const precision = (g) => { if (estAutre(g) && val(AUTRE[g]).trim().length < 2) e[AUTRE[g]] = 'Précisez votre choix'; };
    if (step === 0) {
      if (s.profil === 'Professionnel' && !val('societe').trim()) e.societe = 'Champ requis';
      if (!val('prenom').trim()) e.prenom = 'Champ requis';
      if (!val('nom').trim()) e.nom = 'Champ requis';
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(val('email'))) e.email = 'Adresse email invalide';
      if (val('telephone').trim() && val('telephone').replace(/\D/g, '').length < 10) e.telephone = 'Numéro invalide';
    }
    if (step === 1) {
      if (!s.type) e.type = 'Choisissez un type de projet';
      else { precision('type'); if (!s.bien) e.bien = 'Précisez l’état actuel du bien'; else precision('bien'); }
    }
    if (step === 2) {
      if (!val('adresse').trim()) e.adresse = 'Champ requis';
      if (!val('commune').trim()) e.commune = 'Champ requis';
      if (!/^\d{5}$/.test(val('codePostal').trim())) e.codePostal = '5 chiffres';
    }
    if (step === 3) {
      surfacesActives().forEach((sf) => {
        const v = val(sf.cle).trim();
        if (sf.requis && !(Number(v) > 0)) e[sf.cle] = 'Indiquez une surface approximative';
        else if (v && !(Number(v) >= 0)) e[sf.cle] = 'Nombre invalide';
      });
    }
    if (step === 4) {
      if (!s.docs.length) e.docs = 'Choisissez au moins un document';
      else precision('docs');
    }
    if (step === 5) {
      if (!s.calendrier) e.calendrier = 'Indiquez le démarrage souhaité';
      else precision('calendrier');
      if (val('message').trim().length < 10) e.message = 'Décrivez votre projet en quelques mots (10 caractères min.)';
      else if (val('message').length > 5000) e.message = '5 000 caractères maximum.';
      if (s.fichiers.reduce((a, f) => a + f.size, 0) > MAX_BYTES) e.fichiers = 'Pièces jointes trop lourdes — 10 Mo max au total.';
      if (s.fichiers.length > MAX_FICHIERS) e.fichiers = MAX_FICHIERS + ' pièces jointes maximum.';
    }
    return e;
  };

  // ---- Champs envoyés à FormSubmit (libellés français, objet contractuel) ----
  const champs = () => {
    const out = [];
    const add = (k, v) => { if (v !== undefined && v !== null && String(v).trim() !== '') out.push([k, String(v)]); };
    add('Profil', s.profil);
    if (s.profil === 'Professionnel') { add('Société', val('societe')); add('Activité', val('activite')); }
    add('Prénom', val('prenom')); add('Nom', val('nom')); add('email', val('email')); add('Téléphone', val('telephone'));
    add('Type de projet', aff(s.type, 'type')); add('État actuel du bien', aff(s.bien, 'bien'));
    add('Documents souhaités', s.docs.map((d) => aff(d, 'docs')).join(', '));
    add('Adresse du projet', val('adresse')); add('Commune', val('commune')); add('Code postal', val('codePostal')); add('Référence cadastrale', val('cadastre'));
    surfacesActives().forEach((sf) => add(sf.libelle + ' (m²)', val(sf.cle)));
    add('Démarrage souhaité', aff(s.calendrier, 'calendrier'));
    add('Message', val('message')); add('Source', aff(s.source, 'source'));
    add('_subject', 'Nouveau projet — ' + aff(s.type, 'type') + ' · ' + (s.docs[0] ? aff(s.docs[0], 'docs') : 'à définir') + ' · ' + val('commune') + ' (' + val('nom') + ')');
    add('_template', 'table'); add('_captcha', 'false');
    if (val('_honey')) add('_honey', val('_honey'));
    return out;
  };

  // ---- Pièces jointes ----
  const accepte = (f) => EXT_OK.test(f.name);
  const ajouterFichiers = (nouveaux) => {
    const acceptes = [], refuses = [];
    Array.from(nouveaux).forEach((f) => (accepte(f) ? acceptes : refuses).push(f));
    const cles = new Set(s.fichiers.map((f) => f.name + '|' + f.size));
    const ajout = acceptes.filter((f) => !cles.has(f.name + '|' + f.size));
    s.fichiers = s.fichiers.concat(ajout);
    s.fichiersRefuses = refuses.length ? 'Format non pris en charge (JPG, PNG, GIF, WEBP, HEIC et PDF uniquement) : ' + refuses.map((f) => f.name).join(', ') : '';
    s.survol = false;
    render();
  };

  // ---- Rendu ----
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Un bloc qui apparaît (société, état du bien, précision « Autre ») se révèle en douceur et entre dans la vue si besoin.
  const montrerBloc = (bloc, visible) => {
    if (!bloc || bloc.hidden === !visible) return;
    bloc.hidden = !visible;
    if (visible) {
      if (!reduceMotion) { bloc.classList.remove('is-new'); void bloc.offsetWidth; bloc.classList.add('is-new'); }
      if (bloc.getBoundingClientRect().bottom > window.innerHeight) bloc.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
    }
  };

  const setErr = (key, msg) => {
    $$('[data-err="' + key + '"]', form).forEach((n) => { n.textContent = msg || ''; n.hidden = !msg; });
    const inp = form.elements[key];
    if (inp && inp.setAttribute) { if (msg) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid'); }
  };

  // Sur grand écran, le récapitulatif défile dans la hauteur commune des écrans : on note où en est le défilement
  // (haut, milieu, bas, ou aucun s'il tient en entier) pour afficher les voiles dégradés qui signalent la suite.
  const majDefile = () => {
    const st = el.steps[DERNIERE];
    if (!st) return;
    const max = st.scrollHeight - st.clientHeight;
    st.dataset.defile = max <= 1 ? 'aucun' : st.scrollTop <= 1 ? 'haut' : st.scrollTop >= max - 1 ? 'bas' : 'milieu';
  };

  // Récapitulatif final : une section par écran, avec un bouton « Modifier »
  const rendreRecapFinal = () => {
    const cont = el.recapFinal;
    if (!cont) return;
    cont.textContent = '';
    const pro = s.profil === 'Professionnel';
    const sections = [
      ['Vous', 0, [
        ['Profil', [s.profil, pro ? val('societe') : '', pro ? val('activite') : ''].filter((x) => x && x.trim()).join(' · ')],
        ['Nom', (val('prenom') + ' ' + val('nom')).trim()], ['Email', val('email')], ['Téléphone', val('telephone')]]],
      ['Votre projet', 1, [['Type de projet', aff(s.type, 'type')], ['État actuel du bien', aff(s.bien, 'bien')]]],
      ['Le lieu', 2, [['Adresse', val('adresse')], ['Commune', [val('codePostal'), val('commune')].filter((x) => x.trim()).join(' ')], ['Référence cadastrale', val('cadastre')]]],
      ['Les surfaces', 3, surfacesActives().map((sf) => [sf.libelle, val(sf.cle).trim() ? val(sf.cle).trim() + ' m²' : ''])],
      ['Vos besoins', 4, [['Documents souhaités', s.docs.map((d) => aff(d, 'docs')).join(', ')]]],
      ['Détails', 5, [['Démarrage souhaité', aff(s.calendrier, 'calendrier')], ['Votre projet', val('message')], ['Pièces jointes', s.fichiers.map((f) => f.name).join(', ')]]],
      ['Comment nous avez-vous connus', 6, [['Source', aff(s.source, 'source')]]]
    ];
    sections.forEach(([titre, index, lignes]) => {
      const sec = crea('div', 'recap-sec');
      const head = crea('div', 'recap-sec-head');
      head.appendChild(crea('span', 'lbl', titre));
      const btn = crea('button', 'link-more', 'Modifier');
      btn.type = 'button'; btn.disabled = s.envoi; btn.setAttribute('aria-label', 'Modifier : ' + titre);
      btn.addEventListener('click', () => allerA(index));
      head.appendChild(btn);
      sec.appendChild(head);
      const pleines = lignes.filter((l) => l[1] && String(l[1]).trim());
      if (pleines.length) {
        const dl = crea('dl', 'recap-liste');
        pleines.forEach(([k, v]) => { dl.appendChild(crea('dt', '', k)); dl.appendChild(crea('dd', '', v)); });
        sec.appendChild(dl);
      } else sec.appendChild(crea('p', 'recap-vide', 'Non renseigné'));
      cont.appendChild(sec);
    });
  };

  const render = () => {
    const errs = s.tried ? validate(s.step) : {};
    const n = s.step + 1;

    form.hidden = s.sent;
    if (el.sent) el.sent.hidden = !s.sent;
    if (el.sentDossier) { el.sentDossier.hidden = !s.dossier; if (el.sentNum) el.sentNum.textContent = s.dossier; }
    const mailClient = !!(s.mails && s.mails.client);
    if (el.sentMailOk) el.sentMailOk.hidden = !mailClient || !s.compte;
    if (el.sentMailKo) el.sentMailKo.hidden = mailClient || !s.compte;
    if (el.sentCompteKo) el.sentCompteKo.hidden = s.compte;
    if (el.sentFichiers) {
      const fe = s.fichiersEchoues || [];
      el.sentFichiers.hidden = !fe.length;
      if (el.sentFichiersListe) el.sentFichiersListe.textContent = fe.join(', ');
    }
    if (el.apiNote) el.apiNote.hidden = !API;

    el.bars.forEach((b, i) => b.classList.toggle('is-on', i <= s.step));
    el.stepNum.forEach((x) => { x.textContent = '0' + n; });
    if (el.stepTitle) el.stepTitle.textContent = STEPS[s.step];
    el.steps.forEach((st, i) => { st.classList.toggle('is-on', i === s.step); });

    // Puces : sélection, et cohérence type → états possibles du bien
    const biensPossibles = BIENS_PAR_TYPE[s.type] || [];
    $$('.chip', form).forEach((c) => {
      const g = c.dataset.group, v = c.dataset.value;
      const on = g === 'docs' ? s.docs.includes(v) : s[g] === v;
      c.classList.toggle('is-on', on);
      c.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (g === 'bien') c.hidden = !biensPossibles.includes(v);
    });
    montrerBloc(el.pro, s.profil === 'Professionnel');
    if (form.elements.societe) form.elements.societe.toggleAttribute('aria-required', s.profil === 'Professionnel');
    montrerBloc(el.blocBien, !!s.type);
    Object.keys(AUTRE).forEach((g) => {
      const visible = estAutre(g) && (g !== 'bien' || !!s.type);
      montrerBloc($('[data-bloc-autre="' + g + '"]', form), visible);
      const inp = form.elements[AUTRE[g]];
      if (inp) inp.toggleAttribute('aria-required', visible && g !== 'source');
    });

    // Surfaces : seules celles du projet, dans l'ordre logique, libellés adaptés, mention « facultatif »
    const actives = surfacesActives();
    SURFACES.forEach((cle) => {
      const bloc = $('[data-surface="' + cle + '"]', form);
      const sf = actives.find((x) => x.cle === cle);
      bloc.hidden = !sf;
      bloc.className = 'field' + (sf ? ' ordre-' + (actives.indexOf(sf) + 1) : '');
      if (sf) {
        $('[data-lbl]', bloc).textContent = sf.libelle;
        $('[data-lbl-opt]', bloc).hidden = sf.requis;
      }
      if (form.elements[cle]) form.elements[cle].toggleAttribute('aria-required', !!(sf && sf.requis));
    });

    // Aide contextuelle sur les autorisations (surfaces actives seulement, seuils selon le type)
    const vActive = (cle) => (actives.some((x) => x.cle === cle) ? Number(val(cle)) || 0 : 0);
    const creee = vActive('surface'), empriseSol = vActive('emprise'), existante = vActive('surfaceExistante');
    const seuil = s.type === 'Construction' ? 20 : 40;
    const depasse = Math.max(creee, empriseSol) > seuil;
    const total150 = s.type !== 'Construction' && creee > 20 && existante + creee > 150;
    const dp = s.docs.includes('Déclaration préalable');
    const docHint = s.docs.includes('Je ne sais pas encore') ? "Pas d'inquiétude : nous déterminons ensemble l'autorisation nécessaire selon la surface créée et la zone du PLU."
      : dp && total150 ? 'Au-delà de 150 m² de surface totale après travaux, un permis de construire et le recours à un architecte sont obligatoires. Nous vérifierons avec vous.'
      : dp && depasse && s.type === 'Construction' ? 'Au-delà de 20 m² de surface ou d’emprise au sol, une construction neuve relève du permis de construire. Nous vérifierons avec vous.'
      : dp && depasse ? 'Au-delà de 40 m² créés (20 m² hors zone urbaine), un permis de construire est généralement requis. Nous vérifierons avec vous.'
      : s.docs.includes('Perspective') && s.docs.length === 1 ? 'Une perspective seule (image 3D de votre projet) ne nécessite pas de dossier administratif.'
      : s.docs.includes("Avis d'architecte / étude simple") && s.docs.length === 1 ? 'Une étude simple donne lieu à un rendez-vous et à une note d’avis, sans dossier administratif.'
      : s.docs.includes('Réalisation de plans') && s.docs.length === 1 ? 'Nous réalisons les plans (relevé de l’existant, état projeté) sans dossier administratif.' : '';
    if (el.docHint) { el.docHint.textContent = docHint; el.docHint.hidden = !docHint; }
    if (el.liveStatus && el.liveStatus.textContent !== docHint) el.liveStatus.textContent = docHint;

    const hasAuto = s.docs.some((d) => /Permis|Déclaration/.test(d));
    if (el.message) el.message.placeholder = hasAuto ? 'Programme souhaité (pièces, usages), contraintes connues, état de l’existant, échéances…' : 'Ce que vous imaginez, vos références, vos contraintes…';

    if (el.dropzone) el.dropzone.classList.toggle('is-over', s.survol);
    const nf = s.fichiers.length;
    if (el.filesLabel) el.filesLabel.textContent = nf ? nf + ' fichier' + (nf > 1 ? 's' : '') + ' sélectionné' + (nf > 1 ? 's' : '') : 'Aucun fichier sélectionné';
    if (el.files) {
      el.files.hidden = !nf;
      el.files.textContent = '';
      s.fichiers.forEach((f, i) => {
        const chip = crea('span', 'file-chip');
        chip.appendChild(crea('span', '', f.name));
        const btn = crea('button', '', '×');
        btn.type = 'button'; btn.setAttribute('aria-label', 'Retirer ' + f.name);
        btn.addEventListener('click', () => { s.fichiers = s.fichiers.filter((_, j) => j !== i); s.fichiersRefuses = ''; render(); });
        chip.appendChild(btn);
        el.files.appendChild(chip);
      });
    }
    if (el.filesRefused) { el.filesRefused.textContent = s.fichiersRefuses; el.filesRefused.hidden = !s.fichiersRefuses; }
    const alerte = [s.fichiersRefuses, s.erreurEnvoi].filter(Boolean).join(' ');
    if (el.liveAlert && el.liveAlert.textContent !== alerte) el.liveAlert.textContent = alerte;

    if (s.step === DERNIERE) { rendreRecapFinal(); majDefile(); }

    ['societe', 'prenom', 'nom', 'email', 'telephone', 'type', 'typeAutre', 'bien', 'bienAutre', 'adresse', 'commune', 'codePostal',
      'surface', 'surfaceExistante', 'emprise', 'surfaceTerrain', 'docs', 'docsAutre', 'calendrier', 'calendrierAutre', 'message', 'fichiers']
      .forEach((k) => setErr(k, errs[k]));

    if (el.back) { el.back.hidden = s.step === 0; el.back.disabled = s.envoi; }
    if (el.next) el.next.hidden = s.step === DERNIERE;
    if (el.submit) {
      el.submit.hidden = s.step !== DERNIERE;
      el.submit.disabled = s.envoi;
      el.submit.textContent = s.envoi ? 'Envoi en cours…' : 'Envoyer la demande';
    }
    if (el.sendErr) { el.sendErr.textContent = s.erreurEnvoi; el.sendErr.hidden = !s.erreurEnvoi; }
  };

  // ---- Navigation entre écrans ----
  const cibleDe = (cle) => (form.elements[cle] && form.elements[cle].focus ? form.elements[cle] : $('.chip[data-group="' + cle + '"]:not([hidden])', form));
  const allerA = (step) => {
    if (el.steps[step]) el.steps[step].scrollTop = 0; // récapitulatif : repartir du haut
    s.step = step; s.tried = false; render();
    if (el.progress && el.progress.getBoundingClientRect().top < 0) el.progress.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
    const premier = window.innerWidth > 640 ? $$('.step.is-on .input, .step.is-on .chip:not([hidden])', form).find((n) => n.getClientRects().length) : null;
    (premier || el.progress).focus({ preventScroll: true });
  };
  // Signale les erreurs de l'écran courant : messages, annonce vocale, focus sur la première.
  const signaler = (erreurs) => {
    s.tried = true; render();
    if (el.liveAlert) el.liveAlert.textContent = erreurs.length + (erreurs.length > 1 ? ' champs à corriger' : ' champ à corriger');
    const cible = cibleDe(erreurs[0]); if (cible) cible.focus();
  };
  const next = () => {
    const erreurs = Object.keys(validate(s.step));
    if (erreurs.length) { signaler(erreurs); return; }
    allerA(s.step + 1);
  };
  const back = () => allerA(s.step - 1);

  // ---- Envoi ----
  const submit = (e) => {
    e.preventDefault();
    // Entrée dans un champ d'un écran intermédiaire : écran suivant (l'envoi n'est possible qu'au récapitulatif).
    if (s.step !== DERNIERE) { next(); return; }
    if (s.envoi) return;
    // Sécurité : tous les écrans doivent être valides ; sinon retour au premier en défaut.
    const enDefaut = STEPS.map((_, i) => i).find((st) => Object.keys(validate(st)).length);
    if (enDefaut !== undefined) { allerA(enDefaut); signaler(Object.keys(validate(enDefaut))); return; }
    s.envoi = true; s.erreurEnvoi = ''; s.tried = false; render();
    if (API) { envoyerApi().then(traiterReponseApi, () => envoyerFormSubmit()); return; }
    envoyerFormSubmit();
  };

  // Envoi vers la fonction « demande » : crée le dossier, stocke les pièces, ouvre l'espace client, envoie les e-mails.
  // Résout avec la réponse JSON ; rejette seulement si la fonction est injoignable (réseau, 5xx, passerelle,
  // saturation, réponse illisible) : FormSubmit prend alors le relais, sans risque de double envoi.
  const envoyerApi = () => {
    const pro = s.profil === 'Professionnel';
    const fd = new FormData();
    ['prenom', 'nom', 'email', 'telephone', 'adresse', 'commune', 'codePostal', 'cadastre', 'message', '_honey']
      .forEach((k) => fd.append(k, val(k)));
    const actives = surfacesActives();
    SURFACES.forEach((k) => fd.append(k, actives.some((sf) => sf.cle === k) ? val(k) : ''));
    fd.append('societe', pro ? val('societe') : ''); fd.append('activite', pro ? val('activite') : '');
    fd.append('profil', s.profil); fd.append('type', s.type); fd.append('bien', s.bien);
    fd.append('calendrier', s.calendrier); fd.append('source', s.source);
    s.docs.forEach((d) => fd.append('docs', d));
    Object.keys(AUTRE).forEach((g) => fd.append(AUTRE[g], estAutre(g) ? val(AUTRE[g]) : ''));
    s.fichiers.forEach((f) => fd.append('fichiers', f, f.name));
    const headers = API.supabaseAnonKey ? { apikey: API.supabaseAnonKey, Authorization: 'Bearer ' + API.supabaseAnonKey } : {};
    return fetch(API.apiUrl, { method: 'POST', headers, body: fd }).then((r) => {
      if (r.status >= 500 || r.status === 401 || r.status === 403 || r.status === 404 || r.status === 429) throw new Error('fonction indisponible ' + r.status);
      return r.json().catch(() => { throw new Error('réponse illisible'); });
    });
  };

  const traiterReponseApi = (j) => {
    if (j && j.ok) {
      s.envoi = false; s.sent = true; s.dossier = j.id || ''; s.mails = j.mails || {}; s.fichiersEchoues = j.fichiers_echoues || []; s.compte = j.compte !== false;
      // L'agence n'a pas reçu la notification : on la double par FormSubmit (sans pièces, avec le numéro de dossier).
      if (j.id && j.mails && j.mails.agence === false) {
        const fd = new FormData();
        champs().filter(([k]) => k !== '_captcha').forEach(([k, v]) => fd.append(k, v));
        fd.append('Dossier', j.id);
        fetch(ENDPOINT_AJAX, { method: 'POST', headers: { 'Accept': 'application/json' }, body: fd }).catch(() => {});
      }
    } else if (j && j.erreur === 'Champs invalides') {
      // La fonction en ligne ne connaît pas encore ces valeurs (déploiement décalé) : FormSubmit prend le relais.
      envoyerFormSubmit();
      return;
    } else {
      s.envoi = false; s.erreurEnvoi = (j && j.erreur ? j.erreur + '. ' : '') + 'L’envoi a échoué. Réessayez ou écrivez-nous directement à contact@atomes.studio.';
    }
    render();
    if (s.sent && el.sent) el.sent.focus();
  };

  // Envoi historique via FormSubmit (sans backend configuré, ou en secours).
  const envoyerFormSubmit = () => {
    const liste = champs();

    if (s.fichiers.length) {
      // L'endpoint AJAX de FormSubmit ignore les fichiers : envoi natif multipart avec retour sur la page.
      const f = document.createElement('form');
      f.method = 'POST'; f.action = ENDPOINT_FORM; f.enctype = 'multipart/form-data'; f.style.display = 'none';
      liste.concat([['_next', location.origin + location.pathname + '?envoye=1']]).forEach(([k, v]) => {
        const inp = document.createElement('input'); inp.type = 'hidden'; inp.name = k; inp.value = v; f.appendChild(inp);
      });
      try {
        s.fichiers.forEach((file, i) => {
          const inp = document.createElement('input'); inp.type = 'file'; inp.name = 'attachment' + (i || '');
          const dt = new DataTransfer(); dt.items.add(file); inp.files = dt.files; f.appendChild(inp);
        });
      } catch (err) {
        s.envoi = false; s.erreurEnvoi = 'Ce navigateur ne permet pas de joindre des fichiers. Retirez les pièces jointes et envoyez-les ensuite à contact@atomes.studio.';
        render();
        return;
      }
      document.body.appendChild(f); f.submit();
      return;
    }

    const fd = new FormData();
    liste.filter(([k]) => k !== '_captcha').forEach(([k, v]) => fd.append(k, v));
    fetch(ENDPOINT_AJAX, { method: 'POST', headers: { 'Accept': 'application/json' }, body: fd })
      .then((r) => r.json()).then((res) => {
        if (res.success === 'true' || res.success === true) { s.envoi = false; s.sent = true; }
        else { s.envoi = false; s.erreurEnvoi = 'L’envoi a échoué. Réessayez ou écrivez-nous directement à contact@atomes.studio.'; }
        render();
        if (s.sent && el.sent) el.sent.focus();
      }).catch(() => {
        s.envoi = false; s.erreurEnvoi = 'L’envoi a échoué (connexion). Réessayez ou écrivez-nous directement à contact@atomes.studio.';
        render();
      });
  };

  // « Nouvelle demande » : état et champs vidés, retour au premier écran (avec son focus).
  const reset = () => { s = initial(); form.reset(); allerA(0); };

  // ---- Écouteurs ----
  const ORDRE_DOCS = $$('.chip[data-group="docs"]', form).map((c) => c.dataset.value);
  form.addEventListener('submit', submit);
  form.addEventListener('input', () => render());
  form.addEventListener('change', () => render());
  $$('.chip', form).forEach((c) => c.addEventListener('click', () => {
    const g = c.dataset.group, v = c.dataset.value;
    if (g === 'docs') { s.docs = s.docs.includes(v) ? s.docs.filter((x) => x !== v) : s.docs.concat(v); s.docs.sort((x, y) => ORDRE_DOCS.indexOf(x) - ORDRE_DOCS.indexOf(y)); }
    else if (g === 'source') s.source = s.source === v ? '' : v;
    else s[g] = v;
    if (g === 'type' && !(BIENS_PAR_TYPE[s.type] || []).includes(s.bien)) s.bien = '';
    render();
  }));
  if (el.steps[DERNIERE]) el.steps[DERNIERE].addEventListener('scroll', majDefile, { passive: true });
  window.addEventListener('resize', majDefile);
  if (el.next) el.next.addEventListener('click', next);
  if (el.back) el.back.addEventListener('click', back);
  if (el.reset) el.reset.addEventListener('click', reset);
  if (el.fileInput) el.fileInput.addEventListener('change', (e) => { ajouterFichiers(e.target.files); e.target.value = ''; });
  if (el.dropzone) {
    el.dropzone.addEventListener('dragover', (e) => { e.preventDefault(); if (!s.survol) { s.survol = true; render(); } });
    el.dropzone.addEventListener('dragleave', () => { s.survol = false; render(); });
    el.dropzone.addEventListener('drop', (e) => { e.preventDefault(); ajouterFichiers(e.dataTransfer.files); });
  }

  // Retour de FormSubmit après un envoi avec pièces jointes : afficher la confirmation et nettoyer l'URL.
  if (new URLSearchParams(location.search).get('envoye') === '1') {
    s.sent = true;
    history.replaceState(null, '', location.pathname);
  }
  render();
  if (s.sent && el.sent) el.sent.focus();
})();
