// Espace client — connexion sans mot de passe (lien e-mail), suivi du dossier : timeline numérotée et datée, actions
// du client à l'étape en cours (répondre aux questions, signer le devis, payer par carte, valider les documents ou
// demander une modification), échanges, documents de l'agence et pièces déposées (bucket privé « dossiers »).
// Les actions passent par la fonction « espace » (config.js : espaceUrl) ; le paiement par Stripe Checkout.
// Mode démo pour travailler le design sans backend : dossier/?demo, ou ?demo=signature, paiement, production,
// validation, suivi, clos (étape de départ).
(() => {
  const cfg = window.ATOMES_CONFIG || {};
  const params = new URLSearchParams(location.search);
  const demo = params.has('demo');
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const vues = {};
  $$('[data-vue]').forEach((v) => { vues[v.dataset.vue] = v; });
  const montrer = (nom) => { Object.keys(vues).forEach((k) => { vues[k].hidden = k !== nom; }); };
  const compte = $('[data-compte]');
  const erreur = (msg) => { const e = $('[data-erreur]'); e.textContent = msg || ''; e.hidden = !msg; };

  const el = (tag, cls, texte) => { const n = document.createElement(tag); if (cls) n.className = cls; if (texte !== undefined) n.textContent = texte; return n; };
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
  const fmtTaille = (o) => (o >= 1048576 ? (o / 1048576).toFixed(1).replace('.', ',') + ' Mo' : Math.max(1, Math.round(o / 1024)) + ' Ko');
  const euros = (c) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format((c || 0) / 100);
  // Surfaces du formulaire (même liste que devis.js et la fonction « demande ») : [colonne, libellé].
  const SURFACES = [['surface_existante', 'Surface habitable existante'], ['surface', 'Surface habitable créée'], ['emprise_existante', 'Emprise au sol du bâti existant'], ['emprise', 'Emprise au sol du bâti après projet'], ['surface_terrain', 'Surface de la parcelle']];
  const nomSur = (nom) => (nom.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 80) || 'fichier');
  const ECHEC = 'Action impossible pour le moment. Réessayez dans quelques minutes ou écrivez-nous à contact@atomes.studio.';

  // ---------- Accès aux données : Supabase, ou démo ----------
  const apiSupabase = () => {
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    const ok = (r) => { if (r.error) throw r.error; return r.data; };
    const urlEspace = cfg.espaceUrl || cfg.supabaseUrl.replace(/\/$/, '') + '/functions/v1/espace';
    return {
      surChangement: (fn) => sb.auth.onAuthStateChange((evt, session) => fn(session, evt)),
      connexion: (email) => sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname.replace(/index\.html$/, ''), shouldCreateUser: false } }).then(ok),
      deconnexion: () => sb.auth.signOut(),
      dossiers: () => sb.from('projets').select('*, etapes(*), questions(*), modifications(*)').order('cree_le', { ascending: false }).then(ok),
      lister: (id, dossier) => sb.storage.from('dossiers').list(id + '/' + dossier, { limit: 200, sortBy: { column: 'created_at', order: 'desc' } }).then(ok)
        .then((objets) => objets.filter((o) => o.name && !o.name.startsWith('.') && o.id)
          .map((o) => ({ nom: o.name, chemin: id + '/' + dossier + '/' + o.name, taille: (o.metadata && o.metadata.size) || 0, date: o.created_at }))),
      // Lien signé : téléchargement, ou lecture dans le navigateur (devis PDF)
      lien: (chemin, nom, lire) => sb.storage.from('dossiers').createSignedUrl(chemin, 600, lire ? undefined : { download: nom }).then(ok).then((d) => d.signedUrl),
      deposer: (id, fichier) => sb.storage.from('dossiers').upload(id + '/client/' + nomSur(fichier.name), fichier, { upsert: false, contentType: fichier.type || undefined }).then(ok),
      action: async (nom, projet, corps) => {
        const { data } = await sb.auth.getSession();
        const jeton = data && data.session ? data.session.access_token : '';
        let r;
        try {
          r = await fetch(urlEspace, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jeton, 'apikey': cfg.supabaseAnonKey },
            body: JSON.stringify(Object.assign({ action: nom, projet }, corps || {}))
          });
        } catch (ex) { throw new Error('Connexion impossible : vérifiez votre accès à Internet, puis réessayez.'); }
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) throw new Error(j.erreur || ECHEC);
        return j;
      }
    };
  };

  // Démo : même modèle d'étapes que la base (migration 0004), actions simulées sur place.
  const MODELE = [
    ['demande', 'Demande reçue', 'Votre demande nous est bien parvenue.', false, true, null],
    ['traitement', 'Traitement de votre demande', 'Nous étudions votre projet et pouvons vous poser quelques questions pour affiner votre demande.', false, false, 'questions'],
    ['devis', 'Production de votre devis', 'Nous préparons votre devis.', false, false, null],
    ['signature', 'Validation de votre devis', 'Votre devis est prêt : lisez-le, puis signez-le en ligne.', false, false, 'signer'],
    ['paiement', 'Paiement', 'Réglez par carte bancaire le montant indiqué pour lancer la production de vos documents.', false, false, 'payer'],
    ['production', 'Production de vos documents', 'Nous réalisons vos documents.', false, false, null],
    ['validation', 'Validation de vos documents', 'Vos documents sont prêts : vérifiez-les, puis validez-les ou demandez une modification.', false, false, 'valider'],
    ['depot', 'Dépôt de votre démarche administrative', 'Nous déposons votre dossier auprès du service instructeur.', true, false, null],
    ['instruction', 'Suivi de votre démarche administrative', 'Nous suivons l’instruction de votre dossier et répondons aux éventuelles demandes du service instructeur.', true, false, null],
    ['accordee', 'Démarche administrative validée', 'Votre démarche administrative est validée.', true, true, null],
    ['clos', 'Dossier clos', 'Votre dossier est terminé. Merci de votre confiance.', false, true, null]
  ];
  // Même règle que recalculer_etapes() en SQL : passées faites (datées), atteinte en cours (ou faite si instantanée).
  const recalculer = (p, maintenant) => {
    const o = p.etapes.find((e) => e.cle === p.etape).ordre;
    p.etapes.forEach((e) => {
      const visible = !e.optionnelle || p.suivi_administratif;
      if (e.ordre < o && visible) { e.statut = 'fait'; e.fait_le = e.fait_le || maintenant; e.debut_le = e.debut_le || e.fait_le; }
      else if (e.ordre === o) { if (e.statut !== 'en_cours') e.debut_le = maintenant; e.statut = e.instantanee ? 'fait' : 'en_cours'; e.fait_le = e.instantanee ? (e.fait_le || maintenant) : null; }
      else { e.statut = 'a_venir'; e.fait_le = null; e.debut_le = null; }
    });
  };

  const apiDemo = (scenario) => {
    const now = Date.now(), j = 86400000;
    const iso = (t) => new Date(t).toISOString();
    const DEVIS = '261003091422/agence/Devis-261003091422.pdf';
    const projet = {
      id: '261003091422', cree_le: iso(now - 12 * j), profil: 'Particulier', prenom: 'Jean', nom: 'Dupont', email: 'jean.dupont@exemple.fr',
      telephone: '06 12 34 56 78', type: 'Extension', documents: ['Déclaration préalable', 'Perspective'], adresse: '12 rue des Oliviers', commune: 'Hyères',
      code_postal: '83400', bien: 'Maison', surface: 25, surface_existante: 110, emprise_existante: 90, emprise: 115, surface_terrain: 600,
      calendrier: 'Dans 3 à 6 mois', message: 'Extension du séjour vers le jardin et réfection de la toiture.', source: 'Instagram',
      etape: 'traitement', suivi_administratif: false, devis_chemin: null, montant_cents: null, montant_libelle: null,
      signe_le: null, signe_nom: null, paye_le: null, documents_valides_le: null,
      etapes: MODELE.map((m, i) => ({ cle: m[0], ordre: i + 1, libelle: m[1], description: m[2], optionnelle: m[3], instantanee: m[4], action: m[5], statut: 'a_venir', fait_le: null, debut_le: null, note: null })),
      questions: [
        { id: 1, question: 'Souhaitez-vous vous occuper vous-même du dépôt de la déclaration préalable, ou que nous nous en chargions (supplément) ?', choix: ['Je m’en occupe', 'Vous vous en chargez'], reponse: null, commentaire: null, posee_le: iso(now - 10 * j), repondue_le: null },
        { id: 2, question: 'Disposez-vous des plans de la maison existante (papier ou PDF) ?', choix: null, reponse: null, commentaire: null, posee_le: iso(now - 10 * j), repondue_le: null }
      ],
      modifications: []
    };
    const docs = {
      agence: [],
      client: [
        { nom: '01-photos-facade.jpg', chemin: 'demo', taille: 2411520, date: projet.cree_le },
        { nom: '02-plan-existant.pdf', chemin: 'demo', taille: 655360, date: projet.cree_le }
      ]
    };
    const ordre = ['traitement', 'devis', 'signature', 'paiement', 'production', 'validation', 'suivi', 'clos'];
    const jusqua = ordre.indexOf(scenario === 'suivi' ? 'suivi' : scenario) >= 0 ? scenario : 'traitement';
    const avance = (cle, t) => { projet.etape = cle; recalculer(projet, iso(t)); };
    recalculer(projet, iso(now - 12 * j));
    const etapesDemo = ordre.slice(0, ordre.indexOf(jusqua) + 1);
    if (etapesDemo.includes('devis')) {
      projet.questions.forEach((q, i) => { q.reponse = i ? 'Oui, en PDF : je les dépose dans mon espace.' : 'Vous vous en chargez'; q.repondue_le = iso(now - 9 * j); });
      avance('devis', now - 8 * j);
    }
    if (etapesDemo.includes('signature')) {
      Object.assign(projet, { devis_chemin: DEVIS, montant_cents: 72000, montant_libelle: 'Acompte de 40 %' });
      docs.agence.push({ nom: 'Devis-261003091422.pdf', chemin: DEVIS, taille: 184320, date: iso(now - 6 * j) });
      avance('signature', now - 6 * j);
    }
    if (etapesDemo.includes('paiement')) { Object.assign(projet, { signe_le: iso(now - 5 * j), signe_nom: 'Jean Dupont' }); avance('paiement', now - 5 * j); }
    if (etapesDemo.includes('production')) { projet.paye_le = iso(now - 5 * j); avance('production', now - 5 * j); }
    if (etapesDemo.includes('validation')) {
      docs.agence.unshift({ nom: 'Plans-et-perspective-261003091422.pdf', chemin: 'demo', taille: 3145728, date: iso(now - j) });
      avance('validation', now - j);
    }
    if (jusqua === 'suivi') {
      projet.suivi_administratif = true; projet.documents_valides_le = iso(now - 20 * 3600000);
      avance('depot', now - 20 * 3600000); avance('instruction', now - 3600000);
    }
    if (jusqua === 'clos') { projet.documents_valides_le = iso(now - 20 * 3600000); avance('clos', now - 20 * 3600000); }

    let session = { user: { email: projet.email } };
    let ecouteur = null;
    const suivante = () => projet.etapes.find((e) => e.ordre > projet.etapes.find((x) => x.cle === projet.etape).ordre && (!e.optionnelle || projet.suivi_administratif)).cle;
    const actions = {
      repondre: (c) => {
        (c.reponses || []).forEach((r) => { const q = projet.questions.find((x) => x.id === r.id && !x.repondue_le); if (q) Object.assign(q, { reponse: r.reponse, commentaire: r.commentaire || null, repondue_le: new Date().toISOString() }); });
        return {};
      },
      signer: (c) => { Object.assign(projet, { signe_le: new Date().toISOString(), signe_nom: c.nom }); avance(suivante(), Date.now()); return {}; },
      payer: () => { projet.paye_le = new Date().toISOString(); avance(suivante(), Date.now()); return { paye: true }; },
      paiement: () => ({ paye: !!projet.paye_le }),
      valider: () => { projet.documents_valides_le = new Date().toISOString(); avance(suivante(), Date.now()); return {}; },
      modifier: (c) => { projet.modifications.push({ id: projet.modifications.length + 1, message: c.message, demandee_le: new Date().toISOString() }); avance('production', Date.now()); return {}; }
    };
    return {
      surChangement: (fn) => { ecouteur = fn; setTimeout(() => fn(session), 0); },
      connexion: () => Promise.resolve(),
      deconnexion: () => { session = null; ecouteur(null); return Promise.resolve(); },
      dossiers: () => Promise.resolve([JSON.parse(JSON.stringify(projet))]),
      lister: (_id, dossier) => Promise.resolve(docs[dossier].slice()),
      lien: () => Promise.resolve('#'),
      deposer: (_id, fichier) => { docs.client.unshift({ nom: nomSur(fichier.name), chemin: 'demo', taille: fichier.size, date: new Date().toISOString() }); return Promise.resolve(); },
      action: (nom, _projet, corps) => new Promise((res) => setTimeout(() => res(Object.assign({ ok: true }, actions[nom](corps || {}))), 250))
    };
  };

  let api;
  try {
    if (demo) api = apiDemo(params.get('demo'));
    else if (cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase) api = apiSupabase();
  } catch (ex) {
    $('[data-config-msg]').textContent = 'Configuration de l’espace client invalide : vérifiez l’adresse Supabase dans config.js.';
    montrer('config');
    return;
  }
  if (!api) {
    if (cfg.supabaseUrl && !window.supabase) $('[data-config-msg]').textContent = 'Le service de connexion est momentanément indisponible. Réessayez dans quelques minutes.';
    montrer('config');
    return;
  }

  // Retour d'un lien de connexion expiré ou déjà utilisé : Supabase renvoie l'erreur dans l'URL.
  const paramsHash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const erreurLien = paramsHash.get('error_description') || paramsHash.get('error') || params.get('error_description') || params.get('error');
  if (erreurLien) history.replaceState(null, '', location.pathname);
  // Retour de Stripe : ?paiement=ok&session=cs_… ou ?paiement=annule (traité une fois le dossier ouvert).
  let retourPaiement = params.get('paiement');
  const sessionStripe = params.get('session') || '';
  if (retourPaiement) history.replaceState(null, '', location.pathname + (demo ? '?demo=' + (params.get('demo') || '') : '') + location.hash);

  // ---------- Connexion ----------
  const formConnexion = $('[data-form-connexion]');
  formConnexion.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = $('#e-email').value.trim();
    const err = $('#e-err');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err.textContent = 'Adresse email invalide'; err.hidden = false; $('#e-email').setAttribute('aria-invalid', 'true'); return; }
    err.hidden = true; $('#e-email').removeAttribute('aria-invalid');
    const btn = $('[data-btn-connexion]');
    btn.disabled = true; btn.textContent = 'Envoi…';
    api.connexion(email).then(() => {
      const z = $('[data-lien-envoye]');
      z.textContent = '';
      z.appendChild(document.createTextNode('Lien envoyé à '));
      z.appendChild(el('strong', '', email));
      z.appendChild(document.createTextNode('. Ouvrez l’e-mail et cliquez sur le lien pour accéder à votre espace. Pensez à vérifier vos courriers indésirables.'));
      z.classList.add('is-on');
    }).catch((ex) => {
      const msg = String((ex && ex.message) || '');
      console.warn('connexion :', msg);
      err.textContent = /signup|not allowed|user not found/i.test(msg)
        ? 'Aucun dossier n’est associé à cette adresse. Utilisez l’adresse indiquée dans votre demande, ou écrivez-nous à contact@atomes.studio.'
        : /sending|smtp|mail/i.test(msg)
          ? 'L’envoi de l’e-mail de connexion a échoué de notre côté. Réessayez plus tard ou écrivez-nous à contact@atomes.studio.'
          : /rate limit|too many/i.test(msg)
            ? 'Trop de demandes de lien en peu de temps. Patientez quelques minutes avant de réessayer.'
            : 'Impossible d’envoyer le lien pour le moment. Réessayez dans quelques minutes.';
      err.hidden = false;
    }).finally(() => { btn.disabled = false; btn.textContent = 'Recevoir mon lien de connexion'; });
  });

  $('[data-deconnexion]').addEventListener('click', () => { api.deconnexion().then(() => { location.hash = ''; }); });

  // ---------- Dossiers ----------
  let dossiers = [];
  let courant = null;

  const etapeCourante = (d) => (d.etapes || []).find((e) => e.cle === d.etape);
  const enAttente = (d) => (d.questions || []).filter((q) => !q.repondue_le).sort((a, b) => new Date(a.posee_le) - new Date(b.posee_le));
  // Une action attend le client : questions sans réponse, devis à signer, paiement, documents à valider.
  const actionAttendue = (d) => {
    const e = etapeCourante(d);
    if (enAttente(d).length) return true;
    if (!e || e.statut !== 'en_cours') return false;
    return (e.action === 'signer' && d.devis_chemin && !d.signe_le) || (e.action === 'payer' && d.montant_cents && !d.paye_le) || e.action === 'valider';
  };

  const charger = () => api.dossiers().then((liste) => {
    dossiers = liste || [];
    erreur('');
    const voulu = location.hash.replace('#', '');
    const cible = dossiers.find((d) => d.id === voulu) || (dossiers.length === 1 ? dossiers[0] : null);
    if (cible) ouvrir(cible);
    else if (dossiers.length) rendreListe();
    else { montrer('liste'); $('[data-dossiers]').textContent = ''; $('[data-dossiers]').appendChild(el('p', 'docs-vide', 'Aucun dossier n’est associé à ce compte pour le moment.')); }
    if (retourPaiement && courant) traiterRetourPaiement();
  }).catch(() => { montrer('liste'); erreur('Impossible de charger vos dossiers. Réessayez dans quelques minutes.'); });

  // Après une action : données relues, même dossier rouvert, message annoncé.
  const recharger = (id, message) => api.dossiers().then((liste) => {
    dossiers = liste || [];
    const d = dossiers.find((x) => x.id === id);
    if (d) ouvrir(d, true);
    if (message) annoncer(message);
  });

  const annoncer = (message) => {
    const n = $('[data-notice]');
    if (!n) return;
    n.textContent = message || '';
    n.hidden = !message;
    if (message) { n.focus({ preventScroll: true }); n.scrollIntoView({ block: 'nearest' }); }
  };

  const rendreListe = () => {
    const cont = $('[data-dossiers]');
    cont.textContent = '';
    dossiers.forEach((d) => {
      const a = el('a', 'dossier-card'); a.href = '#' + d.id;
      const g = el('div');
      g.appendChild(el('div', 'num', 'DOSSIER N° ' + d.id));
      g.appendChild(el('strong', '', d.type + ' · ' + d.commune));
      a.appendChild(g);
      const droite = el('div', 'dossier-etat');
      const e = etapeCourante(d);
      droite.appendChild(el('span', 'tl-date', e ? e.libelle : ''));
      if (actionAttendue(d)) droite.appendChild(el('span', 'tl-statut', 'Action attendue'));
      a.appendChild(droite);
      a.addEventListener('click', (ev) => { ev.preventDefault(); if (location.hash.replace('#', '') === d.id) ouvrir(d); else location.hash = d.id; });
      cont.appendChild(a);
    });
    montrer('liste');
  };

  const ouvrir = (d, garderMessage) => {
    courant = d;
    if (!garderMessage) annoncer('');
    $('[data-retour]').hidden = dossiers.length < 2;
    $('[data-d-num]').textContent = 'DOSSIER N° ' + d.id;
    $('[data-d-titre]').textContent = d.type + ' · ' + d.commune;
    $('[data-d-sous]').textContent = 'Demande du ' + fmtDate(d.cree_le) + (d.documents && d.documents.length ? ' · ' + d.documents.join(', ') : '');
    rendreTimeline(d);
    rendreEchanges(d);
    rendreRecap(d);
    montrer('dossier');
    rafraichirDocs();
  };

  $('[data-retour]').addEventListener('click', (e) => { e.preventDefault(); history.pushState(null, '', location.pathname + location.search); rendreListe(); });
  window.addEventListener('hashchange', () => {
    const d = dossiers.find((x) => x.id === location.hash.replace('#', ''));
    if (d) ouvrir(d); else if (dossiers.length > 1) rendreListe();
  });

  // ---------- Timeline : étapes visibles (sans l'option de suivi, les étapes 8 à 10 sont masquées) ----------
  const rendreTimeline = (d) => {
    const ol = $('[data-timeline]');
    ol.textContent = '';
    const visibles = (d.etapes || []).filter((e) => !e.optionnelle || d.suivi_administratif).sort((a, b) => a.ordre - b.ordre);
    visibles.forEach((e, i) => {
      const courante = e.cle === d.etape;
      const li = el('li', 'tl-' + e.statut + (courante ? ' tl-courante' : ''));
      if (courante) li.setAttribute('aria-current', 'step');
      li.appendChild(el('span', 'tl-mark'));
      const corps = el('div', 'tl-body');
      const titre = el('div', 'tl-title');
      titre.appendChild(el('span', 'tl-num', String(i + 1).padStart(2, '0')));
      titre.appendChild(document.createTextNode(e.libelle));
      corps.appendChild(titre);
      corps.appendChild(el('span', 'sr-only', e.statut === 'fait' ? 'Fait' : e.statut === 'en_cours' ? 'En cours' : 'À venir'));
      const resume = resumeEtape(d, e);
      let actions = null;   // panneau d'action : sous l'étape, sur toute la largeur (colonnes titre et date)
      if (courante) {
        if (e.note || e.description) corps.appendChild(el('p', 'tl-desc', e.note || e.description));
        if (e.statut === 'en_cours') {
          actions = panneauxActions(d, e);
          if (!actions) corps.appendChild(el('span', 'tl-statut', 'En cours'));
        }
      } else if (e.statut === 'fait' && resume) corps.appendChild(el('p', 'tl-desc', resume));
      li.appendChild(corps);
      li.appendChild(el('span', 'tl-date', e.statut === 'fait' ? fmtDate(e.fait_le) : e.statut === 'en_cours' ? (e.debut_le ? 'Depuis le ' + fmtDate(e.debut_le) : 'En cours') : ''));
      if (actions) li.appendChild(actions);
      ol.appendChild(li);
    });
  };

  // Rappel sous une étape terminée
  const resumeEtape = (d, e) => {
    if (e.action === 'signer' && d.signe_le) return 'Signé le ' + fmtDate(d.signe_le) + (d.signe_nom ? ' par ' + d.signe_nom : '') + '.';
    if (e.action === 'payer' && d.paye_le) return 'Payé le ' + fmtDate(d.paye_le) + (d.montant_cents ? ' : ' + euros(d.montant_cents) : '') + '.';
    if (e.action === 'valider' && d.documents_valides_le) return 'Validés le ' + fmtDate(d.documents_valides_le) + '.';
    return '';
  };

  // Actions du client à l'étape en cours (et questions sans réponse, quelle que soit l'étape)
  const panneauxActions = (d, e) => {
    const box = el('div', 'tl-action');
    const questions = enAttente(d);
    if (questions.length) box.appendChild(formQuestions(d, questions));
    if (e.action === 'signer') box.appendChild(panneauSignature(d));
    else if (e.action === 'payer') box.appendChild(panneauPaiement(d));
    else if (e.action === 'valider') box.appendChild(panneauValidation(d));
    return box.childNodes.length ? box : null;
  };

  let compteur = 0;
  const champErreur = () => { const n = el('div', 'f-err'); n.id = 'act-err-' + (++compteur); n.setAttribute('role', 'alert'); n.hidden = true; return n; };
  const boutons = (...liste) => { const n = el('div', 'form-actions'); liste.forEach((b) => n.appendChild(b)); return n; };
  const bouton = (texte, cls, type) => { const b = el('button', cls || 'btn', texte); b.type = type || 'button'; return b; };

  // Envoie une action ; succès : message et dossier relu ; échec : message d'erreur sous le panneau.
  const agir = (btn, err, nom, d, corps, merci) => {
    const texte = btn.textContent;
    btn.disabled = true; btn.textContent = 'Envoi…'; err.hidden = true;
    return api.action(nom, d.id, corps).then((j) => {
      if (j.url) { btn.textContent = 'Redirection…'; location.assign(j.url); return; }
      return recharger(d.id, merci);
    }).catch((ex) => {
      err.textContent = (ex && ex.message) || ECHEC; err.hidden = false;
      btn.disabled = false; btn.textContent = texte;
    });
  };

  const formQuestions = (d, liste) => {
    const f = el('form', 'questions'); f.noValidate = true;
    f.appendChild(el('p', 'tl-action-intro', liste.length > 1 ? 'Nous avons quelques questions pour affiner votre demande.' : 'Nous avons une question pour affiner votre demande.'));
    liste.forEach((q) => {
      const fs = el('fieldset', 'question');
      const lg = el('legend', 'question-txt', q.question); lg.id = 'q-txt-' + q.id;
      fs.appendChild(lg);
      if (q.choix && q.choix.length) {
        const g = el('div', 'choix');
        q.choix.forEach((c) => {
          const lab = el('label', 'choix-opt');
          const inp = el('input'); inp.type = 'radio'; inp.name = 'q-' + q.id; inp.value = c;
          lab.appendChild(inp); lab.appendChild(el('span', '', c));
          g.appendChild(lab);
        });
        fs.appendChild(g);
        const lbl = el('label', 'lbl', 'Précision '); lbl.htmlFor = 'q-com-' + q.id; lbl.appendChild(el('span', 'lbl-opt', '(facultatif)'));
        const ta = el('textarea', 'input'); ta.id = 'q-com-' + q.id; ta.name = 'c-' + q.id; ta.rows = 2; ta.maxLength = 5000;
        fs.appendChild(lbl); fs.appendChild(ta);
      } else {
        const ta = el('textarea', 'input'); ta.name = 'r-' + q.id; ta.rows = 3; ta.maxLength = 5000; ta.setAttribute('aria-labelledby', lg.id);
        ta.placeholder = 'Votre réponse';
        fs.appendChild(ta);
      }
      f.appendChild(fs);
    });
    const err = champErreur();
    const envoyer = bouton('Envoyer mes réponses', 'btn', 'submit');
    f.appendChild(err);
    f.appendChild(boutons(envoyer));
    f.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const reponses = liste.map((q) => {
        if (q.choix && q.choix.length) {
          const coche = f.querySelector('input[name="q-' + q.id + '"]:checked');
          return { id: q.id, reponse: coche ? coche.value : '', commentaire: f.elements['c-' + q.id].value.trim() };
        }
        return { id: q.id, reponse: f.elements['r-' + q.id].value.trim() };
      }).filter((r) => r.reponse);
      if (!reponses.length) { err.textContent = 'Répondez à au moins une question.'; err.hidden = false; return; }
      agir(envoyer, err, 'repondre', d, { reponses }, reponses.length < liste.length
        ? 'Merci, vos réponses sont envoyées. Vous pourrez répondre aux autres questions plus tard.'
        : 'Merci, vos réponses sont envoyées. Nous revenons vers vous rapidement.');
    });
    return f;
  };

  const ligneMontant = (libelle, d) => {
    const n = el('p', 'montant');
    n.appendChild(el('span', '', libelle + (d.montant_libelle ? ' · ' + d.montant_libelle : '')));
    n.appendChild(el('strong', '', euros(d.montant_cents)));
    return n;
  };

  const panneauSignature = (d) => {
    const box = el('div', 'action-bloc');
    if (!d.devis_chemin) { box.appendChild(el('p', 'tl-action-intro', 'Votre devis sera bientôt disponible.')); return box; }
    if (d.signe_le) { box.appendChild(el('p', 'tl-action-intro', 'Devis signé le ' + fmtDate(d.signe_le) + '. Merci.')); return box; }
    if (d.montant_cents) box.appendChild(ligneMontant('À régler à la signature', d));
    const lire = bouton('Lire le devis (PDF)', 'link-more');
    const errLire = champErreur();
    lire.addEventListener('click', () => {
      const fenetre = demo ? null : window.open('about:blank', '_blank');
      api.lien(d.devis_chemin, d.devis_chemin.split('/').pop(), true).then((url) => {
        if (!url || url === '#') { if (fenetre) fenetre.close(); return; }
        if (fenetre) fenetre.location.href = url; else location.assign(url);
      }).catch(() => { if (fenetre) fenetre.close(); errLire.textContent = 'Le devis ne peut pas être ouvert pour le moment.'; errLire.hidden = false; });
    });
    box.appendChild(lire); box.appendChild(errLire);
    const f = el('form', 'signature'); f.noValidate = true;
    const caseId = 'sig-ok-' + d.id, nomId = 'sig-nom-' + d.id;
    const lab = el('label', 'case'); lab.htmlFor = caseId;
    const cb = el('input'); cb.type = 'checkbox'; cb.id = caseId;
    lab.appendChild(cb); lab.appendChild(el('span', '', 'J’ai lu le devis et je l’accepte : bon pour accord.'));
    f.appendChild(lab);
    const champ = el('div', 'field');
    const lnom = el('label', 'lbl', 'Votre nom et prénom'); lnom.htmlFor = nomId;
    const inom = el('input', 'input'); inom.id = nomId; inom.autocomplete = 'name'; inom.maxLength = 120; inom.placeholder = (d.prenom + ' ' + d.nom).trim();
    champ.appendChild(lnom); champ.appendChild(inom);
    f.appendChild(champ);
    f.appendChild(el('p', 'f-hint', 'Votre signature électronique est enregistrée avec la date, l’heure et l’empreinte du devis. Vous recevez une confirmation par e-mail.'));
    const err = champErreur(); inom.setAttribute('aria-describedby', err.id);
    const signer = bouton('Signer le devis', 'btn', 'submit');
    f.appendChild(err); f.appendChild(boutons(signer));
    f.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (!cb.checked) { err.textContent = 'Cochez « bon pour accord » pour signer le devis.'; err.hidden = false; cb.focus(); return; }
      if (inom.value.trim().length < 3) { err.textContent = 'Saisissez votre nom et votre prénom.'; err.hidden = false; inom.focus(); return; }
      agir(signer, err, 'signer', d, { accepte: true, nom: inom.value.trim() }, 'Merci, votre devis est signé. Vous pouvez maintenant régler le paiement.');
    });
    box.appendChild(f);
    return box;
  };

  const panneauPaiement = (d) => {
    const box = el('div', 'action-bloc');
    if (d.paye_le) { box.appendChild(el('p', 'tl-action-intro', 'Paiement reçu le ' + fmtDate(d.paye_le) + '. Merci.')); return box; }
    if (!d.montant_cents) { box.appendChild(el('p', 'tl-action-intro', 'Le montant à régler vous sera communiqué prochainement.')); return box; }
    box.appendChild(ligneMontant('À régler', d));
    const err = champErreur();
    const payer = bouton('Payer par carte');
    payer.addEventListener('click', () => agir(payer, err, 'payer', d, {}, 'Paiement reçu, merci. Nous lançons la production de vos documents.'));
    box.appendChild(el('p', 'f-hint', 'Paiement par carte bancaire, sécurisé par Stripe. Vous revenez ensuite sur cette page.'));
    box.appendChild(err);
    box.appendChild(boutons(payer));
    return box;
  };

  const panneauValidation = (d) => {
    const box = el('div', 'action-bloc');
    box.appendChild(el('p', 'tl-action-intro', 'Vos documents sont disponibles plus bas, dans « Documents de l’agence ».'));
    const zone = el('div', 'action-bloc');
    const err = champErreur();
    const modifier = bouton('Demander une modification', 'btn btn--ghost');
    const valider = bouton('Valider mes documents');
    const choix = boutons(modifier, valider);
    const retour = () => { zone.textContent = ''; choix.hidden = false; err.hidden = true; };
    valider.addEventListener('click', () => {
      choix.hidden = true; zone.textContent = '';
      zone.appendChild(el('p', 'tl-action-intro', 'Confirmez-vous la validation de vos documents ?' + (d.suivi_administratif ? ' Nous préparerons ensuite le dépôt de votre démarche.' : ' Votre dossier sera alors clos.')));
      const annuler = bouton('Annuler', 'btn btn--ghost');
      const confirmer = bouton('Confirmer la validation');
      annuler.addEventListener('click', () => { retour(); valider.focus(); });
      confirmer.addEventListener('click', () => agir(confirmer, err, 'valider', d, {}, d.suivi_administratif
        ? 'Merci, vos documents sont validés. Nous préparons le dépôt de votre démarche.'
        : 'Merci, vos documents sont validés. Votre dossier est clos.'));
      zone.appendChild(err); zone.appendChild(boutons(annuler, confirmer));
      confirmer.focus();
    });
    modifier.addEventListener('click', () => {
      choix.hidden = true; zone.textContent = '';
      const f = el('form', 'questions'); f.noValidate = true;
      const id = 'modif-' + d.id;
      const lbl = el('label', 'lbl', 'Votre demande de modification'); lbl.htmlFor = id;
      const ta = el('textarea', 'input'); ta.id = id; ta.rows = 4; ta.maxLength = 5000; ta.placeholder = 'Ce que vous souhaitez modifier, et sur quel document';
      ta.setAttribute('aria-describedby', err.id);
      const champ = el('div', 'field'); champ.appendChild(lbl); champ.appendChild(ta);
      const annuler = bouton('Annuler', 'btn btn--ghost');
      const envoyer = bouton('Envoyer la demande', 'btn', 'submit');
      annuler.addEventListener('click', () => { retour(); modifier.focus(); });
      f.appendChild(champ); f.appendChild(err); f.appendChild(boutons(annuler, envoyer));
      f.addEventListener('submit', (ev) => {
        ev.preventDefault();
        if (ta.value.trim().length < 5) { err.textContent = 'Décrivez la modification souhaitée.'; err.hidden = false; ta.focus(); return; }
        agir(envoyer, err, 'modifier', d, { message: ta.value.trim() }, 'Votre demande de modification est envoyée. Nous reprenons vos documents et vous prévenons dès qu’ils sont prêts.');
      });
      zone.appendChild(f);
      ta.focus();
    });
    box.appendChild(choix);
    box.appendChild(zone);
    return box;
  };

  // Retour de Stripe : confirmation du paiement (le webhook l'enregistre aussi de son côté).
  const traiterRetourPaiement = () => {
    const etat = retourPaiement;
    retourPaiement = null;
    if (etat === 'annule') { annoncer('Paiement annulé : vous pouvez le régler quand vous le souhaitez.'); return; }
    if (etat !== 'ok' || !courant) return;
    const id = courant.id;
    let essais = 0;
    const verifier = () => api.action('paiement', id, { session: sessionStripe }).then((j) => {
      if (j.paye) return recharger(id, 'Paiement reçu, merci. Nous lançons la production de vos documents.');
      if (++essais < 4) { annoncer('Votre paiement est en cours de confirmation…'); setTimeout(verifier, 3000); }
      else annoncer('Votre paiement est en cours de confirmation. Rechargez la page dans quelques minutes ; vous recevrez aussi un e-mail.');
    }).catch(() => annoncer('Votre paiement est en cours de confirmation. Rechargez la page dans quelques minutes ; vous recevrez aussi un e-mail.'));
    verifier();
  };

  // ---------- Échanges : réponses aux questions et demandes de modification ----------
  const rendreEchanges = (d) => {
    const ul = $('[data-echanges]');
    if (!ul) return;
    ul.textContent = '';
    const items = [
      ...(d.questions || []).filter((q) => q.repondue_le).map((q) => ({ date: q.repondue_le, q })),
      ...(d.modifications || []).map((m) => ({ date: m.demandee_le, m }))
    ].sort((a, b) => new Date(b.date) - new Date(a.date));
    $('[data-bloc-echanges]').hidden = !items.length;
    items.forEach((it) => {
      const li = el('li');
      if (it.q) {
        li.appendChild(el('span', 'doc-meta', 'Question · répondue le ' + fmtDate(it.q.repondue_le)));
        li.appendChild(el('p', 'echange-q', it.q.question));
        li.appendChild(el('p', 'echange-r', it.q.reponse + (it.q.commentaire ? '\n' + it.q.commentaire : '')));
      } else {
        li.appendChild(el('span', 'doc-meta', 'Demande de modification · ' + fmtDate(it.m.demandee_le)));
        li.appendChild(el('p', 'echange-r', it.m.message));
      }
      ul.appendChild(li);
    });
  };

  const rendreRecap = (d) => {
    const dl = $('[data-recap]');
    dl.textContent = '';
    const m2 = (v) => (v === null || v === undefined || v === '' ? '' : v + ' m²');
    const prec = d.precisions || {};
    const aff = (v, cle) => (v === 'Autre' && prec[cle] ? 'Autre : ' + prec[cle] : v);
    [
      ['Profil', [d.profil, d.societe, d.activite].filter(Boolean).join(' · ')],
      ['Contact', [d.prenom + ' ' + d.nom, d.email, d.telephone].filter(Boolean).join(' · ')],
      ['Type de projet', aff(d.type, 'type')], ['Documents souhaités', (d.documents || []).map((x) => aff(x, 'documents')).join(', ')],
      ['Adresse', [d.adresse, [d.code_postal, d.commune].filter(Boolean).join(' ')].filter(Boolean).join(', ')],
      ['Référence cadastrale', d.cadastre], ['État actuel', aff(d.bien, 'bien')],
      ['Surfaces', SURFACES.filter((sf) => m2(d[sf[0]])).map((sf) => sf[1] + ' : ' + m2(d[sf[0]])).join('\n')], // une surface par ligne (dd en pre-line)
      ['Démarrage souhaité', aff(d.calendrier, 'calendrier')], ['Votre message', d.message]
    ].filter((r) => r[1]).forEach((r) => { dl.appendChild(el('dt', '', r[0])); dl.appendChild(el('dd', '', r[1])); });
  };

  // ---------- Documents ----------
  const rendreDocs = (ul, vide, liste) => {
    ul.textContent = '';
    vide.hidden = liste.length > 0;
    liste.forEach((f) => {
      const li = el('li');
      const g = el('div');
      g.appendChild(el('span', 'doc-name', f.nom));
      g.appendChild(el('span', 'doc-meta', [fmtTaille(f.taille), fmtDate(f.date)].filter(Boolean).join(' · ')));
      li.appendChild(g);
      const a = el('button', 'link-more', 'Télécharger');
      a.type = 'button'; a.setAttribute('aria-label', 'Télécharger ' + f.nom);
      a.addEventListener('click', () => {
        api.lien(f.chemin, f.nom).then((url) => { if (url && url !== '#') location.assign(url); }).catch(() => erreur('Téléchargement impossible pour le moment.'));
      });
      li.appendChild(a);
      ul.appendChild(li);
    });
  };

  const rafraichirDocs = () => {
    if (!courant) return;
    const id = courant.id;
    api.lister(id, 'agence').then((l) => rendreDocs($('[data-docs-agence]'), $('[data-vide-agence]'), l)).catch(() => erreur('Documents de l’agence indisponibles pour le moment.'));
    api.lister(id, 'client').then((l) => rendreDocs($('[data-docs-client]'), $('[data-vide-client]'), l)).catch(() => erreur('Vos documents sont indisponibles pour le moment.'));
  };

  const depot = $('[data-depot]');
  const depotErr = $('[data-depot-err]');
  const depotInfo = $('[data-depot-info]');
  depot.addEventListener('change', () => {
    const fichiers = Array.from(depot.files || []);
    depot.value = '';
    if (!courant || !fichiers.length) return;
    const refuses = fichiers.filter((f) => !/\.(jpe?g|png|gif|webp|heic|heif|pdf)$/i.test(f.name));
    const lourds = fichiers.filter((f) => f.size > 50 * 1024 * 1024);
    if (refuses.length || lourds.length) {
      depotErr.textContent = refuses.length ? 'Format non pris en charge (JPG, PNG, GIF, WEBP, HEIC et PDF uniquement) : ' + refuses.map((f) => f.name).join(', ') : 'Fichier trop lourd (50 Mo max) : ' + lourds.map((f) => f.name).join(', ');
      depotErr.hidden = false;
      return;
    }
    depotErr.hidden = true;
    depotInfo.textContent = 'Envoi en cours…';
    const resultats = [];
    fichiers.reduce((p, f) => p.then(() => api.deposer(courant.id, f).then(
      () => { resultats.push({ ok: true, nom: f.name }); },
      (ex) => { resultats.push({ ok: false, nom: f.name, doublon: /exists|duplicate/i.test(String(ex && ex.message)) }); }
    )), Promise.resolve())
      .then(() => {
        const n = resultats.filter((r) => r.ok).length;
        const ko = resultats.filter((r) => !r.ok);
        depotInfo.textContent = n ? n + ' fichier' + (n > 1 ? 's' : '') + ' déposé' + (n > 1 ? 's' : '') : 'Photos (JPG, PNG, WEBP, HEIC) et PDF, 50 Mo max par fichier';
        if (ko.length) {
          depotErr.textContent = 'Non déposé : ' + ko.map((r) => r.nom + (r.doublon ? ' (un fichier du même nom existe déjà, renommez-le)' : ' (échec, réessayez ou envoyez-le à contact@atomes.studio)')).join(', ');
          depotErr.hidden = false;
        }
      })
      .finally(rafraichirDocs);
  });

  // ---------- Session ----------
  let utilisateurCharge = null;
  api.surChangement((session, evt) => {
    if (evt === 'TOKEN_REFRESHED' || evt === 'USER_UPDATED') return;
    if (session && session.user) {
      compte.hidden = false;
      $('[data-compte-email]').textContent = session.user.email || '';
      if (utilisateurCharge !== (session.user.id || session.user.email)) { utilisateurCharge = session.user.id || session.user.email; charger(); }
    } else {
      utilisateurCharge = null;
      compte.hidden = true;
      courant = null;
      montrer('connexion');
      if (erreurLien) { const err = $('#e-err'); err.textContent = 'Ce lien a expiré ou a déjà été utilisé. Demandez un nouveau lien ci-dessous.'; err.hidden = false; }
    }
  });
})();
