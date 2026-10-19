// Espace client (parcours v3) : consultation seule. Connexion sans mot de passe (lien e-mail), liste des dossiers,
// timeline numérotée et datée avec, sous l'étape en cours, une information en lecture seule (questions posées par
// e-mail, devis envoyé, virement attendu, documents à valider, rétractation), échanges (questions et réponses, messages
// du client reçus par e-mail, demandes de modification), documents de l'agence et du client (bucket privé « dossiers »),
// récapitulatif de la demande.
// Le client n'agit plus ici : il répond aux e-mails, signe le devis et valide ses documents depuis les liens reçus
// (page action/), paie par virement. Seule exception, imposée par la loi : le lien « Renoncer au contrat ici »
// (particulier, devis signé, dans le délai), qui mène à la page action/. Ce lien et les coordonnées bancaires viennent
// de l'action « infos_espace » de la fonction « espace » (lecture seule, config.js : espaceUrl).
// Mode démo sans backend : dossier/?demo, ou ?demo=signature, paiement, production, validation, suivi, clos (étape de
// départ), ou ?demo=retracte (rétractation reçue pendant le paiement).
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
  // Date limite « AAAA-MM-JJ » (dernier jour du délai de rétractation) : « mercredi 28 octobre 2026 ».
  const fmtLimite = (jour) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(jour || ''));
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '';
  };
  const fmtTaille = (o) => (o >= 1048576 ? (o / 1048576).toFixed(1).replace('.', ',') + ' Mo' : Math.max(1, Math.round((o || 0) / 1024)) + ' Ko');
  const euros = (c) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format((c || 0) / 100);
  // Adresse renvoyée par la fonction (lien de rétractation) : http(s) seulement.
  const urlSure = (u) => {
    if (!u) return '';
    try { const x = new URL(String(u), location.href); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch (ex) { return ''; }
  };
  // Surfaces du formulaire (même liste que devis.js et la fonction « demande ») : [colonne, libellé].
  const SURFACES = [['surface_existante', 'Surface habitable existante'], ['surface', 'Surface habitable créée'], ['emprise_existante', 'Emprise au sol du bâti existant'], ['emprise', 'Emprise au sol du bâti après projet'], ['surface_terrain', 'Surface de la parcelle']];

  // ---------- Accès aux données : Supabase, ou démo ----------
  const apiSupabase = () => {
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    const ok = (r) => { if (r.error) throw r.error; return r.data; };
    const urlEspace = cfg.espaceUrl || cfg.supabaseUrl.replace(/\/$/, '') + '/functions/v1/espace';
    const lire = (messages) => sb.from('projets').select('*, etapes(*), questions(*), modifications(*)' + (messages ? ', messages(*)' : ''))
      .order('cree_le', { ascending: false }).then(ok);
    return {
      surChangement: (fn) => sb.auth.onAuthStateChange((evt, session) => fn(session, evt)),
      connexion: (email) => sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname.replace(/index\.html$/, ''), shouldCreateUser: false } }).then(ok),
      deconnexion: () => sb.auth.signOut(),
      // Messages du client (migration 0005) ; table absente, avant la migration : dossiers lus sans eux.
      dossiers: () => lire(true).catch((e) => {
        if (e && (e.code === 'PGRST200' || /messages/.test(String(e.message || '')))) return lire(false);
        throw e;
      }),
      lister: (id, dossier) => sb.storage.from('dossiers').list(id + '/' + dossier, { limit: 200, sortBy: { column: 'created_at', order: 'desc' } }).then(ok)
        .then((objets) => objets.filter((o) => o.name && !o.name.startsWith('.') && o.id)
          .map((o) => ({ nom: o.name, chemin: id + '/' + dossier + '/' + o.name, taille: (o.metadata && o.metadata.size) || 0, date: o.created_at }))),
      // Lien signé de téléchargement (10 minutes)
      lien: (chemin, nom) => sb.storage.from('dossiers').createSignedUrl(chemin, 600, { download: nom }).then(ok).then((d) => d.signedUrl),
      // Coordonnées de virement et lien de rétractation : action « infos_espace » (lecture seule).
      infosEspace: async (projet) => {
        const { data } = await sb.auth.getSession();
        const jeton = data && data.session ? data.session.access_token : '';
        const r = await fetch(urlEspace, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jeton, 'apikey': cfg.supabaseAnonKey },
          body: JSON.stringify({ action: 'infos_espace', projet })
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) { const e = new Error(j.erreur || 'infos_espace'); e.statut = r.status; throw e; }
        return j;
      }
    };
  };

  // Démo : même modèle d'étapes que la base (migrations 0004 et 0005), données en lecture seule.
  const MODELE = [
    ['demande', 'Demande reçue', 'Votre demande nous est bien parvenue.', false, true, null],
    ['traitement', 'Traitement de votre demande', 'Nous étudions votre projet et pouvons vous poser quelques questions pour affiner votre demande.', false, false, 'questions'],
    ['devis', 'Production de votre devis', 'Nous préparons votre devis.', false, false, null],
    ['signature', 'Validation de votre devis', 'Votre devis est prêt : lisez-le, puis signez-le en ligne.', false, false, 'signer'],
    ['paiement', 'Paiement', 'Réglez par virement le montant indiqué, en précisant la référence de votre dossier.', false, false, 'payer'],
    ['production', 'Production de vos documents', 'Nous réalisons vos documents.', false, false, null],
    ['validation', 'Validation de vos documents', 'Vos documents sont prêts : vérifiez-les, puis validez-les ou demandez une modification.', false, false, 'valider'],
    ['depot', 'Dépôt de votre démarche administrative', 'Nous déposons votre dossier auprès du service instructeur.', true, false, null],
    ['instruction', 'Suivi de votre démarche administrative', 'Nous suivons l’instruction de votre dossier et répondons aux éventuelles demandes du service instructeur.', true, false, null],
    ['accordee', 'Démarche administrative validée', 'Votre démarche administrative est validée.', true, true, null],
    ['clos', 'Dossier clos', 'Votre dossier est terminé. Merci de votre confiance.', false, true, null]
  ];
  // Même règle que recalculer_etapes() en SQL : passées faites (datées), atteinte en cours (ou faite si instantanée) ;
  // sans l'option, les étapes optionnelles passées restent masquées et gardent leurs dates.
  const recalculer = (p, maintenant) => {
    const o = p.etapes.find((e) => e.cle === p.etape).ordre;
    p.etapes.forEach((e) => {
      const visible = !e.optionnelle || p.suivi_administratif;
      if (e.ordre < o && visible) { e.statut = 'fait'; e.fait_le = e.fait_le || maintenant; e.debut_le = e.debut_le || e.fait_le; }
      else if (e.ordre < o) e.statut = 'a_venir';
      else if (e.ordre === o) { if (e.statut !== 'en_cours') e.debut_le = maintenant; e.statut = e.instantanee ? 'fait' : 'en_cours'; e.fait_le = e.instantanee ? (e.fait_le || maintenant) : null; }
      else { e.statut = 'a_venir'; e.fait_le = null; e.debut_le = null; }
    });
  };

  const apiDemo = (scenario) => {
    const now = Date.now(), j = 86400000;
    const iso = (t) => new Date(t).toISOString();
    const ID = '261003091422';
    const DEVIS = ID + '/agence/devis-' + ID + '-261008101500.pdf';
    const projet = {
      id: ID, cree_le: iso(now - 12 * j), profil: 'Particulier', prenom: 'Jean', nom: 'Dupont', email: 'jean.dupont@exemple.fr',
      telephone: '06 12 34 56 78', type: 'Extension', documents: ['Déclaration préalable', 'Perspective'], adresse: '12 rue des Oliviers', commune: 'Hyères',
      code_postal: '83400', bien: 'Maison', surface: 25, surface_existante: 110, emprise_existante: 90, emprise: 115, surface_terrain: 600,
      calendrier: 'Dans 3 à 6 mois', message: 'Extension du séjour vers le jardin et réfection de la toiture.', source: 'Instagram',
      etape: 'traitement', suivi_administratif: false, devis_chemin: null, devis_envoye_le: null, montant_cents: null, montant_libelle: null,
      signe_le: null, signe_nom: null, demarrage_anticipe_le: null, paye_le: null, documents_valides_le: null, retracte_le: null,
      etapes: MODELE.map((m, i) => ({ cle: m[0], ordre: i + 1, libelle: m[1], description: m[2], optionnelle: m[3], instantanee: m[4], action: m[5], statut: 'a_venir', fait_le: null, debut_le: null, note: null })),
      questions: [
        { id: 1, question: 'Souhaitez-vous vous occuper vous-même du dépôt de la déclaration préalable, ou que nous nous en chargions (supplément) ?', choix: ['Je m’en occupe', 'Vous vous en chargez'], reponse: null, commentaire: null, posee_le: iso(now - 10 * j), repondue_le: null },
        { id: 2, question: 'Disposez-vous des plans de la maison existante (papier ou PDF) ?', choix: null, reponse: null, commentaire: null, posee_le: iso(now - 10 * j), repondue_le: null }
      ],
      modifications: [],
      // Réponses du client par e-mail (vérifiées), pièces jointes rangées dans <id>/client/
      messages: [
        { id: 1, projet_id: ID, recu_le: iso(now - 11 * j), expediteur: 'jean.dupont@exemple.fr', sujet: 'Re: Votre demande — dossier ' + ID,
          texte: 'Bonjour,\nJe vous envoie une photo du jardin, côté sud, là où se ferait l’extension.\nJean Dupont',
          pieces: [{ nom: '03-jardin-sud.jpg', chemin: 'demo', taille: 1887436 }], verifie: true, etape: 'traitement' }
      ]
    };
    const docs = {
      agence: [],
      client: [
        { nom: '03-jardin-sud.jpg', chemin: 'demo', taille: 1887436, date: iso(now - 11 * j) },
        { nom: '01-photos-facade.jpg', chemin: 'demo', taille: 2411520, date: projet.cree_le },
        { nom: '02-plan-existant.pdf', chemin: 'demo', taille: 655360, date: projet.cree_le }
      ]
    };
    const ordre = ['traitement', 'devis', 'signature', 'paiement', 'production', 'validation', 'suivi', 'clos'];
    const retracte = scenario === 'retracte';
    const jusqua = retracte ? 'paiement' : ordre.includes(scenario) ? scenario : 'traitement';
    const avance = (cle, t) => { projet.etape = cle; recalculer(projet, iso(t)); };
    recalculer(projet, iso(now - 12 * j));
    const etapesDemo = ordre.slice(0, ordre.indexOf(jusqua) + 1);
    if (etapesDemo.includes('devis')) {
      const texte = 'Bonjour,\nVous vous en chargez, merci.\nOui, j’ai les plans de la maison en PDF : je vous les joins.\nJean Dupont';
      projet.messages.push({ id: 2, projet_id: ID, recu_le: iso(now - 9 * j), expediteur: 'jean.dupont@exemple.fr', sujet: 'Re: Quelques questions sur votre dossier ' + ID,
        texte, pieces: [{ nom: '04-plans-maison.pdf', chemin: 'demo', taille: 1258291 }], verifie: true, etape: 'traitement' });
      docs.client.unshift({ nom: '04-plans-maison.pdf', chemin: 'demo', taille: 1258291, date: iso(now - 9 * j) });
      projet.questions.forEach((q) => { q.reponse = texte; q.repondue_le = iso(now - 9 * j); });
      avance('devis', now - 8 * j);
    }
    if (etapesDemo.includes('signature')) {
      Object.assign(projet, { devis_chemin: DEVIS, devis_envoye_le: iso(now - 6 * j), montant_cents: 72000, montant_libelle: 'Acompte de 40 %' });
      docs.agence.push({ nom: DEVIS.split('/').pop(), chemin: DEVIS, taille: 184320, date: iso(now - 6 * j) });
      avance('signature', now - 6 * j);
    }
    if (etapesDemo.includes('paiement')) {
      Object.assign(projet, { signe_le: iso(now - 5 * j), signe_nom: 'Jean Dupont', demarrage_anticipe_le: iso(now - 5 * j) });
      avance('paiement', now - 5 * j);
    }
    if (retracte) projet.retracte_le = iso(now - j);
    if (etapesDemo.includes('production')) { projet.paye_le = iso(now - 4 * j); avance('production', now - 4 * j); }
    if (etapesDemo.includes('validation')) {
      docs.agence.unshift({ nom: 'Plans-et-perspective-' + ID + '.pdf', chemin: 'demo', taille: 3145728, date: iso(now - j) });
      avance('validation', now - j);
    }
    if (jusqua === 'suivi') {
      projet.suivi_administratif = true; projet.documents_valides_le = iso(now - 20 * 3600000);
      avance('depot', now - 20 * 3600000); avance('instruction', now - 3600000);
    }
    if (jusqua === 'clos') { projet.documents_valides_le = iso(now - 20 * 3600000); avance('clos', now - 20 * 3600000); }

    let session = { user: { email: projet.email } };
    let ecouteur = null;
    // Délai de démonstration : 14 jours après la signature (le calcul réel, jours fériés compris, est fait par la fonction).
    const limite = () => new Date(new Date(projet.signe_le).getTime() + 14 * j).toISOString().slice(0, 10);
    return {
      surChangement: (fn) => { ecouteur = fn; setTimeout(() => fn(session), 0); },
      connexion: () => Promise.resolve(),
      deconnexion: () => { session = null; ecouteur(null); return Promise.resolve(); },
      dossiers: () => Promise.resolve([JSON.parse(JSON.stringify(projet))]),
      lister: (_id, dossier) => Promise.resolve(docs[dossier].slice()),
      lien: () => Promise.resolve('#'),
      infosEspace: () => new Promise((res) => setTimeout(() => res({
        ok: true,
        virement: projet.etape === 'paiement' && projet.montant_cents && !projet.paye_le
          ? { titulaire: 'Atomes studio (démo)', iban: 'FR76 XXXX XXXX XXXX XXXX XXXX XXX', bic: 'XXXXXXXXXXX', reference: ID } : null,
        renoncer: projet.signe_le && !projet.retracte_le ? { url: '../action/?demo=renoncer', date_limite: limite() } : null
      }), 150))
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
    // Même message qu'une adresse ait un dossier ou non (« Signups not allowed for otp » pour une adresse inconnue) :
    // la page ne révèle pas qui est client de l'agence.
    const envoye = () => {
      const z = $('[data-lien-envoye]');
      z.textContent = '';
      z.appendChild(document.createTextNode('Si un dossier est associé à '));
      z.appendChild(el('strong', '', email));
      z.appendChild(document.createTextNode(', un lien de connexion vient de lui être envoyé. Ouvrez l’e-mail et cliquez sur le lien pour accéder à votre espace. Pensez à vérifier vos courriers indésirables. Sans e-mail, utilisez l’adresse indiquée dans votre demande, ou écrivez-nous à contact@atomes.studio.'));
      z.classList.add('is-on');
    };
    api.connexion(email).then(envoye).catch((ex) => {
      const msg = String((ex && ex.message) || '');
      if (/signup|not allowed|user not found/i.test(msg)) { envoye(); return; }
      console.warn('connexion :', msg);
      err.textContent = /sending|smtp|mail/i.test(msg)
        ? 'L’envoi de l’e-mail de connexion a échoué de notre côté. Réessayez plus tard ou écrivez-nous à contact@atomes.studio.'
        : /rate limit|too many/i.test(msg)
          ? 'Trop de demandes de lien en peu de temps. Patientez quelques minutes avant de réessayer.'
          : 'Impossible d’envoyer le lien pour le moment. Réessayez dans quelques minutes.';
      err.hidden = false;
    }).finally(() => { btn.disabled = false; btn.textContent = 'Recevoir mon lien de connexion'; });
  });

  // Déconnexion : l'écran de connexion est affiché par l'événement de fin de session (branche sans session plus bas),
  // y compris pour une déconnexion faite dans un autre onglet.
  $('[data-deconnexion]').addEventListener('click', () => {
    api.deconnexion().then(() => { history.replaceState(null, '', location.pathname + location.search); });
  });

  // ---------- Dossiers ----------
  let dossiers = [];
  let courant = null;
  let utilisateurCharge = null;   // compte connecté (identifiant ; e-mail en démo)
  let infos = {};                 // réponses « infos_espace » par dossier, oubliées à chaque lecture des dossiers
  // Oubli des données affichées (déconnexion)
  const oublier = () => {
    dossiers = []; courant = null; infos = {};
    ['[data-dossiers]', '[data-timeline]', '[data-echanges]', '[data-recap]', '[data-docs-agence]', '[data-docs-client]', '[data-d-num]', '[data-d-titre]', '[data-d-sous]', '[data-renoncer]']
      .forEach((sel) => { const n = $(sel); if (n) n.textContent = ''; });
    $('[data-renoncer]').hidden = true;
    erreur('');
  };

  const etapeCourante = (d) => (d.etapes || []).find((e) => e.cle === d.etape);
  const enAttente = (d) => (d.questions || []).filter((q) => !q.repondue_le).sort((a, b) => new Date(a.posee_le) - new Date(b.posee_le));
  const particulier = (d) => d.profil !== 'Professionnel';
  // Le client a quelque chose à faire (par e-mail, depuis un lien reçu ou par virement) : questions sans réponse, devis
  // à signer, virement, documents à valider (à cette étape, une validation précédente ne compte plus : nouvelle demande).
  const actionAttendue = (d) => {
    if (d.retracte_le) return false;
    if (enAttente(d).length) return true;
    const e = etapeCourante(d);
    if (!e || e.statut !== 'en_cours') return false;
    return (e.cle === 'signature' && !!d.devis_chemin && !d.signe_le) || (e.cle === 'paiement' && !!d.montant_cents && !d.paye_le) || e.cle === 'validation';
  };

  const charger = () => api.dossiers().then((liste) => {
    if (!utilisateurCharge) return;   // déconnecté pendant la lecture
    dossiers = liste || [];
    infos = {};
    erreur('');
    const voulu = location.hash.replace('#', '');
    const cible = dossiers.find((d) => d.id === voulu) || (dossiers.length === 1 ? dossiers[0] : null);
    if (cible) ouvrir(cible);
    else if (dossiers.length) rendreListe();
    else { montrer('liste'); $('[data-dossiers]').textContent = ''; $('[data-dossiers]').appendChild(el('p', 'docs-vide', 'Aucun dossier n’est associé à ce compte pour le moment.')); }
  }).catch(() => { if (!utilisateurCharge) return; montrer('liste'); erreur('Impossible de charger vos dossiers. Réessayez dans quelques minutes.'); });

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

  const ouvrir = (d) => {
    courant = d;
    $('[data-retour]').hidden = dossiers.length < 2;
    $('[data-d-num]').textContent = 'DOSSIER N° ' + d.id;
    $('[data-d-titre]').textContent = d.type + ' · ' + d.commune;
    $('[data-d-sous]').textContent = 'Demande du ' + fmtDate(d.cree_le) + (d.documents && d.documents.length ? ' · ' + d.documents.join(', ') : '');
    rendreTimeline(d);
    rendreRenoncer(d, null);
    rendreEchanges(d);
    rendreRecap(d);
    montrer('dossier');
    rafraichirDocs();
    completer(d);
  };

  $('[data-retour]').addEventListener('click', (e) => { e.preventDefault(); history.pushState(null, '', location.pathname + location.search); rendreListe(); });
  window.addEventListener('hashchange', () => {
    if (!utilisateurCharge) return;
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
      let info = null;   // information sous l'étape en cours, sur toute la largeur (colonnes titre et date)
      if (courante) {
        // Rétractation reçue : la description générique de l'étape ne s'applique plus (la note de l'agence, si).
        const desc = e.note || (d.retracte_le ? '' : e.description);
        if (desc) corps.appendChild(el('p', 'tl-desc', desc));
        info = infoEtape(d, e);
        if (!info && e.statut === 'en_cours') corps.appendChild(el('span', 'tl-statut', 'En cours'));
      } else if (e.statut === 'fait' && resume) corps.appendChild(el('p', 'tl-desc', resume));
      li.appendChild(corps);
      li.appendChild(el('span', 'tl-date', e.statut === 'fait' ? fmtDate(e.fait_le) : e.statut === 'en_cours' ? (e.debut_le ? 'Depuis le ' + fmtDate(e.debut_le) : 'En cours') : ''));
      if (info) li.appendChild(info);
      ol.appendChild(li);
    });
  };

  // Rappel sous une étape terminée
  const resumeEtape = (d, e) => {
    if (e.cle === 'signature' && d.signe_le) return 'Signé le ' + fmtDate(d.signe_le) + (d.signe_nom ? ' par ' + d.signe_nom : '') + '.';
    if (e.cle === 'paiement' && d.paye_le) return 'Payé le ' + fmtDate(d.paye_le) + (d.montant_cents ? ' : ' + euros(d.montant_cents) : '') + '.';
    if (e.cle === 'validation' && d.documents_valides_le) return 'Validés le ' + fmtDate(d.documents_valides_le) + '.';
    return '';
  };

  const ligneMontant = (libelle, d) => {
    const n = el('p', 'montant');
    n.appendChild(el('span', '', libelle + (d.montant_libelle ? ' · ' + d.montant_libelle : '')));
    n.appendChild(el('strong', '', euros(d.montant_cents)));
    return n;
  };

  // Information en lecture seule sous l'étape en cours (et questions sans réponse, quelle que soit l'étape)
  const infoEtape = (d, e) => {
    const box = el('div', 'info-etape');
    if (d.retracte_le) {
      box.appendChild(el('p', '', 'Vous avez renoncé au contrat le ' + fmtDate(d.retracte_le) + '.'));
      return box;
    }
    const questions = enAttente(d);
    if (questions.length) {
      box.appendChild(el('p', '', 'Nous vous avons posé ' + (questions.length > 1 ? questions.length + ' questions' : 'une question') + ' par e-mail : répondez directement à cet e-mail.'));
      const ul = el('ul', 'info-questions');
      questions.forEach((q) => {
        const li = el('li', '', q.question);
        if (q.choix && q.choix.length) li.appendChild(el('span', 'doc-meta', 'Exemples de réponse : ' + q.choix.join(' · ')));
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }
    if (e.statut === 'en_cours') {
      if (e.cle === 'signature') infoSignature(box, d);
      else if (e.cle === 'paiement') infoPaiement(box, d);
      else if (e.cle === 'validation') infoValidation(box, d, e);
    }
    return box.childNodes.length ? box : null;
  };

  const infoSignature = (box, d) => {
    if (!d.devis_chemin) { box.appendChild(el('p', '', 'Votre devis sera bientôt disponible.')); return; }
    if (d.signe_le) { box.appendChild(el('p', '', 'Devis signé le ' + fmtDate(d.signe_le) + '. Merci.')); return; }
    box.appendChild(el('p', '', 'Votre devis vous a été envoyé par e-mail' + (d.devis_envoye_le ? ' le ' + fmtDate(d.devis_envoye_le) : '') + ' : signez-le depuis le lien reçu.'));
    if (d.montant_cents) box.appendChild(ligneMontant('À régler par virement', d));
  };

  const infoPaiement = (box, d) => {
    if (d.paye_le) { box.appendChild(el('p', '', 'Paiement reçu le ' + fmtDate(d.paye_le) + '. Merci.')); return; }
    if (!d.montant_cents) { box.appendChild(el('p', '', 'Le montant à régler vous sera communiqué prochainement.')); return; }
    box.appendChild(ligneMontant('À régler par virement', d));
    const zone = el('div', 'info-virement');
    zone.setAttribute('data-virement', '');
    blocVirement(zone, d, undefined);   // référence d'abord ; coordonnées bancaires à l'arrivée de « infos_espace »
    box.appendChild(zone);
  };

  // Coordonnées de virement : titulaire, IBAN, BIC (fonction « espace ») et référence à indiquer (numéro du dossier).
  // r : réponse « infos_espace » ; undefined tant qu'elle n'est pas arrivée. Sans IBAN configuré (iban nul), les
  // coordonnées figurent sur le devis.
  const blocVirement = (zone, d, r) => {
    zone.textContent = '';
    const v = r && r.virement;
    const banque = !!(v && v.iban);
    const dl = el('dl', 'virement');
    const ligne = (k, val) => { if (!val) return; dl.appendChild(el('dt', '', k)); dl.appendChild(el('dd', '', String(val))); };
    if (banque) { ligne('Titulaire', v.titulaire); ligne('IBAN', v.iban); ligne('BIC', v.bic); }
    ligne('Référence à indiquer', (v && v.reference) || d.id);
    zone.appendChild(dl);
    zone.appendChild(el('p', 'f-hint', 'Indiquez cette référence dans le libellé de votre virement.'));
    if (r === undefined || banque) return;
    zone.appendChild(el('p', '', r.agence
      ? 'Compte agence : les coordonnées bancaires et le lien de rétractation s’affichent pour le client du dossier.'
      : 'Les coordonnées bancaires figurent sur votre devis.'));
  };

  // Étape en cours : les documents attendent la validation (une validation précédente, avant une nouvelle demande,
  // ne compte plus ; elle reste rappelée sous l'étape une fois faite).
  const infoValidation = (box, d, e) => {
    box.appendChild(el('p', '', 'Vos documents vous ont été envoyés par e-mail' + (e.debut_le ? ' le ' + fmtDate(e.debut_le) : '') + ' : validez-les depuis le lien reçu, ou répondez à l’e-mail pour demander une modification.'));
  };

  // ---------- Lien légal « Renoncer au contrat ici » (particulier, devis signé, dans le délai, non rétracté) ----------
  // Un lien vers la page action/ (jeton créé par la fonction), pas une action dans l'espace client.
  const renoncerPossible = (d) => particulier(d) && !!d.signe_le && !d.retracte_le;
  const rendreRenoncer = (d, r) => {
    const p = $('[data-renoncer]');
    p.textContent = '';
    const ren = r && r.renoncer;
    const url = ren && urlSure(ren.url);
    if (url && !d.retracte_le) {
      const limite = fmtLimite(ren.date_limite);
      p.appendChild(document.createTextNode('Vous pouvez renoncer au contrat ' + (limite ? 'jusqu’au ' + limite + ' inclus' : 'pendant le délai de rétractation') + ' : '));
      const a = el('a', 'lien-legal', 'Renoncer au contrat ici'); a.href = url;
      p.appendChild(a);
    } else if (r && r.echec && renoncerPossible(d) && Date.now() - new Date(d.signe_le).getTime() < 20 * 86400000) {
      // Lien momentanément indisponible, signature récente : les autres moyens de se rétracter.
      p.appendChild(document.createTextNode('Pour renoncer au contrat, utilisez le lien « Renoncer au contrat ici » reçu par e-mail, ou écrivez-nous à '));
      const m = el('a', '', 'contact@atomes.studio'); m.href = 'mailto:contact@atomes.studio';
      p.appendChild(m); p.appendChild(document.createTextNode('.'));
    }
    p.hidden = !p.childNodes.length;
  };

  // Lecture « infos_espace » quand elle sert : virement attendu, ou rétractation possible. Compte agence ouvert sur
  // l'espace client (même navigateur) : rien n'est demandé (la fonction réserve ces informations au client).
  const besoinInfos = (d) => !d.retracte_le && ((d.etape === 'paiement' && !!d.montant_cents && !d.paye_le) || renoncerPossible(d));
  const appliquer = (d, r) => {
    const zone = $('[data-virement]');
    if (zone) blocVirement(zone, d, r);
    rendreRenoncer(d, r);
  };
  const completer = (d) => {
    if (!besoinInfos(d)) return;
    if (!demo && d.client_id !== utilisateurCharge) { appliquer(d, { agence: true }); return; }
    const id = d.id;
    if (!infos[id]) infos[id] = api.infosEspace(id).catch(() => ({ echec: true }));
    infos[id].then((r) => { if (utilisateurCharge && courant && courant.id === id) appliquer(courant, r); });
  };

  // ---------- Échanges : questions et réponses, messages du client, demandes de modification ----------
  // Une réponse par e-mail est enregistrée comme message et comme réponse aux questions en attente (ou comme demande
  // de modification à la validation) : ces questions et demandes s'affichent avec le message, pas une seconde fois.
  const normal = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const memeTexte = (a, b) => {
    const x = normal(a), y = normal(b);
    return !!x && !!y && (x === y || (Math.min(x.length, y.length) >= 4000 && (x.startsWith(y) || y.startsWith(x))));
  };
  const telecharger = (chemin, nom) => api.lien(chemin, nom).then((url) => { if (url && url !== '#') location.assign(url); }).catch(() => erreur('Téléchargement impossible pour le moment.'));
  const listePieces = (pieces) => {
    const ul = el('ul', 'pieces');
    ul.setAttribute('role', 'list');
    ul.setAttribute('aria-label', 'Pièces jointes');
    pieces.forEach((pc) => {
      const li = el('li');
      li.appendChild(el('span', '', pc.nom + (pc.taille ? ' · ' + fmtTaille(pc.taille) : '')));
      if (pc.chemin) {
        const b = el('button', 'link-more', 'Télécharger'); b.type = 'button';
        b.setAttribute('aria-label', 'Télécharger ' + pc.nom);
        b.addEventListener('click', () => telecharger(pc.chemin, pc.nom));
        li.appendChild(b);
      }
      ul.appendChild(li);
    });
    return ul;
  };
  const rendreEchanges = (d) => {
    const ul = $('[data-echanges]');
    ul.textContent = '';
    const messages = (d.messages || []).filter((m) => m && m.verifie !== false).map((m) => ({ m, questions: [], modifs: [] }));
    const lie = (t) => messages.find((x) => memeTexte(x.m.texte, t));
    const items = messages.map((x) => ({ date: x.m.recu_le, x }));
    (d.questions || []).filter((q) => q.repondue_le).forEach((q) => {
      const x = !q.commentaire && lie(q.reponse);
      if (x) x.questions.push(q); else items.push({ date: q.repondue_le, q });
    });
    (d.modifications || []).forEach((mo) => { const x = lie(mo.message); if (x) x.modifs.push(mo); else items.push({ date: mo.demandee_le, mo }); });
    items.sort((a, b) => new Date(b.date) - new Date(a.date));
    $('[data-bloc-echanges]').hidden = !items.length;
    items.forEach((it) => {
      const li = el('li');
      if (it.x) {
        const { m, questions, modifs } = it.x;
        const quoi = questions.length ? 'Votre réponse par e-mail' : modifs.length ? 'Votre demande de modification par e-mail' : 'Votre message par e-mail';
        li.appendChild(el('span', 'doc-meta', quoi + ' · ' + fmtDate(m.recu_le)));
        questions.sort((a, b) => new Date(a.posee_le) - new Date(b.posee_le)).forEach((q) => li.appendChild(el('p', 'echange-q', q.question)));
        if (normal(m.texte)) li.appendChild(el('p', 'echange-r', String(m.texte).trim()));
        const pieces = Array.isArray(m.pieces) ? m.pieces.filter((pc) => pc && pc.nom) : [];
        if (pieces.length) li.appendChild(listePieces(pieces));
      } else if (it.q) {
        li.appendChild(el('span', 'doc-meta', 'Question · répondue le ' + fmtDate(it.q.repondue_le)));
        li.appendChild(el('p', 'echange-q', it.q.question));
        li.appendChild(el('p', 'echange-r', String(it.q.reponse || '') + (it.q.commentaire ? '\n' + it.q.commentaire : '')));
      } else {
        li.appendChild(el('span', 'doc-meta', 'Demande de modification · ' + fmtDate(it.mo.demandee_le)));
        li.appendChild(el('p', 'echange-r', it.mo.message));
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

  // ---------- Documents (lecture et téléchargement) ----------
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
      a.addEventListener('click', () => telecharger(f.chemin, f.nom));
      li.appendChild(a);
      ul.appendChild(li);
    });
  };

  const rafraichirDocs = () => {
    if (!courant) return;
    const id = courant.id;
    const pour = (fn) => (l) => { if (courant && courant.id === id) fn(l); };
    api.lister(id, 'agence').then(pour((l) => rendreDocs($('[data-docs-agence]'), $('[data-vide-agence]'), l))).catch(() => erreur('Documents de l’agence indisponibles pour le moment.'));
    api.lister(id, 'client').then(pour((l) => rendreDocs($('[data-docs-client]'), $('[data-vide-client]'), l))).catch(() => erreur('Vos documents sont indisponibles pour le moment.'));
  };

  // ---------- Session ----------
  api.surChangement((session, evt) => {
    if (evt === 'TOKEN_REFRESHED' || evt === 'USER_UPDATED') return;
    if (session && session.user) {
      compte.hidden = false;
      $('[data-compte-email]').textContent = session.user.email || '';
      if (utilisateurCharge !== (session.user.id || session.user.email)) { utilisateurCharge = session.user.id || session.user.email; charger(); }
    } else {
      utilisateurCharge = null;
      oublier();
      compte.hidden = true;
      montrer('connexion');
      if (erreurLien) { const err = $('#e-err'); err.textContent = 'Ce lien a expiré ou a déjà été utilisé. Demandez un nouveau lien ci-dessous.'; err.hidden = false; }
    }
  });
})();
