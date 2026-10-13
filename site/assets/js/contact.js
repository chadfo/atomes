// Page Contact — formulaire de demande en 3 étapes, envoi via FormSubmit.
// Comportement, libellés et format de l'objet du mail sont contractuels :
// `Nouveau projet — <Type> · <1er document> · <Commune> (<Nom>)`.
(() => {
  const form = document.getElementById('demande');
  if (!form) return;

  const ENDPOINT_AJAX = 'https://formsubmit.co/ajax/contact@atomes.studio';
  const ENDPOINT_FORM = 'https://formsubmit.co/contact@atomes.studio';
  const STEPS = ['Vous', 'Le projet', 'Détails'];
  const MAX_BYTES = 10 * 1024 * 1024;
  // Si config.js renseigne la fonction « demande », l'envoi crée le dossier et l'espace client ;
  // sinon (ou en cas de panne), envoi historique via FormSubmit.
  const cfg = window.ATOMES_CONFIG || {};
  const API = cfg.apiUrl ? cfg : null;
  const MAX_FICHIERS = 10;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const el = {
    bars: $$('.progress-bars span', form),
    stepNum: $$('[data-step-num]', form),
    stepTitle: $('[data-step-title]', form),
    steps: $$('.step', form),
    pro: $('[data-pro]', form),
    docHint: $('[data-doc-hint]', form),
    message: form.elements.message,
    recap1: $('[data-recap-1]', form),
    recap2: $('[data-recap-2]', form),
    dropzone: $('.dropzone', form),
    fileInput: $('input[type="file"]', form),
    filesLabel: $('[data-files-label]', form),
    files: $('[data-files]', form),
    filesRefused: $('[data-files-refused]', form),
    back: $('[data-back]', form),
    next: $('[data-next]', form),
    submit: $('[data-submit]', form),
    sendErr: $('[data-send-err]', form),
    sent: $('[data-sent]'),
    sentDossier: $('[data-sent-dossier]'),
    sentNum: $('[data-sent-num]'),
    sentMailOk: $('[data-sent-mail-ok]'),
    sentMailKo: $('[data-sent-mail-ko]'),
    sentFichiers: $('[data-sent-fichiers]'),
    sentFichiersListe: $('[data-sent-fichiers-liste]'),
    apiNote: $('[data-api-note]'),
    reset: $('[data-reset]')
  };

  const initial = () => ({
    step: 0, profil: 'Particulier', type: 'Construction', docs: [], bien: 'Terrain nu',
    fichiers: [], fichiersRefuses: '', survol: false, tried: false, sent: false, envoi: false, erreurEnvoi: '', dossier: '', mails: null, fichiersEchoues: []
  });
  let s = initial();

  const val = (name) => (form.elements[name] ? form.elements[name].value : '');

  // ---- Validation (par étape) ----
  const validate = (step) => {
    const e = {};
    if (step === 0) {
      if (s.profil === 'Professionnel' && !val('societe').trim()) e.societe = 'Champ requis';
      if (!val('prenom').trim()) e.prenom = 'Champ requis';
      if (!val('nom').trim()) e.nom = 'Champ requis';
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(val('email'))) e.email = 'Adresse email invalide';
      if (val('telephone').trim() && val('telephone').replace(/\D/g, '').length < 10) e.telephone = 'Numéro invalide';
    }
    if (step === 1) {
      if (!s.docs.length) e.docs = 'Choisissez au moins un document';
      if (!val('commune').trim()) e.commune = 'Champ requis';
      if (!val('adresse').trim()) e.adresse = 'Champ requis';
      if (!/^\d{5}$/.test(val('codePostal').trim())) e.codePostal = '5 chiffres';
      if (![val('surface'), val('surfaceExistante'), val('emprise'), val('surfaceTerrain')].some((v) => Number(v) > 0)) e.surface = 'Indiquez au moins une surface approximative';
    }
    if (step === 2) {
      if (val('message').trim().length < 10) e.message = 'Décrivez votre projet en quelques mots (10 caractères min.)';
      if (s.fichiers.reduce((a, f) => a + f.size, 0) > MAX_BYTES) e.fichiers = 'Pièces jointes trop lourdes — 10 Mo max au total.';
      if (s.fichiers.length > MAX_FICHIERS) e.fichiers = MAX_FICHIERS + ' pièces jointes maximum.';
    }
    return e;
  };

  // ---- Champs envoyés (libellés français, ordre et objet contractuels) ----
  const champs = () => {
    const out = [];
    const add = (k, v) => { if (v !== undefined && v !== null && String(v).trim() !== '' && v !== '—') out.push([k, String(v)]); };
    add('Profil', s.profil);
    if (s.profil === 'Professionnel') { add('Société', val('societe')); add('Activité', val('activite')); }
    add('Prénom', val('prenom')); add('Nom', val('nom')); add('email', val('email')); add('Téléphone', val('telephone'));
    add('Type de projet', s.type); add('Documents souhaités', s.docs.join(', '));
    add('Adresse du projet', val('adresse')); add('Commune', val('commune')); add('Code postal', val('codePostal')); add('Référence cadastrale', val('cadastre'));
    add('État actuel du projet', s.bien);
    add('Surface habitable créée (m²)', val('surface')); add('Surface habitable existante (m²)', val('surfaceExistante')); add('Emprise du projet (m²)', val('emprise')); add('Surface du terrain (m²)', val('surfaceTerrain'));
    add('Budget travaux', val('budget')); add('Démarrage souhaité', val('calendrier'));
    add('Message', val('message')); add('Source', val('source'));
    add('_subject', 'Nouveau projet — ' + s.type + ' · ' + (s.docs[0] || 'à définir') + ' · ' + val('commune') + ' (' + val('nom') + ')');
    add('_template', 'table'); add('_captcha', 'false');
    if (val('_honey')) add('_honey', val('_honey'));
    return out;
  };

  // ---- Pièces jointes ----
  const accepte = (f) => f.type.indexOf('image/') === 0 || f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
  const ajouterFichiers = (nouveaux) => {
    const acceptes = [], refuses = [];
    Array.from(nouveaux).forEach((f) => (accepte(f) ? acceptes : refuses).push(f));
    const cles = new Set(s.fichiers.map((f) => f.name + '|' + f.size));
    const ajout = acceptes.filter((f) => !cles.has(f.name + '|' + f.size));
    s.fichiers = s.fichiers.concat(ajout);
    s.fichiersRefuses = refuses.length ? 'Format non pris en charge (images et PDF uniquement) : ' + refuses.map((f) => f.name).join(', ') : '';
    s.survol = false;
    render();
  };

  // ---- Rendu ----
  const setErr = (key, msg) => {
    $$('[data-err="' + key + '"]', form).forEach((n) => { n.textContent = msg || ''; n.hidden = !msg; });
    const cibles = key === 'surface' ? ['surface', 'surfaceExistante', 'emprise', 'surfaceTerrain'] : [key];
    cibles.forEach((name) => {
      const inp = form.elements[name];
      if (!inp || !inp.setAttribute) return;
      if (msg) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid');
    });
  };

  const render = () => {
    const errs = s.tried ? validate(s.step) : {};
    const n = s.step + 1;

    form.hidden = s.sent;
    if (el.sent) el.sent.hidden = !s.sent;
    if (el.sentDossier) { el.sentDossier.hidden = !s.dossier; if (el.sentNum) el.sentNum.textContent = s.dossier; }
    const mailClient = !!(s.mails && s.mails.client);
    if (el.sentMailOk) el.sentMailOk.hidden = !mailClient;
    if (el.sentMailKo) el.sentMailKo.hidden = mailClient;
    if (el.sentFichiers) {
      const fe = s.fichiersEchoues || [];
      el.sentFichiers.hidden = !fe.length;
      if (el.sentFichiersListe) el.sentFichiersListe.textContent = fe.join(', ');
    }
    if (el.apiNote) el.apiNote.hidden = !API;

    el.bars.forEach((b, i) => b.classList.toggle('is-on', i <= s.step));
    el.stepNum.forEach((x) => { x.textContent = '0' + n; });
    if (el.stepTitle) el.stepTitle.textContent = STEPS[s.step];
    el.steps.forEach((st, i) => { st.hidden = i !== s.step; });

    $$('.chip', form).forEach((c) => {
      const g = c.dataset.group, v = c.dataset.value;
      const on = g === 'docs' ? s.docs.includes(v) : s[g] === v;
      c.classList.toggle('is-on', on);
      c.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if (el.pro) el.pro.hidden = s.profil !== 'Professionnel';

    const surface = val('surface');
    const docHint = s.docs.includes('Je ne sais pas encore') ? "Pas d'inquiétude : nous déterminons ensemble l'autorisation nécessaire selon la surface créée et la zone du PLU."
      : s.docs.includes('Déclaration préalable') && Number(surface) > 40 ? 'Au-delà de 40 m² créés (20 m² hors zone urbaine), un permis de construire est généralement requis. Nous vérifierons avec vous.'
      : s.docs.includes('Perspective') && s.docs.length === 1 ? 'Une perspective seule (image 3D de votre projet) ne nécessite pas de dossier administratif.' : '';
    if (el.docHint) { el.docHint.textContent = docHint; el.docHint.hidden = !docHint; }

    const hasAuto = s.docs.some((d) => /Permis|Déclaration/.test(d));
    if (el.message) el.message.placeholder = hasAuto ? 'Programme souhaité (pièces, usages), contraintes connues, état de l’existant, échéances…' : 'Ce que vous imaginez, vos références, vos contraintes…';

    if (el.recap1) el.recap1.textContent = s.profil + ' · ' + val('prenom') + ' ' + val('nom') + ' · ' + val('email');
    if (el.recap2) el.recap2.textContent = s.type + ' · ' + (s.docs.join(', ') || 'document à définir') + ' · ' + val('commune')
      + (surface ? ' · ' + surface + ' m² créés' : val('emprise') ? ' · ' + val('emprise') + ' m² d’emprise' : '');

    if (el.dropzone) el.dropzone.classList.toggle('is-over', s.survol);
    const nf = s.fichiers.length;
    if (el.filesLabel) el.filesLabel.textContent = nf ? nf + ' fichier' + (nf > 1 ? 's' : '') + ' sélectionné' + (nf > 1 ? 's' : '') : 'Aucun fichier sélectionné';
    if (el.files) {
      el.files.hidden = !nf;
      el.files.textContent = '';
      s.fichiers.forEach((f, i) => {
        const chip = document.createElement('span');
        chip.className = 'file-chip';
        chip.appendChild(document.createTextNode(f.name));
        const btn = document.createElement('button');
        btn.type = 'button'; btn.textContent = '×'; btn.setAttribute('aria-label', 'Retirer ' + f.name);
        btn.addEventListener('click', () => { s.fichiers = s.fichiers.filter((_, j) => j !== i); s.fichiersRefuses = ''; render(); });
        chip.appendChild(btn);
        el.files.appendChild(chip);
      });
    }
    if (el.filesRefused) { el.filesRefused.textContent = s.fichiersRefuses; el.filesRefused.hidden = !s.fichiersRefuses; }

    ['societe', 'prenom', 'nom', 'email', 'telephone', 'docs', 'commune', 'adresse', 'codePostal', 'surface', 'message', 'fichiers']
      .forEach((k) => setErr(k, errs[k]));

    if (el.back) el.back.hidden = s.step === 0;
    if (el.next) el.next.hidden = s.step === 2;
    if (el.submit) {
      el.submit.hidden = s.step !== 2;
      el.submit.disabled = s.envoi;
      el.submit.textContent = s.envoi ? 'Envoi en cours…' : 'Envoyer la demande';
    }
    if (el.sendErr) { el.sendErr.textContent = s.erreurEnvoi; el.sendErr.hidden = !s.erreurEnvoi; }
  };

  // ---- Navigation entre étapes ----
  const next = () => {
    if (Object.keys(validate(s.step)).length) { s.tried = true; render(); return; }
    s.step += 1; s.tried = false; render();
  };
  const back = () => { s.step -= 1; s.tried = false; render(); };

  // ---- Envoi ----
  const submit = (e) => {
    e.preventDefault();
    // Entrée dans un champ des étapes 1 ou 2 : pas d'envoi (le bouton « Envoyer » n'est actif qu'à l'étape 3).
    if (s.step !== 2) return;
    if (s.envoi) return;
    // Sécurité : toutes les étapes doivent être valides ; sinon retour à la première étape en défaut.
    const enDefaut = [0, 1, 2].find((st) => Object.keys(validate(st)).length);
    if (enDefaut !== undefined) { s.step = enDefaut; s.tried = true; render(); return; }
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
    ['prenom', 'nom', 'email', 'telephone', 'adresse', 'commune', 'codePostal', 'cadastre',
      'surface', 'surfaceExistante', 'emprise', 'surfaceTerrain', 'budget', 'calendrier', 'message', 'source', '_honey']
      .forEach((k) => fd.append(k, val(k)));
    fd.append('societe', pro ? val('societe') : ''); fd.append('activite', pro ? val('activite') : '');
    fd.append('profil', s.profil); fd.append('type', s.type); fd.append('bien', s.bien);
    s.docs.forEach((d) => fd.append('docs', d));
    s.fichiers.forEach((f) => fd.append('fichiers', f, f.name));
    const headers = API.supabaseAnonKey ? { apikey: API.supabaseAnonKey, Authorization: 'Bearer ' + API.supabaseAnonKey } : {};
    return fetch(API.apiUrl, { method: 'POST', headers, body: fd }).then((r) => {
      if (r.status >= 500 || r.status === 401 || r.status === 403 || r.status === 404 || r.status === 429) throw new Error('fonction indisponible ' + r.status);
      return r.json().catch(() => { throw new Error('réponse illisible'); });
    });
  };

  const traiterReponseApi = (j) => {
    if (j && j.ok) {
      s.envoi = false; s.sent = true; s.dossier = j.id || ''; s.mails = j.mails || {}; s.fichiersEchoues = j.fichiers_echoues || [];
      // L'agence n'a pas reçu la notification : on la double par FormSubmit (sans pièces, avec le numéro de dossier).
      if (j.id && j.mails && j.mails.agence === false) {
        const fd = new FormData();
        champs().filter(([k]) => k !== '_captcha').forEach(([k, v]) => fd.append(k, v));
        fd.append('Dossier', j.id);
        fetch(ENDPOINT_AJAX, { method: 'POST', headers: { 'Accept': 'application/json' }, body: fd }).catch(() => {});
      }
    } else {
      s.envoi = false; s.erreurEnvoi = (j && j.erreur ? j.erreur + '. ' : '') + 'L\u2019envoi a échoué. Réessayez ou écrivez-nous directement à contact@atomes.studio.';
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

  const reset = () => { s = initial(); form.reset(); render(); };

  // ---- Écouteurs ----
  form.addEventListener('submit', submit);
  form.addEventListener('input', () => render());
  form.addEventListener('change', () => render());
  $$('.chip', form).forEach((c) => c.addEventListener('click', () => {
    const g = c.dataset.group, v = c.dataset.value;
    if (g === 'docs') s.docs = s.docs.includes(v) ? s.docs.filter((x) => x !== v) : s.docs.concat(v);
    else s[g] = v;
    render();
  }));
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
