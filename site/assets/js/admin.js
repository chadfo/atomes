// Espace agence — connexion par code reçu par e-mail (compte inscrit dans la table admins), liste des dossiers, fiche
// d'un dossier : avancement (étapes, option de suivi administratif, note pour le client), discussion avec le client
// (messages des deux côtés et étapes clés du dossier ; un message « à vérifier » est rattaché au dossier ou supprimé ;
// message au client envoyé par e-mail, pièces jointes comprises), envoi du devis (le client le reçoit par e-mail et le
// signe depuis un lien), signature, démarrage anticipé et rétractation, virement reçu, documents de l'agence, pièces du
// client.
// Les actions qui préviennent le client ou touchent aux messages passent par la fonction « espace » ; dépôts (pièces
// jointes des messages comprises) et notes passent directement par Supabase (règles RLS de l'agence). Chaque opération
// est attachée au dossier ouvert au moment du clic : changer de fiche pendant un envoi ne la détourne pas vers un autre
// dossier. La fiche affichée est relue toutes les 30 s et au retour sur l'onglet, la liste toutes les 60 s (onglet
// visible). Mode démo sans backend : admin/?demo
(() => {
  const cfg = window.ATOMES_CONFIG || {};
  const demo = new URLSearchParams(location.search).has('demo');

  // ---------- Ancien lien direct (#connexion=<jeton>) : retiré de l'adresse avant toute autre chose ----------
  // Lien de connexion (lien direct) des e-mails envoyés à partir du soir du 19 octobre 2026, jusqu'à la mise en ligne
  // de la connexion par code : le jeton n'est ni vérifié ni envoyé nulle part ; tout le fragment quitte la barre
  // d'adresse avant la création du client Supabase et tout appel réseau. Vrai si l'adresse portait un tel lien.
  const retirerAncienLien = () => {
    const h = location.hash.replace(/^#/, '');
    if (!/(^|&)connexion=/.test(h)) return false;
    history.replaceState(null, '', location.pathname + location.search);
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
  // Connexion par code réussie : focus sur le titre de la première vue affichée ensuite (liste, fiche ou refus). Aucun
  // autre événement de session ne déplace le focus (supabase-js réémet SIGNED_IN au retour sur l'onglet).
  let titreAFocaliser = false;
  const montrer = (nom) => {
    Object.keys(vues).forEach((k) => { vues[k].hidden = k !== nom; });
    if (!titreAFocaliser || !['liste', 'dossier', 'refus'].includes(nom)) return;
    titreAFocaliser = false;
    const titre = $('h1', vues[nom]);
    if (titre) { titre.setAttribute('tabindex', '-1'); titre.focus({ preventScroll: true }); }
  };
  const erreur = (msg) => { const e = $('[data-erreur]'); e.textContent = msg || ''; e.hidden = !msg; };
  const el = (tag, cls, texte) => { const n = document.createElement(tag); if (cls) n.className = cls; if (texte !== undefined) n.textContent = texte; return n; };
  // Dates à l'heure de Paris (comme les numéros de dossier), quel que soit le fuseau de l'appareil ; « 1er » comme dans
  // les e-mails (règle premier() de la fonction « espace ») : « 1er octobre 2026 à 09:05 », « 1er oct. 2026 »
  const premier = (s) => s.replace(/(^|\s)1(\s)/, '$11er$2');
  const fmtDate = (iso) => (iso ? premier(new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' })) : '');
  const fmtCourt = (iso) => (iso ? premier(new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Paris' })) : '');
  const fmtHeure = (iso) => (iso ? premier(new Date(iso).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Paris' })) : '');
  const fmtTaille = (o) => (o >= 1048576 ? (o / 1048576).toFixed(1).replace('.', ',') + ' Mo' : Math.max(1, Math.round(o / 1024)) + ' Ko');
  const fmtNombre = (n) => new Intl.NumberFormat('fr-FR').format(n);
  const euros = (c) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format((c || 0) / 100);
  const nomSur = (nom) => (nom.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 80) || 'fichier');
  const SURFACES = [['surface_existante', 'Surface habitable existante'], ['surface', 'Surface habitable créée'], ['emprise_existante', 'Emprise au sol du bâti existant'], ['emprise', 'Emprise au sol du bâti après projet'], ['surface_terrain', 'Surface de la parcelle']];
  // Étapes qui envoient un e-mail au client quand on y fait avancer le dossier (même liste que la fonction « espace »).
  const ETAPES_MAIL = ['validation', 'instruction', 'accordee', 'clos'];
  const ECHEC = 'Action impossible pour le moment. Réessayez dans quelques minutes.';
  // « 720 », « 720,5 », « 1 200,00 » → centimes (même règle que la fonction)
  const centimes = (v) => { const s = String(v || '').replace(/[\s  €]/g, '').replace(',', '.'); if (!/^\d+(\.\d{1,2})?$/.test(s)) return null; const c = Math.round(Number(s) * 100); return c >= 100 && c <= 10000000 ? c : null; };
  // Lecture d'un dossier (migration 0006) : timeline, étapes clés (evenements) et discussion (messages des deux auteurs,
  // toutes les colonnes sauf texte_complet, lu à l'ouverture de « Message complet »). Relation ou colonne absente
  // (PGRST200, 42703 : migration 0006 pas encore appliquée) : lecture d'avant (messages(*), chacun traité comme un e-mail
  // du client), puis sans les messages (migration 0005 absente). La première lecture acceptée sert ensuite à toutes.
  const COLONNES_MESSAGES = 'id, projet_id, recu_le, auteur, origine, auteur_id, expediteur, sujet, texte, pieces, verifie, etape, resend_id, auth, traite, traitement_le, lu_agence_le, mail_etat, mail_le, cle, reprise';
  const SELECTIONS = ['*, etapes(*), evenements(*), messages(' + COLONNES_MESSAGES + ')', '*, etapes(*), questions(*), modifications(*), messages(*)', '*, etapes(*), questions(*), modifications(*)'];
  // Message au client : limites (la fonction « espace » refait les mêmes contrôles), formats des pièces jointes (ceux que
  // la fonction joint à l'e-mail : PDF ou images) et textes de refus (les mêmes que dans l'espace client)
  const MAX_TEXTE = 5000, SEUIL_COMPTE = 4500, MAX_PIECES = 10, MAX_POIDS = 50 * 1024 * 1024;
  const TYPES_PIECES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', pdf: 'application/pdf' };
  const extension = (nom) => { const x = /\.([a-z0-9]{1,5})$/i.exec(String(nom || '')); return x && TYPES_PIECES[x[1].toLowerCase()] ? x[1].toLowerCase() : ''; };
  const REFUS = {
    vide: 'Écrivez un message ou joignez un fichier.',
    long: 'Message trop long : 5 000 caractères au plus.',
    nombre: '10 pièces jointes maximum.',
    format: 'Format non pris en charge (JPG, PNG, GIF, WEBP, HEIC et PDF uniquement) : ',
    poids: 'Fichier trop lourd (50 Mo max) : '
  };

  // ---------- Accès aux données ----------
  const apiSupabase = () => {
    // detectSessionInUrl: false : un #access_token=… dans l'adresse n'ouvre jamais de session (connexion forcée à un
    // autre compte) ; seule la connexion par code en ouvre une.
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { detectSessionInUrl: false } });
    const ok = (r) => { if (r.error) throw r.error; return r.data; };
    const urlEspace = cfg.espaceUrl || cfg.supabaseUrl.replace(/\/$/, '') + '/functions/v1/espace';
    const absente = (e) => !!e && (e.code === 'PGRST200' || e.code === '42703' || /relationship|does not exist/i.test(String(e.message || '')));
    let lecture = 0;   // première sélection acceptée par la base (SELECTIONS)
    const lireDossiers = (requete) => {
      const essai = (i) => requete(SELECTIONS[i]).then((r) => { lecture = i; return r; }, (e) => { if (i + 1 < SELECTIONS.length && absente(e)) return essai(i + 1); throw e; });
      return essai(lecture);
    };
    return {
      surChangement: (fn) => sb.auth.onAuthStateChange((evt, session) => fn(session, evt)),
      // Code de connexion envoyé par e-mail (modèle « Magic link » à code) ; aucune adresse de retour : la page n'ouvre
      // jamais de session depuis un lien.
      connexion: (email) => sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } }).then(ok),
      // Code saisi (POST /auth/v1/verify) : session enregistrée par supabase-js, puis événement SIGNED_IN.
      verifierCode: (email, code) => sb.auth.verifyOtp({ email, token: code, type: 'email' }).then(ok)
        .then((d) => { if (!d || !d.session) throw new Error('session absente'); return d; }),
      deconnexion: () => sb.auth.signOut(),
      estAdmin: (uid) => sb.from('admins').select('user_id').eq('user_id', uid).maybeSingle().then(ok).then((d) => !!d),
      dossiers: () => lireDossiers((s) => sb.from('projets').select(s).order('cree_le', { ascending: false }).then(ok)),
      lister: (id, dossier) => sb.storage.from('dossiers').list(id + '/' + dossier, { limit: 200, sortBy: { column: 'created_at', order: 'desc' } }).then(ok)
        .then((objets) => objets.filter((o) => o.name && !o.name.startsWith('.') && o.id)
          .map((o) => ({ nom: o.name, chemin: id + '/' + dossier + '/' + o.name, taille: (o.metadata && o.metadata.size) || 0, date: o.created_at }))),
      lien: (chemin, nom, lire) => sb.storage.from('dossiers').createSignedUrl(chemin, 600, lire ? undefined : { download: nom }).then(ok).then((d) => d.signedUrl),
      // Un fichier part en multipart avec son propre type ; `type` (pièce jointe d'un message : type déduit de
      // l'extension) le remplace si le navigateur n'a pas donné le même (HEIC souvent sans type)
      deposer: (chemin, fichier, remplacer, type) => sb.storage.from('dossiers').upload(chemin, type && fichier.type !== type ? new Blob([fichier], { type }) : fichier,
        { upsert: !!remplacer, contentType: fichier.type || undefined }).then(ok),
      supprimer: (chemin) => sb.storage.from('dossiers').remove([chemin]).then(ok),
      relire: (id) => lireDossiers((s) => sb.from('projets').select(s).eq('id', id).maybeSingle().then(ok)),
      // Texte intégral d'un e-mail du client (citation de nos e-mails comprise), lu à la demande
      texteComplet: (id) => sb.from('messages').select('id, texte_complet').eq('id', id).maybeSingle().then(ok).then((r) => (r && typeof r.texte_complet === 'string' ? r.texte_complet : '')),
      note: (id, cle, note) => sb.from('etapes').update({ note: note || null }).eq('projet_id', id).eq('cle', cle).then(ok),
      action: async (nom, projet, corps) => {
        const { data } = await sb.auth.getSession();
        let r;
        try {
          r = await fetch(urlEspace, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (data && data.session ? data.session.access_token : ''), 'apikey': cfg.supabaseAnonKey },
            body: JSON.stringify(Object.assign({ action: nom, projet }, corps || {}))
          });
        } catch (ex) { throw new Error('Connexion impossible : vérifiez votre accès à Internet, puis réessayez.'); }
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) { const e = new Error(j.erreur || ECHEC); e.statut = r.status; throw e; }
        return j;
      }
    };
  };

  // Démo : quelques dossiers à différents stades, actions simulées (même modèle d'étapes que les migrations 0004 et 0005).
  const MODELE = [
    ['demande', 'Demande reçue', 'Votre demande nous est bien parvenue.', false, true, null],
    ['traitement', 'Traitement de votre demande', 'Nous étudions votre projet et pouvons vous poser quelques questions pour affiner votre demande.', false, false, 'questions'],
    ['devis', 'Production de votre devis', 'Nous préparons votre devis.', false, false, null],
    ['signature', 'Validation de votre devis', 'Votre devis est prêt\u00a0: lisez-le, puis signez-le en ligne.', false, false, 'signer'],
    ['paiement', 'Paiement', 'Réglez par virement le montant indiqué, en précisant la référence de votre dossier.', false, false, 'payer'],
    ['production', 'Production de vos documents', 'Nous réalisons vos documents.', false, false, null],
    ['validation', 'Validation de vos documents', 'Vos documents sont prêts\u00a0: vérifiez-les, puis validez-les ou demandez une modification.', false, false, 'valider'],
    ['depot', 'Dépôt de votre démarche administrative', 'Nous déposons votre dossier auprès du service instructeur.', true, false, null],
    ['instruction', 'Suivi de votre démarche administrative', 'Nous suivons l’instruction de votre dossier et répondons aux éventuelles demandes du service instructeur.', true, false, null],
    ['accordee', 'Démarche administrative validée', 'Votre démarche administrative est validée.', true, true, null],
    ['clos', 'Dossier clos', 'Votre dossier est terminé. Merci de votre confiance.', false, true, null]
  ];
  // Même règle que recalculer_etapes() en SQL (sans l'option, les étapes optionnelles passées gardent leurs dates).
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

  // Discussions de la démo : messages des deux côtés (e-mails rangés par le moteur, messages écrits dans l'espace client,
  // messages de l'agence), à vérifier, non lus, e-mail non parti, sans e-mail ; étapes clés notées comme le déclencheur de
  // la migration 0006. Un dossier dont un e-mail légal attend d'être renvoyé (quota d'e-mails du jour dépassé : Antoine
  // Garcia) ne reçoit aucun e-mail : un message de l'agence y reste « E-mail non parti » jusqu'au renvoi de l'e-mail légal.
  const apiDemo = () => {
    const now = Date.now(), j = 86400000, h = 3600000, mn = 60000, iso = (t) => new Date(t).toISOString();
    // depuis : jours écoulés depuis le début de l'étape en cours (par défaut, deux jours après la demande)
    const base = (id, prenom, nom, type, commune, jours, extra, depuis) => {
      const p = Object.assign({
        id, cree_le: iso(now - jours * j), profil: 'Particulier', prenom, nom, email: prenom.toLowerCase() + '.' + nom.toLowerCase() + '@exemple.fr', telephone: '06 12 34 56 78',
        type, commune, code_postal: '83000', adresse: '12 rue des Oliviers', documents: ['Déclaration préalable'], bien: 'Maison', surface: 25, surface_existante: 110,
        calendrier: 'Dans 3 à 6 mois', message: 'Description du projet.', etape: 'traitement', suivi_administratif: false,
        devis_chemin: null, devis_empreinte: null, devis_envoye_le: null, montant_cents: null, montant_libelle: null, signe_le: null, signe_nom: null, signe_ip: null,
        demarrage_anticipe_le: null, demarrage_anticipe_texte: null, retracte_le: null, retracte_nom: null, retracte_email: null,
        paye_le: null, paiement_ref: null, documents_valides_le: null, envois_echoues: [], messages: [], evenements: []
      }, extra || {});
      p.etapes = MODELE.map((m, i) => ({ cle: m[0], ordre: i + 1, libelle: m[1], description: m[2], optionnelle: m[3], instantanee: m[4], action: m[5], statut: 'a_venir', fait_le: null, debut_le: null, note: null }));
      const etape = p.etape; p.etape = 'traitement'; recalculer(p, p.cree_le); p.etape = etape; recalculer(p, iso(now - (depuis === undefined ? Math.max(0, jours - 2) : depuis) * j));
      return p;
    };
    const devis = (id, jours, cents, libelle) => ({ devis_chemin: id + '/agence/devis-' + id + '.pdf', devis_empreinte: 'demo', devis_envoye_le: iso(now - jours * j), montant_cents: cents, montant_libelle: libelle });
    // Signature ; un particulier a coché la case de démarrage anticipé (obligatoire pour signer)
    const signe = (nom, jours, pro) => ({ signe_le: iso(now - jours * j), signe_nom: nom, signe_ip: '203.0.113.7', demarrage_anticipe_le: pro ? null : iso(now - jours * j) });
    // Messages (colonnes de la table messages, migration 0006)
    let numero = 0, numeroJalon = 0;
    const DEFAUTS = { auteur: 'client', origine: 'email', auteur_id: null, expediteur: null, sujet: null, texte: null, texte_complet: null, pieces: [], verifie: true,
      etape: null, resend_id: null, auth: null, traite: true, traitement_le: null, lu_agence_le: null, mail_etat: null, mail_le: null, cle: null, reprise: null };
    const ligne = (p, t, o) => Object.assign({ id: ++numero, projet_id: p.id, recu_le: iso(t) }, DEFAUTS, o);
    // E-mail du client rangé par le moteur : réponse seule (texte) et texte intégral avec la citation de notre e-mail ;
    // lu par l'agence deux heures après
    const email = (p, t, sujet, texte, o) => ligne(p, t, Object.assign({ expediteur: p.email, sujet, texte, resend_id: 'imap:demo-' + t + '@exemple.fr',
      texte_complet: texte + '\n\nLe ' + fmtCourt(iso(t - j)) + ', Atomes studio <contact@atomes.studio> a écrit :\n> Bonjour,\n> …',
      auth: { controle: 'moteur', dkim: 'pass', dkim_domaine: 'exemple.fr' }, lu_agence_le: iso(t + 2 * h) }, o));
    // Message écrit par le client dans son espace (pièces rangées dans <id>/client/) ; lu par l'agence une heure après
    const espace = (p, t, texte, o) => ligne(p, t, Object.assign({ origine: 'espace', expediteur: p.email, texte, auteur_id: 'client-' + p.id,
      auth: { controle: 'session' }, cle: 'demo-' + t, lu_agence_le: iso(t + h) }, o));
    // Message de l'agence, envoyé au client par e-mail (sauf mail_etat nul : « Déjà envoyé depuis ma messagerie »)
    const agence = (p, t, texte, o) => ligne(p, t, Object.assign({ auteur: 'agence', origine: 'espace', auteur_id: 'admin', expediteur: 'contact@atomes.studio',
      sujet: 'Message d’Atomes studio — dossier ' + p.id, texte, lu_agence_le: iso(t), mail_etat: 'envoye', mail_le: iso(t + 2000), cle: 'demo-' + t }, o));
    // Étape clé (table evenements)
    const noter = (p, type, le, details) => { if (le && !p.evenements.some((e) => e.type === type && e.le === le)) p.evenements.push({ id: ++numeroJalon, projet_id: p.id, type, le, details: details || {} }); };
    const dossiers = [
      base('261013101500', 'Paul', 'Durand', 'Construction', 'Toulon', 0),
      base('261010090000', 'Claire', 'Petit', 'Rénovation', 'Hyères', 3),
      base('261003091422', 'Jean', 'Dupont', 'Extension', 'Hyères', 12, Object.assign(devis('261003091422', 6, 72000, 'Acompte de 40 %'), {
        etape: 'signature', devis_empreinte: '9f2c4e1ab07d3355c1e0a6b6e8d42f1d7a2c9b0e5f4d3c2b1a09f8e7d6c5b4a3'
      }), 6),
      base('261001150000', 'Lucie', 'Bernard', 'Construction', 'Six-Fours-les-Plages', 13, Object.assign(devis('261001150000', 5, 120000, 'Acompte de 40 %'), signe('Lucie Bernard', 2), { etape: 'paiement' }), 2),
      base('260928100000', 'Antoine', 'Garcia', 'Rénovation', 'La Garde', 16, Object.assign(devis('260928100000', 8, 96000, 'Montant du devis'), signe('Antoine Garcia', 4),
        { etape: 'paiement', retracte_le: iso(now - j), retracte_nom: 'Antoine Garcia', retracte_email: 'antoine.garcia@exemple.fr',
          // accusé de réception de la rétractation non parti (quota d'e-mails dépassé, par exemple) : à renvoyer
          envois_echoues: [{ quoi: 'retractation', sujet: 'Rétractation reçue — dossier 260928100000', le: iso(now - j) }] }), 4),
      base('260925140000', 'Marc', 'Lefèvre', 'Aménagement intérieur', 'La Seyne-sur-Mer', 20, Object.assign(devis('260925140000', 17, 150000, 'Montant du devis'), signe('Marc Lefèvre', 15, true), {
        etape: 'validation', profil: 'Professionnel', societe: 'Atelier Lefèvre', email: 'marc.lefevre@exemple.fr', paye_le: iso(now - 14 * j), paiement_ref: 'virement'
      }), 3),
      base('260901100000', 'Sophie', 'Martin', 'Extension', 'Toulon', 40, Object.assign(devis('260901100000', 36, 90000, 'Montant du devis'), signe('Sophie Martin', 35),
        { etape: 'clos', paye_le: iso(now - 34 * j), paiement_ref: 'virement', documents_valides_le: iso(now - 5 * j) }), 4)
    ];
    const [, claire, jean, lucie, antoine, marc, sophie] = dossiers;
    // Claire Petit : question de l'agence, réponse par e-mail avec le plan, puis photos envoyées depuis son espace (non lues)
    claire.messages.push(
      agence(claire, now - 2 * j, 'Bonjour Madame Petit,\n\nMerci pour votre demande. Souhaitez-vous que nous nous chargions du dépôt en mairie (supplément) ? Disposez-vous des plans de l’existant ?\n\nBien cordialement,\nSimon Charles'),
      email(claire, now - j, 'Re: Message d’Atomes studio — dossier 261010090000', 'Vous vous en chargez, merci. Je joins le plan de l’existant.',
        { pieces: [{ nom: 'plan-existant.pdf', chemin: '261010090000/client/plan-existant.pdf', taille: 482304 }] }),
      espace(claire, now - 3 * h, 'J’ai retrouvé deux photos de la façade, les voici.', { lu_agence_le: null,
        pieces: [{ nom: 'facade-rue.jpg', chemin: '261010090000/client/facade-rue.jpg', taille: 1843200 }, { nom: 'facade-jardin.jpg', chemin: '261010090000/client/facade-jardin.jpg', taille: 2097152 }] })
    );
    // Jean Dupont : ancienne question reprise (sans e-mail connu), réponse par e-mail, message d'une autre adresse à vérifier
    jean.messages.push(
      agence(jean, now - 10 * j, 'Disposez-vous des plans de l’existant ?', { sujet: 'Une question sur votre dossier 261003091422', auteur_id: null, mail_etat: null, mail_le: null, cle: null, reprise: 'questions:2' }),
      email(jean, now - 9 * j, 'Re: Une question sur votre dossier 261003091422', 'Oui, en PDF.'),
      email(jean, now - 3 * h, 'Re: Votre devis est prêt — dossier 261003091422', 'Bonjour, je vous écris depuis mon adresse professionnelle : pouvez-vous me rappeler avant que je signe ? Merci.',
        { expediteur: 'j.dupont.bureau@exemple.com', verifie: false, lu_agence_le: null, auth: { controle: 'moteur', dkim: null, dkim_domaine: null } })
    );
    // Lucie Bernard : e-mail d'un message de l'agence non parti
    lucie.messages.push(agence(lucie, now - 2 * j + 2 * h, 'Merci pour votre signature. Le virement se fait avec le numéro de votre dossier en référence : vous trouverez nos coordonnées bancaires dans votre espace client.',
      { mail_etat: 'echec', mail_le: iso(now - 2 * j + 2 * h) }));
    // Antoine Garcia : message depuis son espace, réponse de l'agence écrite depuis sa messagerie (ajoutée sans e-mail)
    antoine.messages.push(
      espace(antoine, now - j + 15 * mn, 'Comme indiqué par le lien, je renonce au contrat. Pouvez-vous me confirmer le remboursement ?'),
      agence(antoine, now - j + 3 * h, 'Bien reçu : votre rétractation est enregistrée, nous vous remboursons sous 14 jours.', { mail_etat: null, mail_le: null })
    );
    // Marc Lefèvre : demande de modification par e-mail pendant la validation des documents
    marc.messages.push(email(marc, now - j / 2, 'Re: Vos documents sont prêts — dossier 260925140000', 'Pouvez-vous déplacer la cuisine côté jardin ?'));
    // Sophie Martin : dossier clos
    sophie.messages.push(
      agence(sophie, now - 6 * j, 'Bonjour Madame Martin,\n\nVos plans sont dans votre espace : n’hésitez pas si vous avez la moindre question.\n\nBien cordialement,\nSimon Charles'),
      email(sophie, now - 4 * j + 2 * h, 'Re: Votre dossier est clos — dossier 260901100000', 'Merci pour tout, à bientôt !')
    );
    dossiers.forEach((p) => {
      noter(p, 'demande_recue', p.cree_le);
      if (p.devis_envoye_le) noter(p, 'devis_envoye', p.devis_envoye_le, { montant_cents: p.montant_cents, montant_libelle: p.montant_libelle });
      noter(p, 'devis_signe', p.signe_le);
      noter(p, 'paiement_recu', p.paye_le);
      noter(p, 'retractation', p.retracte_le);
    });
    noter(marc, 'documents_prets', marc.etapes.find((e) => e.cle === 'validation').debut_le);
    noter(sophie, 'documents_prets', iso(now - 8 * j)); noter(sophie, 'documents_valides', sophie.documents_valides_le); noter(sophie, 'dossier_clos', iso(now - 4 * j));
    const docs = {};
    const discussion = {};   // pièces jointes des messages de l'agence (<id>/agence/discussion/<nom>) → taille
    const piecesRangees = (d) => [].concat(...d.messages.filter((m) => m.verifie && m.auteur === 'client').map((m) => m.pieces.filter((x) => x.chemin).map((x) => ({ nom: x.chemin.split('/').pop(), chemin: x.chemin, taille: x.taille, date: m.recu_le }))));
    dossiers.forEach((d) => {
      docs[d.id] = {
        agence: d.devis_chemin ? [{ nom: d.devis_chemin.split('/').pop(), chemin: d.devis_chemin, taille: 184320, date: d.devis_envoye_le || d.cree_le }] : [],
        client: piecesRangees(d).concat([{ nom: '01-photos.jpg', chemin: 'demo', taille: 2411520, date: d.cree_le }])
      };
    });
    const compteDemo = { user: { id: 'admin', email: 'contact@atomes.studio' } };
    let session = compteDemo, ecouteur = null;
    const trouver = (id) => dossiers.find((d) => d.id === id);
    // Copie servie à la page : comme la lecture réelle, sans le texte intégral des e-mails (lu à la demande)
    const copie = (x) => JSON.parse(JSON.stringify(x, (k, v) => (k === 'texte_complet' ? undefined : v)));
    const refus = (message, statut) => { const e = new Error(message); e.statut = statut || 400; return e; };
    const maintenant = () => new Date().toISOString();
    const quota = (p) => (p.envois_echoues || []).length > 0;   // quota d'e-mails du jour dépassé : aucun e-mail ne part
    const actions = {
      // Nouveau devis = nouveau contrat : signature, démarrage anticipé et rétractation remis à zéro
      devis: (p, c) => {
        if (p.paye_le) throw refus('Ce dossier est déjà payé : le devis ne peut plus être remplacé', 409);
        Object.assign(p, { devis_chemin: c.chemin, devis_empreinte: 'demo', devis_envoye_le: maintenant(), montant_cents: centimes(c.montant), montant_libelle: c.libelle || 'Montant du devis',
          signe_le: null, signe_nom: null, signe_ip: null, demarrage_anticipe_le: null, demarrage_anticipe_texte: null, retracte_le: null, retracte_nom: null, retracte_email: null });
        p.etape = 'signature'; recalculer(p, p.devis_envoye_le);
        noter(p, 'devis_envoye', p.devis_envoye_le, { montant_cents: p.montant_cents, montant_libelle: p.montant_libelle });
        return { etape: 'signature', mail: true, lien: 'https://atomes.studio/action/#t=demo' };
      },
      etape: (p, c) => {
        const e = p.etapes.find((x) => x.cle === c.cle);
        if (e.optionnelle && !p.suivi_administratif) throw new Error('Activez d’abord le suivi administratif');
        const avance = e.ordre > p.etapes.find((x) => x.cle === p.etape).ordre;
        // Même règle que la fonction : rien à valider sans document de l'agence ; aucun e-mail après une rétractation
        if (avance && c.cle === 'validation' && !p.retracte_le && !(docs[p.id].agence || []).some((f) => f.chemin !== p.devis_chemin)) throw refus('Déposez d’abord les documents à valider (documents de l’agence), puis demandez la validation.', 409);
        if (avance && c.cle === 'validation') p.documents_valides_le = null;
        const t = maintenant();
        p.etape = c.cle; recalculer(p, t);
        if (avance && c.cle === 'validation' && !p.retracte_le) noter(p, 'documents_prets', t);
        if (c.cle === 'clos') noter(p, 'dossier_clos', t);
        const mail = avance && ETAPES_MAIL.includes(c.cle);
        return mail && p.retracte_le ? { mail: false, retracte: true } : { mail };
      },
      option: (p, c) => {
        const e = p.etapes.find((x) => x.cle === p.etape);
        if (!c.suivi && e.optionnelle) throw refus('L’étape « ' + p.etape + ' » fait partie du suivi administratif, qui n’est pas activé pour ce dossier', 409);
        const rouvrir = c.suivi && !p.suivi_administratif && p.etapes.some((x) => x.optionnelle && x.ordre < e.ordre && !x.fait_le);
        p.suivi_administratif = c.suivi;
        if (rouvrir) p.etape = 'depot';
        recalculer(p, maintenant());
        return { suivi: c.suivi, etape: p.etape };
      },
      // « Virement reçu »
      paye: (p) => {
        if (p.paye_le) return { deja: true };
        if (!p.montant_cents) throw refus('Montant non défini');
        p.paye_le = maintenant(); p.paiement_ref = 'virement';
        noter(p, 'paiement_recu', p.paye_le);
        if (p.etape === 'paiement') { p.etape = 'production'; recalculer(p, p.paye_le); }
        return { paye: true, mail: true };
      },
      // « Renvoyer » : e-mail légal non parti, renvoyé ; la mention disparaît (et le quota du jour avec elle)
      renvoyer: (p, c) => { p.envois_echoues = (p.envois_echoues || []).filter((x) => x.quoi !== c.quoi); return { renvoye: c.quoi, mail: true }; },
      // Message à vérifier rattaché : visible du client ; le moteur de l'agence range ses pièces jointes à son passage
      // suivant (simulé une minute plus tard)
      rattacher: (p, c) => {
        const m = p.messages.find((x) => x.id === c.message);
        if (!m) throw refus('Message introuvable', 404);
        if (m.verifie) return m.traite === false ? { moteur: true, reprise: true } : { deja: true };
        m.verifie = true; m.traite = false;
        setTimeout(() => { m.traite = true; }, mn);
        return { rattache: true, moteur: true };
      },
      supprimer_message: (p, c) => {
        const i = p.messages.findIndex((x) => x.id === c.message);
        if (i < 0) return { deja: true };
        if (p.messages[i].verifie) throw refus('Ce message est rattaché au dossier : il ne peut plus être supprimé', 409);
        p.messages.splice(i, 1);
        return { supprime: true };
      },
      // Message de l'agence : enregistré, puis e-mail au client (sauf « sans e-mail »)
      message_agence: (p, c) => {
        const texte = String(c.texte || '').replace(/\r\n?/g, '\n').trim();
        const pieces = Array.isArray(c.pieces) ? c.pieces : [];
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(c.cle || ''))) throw refus('Requête illisible');
        if (texte.length > MAX_TEXTE) throw refus(REFUS.long);
        if (!texte && !pieces.length) throw refus(REFUS.vide);
        if (pieces.length > MAX_PIECES) throw refus(REFUS.nombre);
        const deja = dossiers.map((x) => x.messages.find((m) => m.cle === c.cle)).find(Boolean);
        if (deja) {
          if (deja.projet_id !== p.id || deja.auteur !== 'agence') throw refus('Envoi impossible : rechargez la page.', 409);
          return { deja: true, mail: deja.mail_etat === 'envoye', mail_etat: deja.mail_etat };
        }
        // Nom montré au client : sans le préfixe d'heure posé par la page (même règle que la fonction)
        const lues = pieces.map((ch) => {
          if (typeof ch !== 'string' || !ch.startsWith(p.id + '/agence/discussion/') || discussion[ch] === undefined) throw refus('Pièce jointe introuvable : déposez-la de nouveau.');
          const seg = ch.split('/').pop();
          return { nom: seg.replace(/^\d{12}(-[2-9])?-/, '') || seg, chemin: ch, taille: discussion[ch] };
        });
        const etat = c.sans_mail ? null : quota(p) ? 'echec' : 'envoye';
        const m = agence(p, Date.now(), texte || null, { pieces: lues, cle: c.cle, mail_etat: etat, mail_le: etat ? maintenant() : null });
        p.messages.push(m);
        return { id: m.id, mail: etat === 'envoye', mail_etat: etat };
      },
      // « Renvoyer l'e-mail » d'un message de l'agence (même règle que la fonction : échec, ou envoi commencé depuis plus de
      // 10 minutes)
      renvoyer_message: (p, c) => {
        const m = p.messages.find((x) => x.id === c.message && x.auteur === 'agence');
        if (!m) throw refus('Message introuvable', 404);
        if (!m.mail_etat) throw refus('Ce message n’a pas d’e-mail à renvoyer.', 409);
        const tardif = m.mail_etat === 'en_cours' && Date.now() - new Date(m.mail_le || m.recu_le).getTime() > 10 * mn;
        if (m.mail_etat !== 'echec' && !tardif) throw refus('L’e-mail de ce message est en cours d’envoi : réessayez dans quelques minutes.', 409);
        m.mail_etat = quota(p) ? 'echec' : 'envoye'; m.mail_le = maintenant();
        return { mail: m.mail_etat === 'envoye' };
      },
      // Messages du client marqués lus par l'agence
      messages_lus: (p, c) => {
        if (!Array.isArray(c.ids) || !c.ids.length || c.ids.length > 100) throw refus('Requête illisible');
        const t = maintenant();
        let lus = 0;
        p.messages.forEach((m) => { if (c.ids.includes(m.id) && m.auteur === 'client' && !m.lu_agence_le) { m.lu_agence_le = t; lus++; } });
        return { lus };
      }
    };
    return {
      surChangement: (fn) => { ecouteur = fn; setTimeout(() => fn(session), 0); },
      connexion: () => Promise.resolve(),
      // Après « Se déconnecter » : tout code bien formé rouvre la session de démo, comme une vraie connexion.
      verifierCode: () => new Promise((res) => setTimeout(() => { session = compteDemo; ecouteur(session, 'SIGNED_IN'); res({ session }); }, 300)),
      deconnexion: () => { session = null; ecouteur(null); return Promise.resolve(); },
      estAdmin: () => Promise.resolve(true),
      dossiers: () => Promise.resolve(copie(dossiers)),
      lister: (id, dossier) => Promise.resolve((docs[id] && docs[id][dossier] || []).slice()),
      lien: () => Promise.resolve('#'),
      deposer: (chemin, fichier, remplacer) => {
        const [id, dossier, ...reste] = chemin.split('/');
        if (reste.length > 1) {   // pièce jointe d'un message (sous-dossier discussion/) : hors des listes de documents
          if (discussion[chemin] !== undefined && !remplacer) return Promise.reject(new Error('The resource already exists'));
          discussion[chemin] = fichier.size;
          return Promise.resolve();
        }
        const nom = reste[0];
        const liste = docs[id][dossier];
        const i = liste.findIndex((f) => f.nom === nom);
        if (i >= 0 && !remplacer) return Promise.reject(new Error('The resource already exists'));
        if (i >= 0) liste.splice(i, 1);
        liste.unshift({ nom, chemin, taille: fichier.size, date: maintenant() });
        return Promise.resolve();
      },
      supprimer: (chemin) => {
        delete discussion[chemin];
        const [id, dossier, nom] = chemin.split('/');
        const liste = (docs[id] && docs[id][dossier]) || [];
        const i = liste.findIndex((f) => f.nom === nom);
        if (i >= 0) liste.splice(i, 1);
        return Promise.resolve();
      },
      relire: (id) => Promise.resolve(trouver(id) ? copie(trouver(id)) : null),
      texteComplet: (id) => {
        const m = dossiers.map((d) => d.messages.find((x) => x.id === id)).find(Boolean);
        return new Promise((res) => setTimeout(() => res(m && m.texte_complet ? m.texte_complet : ''), 200));
      },
      note: (id, cle, note) => { trouver(id).etapes.find((e) => e.cle === cle).note = note || null; return Promise.resolve(); },
      action: (nom, id, corps) => new Promise((res, rej) => setTimeout(() => { try { res(Object.assign({ ok: true }, actions[nom](trouver(id), corps || {}))); } catch (ex) { rej(ex); } }, 200))
    };
  };

  let api;
  try {
    if (demo) api = apiDemo();
    else if (cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase) api = apiSupabase();
  } catch (ex) { api = null; }
  if (!api) { montrer('config'); return; }

  // ---------- Connexion par code ----------
  // Comme l'espace client (dossier.js) : étape 1, l'adresse ; Supabase envoie un code à usage unique (modèle « Magic
  // link », sans lien), sauf avec « J'ai déjà un code » (aucun envoi). Étape 2 : le code, vérifié ici ; la session
  // ouverte, l'événement SIGNED_IN affiche l'espace (« Session », plus bas). Même affichage dans la page qu'un compte
  // existe ou non (clients compris) : à l'étape 1, l'envoi, une adresse inconnue (422) et un code redemandé moins d'une
  // minute après le précédent (429, le précédent reste valable) mènent à la même étape 2 ; « Recevoir un nouveau code »
  // moins d'une minute après le dernier envoi fait d'ici répond « patientez une minute » sans appeler Supabase, pour
  // toute adresse, y compris après « J'ai déjà un code » pour cette même adresse. Exception : « J'ai déjà un code »
  // sans envoi récent d'ici (autre onglet ou appareil, onglet rechargé) ; « Recevoir un nouveau code » appelle alors
  // Supabase aussitôt, et un compte (429 : « patientez une minute ») s'y distingue d'une adresse inconnue (422 :
  // notice « nouveau code »). L'API de Supabase, elle, distingue toujours une adresse inconnue (422 contre 200,
  // visible dans les outils du navigateur). Le code ne part que dans le corps de la vérification : jamais dans une
  // URL, un stockage, un attribut ni un journal.
  const formConnexion = $('[data-form-connexion]');
  const formCode = $('[data-form-code]');
  const champEmail = $('#a-email');
  const champCode = $('#a-code');
  const zoneCode = $('[data-code-envoye]');
  const EMAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const ANCIEN_LIEN = 'La connexion se fait désormais par un code reçu par e-mail : entrez votre adresse ci-dessus.';
  // Erreurs de la demande de code : sous l'adresse (étape 1), sous le code (« Recevoir un nouveau code »)
  const ERR_DEMANDE = {
    limite: 'Trop de demandes de code : patientez quelques minutes.',
    envoi: 'Impossible d’envoyer le code pour le moment.',
    autre: 'Impossible d’envoyer le code pour le moment.',
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
  // Notices de l'étape 2 (texte simple), avant et après l'adresse : code envoyé, nouveau code envoyé, ou « J'ai déjà un
  // code » (rien d'envoyé d'ici)
  const NOTICE = {
    envoi: ['Si un compte est associé à ', ', un code de connexion vient de lui être envoyé. Saisissez-le ci-dessous : il est valable une heure et ne sert qu’une fois.'],
    nouveau: ['Si un compte est associé à ', ', un nouveau code vient de lui être envoyé : utilisez ce dernier code, le précédent ne fonctionne plus.'],
    deja: ['Saisissez ci-dessous le dernier code de connexion reçu par e-mail à l’adresse ', ' : un code est valable une heure et ne sert qu’une fois.']
  };
  // Classe d'une erreur de Supabase Auth (status, code, message), règles prises dans cet ordre (même règle dans
  // dossier.js) : « inconnu », adresse sans compte ; « frequence », code redemandé moins d'une minute après le précédent
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

  // État de l'étape 2 gardé dans l'onglet (sessionStorage), pour l'onglet rechargé au retour de l'application de
  // messagerie : adresse et heure de l'envoi, une heure au plus (durée du code). Stockage bloqué : la page marche sans.
  const CLE_CONNEXION = 'atomes-connexion-admin';
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
    const err = $('#a-err');
    err.textContent = msg || ''; err.hidden = !msg;
    if (invalide) champEmail.setAttribute('aria-invalid', 'true'); else champEmail.removeAttribute('aria-invalid');
  };
  // Message sous le code ; invalide : champ signalé, focalisé, saisie gardée et sélectionnée
  const erreurCode = (msg, invalide) => {
    const err = $('#a-code-err');
    err.textContent = msg || ''; err.hidden = !msg;
    if (!invalide) { champCode.removeAttribute('aria-invalid'); return; }
    champCode.setAttribute('aria-invalid', 'true');
    champCode.focus(); champCode.select();
  };
  // Notice de l'étape 2 (genre : envoi, nouveau, deja), dans la zone « status » toujours présente (vide, la feuille de
  // style la masque)
  const afficherEnvoi = (email, genre) => { zoneCode.textContent = NOTICE[genre][0] + email + NOTICE[genre][1]; };
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
  // sous l'adresse, le message d'un ancien lien direct.
  const reprendre = () => {
    const etat = lireConnexion();
    if (etat) { champEmail.value = etat.email; etapeCode(etat.email, etat.le); }
    if (ancienLien) erreurAdresse(ANCIEN_LIEN);
  };

  // Étape 1 → « Recevoir mon code de connexion »
  formConnexion.addEventListener('submit', (e) => {
    e.preventDefault();
    if (occupe) return;
    const email = champEmail.value.trim();
    if (!EMAIL_OK.test(email)) { erreurAdresse('Adresse email invalide', true); return; }
    erreurAdresse('');
    const t = tour, fin = boutonOccupe($('[data-btn-connexion]'), 'Envoi…');
    api.connexion(email).then(() => 'envoye', (ex) => classer(ex, false)).then((k) => {
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

  // Étape 2 → « Se connecter ». Le titre de la vue qui suit la connexion reçoit le focus (titreAFocaliser, posé avant la
  // vérification, effacé si elle échoue).
  formCode.addEventListener('submit', (e) => {
    e.preventDefault();
    if (occupe) return;
    // Code recopié : espaces (insécables compris) et tirets retirés ; 6 à 10 chiffres (réglage « Email OTP Length »)
    const code = champCode.value.replace(/[\s\u2010-\u2015\u2212-]/g, '');
    if (!code) { erreurCode(ERR_CODE.vide, true); return; }
    if (!/^\d{6,10}$/.test(code)) { erreurCode(ERR_CODE.format, true); return; }
    erreurCode('');
    const t = tour, fin = boutonOccupe($('[data-btn-code]'), 'Vérification…');
    titreAFocaliser = true;
    api.verifierCode(emailCode, code).then(() => null, (ex) => { titreAFocaliser = false; return classer(ex, true); }).then((k) => {
      if (!k || t !== tour) return;   // connecté : l'événement SIGNED_IN prend le relais
      erreurCode(k === 'limite' || k === 'frequence' ? ERR_CODE.limite : k === 'autre' ? ERR_CODE.autre : ERR_CODE.code, true);
    }).finally(fin);
  });

  // Étape 2 → « Recevoir un nouveau code », pour la même adresse (Supabase annule le code précédent)
  $('[data-nouveau-code]').addEventListener('click', (e) => {
    if (occupe || !emailCode) return;
    erreurCode('');
    if (Date.now() - leCode < 60000) { erreurCode(ERR_DEMANDE.frequence); return; }   // même réponse, sans appel, qu'il y ait un compte ou non
    const email = emailCode, t = tour, fin = boutonOccupe(e.currentTarget, 'Envoi…');
    api.connexion(email).then(() => 'envoye', (ex) => classer(ex, false)).then((k) => {
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

  $('[data-deconnexion]').addEventListener('click', () => {
    api.deconnexion().then(() => { history.replaceState(null, '', location.pathname + location.search); });
  });

  // ---------- État ----------
  let dossiers = [];
  let courant = null;       // dossier de la fiche affichée (données les plus récentes)
  let affiche = null;       // dossier tel que la fiche entière l'a dessiné (ouvrir)
  let filtre = 'encours';
  let charge = null;        // compte connecté
  let autorise = false;     // compte inscrit dans la table admins

  const etapeDe = (d) => (d.etapes || []).find((e) => e.cle === d.etape) || {};
  const visibles = (d) => (d.etapes || []).filter((e) => !e.optionnelle || d.suivi_administratif).sort((a, b) => a.ordre - b.ordre);
  const aVerifier = (d) => (d.messages || []).filter((m) => !m.verifie);
  // Auteur et origine d'un message (lecture d'avant la migration 0006, sans ces colonnes : e-mail du client)
  const deLAgence = (m) => m.auteur === 'agence';
  const depuisEspace = (m) => m.origine === 'espace';
  // Message vérifié dont le traitement s'est interrompu (pièces jointes) : plus aucun traitement en cours
  // depuis 10 minutes (bail de la fonction) ; l'agence le reprend (« Reprendre le traitement »).
  const BAIL = 10 * 60000;
  // Message lu par le moteur de l'agence (e-mails reçus sur contact@ et simon@, identifiant « imap:… ») : vérifié et
  // pas encore traité (rattaché par l'agence, ou traitement interrompu), le moteur le termine à son passage suivant.
  const duMoteur = (m) => String(m.resend_id || '').startsWith('imap:');
  const enAttenteMoteur = (m) => !!m.verifie && m.traite === false && duMoteur(m);
  const incomplet = (m) => !duMoteur(m) && !!m.verifie && m.traite === false && (!m.traitement_le || Date.now() - new Date(m.traitement_le).getTime() > BAIL);
  const incomplets = (d) => (d.messages || []).filter(incomplet);
  // E-mail d'un message de l'agence au client non parti (échec), ou envoi commencé il y a plus de 10 minutes sans fin
  // (fonction interrompue) : « Renvoyer l'e-mail » permis (même règle que l'action renvoyer_message de la fonction).
  const envoiRate = (m) => deLAgence(m) && (m.mail_etat === 'echec' || (m.mail_etat === 'en_cours' && Date.now() - new Date(m.mail_le || m.recu_le).getTime() > BAIL));
  const envoiEnCours = (m) => deLAgence(m) && m.mail_etat === 'en_cours' && !envoiRate(m);
  const enPanne = (d) => (d.messages || []).filter(envoiRate);
  // Message du client que l'agence n'a pas encore lu (lu_agence_le nul ; absent avant la migration 0006 : lu). Les
  // messages marqués lus par cette page le restent, même si une lecture plus ancienne arrive ensuite.
  const lus = new Set();
  const nonLu = (m) => !deLAgence(m) && m.lu_agence_le === null && !lus.has(m.id);
  const nonLus = (d) => (d.messages || []).filter((m) => m.verifie && nonLu(m));
  // Dernier message du fil (messages vérifiés des deux auteurs, par date puis par id), écrit depuis `depuis` s'il est donné
  const chrono = (a, b) => (new Date(a.recu_le) - new Date(b.recu_le)) || (a.id - b.id);
  const dernierMessage = (d, depuis) => (d.messages || []).filter((m) => m.verifie && (!depuis || new Date(m.recu_le) >= new Date(depuis))).sort(chrono).pop();
  // E-mails légaux au client qui n'ont pas pu partir et peuvent être renvoyés : confirmation du contrat (signé, pas
  // rétracté), accusé de rétractation (rétractation enregistrée).
  const aRenvoyer = (d) => (Array.isArray(d.envois_echoues) ? d.envois_echoues : [])
    .filter((x) => x && ((x.quoi === 'confirmation' && !!d.signe_le && !d.retracte_le) || (x.quoi === 'retractation' && !!d.retracte_le)));
  // Rétractation à traiter : dossier en cours, ou rétractation reçue après la clôture du dossier.
  const clotureLe = (d) => ((d.etapes || []).find((e) => e.cle === 'clos') || {}).fait_le;
  const retractationATraiter = (d) => !!d.retracte_le && (d.etape !== 'clos' || !clotureLe(d) || new Date(d.retracte_le) > new Date(clotureLe(d)));
  const particulier = (d) => d.profil !== 'Professionnel';
  // Documents de l'agence hors devis, d'après la dernière liste lue (undefined tant qu'elle n'est pas arrivée)
  const docsAgence = {};
  const estDevis = (d, f) => f.chemin === d.devis_chemin || new RegExp('^devis-' + d.id + '-[0-9]{12}\\.pdf$', 'i').test(f.nom);
  const sansDocuments = (d) => Array.isArray(docsAgence[d.id]) && !docsAgence[d.id].some((f) => !estDevis(d, f));
  // Qui a la main : [libellé, 'agence' | 'client' | 'clos']. Une rétractation (dossier en cours, ou reçue après la
  // clôture), un e-mail légal à renvoyer, un message à vérifier ou incomplet, l'e-mail d'un message au client non parti,
  // puis un message du client non lu passent avant tout (même un dossier clos peut recevoir un message) ; ensuite
  // l'étape, et la discussion à l'étape « traitement » et pendant la validation des documents.
  const situation = (d) => {
    const clos = d.etape === 'clos';
    if (retractationATraiter(d)) return ['Rétractation reçue', 'agence'];
    if (aRenvoyer(d).length) return ['E-mail à renvoyer', 'agence'];
    const v = aVerifier(d).length;
    if (v) return [v > 1 ? v + ' messages à vérifier' : 'Message à vérifier', 'agence'];
    if (incomplets(d).length) return ['Message incomplet', 'agence'];
    if (enPanne(d).length) return ['E-mail non parti', 'agence'];
    const n = nonLus(d).length;
    if (n) return [n > 1 ? n + ' nouveaux messages' : 'Nouveau message', 'agence'];
    if (clos) return ['Clos', 'clos'];
    return parEtape(d);
  };
  const parEtape = (d) => {
    const e = etapeDe(d);
    switch (d.etape) {
      case 'traitement': {
        if (!(d.messages || []).some(deLAgence)) return ['Nouvelle demande', 'agence'];
        return deLAgence(dernierMessage(d) || {}) ? ['Réponse attendue', 'client'] : ['Réponse reçue', 'agence'];
      }
      case 'devis': return ['Devis à produire', 'agence'];
      case 'signature': return d.signe_le ? ['Devis signé', 'agence'] : ['Signature attendue', 'client'];
      case 'paiement': return d.paye_le ? ['Payé', 'agence'] : d.montant_cents ? ['Virement attendu', 'client'] : ['Montant à définir', 'agence'];
      case 'production': return ['Documents à produire', 'agence'];
      // Pendant la validation : le client a écrit depuis le début de l'étape (demande de modification, question…)
      case 'validation': { const m = dernierMessage(d, e.debut_le); return m && !deLAgence(m) ? ['Message du client', 'agence'] : ['Validation attendue', 'client']; }
      case 'depot': return ['Dépôt à faire', 'agence'];
      case 'instruction': return ['Instruction en cours', 'agence'];
      case 'accordee': return ['Démarche validée', 'agence'];
      default: return [e.libelle || d.etape, 'agence'];
    }
  };

  const charger = () => api.dossiers().then((liste) => {
    if (!charge || !autorise) return;   // déconnexion pendant la lecture
    dossiers = liste || [];
    erreur('');
    const d = dossiers.find((x) => x.id === location.hash.replace('#', ''));
    if (d) ouvrir(d); else rendreListe();
  }).catch(() => { if (!charge || !autorise) return; montrer('liste'); erreur('Impossible de charger les dossiers. Réessayez dans quelques minutes.'); });

  // Après une opération sur le dossier `id` : données relues ; sa fiche est redessinée seulement si elle est encore
  // affichée (une autre fiche ouverte entre-temps n'est pas touchée, sa saisie en cours serait perdue).
  const recharger = (message, id) => api.dossiers().then((liste) => {
    if (!charge || !autorise) return;
    dossiers = liste || [];
    if (courant && (!id || courant.id === id)) {
      const d = dossiers.find((x) => x.id === courant.id);
      if (d) ouvrir(d, true);
      if (message) annoncer(message);
    } else if (!courant && !vues.liste.hidden) rendreListe();
  });
  const remplacer = (d) => { dossiers = dossiers.map((x) => (x.id === d.id ? d : x)); };
  // Changement de fiche ou retour à la liste : affichage immédiat (données en mémoire), puis données relues en
  // arrière-plan pour montrer l'état réel (signature, virement, messages…). Un échec n'efface rien : message seulement.
  // Relecture périodique de la liste (auto) : silencieuse en cas d'échec, liste redessinée seulement si elle change.
  const actualiser = (auto) => api.dossiers().then((liste) => {
    if (!charge || !autorise) return;
    dossiers = liste || [];
    const d = auto ? null : dossiers.find((x) => x.id === location.hash.replace('#', ''));
    if (d && (!courant || courant.id === d.id)) ouvrir(d, true);
    else if (!courant && !vues.liste.hidden) rendreListe(auto);
  }).catch(() => { if (charge && autorise && !auto) erreur('Les dossiers n’ont pas pu être actualisés : rechargez la page.'); });

  const annoncer = (message) => {
    const n = $('[data-notice]');
    n.textContent = message || ''; n.hidden = !message;
    if (message) { n.focus({ preventScroll: true }); n.scrollIntoView({ block: 'nearest' }); }
  };

  // ---------- Liste ----------
  const FILTRES = {
    encours: (d) => d.etape !== 'clos',
    attente: (d) => situation(d)[1] === 'agence',
    clos: (d) => d.etape === 'clos',
    tous: () => true
  };
  $$('[data-filtre]').forEach((b) => b.addEventListener('click', () => { filtre = b.dataset.filtre; rendreListe(); }));
  $('#a-recherche').addEventListener('input', () => rendreListe());

  // Liste redessinée seulement si ce qu'elle montre change (lignes, badges, compte) ; relecture périodique (auto) :
  // jamais pendant qu'une ligne a le focus (redessinée au tour suivant).
  let listeAffichee = '';
  const rendreListe = (auto) => {
    courant = null; affiche = null;
    quitterFiche();
    $$('[data-filtre]').forEach((b) => { const on = b.dataset.filtre === filtre; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    const terme = $('#a-recherche').value.trim().toLowerCase();
    const liste = dossiers.filter(FILTRES[filtre]).filter((d) => !terme || [d.id, d.prenom, d.nom, d.societe, d.commune, d.email, d.type].filter(Boolean).join(' ').toLowerCase().includes(terme));
    const lignes = liste.map((d) => {
      const vis = visibles(d), e = etapeDe(d), [texte, qui] = situation(d);
      return { id: d.id, num: 'N° ' + d.id + ' · ' + fmtCourt(d.cree_le), nom: (d.prenom + ' ' + d.nom).trim() + (d.societe ? ' · ' + d.societe : ''), type: d.type + ' · ' + d.commune,
        etape: String(vis.indexOf(vis.find((x) => x.cle === d.etape)) + 1).padStart(2, '0') + '/' + String(vis.length).padStart(2, '0') + ' · ' + (e.libelle || ''), texte, qui };
    });
    const compte = liste.length + ' dossier' + (liste.length > 1 ? 's' : '');
    const contenu = JSON.stringify([compte, lignes]);
    const cont = $('[data-liste]');
    if (contenu !== listeAffichee && !(auto && cont.contains(document.activeElement))) {
      listeAffichee = contenu;
      cont.textContent = '';
      const n = $('[data-compte-liste]');
      if (n.textContent !== compte) n.textContent = compte;
      if (!lignes.length) cont.appendChild(el('p', 'docs-vide', 'Aucun dossier.'));
      lignes.forEach((l) => {
        const a = el('a', 'admin-ligne'); a.href = '#' + l.id;
        const c1 = el('div');
        c1.appendChild(el('span', 'num', l.num));
        c1.appendChild(el('strong', '', l.nom));
        a.appendChild(c1);
        a.appendChild(el('span', 'admin-type', l.type));
        a.appendChild(el('span', 'admin-etape', l.etape));
        a.appendChild(el('span', 'badge badge--' + l.qui, l.texte));
        cont.appendChild(a);
      });
    }
    montrer('liste');
  };

  $('[data-retour]').addEventListener('click', (e) => {
    e.preventDefault();
    history.pushState(null, '', location.pathname + location.search);
    rendreListe();
    actualiser();
  });
  window.addEventListener('hashchange', () => {
    // Jeton ou ancien lien direct ouvert dans cet onglet, page déjà chargée : même traitement qu'au chargement
    retirerJetonAcces();
    if (retirerAncienLien() && !charge) {
      if (!sessionLue) ancienLien = true;
      else if (!vues.connexion.hidden && !formConnexion.hidden) erreurAdresse(ANCIEN_LIEN);
    }
    if (!charge || !autorise) return;
    const d = dossiers.find((x) => x.id === location.hash.replace('#', ''));
    if (d) ouvrir(d); else rendreListe();
    actualiser();
  });

  // ---------- Boutons occupés ----------
  // Les boutons fixes de la fiche servent à tous les dossiers : une opération en cours est notée « sélecteur|dossier ».
  // Le bouton n'affiche « Envoi… » que sur la fiche du dossier concerné, et retrouve son libellé une fois l'opération
  // finie, même si l'agence est passée par une autre fiche ou par la liste entre-temps.
  const FIXES = ['[data-btn-message]', '[data-btn-devis]', '[data-btn-paye]', '[data-btn-pret]'];
  const enVol = new Set();
  // Dossiers dont l'étape est en train de changer (« Passer ici », « Documents prêts », « Virement reçu ») → bouton à
  // l'origine de l'opération : les autres boutons d'étape du dossier restent indisponibles jusqu'à la fin (une seule
  // demande, un seul e-mail au client).
  const etapesEnVol = new Map();
  const cleVol = (btn, pid) => { const s = btn ? FIXES.find((x) => $(x) === btn) : null; return s ? s + '|' + pid : null; };
  const etatBoutons = (d) => {
    FIXES.forEach((s) => {
      const b = $(s);
      const pris = enVol.has(s + '|' + d.id);
      if (b.dataset.texteOrigine) b.textContent = pris ? 'Envoi…' : b.dataset.texteOrigine;
      const etape = (s === '[data-btn-pret]' || s === '[data-btn-paye]') && etapesEnVol.has(d.id) && etapesEnVol.get(d.id) !== s;
      // « Documents prêts » : rien à valider tant qu'aucun document de l'agence (hors devis) n'est déposé
      const vide = s === '[data-btn-pret]' && sansDocuments(d);
      const indisponible = pris || etape || vide || (s === '[data-btn-devis]' && !!d.paye_le);
      // « Envoyer au client » : aria-disabled pendant l'envoi, jamais disabled (le bouton garde le focus ; composeurFige()
      // refuse un second envoi)
      if (s === '[data-btn-message]') { b.disabled = false; if (indisponible) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled'); }
      else b.disabled = indisponible;
      if (s === '[data-btn-pret]') b.title = vide ? 'Déposez d’abord les documents à valider' : '';
    });
    etatComposeur(d.id);
  };
  const etatEtapes = (d) => {
    $$('button', $('[data-etapes]')).forEach((b) => { b.disabled = !!b.dataset.raison || etapesEnVol.has(d.id); });
    etatBoutons(d);
  };
  // Opération qui change l'étape du dossier `id` (bouton `origine`) : boutons d'étape bloqués pendant l'envoi, rétablis à
  // la fin.
  const changementEtape = (id, origine, promesse) => {
    etapesEnVol.set(id, origine);
    if (courant && courant.id === id) etatEtapes(courant);
    return promesse().finally(() => { etapesEnVol.delete(id); if (courant && courant.id === id) etatEtapes(courant); });
  };
  const occuper = (btn, pid) => {
    if (!btn) return;
    if (!btn.dataset.texteOrigine) btn.dataset.texteOrigine = btn.textContent;
    const k = cleVol(btn, pid);
    if (k) enVol.add(k);
    if (courant && courant.id === pid) {
      if (k === '[data-btn-message]|' + pid) btn.setAttribute('aria-disabled', 'true'); else btn.disabled = true;
      btn.textContent = 'Envoi…';
      if (k) etatComposeur(pid);
    }
  };
  const rendre = (btn, pid) => {
    if (!btn) return;
    const k = cleVol(btn, pid);
    if (k) { enVol.delete(k); if (courant && courant.id === pid) etatBoutons(courant); return; }
    if (courant && courant.id === pid) { btn.disabled = false; btn.textContent = btn.dataset.texteOrigine; }   // bouton d'une ligne (étape…)
  };

  // ---------- Fiche d'un dossier ----------
  let dernierOuvert = null;   // dossier de la dernière fiche ouverte : son brouillon est dans le composeur
  let aRouvrir = false;       // le dossier a changé pendant une saisie : bandeau « rouvrez la fiche »
  const ouvrir = (d, garderMessage) => {
    courant = d; affiche = d; aRouvrir = false;
    if (!garderMessage) annoncer('');
    if (dernierOuvert !== d.id) {
      // Autre dossier : les messages du précédent ne doivent pas le suivre ; le composeur reprend le brouillon de celui-ci.
      dernierOuvert = d.id;
      ['[data-depot-err]', '[data-err-devis]'].forEach((sel) => { $(sel).hidden = true; });
      $('[data-depot-info]').textContent = 'Visibles par le client dans son espace';
      $('[data-suivi]').disabled = false;
      remplirComposeur(d.id);
    }
    $('[data-d-num]').textContent = 'DOSSIER N° ' + d.id;
    $('[data-d-titre]').textContent = (d.prenom + ' ' + d.nom).trim() + (d.societe ? ' · ' + d.societe : '');
    $('[data-d-sous]').textContent = d.type + ' · ' + d.commune + ' · demande du ' + fmtDate(d.cree_le);
    const liens = $('[data-d-liens]'); liens.textContent = '';
    const mail = el('a', 'link-more', d.email); mail.href = 'mailto:' + d.email; liens.appendChild(mail);
    if (d.telephone) { const tel = el('a', 'link-more', d.telephone); tel.href = 'tel:' + d.telephone.replace(/[^\d+]/g, ''); liens.appendChild(tel); }
    const voir = el('a', 'link-more', 'Voir l’espace client'); voir.href = '../dossier/' + (demo ? '?demo' : '') + '#' + d.id; voir.target = '_blank'; voir.rel = 'noopener'; liens.appendChild(voir);
    rendreAlertes(d);
    rendreEtapes(d);
    rendreDiscussion(d);
    rendreDevis(d);
    rendreRecap(d);
    // « Documents prêts » : à l'étape production, jamais après une rétractation (mission arrêtée)
    $('[data-pret]').hidden = d.etape !== 'production' || !!d.retracte_le;
    etatBoutons(d);
    montrer('dossier');
    rafraichirDocs();
    marquerLus();
  };

  // Action envoyée à la fonction pour le dossier `id` (par défaut celui affiché au moment de l'appel). Succès : message
  // annoncé dès la réponse, `apres(j)` exécuté (brouillons à vider), dossier relu ; le bouton reste occupé jusqu'à la fin
  // de la relecture, et une relecture ratée n'est pas présentée comme un échec. Échec : message sous le bloc (ou en tête)
  // et focus rendu au bouton ; si une autre fiche est ouverte entre-temps, message en tête avec le numéro du dossier.
  // (libellé d'origine du bouton mémorisé dans data-texte-origine). Options `o` : `zone`, élément où écrire l'annonce
  // (au lieu de annoncer() : ni focus ni défilement en tête de fiche) ; `relecture`, après un succès, relecture du seul
  // dossier (fil et bandeau, comme le rafraîchissement) au lieu de recharger() : la fiche n'est pas redessinée, une note
  // ou un devis en cours de saisie restent. Compte changé entre-temps (déconnexion) : rien n'est écrit dans la page.
  const agir = (btn, err, nom, corps, merci, apres, id, o) => {
    const pid = id || courant.id, compte = charge;
    const meme = () => !!courant && courant.id === pid;
    const dire = (m) => { if (charge !== compte || !meme()) return; if (o && o.zone) o.zone.textContent = m; else annoncer(m); };
    occuper(btn, pid);
    if (err && meme()) err.hidden = true;
    return api.action(nom, pid, corps).then((j) => {
      if (charge !== compte) { rendre(btn, pid); return j; }
      const m = typeof merci === 'function' ? merci(j) : merci;
      if (apres) apres(j);
      dire(m);
      return (o && o.relecture ? rafraichir(pid) : recharger(null, pid))
        .catch(() => dire(m + ' Actualisez la page pour voir le dossier à jour.'))
        .then(() => { rendre(btn, pid); return j; });
    }, (ex) => {
      rendre(btn, pid);
      if (charge !== compte) throw ex;
      const msg = (ex && ex.message) || ECHEC;
      if (meme()) {
        if (err) { err.textContent = msg; err.hidden = false; } else annoncer(msg);
        if (btn && btn.isConnected && !btn.disabled) btn.focus();
      } else erreur('Dossier N° ' + pid + ' : ' + msg);
      throw ex;
    });
  };

  // Bandeau en tête de fiche : rétractation (dossier en cours, ou reçue après la clôture), e-mails légaux à renvoyer
  // (bouton « Renvoyer »), messages à vérifier ou dont le traitement s'est interrompu, e-mail d'un message au client non
  // parti, dossier changé pendant une saisie
  const QUOI_RENVOI = { confirmation: 'la confirmation du contrat', retractation: 'l’accusé de réception de la rétractation' };
  const rendreAlertes = (d) => {
    const z = $('[data-alertes]');
    z.textContent = '';
    if (retractationATraiter(d)) {
      z.appendChild(el('div', '', 'Le client a renoncé au contrat le ' + fmtHeure(d.retracte_le) + (d.etape === 'clos' ? ', après la clôture du dossier' : '')
        + ' : arrêtez la mission. Les sommes reçues sont à rembourser sous 14 jours, déduction faite du travail déjà réalisé à sa demande.'));
    }
    aRenvoyer(d).forEach((x) => {
      const ligne = el('div', 'alerte-renvoi');
      ligne.appendChild(el('span', '', 'L’e-mail « ' + (x.sujet || QUOI_RENVOI[x.quoi]) + ' » (' + QUOI_RENVOI[x.quoi] + ') n’a pas pu être envoyé au client'
        + (x.le ? ' le ' + fmtHeure(x.le) : '') + ' : renvoyez-le.'));
      const b = el('button', 'btn btn--ghost', 'Renvoyer'); b.type = 'button';
      b.setAttribute('aria-label', 'Renvoyer au client ' + QUOI_RENVOI[x.quoi]);
      b.addEventListener('click', () => {
        agir(b, null, 'renvoyer', { quoi: x.quoi }, (j) => (j.mail ? 'E-mail renvoyé au client : ' + QUOI_RENVOI[x.quoi] + '.' : 'L’e-mail n’est toujours pas parti : réessayez dans quelques minutes.'), null, d.id).catch(() => {});
      });
      ligne.appendChild(b);
      z.appendChild(ligne);
    });
    const v = aVerifier(d).length;
    if (v) z.appendChild(el('div', '', (v > 1 ? v + ' messages du client sont à vérifier' : 'Un message du client est à vérifier') + ' : voir la discussion.'));
    if (incomplets(d).length) z.appendChild(el('div', '', 'Le traitement d’un message du client s’est interrompu (pièces jointes ou réponse peut-être incomplètes) : voir la discussion.'));
    if (enPanne(d).length) z.appendChild(el('div', '', 'L’e-mail d’un message au client n’est pas parti\u00a0: voir la discussion.'));
    if (aRouvrir) z.appendChild(el('div', '', 'Le dossier a changé\u00a0: rouvrez la fiche pour le voir à jour.'));
    z.hidden = !z.childNodes.length;
  };

  // Avancement : toutes les étapes (les optionnelles grisées sans l'option), bouton pour y faire passer le dossier
  const rendreEtapes = (d) => {
    const cb = $('[data-suivi]');
    cb.checked = !!d.suivi_administratif;
    const ol = $('[data-etapes]');
    ol.textContent = '';
    const ordreCourant = etapeDe(d).ordre || 0;
    let n = 0;
    (d.etapes || []).slice().sort((a, b) => a.ordre - b.ordre).forEach((e) => {
      const masquee = e.optionnelle && !d.suivi_administratif;
      const courante = e.cle === d.etape;
      const li = el('li', 'tl-' + e.statut + (courante ? ' tl-courante' : '') + (masquee ? ' is-option' : ''));
      li.appendChild(el('span', 'tl-mark'));
      const corps = el('div', 'tl-body');
      const titre = el('div', 'tl-title');
      titre.appendChild(el('span', 'tl-num', masquee ? 'OPT' : String(++n).padStart(2, '0')));
      titre.appendChild(document.createTextNode(e.libelle));
      corps.appendChild(titre);
      if (courante && e.note) corps.appendChild(el('p', 'tl-desc', 'Note : ' + e.note));
      if (masquee) corps.appendChild(el('p', 'tl-desc', 'Option non retenue pour ce dossier'));
      li.appendChild(corps);
      li.appendChild(el('span', 'tl-date', e.statut === 'fait' ? fmtCourt(e.fait_le) : e.statut === 'en_cours' ? (e.debut_le ? 'Depuis le ' + fmtCourt(e.debut_le) : 'En cours') : ''));
      if (courante) li.appendChild(el('span', 'tl-statut', 'Étape actuelle'));
      else {
        const b = el('button', 'link-more', 'Passer ici'); b.type = 'button';
        const raison = masquee ? 'Activez le suivi administratif' : (e.cle === 'signature' && !d.devis_chemin) || (e.cle === 'paiement' && !d.montant_cents) ? 'Envoyez d’abord le devis' : '';
        b.setAttribute('aria-label', 'Passer le dossier à l’étape « ' + e.libelle + ' »' + (raison ? ' (' + raison + ')' : ''));
        b.dataset.raison = raison;
        if (raison) b.title = raison;
        b.disabled = !!raison || etapesEnVol.has(d.id);
        b.addEventListener('click', () => {
          const avance = e.ordre > ordreCourant;
          const mail = avance && ETAPES_MAIL.includes(e.cle);
          // Client qui a renoncé au contrat : la mission est arrêtée, aucun e-mail de mission ne lui est envoyé.
          const suite = mail && d.retracte_le ? '\nLe client a renoncé au contrat : aucun e-mail ne lui sera envoyé.' : mail ? '\nLe client recevra un e-mail.'
            : avance ? '' : '\nC’est un retour en arrière : les étapes suivantes repassent à venir.';
          if (!window.confirm('Passer le dossier à l’étape « ' + e.libelle + ' » ?' + suite)) return;
          const merci = (j) => (j.deja ? 'Le dossier était déjà à l’étape « ' + e.libelle + ' ».'
            : 'Dossier passé à l’étape « ' + e.libelle + ' »' + (j.retracte ? ' : aucun e-mail n’est envoyé au client, qui a renoncé au contrat.'
              : j.mail ? ' : le client a reçu un e-mail.' : mail ? '. Attention : l’e-mail au client n’est pas parti.' : '.'));
          changementEtape(d.id, 'passer', () => agir(b, null, 'etape', { cle: e.cle }, merci, null, d.id)).catch(() => {});
        });
        li.appendChild(b);
      }
      ol.appendChild(li);
    });
    // Note de l'étape en cours (visible par le client à la place de la description)
    const e = etapeDe(d);
    $('[data-note-lbl]').textContent = 'Note pour le client · ' + (e.libelle || '');
    $('[data-note]').value = e.note || '';
  };

  $('[data-suivi]').addEventListener('change', (ev) => {
    const cb = ev.target;
    const suivi = cb.checked;
    const d = courant;
    if (!d) return;
    const id = d.id, e = etapeDe(d);
    // Même règle que la fonction : un dossier qui a dépassé le dépôt sans y passer est rouvert au dépôt
    const rouvrir = suivi && (d.etapes || []).some((x) => x.optionnelle && x.ordre < (e.ordre || 0) && !x.fait_le);
    if (rouvrir && !window.confirm('Ce dossier a dépassé l’étape « Dépôt » sans y passer : activer le suivi administratif le rouvre à l’étape « Dépôt de votre démarche administrative ». Continuer ?')) { cb.checked = false; return; }
    if (!suivi && !e.optionnelle && (d.etapes || []).some((x) => x.optionnelle && x.statut === 'fait')
      && !window.confirm('Ce dossier est passé par le suivi administratif : le désactiver masque les étapes 8 à 10 dans l’espace du client. Continuer ?')) { cb.checked = true; return; }
    cb.disabled = true;
    agir(null, null, 'option', { suivi }, (j) => (!suivi ? 'Suivi administratif désactivé.'
      : j.etape === 'depot' && e.cle !== 'depot' ? 'Suivi administratif activé : le dossier repasse à l’étape « Dépôt ».'
        : 'Suivi administratif activé : les étapes 8 à 10 apparaissent pour le client.'), null, id)
      .catch(() => { if (courant && courant.id === id) cb.checked = !suivi; })
      .finally(() => { cb.disabled = false; });
  });

  // Note : état réel relu juste avant l'écriture (comme le devis et « Virement reçu ») ; la note va sous l'étape affichée,
  // celle que le client voit en cours. Étape changée ailleurs depuis l'affichage : rien n'est écrit, la saisie reste, la
  // fiche est à rouvrir (bandeau). Compte changé entre-temps : rien n'est écrit dans la page.
  $('[data-form-note]').addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (!courant) return;
    const id = courant.id, compte = charge, etapeAffichee = (affiche || courant).etape;
    const meme = () => !!courant && courant.id === id;
    const btn = $('[data-btn-note]');
    const note = $('[data-note]').value.trim();
    const m = 'Note enregistrée : le client la voit sous l’étape en cours.';
    btn.disabled = true;
    api.relire(id).then((frais) => {
      if (charge !== compte) return;
      if (!frais) throw new Error('Dossier introuvable');
      if (frais.etape !== etapeAffichee) {
        remplacer(frais);
        if (!meme()) { erreur('Dossier N° ' + id + ' : la note n’a pas pu être enregistrée.'); return; }
        courant = frais; aRouvrir = true;
        rendreAlertes(frais);
        annoncer('L’étape du dossier a changé : rouvrez la fiche avant d’enregistrer la note.');
        return;
      }
      return api.note(id, frais.etape, note).then(() => {
        if (charge !== compte) return;
        if (meme()) annoncer(m);
        return recharger(null, id).catch(() => { if (meme()) annoncer(m + ' Actualisez la page pour voir le dossier à jour.'); });
      });
    }).catch(() => {
      if (charge !== compte) return;
      if (meme()) annoncer('La note n’a pas pu être enregistrée.'); else erreur('Dossier N° ' + id + ' : la note n’a pas pu être enregistrée.');
    }).finally(() => { btn.disabled = false; });
  });

  // ---------- Discussion ----------
  // Messages des deux côtés et étapes clés, du plus ancien au plus récent (même date : étape clé d'abord, puis par n°) :
  // e-mails du client rangés par le moteur de l'agence (contact@, simon@) ou, pour les anciennes adresses de réponse,
  // par la fonction « espace » ; messages écrits par le client dans son espace ; messages de l'agence (composeur, plus
  // bas). Un message « à vérifier » vient d'une autre adresse que celle du dossier ou n'a pas passé l'authentification :
  // rattaché, il devient visible du client et ses pièces jointes sont rangées ; sinon il est supprimé.
  // Le fil est mis à jour par élément (data-id : n° du message, « jalon-<type>-<date> ») : seuls les éléments nouveaux
  // ou changés sont redessinés, un élément qui contient le focus n'est remplacé qu'au tour suivant (dès que le focus le
  // quitte), sans zone live. Fenêtre des 40 derniers éléments, qui commence au plus tard au plus ancien élément à
  // traiter et ne se réduit jamais tant que la fiche reste affichée ; « Afficher les messages précédents » montre tout.
  const FENETRE = 40;
  const JALONS = { demande_recue: 'Demande reçue', devis_envoye: 'Devis envoyé', devis_signe: 'Devis signé', paiement_recu: 'Paiement reçu',
    documents_prets: 'Documents prêts', documents_valides: 'Documents validés', retractation: 'Rétractation reçue', dossier_clos: 'Dossier clos' };
  const enCours = new Map();     // message → action en cours : ses boutons restent occupés même si le fil est redessiné
  const nouveaux = new Set();    // messages du client non lus à l'ouverture de la fiche ou arrivés depuis : badge « Nouveau »
  const ouverts = new Set();     // « Message complet » ouverts
  const complets = new Map();    // texte intégral d'un e-mail, lu une fois (première ouverture de « Message complet »)
  const resultats = new Map();   // résultat de « Renvoyer l'e-mail », par message
  const dessins = new WeakMap(); // élément du fil → empreinte de ce qu'il montre
  const voulues = new Map();     // clé → empreinte attendue au dernier rendu
  let filDe = null;              // dossier dont le fil est affiché
  let toutAfficher = false;
  let premierMontre = null;      // clé de tri { date, rang, n } du premier élément montré
  const sansAncrage = !(window.CSS && CSS.supports && CSS.supports('overflow-anchor', 'auto'));   // Safari : pas d'ancrage de défilement
  const viderFil = () => {
    toutAfficher = false; premierMontre = null;
    nouveaux.clear(); ouverts.clear(); resultats.clear(); voulues.clear();
    $('[data-discussion]').textContent = '';
  };
  // Fiche quittée (liste, déconnexion) : fil, fenêtre et badges « Nouveau » oubliés
  const quitterFiche = () => { filDe = null; viderFil(); };

  const adresse = (s) => { const x = String(s || '').match(/<([^>]+)>/); return (x ? x[1] : String(s || '')).trim().toLowerCase(); };
  const RESULTATS = {
    pass: 'validé', fail: 'échec', gray: 'non concluant', processing_failed: 'erreur de contrôle', unknown: 'inconnu',
    none: 'absente', temperror: 'erreur temporaire (DNS)', permerror: 'illisible'
  };
  const resultat = (v) => { const s = typeof v === 'string' ? v : v && typeof v === 'object' ? String(v.result || v.status || '') : ''; return RESULTATS[s] || s || 'inconnu'; };
  // Contrôle fait par le moteur (controle « moteur ») : signature DKIM seulement, rien si l'adresse diffère (non
  // contrôlée) ; sinon résultats SPF, DKIM et DMARC fournis par Resend.
  const authentification = (m) => {
    const a = m.auth && typeof m.auth === 'object' ? m.auth : null;
    if (!a) return 'Authentification inconnue';
    if (a.controle === 'moteur') return a.dkim ? 'Signature DKIM : ' + resultat(a.dkim) + (typeof a.dkim_domaine === 'string' && a.dkim_domaine ? ' (' + a.dkim_domaine + ')' : '') : '';
    return 'Authentification : ' + [['spf', 'SPF'], ['dkim', 'DKIM'], ['dmarc', 'DMARC']].map(([k, n]) => n + ' ' + resultat(a[k])).join(', ');
  };
  const pourquoi = (d, m) => [
    adresse(m.expediteur) !== adresse(d.email) ? 'Adresse différente de celle du dossier (' + d.email + ')' : '',
    authentification(m)
  ].filter(Boolean).join(' · ');
  // Élément à traiter : la fenêtre du fil commence au plus tard au plus ancien
  const aTraiter = (m) => !m.verifie || nonLu(m) || incomplet(m) || envoiRate(m);

  const ORDRE_JALONS = Object.keys(JALONS);
  // Ordre du fil (même clé et même ordre que l'espace client) : date, étape clé avant message, puis ordre des étapes clés
  // ou n° du message
  const ordreFil = (a, b) => (a.date - b.date) || (a.rang - b.rang) || (a.n - b.n);
  const elementsDuFil = (d) => {
    const jalons = (Array.isArray(d.evenements) ? d.evenements : []).filter((e) => e && JALONS[e.type] && e.le)
      .map((e) => ({ cle: 'jalon-' + e.type + '-' + e.le, date: new Date(e.le).getTime(), rang: 0, n: ORDRE_JALONS.indexOf(e.type), jalon: e }));
    const messages = (d.messages || []).map((m) => ({ cle: String(m.id), date: new Date(m.recu_le).getTime(), rang: 1, n: m.id, message: m }));
    return jalons.concat(messages).sort(ordreFil);
  };
  // Empreinte d'un message : tout ce qui change son dessin (pas la date de lecture : le badge « Nouveau » suit `nouveaux`)
  const empreinte = (d, m) => JSON.stringify([Object.assign({}, m, { lu_agence_le: undefined }), nouveaux.has(m.id), enCours.get(m.id) || '', resultats.get(m.id) || '',
    incomplet(m), envoiRate(m), envoiEnCours(m), deLAgence(m) ? '' : [d.email, d.prenom, d.nom]]);

  const rendreDiscussion = (d) => {
    const ol = $('[data-discussion]');
    const premierDessin = filDe !== d.id;
    if (premierDessin) { filDe = d.id; viderFil(); }
    (d.messages || []).forEach((m) => { if (nonLu(m)) nouveaux.add(m.id); });
    const tous = elementsDuFil(d);
    let debut = toutAfficher ? 0 : Math.max(0, tous.length - FENETRE);
    const aFaire = tous.findIndex((x) => x.message && aTraiter(x.message));
    if (aFaire >= 0) debut = Math.min(debut, aFaire);
    // Fenêtre jamais réduite : elle part au plus tard du premier élément dont la clé de tri suit celle du premier élément
    // montré, même si celui-ci a disparu (message supprimé)
    const avant = premierMontre ? tous.findIndex((x) => ordreFil(x, premierMontre) >= 0) : -1;
    if (avant >= 0) debut = Math.min(debut, avant);
    const montres = tous.slice(debut);
    premierMontre = montres.length ? { date: montres[0].date, rang: montres[0].rang, n: montres[0].n } : null;
    $('[data-discussion-plus]').hidden = debut === 0;
    $('[data-discussion-vide]').hidden = tous.some((x) => x.message);
    voulues.clear();
    montres.forEach((x) => { x.sig = x.message ? empreinte(d, x.message) : JSON.stringify([x.jalon.type, x.jalon.le]); voulues.set(x.cle, x.sig); });
    const focus = document.activeElement;
    // Repère de défilement (navigateurs sans ancrage natif : Safari), choisi avant les ajouts, comme dans l'espace client :
    // le champ qui a le focus s'il est à l'écran, sinon le premier élément visible parmi les éléments du fil qui restent en
    // place à ce rendu (inchangés, ou qui contiennent le focus), le composeur et les blocs qui suivent la discussion ;
    // remis à sa place après les ajouts (window.scrollBy). Premier dessin de la fiche : rien à compenser.
    const aLEcran = (n) => { const r = n.getBoundingClientRect(); return r.height > 0 && r.bottom > 0 && r.top < window.innerHeight; };
    const repere = !sansAncrage || premierDessin || window.scrollY <= 0 ? null
      : focus && /^(TEXTAREA|INPUT)$/.test(focus.tagName) && aLEcran(focus) ? focus
        : Array.from(ol.children).filter((li) => li.contains(focus) || (voulues.has(li.dataset.id) && dessins.get(li) === voulues.get(li.dataset.id)))
          .concat($$('.composeur, .discussion-bloc ~ .bloc', vues.dossier)).find(aLEcran) || null;
    const haut = repere ? repere.getBoundingClientRect().top : 0;
    const actuels = new Map(Array.from(ol.children).map((li) => [li.dataset.id, li]));
    const gardes = new Set();   // éléments disparus qui ont le focus : retirés au tour suivant
    actuels.forEach((li, cle) => { if (voulues.has(cle)) return; if (li.contains(focus)) gardes.add(li); else li.remove(); });
    let pos = ol.firstElementChild;
    montres.forEach((x) => {
      while (pos && gardes.has(pos)) pos = pos.nextElementSibling;
      let li = actuels.get(x.cle);
      if (li && dessins.get(li) !== x.sig && !li.contains(focus)) {
        const neuf = construire(d, x);
        li.replaceWith(neuf);
        if (pos === li) pos = neuf;
        li = neuf;
      } else if (!li) li = construire(d, x);
      if (li === pos) { pos = pos.nextElementSibling; return; }
      ol.insertBefore(li, pos);
    });
    if (repere && repere.isConnected) { const ecart = repere.getBoundingClientRect().top - haut; if (Math.abs(ecart) >= 1) window.scrollBy(0, ecart); }
  };
  const construire = (d, x) => {
    const li = x.message ? construireMessage(d, x.message) : construireJalon(x.jalon);
    li.dataset.id = x.cle;
    dessins.set(li, x.sig);
    return li;
  };
  // Étape clé : ligne datée (jour seul, heure de Paris)
  const construireJalon = (e) => {
    const li = el('li', 'jalon');
    li.appendChild(el('span', '', JALONS[e.type] + '\u00a0· ' + fmtDate(e.le)));
    return li;
  };
  // En-tête d'une bulle : auteur (toujours écrit ; une adresse longue se coupe), puis date et heure et canal, chacun
  // insécable (même rendu que l'espace client) ; espace insécable avant « · » : une ligne ne commence jamais par lui
  const enTete = (auteur, parties) => {
    const p = el('p', 'msg-meta', auteur);
    parties.filter(Boolean).forEach((x) => { p.appendChild(document.createTextNode('\u00a0· ')); p.appendChild(el('span', 'insecable', x)); });
    return p;
  };
  const construireMessage = (d, m) => {
    const agence = deLAgence(m), email = !agence && !depuisEspace(m), quand = fmtHeure(m.recu_le);
    const li = el('li', 'msg ' + (agence ? 'msg--moi' : 'msg--autre') + (m.verifie ? '' : ' msg--verifier'));
    const de = agence ? 'Vous' : email ? (m.expediteur || 'expéditeur inconnu') : (((d.prenom || '') + ' ' + (d.nom || '')).trim() || 'Le client');
    if (!agence && nouveaux.has(m.id)) li.appendChild(el('span', 'badge badge--agence', 'Nouveau'));
    if (!m.verifie) li.appendChild(el('span', 'badge badge--verifier', 'À vérifier'));
    if (incomplet(m)) li.appendChild(el('span', 'badge badge--verifier', 'Traitement incomplet'));
    if (enAttenteMoteur(m)) li.appendChild(el('span', 'badge badge--verifier', 'En attente du moteur'));
    if (envoiRate(m)) { const b = el('span', 'badge badge--agence', 'E-mail non parti'); b.dataset.badgeEnvoi = ''; li.appendChild(b); }
    else if (envoiEnCours(m)) li.appendChild(el('span', 'badge', 'Envoi en cours'));
    // Auteur (toujours écrit), date et heure, canal ; message de l'agence ajouté sans e-mail (hors questions reprises)
    const canal = agence ? (m.mail_etat == null && !m.reprise ? 'sans e-mail' : '') : email ? 'par e-mail' : 'depuis son espace';
    li.appendChild(enTete(de, [quand, canal]));
    if (!m.verifie) li.appendChild(el('p', 'msg-meta', pourquoi(d, m)));
    if (incomplet(m)) li.appendChild(el('p', 'msg-meta', 'Le traitement de ce message s’est interrompu : pièces jointes peut-être non rangées, réponse peut-être non enregistrée.'));
    if (enAttenteMoteur(m)) li.appendChild(el('p', 'msg-meta', 'Le moteur de l’agence range ses pièces jointes à son prochain passage (toutes les 5 minutes, ordinateur de l’agence allumé).'));
    if (email && m.sujet) li.appendChild(el('p', 'msg-sujet', m.sujet));
    const pieces = (Array.isArray(m.pieces) ? m.pieces : []).filter((x) => x && x.nom);
    // Texte du message (pour un e-mail : la réponse seule ; lecture d'avant la migration 0006 : texte intégral à défaut)
    const texte = String(m.texte || '').trim() || (typeof m.texte_complet === 'string' ? m.texte_complet.trim() : '');
    if (texte || !pieces.length) li.appendChild(el('p', 'msg-texte', texte || 'Message sans texte'));
    if (email) li.appendChild(messageComplet(m));
    if (pieces.length) li.appendChild(listePieces(d, m, pieces));
    if (!m.verifie) {
      const zone = el('div', 'form-actions');
      const suppr = el('button', 'btn btn--ghost', 'Supprimer'); suppr.type = 'button';
      suppr.setAttribute('aria-label', 'Supprimer le message de ' + de + ' reçu le ' + quand);
      const ratt = el('button', 'btn', 'Rattacher au dossier'); ratt.type = 'button';
      ratt.setAttribute('aria-label', 'Rattacher au dossier le message de ' + de + ' reçu le ' + quand);
      const err = el('div', 'f-err'); err.setAttribute('role', 'alert'); err.hidden = true;
      const pris = enCours.get(m.id);
      if (pris) { suppr.disabled = ratt.disabled = true; (pris === 'rattacher' ? ratt : suppr).textContent = 'Envoi…'; }
      suppr.addEventListener('click', () => {
        if (!window.confirm('Supprimer définitivement ce message de ' + de + ', reçu le ' + quand + ' ?')) return;
        actionMessage(d, m, 'supprimer_message', (j) => (j.deja ? 'Ce message avait déjà été supprimé.' : 'Message supprimé.'), suppr, ratt, err);
      });
      ratt.addEventListener('click', () => {
        if (!window.confirm('Rattacher au dossier N° ' + d.id + ' ce message de ' + de + ' ?\nIl sera traité comme une réponse du client : visible dans son espace, pièces jointes éventuelles rangées avec ses pièces.'
          + ' Le client pourra lire tout l’e-mail, citation comprise, et l’adresse de l’expéditeur. Le client ne reçoit pas d’e-mail.')) return;
        actionMessage(d, m, 'rattacher', bilanRattachement, ratt, suppr, err);
      });
      zone.appendChild(suppr); zone.appendChild(ratt);
      li.appendChild(zone); li.appendChild(err);
    } else if (incomplet(m)) {
      // Reprise du traitement (même action que le rattachement) : pièces manquantes rangées.
      const zone = el('div', 'form-actions');
      const rep = el('button', 'btn', 'Reprendre le traitement'); rep.type = 'button';
      rep.setAttribute('aria-label', 'Reprendre le traitement du message de ' + de + ' reçu le ' + quand);
      const err = el('div', 'f-err'); err.setAttribute('role', 'alert'); err.hidden = true;
      const pris = enCours.get(m.id);
      if (pris) { rep.disabled = true; rep.textContent = 'Envoi…'; }
      rep.addEventListener('click', () => actionMessage(d, m, 'rattacher', bilanRattachement, rep, rep, err));
      zone.appendChild(rep);
      li.appendChild(zone); li.appendChild(err);
    }
    // Message de l'agence dont l'e-mail n'est pas parti : « Renvoyer l'e-mail », résultat dans la bulle (role=status)
    if (agence && (envoiRate(m) || resultats.has(m.id))) {
      if (envoiRate(m)) {
        const zone = el('div', 'form-actions');
        const b = el('button', 'btn btn--ghost', enCours.get(m.id) === 'renvoyer' ? 'Envoi…' : 'Renvoyer l’e-mail'); b.type = 'button';
        b.setAttribute('aria-label', 'Renvoyer au client l’e-mail du message du ' + quand);
        b.dataset.renvoi = '';
        if (enCours.has(m.id)) b.setAttribute('aria-disabled', 'true');
        b.addEventListener('click', () => renvoyerMail(d.id, m, b));
        zone.appendChild(b);
        li.appendChild(zone);
      }
      const statut = el('p', 'msg-meta', resultats.get(m.id) || '');
      statut.setAttribute('role', 'status'); statut.dataset.statut = '';
      li.appendChild(statut);
    }
    return li;
  };

  // « Message complet » d'un e-mail du client (citation de nos e-mails comprise) : texte intégral lu à la première
  // ouverture seulement, gardé en mémoire ; ouvert, il le reste quand le fil est redessiné.
  const lectures = new Map();   // message → lecture du texte intégral en cours
  const messageComplet = (m) => {
    const det = el('details', 'msg-complet');
    det.appendChild(el('summary', 'link-more', 'Message complet'));
    const corps = el('p', 'msg-texte');
    det.appendChild(corps);
    const montrerTexte = (t) => { corps.textContent = String(t || '').trim() || String(m.texte || '').trim() || 'Message sans texte'; };
    det.addEventListener('toggle', () => {
      if (!det.open) { ouverts.delete(m.id); return; }
      ouverts.add(m.id);
      if (typeof m.texte_complet === 'string') return montrerTexte(m.texte_complet);   // lecture d'avant la migration 0006
      if (complets.has(m.id)) return montrerTexte(complets.get(m.id));
      corps.textContent = 'Chargement…';
      if (!lectures.has(m.id)) lectures.set(m.id, api.texteComplet(m.id).then((t) => { complets.set(m.id, t); return t; }).finally(() => lectures.delete(m.id)));
      lectures.get(m.id).then(montrerTexte, () => { corps.textContent = 'Message complet indisponible pour le moment. Réessayez dans quelques minutes.'; });
    });
    if (ouverts.has(m.id)) det.open = true;
    return det;
  };

  // Pièces jointes : téléchargeables une fois rangées (client : <id>/client/, après vérification ou rattachement ;
  // agence : <id>/agence/discussion/)
  const listePieces = (d, m, pieces) => {
    const prefixe = d.id + (deLAgence(m) ? '/agence/discussion/' : '/client/');
    const ulp = el('ul', 'pieces'); ulp.setAttribute('role', 'list'); ulp.setAttribute('aria-label', 'Pièces jointes');
    pieces.forEach((pc) => {
      const rangee = typeof pc.chemin === 'string' && pc.chemin.startsWith(prefixe) && !pc.chemin.includes('..');
      const lp = el('li');
      lp.appendChild(el('span', '', pc.nom + (Number(pc.taille) > 0 ? ' · ' + fmtTaille(Number(pc.taille)) : '') + (rangee ? '' : ' · non rangée')));
      if (rangee) {
        const b = el('button', 'link-more', 'Télécharger'); b.type = 'button';
        b.setAttribute('aria-label', 'Télécharger ' + pc.nom);
        b.addEventListener('click', () => telecharger(pc.chemin, pc.nom));
        lp.appendChild(b);
      }
      ulp.appendChild(lp);
    });
    return ulp;
  };

  // Bilan renvoyé par la fonction après un rattachement : pièces rangées, pièces non rangées (non_rangees : format ou
  // taille refusés, avec la raison). Champs facultatifs : une valeur absente ou d'un autre format est ignorée.
  const bilanRattachement = (j) => {
    if (j.deja) return 'Ce message était déjà rattaché au dossier.';
    // Message du moteur : rattaché tout de suite, pièces rangées par le moteur à son passage suivant.
    if (j.moteur === true) {
      return j.reprise === true ? 'Le moteur de l’agence termine le traitement de ce message à son prochain passage.'
        : 'Message rattaché au dossier : le moteur de l’agence range ses pièces jointes à son prochain passage (toutes les 5 minutes, ordinateur de l’agence allumé).';
    }
    const nb = (v) => (Array.isArray(v) ? v.length : Number.isInteger(v) ? v : 0);
    const p = nb(j.pieces);
    const nonRangees = (Array.isArray(j.non_rangees) ? j.non_rangees : []).filter((x) => typeof x === 'string' && x);
    return (j.reprise === true ? 'Traitement du message terminé' : 'Message rattaché au dossier') + (p ? ' : ' + (p > 1 ? p + ' pièces jointes rangées' : '1 pièce jointe rangée') : '') + '.'
      + (nonRangees.length ? ' Non rangées : ' + nonRangees.join(', ') + '.' : '')
      + (j.pieces_indisponibles === true ? ' Ses pièces jointes ne sont plus disponibles : demandez-les au client.' : '');
  };

  // Rattacher ou supprimer un message : attaché au dossier et au message du clic ; ses deux boutons restent occupés
  // jusqu'à la fin, même si le fil est redessiné entre-temps (rafraîchissement, retour sur la fiche).
  const actionMessage = (d, m, nom, merci, btn, autre, err) => {
    const pid = d.id;
    enCours.set(m.id, nom);
    autre.disabled = true;
    agir(btn, err, nom, { message: m.id }, merci, () => { enCours.delete(m.id); }, pid)
      .then(() => { if (btn.isConnected) autre.disabled = false; })   // relecture ratée : fil non redessiné
      .catch((ex) => {
        enCours.delete(m.id);
        if (!courant || courant.id !== pid) return;   // échec signalé en tête, avec le numéro du dossier
        if (btn.isConnected) { autre.disabled = false; return; }
        rendreDiscussion(courant);                   // fil redessiné pendant l'envoi : boutons rétablis
        annoncer((ex && ex.message) || ECHEC);
      });
  };

  // « Renvoyer l'e-mail » d'un message de l'agence. Le bouton garde le focus pendant l'envoi (aria-disabled) ; le
  // résultat s'écrit dans la zone d'annonce de la bulle, puis le dossier est relu (la bulle est mise à jour dès que le
  // focus la quitte). Une autre fiche ouverte entre-temps : échec signalé en bas, avec le numéro du dossier.
  const bulle = (id) => Array.from($('[data-discussion]').children).find((li) => li.dataset.id === String(id));
  const renvoyerMail = (pid, m, btn) => {
    if (enCours.has(m.id) || btn.getAttribute('aria-disabled') === 'true') return;
    const compte = charge;
    enCours.set(m.id, 'renvoyer');
    resultats.delete(m.id);
    btn.setAttribute('aria-disabled', 'true'); btn.textContent = 'Envoi…';
    const s0 = btn.closest('li') && $('[data-statut]', btn.closest('li'));
    if (s0) s0.textContent = '';
    api.action('renvoyer_message', pid, { message: m.id })
      .then((j) => ({ parti: j.mail === true, texte: j.mail ? 'E-mail renvoyé au client.' : 'L’e-mail n’est toujours pas parti : réessayez dans quelques minutes.' }),
        (ex) => ({ parti: false, texte: (ex && ex.message) || ECHEC }))
      .then((r) => {
        if (charge !== compte) return;   // déconnexion entre-temps : rien n'est écrit dans la page
        enCours.delete(m.id);
        resultats.set(m.id, r.texte);
        if (!courant || courant.id !== pid) { if (!r.parti) erreur('Dossier N° ' + pid + ' : ' + r.texte); return; }
        const li = bulle(m.id), b = li && $('[data-renvoi]', li), s = li && $('[data-statut]', li), badge = li && $('[data-badge-envoi]', li);
        if (b) { b.textContent = 'Renvoyer l’e-mail'; if (!r.parti) b.removeAttribute('aria-disabled'); }
        if (r.parti && badge) badge.remove();   // e-mail parti : la bulle ne dit plus « E-mail non parti » (le bouton garde le focus)
        if (s) s.textContent = r.texte;
        return rafraichir(pid).catch(() => {});
      });
  };

  // « Afficher les messages précédents » : tout le fil ; focus sur le premier élément nouvellement montré
  $('[data-discussion-plus]').addEventListener('click', () => {
    if (!courant) return;
    const avantPremier = premierMontre;
    toutAfficher = true;
    rendreDiscussion(courant);
    const li = $('[data-discussion]').firstElementChild;
    if (li && premierMontre && (!avantPremier || ordreFil(premierMontre, avantPremier) < 0)) { li.setAttribute('tabindex', '-1'); li.focus(); }
  });
  // Un élément du fil qui gardait le focus pendant un rendu est remplacé dès que le focus le quitte
  $('[data-discussion]').addEventListener('focusout', (e) => {
    const li = e.target && e.target.closest ? e.target.closest('[data-discussion] > li') : null;
    if (!li || !courant || voulues.get(li.dataset.id) === dessins.get(li)) return;
    setTimeout(() => { if (courant && filDe === courant.id && !li.contains(document.activeElement)) rendreDiscussion(courant); }, 0);
  });

  // ---------- Lu ----------
  // Messages du client non lus dessinés dans le fil : marqués lus par la fonction (messages_lus, 100 au plus par appel),
  // seulement si l'onglet est visible et la fenêtre active (sinon au retour sur la fenêtre), jamais sans non-lu dessiné.
  // Appel direct (ni annonce ni relecture) ; au succès, date de lecture mise à jour en mémoire (badge de la liste juste
  // au retour) ; échec silencieux, nouvel essai au prochain rendu ou au prochain focus (jamais aussitôt : pas d'appels sans
  // fin quand la fonction refuse ou que le réseau est coupé).
  const lusEnVol = new Set();
  const marquerLus = () => {
    if (!courant || !charge || !autorise || vues.dossier.hidden || document.visibilityState !== 'visible' || !document.hasFocus()) return;
    const pid = courant.id, compte = charge;
    const dessines = new Set(Array.from($('[data-discussion]').children).map((li) => li.dataset.id));
    const ids = (courant.messages || []).filter((m) => nonLu(m) && dessines.has(String(m.id)) && !lusEnVol.has(m.id)).map((m) => m.id).slice(0, 100);
    if (!ids.length) return;
    ids.forEach((i) => lusEnVol.add(i));
    api.action('messages_lus', pid, { ids }).then(() => {
      if (charge !== compte) return;
      const t = new Date().toISOString();
      ids.forEach((i) => lus.add(i));
      [dossiers.find((x) => x.id === pid), courant && courant.id === pid ? courant : null].forEach((x) => {
        ((x && x.messages) || []).forEach((m) => { if (ids.includes(m.id) && m.lu_agence_le === null) m.lu_agence_le = t; });
      });
      // 100 marqués : les suivants aussitôt (après un échec, jamais : nouvel essai au prochain rendu ou au prochain focus)
      if (ids.length === 100) marquerLus();
    }).catch(() => {}).finally(() => { ids.forEach((i) => lusEnVol.delete(i)); });
  };
  window.addEventListener('focus', marquerLus);

  // ---------- Rafraîchissement ----------
  // Fiche affichée : dossier relu toutes les 30 s (onglet visible), au retour sur l'onglet et après l'envoi d'un message ;
  // données en mémoire, fil et bandeau mis à jour, jamais toute la fiche (note, montant, libellé et PDF du devis en cours
  // de saisie gardés). L'étape, la signature, le paiement, la rétractation ou l'envoi du devis ont changé : fiche
  // redessinée s'il n'y a aucune saisie en cours, sinon bandeau « Le dossier a changé ». Réponse ignorée si le compte a
  // changé, appliquée aux seules données si une autre fiche est affichée ; échec silencieux (sauf pour l'appelant).
  const CHAMPS_FICHE = ['etape', 'signe_le', 'paye_le', 'retracte_le', 'devis_envoye_le'];
  const saisieEnCours = (d) => $('[data-note]').value !== (etapeDe(d).note || '')
    || $('[data-montant]').value !== (d.montant_cents ? String(d.montant_cents / 100).replace('.', ',') : '')
    || $('[data-libelle]').value !== (d.montant_libelle || '') || (($('[data-devis-fichier]').files || []).length > 0);
  const piecesClient = (d) => (d.messages || []).map((m) => (Array.isArray(m.pieces) ? m.pieces : []).map((x) => (x && x.chemin) || '').join('|')).join('|');
  const relectures = new Map();   // dossier → relecture en cours (une autre demandée pendant celle-ci la suit)
  const rafraichir = (pid) => {
    const r = relectures.get(pid);
    if (r) { r.encore = true; return r.promesse; }
    const compte = charge, etat = { encore: false };
    const appliquer = (frais) => {
      if (!frais || charge !== compte || !autorise) return;
      remplacer(frais);
      // Retour à la liste pendant l'envoi : sa ligne montre aussitôt la nouvelle situation (jamais sous le focus)
      if (!courant && !vues.liste.hidden) { rendreListe(true); return; }
      if (!courant || courant.id !== pid || vues.dossier.hidden) return;
      const avant = courant;
      if (affiche && CHAMPS_FICHE.some((k) => (affiche[k] || null) !== (frais[k] || null))) {
        if (!aRouvrir && !saisieEnCours(affiche)) { ouvrir(frais, true); return; }
        aRouvrir = true;
      }
      courant = frais;
      rendreAlertes(frais);
      rendreDiscussion(frais);
      if (piecesClient(frais) !== piecesClient(avant)) rafraichirDocs();
      marquerLus();
    };
    const tourDeLecture = () => api.relire(pid).then(appliquer).then(() => { if (etat.encore) { etat.encore = false; return tourDeLecture(); } });
    etat.promesse = tourDeLecture().finally(() => { relectures.delete(pid); });
    relectures.set(pid, etat);
    return etat.promesse;
  };
  const visible = () => document.visibilityState === 'visible';
  setInterval(() => { if (visible() && charge && autorise && courant && !vues.dossier.hidden) rafraichir(courant.id).catch(() => {}); }, 30000);
  setInterval(() => { if (visible() && charge && autorise && !courant && !vues.liste.hidden) actualiser(true); }, 60000);
  document.addEventListener('visibilitychange', () => {
    if (!visible() || !charge || !autorise) return;
    if (courant && !vues.dossier.hidden) rafraichir(courant.id).catch(() => {});
    else if (!courant && !vues.liste.hidden) actualiser(true);
  });

  // ---------- Composeur : message au client ----------
  // Brouillon gardé par dossier, en mémoire seulement (texte, fichiers choisis, case « sans e-mail », clé anti-doublon et
  // pièces déjà déposées) : jamais réécrit par un rendu, vidé après un envoi réussi et à la déconnexion. Les pièces
  // jointes sont déposées d'abord dans <id>/agence/discussion/<AAMMJJHHMMSS>-<nom> (hors des documents à valider),
  // puis l'action message_agence enregistre le message et l'envoie par e-mail. Une nouvelle tentative de même clé
  // réutilise les pièces déjà déposées ; la clé change avec le contenu, et les pièces de l'ancienne sont alors supprimées
  // si aucun message ne les cite (une tentative dont la réponse s'est perdue a pu être enregistrée).
  const formMessage = $('[data-form-message]');
  const champMessage = $('#a-message');
  const champFichiers = $('[data-message-fichiers]');
  const caseSansMail = $('[data-sans-mail]');
  const zoneDepot = $('.dropzone', formMessage);
  const errMessage = $('#a-message-err');
  const statutMessage = $('[data-message-statut]');
  const brouillons = new Map();
  const brouillon = (pid) => { if (!brouillons.has(pid)) brouillons.set(pid, { texte: '', fichiers: [], sansMail: false, cle: null, depots: [] }); return brouillons.get(pid); };
  const uuid = () => {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const o = crypto.getRandomValues(new Uint8Array(16));
    o[6] = (o[6] & 15) | 64; o[8] = (o[8] & 63) | 128;
    const x = Array.from(o, (v) => v.toString(16).padStart(2, '0')).join('');
    return x.slice(0, 8) + '-' + x.slice(8, 12) + '-' + x.slice(12, 16) + '-' + x.slice(16, 20) + '-' + x.slice(20);
  };
  const composeurFige = (pid) => enVol.has('[data-btn-message]|' + pid);
  // Pendant l'envoi d'un dossier, son composeur est figé (texte en lecture seule, fichiers et case inchangeables)
  const etatComposeur = (pid) => {
    if (dernierOuvert !== pid) return;
    const fige = composeurFige(pid);
    champMessage.readOnly = fige;
    champFichiers.disabled = fige;
    caseSansMail.disabled = fige;
    $$('button', $('[data-message-liste]')).forEach((b) => { b.disabled = fige; });
  };
  // Erreur du composeur ; champ : 'texte' ou 'fichiers' (aria-invalid, retiré à la correction)
  const erreurMessage = (msg, champ) => {
    errMessage.textContent = msg || ''; errMessage.hidden = !msg;
    [[champMessage, 'texte'], [champFichiers, 'fichiers']].forEach(([c, k]) => { if (msg && champ === k) c.setAttribute('aria-invalid', 'true'); else c.removeAttribute('aria-invalid'); });
  };
  const compter = () => {
    const n = champMessage.value.trim().length, z = $('[data-message-compte]');
    const t = n > SEUIL_COMPTE ? fmtNombre(n) + ' / ' + fmtNombre(MAX_TEXTE) + ' caractères' : '';
    if (z.textContent !== t) z.textContent = t;
    z.hidden = !t;
  };
  const rendreFichiers = (pid) => {
    const b = brouillon(pid), liste = $('[data-message-liste]'), n = b.fichiers.length;
    $('[data-message-label]').textContent = n ? n + ' fichier' + (n > 1 ? 's' : '') + ' sélectionné' + (n > 1 ? 's' : '') : 'Aucun fichier sélectionné';
    liste.hidden = !n;
    liste.textContent = '';
    b.fichiers.forEach((f, i) => {
      const puce = el('span', 'file-chip');
      puce.appendChild(el('span', '', f.name + ' · ' + fmtTaille(f.size)));
      const x = el('button', '', '×'); x.type = 'button';
      x.setAttribute('aria-label', 'Retirer ' + f.name);
      x.disabled = composeurFige(pid);
      x.addEventListener('click', () => retirerFichier(pid, i));
      puce.appendChild(x);
      liste.appendChild(puce);
    });
  };
  // Composeur rempli avec le brouillon du dossier (changement de fiche seulement)
  const remplirComposeur = (pid) => {
    const b = brouillon(pid);
    champMessage.value = b.texte;
    caseSansMail.checked = b.sansMail;
    erreurMessage('');
    statutMessage.textContent = '';
    zoneDepot.classList.remove('is-over');
    rendreFichiers(pid);
    compter();
    etatComposeur(pid);
  };
  const nettoyer = (pid, chemins) => api.relire(pid).then((d) => {
    if (!d) return;
    const cites = new Set([].concat(...(d.messages || []).map((m) => (Array.isArray(m.pieces) ? m.pieces : []).map((x) => x && x.chemin))));
    return chemins.filter((c) => !cites.has(c)).reduce((p, c) => p.then(() => api.supprimer(c).catch(() => {})), Promise.resolve());
  }).catch(() => {});
  // Contenu du brouillon changé : nouvelle clé au prochain envoi, pièces déposées pour l'ancienne supprimées si aucun
  // message ne les cite
  const abandonner = (pid) => {
    const b = brouillon(pid);
    if (!b.cle && !b.depots.length) return;
    const anciens = b.depots.map((x) => x.chemin);
    b.cle = null; b.depots = [];
    if (anciens.length) nettoyer(pid, anciens);
  };
  const fichiersValides = (b) => b.fichiers.length <= MAX_PIECES;
  const ajouterFichiers = (recus) => {
    const pid = dernierOuvert;
    const liste = Array.from(recus || []);
    if (!pid || !liste.length || composeurFige(pid)) return;
    const b = brouillon(pid);
    const formats = liste.filter((f) => !extension(f.name)), lourds = liste.filter((f) => extension(f.name) && f.size > MAX_POIDS);
    const vus = new Set(b.fichiers.map((f) => f.name + '|' + f.size));
    const ajout = liste.filter((f) => { const k = f.name + '|' + f.size; if (!extension(f.name) || f.size > MAX_POIDS || vus.has(k)) return false; vus.add(k); return true; });
    if (ajout.length) { b.fichiers = b.fichiers.concat(ajout); abandonner(pid); }
    rendreFichiers(pid);
    const noms = (l) => l.map((f) => f.name).join(', ');
    const msg = [formats.length ? REFUS.format + noms(formats) : '', lourds.length ? REFUS.poids + noms(lourds) : '', fichiersValides(b) ? '' : REFUS.nombre].filter(Boolean).join(' ');
    if (msg) erreurMessage(msg, 'fichiers');
    else if (champFichiers.getAttribute('aria-invalid') === 'true') erreurMessage('');
  };
  // « × » : fichier retiré du brouillon ; focus sur le « × » suivant, sinon le précédent, sinon le champ de fichiers
  const retirerFichier = (pid, i) => {
    if (composeurFige(pid) || dernierOuvert !== pid) return;
    const b = brouillon(pid);
    b.fichiers.splice(i, 1);
    abandonner(pid);
    rendreFichiers(pid);
    const boutons = $$('button', $('[data-message-liste]'));
    (boutons[i] || boutons[i - 1] || champFichiers).focus();
    if (champFichiers.getAttribute('aria-invalid') === 'true' && fichiersValides(b)) erreurMessage('');
  };
  champMessage.addEventListener('input', () => {
    if (!dernierOuvert) return;
    const b = brouillon(dernierOuvert);
    if (b.texte !== champMessage.value) { b.texte = champMessage.value; abandonner(dernierOuvert); }
    compter();
    const t = champMessage.value.trim();
    if (champMessage.getAttribute('aria-invalid') === 'true' && (t || b.fichiers.length) && t.length <= MAX_TEXTE) erreurMessage('');
  });
  caseSansMail.addEventListener('change', () => { if (dernierOuvert) brouillon(dernierOuvert).sansMail = caseSansMail.checked; });
  champFichiers.addEventListener('change', () => { ajouterFichiers(champFichiers.files); champFichiers.value = ''; });
  // Glisser-déposer sur tout le composeur ; ailleurs dans la page, un fichier lâché est ignoré (la page n'est jamais
  // quittée au profit du fichier : brouillon, note et devis en cours restent).
  const deFichiers = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  let survol = 0;
  formMessage.addEventListener('dragenter', (e) => { if (!deFichiers(e)) return; e.preventDefault(); survol++; zoneDepot.classList.add('is-over'); });
  formMessage.addEventListener('dragover', (e) => { if (!deFichiers(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; zoneDepot.classList.add('is-over'); });
  formMessage.addEventListener('dragleave', (e) => { if (!deFichiers(e)) return; survol = Math.max(0, survol - 1); if (!survol) zoneDepot.classList.remove('is-over'); });
  formMessage.addEventListener('drop', (e) => { if (!deFichiers(e)) return; e.preventDefault(); survol = 0; zoneDepot.classList.remove('is-over'); ajouterFichiers(e.dataTransfer.files); });
  document.addEventListener('dragover', (e) => { if (deFichiers(e) && !formMessage.contains(e.target)) { e.preventDefault(); e.dataTransfer.dropEffect = 'none'; } });
  document.addEventListener('drop', (e) => { if (deFichiers(e) && !formMessage.contains(e.target)) e.preventDefault(); });

  // Nom d'une pièce jointe dans Storage : caractères sûrs, extension gardée en minuscules (contrôlée par la fonction)
  const nomPiece = (nom) => { const ext = extension(nom); return (nomSur(ext ? nom.slice(0, -ext.length - 1) : nom).slice(0, 70) || 'piece') + (ext ? '.' + ext : ''); };
  // Pièces jointes d'un envoi déposées une à une sous un nom horodaté qui n'écrase jamais rien (…-2-…, …-3-… si le nom
  // est pris) ; celles déjà déposées pour la même clé sont réutilisées.
  const deposerPieces = (pid, b, fichiers) => fichiers.reduce((p, f) => p.then((chemins) => {
    const deja = b.depots.find((x) => x.fichier === f);
    if (deja) return chemins.concat(deja.chemin);
    const nom = nomPiece(f.name), h = horodatage();
    const essai = (n) => {
      const chemin = pid + '/agence/discussion/' + h + (n > 1 ? '-' + n : '') + '-' + nom;
      return api.deposer(chemin, f, false, TYPES_PIECES[extension(f.name)]).then(() => chemin, (ex) => {
        if (n < 9 && /exists|duplicate/i.test(String((ex && ex.message) || ''))) return essai(n + 1);
        const e = new Error('Pièce jointe non déposée : ' + f.name + '. Réessayez dans quelques minutes.'); e.depot = true; throw e;
      });
    };
    return essai(1).then((chemin) => { b.depots.push({ fichier: f, chemin }); return chemins.concat(chemin); });
  }), Promise.resolve([]));
  // Annonce après l'envoi (un e-mail non parti n'est jamais annoncé comme envoyé)
  const merciMessage = (j, sansMail) => {
    if (j.mail === true) return 'Message envoyé au client par e-mail.';
    if (j.mail_etat === 'en_cours') return 'Message déjà enregistré\u00a0: l’e-mail au client est en cours d’envoi.';
    if (j.mail_etat == null && (sansMail || j.deja)) return 'Message ajouté à la discussion, sans e-mail au client.';
    return 'Message ajouté à la discussion, mais l’e-mail au client n’est pas parti\u00a0: utilisez «\u00a0Renvoyer l’e-mail\u00a0» sous le message.';
  };
  formMessage.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!courant) return;
    const pid = courant.id, b = brouillon(pid), btn = $('[data-btn-message]'), compte = charge;
    if (composeurFige(pid)) return;
    const meme = () => !!courant && courant.id === pid;
    const texte = champMessage.value.trim();
    const refuser = (msg, champ) => { erreurMessage(msg, champ); (champ === 'texte' ? champMessage : champFichiers).focus(); };
    if (!texte && !b.fichiers.length) return refuser(REFUS.vide, 'texte');
    if (texte.length > MAX_TEXTE) return refuser(REFUS.long, 'texte');
    if (!fichiersValides(b)) return refuser(REFUS.nombre, 'fichiers');
    const formats = b.fichiers.filter((f) => !extension(f.name)), lourds = b.fichiers.filter((f) => f.size > MAX_POIDS);
    if (formats.length) return refuser(REFUS.format + formats.map((f) => f.name).join(', '), 'fichiers');
    if (lourds.length) return refuser(REFUS.poids + lourds.map((f) => f.name).join(', '), 'fichiers');
    erreurMessage('');
    statutMessage.textContent = '';
    b.cle = b.cle || uuid();
    b.sansMail = caseSansMail.checked;
    const cle = b.cle, sansMail = b.sansMail, fichiers = b.fichiers.slice();
    occuper(btn, pid);
    deposerPieces(pid, b, fichiers).then((pieces) => agir(btn, errMessage, 'message_agence', { cle, texte, pieces, sans_mail: sansMail }, (j) => merciMessage(j, sansMail), (j) => {
      // Envoyé (ou déjà enregistré) : brouillon vidé ; après « déjà », les pièces de cette tentative que le message
      // enregistré ne cite pas sont supprimées
      const depots = b.depots.map((x) => x.chemin);
      brouillons.delete(pid);
      if (dernierOuvert === pid) remplirComposeur(pid);
      if (j.deja && depots.length) nettoyer(pid, depots);
    }, pid, { zone: statutMessage, relecture: true })
      .then(() => { if (charge === compte && meme()) champMessage.focus(); }, (ex) => {
        if (charge !== compte) return;   // déconnexion entre-temps : brouillons déjà oubliés
        // Refus explicite (4xx, ou 503) : rien n'est enregistré, les pièces déposées sont supprimées (redéposées au
        // prochain essai) ; 409 (clé déjà prise par un autre message) : nouvelle clé au prochain essai. Autre erreur
        // (réseau, serveur) : le message a pu être enregistré, les pièces sont gardées pour un nouvel essai avec la même clé.
        if (ex && ((ex.statut >= 400 && ex.statut < 500) || ex.statut === 503)) {
          const depots = b.depots.map((x) => x.chemin);
          b.depots = [];
          if (ex.statut === 409) b.cle = null;
          if (depots.length) nettoyer(pid, depots);
        }
      }), (ex) => {
      // Dépôt d'une pièce impossible : rien n'est envoyé ; les pièces déjà déposées resservent au prochain essai
      rendre(btn, pid);
      if (charge !== compte) return;   // déconnexion entre-temps : rien n'est écrit dans la page
      const msg = (ex && ex.message) || ECHEC;
      if (meme()) { erreurMessage(msg); if (!btn.disabled) btn.focus(); } else erreur('Dossier N° ' + pid + ' : ' + msg);
    });
  });

  // ---------- Devis, signature, démarrage anticipé, rétractation, virement ----------
  const REF_PAIEMENT = { virement: ' par virement', manuel: ' (hors du site)' };
  // Devis toujours joint à l'e-mail du client (support durable des conditions générales qu'il contient) : 15 Mo au plus,
  // comme MAX_DEVIS_JOINT dans la fonction « espace », qui refuse aussi un devis plus lourd (même message, DEVIS_LOURD).
  const MAX_DEVIS = 15 * 1024 * 1024;
  const rendreDevis = (d) => {
    const dl = $('[data-devis-etat]');
    dl.textContent = '';
    const ligne = (k, v) => { if (!v) return; dl.appendChild(el('dt', '', k)); dl.appendChild(el('dd', '', v)); };
    const paye = !!d.paye_le, retracte = !!d.retracte_le;
    ligne('Devis', d.devis_chemin ? d.devis_chemin.split('/').pop() + (d.devis_envoye_le ? ' · envoyé le ' + fmtHeure(d.devis_envoye_le) : '') : 'Pas encore envoyé');
    if (d.montant_cents) ligne('Montant', (d.montant_libelle || 'Montant du devis') + ' : ' + euros(d.montant_cents));
    if (d.devis_empreinte && d.devis_empreinte !== 'demo') ligne('Empreinte SHA-256', d.devis_empreinte);
    ligne('Signature', d.signe_le ? 'Signé le ' + fmtHeure(d.signe_le) + ' par ' + d.signe_nom + (d.signe_ip ? ' (adresse IP ' + d.signe_ip + ')' : '') : d.devis_chemin ? 'En attente' : '');
    // Particulier : case de démarrage anticipé cochée à la signature (texte exact accepté), puis rétractation éventuelle
    if (d.demarrage_anticipe_le || (d.signe_le && particulier(d))) {
      ligne('Démarrage anticipé', d.demarrage_anticipe_le ? 'Demandé le ' + fmtHeure(d.demarrage_anticipe_le) + (d.demarrage_anticipe_texte ? '\n« ' + d.demarrage_anticipe_texte + ' »' : '') : 'Non demandé');
    }
    if (retracte) {
      ligne('Rétractation', 'Le ' + fmtHeure(d.retracte_le) + (d.retracte_nom ? ' par ' + d.retracte_nom : '') + (d.retracte_email ? ' (' + d.retracte_email + ')' : '')
        + (d.retracte_ip ? ', adresse IP ' + d.retracte_ip : ''));
    }
    if (d.montant_cents || paye) ligne('Référence du virement', d.id);
    ligne('Paiement', paye ? 'Payé le ' + fmtHeure(d.paye_le) + (d.paiement_ref ? REF_PAIEMENT[d.paiement_ref] || ' · réf. ' + d.paiement_ref : '')
      : d.montant_cents ? (retracte ? 'Aucun virement enregistré' : d.etape === 'paiement' ? 'Virement attendu' : 'En attente') : '');
    $('[data-montant]').value = d.montant_cents ? String(d.montant_cents / 100).replace('.', ',') : '';
    $('[data-libelle]').value = d.montant_libelle || '';
    $$('input, button[type="submit"]', $('[data-form-devis]')).forEach((n) => { n.disabled = paye; });
    $('[data-devis-aide]').textContent = paye ? 'Dossier payé : le devis ne peut plus être remplacé.'
      : retracte ? 'Le client a renoncé au contrat : envoyer un nouveau devis ouvre un nouveau contrat, à signer de nouveau.'
        : d.signe_le ? 'Envoyer un nouveau devis annule la signature actuelle : le client devra signer à nouveau.'
          : 'Le client reçoit le devis par e-mail (PDF joint) et le signe depuis le lien reçu, puis règle ce montant par virement avec le numéro du dossier en référence.';
    // « Virement reçu » : à l'étape paiement, dossier non payé ; jamais après une rétractation (pas d'e-mail « Paiement reçu »)
    $('[data-btn-paye]').hidden = !(d.etape === 'paiement' && d.montant_cents && !paye && !retracte);
    $('[data-devis-info]').textContent = 'Aucun fichier choisi';
    $('[data-devis-fichier]').value = '';
    $('[data-err-devis]').hidden = true;
  };
  $('[data-devis-fichier]').addEventListener('change', (ev) => {
    const f = ev.target.files && ev.target.files[0];
    $('[data-devis-info]').textContent = f ? f.name + ' · ' + fmtTaille(f.size) : 'Aucun fichier choisi';
  });

  // Horodatage AAMMJJHHMMSS à l'heure de Paris (format des numéros de dossier) : nom de fichier propre à chaque version
  const horodatage = () => {
    const p = {};
    new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).forEach((x) => { p[x.type] = x.value; });
    return p.year + p.month + p.day + p.hour + p.minute + p.second;
  };

  $('[data-form-devis]').addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (!courant) return;
    const err = $('[data-err-devis]');
    const f = $('[data-devis-fichier]').files && $('[data-devis-fichier]').files[0];
    const montant = $('[data-montant]').value;
    const libelle = $('[data-libelle]').value.trim();
    const dire = (m) => { err.textContent = m; err.hidden = false; };
    if (!f) return dire('Choisissez le devis au format PDF.');
    if (!/\.pdf$/i.test(f.name)) return dire('Le devis doit être un fichier PDF.');
    if (f.size > MAX_DEVIS) return dire('Devis trop lourd (15 Mo au plus) : il doit toujours être joint à l’e-mail du client. Allégez le PDF, puis envoyez-le de nouveau.');
    if (!centimes(montant)) return dire('Montant invalide : par exemple 720 ou 720,50.');
    const id = courant.id, compte = charge;
    const meme = () => !!courant && courant.id === id;
    const btn = $('[data-btn-devis]');
    const liberer = () => rendre(btn, id);
    occuper(btn, id); err.hidden = true;
    let chemin = null;
    // État réel du dossier juste avant le dépôt : payé → refus ; signé ou rétracté → confirmation
    api.relire(id).then((frais) => {
      if (!frais) throw new Error('Dossier introuvable : actualisez la page.');
      if (frais.paye_le) {
        liberer();
        if (meme()) { remplacer(frais); ouvrir(frais, true); dire('Ce dossier est déjà payé : le devis ne peut plus être remplacé.'); }
        return false;
      }
      const question = frais.retracte_le ? 'Le client a renoncé au contrat le ' + fmtHeure(frais.retracte_le) + '. Envoyer ce devis ouvre un nouveau contrat : le client devra le signer. Continuer ?'
        : frais.signe_le ? 'Ce devis est déjà signé. Envoyer un nouveau devis annule la signature : le client devra signer à nouveau. Continuer ?' : '';
      if (question && !window.confirm(question)) { liberer(); return false; }
      // Chaque version sous un nom propre : un devis signé n'est jamais écrasé
      chemin = id + '/agence/devis-' + id + '-' + horodatage() + '.pdf';
      return api.deposer(chemin, f, false).then(() => true);
    }).then((depose) => {
      if (!depose) return;
      return agir(btn, err, 'devis', { chemin, montant, libelle }, (j) => (j.mail === false
        ? 'Devis enregistré, mais l’e-mail au client n’est pas parti. Transmettez-lui ce lien de signature (valable 30 jours) : ' + (j.lien || '')
        : 'Devis envoyé : le client a reçu un e-mail pour le lire et le signer.'),
        () => { if (meme()) { $('[data-devis-fichier]').value = ''; $('[data-devis-info]').textContent = 'Aucun fichier choisi'; } }, id)
        .catch((ex) => {
          // Refus explicite (4xx, ou 503 : fonction indisponible ou liens non configurés, rien n'est enregistré) : le
          // fichier déposé n'a pas servi et est supprimé, sauf s'il est devenu le devis du dossier. Autre erreur réseau
          // ou serveur : la fonction a pu enregistrer le devis, le fichier est gardé.
          if (!(ex && ((ex.statut >= 400 && ex.statut < 500) || ex.statut === 503))) return;
          return api.relire(id).then((d2) => (d2 && d2.devis_chemin === chemin ? null : api.supprimer(chemin))).catch(() => {});
        })
        .then(() => { if (meme()) rafraichirDocs(); });
    }).catch((ex) => {
      liberer();
      if (charge !== compte) return;   // déconnexion entre-temps : rien n'est écrit dans la page
      const msg = (ex && ex.message) || ECHEC;
      if (meme()) { dire(/exists|duplicate/i.test(msg) ? 'Un fichier du même nom vient d’être déposé : réessayez.' : msg); if (!btn.disabled) btn.focus(); }
      else erreur('Dossier N° ' + id + ' : devis non envoyé (' + msg + ').');
    });
  });

  // « Virement reçu » : confirmation, puis état réel relu juste avant l'enregistrement. Une rétractation, un paiement ou
  // un changement d'étape survenus depuis l'affichage arrêtent l'opération (pas d'e-mail « Paiement reçu » au client).
  // Particulier qui a signé sans demander le démarrage anticipé (devis signé avant le parcours actuel), encore dans le
  // délai de rétractation (14 jours, prolongés jusqu'au premier jour ouvrable : 18 jours au plus) : la mission ne peut
  // pas commencer avant la fin du délai.
  const sansDemarrageAnticipe = (d) => particulier(d) && !!d.signe_le && !d.demarrage_anticipe_le && Date.now() < new Date(d.signe_le).getTime() + 18 * 86400000;
  $('[data-btn-paye]').addEventListener('click', () => {
    if (!courant) return;
    const d = courant, id = d.id, compte = charge;
    const meme = () => !!courant && courant.id === id;
    const btn = $('[data-btn-paye]'), err = $('[data-err-devis]');
    const attention = sansDemarrageAnticipe(d)
      ? '\n\nAttention : ce client particulier a signé le ' + fmtDate(d.signe_le) + ' sans demander que la mission commence avant la fin du délai de rétractation (devis signé avant le parcours actuel). Ne commencez pas la mission avant la fin de ce délai (14 jours après la signature), ou renvoyez-lui le devis pour qu’il le signe avec la case.'
      : '';
    if (!window.confirm('Virement reçu pour le dossier N° ' + id + ' ?\n' + (d.montant_libelle || 'Montant du devis') + ' : ' + euros(d.montant_cents) + ', référence ' + id + '.\n'
      + 'Le client recevra un e-mail « Paiement reçu » et le dossier passera à la production de ses documents.' + attention)) return;
    occuper(btn, id); err.hidden = true;
    const dire = (m) => { if (charge !== compte) return; if (meme()) { err.textContent = m; err.hidden = false; } else erreur('Dossier N° ' + id + ' : ' + m); };
    changementEtape(id, '[data-btn-paye]', () => api.relire(id).then((frais) => {
      if (charge !== compte) { rendre(btn, id); return; }
      if (!frais) throw new Error('Dossier introuvable : actualisez la page.');
      const raison = frais.retracte_le ? 'Le client a renoncé au contrat le ' + fmtHeure(frais.retracte_le) + ' : virement non enregistré. Les sommes reçues sont à rembourser sous 14 jours.'
        : frais.paye_le ? 'Ce dossier est déjà payé.'
          : frais.etape !== 'paiement' ? 'Le dossier n’est plus à l’étape « Paiement » : virement non enregistré.' : '';
      if (!raison) {
        return agir(btn, err, 'paye', {}, (j) => (j.deja ? 'Ce dossier était déjà payé.'
          : j.mail === false ? 'Virement enregistré : le dossier passe à la production de ses documents. Attention : l’e-mail « Paiement reçu » au client n’est pas parti.'
            : 'Virement enregistré : le client a reçu un e-mail et le dossier passe à la production de ses documents.'), null, id)
          .catch(() => {});
      }
      rendre(btn, id);
      if (meme()) { remplacer(frais); ouvrir(frais, true); }
      dire(raison);
    }).catch((ex) => {
      rendre(btn, id);
      if (charge !== compte) return;
      dire((ex && ex.message) || ECHEC);
      if (meme() && !btn.hidden && !btn.disabled) btn.focus();
    }));
  });

  // ---------- Documents ----------
  const telecharger = (chemin, nom) => { api.lien(chemin, nom).then((url) => { if (url && url !== '#') location.assign(url); }).catch(() => annoncer('Téléchargement impossible pour le moment.')); };
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
    const meme = () => !!courant && courant.id === id;
    api.lister(id, 'agence').then((l) => {
      docsAgence[id] = l;
      if (meme()) { rendreDocs($('[data-docs-agence]'), $('[data-vide-agence]'), l); etatBoutons(courant); }
    }).catch(() => { if (meme()) annoncer('Documents de l’agence indisponibles.'); });
    api.lister(id, 'client').then((l) => { if (meme()) rendreDocs($('[data-docs-client]'), $('[data-vide-client]'), l); }).catch(() => { if (meme()) annoncer('Pièces du client indisponibles.'); });
  };

  const depot = $('[data-depot]');
  depot.addEventListener('change', () => {
    const fichiers = Array.from(depot.files || []);
    depot.value = '';
    if (!courant || !fichiers.length) return;
    const id = courant.id, compte = charge;   // tous les fichiers vont dans ce dossier, même si une autre fiche est ouverte pendant l'envoi
    const meme = () => !!courant && courant.id === id;
    const err = $('[data-depot-err]'), info = $('[data-depot-info]');
    const lourds = fichiers.filter((f) => f.size > 50 * 1024 * 1024);
    if (lourds.length) { err.textContent = 'Fichier trop lourd (50 Mo max) : ' + lourds.map((f) => f.name).join(', '); err.hidden = false; return; }
    err.hidden = true; info.textContent = 'Envoi en cours…';
    const ko = [];
    fichiers.reduce((p, f) => p.then(() => api.deposer(id + '/agence/' + nomSur(f.name), f, false).catch((ex) => { ko.push(f.name + (/exists|duplicate/i.test(String(ex && ex.message)) ? ' (un fichier du même nom existe déjà)' : '')); })), Promise.resolve())
      .then(() => {
        if (charge !== compte) return;   // déconnexion entre-temps : rien n'est écrit dans la page
        if (!meme()) { if (ko.length) erreur('Dossier N° ' + id + ' — non déposé : ' + ko.join(', ')); return; }
        info.textContent = 'Visibles par le client dans son espace';
        if (ko.length) { err.textContent = 'Non déposé : ' + ko.join(', '); err.hidden = false; }
        else annoncer(fichiers.length > 1 ? fichiers.length + ' documents déposés : le client les voit dans son espace.' : 'Document déposé : le client le voit dans son espace.');
      })
      .finally(() => { if (meme()) rafraichirDocs(); });
  });

  $('[data-btn-pret]').addEventListener('click', () => {
    if (!courant) return;
    const id = courant.id;
    if (!window.confirm('Demander au client de valider ses documents ? Il recevra un e-mail avec la liste des documents et un lien pour les valider.')) return;
    const merci = (j) => (j.deja ? 'Le dossier était déjà à l’étape « Validation de vos documents ».'
      : j.retracte ? 'Dossier passé à l’étape « Validation de vos documents » : aucun e-mail n’est envoyé au client, qui a renoncé au contrat.'
        : j.mail === false ? 'Le dossier est à l’étape « Validation de vos documents », mais l’e-mail au client n’est pas parti : revenez à « Production de vos documents » puis redemandez la validation un peu plus tard.'
          : 'Le client a reçu un e-mail pour valider ses documents.');
    changementEtape(id, '[data-btn-pret]', () => agir($('[data-btn-pret]'), null, 'etape', { cle: 'validation' }, merci, null, id)).catch(() => {});
  });

  // ---------- Demande ----------
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
      ['Surfaces', SURFACES.filter((sf) => m2(d[sf[0]])).map((sf) => sf[1] + ' : ' + m2(d[sf[0]])).join('\n')],
      ['Démarrage souhaité', aff(d.calendrier, 'calendrier')], ['Message', d.message], ['Source', aff(d.source, 'source')]
    ].filter((r) => r[1]).forEach((r) => { dl.appendChild(el('dt', '', r[0])); dl.appendChild(el('dd', '', r[1])); });
  };

  // ---------- Session ----------
  // Déconnexion (ici ou dans un autre onglet) : plus aucune donnée client en mémoire ni dans la page (brouillons des
  // messages et fichiers choisis compris : ordinateur partagé)
  const oublier = () => {
    dossiers = []; courant = null; affiche = null; dernierOuvert = null;
    enVol.clear(); enCours.clear(); etapesEnVol.clear(); brouillons.clear(); lus.clear(); lusEnVol.clear(); complets.clear();
    Object.keys(docsAgence).forEach((k) => { delete docsAgence[k]; });
    quitterFiche(); listeAffichee = '';
    ['[data-liste]', '[data-compte-liste]', '[data-d-num]', '[data-d-titre]', '[data-d-sous]', '[data-d-liens]', '[data-alertes]', '[data-etapes]', '[data-discussion]',
      '[data-devis-etat]', '[data-docs-agence]', '[data-docs-client]', '[data-recap]', '[data-message-liste]', '[data-message-compte]', '[data-message-statut]'].forEach((sel) => { const n = $(sel); if (n) n.textContent = ''; });
    ['#a-recherche', '[data-note]', '[data-montant]', '[data-libelle]', '[data-devis-fichier]', '#a-message', '[data-message-fichiers]'].forEach((sel) => { const n = $(sel); if (n) n.value = ''; });
    caseSansMail.checked = false; erreurMessage('');
    $('[data-message-label]').textContent = 'Aucun fichier sélectionné';
    $('[data-message-liste]').hidden = true; $('[data-message-compte]').hidden = true;
    $('[data-alertes]').hidden = true;
    annoncer(''); erreur('');
  };
  // Connexion réussie (session reçue) et déconnexion (ici ou dans un autre onglet) : vue de connexion remise à l'étape 1,
  // adresse et code effacés. Premier affichage sans session : étape rétablie et message d'un ancien lien (reprendre).
  api.surChangement((session, evt) => {
    if (evt === 'TOKEN_REFRESHED' || evt === 'USER_UPDATED') return;
    const premier = !sessionLue;
    sessionLue = true;
    if (session && session.user) {
      etapeAdresse(true);
      $('[data-compte]').hidden = false;
      $('[data-compte-email]').textContent = session.user.email || '';
      if (charge === session.user.id) { titreAFocaliser = false; return; }
      const uid = session.user.id;
      charge = uid; autorise = false; montrer('chargement');
      api.estAdmin(uid).then((admin) => { if (charge !== uid) return; autorise = admin; if (admin) charger(); else montrer('refus'); })
        .catch(() => { if (charge !== uid) return; montrer('refus'); erreur('Vérification du compte impossible pour le moment.'); });
    } else {
      const deconnexion = charge !== null;
      charge = null; autorise = false;
      titreAFocaliser = false;
      oublier();
      $('[data-compte]').hidden = true;
      montrer('connexion');
      if (deconnexion) etapeAdresse(true);
      else if (premier) reprendre();
    }
  });
})();
