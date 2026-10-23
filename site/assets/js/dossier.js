// Espace client (parcours v3, discussion du 20 octobre 2026). Connexion sans mot de passe (code reçu par e-mail), liste
// des dossiers, timeline numérotée et datée avec, sous l'étape en cours, une information en lecture seule (devis envoyé,
// virement attendu, documents à valider, rétractation), discussion avec l'agence, documents de l'agence et du client
// (bucket privé « dossiers »), récapitulatif de la demande.
// Discussion : messages des deux côtés (e-mails du client rangés par le moteur de l'agence, messages écrits ici,
// messages de l'agence) et étapes clés du dossier (table evenements), du plus ancien au plus récent ; dossier ouvert
// relu toutes les 30 s (onglet visible) et au retour sur l'onglet. Le client y écrit, avec photos et PDF aux limites du
// formulaire de devis : envoi multipart à l'action « message_client » de la fonction « espace », qui range les pièces
// dans <id>/client/ (jamais d'écriture directe en base ni dans Storage). Brouillon par dossier, en mémoire seulement.
// Le reste se fait hors d'ici : le client signe le devis et valide ses documents depuis les liens reçus par e-mail
// (page action/), paie par virement (coordonnées bancaires : action « infos_espace » de la fonction « espace »,
// config.js : espaceUrl). Le lien légal « Renoncer au contrat ici », dans le pied de page de toutes les vues, mène au
// formulaire public de rétractation (renoncer/) ; la fiche ne parle plus de rétractation, sauf pour une rétractation
// reçue (« Vous avez renoncé au contrat le … », sous l'étape en cours).
// Impression (conditions générales, article 18 : la discussion s'imprime ou s'enregistre en PDF) : fil entier montré
// avant l'impression ; la feuille de style d'impression fait le reste.
// Tableau de bord (21 octobre 2026) : sur un écran d'ordinateur, la feuille de style place la fiche en colonnes
// (en-tête, timeline et récapitulatif à gauche, discussion au milieu, documents à droite) ; montrer() pose
// .espace--tableau sur la section quand la vue dossier est affichée. Sur un écran assez haut, le fil de la discussion
// défile seul dans un panneau qui remplit l'écran (« fil défilant », déduit de son overflow-y calculé) : en bas à
// l'ouverture et après un envoi, gardé en bas ou à sa place aux mises à jour, focalisable quand il déborde. Panneaux au
// clavier : documents hors de la tabulation quand ils débordent, élément focalisé caché sous la barre ou coupé par un
// bord ramené à l'écran (Firefox). « Documents de l'agence » : fichiers du stockage (agence/) et pièces jointes des
// messages de l'agence (agence/discussion/).
// Mode démo sans backend : dossier/?demo, ou ?demo=signature, paiement, production, validation, suivi, clos (étape de
// départ), ou ?demo=retracte (rétractation reçue pendant le paiement) ; la discussion s'y écrit dans les données de la
// démo.
(() => {
  const cfg = window.ATOMES_CONFIG || {};
  const params = new URLSearchParams(location.search);
  const demo = params.has('demo');

  // ---------- Ancien lien direct (#connexion=<jeton>) : retiré de l'adresse avant toute autre chose ----------
  // Lien personnel (lien direct) des e-mails envoyés à partir du soir du 19 octobre 2026, jusqu'à la mise en ligne de
  // la connexion par code : le jeton n'est ni vérifié ni envoyé nulle part ; il quitte la barre d'adresse avant la
  // création du client Supabase et tout appel réseau. Le numéro de dossier (dossier=<12 chiffres>) reste en
  // #<numéro> : le dossier s'ouvre une fois connecté par code. Vrai si l'adresse portait un tel lien.
  const retirerAncienLien = () => {
    const h = location.hash.replace(/^#/, '');
    if (!/(^|&)connexion=/.test(h)) return false;
    const dossier = new URLSearchParams(h).get('dossier') || '';
    history.replaceState(null, '', location.pathname + location.search + (/^\d{12}$/.test(dossier) ? '#' + dossier : ''));
    return true;
  };
  let ancienLien = retirerAncienLien();   // message sous l'adresse au premier affichage de la connexion
  // Jeton dans le fragment (#access_token=…, #refresh_token=…, type=magiclink|recovery|invite|signup : ancien lien de
  // connexion ou lien forgé) : il n'ouvre aucune session (detectSessionInUrl: false) et quitte aussitôt la barre
  // d'adresse et l'historique, avant la création du client Supabase, sans message. #<numéro> et #error… restent.
  const retirerJetonAcces = () => {
    const h = location.hash.replace(/^#/, '');
    if (!/(^|&)(access_token|refresh_token)=|(^|&)type=(magiclink|recovery|invite|signup)(&|$)/.test(h)) return false;
    history.replaceState(null, '', location.pathname + location.search);
    return true;
  };
  retirerJetonAcces();

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const vues = {};
  $$('[data-vue]').forEach((v) => { vues[v.dataset.vue] = v; });
  const section = $('.espace');
  // Connexion par code réussie : focus sur le titre de la première vue affichée ensuite (liste, dossier ou refus),
  // jamais à un SIGNED_IN sans code saisi (supabase-js en réémet un à chaque retour sur l'onglet). Vue dossier : la
  // section passe en tableau de bord (.espace--tableau, colonnes de la feuille de style).
  let focusTitre = false;
  const montrer = (nom) => {
    Object.keys(vues).forEach((k) => { vues[k].hidden = k !== nom; });
    section.classList.toggle('espace--tableau', nom === 'dossier');
    if (!focusTitre || nom === 'chargement') return;
    focusTitre = false;
    const titre = vues[nom] && $('h1', vues[nom]);
    if (titre) { titre.setAttribute('tabindex', '-1'); titre.focus({ preventScroll: true }); }
  };
  const compte = $('[data-compte]');
  const erreur = (msg) => { const e = $('[data-erreur]'); e.textContent = msg || ''; e.hidden = !msg; };

  const el = (tag, cls, texte) => { const n = document.createElement(tag); if (cls) n.className = cls; if (texte !== undefined) n.textContent = texte; return n; };
  // Dates à l'heure de Paris (comme les numéros de dossier, les e-mails et la page d'action) ; « 1er » comme dans les
  // e-mails (règle premier() de la fonction « espace ») : « 1er octobre 2026 »
  const premier = (s) => s.replace(/(^|\s)1(\s)/, '$11er$2');
  const dateValide = (iso) => !!iso && !isNaN(new Date(iso).getTime());
  const fmtDate = (iso) => (dateValide(iso) ? premier(new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' })) : '');
  // « 20 octobre 2026 à 09:42 »
  const fmtHeure = (iso) => (dateValide(iso) ? premier(new Date(iso).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Paris' })) : '');
  const fmtTaille = (o) => (o >= 1048576 ? (o / 1048576).toFixed(1).replace('.', ',') + ' Mo' : Math.max(1, Math.round((o || 0) / 1024)) + ' Ko');
  const euros = (c) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format((c || 0) / 100);
  // Surfaces du formulaire (même liste que devis.js et la fonction « demande ») : [colonne, libellé].
  const SURFACES = [['surface_existante', 'Surface habitable existante'], ['surface', 'Surface habitable créée'], ['emprise_existante', 'Emprise au sol du bâti existant'], ['emprise', 'Emprise au sol du bâti après projet'], ['surface_terrain', 'Surface de la parcelle']];

  // ---------- Accès aux données : Supabase, ou démo ----------
  const apiSupabase = () => {
    // detectSessionInUrl désactivé : aucune session ne s'ouvre depuis un #access_token placé dans l'adresse (connexion
    // par code seulement).
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { detectSessionInUrl: false } });
    const ok = (r) => { if (r.error) throw r.error; return r.data; };
    const urlEspace = cfg.espaceUrl || cfg.supabaseUrl.replace(/\/$/, '') + '/functions/v1/espace';
    // Colonnes des messages lues par la page : jamais texte_complet (lu à la demande, « Message complet »), ni
    // l'expéditeur, l'authentification ou les colonnes internes.
    const MESSAGES = 'id, recu_le, auteur, origine, texte, pieces, verifie';
    const SELECTION = '*, etapes(*), messages(' + MESSAGES + '), evenements(type, le, details)';
    // Avant la migration 0006 (table evenements absente : PGRST200 ; colonne inconnue : 42703) : ancienne lecture, sans
    // étapes clés ; chaque message est alors un e-mail du client (auteur et origine absents).
    const SELECTION_ANCIENNE = '*, etapes(*), messages(*)';
    let ancienne = false;
    const lire = (sel) => sb.from('projets').select(sel).order('cree_le', { ascending: false }).then(ok);
    // Jeton de la session lu au moment de l'appel
    const jeton = async () => { const { data } = await sb.auth.getSession(); return data && data.session ? data.session.access_token : ''; };
    return {
      surChangement: (fn) => sb.auth.onAuthStateChange((evt, session) => fn(session, evt)),
      // Code de connexion envoyé par e-mail (modèle « Magic link » à code, sans lien de connexion).
      connexion: (email) => sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } }).then(ok),
      // Code saisi (POST /auth/v1/verify) : session enregistrée par supabase-js, puis événement SIGNED_IN.
      verifierCode: (email, code) => sb.auth.verifyOtp({ email, token: code, type: 'email' }).then(ok)
        .then((d) => { if (!d || !d.session) throw new Error('session absente'); return d; }),
      deconnexion: () => sb.auth.signOut(),
      dossiers: () => lire(SELECTION).then((l) => { ancienne = false; return l; }, (e) => {
        if (e && (e.code === 'PGRST200' || e.code === '42703')) return lire(SELECTION_ANCIENNE).then((l) => { ancienne = true; return l; });
        throw e;
      }),
      // Relecture du dossier ouvert (rafraîchissement) : ses messages (mêmes colonnes) et ses étapes clés.
      relire: (id) => Promise.all([
        sb.from('messages').select(ancienne ? 'id, recu_le, texte, pieces, verifie' : MESSAGES).eq('projet_id', id).then(ok),
        ancienne ? null : sb.from('evenements').select('type, le, details').eq('projet_id', id).then(ok)
      ]).then(([messages, evenements]) => ({ messages, evenements })),
      // Texte intégral d'un e-mail du client (citation comprise), lu à l'ouverture de « Message complet » seulement.
      texteComplet: (id) => sb.from('messages').select('texte_complet').eq('id', id).then(ok).then((l) => (l && l[0] && l[0].texte_complet) || ''),
      lister: (id, dossier) => sb.storage.from('dossiers').list(id + '/' + dossier, { limit: 200, sortBy: { column: 'created_at', order: 'desc' } }).then(ok)
        .then((objets) => objets.filter((o) => o.name && !o.name.startsWith('.') && o.id)
          .map((o) => ({ nom: o.name, chemin: id + '/' + dossier + '/' + o.name, taille: (o.metadata && o.metadata.size) || 0, date: o.created_at }))),
      // Lien signé de téléchargement (10 minutes)
      lien: (chemin, nom) => sb.storage.from('dossiers').createSignedUrl(chemin, 600, { download: nom }).then(ok).then((d) => d.signedUrl),
      // Coordonnées de virement : action « infos_espace » (lecture seule).
      infosEspace: async (projet) => {
        const r = await fetch(urlEspace, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + await jeton(), 'apikey': cfg.supabaseAnonKey },
          body: JSON.stringify({ action: 'infos_espace', projet })
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) { const e = new Error(j.erreur || 'infos_espace'); e.statut = r.status; throw e; }
        return j;
      },
      // Message du client (action « message_client ») : multipart, sans Content-Type (le navigateur pose
      // multipart/form-data et sa limite) ; 120 s au plus, lecture de la réponse comprise. Réponse { message } ou
      // { deja, message } (cle déjà enregistrée) ; échec : erreur avec le statut et le texte de la fonction.
      envoyerMessage: async (projet, cle, texte, fichiers) => {
        const fd = new FormData();
        fd.append('action', 'message_client'); fd.append('projet', projet); fd.append('cle', cle); fd.append('texte', texte);
        fichiers.forEach((f) => fd.append('fichiers', f, f.name));
        const delai = new AbortController();
        const minuterie = setTimeout(() => delai.abort(), 120000);
        try {
          const r = await fetch(urlEspace, { method: 'POST', headers: { 'Authorization': 'Bearer ' + await jeton(), 'apikey': cfg.supabaseAnonKey }, body: fd, signal: delai.signal });
          const j = await r.json().catch(() => ({}));
          if (!r.ok || !j || !j.message || typeof j.message !== 'object') { const e = new Error('message_client'); e.statut = r.status; e.erreur = j && typeof j.erreur === 'string' ? j.erreur : ''; throw e; }
          return j;
        } finally { clearTimeout(minuterie); }
      }
    };
  };

  // Démo : même modèle d'étapes que la base (migrations 0004 et 0005) ; la discussion s'écrit dans les données de la
  // démo (celles de la fermeture, relues par le rafraîchissement), jamais ailleurs.
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
    const now = Date.now(), j = 86400000, h = 3600000;
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
      messages: [],
      evenements: []
    };
    const docs = {
      agence: [],
      client: [
        { nom: '01-photos-facade.jpg', chemin: 'demo', taille: 2411520, date: projet.cree_le },
        { nom: '02-plan-existant.pdf', chemin: 'demo', taille: 655360, date: projet.cree_le }
      ]
    };
    // Discussion : messages (colonnes lues par la page), texte intégral des e-mails du client (lu à la demande) et
    // étapes clés datées, comme les écrivent la fonction « espace », le moteur de l'agence et le déclencheur de la base.
    // Pièces du client rangées aussi dans « Vos documents » (liste du stockage de la démo). Celles de l'agence, rangées
    // dans agence/discussion/ hors de la liste du stockage, la page les ajoute aux « Documents de l'agence » depuis les
    // messages (?demo=validation : la notice) ; leurs chemins, comme ceux du stockage, sont distincts (pas de doublon).
    const complets = new Map();
    let dernierId = 0;
    const message = (t, auteur, origine, texte, pieces, complet) => {
      const m = { id: ++dernierId, recu_le: iso(t), auteur, origine, texte, pieces: pieces || [], verifie: true };
      projet.messages.push(m);
      if (complet) complets.set(m.id, complet);
      if (auteur === 'client') m.pieces.forEach((pc) => docs.client.unshift({ nom: pc.nom, chemin: pc.chemin, taille: pc.taille, date: m.recu_le }));
      return m;
    };
    const etapeCle = (type, t, details) => projet.evenements.push({ type, le: iso(t), details: details || {} });
    const QUESTIONS = 'Bonjour Monsieur Dupont,\n\nMerci pour votre demande et pour la photo. Deux questions pour préparer votre devis :\n\n'
      + '1. Souhaitez-vous vous occuper vous-même du dépôt de la déclaration préalable, ou que nous nous en chargions (supplément) ?\n'
      + '2. Disposez-vous des plans de la maison existante (papier ou PDF) ?\n\nSimon Charles\nAtomes studio';
    const cite = (texte) => texte.split('\n').map((l) => '> ' + l).join('\n');
    const PHOTO = 'Bonjour,\nJe vous envoie une photo du jardin, côté sud, là où se ferait l’extension.\nJean Dupont';
    const REPONSE = 'Bonjour,\nVous vous en chargez, merci.\nOui, j’ai les plans de la maison en PDF : je vous les joins.\nJean Dupont';
    etapeCle('demande_recue', now - 12 * j);
    message(now - 11 * j, 'client', 'email', PHOTO, [{ nom: '03-jardin-sud.jpg', chemin: 'demo', taille: 1887436 }],
      PHOTO + '\n\nAtomes studio <contact@atomes.studio> a écrit :\n' + cite('Votre demande nous est bien parvenue. Une question ? Répondez simplement à cet e-mail.'));
    message(now - 10 * j, 'agence', 'espace', QUESTIONS);
    message(now - 9 * j, 'client', 'email', REPONSE, [{ nom: '04-plans-maison.pdf', chemin: 'demo', taille: 1258291 }],
      REPONSE + '\n\nAtomes studio <contact@atomes.studio> a écrit :\n' + cite(QUESTIONS));
    message(now - 9 * j + 2 * h, 'client', 'espace', 'J’ajoute deux photos de la façade côté rue, prises ce matin.',
      [{ nom: '05-facade-rue-1.jpg', chemin: 'demo', taille: 2202009 }, { nom: '05-facade-rue-2.jpg', chemin: 'demo', taille: 1992294 }]);

    const ordre = ['traitement', 'devis', 'signature', 'paiement', 'production', 'validation', 'suivi', 'clos'];
    const retracte = scenario === 'retracte';
    const jusqua = retracte ? 'paiement' : ordre.includes(scenario) ? scenario : 'traitement';
    const avance = (cle, t) => { projet.etape = cle; recalculer(projet, iso(t)); };
    recalculer(projet, iso(now - 12 * j));
    const etapesDemo = ordre.slice(0, ordre.indexOf(jusqua) + 1);
    if (etapesDemo.includes('devis')) {
      message(now - 8 * j - 2 * h, 'agence', 'espace', 'Merci pour ces éléments, c’est noté. Nous préparons votre devis : vous le recevrez par e-mail dans quelques jours.');
      avance('devis', now - 8 * j);
    }
    if (etapesDemo.includes('signature')) {
      Object.assign(projet, { devis_chemin: DEVIS, devis_envoye_le: iso(now - 6 * j), montant_cents: 72000, montant_libelle: 'Acompte de 40 %' });
      docs.agence.push({ nom: DEVIS.split('/').pop(), chemin: DEVIS, taille: 184320, date: iso(now - 6 * j) });
      etapeCle('devis_envoye', now - 6 * j, { montant_cents: 72000, montant_libelle: 'Acompte de 40 %' });
      avance('signature', now - 6 * j);
    }
    if (etapesDemo.includes('paiement')) {
      Object.assign(projet, { signe_le: iso(now - 5 * j), signe_nom: 'Jean Dupont', demarrage_anticipe_le: iso(now - 5 * j) });
      etapeCle('devis_signe', now - 5 * j);
      avance('paiement', now - 5 * j);
    }
    if (retracte) { projet.retracte_le = iso(now - j); etapeCle('retractation', now - j); }
    if (etapesDemo.includes('production')) { projet.paye_le = iso(now - 4 * j); etapeCle('paiement_recu', now - 4 * j); avance('production', now - 4 * j); }
    if (etapesDemo.includes('validation')) {
      docs.agence.unshift({ nom: 'Plans-et-perspective-' + ID + '.pdf', chemin: ID + '/agence/Plans-et-perspective-' + ID + '.pdf', taille: 3145728, date: iso(now - j) });
      etapeCle('documents_prets', now - j);
      avance('validation', now - j);
      message(now - j + 600000, 'agence', 'espace', 'Vos documents sont prêts. Je joins ici la notice de la déclaration préalable, à garder avec votre dossier.',
        [{ nom: 'notice-declaration-prealable.pdf', chemin: ID + '/agence/discussion/261020101000-notice-declaration-prealable.pdf', taille: 412672 }]);
    }
    if (jusqua === 'suivi') {
      projet.suivi_administratif = true; projet.documents_valides_le = iso(now - 20 * h);
      etapeCle('documents_valides', now - 20 * h);
      avance('depot', now - 20 * h); avance('instruction', now - h);
    }
    if (jusqua === 'clos') {
      projet.documents_valides_le = iso(now - 20 * h);
      etapeCle('documents_valides', now - 20 * h); etapeCle('dossier_clos', now - 20 * h);
      avance('clos', now - 20 * h);
      message(now - 19 * h, 'client', 'espace', 'Merci pour votre travail, et à bientôt.');
    }

    let session = { user: { email: projet.email } };
    let ecouteur = null;
    const copie = (x) => JSON.parse(JSON.stringify(x));
    const envois = new Map();   // cle d'envoi → id du message (même cle rejouée : réponse « deja »)
    return {
      surChangement: (fn) => { ecouteur = fn; setTimeout(() => fn(session), 0); },
      connexion: () => Promise.resolve(),
      // Après « Se déconnecter » : tout code bien formé rouvre la session de démo, comme une vraie connexion.
      verifierCode: () => new Promise((res) => setTimeout(() => { session = { user: { email: projet.email } }; ecouteur(session, 'SIGNED_IN'); res({ session }); }, 300)),
      deconnexion: () => { session = null; ecouteur(null); return Promise.resolve(); },
      dossiers: () => Promise.resolve([copie(projet)]),
      relire: () => Promise.resolve({ messages: copie(projet.messages), evenements: copie(projet.evenements) }),
      texteComplet: (id) => new Promise((res) => setTimeout(() => res(complets.get(id) || (projet.messages.find((m) => m.id === id) || {}).texte || ''), 200)),
      lister: (_id, dossier) => Promise.resolve(docs[dossier].slice()),
      lien: () => Promise.resolve('#'),
      infosEspace: () => new Promise((res) => setTimeout(() => res({
        ok: true,
        virement: projet.etape === 'paiement' && projet.montant_cents && !projet.paye_le
          ? { titulaire: 'Atomes studio (démo)', iban: 'FR76 XXXX XXXX XXXX XXXX XXXX XXX', bic: 'XXXXXXXXXXX', reference: ID } : null
      }), 150)),
      envoyerMessage: (_projet, cle, texte, fichiers) => new Promise((res) => setTimeout(() => {
        if (envois.has(cle)) { res({ deja: true, message: copie(projet.messages.find((m) => m.id === envois.get(cle))) }); return; }
        const m = message(Date.now(), 'client', 'espace', texte || null, fichiers.map((f) => ({ nom: f.name, chemin: 'demo', taille: f.size })));
        envois.set(cle, m.id);
        res({ message: copie(m) });
      }, 700))
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

  // Retour d'un lien de connexion expiré ou déjà utilisé (ancien modèle à lien) : Supabase renvoie l'erreur dans l'URL.
  const paramsHash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const erreurLien = paramsHash.get('error_description') || paramsHash.get('error') || params.get('error_description') || params.get('error');
  if (erreurLien) history.replaceState(null, '', location.pathname);

  // ---------- Connexion par code ----------
  // Étape 1 : l'adresse ; Supabase envoie un code à usage unique (modèle « Magic link », sans lien), sauf avec « J'ai
  // déjà un code » (aucun envoi). Étape 2 : le code, vérifié ici ; la session ouverte, l'événement SIGNED_IN affiche
  // l'espace (« Session », plus bas). Même affichage dans la page qu'une adresse ait un dossier ou non : à l'étape 1,
  // l'envoi, une adresse inconnue (422 « Signups not allowed for otp ») et un code redemandé moins d'une minute après le
  // précédent (429, le précédent reste valable) mènent à la même étape 2 ; « Recevoir un nouveau code » moins d'une
  // minute après le dernier envoi fait d'ici répond « patientez une minute » sans appeler Supabase, pour toute adresse,
  // y compris après « J'ai déjà un code » pour cette même adresse. Exception : « J'ai déjà un code » sans envoi récent
  // d'ici (autre onglet ou appareil, onglet rechargé) ; « Recevoir un nouveau code » appelle alors Supabase aussitôt,
  // et une adresse qui a un dossier (429 : « patientez une minute ») s'y distingue d'une adresse inconnue (422 :
  // notice « nouveau code »). L'API de Supabase, elle, distingue toujours une adresse inconnue (422 contre 200,
  // visible dans les outils du navigateur). Le code ne part que dans le corps de la vérification : jamais dans une
  // URL, un stockage, un attribut ni un journal ; l'adresse, jamais dans un journal.
  const formConnexion = $('[data-form-connexion]');
  const formCode = $('[data-form-code]');
  const champEmail = $('#e-email');
  const champCode = $('#e-code');
  const zoneCode = $('[data-code-envoye]');
  const EMAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const ANCIEN_LIEN = 'La connexion se fait désormais par un code reçu par e-mail : entrez votre adresse ci-dessus.';
  const LIEN_EXPIRE = 'Ce lien de connexion a expiré ou a déjà servi. Recevez un code de connexion ci-dessous.';
  // Erreurs de la demande de code : sous l'adresse (étape 1), sous le code (« Recevoir un nouveau code »)
  const ERR_DEMANDE = {
    envoi: 'L’envoi de l’e-mail de connexion a échoué de notre côté. Réessayez plus tard ou écrivez-nous à contact@atomes.studio.',
    limite: 'Trop de demandes de code en peu de temps. Patientez quelques minutes avant de réessayer.',
    autre: 'Impossible d’envoyer le code pour le moment. Réessayez dans quelques minutes.',
    frequence: 'Un code vient d’être envoyé : patientez une minute avant d’en demander un nouveau.'
  };
  // Erreurs du code, sous le code
  const ERR_CODE = {
    vide: 'Entrez le code reçu par e-mail.',
    format: 'Code invalide : recopiez les chiffres du code reçu par e-mail.',
    code: 'Code incorrect ou expiré. Vérifiez le code reçu, ou demandez-en un nouveau.',
    limite: 'Trop de tentatives en peu de temps. Patientez quelques minutes avant de réessayer.',
    autre: 'Connexion impossible pour le moment. Réessayez dans quelques minutes.'
  };
  // Notices de l'étape 2, texte avant et après l'adresse (en gras) : code envoyé, nouveau code envoyé, ou « J'ai déjà un
  // code » (rien d'envoyé d'ici)
  const NOTICE = {
    envoi: ['Si un dossier est associé à ', ', un code de connexion vient de lui être envoyé. Saisissez-le ci-dessous : il est valable une heure et ne sert qu’une fois. Pensez à vérifier vos courriers indésirables. Sans e-mail, utilisez l’adresse indiquée dans votre demande, ou écrivez-nous à contact@atomes.studio.'],
    nouveau: ['Si un dossier est associé à ', ', un nouveau code vient de lui être envoyé : utilisez ce dernier code, le précédent ne fonctionne plus. Pensez à vérifier vos courriers indésirables.'],
    deja: ['Saisissez ci-dessous le dernier code de connexion reçu par e-mail à l’adresse ', ' : un code est valable une heure et ne sert qu’une fois.']
  };
  // Classe d'une erreur de Supabase Auth (status, code, message), règles prises dans cet ordre (même règle dans
  // admin.js) : « inconnu », adresse sans compte ; « frequence », code redemandé moins d'une minute après le précédent
  // (« For security purposes, you can only request this after N seconds. ») ; « limite », autres limites d'envoi ou de
  // requêtes ; « code », code refusé (vérification) ; « envoi », e-mail non parti (demande) ; « autre » : 5xx, réseau…
  const classer = (ex, verification) => {
    const statut = (ex && ex.status) || 0, code = String((ex && ex.code) || ''), msg = String((ex && ex.message) || '');
    if (code === 'otp_disabled' || /signups? not allowed|user not found/i.test(msg)) return 'inconnu';
    if (statut === 429 && /for security purposes|after \d+ seconds?/i.test(msg)) return 'frequence';
    if (statut === 429 || code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || /rate limit|too many/i.test(msg)) return 'limite';
    if (verification && (statut === 403 || code === 'otp_expired' || (statut >= 400 && statut < 500))) return 'code';
    if (!verification && /sending|smtp/i.test(msg)) return 'envoi';
    return 'autre';
  };
  // Pannes et limites notées dans la console : classe et statut seulement
  const classerEchec = (verification) => (ex) => {
    const k = classer(ex, verification);
    if (k === 'limite' || k === 'envoi' || k === 'autre') console.warn('connexion :', k, (ex && ex.status) || 0);
    return k;
  };

  // État de l'étape 2 gardé dans l'onglet (sessionStorage), pour l'onglet rechargé au retour de l'application de
  // messagerie : adresse et heure de l'envoi, une heure au plus (durée du code). Stockage bloqué : la page marche sans.
  const CLE_CONNEXION = 'atomes-connexion-dossier';
  const oublierConnexion = () => { try { sessionStorage.removeItem(CLE_CONNEXION); } catch (ex) { /* stockage bloqué */ } };
  const garderConnexion = (email, le) => { try { sessionStorage.setItem(CLE_CONNEXION, JSON.stringify({ email, le })); } catch (ex) { /* stockage bloqué */ } };
  const lireConnexion = () => {
    let e = null;
    try { e = JSON.parse(sessionStorage.getItem(CLE_CONNEXION) || 'null'); } catch (ex) { e = null; }
    const age = e ? Date.now() - e.le : NaN;
    if (e && typeof e.email === 'string' && EMAIL_OK.test(e.email) && typeof e.le === 'number' && age >= 0 && age < 3600000) return e;
    oublierConnexion();   // plus d'une heure, ou illisible
    return null;
  };

  let emailCode = '';       // adresse à laquelle le code a été demandé (étape 2)
  let leCode = 0;           // heure du dernier envoi (étape 2)
  let dernier = { email: '', le: 0 };   // dernier code demandé d'ici : adresse et heure (mémoire seulement)
  let occupe = false;       // demande ou vérification en cours : rien d'autre n'est envoyé avant sa réponse
  let tour = 0;             // change à chaque changement d'étape : une réponse arrivée ensuite n'affiche plus rien
  let sessionLue = false;   // premier événement de session reçu (« Session », plus bas)

  // Message sous l'adresse ; invalide : champ signalé (aria-invalid)
  const erreurAdresse = (msg, invalide) => {
    const err = $('#e-err');
    err.textContent = msg || ''; err.hidden = !msg;
    if (invalide) champEmail.setAttribute('aria-invalid', 'true'); else champEmail.removeAttribute('aria-invalid');
  };
  // Message sous le code ; invalide : champ signalé, focalisé, saisie gardée et sélectionnée
  const erreurCode = (msg, invalide) => {
    const err = $('#e-code-err');
    err.textContent = msg || ''; err.hidden = !msg;
    if (!invalide) { champCode.removeAttribute('aria-invalid'); return; }
    champCode.setAttribute('aria-invalid', 'true');
    champCode.focus(); champCode.select();
  };
  // Notice de l'étape 2 (genre : envoi, nouveau, deja), dans la zone « status » toujours présente (vide, la feuille de
  // style la masque)
  const afficherEnvoi = (email, genre) => {
    zoneCode.textContent = '';
    zoneCode.appendChild(document.createTextNode(NOTICE[genre][0]));
    zoneCode.appendChild(el('strong', '', email));
    zoneCode.appendChild(document.createTextNode(NOTICE[genre][1]));
  };
  // Boutons d'action des deux étapes : tous désactivés pendant un appel (celui qui l'a lancé affiche son attente) ;
  // « Modifier l'adresse » reste toujours actif. Un changement d'étape les rétablit (liberer) ; la fonction rendue par
  // boutonOccupe ne touche alors plus à rien, sinon elle les rétablit et rend le focus au bouton s'il l'a perdu.
  const ACTIONS = ['[data-btn-connexion]', '[data-deja-code]', '[data-btn-code]', '[data-nouveau-code]'].map((s) => $(s));
  const LIBELLES = ACTIONS.map((b) => b.textContent);
  const liberer = () => { occupe = false; ACTIONS.forEach((b, i) => { b.disabled = false; b.textContent = LIBELLES[i]; }); };
  const boutonOccupe = (btn, attente) => {
    const t = tour;
    occupe = true; ACTIONS.forEach((b) => { b.disabled = true; }); btn.textContent = attente;
    return () => {
      if (t !== tour) return;
      liberer();
      if (document.activeElement === document.body) btn.focus();
    };
  };

  // Étape 2 : formulaire du code, notice avec l'adresse ; état gardé pour un rechargement de l'onglet. le = 0 (« J'ai
  // déjà un code ») : aucun envoi pour ce passage, notice propre, état oublié (un rechargement ramène à l'étape 1) ;
  // la minute n'y est tenue que pour un code demandé d'ici à la même adresse (dernier, voir « J'ai déjà un code »).
  const etapeCode = (email, le) => {
    tour++; liberer();
    emailCode = email; leCode = le;
    formConnexion.hidden = true; formCode.hidden = false;
    afficherEnvoi(email, le ? 'envoi' : 'deja');
    champCode.value = ''; erreurCode('');
    if (le) { garderConnexion(email, le); dernier = { email, le }; } else oublierConnexion();
    champCode.focus();
  };
  // Étape 1 : « Modifier l'adresse » (adresse gardée), connexion réussie et déconnexion (vider : adresse effacée aussi,
  // ordinateur partagé) ; notice, code et erreurs effacés, état oublié.
  const etapeAdresse = (vider) => {
    tour++; liberer();
    emailCode = '';
    oublierConnexion();
    formCode.hidden = true; formConnexion.hidden = false;
    zoneCode.textContent = '';
    champCode.value = ''; erreurCode(''); erreurAdresse('');
    if (vider) { champEmail.value = ''; dernier = { email: '', le: 0 }; }
  };
  // Premier affichage sans session : étape 2 rétablie pour un code demandé dans cet onglet il y a moins d'une heure ;
  // sous l'adresse, le message d'un lien de connexion expiré ou d'un ancien lien direct.
  const reprendre = () => {
    const etat = lireConnexion();
    if (etat) { champEmail.value = etat.email; etapeCode(etat.email, etat.le); }
    if (erreurLien) erreurAdresse(LIEN_EXPIRE);
    else if (ancienLien) erreurAdresse(ANCIEN_LIEN);
  };

  // Étape 1 → « Recevoir mon code de connexion »
  formConnexion.addEventListener('submit', (e) => {
    e.preventDefault();
    if (occupe) return;
    const email = champEmail.value.trim();
    if (!EMAIL_OK.test(email)) { erreurAdresse('Adresse email invalide', true); return; }
    erreurAdresse('');
    const t = tour, fin = boutonOccupe($('[data-btn-connexion]'), 'Envoi…');
    api.connexion(email).then(() => 'envoye', classerEchec(false)).then((k) => {
      if (t !== tour) return;
      if (k === 'envoye' || k === 'inconnu' || k === 'frequence') etapeCode(email, Date.now());
      else erreurAdresse(ERR_DEMANDE[k]);
    }).finally(fin);
  });

  // Étape 1 → « J'ai déjà un code » : code reçu, mais l'étape 2 n'est pas dans cet onglet (page rouverte depuis la
  // messagerie, autre onglet ou appareil) ; en redemander un annulerait celui qu'on a sous les yeux. Étape 2 pour cette
  // adresse sans aucun appel. Si un code vient d'être demandé d'ici pour cette adresse, la page garde l'heure de cet
  // envoi et tient la minute comme d'habitude. Sinon (autre onglet ou appareil, onglet rechargé), « Recevoir un
  // nouveau code » appelle Supabase aussitôt : son 429 (code parti il y a moins d'une minute) reçoit « patientez une
  // minute », son 422 (adresse inconnue) la notice « nouveau code » : une exception au même affichage.
  $('[data-deja-code]').addEventListener('click', () => {
    if (occupe) return;
    const email = champEmail.value.trim();
    if (!EMAIL_OK.test(email)) { erreurAdresse('Adresse email invalide', true); champEmail.focus(); return; }
    erreurAdresse('');
    etapeCode(email, 0);
    if (dernier.email.toLowerCase() === email.toLowerCase()) leCode = dernier.le;   // code demandé d'ici : minute tenue
  });

  // Étape 2 → « Se connecter »
  formCode.addEventListener('submit', (e) => {
    e.preventDefault();
    if (occupe) return;
    // Code recopié : espaces (insécables compris) et tirets retirés ; 6 à 10 chiffres (réglage « Email OTP Length »)
    const code = champCode.value.replace(/[\s\u2010-\u2015\u2212-]/g, '');
    if (!code) { erreurCode(ERR_CODE.vide, true); return; }
    if (!/^\d{6,10}$/.test(code)) { erreurCode(ERR_CODE.format, true); return; }
    erreurCode('');
    const t = tour, fin = boutonOccupe($('[data-btn-code]'), 'Vérification…');
    focusTitre = true;   // posé avant la vérification, consommé au premier affichage de vue (montrer)
    api.verifierCode(emailCode, code).then(() => null, classerEchec(true)).then((k) => {
      if (!k) return;   // connecté : l'événement SIGNED_IN prend le relais
      focusTitre = false;
      if (t !== tour) return;
      erreurCode(k === 'limite' || k === 'frequence' ? ERR_CODE.limite : k === 'autre' ? ERR_CODE.autre : ERR_CODE.code, true);
    }).finally(fin);
  });

  // Étape 2 → « Recevoir un nouveau code », pour la même adresse (Supabase annule le code précédent)
  $('[data-nouveau-code]').addEventListener('click', (e) => {
    if (occupe || !emailCode) return;
    erreurCode('');
    if (Date.now() - leCode < 60000) { erreurCode(ERR_DEMANDE.frequence); return; }   // même réponse, sans appel, qu'il y ait un compte ou non
    const email = emailCode, t = tour, fin = boutonOccupe(e.currentTarget, 'Envoi…');
    api.connexion(email).then(() => 'envoye', classerEchec(false)).then((k) => {
      if (t !== tour) return;
      if (k === 'envoye' || k === 'inconnu') {
        afficherEnvoi(email, 'nouveau');
        champCode.value = ''; erreurCode('');
        leCode = Date.now(); garderConnexion(email, leCode); dernier = { email, le: leCode };
        champCode.focus();
      } else erreurCode(ERR_DEMANDE[k]);   // « frequence » : le code envoyé il y a moins d'une minute reste valable
    }).finally(fin);
  });

  // Étape 2 → « Modifier l'adresse »
  $('[data-changer-adresse]').addEventListener('click', () => {
    etapeAdresse(false);
    champEmail.focus(); champEmail.select();
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
    ['[data-dossiers]', '[data-timeline]', '[data-discussion]', '[data-recap]', '[data-docs-agence]', '[data-docs-client]', '[data-d-num]', '[data-d-titre]', '[data-d-sous]']
      .forEach((sel) => { const n = $(sel); if (n) n.textContent = ''; });
    oublierDiscussion();
    erreur('');
  };

  const etapeCourante = (d) => (d.etapes || []).find((e) => e.cle === d.etape);
  // Compte agence ouvert sur l'espace client (même navigateur) : ni infos_espace ni message (la fonction réserve ces
  // actions au client du dossier).
  const compteAgence = (d) => !demo && d.client_id !== utilisateurCharge;
  // Le client a quelque chose à faire (depuis un lien reçu ou par virement) : devis à signer, virement, documents à
  // valider (à cette étape, une validation précédente ne compte plus : nouvelle demande).
  const actionAttendue = (d) => {
    if (d.retracte_le) return false;
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

  // Fiche d'un dossier. Même dossier déjà affiché : le fil est mis à jour sans être redessiné (fenêtre, « Message
  // complet » ouverts, focus et position du fil gardés) ; autre dossier : fil et composeur repris de zéro (brouillon de
  // ce dossier), fil défilant placé tout en bas une fois la vue affichée (une vue masquée n'a pas de hauteur).
  const ouvrir = (d) => {
    const meme = !!courant && courant.id === d.id && !vues.dossier.hidden;
    courant = d;
    $('[data-retour]').hidden = dossiers.length < 2;
    $('[data-d-num]').textContent = 'DOSSIER N° ' + d.id;
    $('[data-d-titre]').textContent = d.type + ' · ' + d.commune;
    $('[data-d-sous]').textContent = 'Demande du ' + fmtDate(d.cree_le) + (d.documents && d.documents.length ? ' · ' + d.documents.join(', ') : '');
    rendreTimeline(d);
    rendreDiscussion(d, meme);
    rendreRecap(d);
    montrer('dossier');
    if (!meme && filDefile()) mettreEnBas();
    accesFil();
    rafraichirDocs();
    completer(d);
  };

  $('[data-retour]').addEventListener('click', (e) => { e.preventDefault(); history.pushState(null, '', location.pathname + location.search); rendreListe(); });
  window.addEventListener('hashchange', () => {
    // Jeton ou ancien lien direct ouvert dans cet onglet, page déjà chargée : même traitement qu'au chargement
    retirerJetonAcces();
    if (retirerAncienLien() && !utilisateurCharge) {
      if (!sessionLue) ancienLien = true;
      else if (!vues.connexion.hidden && !formConnexion.hidden) erreurAdresse(ANCIEN_LIEN);
    }
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

  // Information en lecture seule sous l'étape en cours
  const infoEtape = (d, e) => {
    const box = el('div', 'info-etape');
    if (d.retracte_le) {
      box.appendChild(el('p', '', 'Vous avez renoncé au contrat le ' + fmtDate(d.retracte_le) + '.'));
      return box;
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
      ? 'Compte agence : les coordonnées bancaires s’affichent pour le client du dossier.'
      : 'Les coordonnées bancaires figurent sur votre devis.'));
  };

  // Étape en cours : les documents attendent la validation (une validation précédente, avant une nouvelle demande,
  // ne compte plus ; elle reste rappelée sous l'étape une fois faite). Demande de modification : par la discussion.
  const infoValidation = (box, d, e) => {
    box.appendChild(el('p', '', 'Vos documents vous ont été envoyés par e-mail' + (e.debut_le ? ' le ' + fmtDate(e.debut_le) : '') + ' : validez-les depuis le lien reçu, ou écrivez-nous dans la discussion pour demander une modification.'));
  };

  // Lecture « infos_espace » quand elle sert : virement attendu. Compte agence ouvert sur l'espace client (même
  // navigateur) : rien n'est demandé (la fonction réserve ces informations au client).
  const besoinInfos = (d) => !d.retracte_le && d.etape === 'paiement' && !!d.montant_cents && !d.paye_le;
  const appliquer = (d, r) => {
    const zone = $('[data-virement]');
    if (zone) blocVirement(zone, d, r);
  };
  const completer = (d) => {
    if (!besoinInfos(d)) return;
    if (compteAgence(d)) { appliquer(d, { agence: true }); return; }
    const id = d.id;
    if (!infos[id]) infos[id] = api.infosEspace(id).catch(() => ({ echec: true }));
    infos[id].then((r) => { if (utilisateurCharge && courant && courant.id === id) appliquer(courant, r); });
  };

  // ---------- Discussion : fil (messages et étapes clés) ----------
  // Fil chronologique : messages vérifiés (le compte agence voit aussi les autres : filtrés) et étapes clés ; à date
  // égale, l'étape clé avant le message, puis par id. Fenêtre des 40 derniers éléments, « Afficher les messages
  // précédents » montre tout ; tant que la fiche est affichée, la fenêtre ne se réduit jamais. Mise à jour par id
  // (data-id) : seuls les éléments nouveaux ou changés sont dessinés, un élément qui contient le focus n'est remplacé
  // qu'au tour suivant, les « Message complet » ouverts restent ouverts. Aucune zone live dans le fil.
  const listeFil = $('[data-discussion]');
  const boutonPlus = $('[data-discussion-plus]');
  const videDiscussion = $('[data-discussion-vide]');
  const VIDE_CLIENT = videDiscussion.textContent;
  const VIDE_AGENCE = 'Aucun message pour le moment.';
  const FENETRE = 40;
  const JALONS = {
    demande_recue: 'Demande reçue', devis_envoye: 'Devis envoyé', devis_signe: 'Devis signé', paiement_recu: 'Paiement reçu',
    documents_prets: 'Documents prêts', documents_valides: 'Documents validés', retractation: 'Rétractation reçue', dossier_clos: 'Dossier clos'
  };
  const ORDRE_JALONS = Object.keys(JALONS);
  const fil = { debut: undefined, ouverts: new Set() };   // fenêtre (premier élément montré ; null : tout) et détails ouverts
  const signatures = new WeakMap();                         // élément dessiné → contenu qu'il montre
  const complets = new Map();                               // id de message → texte intégral (promesse), lu une fois
  const ajouts = new Map();                                 // id de dossier → lignes renvoyées par l'envoi, jusqu'à la relecture qui les contient
  // Ancrage de défilement natif (Chromium, Firefox) ; sinon (Safari) la page compense elle-même.
  const ancrageNatif = !!(window.CSS && CSS.supports && CSS.supports('overflow-anchor', 'auto'));
  // Fil défilant (tableau de bord, écran assez haut) : le fil défile seul dans le panneau de la discussion. Déduit de son
  // overflow-y calculé, sans seuil en double avec la feuille de style ; sinon (une colonne, écran bas), le fil est dans
  // la page, comme avant. « En bas » : à 40 px près.
  const filDefile = () => /^(auto|scroll)$/.test(getComputedStyle(listeFil).overflowY);
  const filEnBas = () => listeFil.scrollHeight - listeFil.scrollTop - listeFil.clientHeight <= 40;
  let basFil = true;      // fil en bas : placé là par la page, ou laissé là par le visiteur
  let pose = -1;          // position (scrollTop) où la page a mis le fil en bas
  let defilant = false;   // fil défilant au dernier changement de taille
  const mettreEnBas = () => { listeFil.scrollTop = listeFil.scrollHeight; pose = listeFil.scrollTop; basFil = true; };
  // Clavier : le fil (nom « Discussion », aria-labelledby dans le HTML) n'est focalisable que s'il défile et déborde.
  // Focalisé quand il cesse de défiler (zoom, fenêtre rétrécie ou abaissée), il garde le focus, hors de la tabulation
  // (tabindex -1), jusqu'à ce qu'il le perde.
  const accesFil = () => {
    if (filDefile() && listeFil.scrollHeight > listeFil.clientHeight) listeFil.setAttribute('tabindex', '0');
    else if (document.activeElement === listeFil) listeFil.setAttribute('tabindex', '-1');
    else listeFil.removeAttribute('tabindex');
  };
  listeFil.addEventListener('blur', () => accesFil());
  // Panneau des documents qui défile et déborde (trois colonnes, écran assez haut) : hors de la tabulation (tabindex -1 ;
  // Firefox en ferait sinon un arrêt sans nom) ; il défile au clavier depuis ses « Télécharger ». Même règle que le fil
  // s'il a le focus (clic dans le panneau).
  const panneauDocs = $('.tableau-docs');
  const accesDocs = () => {
    if (/^(auto|scroll)$/.test(getComputedStyle(panneauDocs).overflowY) && panneauDocs.scrollHeight > panneauDocs.clientHeight) panneauDocs.setAttribute('tabindex', '-1');
    else if (document.activeElement !== panneauDocs) panneauDocs.removeAttribute('tabindex');
  };
  panneauDocs.addEventListener('blur', () => accesDocs());
  // Défilement du fil : le visiteur quitte le bas ou y revient. Celui de la page (fil mis en bas, position notée) le
  // laisse en bas, même compté après un changement de mise en page (polices chargées entre-temps). Dès que le visiteur
  // défile ailleurs, la position notée ne compte plus : y revenir après un ajout dessous (« Message complet », message
  // reçu) n'est pas être en bas.
  listeFil.addEventListener('scroll', () => {
    basFil = filEnBas() || listeFil.scrollTop === pose;
    if (listeFil.scrollTop !== pose) pose = -1;
  }, { passive: true });
  // « Message complet » ouvert : le visiteur lit, la bulle qui grandit ne ramène pas le fil en bas ; refermé : le fil
  // suit de nouveau le bas s'il y est (toggle, detailComplet).
  listeFil.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('summary')) basFil = false; });
  // Taille du fil ou de ses éléments changée (fenêtre, passage d'une mise en page à l'autre, composeur qui grandit,
  // polices chargées après le premier rendu) : fil remis en bas s'il devient défilant ou s'il était en bas ; accès au
  // clavier du fil et du panneau des documents mis à jour. Éléments du fil observés de nouveau à chaque rendu
  // (observerFil).
  const suivreFil = () => {
    accesDocs();
    const d = filDefile();
    if (d && (!defilant || basFil)) mettreEnBas();
    defilant = d;
    accesFil();
  };
  const observateur = window.ResizeObserver ? new ResizeObserver(suivreFil) : null;
  const observerFil = () => {
    if (!observateur) return;
    observateur.disconnect();
    observateur.observe(listeFil);
    Array.from(listeFil.children).forEach((li) => observateur.observe(li));
  };
  if (observateur) observerFil(); else window.addEventListener('resize', suivreFil);

  // Panneaux collants (discussion, documents ; écran assez haut) et erreur de la page collée sous la barre (tableau de
  // bord) : Firefox ne fait défiler ni un élément focalisé déjà en partie visible dans un panneau, ni un élément passé
  // sous la barre de navigation (panneaux repoussés vers le haut en bas de page) ou sous l'erreur. Focus au clavier dans
  // un panneau collant, ou n'importe où dans la fiche tant que l'erreur est collée : l'élément (zone de dépôt pour le
  // champ de fichiers) qui n'est pas entier, contour compris, sous la barre (et l'erreur) et dans les zones qui défilent
  // est ramené au centre, deux images plus tard, une fois le défilement natif fait (WebKit le fait parfois après la
  // première ; Chromium et WebKit, qui le font, ne bougent pas). Rien au clic de souris (le bouton ne fuit pas sous le
  // pointeur), ni pour un élément plus haut que la place.
  const barreNav = $('.nav');
  const auClavier = (a) => { try { return a.matches(':focus-visible'); } catch (ex) { return true; } };
  vues.dossier.addEventListener('focusin', (e) => requestAnimationFrame(() => requestAnimationFrame(() => {
    const a = e.target;
    if (document.activeElement !== a || !auClavier(a)) return;
    const bande = $('[data-erreur]'), collee = !bande.hidden && getComputedStyle(bande).position === 'sticky';
    const panneau = a.closest('.discussion-bloc, .tableau-docs');
    if (!collee && (!panneau || getComputedStyle(panneau).position !== 'sticky')) return;
    const n = a.matches('input[type=file]') ? a.closest('.dropzone') || a : a;
    const cs = getComputedStyle(a), o = cs.outlineStyle === 'none' ? 0 : Math.max(0, parseFloat(cs.outlineOffset) + parseFloat(cs.outlineWidth));
    let haut = Math.max(barreNav.getBoundingClientRect().bottom, collee ? bande.getBoundingClientRect().bottom : 0), bas = window.innerHeight;
    for (let z = n.parentElement; z && z !== vues.dossier; z = z.parentElement) {
      if (!/^(auto|scroll)$/.test(getComputedStyle(z).overflowY) || z.scrollHeight <= z.clientHeight) continue;
      const q = z.getBoundingClientRect();
      haut = Math.max(haut, q.top + z.clientTop); bas = Math.min(bas, q.top + z.clientTop + z.clientHeight);
    }
    const b = n.getBoundingClientRect();
    if (b.height + 2 * o > bas - haut) return;
    if (b.top - o < haut - 0.5 || b.bottom + o > bas + 0.5) n.scrollIntoView({ block: 'center', inline: 'nearest' });
  })));

  // Téléchargement par un lien signé. Un nouvel essai efface l'échec précédent (en tableau de bord, l'erreur resterait
  // sinon au-dessus des colonnes jusqu'au prochain chargement des dossiers).
  const ECHEC_TELECHARGEMENT = 'Téléchargement impossible pour le moment.';
  const telecharger = (chemin, nom) => {
    if ($('[data-erreur]').textContent === ECHEC_TELECHARGEMENT) erreur('');
    return api.lien(chemin, nom).then((url) => { if (url && url !== '#') location.assign(url); }).catch(() => erreur(ECHEC_TELECHARGEMENT));
  };
  // Pièces d'un message : « Télécharger » une fois rangées ; sans chemin (message que le moteur de l'agence n'a pas
  // encore traité) : en cours de rangement.
  const listePieces = (pieces) => {
    const ul = el('ul', 'pieces');
    ul.setAttribute('role', 'list');
    ul.setAttribute('aria-label', 'Pièces jointes');
    pieces.forEach((pc) => {
      const li = el('li');
      const taille = Number(pc.taille) > 0 ? ' · ' + fmtTaille(Number(pc.taille)) : '';
      li.appendChild(el('span', '', pc.nom + taille + (pc.chemin ? '' : ' · en cours de rangement')));
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
  // « Message complet » d'un e-mail du client (le moteur coupe le texte au premier repère de citation) : texte_complet
  // lu à la première ouverture, gardé en mémoire.
  const remplirComplet = (id, p, repli) => {
    if (!complets.has(id)) complets.set(id, api.texteComplet(id).catch((ex) => { complets.delete(id); throw ex; }));
    if (!p.textContent) p.textContent = 'Chargement…';
    const pour = utilisateurCharge;
    complets.get(id).then((t) => { if (utilisateurCharge === pour) p.textContent = String(t || '').trim() || repli || 'Message sans texte'; },
      () => { if (utilisateurCharge === pour) p.textContent = 'Message complet indisponible pour le moment. Réessayez dans quelques minutes.'; });
  };
  const detailComplet = (m) => {
    const det = el('details', 'msg-complet');
    det.appendChild(el('summary', 'link-more', 'Message complet'));
    const p = el('p', 'msg-texte');
    det.appendChild(p);
    const cle = String(m.id), lire = () => remplirComplet(m.id, p, String(m.texte || '').trim());
    det.addEventListener('toggle', () => { if (det.open) { fil.ouverts.add(cle); lire(); } else { fil.ouverts.delete(cle); basFil = filEnBas(); } });
    if (fil.ouverts.has(cle)) { det.open = true; lire(); }
    return det;
  };
  // En-tête d'une bulle : auteur, date et heure, canal ; chaque partie insécable (la ligne se coupe entre les parties,
  // après « · » : espace insécable avant lui, une ligne ne commence jamais par « · »).
  const enTete = (parties) => {
    const p = el('p', 'msg-meta');
    parties.filter(Boolean).forEach((x, i) => { if (i) p.appendChild(document.createTextNode('\u00a0· ')); p.appendChild(el('span', 'insecable', x)); });
    return p;
  };
  // Bulle d'un message : le client (« Vous », à droite) ou l'agence (« Atomes studio », à gauche) ; auteur toujours écrit.
  const ligneMessage = (m) => {
    const agence = m.auteur === 'agence';
    const li = el('li', 'msg ' + (agence ? 'msg--autre' : 'msg--moi'));
    const canal = agence ? '' : m.origine === 'espace' ? 'depuis votre espace' : 'par e-mail';
    li.appendChild(enTete([agence ? 'Atomes studio' : 'Vous', fmtHeure(m.recu_le), canal]));
    const texte = String(m.texte || '').trim();
    const pieces = (Array.isArray(m.pieces) ? m.pieces : []).filter((pc) => pc && pc.nom);
    if (texte || !pieces.length) li.appendChild(el('p', 'msg-texte', texte || 'Message sans texte'));
    if (!agence && m.origine !== 'espace') li.appendChild(detailComplet(m));
    if (pieces.length) li.appendChild(listePieces(pieces));
    return li;
  };
  const ligneJalon = (texte) => { const li = el('li', 'jalon'); li.appendChild(el('span', '', texte)); return li; };

  const temps = (iso) => { const t = new Date(iso).getTime(); return isNaN(t) ? 0 : t; };
  const comparer = (a, b) => a.t - b.t || a.rang - b.rang || a.n - b.n;
  // Éléments du fil, triés : { cle (data-id), t, rang (0 : étape clé, 1 : message), n, message, sig, creer }
  const elementsFil = (d) => {
    const items = [];
    (Array.isArray(d.evenements) ? d.evenements : []).forEach((ev) => {
      if (!ev || !JALONS[ev.type] || !dateValide(ev.le)) return;
      const texte = JALONS[ev.type] + '\u00a0· ' + fmtDate(ev.le);
      items.push({ cle: 'jalon-' + ev.type + '-' + ev.le, t: temps(ev.le), rang: 0, n: ORDRE_JALONS.indexOf(ev.type), message: false, sig: texte, creer: () => ligneJalon(texte) });
    });
    (Array.isArray(d.messages) ? d.messages : []).forEach((m) => {
      if (!m || m.verifie === false || m.id === null || m.id === undefined) return;
      items.push({ cle: String(m.id), t: temps(m.recu_le), rang: 1, n: Number(m.id) || 0, message: true,
        sig: JSON.stringify([m.auteur, m.origine, m.recu_le, m.texte, m.pieces]), creer: () => ligneMessage(m) });
    });
    return items.sort(comparer);
  };
  // Ancre de défilement de la page, fil dans la page (même règle que l'espace agence) : le champ qui a le focus s'il est
  // à l'écran (l'ancrage natif le prend en priorité), sinon le premier élément visible parmi les éléments du fil gardés à
  // ce rendu, le composeur et les blocs qui suivent la discussion (documents, dans .tableau-docs, et Votre demande ; en
  // colonnes, ils ne bougent pas avec le fil et ne servent que si rien de la discussion n'est à l'écran)
  const aLEcran = (n) => { const r = n.getBoundingClientRect(); return r.height > 0 && r.bottom > 0 && r.top < window.innerHeight; };
  const choisirAncre = (gardes) => {
    const a = document.activeElement;
    if (a && /^(TEXTAREA|INPUT)$/.test(a.tagName) && aLEcran(a)) return a;
    return Array.from(listeFil.children).filter((li) => gardes.has(li)).concat($$('.composeur, .tableau-docs > .bloc, .discussion-bloc ~ .bloc', vues.dossier)).find(aLEcran) || null;
  };
  // Repère du fil défilant : premier élément du fil gardé à ce rendu et visible dans le fil
  const repereFil = (gardes) => {
    const r = listeFil.getBoundingClientRect();
    return Array.from(listeFil.children).filter((li) => gardes.has(li))
      .find((li) => { const b = li.getBoundingClientRect(); return b.height > 0 && b.bottom > r.top && b.top < r.bottom; }) || null;
  };

  // premier : premier dessin de la fiche, ou fil entier montré (rien à compenser ; la position est fixée par l'appelant)
  const majFil = (d, premier) => {
    const items = elementsFil(d);
    if (fil.debut === undefined) fil.debut = items.length > FENETRE ? items[items.length - FENETRE] : null;
    const visibles = fil.debut ? items.filter((it) => comparer(it, fil.debut) >= 0) : items;
    boutonPlus.hidden = visibles.length === items.length;
    videDiscussion.hidden = items.some((it) => it.message);
    const actif = document.activeElement;
    const existants = new Map(Array.from(listeFil.children).map((li) => [li.dataset.id, li]));
    const gardes = new Set();
    const noeuds = visibles.map((it) => {
      const li = existants.get(it.cle);
      if (li && (signatures.get(li) === it.sig || li.contains(actif))) { gardes.add(li); return li; }
      const n = it.creer();
      n.dataset.id = it.cle;
      signatures.set(n, it.sig);
      return n;
    });
    // Fil défilant en bas avant la mise à jour : il y reste (nouveau message visible). Sinon, sans ancrage natif, du
    // contenu ajouté au-dessus de la zone visible ferait bouger le fil (fil défilant : compensé par son scrollTop) ou la
    // page (fil dans la page : compensée par window.scrollBy).
    const defile = !premier && filDefile();
    const bas = defile && filEnBas();
    const ancre = premier || bas || ancrageNatif ? null : defile ? repereFil(gardes) : window.scrollY > 0 ? choisirAncre(gardes) : null;
    const haut = ancre ? ancre.getBoundingClientRect().top : 0;
    existants.forEach((li) => { if (!gardes.has(li) && !li.contains(actif)) li.remove(); });
    noeuds.forEach((n, i) => { if (listeFil.children[i] !== n) listeFil.insertBefore(n, listeFil.children[i] || null); });
    if (bas) mettreEnBas();
    else if (ancre) {
      const dy = ancre.getBoundingClientRect().top - haut;
      if (Math.abs(dy) >= 1) { if (defile) listeFil.scrollTop += dy; else window.scrollBy(0, dy); }
    }
    accesFil();
    observerFil();
  };

  // « Afficher les messages précédents » : tout le fil ; focus sur le premier élément nouvellement montré
  boutonPlus.addEventListener('click', () => {
    if (!courant) return;
    fil.debut = null;
    majFil(courant, true);
    const premierLi = listeFil.firstElementChild;
    if (premierLi) { premierLi.setAttribute('tabindex', '-1'); premierLi.focus(); }
  });

  // Impression (conditions générales, article 18 : la discussion s'imprime ou s'enregistre en PDF, chaque message avec
  // sa date et son heure) : fil entier montré avant l'impression, comme avec « Afficher les messages précédents » (qui
  // garde alors le focus s'il l'avait) ; il le reste ensuite, la fenêtre ne se réduisant jamais. beforeprint (Chromium,
  // Firefox, Safari), page encore à l'écran : position du fil gardée comme à une mise à jour. Passage au média print
  // sans beforeprint (Firefox et WebKit en émulation) : page déjà mise en page pour l'impression, rien à compenser.
  const filEntier = (ecran) => {
    if (!courant || vues.dossier.hidden || !fil.debut) return;
    const bouton = document.activeElement === boutonPlus;
    fil.debut = null;
    majFil(courant, !ecran);
    const premierLi = listeFil.firstElementChild;
    if (bouton && premierLi) { premierLi.setAttribute('tabindex', '-1'); premierLi.focus({ preventScroll: true }); }
  };
  window.addEventListener('beforeprint', () => filEntier(true));
  const mediaImpression = window.matchMedia ? window.matchMedia('print') : null;
  const versImpression = (e) => { if (e.matches) filEntier(false); };
  if (mediaImpression && mediaImpression.addEventListener) mediaImpression.addEventListener('change', versImpression);
  else if (mediaImpression && mediaImpression.addListener) mediaImpression.addListener(versImpression);

  // Ligne renvoyée par l'envoi (ou déjà enregistrée) : ajoutée au dossier une seule fois, et gardée jusqu'à la
  // relecture qui la contient (une relecture partie avant l'envoi ne la fait pas disparaître).
  const ajouterLigne = (d, m) => {
    if (!m || m.id === null || m.id === undefined) return;
    d.messages = Array.isArray(d.messages) ? d.messages : [];
    if (!d.messages.some((x) => x && String(x.id) === String(m.id))) d.messages.push(m);
    if (!ajouts.has(d.id)) ajouts.set(d.id, new Map());
    ajouts.get(d.id).set(String(m.id), m);
  };
  const fusionner = (d, r) => {
    const lus = (Array.isArray(r.messages) ? r.messages : []).filter(Boolean);
    const vus = new Set(lus.map((m) => String(m.id)));
    const attente = ajouts.get(d.id);
    if (attente) attente.forEach((m, cle) => { if (vus.has(cle)) attente.delete(cle); else lus.push(m); });
    d.messages = lus;
    if (Array.isArray(r.evenements)) d.evenements = r.evenements;
  };
  const cheminsPieces = (d) => (Array.isArray(d.messages) ? d.messages : []).flatMap((m) => (m && Array.isArray(m.pieces) ? m.pieces : []).map((pc) => (pc && pc.chemin) || '')).filter(Boolean);

  // Rafraîchissement du dossier ouvert : toutes les 30 s (onglet visible, fiche affichée) et au retour sur l'onglet.
  // Réponse ignorée si le dossier affiché ou le compte a changé ; échec silencieux (nouvel essai au tour suivant). Étape
  // clé nouvelle (devis envoyé, paiement reçu…) : le dossier a changé (étape, montant, documents) ; il est relu en entier
  // et la fiche redessinée (ouvrir sur le même dossier : fil, fenêtre, détails ouverts, brouillon et focus gardés ;
  // coordonnées de virement relues). Sans étape clé nouvelle, projets n'est pas relu.
  let relecture = false;
  const clesJalons = (d) => new Set((Array.isArray(d.evenements) ? d.evenements : []).filter(Boolean).map((ev) => ev.type + '|' + ev.le));
  const rafraichir = () => {
    if (relecture || !courant || !utilisateurCharge || vues.dossier.hidden || document.visibilityState !== 'visible') return;
    const d = courant, pour = utilisateurCharge;
    relecture = true;
    api.relire(d.id).then((r) => {
      if (utilisateurCharge !== pour || courant !== d || vues.dossier.hidden || !r) return;
      const avant = new Set(cheminsPieces(d)), jalonsAvant = clesJalons(d);
      fusionner(d, r);
      majFil(d, false);
      if (cheminsPieces(d).some((c) => !avant.has(c))) rafraichirDocs();   // pièces nouvellement rangées
      if (![...clesJalons(d)].some((k) => !jalonsAvant.has(k))) return;
      return api.dossiers().then((liste) => {
        if (utilisateurCharge !== pour || courant !== d || vues.dossier.hidden) return;
        const d2 = (liste || []).find((x) => x.id === d.id);
        if (!d2) return;
        fusionner(d2, d2);   // lignes envoyées en attente de relecture gardées
        dossiers = liste; infos = {};
        ouvrir(d2);
      });
    }).catch(() => {}).then(() => { relecture = false; });
  };
  setInterval(rafraichir, 30000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') rafraichir(); });

  // ---------- Discussion : composeur ----------
  // Brouillon par dossier (texte, fichiers, cle d'envoi, erreurs), en mémoire seulement : jamais dans un stockage, une
  // URL, un attribut ni un journal ; vidé après un envoi réussi et à la déconnexion. Limites du formulaire de devis :
  // 10 fichiers, 10 Mo au total, JPG, PNG, GIF, WEBP, HEIC, PDF ; texte de 5 000 caractères au plus.
  const formMessage = $('[data-form-message]');
  const champMessage = $('#e-message');
  const champFichiers = $('[data-message-fichiers]');
  const zoneDepot = $('.dropzone', formMessage);
  const listeFichiers = $('[data-message-liste]');
  const compteur = $('[data-message-compte]');
  const zoneErreur = $('#e-message-err');
  const statutMessage = $('[data-message-statut]');
  const btnMessage = $('[data-btn-message]');
  const MAX_OCTETS = 10 * 1024 * 1024, MAX_FICHIERS = 10, MAX_TEXTE = 5000;
  const EXT_OK = /\.(jpe?g|png|gif|webp|heic|heif|pdf)$/i;
  const ERREURS_TEXTE = { vide: 'Écrivez un message ou joignez un fichier.', long: 'Message trop long : 5 000 caractères au plus.' };
  const ECHEC_RESEAU = 'Envoi impossible pour le moment. Réessayez dans quelques minutes, ou répondez à l\'un de nos e-mails.';
  const brouillons = new Map();
  const brouillon = (id) => {
    if (!brouillons.has(id)) brouillons.set(id, { texte: '', fichiers: [], cle: null, envoi: false, errTexte: '', refus: '', errEnvoi: '' });
    return brouillons.get(id);
  };
  const brouillonCourant = () => (courant && !compteAgence(courant) && !vues.dossier.hidden ? brouillon(courant.id) : null);
  // Clé anti-doublon d'un envoi : uuid v4 (crypto.randomUUID, absent hors contexte sécurisé et avant Safari 15.4)
  const nouvelleCle = () => {
    if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const o = crypto.getRandomValues(new Uint8Array(16));
    o[6] = (o[6] & 0x0f) | 0x40; o[8] = (o[8] & 0x3f) | 0x80;
    const x = Array.from(o, (v) => v.toString(16).padStart(2, '0')).join('');
    return x.slice(0, 8) + '-' + x.slice(8, 12) + '-' + x.slice(12, 16) + '-' + x.slice(16, 20) + '-' + x.slice(20);
  };
  const erreurTexte = (b) => { const t = b.texte.trim(); return !t && !b.fichiers.length ? 'vide' : t.length > MAX_TEXTE ? 'long' : ''; };
  const limiteFichiers = (b) => (b.fichiers.length > MAX_FICHIERS ? MAX_FICHIERS + ' pièces jointes maximum.'
    : b.fichiers.reduce((a, f) => a + f.size, 0) > MAX_OCTETS ? 'Pièces jointes trop lourdes — 10 Mo max au total.' : '');
  const invalide = (champ, oui) => { if (oui) champ.setAttribute('aria-invalid', 'true'); else champ.removeAttribute('aria-invalid'); };

  // Erreurs du composeur : texte (après un essai d'envoi, retirée dès la correction), fichiers (dès l'ajout), envoi.
  const dessinerErreurs = (b) => {
    if (b.errTexte && erreurTexte(b) !== b.errTexte) b.errTexte = '';
    const fichiers = [b.refus, limiteFichiers(b)].filter(Boolean).join(' ');
    const msg = [b.errTexte ? ERREURS_TEXTE[b.errTexte] : '', fichiers, b.errEnvoi].filter(Boolean).join(' ');
    if (zoneErreur.textContent !== msg) zoneErreur.textContent = msg;
    zoneErreur.hidden = !msg;
    invalide(champMessage, !!b.errTexte);
    invalide(champFichiers, !!fichiers);
  };
  // Compteur au-delà de 4 500 caractères (zone non live)
  const dessinerCompteur = () => {
    const n = champMessage.value.trim().length;
    compteur.hidden = n <= 4500;
    compteur.textContent = n > 4500 ? String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' / 5 000 caractères' : '';
  };
  // Puces des fichiers choisis, avec « × » (Retirer <nom>)
  const dessinerFichiers = (b) => {
    const n = b.fichiers.length;
    $('[data-message-label]', formMessage).textContent = n ? n + ' fichier' + (n > 1 ? 's' : '') + ' sélectionné' + (n > 1 ? 's' : '') : 'Aucun fichier sélectionné';
    listeFichiers.textContent = '';
    listeFichiers.hidden = !n;
    b.fichiers.forEach((f, i) => {
      const puce = el('span', 'file-chip');
      puce.appendChild(el('span', '', f.name + ' · ' + fmtTaille(f.size)));
      const x = el('button', '', '×'); x.type = 'button';
      x.setAttribute('aria-label', 'Retirer ' + f.name);
      if (b.envoi) x.setAttribute('aria-disabled', 'true');
      x.addEventListener('click', () => retirerFichier(i));
      puce.appendChild(x);
      listeFichiers.appendChild(puce);
    });
  };
  // Pendant l'envoi : texte en lecture seule (le focus reste), fichiers figés, bouton en aria-disabled (il garde le
  // focus ; le brouillon empêche le double envoi).
  const etatEnvoi = (b) => {
    champMessage.readOnly = b.envoi;
    champFichiers.disabled = b.envoi;
    if (b.envoi) btnMessage.setAttribute('aria-disabled', 'true'); else btnMessage.removeAttribute('aria-disabled');
    btnMessage.textContent = b.envoi ? 'Envoi…' : 'Envoyer';
    $$('button', listeFichiers).forEach((x) => { if (b.envoi) x.setAttribute('aria-disabled', 'true'); else x.removeAttribute('aria-disabled'); });
  };
  // Composeur du dossier affiché ; compte agence : remplacé par une phrase. nouveau : autre dossier (puces redessinées,
  // annonce vidée).
  const rendreComposeur = (d, nouveau) => {
    const agence = compteAgence(d);
    formMessage.hidden = agence;
    $('[data-composeur-agence]').hidden = !agence;
    videDiscussion.textContent = agence ? VIDE_AGENCE : VIDE_CLIENT;
    if (nouveau) statutMessage.textContent = '';
    if (agence) return;
    const b = brouillon(d.id);
    if (champMessage.value !== b.texte) champMessage.value = b.texte;
    if (nouveau) dessinerFichiers(b);
    dessinerCompteur(); etatEnvoi(b); dessinerErreurs(b);
  };
  const rendreDiscussion = (d, meme) => {
    if (!meme) { fil.debut = undefined; fil.ouverts.clear(); listeFil.textContent = ''; }
    majFil(d, !meme);
    rendreComposeur(d, !meme);
  };
  // Déconnexion : fil, brouillons et fichiers choisis oubliés (ordinateur partagé)
  const oublierDiscussion = () => {
    brouillons.clear(); ajouts.clear(); complets.clear();
    fil.debut = undefined; fil.ouverts.clear();
    listeFil.textContent = ''; boutonPlus.hidden = true; videDiscussion.hidden = true;
    accesFil(); observerFil();
    champMessage.value = ''; champMessage.readOnly = false; invalide(champMessage, false);
    champFichiers.value = ''; champFichiers.disabled = false; invalide(champFichiers, false);
    dessinerFichiers({ fichiers: [], envoi: false });
    compteur.textContent = ''; compteur.hidden = true;
    zoneErreur.textContent = ''; zoneErreur.hidden = true;
    statutMessage.textContent = '';
    btnMessage.removeAttribute('aria-disabled'); btnMessage.textContent = 'Envoyer';
  };

  // Fichiers ajoutés (choix ou glisser-déposer) : formats contrôlés, doublons (nom et taille) ignorés, nombre et poids
  // contrôlés dès l'ajout puis à l'envoi.
  const ajouterFichiers = (liste) => {
    const b = brouillonCourant();
    if (!b || b.envoi) return;
    const refuses = [];
    const deja = new Set(b.fichiers.map((f) => f.name + '|' + f.size));
    Array.from(liste || []).forEach((f) => {
      if (!EXT_OK.test(f.name)) { refuses.push(f.name); return; }
      if (deja.has(f.name + '|' + f.size)) return;
      deja.add(f.name + '|' + f.size); b.fichiers.push(f);
    });
    b.refus = refuses.length ? 'Format non pris en charge (JPG, PNG, GIF, WEBP, HEIC et PDF uniquement) : ' + refuses.join(', ') : '';
    b.cle = null; b.errEnvoi = '';
    dessinerFichiers(b); dessinerErreurs(b);
  };
  // « Retirer » : focus sur le « × » suivant, sinon le précédent, sinon le champ de fichiers
  const retirerFichier = (i) => {
    const b = brouillonCourant();
    if (!b || b.envoi) return;
    b.fichiers.splice(i, 1);
    b.refus = ''; b.cle = null; b.errEnvoi = '';
    dessinerFichiers(b); dessinerErreurs(b);
    const boutons = $$('button', listeFichiers);
    (boutons[i] || boutons[i - 1] || champFichiers).focus();
  };
  champMessage.addEventListener('input', () => {
    const b = brouillonCourant();
    if (!b) return;
    b.texte = champMessage.value; b.cle = null; b.errEnvoi = '';
    dessinerCompteur(); dessinerErreurs(b);
  });
  champFichiers.addEventListener('change', () => { ajouterFichiers(champFichiers.files); champFichiers.value = ''; });
  // Glisser-déposer sur tout le composeur ; ailleurs dans la page, un fichier lâché ne fait jamais quitter la page.
  const avecFichiers = (e) => !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'));
  formMessage.addEventListener('dragover', (e) => { if (!avecFichiers(e)) return; e.preventDefault(); zoneDepot.classList.add('is-over'); });
  formMessage.addEventListener('dragleave', (e) => { if (!formMessage.contains(e.relatedTarget)) zoneDepot.classList.remove('is-over'); });
  formMessage.addEventListener('drop', (e) => { if (!avecFichiers(e)) return; e.preventDefault(); zoneDepot.classList.remove('is-over'); ajouterFichiers(e.dataTransfer.files); });
  ['dragover', 'drop'].forEach((type) => document.addEventListener(type, (e) => {
    if (!avecFichiers(e) || (e.target && e.target.closest && e.target.closest('.composeur, .dropzone'))) return;
    e.preventDefault();
    if (type === 'dragover') e.dataTransfer.dropEffect = 'none';
  }));

  // Envoi : attaché au dossier et au compte du clic. Succès (ou message déjà enregistré) : la ligne entre dans le fil
  // (fil défilant : tout en bas, message envoyé visible), brouillon de ce dossier vidé, « Message envoyé. », focus sur le
  // champ, documents relus. Échec : brouillon gardé, erreur sous le composeur ; si un autre dossier est affiché
  // entre-temps, rien ne change à l'écran sauf l'erreur de la page (« Dossier N° … : »).
  const messageEchec = (ex) => {
    if (ex && ex.statut === 401) return 'Session expirée : reconnectez-vous.';
    if (ex && ex.statut && ex.erreur) return ex.erreur;
    return ECHEC_RESEAU;
  };
  const affiche = (id) => !!courant && courant.id === id && !vues.dossier.hidden;
  formMessage.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = courant;
    const b = brouillonCourant();
    if (!d || !b || b.envoi) return;
    statutMessage.textContent = '';
    b.texte = champMessage.value; b.refus = ''; b.errEnvoi = '';
    b.errTexte = erreurTexte(b);
    dessinerErreurs(b);
    if (b.errTexte) { champMessage.focus(); return; }
    if (limiteFichiers(b)) return;
    if (!b.cle) b.cle = nouvelleCle();
    b.envoi = true;
    etatEnvoi(b);
    const id = d.id, pour = utilisateurCharge;
    api.envoyerMessage(id, b.cle, b.texte.trim(), b.fichiers.slice()).then((j) => {
      if (utilisateurCharge !== pour) return;   // déconnecté entre-temps : brouillons déjà oubliés
      const dossier = dossiers.find((x) => x.id === id) || d;
      ajouterLigne(dossier, j.message);
      brouillons.delete(id);
      if (!affiche(id)) return;
      rendreComposeur(courant, true);
      statutMessage.textContent = 'Message envoyé.';
      champMessage.focus();
      majFil(courant, false);
      if (filDefile()) mettreEnBas();
      rafraichirDocs();
    }, (ex) => {
      if (utilisateurCharge !== pour) return;
      b.envoi = false;
      const msg = messageEchec(ex);
      if (!affiche(id)) { erreur('Dossier N° ' + id + ' : ' + msg); return; }
      b.errEnvoi = msg;
      etatEnvoi(b); dessinerErreurs(b);
    });
  });

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
    accesDocs();
  };

  // Pièces jointes des messages de l'agence (vérifiés, pièces rangées : chemin présent), déposées dans
  // <id>/agence/discussion/, hors de la liste du stockage : nom d'origine, taille, date du message. Ancienne lecture
  // (avant la migration 0006, messages sans auteur) : aucune.
  const piecesAgence = (d) => (Array.isArray(d.messages) ? d.messages : [])
    .filter((m) => m && m.auteur === 'agence' && m.verifie !== false && Array.isArray(m.pieces))
    .flatMap((m) => m.pieces.filter((pc) => pc && pc.nom && pc.chemin).map((pc) => ({ nom: pc.nom, chemin: pc.chemin, taille: Number(pc.taille) || 0, date: m.recu_le })));
  // Documents de l'agence : fichiers du stockage (agence/) et pièces des messages de l'agence, du plus récent au plus
  // ancien, sans doublon (chemin) ; texte vide seulement si les deux manquent.
  const docsAgence = (d, stockage) => {
    const vus = new Set();
    return stockage.concat(piecesAgence(d)).filter((f) => !vus.has(f.chemin) && !!vus.add(f.chemin)).sort((a, b) => temps(b.date) - temps(a.date));
  };

  // Listes relues à l'ouverture de la fiche, quand des pièces sont rangées et après un envoi
  const rafraichirDocs = () => {
    if (!courant) return;
    const id = courant.id;
    const pour = (fn) => (l) => { if (courant && courant.id === id) fn(l); };
    api.lister(id, 'agence').then(pour((l) => rendreDocs($('[data-docs-agence]'), $('[data-vide-agence]'), docsAgence(courant, l)))).catch(() => erreur('Documents de l’agence indisponibles pour le moment.'));
    api.lister(id, 'client').then(pour((l) => rendreDocs($('[data-docs-client]'), $('[data-vide-client]'), l))).catch(() => erreur('Vos documents sont indisponibles pour le moment.'));
  };

  // ---------- Session ----------
  // Connexion réussie (session reçue) et déconnexion (ici ou dans un autre onglet) : vue de connexion remise à l'étape 1,
  // adresse et code effacés. Premier affichage sans session : étape rétablie et messages d'arrivée (reprendre).
  api.surChangement((session, evt) => {
    if (evt === 'TOKEN_REFRESHED' || evt === 'USER_UPDATED') return;
    const premier = !sessionLue;
    sessionLue = true;
    if (session && session.user) {
      etapeAdresse(true);
      compte.hidden = false;
      $('[data-compte-email]').textContent = session.user.email || '';
      if (utilisateurCharge !== (session.user.id || session.user.email)) { utilisateurCharge = session.user.id || session.user.email; montrer('chargement'); charger(); }
    } else {
      const deconnexion = utilisateurCharge !== null;
      utilisateurCharge = null;
      oublier();
      compte.hidden = true;
      montrer('connexion');
      if (deconnexion) etapeAdresse(true);
      else if (premier) reprendre();
    }
  });
})();
