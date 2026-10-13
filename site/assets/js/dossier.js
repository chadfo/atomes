// Espace client — connexion sans mot de passe (lien e-mail), suivi du dossier (timeline),
// documents de l'agence et pièces déposées par le client (bucket privé « dossiers »).
// Mode démo pour travailler le design sans backend : dossier/?demo
(() => {
  const cfg = window.ATOMES_CONFIG || {};
  const demo = new URLSearchParams(location.search).has('demo');
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
  // Surfaces du formulaire (même liste que devis.js et la fonction « demande ») : [colonne, libellé].
  const SURFACES = [['surface_existante', 'Surface habitable existante'], ['surface', 'Surface habitable créée'], ['emprise_existante', 'Emprise au sol du bâti existant'], ['emprise', 'Emprise au sol du bâti après projet'], ['surface_terrain', 'Surface de la parcelle']];
  const nomSur = (nom) => (nom.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 80) || 'fichier');

  // ---------- Accès aux données : Supabase, ou démo ----------
  const apiSupabase = () => {
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    const ok = (r) => { if (r.error) throw r.error; return r.data; };
    return {
      surChangement: (fn) => sb.auth.onAuthStateChange((evt, session) => fn(session, evt)),
      connexion: (email) => sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname.replace(/index\.html$/, ''), shouldCreateUser: false } }).then(ok),
      deconnexion: () => sb.auth.signOut(),
      dossiers: () => sb.from('projets').select('*, etapes(*)').order('cree_le', { ascending: false }).then(ok),
      lister: (id, dossier) => sb.storage.from('dossiers').list(id + '/' + dossier, { limit: 200, sortBy: { column: 'created_at', order: 'desc' } }).then(ok)
        .then((objets) => objets.filter((o) => o.name && !o.name.startsWith('.') && o.id)
          .map((o) => ({ nom: o.name, chemin: id + '/' + dossier + '/' + o.name, taille: (o.metadata && o.metadata.size) || 0, date: o.created_at }))),
      lien: (chemin, nom) => sb.storage.from('dossiers').createSignedUrl(chemin, 600, { download: nom }).then(ok).then((d) => d.signedUrl),
      deposer: (id, fichier) => sb.storage.from('dossiers').upload(id + '/client/' + nomSur(fichier.name), fichier, { upsert: false, contentType: fichier.type || undefined }).then(ok)
    };
  };

  const apiDemo = () => {
    const now = Date.now(), j = 86400000;
    const etapes = [
      ['demande', 'Demande reçue', 'Votre demande nous est bien parvenue.', 'fait', now - 9 * j],
      ['traitement', 'Traitement de votre demande', 'Nous étudions votre projet et revenons vers vous sous 48 h ouvrées.', 'fait', now - 8 * j],
      ['devis', 'Réception de votre devis', 'Votre devis est disponible dans vos documents.', 'fait', now - 6 * j],
      ['validation', 'Validation du devis', 'Retournez-nous le devis signé pour lancer la mission.', 'en_cours', null],
      ['paiement', 'Paiement', 'Règlement de l’acompte prévu au devis.', 'a_venir', null],
      ['pieces', 'Réception des pièces', 'Déposez dans votre espace les pièces nécessaires à l’étude : titre de propriété, plans existants, photos…', 'a_venir', null],
      ['etude', 'Étude et production', 'Nous réalisons la mission : relevés, conception, constitution du dossier.', 'a_venir', null],
      ['livraison', 'Livraison', 'Vos documents finaux sont disponibles dans votre espace.', 'a_venir', null]
    ].map((e, i) => ({ cle: e[0], ordre: i + 1, libelle: e[1], description: e[2], statut: e[3], fait_le: e[4] ? new Date(e[4]).toISOString() : null }));
    const projet = {
      id: '261003091422', cree_le: new Date(now - 9 * j).toISOString(), profil: 'Particulier', prenom: 'Jean', nom: 'Dupont', email: 'jean.dupont@exemple.fr',
      telephone: '06 12 34 56 78', type: 'Extension', documents: ['Déclaration préalable', 'Perspective'], adresse: '12 rue des Oliviers', commune: 'Hyères',
      code_postal: '83400', bien: 'Maison', surface: 25, surface_existante: 110, emprise_existante: 90, emprise: 115, surface_terrain: 600,
      calendrier: 'Dans 3 à 6 mois', message: 'Extension du séjour vers le jardin et réfection de la toiture.', source: 'Instagram',
      etape: 'validation', etapes
    };
    const docs = {
      agence: [{ nom: 'Devis-261003091422.pdf', chemin: 'demo', taille: 184320, date: new Date(now - 6 * j).toISOString() }],
      client: [
        { nom: '01-photos-facade.jpg', chemin: 'demo', taille: 2411520, date: projet.cree_le },
        { nom: '02-plan-existant.pdf', chemin: 'demo', taille: 655360, date: projet.cree_le }
      ]
    };
    let session = { user: { email: projet.email } };
    let ecouteur = null;
    return {
      surChangement: (fn) => { ecouteur = fn; setTimeout(() => fn(session), 0); },
      connexion: () => Promise.resolve(),
      deconnexion: () => { session = null; ecouteur(null); return Promise.resolve(); },
      dossiers: () => Promise.resolve([projet]),
      lister: (_id, dossier) => Promise.resolve(docs[dossier].slice()),
      lien: () => Promise.resolve('#'),
      deposer: (_id, fichier) => { docs.client.unshift({ nom: nomSur(fichier.name), chemin: 'demo', taille: fichier.size, date: new Date().toISOString() }); return Promise.resolve(); }
    };
  };

  let api;
  try {
    if (demo) api = apiDemo();
    else if (cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase) api = apiSupabase();
  } catch (ex) {
    $('[data-config-msg]').textContent = 'Configuration de l\u2019espace client invalide : vérifiez l\u2019adresse Supabase dans config.js.';
    montrer('config');
    return;
  }
  if (!api) {
    if (cfg.supabaseUrl && !window.supabase) $('[data-config-msg]').textContent = 'Le service de connexion est momentanément indisponible. Réessayez dans quelques minutes.';
    montrer('config');
    return;
  }

  // Retour d'un lien de connexion expiré ou déjà utilisé : Supabase renvoie l'erreur dans l'URL.
  const paramsUrl = new URLSearchParams(location.search);
  const paramsHash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const erreurLien = paramsHash.get('error_description') || paramsHash.get('error') || paramsUrl.get('error_description') || paramsUrl.get('error');
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
    api.connexion(email).then(() => {
      const z = $('[data-lien-envoye]');
      z.textContent = '';
      z.appendChild(document.createTextNode('Lien envoyé à '));
      z.appendChild(el('strong', '', email));
      z.appendChild(document.createTextNode('. Ouvrez l\u2019e-mail et cliquez sur le lien pour accéder à votre espace. Pensez à vérifier vos courriers indésirables.'));
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

  const charger = () => api.dossiers().then((liste) => {
    dossiers = liste || [];
    erreur('');
    const voulu = location.hash.replace('#', '');
    const cible = dossiers.find((d) => d.id === voulu) || (dossiers.length === 1 ? dossiers[0] : null);
    if (cible) ouvrir(cible);
    else if (dossiers.length) rendreListe();
    else { montrer('liste'); $('[data-dossiers]').textContent = ''; $('[data-dossiers]').appendChild(el('p', 'docs-vide', 'Aucun dossier n’est associé à ce compte pour le moment.')); }
  }).catch(() => { montrer('liste'); erreur('Impossible de charger vos dossiers. Réessayez dans quelques minutes.'); });

  const rendreListe = () => {
    const cont = $('[data-dossiers]');
    cont.textContent = '';
    dossiers.forEach((d) => {
      const a = el('a', 'dossier-card'); a.href = '#' + d.id;
      const g = el('div');
      g.appendChild(el('div', 'num', 'DOSSIER N° ' + d.id));
      g.appendChild(el('strong', '', d.type + ' · ' + d.commune));
      const enCours = (d.etapes || []).find((e) => e.statut === 'en_cours');
      a.appendChild(g);
      a.appendChild(el('span', 'tl-date', enCours ? enCours.libelle : 'Terminé'));
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
    rendreTimeline(d.etapes || []);
    rendreRecap(d);
    montrer('dossier');
    rafraichirDocs();
  };

  $('[data-retour]').addEventListener('click', (e) => { e.preventDefault(); history.pushState(null, '', location.pathname + location.search); rendreListe(); });
  window.addEventListener('hashchange', () => {
    const d = dossiers.find((x) => x.id === location.hash.replace('#', ''));
    if (d) ouvrir(d); else if (dossiers.length > 1) rendreListe();
  });

  const rendreTimeline = (etapes) => {
    const ol = $('[data-timeline]');
    ol.textContent = '';
    etapes.slice().sort((a, b) => a.ordre - b.ordre).forEach((e) => {
      const li = el('li', 'tl-' + e.statut);
      li.appendChild(el('span', 'tl-mark'));
      const corps = el('div', 'tl-body');
      corps.appendChild(el('div', 'tl-title', e.libelle));
      corps.appendChild(el('span', 'sr-only', e.statut === 'fait' ? 'Fait' : e.statut === 'en_cours' ? 'En cours' : 'À venir'));
      if (e.statut === 'en_cours' && (e.description || e.note)) corps.appendChild(el('p', 'tl-desc', e.note || e.description));
      li.appendChild(corps);
      li.appendChild(el('span', 'tl-date', e.statut === 'fait' ? fmtDate(e.fait_le) : e.statut === 'en_cours' ? 'En cours' : ''));
      ol.appendChild(li);
    });
  };

  const rendreRecap = (d) => {
    const dl = $('[data-recap]');
    dl.textContent = '';
    const m2 = (v) => (v === null || v === undefined || v === '' ? '' : v + ' m²');
    const prec = d.precisions || {};
    const aff = (v, cle) => (v === 'Autre' && prec[cle] ? 'Autre : ' + prec[cle] : v);
    [
      ['Profil', [d.profil, d.societe, d.activite].filter(Boolean).join(' · ')],
      ['Contact', [d.prenom + ' ' + d.nom, d.email, d.telephone].filter(Boolean).join(' · ')],
      ['Type de projet', aff(d.type, 'type')], ['Documents souhaités', (d.documents || []).map((x) => aff(x, 'documents')).join(', ')],
      ['Adresse', [d.adresse, [d.code_postal, d.commune].filter(Boolean).join(' ')].filter(Boolean).join(', ')],
      ['Référence cadastrale', d.cadastre], ['État actuel', aff(d.bien, 'bien')],
      ['Surfaces', SURFACES.filter((sf) => m2(d[sf[0]])).map((sf) => sf[1] + ' : ' + m2(d[sf[0]])).join('\n')], // une surface par ligne (dd en pre-line)
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
