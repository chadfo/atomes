// Espace agence — connexion par lien e-mail (compte inscrit dans la table admins), liste des dossiers, fiche d'un dossier :
// avancement (étapes, option de suivi administratif, note pour le client), messages du client (réponses reçues par e-mail ;
// un message « à vérifier » est rattaché au dossier ou supprimé), questions au client, envoi du devis (le client le reçoit
// par e-mail et le signe depuis un lien), signature, démarrage anticipé et rétractation, virement reçu, documents de
// l'agence, pièces du client, modifications demandées.
// Les actions qui préviennent le client ou touchent aux messages passent par la fonction « espace » ; dépôts et notes
// passent directement par Supabase (règles RLS de l'agence). Chaque opération est attachée au dossier ouvert au moment du
// clic : changer de fiche pendant un envoi ne la détourne pas vers un autre dossier. Mode démo sans backend : admin/?demo
(() => {
  const cfg = window.ATOMES_CONFIG || {};
  const demo = new URLSearchParams(location.search).has('demo');
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const vues = {};
  $$('[data-vue]').forEach((v) => { vues[v.dataset.vue] = v; });
  const montrer = (nom) => { Object.keys(vues).forEach((k) => { vues[k].hidden = k !== nom; }); };
  const erreur = (msg) => { const e = $('[data-erreur]'); e.textContent = msg || ''; e.hidden = !msg; };
  const el = (tag, cls, texte) => { const n = document.createElement(tag); if (cls) n.className = cls; if (texte !== undefined) n.textContent = texte; return n; };
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
  const fmtCourt = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const fmtHeure = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' }) : '');
  const fmtTaille = (o) => (o >= 1048576 ? (o / 1048576).toFixed(1).replace('.', ',') + ' Mo' : Math.max(1, Math.round(o / 1024)) + ' Ko');
  const euros = (c) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format((c || 0) / 100);
  const nomSur = (nom) => (nom.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 80) || 'fichier');
  const SURFACES = [['surface_existante', 'Surface habitable existante'], ['surface', 'Surface habitable créée'], ['emprise_existante', 'Emprise au sol du bâti existant'], ['emprise', 'Emprise au sol du bâti après projet'], ['surface_terrain', 'Surface de la parcelle']];
  // Étapes qui envoient un e-mail au client quand on y fait avancer le dossier (même liste que la fonction « espace »).
  const ETAPES_MAIL = ['validation', 'instruction', 'accordee', 'clos'];
  const ECHEC = 'Action impossible pour le moment. Réessayez dans quelques minutes.';
  // « 720 », « 720,5 », « 1 200,00 » → centimes (même règle que la fonction)
  const centimes = (v) => { const s = String(v || '').replace(/[\s  €]/g, '').replace(',', '.'); if (!/^\d+(\.\d{1,2})?$/.test(s)) return null; const c = Math.round(Number(s) * 100); return c >= 100 && c <= 10000000 ? c : null; };
  // Lecture d'un dossier : timeline, questions, demandes de modification et messages reçus du client (migration 0005)
  const SELECTION = '*, etapes(*), questions(*), modifications(*), messages(*)';

  // ---------- Accès aux données ----------
  const apiSupabase = () => {
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    const ok = (r) => { if (r.error) throw r.error; return r.data; };
    const urlEspace = cfg.espaceUrl || cfg.supabaseUrl.replace(/\/$/, '') + '/functions/v1/espace';
    // Table des messages absente (migration 0005 pas encore appliquée) : dossiers lus sans eux
    const sansMessages = (e) => !!e && (e.code === 'PGRST200' || (/relationship/i.test(String(e.message || '')) && /messages/.test(String(e.message || ''))));
    const lireDossiers = (requete) => requete(SELECTION).catch((e) => { if (sansMessages(e)) return requete(SELECTION.replace(', messages(*)', '')); throw e; });
    return {
      surChangement: (fn) => sb.auth.onAuthStateChange((evt, session) => fn(session, evt)),
      connexion: (email) => sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname.replace(/index\.html$/, ''), shouldCreateUser: false } }).then(ok),
      deconnexion: () => sb.auth.signOut(),
      estAdmin: (uid) => sb.from('admins').select('user_id').eq('user_id', uid).maybeSingle().then(ok).then((d) => !!d),
      dossiers: () => lireDossiers((s) => sb.from('projets').select(s).order('cree_le', { ascending: false }).then(ok)),
      lister: (id, dossier) => sb.storage.from('dossiers').list(id + '/' + dossier, { limit: 200, sortBy: { column: 'created_at', order: 'desc' } }).then(ok)
        .then((objets) => objets.filter((o) => o.name && !o.name.startsWith('.') && o.id)
          .map((o) => ({ nom: o.name, chemin: id + '/' + dossier + '/' + o.name, taille: (o.metadata && o.metadata.size) || 0, date: o.created_at }))),
      lien: (chemin, nom, lire) => sb.storage.from('dossiers').createSignedUrl(chemin, 600, lire ? undefined : { download: nom }).then(ok).then((d) => d.signedUrl),
      deposer: (chemin, fichier, remplacer) => sb.storage.from('dossiers').upload(chemin, fichier, { upsert: !!remplacer, contentType: fichier.type || undefined }).then(ok),
      supprimer: (chemin) => sb.storage.from('dossiers').remove([chemin]).then(ok),
      relire: (id) => lireDossiers((s) => sb.from('projets').select(s).eq('id', id).maybeSingle().then(ok)),
      // Question sans réponse retirée ; faux si le client vient d'y répondre (elle est alors conservée)
      retirerQuestion: (id) => sb.from('questions').delete().eq('id', id).is('repondue_le', null).select('id').then(ok).then((l) => (l || []).length > 0),
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

  const apiDemo = () => {
    const now = Date.now(), j = 86400000, h = 3600000, iso = (t) => new Date(t).toISOString();
    // depuis : jours écoulés depuis le début de l'étape en cours (par défaut, deux jours après la demande)
    const base = (id, prenom, nom, type, commune, jours, extra, depuis) => {
      const p = Object.assign({
        id, cree_le: iso(now - jours * j), profil: 'Particulier', prenom, nom, email: prenom.toLowerCase() + '.' + nom.toLowerCase() + '@exemple.fr', telephone: '06 12 34 56 78',
        type, commune, code_postal: '83000', adresse: '12 rue des Oliviers', documents: ['Déclaration préalable'], bien: 'Maison', surface: 25, surface_existante: 110,
        calendrier: 'Dans 3 à 6 mois', message: 'Description du projet.', etape: 'traitement', suivi_administratif: false,
        devis_chemin: null, devis_empreinte: null, devis_envoye_le: null, montant_cents: null, montant_libelle: null, signe_le: null, signe_nom: null, signe_ip: null,
        demarrage_anticipe_le: null, demarrage_anticipe_texte: null, retracte_le: null, retracte_nom: null, retracte_email: null,
        paye_le: null, paiement_ref: null, documents_valides_le: null, envois_echoues: [], questions: [], modifications: [], messages: []
      }, extra || {});
      p.etapes = MODELE.map((m, i) => ({ cle: m[0], ordre: i + 1, libelle: m[1], description: m[2], optionnelle: m[3], instantanee: m[4], action: m[5], statut: 'a_venir', fait_le: null, debut_le: null, note: null }));
      const etape = p.etape; p.etape = 'traitement'; recalculer(p, p.cree_le); p.etape = etape; recalculer(p, iso(now - (depuis === undefined ? Math.max(0, jours - 2) : depuis) * j));
      return p;
    };
    const devis = (id, jours, cents, libelle) => ({ devis_chemin: id + '/agence/devis-' + id + '.pdf', devis_empreinte: 'demo', devis_envoye_le: iso(now - jours * j), montant_cents: cents, montant_libelle: libelle });
    // Signature ; un particulier a coché la case de démarrage anticipé (obligatoire pour signer)
    const signe = (nom, jours, pro) => ({ signe_le: iso(now - jours * j), signe_nom: nom, signe_ip: '203.0.113.7', demarrage_anticipe_le: pro ? null : iso(now - jours * j) });
    // E-mail reçu du client : réponse seule (texte) et texte intégral avec la citation de notre e-mail
    const recu = (mid, pid, expediteur, sujet, texte, t, verifie, pieces) => ({
      id: mid, projet_id: pid, recu_le: iso(t), expediteur, sujet, texte,
      texte_complet: texte + '\n\nLe ' + fmtCourt(iso(t - j)) + ', Atomes studio <contact@atomes.studio> a écrit :\n> Bonjour,\n> …',
      pieces: pieces || [], verifie, etape: null, resend_id: 'demo-' + mid, auth: { spf: 'pass', dkim: 'pass', dmarc: 'pass' }, traite: true, traitement_le: null
    });
    const dossiers = [
      base('261013101500', 'Paul', 'Durand', 'Construction', 'Toulon', 0),
      base('261010090000', 'Claire', 'Petit', 'Rénovation', 'Hyères', 3, {
        questions: [{ id: 1, question: 'Souhaitez-vous que nous nous chargions du dépôt (supplément) ?', choix: ['Je m’en occupe', 'Vous vous en chargez'], reponse: 'Vous vous en chargez, merci. Je joins le plan de l’existant.', commentaire: null, posee_le: iso(now - 2 * j), repondue_le: iso(now - j) }],
        messages: [recu(1, '261010090000', 'claire.petit@exemple.fr', 'Re: Une question sur votre dossier 261010090000', 'Vous vous en chargez, merci. Je joins le plan de l’existant.', now - j, true,
          [{ nom: 'plan-existant.pdf', chemin: '261010090000/client/plan-existant.pdf', taille: 482304 }])]
      }),
      base('261003091422', 'Jean', 'Dupont', 'Extension', 'Hyères', 12, Object.assign(devis('261003091422', 6, 72000, 'Acompte de 40 %'), {
        etape: 'signature', devis_empreinte: '9f2c4e1ab07d3355c1e0a6b6e8d42f1d7a2c9b0e5f4d3c2b1a09f8e7d6c5b4a3',
        questions: [{ id: 2, question: 'Disposez-vous des plans de l’existant ?', choix: null, reponse: 'Oui, en PDF.', commentaire: null, posee_le: iso(now - 10 * j), repondue_le: iso(now - 9 * j) }],
        messages: [recu(2, '261003091422', 'j.dupont.bureau@exemple.com', 'Re: Votre devis est prêt — dossier 261003091422', 'Bonjour, je vous écris depuis mon adresse professionnelle : pouvez-vous me rappeler avant que je signe ? Merci.', now - 3 * h, false)]
      }), 6),
      base('261001150000', 'Lucie', 'Bernard', 'Construction', 'Six-Fours-les-Plages', 13, Object.assign(devis('261001150000', 5, 120000, 'Acompte de 40 %'), signe('Lucie Bernard', 2), { etape: 'paiement' }), 2),
      base('260928100000', 'Antoine', 'Garcia', 'Rénovation', 'La Garde', 16, Object.assign(devis('260928100000', 8, 96000, 'Montant du devis'), signe('Antoine Garcia', 4),
        { etape: 'paiement', retracte_le: iso(now - j), retracte_nom: 'Antoine Garcia', retracte_email: 'antoine.garcia@exemple.fr',
          // accusé de réception de la rétractation non parti (quota d'e-mails dépassé, par exemple) : à renvoyer
          envois_echoues: [{ quoi: 'retractation', sujet: 'Rétractation reçue — dossier 260928100000', le: iso(now - j) }] }), 4),
      base('260925140000', 'Marc', 'Lefèvre', 'Aménagement intérieur', 'La Seyne-sur-Mer', 20, Object.assign(devis('260925140000', 17, 150000, 'Montant du devis'), signe('Marc Lefèvre', 15, true), {
        etape: 'validation', profil: 'Professionnel', societe: 'Atelier Lefèvre', email: 'marc.lefevre@exemple.fr', paye_le: iso(now - 14 * j), paiement_ref: 'virement',
        modifications: [{ id: 1, message: 'Pouvez-vous déplacer la cuisine côté jardin ?', demandee_le: iso(now - j / 2) }],
        messages: [recu(3, '260925140000', 'marc.lefevre@exemple.fr', 'Re: Vos documents sont prêts — dossier 260925140000', 'Pouvez-vous déplacer la cuisine côté jardin ?', now - j / 2, true)]
      }), 3),
      base('260901100000', 'Sophie', 'Martin', 'Extension', 'Toulon', 40, Object.assign(signe('Sophie Martin', 35), { etape: 'clos', paye_le: iso(now - 34 * j), paiement_ref: 'virement', montant_cents: 90000, documents_valides_le: iso(now - 5 * j) }))
    ];
    const docs = {};
    const piecesRangees = (d) => [].concat(...d.messages.filter((m) => m.verifie).map((m) => m.pieces.filter((x) => x.chemin).map((x) => ({ nom: x.nom, chemin: x.chemin, taille: x.taille, date: m.recu_le }))));
    dossiers.forEach((d) => {
      docs[d.id] = {
        agence: d.devis_chemin ? [{ nom: d.devis_chemin.split('/').pop(), chemin: d.devis_chemin, taille: 184320, date: d.devis_envoye_le || d.cree_le }] : [],
        client: piecesRangees(d).concat([{ nom: '01-photos.jpg', chemin: 'demo', taille: 2411520, date: d.cree_le }])
      };
    });
    let session = { user: { id: 'admin', email: 'contact@atomes.studio' } }, ecouteur = null;
    const trouver = (id) => dossiers.find((d) => d.id === id);
    const refus = (message, statut) => { const e = new Error(message); e.statut = statut || 400; return e; };
    const actions = {
      questions: (p, c) => { (c.questions || []).forEach((q) => p.questions.push({ id: Date.now() + Math.random(), question: q.question, choix: q.choix && q.choix.length ? q.choix : null, reponse: null, commentaire: null, posee_le: new Date().toISOString(), repondue_le: null })); return { posees: c.questions.length, mail: true }; },
      // Nouveau devis = nouveau contrat : signature, démarrage anticipé et rétractation remis à zéro
      devis: (p, c) => {
        if (p.paye_le) throw refus('Ce dossier est déjà payé : le devis ne peut plus être remplacé', 409);
        Object.assign(p, { devis_chemin: c.chemin, devis_empreinte: 'demo', devis_envoye_le: new Date().toISOString(), montant_cents: centimes(c.montant), montant_libelle: c.libelle || 'Montant du devis',
          signe_le: null, signe_nom: null, signe_ip: null, demarrage_anticipe_le: null, demarrage_anticipe_texte: null, retracte_le: null, retracte_nom: null, retracte_email: null });
        p.etape = 'signature'; recalculer(p, new Date().toISOString());
        return { etape: 'signature', mail: true, lien: 'https://atomes.studio/action/#t=demo' };
      },
      etape: (p, c) => {
        const e = p.etapes.find((x) => x.cle === c.cle);
        if (e.optionnelle && !p.suivi_administratif) throw new Error('Activez d’abord le suivi administratif');
        const avance = e.ordre > p.etapes.find((x) => x.cle === p.etape).ordre;
        // Même règle que la fonction : rien à valider sans document de l'agence ; aucun e-mail après une rétractation
        if (avance && c.cle === 'validation' && !p.retracte_le && !(docs[p.id].agence || []).some((f) => f.chemin !== p.devis_chemin)) throw refus('Déposez d’abord les documents à valider (documents de l’agence), puis demandez la validation.', 409);
        if (avance && c.cle === 'validation') p.documents_valides_le = null;
        p.etape = c.cle; recalculer(p, new Date().toISOString());
        const mail = avance && ETAPES_MAIL.includes(c.cle);
        return mail && p.retracte_le ? { mail: false, retracte: true } : { mail };
      },
      option: (p, c) => {
        const e = p.etapes.find((x) => x.cle === p.etape);
        if (!c.suivi && e.optionnelle) throw refus('L’étape « ' + p.etape + ' » fait partie du suivi administratif, qui n’est pas activé pour ce dossier', 409);
        const rouvrir = c.suivi && !p.suivi_administratif && p.etapes.some((x) => x.optionnelle && x.ordre < e.ordre && !x.fait_le);
        p.suivi_administratif = c.suivi;
        if (rouvrir) p.etape = 'depot';
        recalculer(p, new Date().toISOString());
        return { suivi: c.suivi, etape: p.etape };
      },
      // « Virement reçu »
      paye: (p) => {
        if (p.paye_le) return { deja: true };
        if (!p.montant_cents) throw refus('Montant non défini');
        p.paye_le = new Date().toISOString(); p.paiement_ref = 'virement';
        if (p.etape === 'paiement') { p.etape = 'production'; recalculer(p, p.paye_le); }
        return { paye: true, mail: true };
      },
      // « Renvoyer » : e-mail légal non parti, renvoyé ; la mention disparaît
      renvoyer: (p, c) => { p.envois_echoues = (p.envois_echoues || []).filter((x) => x.quoi !== c.quoi); return { renvoye: c.quoi, mail: true }; },
      // Message à vérifier rattaché : traité comme une réponse du client (questions en attente, demande de modification)
      rattacher: (p, c) => {
        const m = p.messages.find((x) => x.id === c.message);
        if (!m) throw refus('Message introuvable', 404);
        if (m.verifie) return { deja: true };
        const t = new Date().toISOString();
        m.verifie = true;
        const attente = p.questions.filter((q) => !q.repondue_le);
        attente.forEach((q) => { q.reponse = String(m.texte || '').slice(0, 5000); q.repondue_le = t; });
        const modification = p.etape === 'validation';
        if (modification) p.modifications.push({ id: Date.now(), message: m.texte, demandee_le: t });
        return { rattache: true, pieces: [], questions: attente.length, modification };
      },
      supprimer_message: (p, c) => {
        const i = p.messages.findIndex((x) => x.id === c.message);
        if (i < 0) return { deja: true };
        if (p.messages[i].verifie) throw refus('Ce message est rattaché au dossier : il ne peut plus être supprimé', 409);
        p.messages.splice(i, 1);
        return { supprime: true };
      }
    };
    return {
      surChangement: (fn) => { ecouteur = fn; setTimeout(() => fn(session), 0); },
      connexion: () => Promise.resolve(),
      deconnexion: () => { session = null; ecouteur(null); return Promise.resolve(); },
      estAdmin: () => Promise.resolve(true),
      dossiers: () => Promise.resolve(JSON.parse(JSON.stringify(dossiers))),
      lister: (id, dossier) => Promise.resolve((docs[id] && docs[id][dossier] || []).slice()),
      lien: () => Promise.resolve('#'),
      deposer: (chemin, fichier, remplacer) => {
        const [id, dossier, nom] = chemin.split('/');
        const liste = docs[id][dossier];
        const i = liste.findIndex((f) => f.nom === nom);
        if (i >= 0 && !remplacer) return Promise.reject(new Error('The resource already exists'));
        if (i >= 0) liste.splice(i, 1);
        liste.unshift({ nom, chemin, taille: fichier.size, date: new Date().toISOString() });
        return Promise.resolve();
      },
      supprimer: (chemin) => {
        const [id, dossier, nom] = chemin.split('/');
        const liste = (docs[id] && docs[id][dossier]) || [];
        const i = liste.findIndex((f) => f.nom === nom);
        if (i >= 0) liste.splice(i, 1);
        return Promise.resolve();
      },
      relire: (id) => Promise.resolve(trouver(id) ? JSON.parse(JSON.stringify(trouver(id))) : null),
      retirerQuestion: (qid) => {
        for (const d of dossiers) {
          const i = d.questions.findIndex((q) => q.id === qid && !q.repondue_le);
          if (i >= 0) { d.questions.splice(i, 1); return Promise.resolve(true); }
        }
        return Promise.resolve(false);
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

  // ---------- Connexion ----------
  $('[data-form-connexion]').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = $('#a-email').value.trim();
    const err = $('#a-err');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err.textContent = 'Adresse email invalide'; err.hidden = false; return; }
    err.hidden = true;
    const btn = $('[data-btn-connexion]');
    btn.disabled = true; btn.textContent = 'Envoi…';
    // Même message qu'un compte existe ou non : la page ne révèle pas quelles adresses ont un compte (clients compris).
    const envoye = () => { $('[data-lien-envoye]').textContent = 'Si un compte est associé à ' + email + ', un lien de connexion vient de lui être envoyé. Ouvrez l’e-mail et cliquez sur le lien.'; };
    api.connexion(email).then(envoye).catch((ex) => {
      const msg = String((ex && ex.message) || '');
      if (/signup|not allowed|user not found/i.test(msg)) { envoye(); return; }
      err.textContent = /rate limit|too many/i.test(msg) ? 'Trop de demandes de lien : patientez quelques minutes.' : 'Impossible d’envoyer le lien pour le moment.';
      err.hidden = false;
    }).finally(() => { btn.disabled = false; btn.textContent = 'Recevoir mon lien de connexion'; });
  });
  $('[data-deconnexion]').addEventListener('click', () => {
    api.deconnexion().then(() => { history.replaceState(null, '', location.pathname + location.search); });
  });

  // ---------- État ----------
  let dossiers = [];
  let courant = null;
  let filtre = 'encours';
  let charge = null;        // compte connecté
  let autorise = false;     // compte inscrit dans la table admins

  const etapeDe = (d) => (d.etapes || []).find((e) => e.cle === d.etape) || {};
  const visibles = (d) => (d.etapes || []).filter((e) => !e.optionnelle || d.suivi_administratif).sort((a, b) => a.ordre - b.ordre);
  const enAttente = (d) => (d.questions || []).filter((q) => !q.repondue_le);
  const aVerifier = (d) => (d.messages || []).filter((m) => !m.verifie);
  // Message vérifié dont le traitement s'est interrompu (pièces jointes, réponse) : plus aucun traitement en cours
  // depuis 10 minutes (bail de la fonction) ; l'agence le reprend (« Reprendre le traitement »).
  const BAIL = 10 * 60000;
  // Message lu par le moteur de l'agence (e-mails reçus sur contact@ et simon@, identifiant « imap:… ») : vérifié et
  // pas encore traité (rattaché par l'agence, ou traitement interrompu), le moteur le termine à son passage suivant.
  const duMoteur = (m) => String(m.resend_id || '').startsWith('imap:');
  const enAttenteMoteur = (m) => !!m.verifie && m.traite === false && duMoteur(m);
  const incomplet = (m) => !duMoteur(m) && !!m.verifie && m.traite === false && (!m.traitement_le || Date.now() - new Date(m.traitement_le).getTime() > BAIL);
  const incomplets = (d) => (d.messages || []).filter(incomplet);
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
  const derniereModif = (d) => (d.modifications || []).slice().sort((a, b) => new Date(b.demandee_le) - new Date(a.demandee_le))[0];
  // Demande de modification reçue depuis le début de l'étape en cours. Marge pour la production : avec le parcours v2,
  // la demande précédait de peu le retour à la production qu'elle déclenchait.
  const modifRecente = (d, marge) => { const e = etapeDe(d), m = derniereModif(d); return !!(m && e.debut_le && new Date(m.demandee_le) >= new Date(e.debut_le) - (marge || 0)); };
  // Qui a la main : [libellé, 'agence' | 'client' | 'clos']. Une rétractation (dossier en cours, ou reçue après la
  // clôture), un e-mail légal à renvoyer, puis un message à vérifier ou incomplet passent avant tout (même un dossier
  // clos peut recevoir un message). Une question sans réponse ne met le dossier « côté client » qu'à l'étape
  // « traitement » ; ailleurs, c'est l'étape qui décide (le nombre est affiché dans la liste).
  const situation = (d) => {
    const clos = d.etape === 'clos';
    if (retractationATraiter(d)) return ['Rétractation reçue', 'agence'];
    if (aRenvoyer(d).length) return ['E-mail à renvoyer', 'agence'];
    const v = aVerifier(d).length;
    if (v) return [v > 1 ? v + ' messages à vérifier' : 'Message à vérifier', 'agence'];
    if (incomplets(d).length) return ['Message incomplet', 'agence'];
    if (clos) return ['Clos', 'clos'];
    const n = enAttente(d).length;
    if (n && d.etape === 'traitement') return [n > 1 ? n + ' questions en attente' : 'Question en attente', 'client'];
    return parEtape(d);
  };
  const parEtape = (d) => {
    const e = etapeDe(d);
    switch (d.etape) {
      case 'traitement': return [(d.questions || []).length ? 'Réponses reçues' : 'Nouvelle demande', 'agence'];
      case 'devis': return ['Devis à produire', 'agence'];
      case 'signature': return d.signe_le ? ['Devis signé', 'agence'] : ['Signature attendue', 'client'];
      case 'paiement': return d.paye_le ? ['Payé', 'agence'] : d.montant_cents ? ['Virement attendu', 'client'] : ['Montant à définir', 'agence'];
      case 'production': return modifRecente(d, 60000) ? ['Modification demandée', 'agence'] : ['Documents à produire', 'agence'];
      case 'validation': return modifRecente(d) ? ['Modification demandée', 'agence'] : ['Validation attendue', 'client'];
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
  const actualiser = () => api.dossiers().then((liste) => {
    if (!charge || !autorise) return;
    dossiers = liste || [];
    const d = dossiers.find((x) => x.id === location.hash.replace('#', ''));
    if (d && (!courant || courant.id === d.id)) ouvrir(d, true);
    else if (!courant && !vues.liste.hidden) rendreListe();
  }).catch(() => { if (charge && autorise) erreur('Les dossiers n’ont pas pu être actualisés : rechargez la page.'); });

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

  const rendreListe = () => {
    courant = null;
    $$('[data-filtre]').forEach((b) => { const on = b.dataset.filtre === filtre; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    const terme = $('#a-recherche').value.trim().toLowerCase();
    const liste = dossiers.filter(FILTRES[filtre]).filter((d) => !terme || [d.id, d.prenom, d.nom, d.societe, d.commune, d.email, d.type].filter(Boolean).join(' ').toLowerCase().includes(terme));
    const cont = $('[data-liste]');
    cont.textContent = '';
    $('[data-compte-liste]').textContent = liste.length + ' dossier' + (liste.length > 1 ? 's' : '');
    if (!liste.length) cont.appendChild(el('p', 'docs-vide', 'Aucun dossier.'));
    liste.forEach((d) => {
      const a = el('a', 'admin-ligne'); a.href = '#' + d.id;
      const c1 = el('div');
      c1.appendChild(el('span', 'num', 'N° ' + d.id + ' · ' + fmtCourt(d.cree_le)));
      c1.appendChild(el('strong', '', (d.prenom + ' ' + d.nom).trim() + (d.societe ? ' · ' + d.societe : '')));
      a.appendChild(c1);
      a.appendChild(el('span', 'admin-type', d.type + ' · ' + d.commune));
      const vis = visibles(d), e = etapeDe(d);
      const sansReponse = d.etape === 'traitement' || d.etape === 'clos' ? 0 : enAttente(d).length;
      a.appendChild(el('span', 'admin-etape', String(vis.indexOf(vis.find((x) => x.cle === d.etape)) + 1).padStart(2, '0') + '/' + String(vis.length).padStart(2, '0') + ' · ' + (e.libelle || '')
        + (sansReponse ? ' · ' + sansReponse + (sansReponse > 1 ? ' questions sans réponse' : ' question sans réponse') : '')));
      const [texte, qui] = situation(d);
      a.appendChild(el('span', 'badge badge--' + qui, texte));
      cont.appendChild(a);
    });
    montrer('liste');
  };

  $('[data-retour]').addEventListener('click', (e) => {
    e.preventDefault();
    history.pushState(null, '', location.pathname + location.search);
    rendreListe();
    actualiser();
  });
  window.addEventListener('hashchange', () => {
    if (!charge || !autorise) return;
    const d = dossiers.find((x) => x.id === location.hash.replace('#', ''));
    if (d) ouvrir(d); else rendreListe();
    actualiser();
  });

  // ---------- Boutons occupés ----------
  // Les boutons fixes de la fiche servent à tous les dossiers : une opération en cours est notée « sélecteur|dossier ».
  // Le bouton n'affiche « Envoi… » que sur la fiche du dossier concerné, et retrouve son libellé une fois l'opération
  // finie, même si l'agence est passée par une autre fiche ou par la liste entre-temps.
  const FIXES = ['[data-btn-questions]', '[data-btn-devis]', '[data-btn-paye]', '[data-btn-pret]'];
  const enVol = new Set();
  // Dossiers dont l'étape est en train de changer (« Passer ici », « Documents prêts », « Virement reçu ») → bouton à
  // l'origine de l'opération : les autres boutons d'étape du dossier restent indisponibles jusqu'à la fin (une seule
  // demande, un seul e-mail au client).
  const etapesEnVol = new Map();
  const cleVol = (btn, pid) => { const s = btn ? FIXES.find((x) => $(x) === btn) : null; return s ? s + '|' + pid : null; };
  const etatBoutons = (d) => FIXES.forEach((s) => {
    const b = $(s);
    const pris = enVol.has(s + '|' + d.id);
    if (b.dataset.texteOrigine) b.textContent = pris ? 'Envoi…' : b.dataset.texteOrigine;
    const etape = (s === '[data-btn-pret]' || s === '[data-btn-paye]') && etapesEnVol.has(d.id) && etapesEnVol.get(d.id) !== s;
    // « Documents prêts » : rien à valider tant qu'aucun document de l'agence (hors devis) n'est déposé
    const vide = s === '[data-btn-pret]' && sansDocuments(d);
    b.disabled = pris || etape || vide || (s === '[data-btn-devis]' && !!d.paye_le);
    if (s === '[data-btn-pret]') b.title = vide ? 'Déposez d’abord les documents à valider' : '';
  });
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
    if (courant && courant.id === pid) { btn.disabled = true; btn.textContent = 'Envoi…'; }
  };
  const rendre = (btn, pid) => {
    if (!btn) return;
    const k = cleVol(btn, pid);
    if (k) { enVol.delete(k); if (courant && courant.id === pid) etatBoutons(courant); return; }
    if (courant && courant.id === pid) { btn.disabled = false; btn.textContent = btn.dataset.texteOrigine; }   // bouton d'une ligne (étape…)
  };

  // ---------- Fiche d'un dossier ----------
  let dernierOuvert = null;
  const ouvrir = (d, garderMessage) => {
    courant = d;
    if (!garderMessage) annoncer('');
    if (dernierOuvert !== d.id) {
      // Autre dossier : les questions en cours de rédaction et les messages du précédent ne doivent pas le suivre.
      dernierOuvert = d.id;
      $('[data-nouvelles]').textContent = '';
      ['[data-err-questions]', '[data-depot-err]', '[data-err-devis]'].forEach((sel) => { $(sel).hidden = true; });
      $('[data-depot-info]').textContent = 'Visibles par le client dans son espace';
      $('[data-suivi]').disabled = false;
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
    rendreMessages(d);
    rendreQuestions(d);
    rendreDevis(d);
    rendreModifs(d);
    rendreRecap(d);
    // « Documents prêts » : à l'étape production, jamais après une rétractation (mission arrêtée)
    $('[data-pret]').hidden = d.etape !== 'production' || !!d.retracte_le;
    etatBoutons(d);
    montrer('dossier');
    rafraichirDocs();
  };

  // Action envoyée à la fonction pour le dossier `id` (par défaut celui affiché au moment de l'appel). Succès : message
  // annoncé dès la réponse, `apres(j)` exécuté (brouillons à vider), dossier relu ; le bouton reste occupé jusqu'à la fin
  // de la relecture, et une relecture ratée n'est pas présentée comme un échec. Échec : message sous le bloc (ou en tête)
  // et focus rendu au bouton ; si une autre fiche est ouverte entre-temps, message en tête avec le numéro du dossier.
  // (libellé d'origine du bouton mémorisé dans data-texte-origine)
  const agir = (btn, err, nom, corps, merci, apres, id) => {
    const pid = id || courant.id;
    const meme = () => !!courant && courant.id === pid;
    occuper(btn, pid);
    if (err && meme()) err.hidden = true;
    return api.action(nom, pid, corps).then((j) => {
      const m = typeof merci === 'function' ? merci(j) : merci;
      if (apres) apres(j);
      if (meme()) annoncer(m);
      return recharger(null, pid)
        .catch(() => { if (meme()) annoncer(m + ' Actualisez la page pour voir le dossier à jour.'); })
        .then(() => { rendre(btn, pid); return j; });
    }, (ex) => {
      rendre(btn, pid);
      const msg = (ex && ex.message) || ECHEC;
      if (meme()) {
        if (err) { err.textContent = msg; err.hidden = false; } else annoncer(msg);
        if (btn && btn.isConnected && !btn.disabled) btn.focus();
      } else erreur('Dossier N° ' + pid + ' : ' + msg);
      throw ex;
    });
  };

  // Bandeau en tête de fiche : rétractation (dossier en cours, ou reçue après la clôture), e-mails légaux à renvoyer
  // (bouton « Renvoyer »), messages à vérifier ou dont le traitement s'est interrompu
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
    if (v) z.appendChild(el('div', '', (v > 1 ? v + ' messages du client sont à vérifier' : 'Un message du client est à vérifier') + ' : voir « Messages du client ».'));
    if (incomplets(d).length) z.appendChild(el('div', '', 'Le traitement d’un message du client s’est interrompu (pièces jointes ou réponse peut-être incomplètes) : voir « Messages du client ».'));
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

  $('[data-form-note]').addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (!courant) return;
    const id = courant.id;
    const meme = () => !!courant && courant.id === id;
    const btn = $('[data-btn-note]');
    const m = 'Note enregistrée : le client la voit sous l’étape en cours.';
    btn.disabled = true;
    api.note(id, courant.etape, $('[data-note]').value.trim()).then(() => {
      if (meme()) annoncer(m);
      return recharger(null, id).catch(() => { if (meme()) annoncer(m + ' Actualisez la page pour voir le dossier à jour.'); });
    }, () => { if (meme()) annoncer('La note n’a pas pu être enregistrée.'); else erreur('Dossier N° ' + id + ' : la note n’a pas pu être enregistrée.'); })
      .finally(() => { btn.disabled = false; });
  });

  // ---------- Messages du client ----------
  // E-mails du client, ajoutés au dossier par le moteur de l'agence (reçus sur contact@ et simon@) ou, pour les
  // réponses aux anciennes adresses de réponse des dossiers, par la fonction « espace ». Un message « à vérifier » vient
  // d'une autre adresse que celle du dossier ou n'a pas passé l'authentification : rattaché, il est traité comme une
  // réponse du client (visible dans son espace, pièces rangées, questions en attente répondues, demande de modification
  // à l'étape « validation ») ; sinon il est supprimé.
  const enCours = new Map();   // message → action en cours : ses boutons restent occupés même si la liste est redessinée
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

  const rendreMessages = (d) => {
    const ul = $('[data-messages]');
    ul.textContent = '';
    const liste = (d.messages || []).slice().sort((a, b) => new Date(b.recu_le) - new Date(a.recu_le));
    $('[data-messages-vide]').hidden = liste.length > 0;
    liste.forEach((m) => {
      const li = el('li');
      const de = m.expediteur || 'expéditeur inconnu', quand = fmtHeure(m.recu_le);
      if (!m.verifie) li.appendChild(el('span', 'badge badge--verifier', 'À vérifier'));
      if (incomplet(m)) li.appendChild(el('span', 'badge badge--verifier', 'Traitement incomplet'));
      if (enAttenteMoteur(m)) li.appendChild(el('span', 'badge badge--verifier', 'En attente du moteur'));
      li.appendChild(el('span', 'doc-meta', 'Reçu le ' + quand + ' · ' + de));
      if (!m.verifie) li.appendChild(el('span', 'doc-meta', pourquoi(d, m)));
      if (incomplet(m)) li.appendChild(el('span', 'doc-meta', 'Le traitement de ce message s’est interrompu : pièces jointes peut-être non rangées, réponse peut-être non enregistrée.'));
      if (enAttenteMoteur(m)) li.appendChild(el('span', 'doc-meta', 'Le moteur de l’agence range ses pièces jointes et enregistre la réponse à son prochain passage (toutes les 5 minutes, ordinateur de l’agence allumé).'));
      if (m.sujet) li.appendChild(el('p', 'echange-q', m.sujet));
      const texte = String(m.texte || '').trim(), complet = String(m.texte_complet || '').trim();
      li.appendChild(el('p', 'echange-r', texte || complet || 'Message sans texte'));
      if (texte && complet && complet !== texte) {
        const det = el('details');
        det.appendChild(el('summary', 'link-more', 'Message complet'));
        det.appendChild(el('p', 'echange-r', complet));
        li.appendChild(det);
      }
      // Pièces jointes : téléchargeables une fois rangées dans <id>/client/ (message vérifié ou rattaché)
      const pieces = (Array.isArray(m.pieces) ? m.pieces : []).filter((x) => x && x.nom);
      if (pieces.length) {
        const ulp = el('ul', 'pieces'); ulp.setAttribute('role', 'list'); ulp.setAttribute('aria-label', 'Pièces jointes');
        pieces.forEach((pc) => {
          const rangee = typeof pc.chemin === 'string' && pc.chemin.startsWith(d.id + '/client/') && !pc.chemin.includes('..');
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
        li.appendChild(ulp);
      }
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
          const effets = ['visible dans son espace', 'pièces jointes éventuelles rangées avec ses pièces'];
          const n = enAttente(d).length;
          if (n) effets.push(n > 1 ? 'réponse aux ' + n + ' questions en attente' : 'réponse à la question en attente');
          if (d.etape === 'validation') effets.push('demande de modification des documents');
          if (!window.confirm('Rattacher au dossier N° ' + d.id + ' ce message de ' + de + ' ?\nIl sera traité comme une réponse du client : ' + effets.join(', ') + '. Le client ne reçoit pas d’e-mail.')) return;
          actionMessage(d, m, 'rattacher', bilanRattachement, ratt, suppr, err);
        });
        zone.appendChild(suppr); zone.appendChild(ratt);
        li.appendChild(zone); li.appendChild(err);
      } else if (incomplet(m)) {
        // Reprise du traitement (même action que le rattachement) : pièces manquantes rangées, réponse enregistrée.
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
      ul.appendChild(li);
    });
  };

  // Bilan renvoyé par la fonction après un rattachement : pièces rangées, pièces non rangées (non_rangees : format ou
  // taille refusés, avec la raison), questions répondues, demande de modification. Champs facultatifs : une valeur
  // absente ou d'un autre format est ignorée.
  const bilanRattachement = (j) => {
    if (j.deja) return 'Ce message était déjà rattaché au dossier.';
    // Message du moteur : rattaché tout de suite, pièces rangées par le moteur à son passage suivant.
    if (j.moteur === true) {
      return j.reprise === true ? 'Le moteur de l’agence termine le traitement de ce message à son prochain passage.'
        : 'Message rattaché au dossier : le moteur de l’agence range ses pièces jointes et enregistre la réponse à son prochain passage (toutes les 5 minutes, ordinateur de l’agence allumé).';
    }
    const nb = (v) => (Array.isArray(v) ? v.length : Number.isInteger(v) ? v : 0);
    const p = nb(j.pieces), q = nb(j.questions), faits = [];
    if (p) faits.push(p > 1 ? p + ' pièces jointes rangées' : '1 pièce jointe rangée');
    if (q) faits.push(q > 1 ? q + ' questions marquées comme répondues' : '1 question marquée comme répondue');
    if (j.modification === true) faits.push('demande de modification enregistrée');
    const nonRangees = (Array.isArray(j.non_rangees) ? j.non_rangees : []).filter((x) => typeof x === 'string' && x);
    return (j.reprise === true ? 'Traitement du message terminé' : 'Message rattaché au dossier') + (faits.length ? ' : ' + faits.join(', ') : '') + '.'
      + (nonRangees.length ? ' Non rangées : ' + nonRangees.join(', ') + '.' : '')
      + (j.pieces_indisponibles === true ? ' Ses pièces jointes ne sont plus disponibles : demandez-les au client.' : '');
  };

  // Rattacher ou supprimer un message : attaché au dossier et au message du clic ; ses deux boutons restent occupés
  // jusqu'à la fin, même si la liste est redessinée entre-temps (actualisation, retour sur la fiche).
  const actionMessage = (d, m, nom, merci, btn, autre, err) => {
    const pid = d.id;
    enCours.set(m.id, nom);
    autre.disabled = true;
    agir(btn, err, nom, { message: m.id }, merci, () => { enCours.delete(m.id); }, pid)
      .then(() => { if (btn.isConnected) autre.disabled = false; })   // relecture ratée : liste non redessinée
      .catch((ex) => {
        enCours.delete(m.id);
        if (!courant || courant.id !== pid) return;   // échec signalé en tête, avec le numéro du dossier
        if (btn.isConnected) { autre.disabled = false; return; }
        rendreMessages(courant);                     // liste redessinée pendant l'envoi : boutons rétablis
        annoncer((ex && ex.message) || ECHEC);
      });
  };

  // ---------- Questions ----------
  const rendreQuestions = (d) => {
    const ul = $('[data-questions]');
    ul.textContent = '';
    const liste = (d.questions || []).slice().sort((a, b) => new Date(b.posee_le) - new Date(a.posee_le));
    $('[data-questions-vide]').hidden = liste.length > 0;
    liste.forEach((q) => {
      const li = el('li');
      li.appendChild(el('span', 'doc-meta', 'Posée le ' + fmtCourt(q.posee_le) + (q.repondue_le ? ' · répondue le ' + fmtCourt(q.repondue_le) : ' · en attente de réponse')));
      li.appendChild(el('p', 'echange-q', q.question));
      if (q.choix && q.choix.length) li.appendChild(el('span', 'doc-meta', 'Propositions : ' + q.choix.join(' · ')));
      li.appendChild(el('p', 'echange-r', q.repondue_le ? q.reponse + (q.commentaire ? '\n' + q.commentaire : '') : 'En attente de réponse'));
      if (!q.repondue_le) {
        const zone = el('div', 'form-actions');
        const b = el('button', 'btn btn--ghost', 'Retirer la question'); b.type = 'button';
        b.addEventListener('click', () => {
          if (!window.confirm('Retirer cette question ? Elle n’apparaîtra plus dans l’espace du client (l’e-mail déjà envoyé ne change pas).')) return;
          const id = d.id;
          b.disabled = true;
          api.retirerQuestion(q.id)
            .then((retiree) => recharger(retiree ? 'Question retirée.' : 'Le client vient de répondre à cette question : elle est conservée.', id))
            .catch(() => { b.disabled = false; if (courant && courant.id === id) annoncer('La question n’a pas pu être retirée.'); });
        });
        zone.appendChild(b);
        li.appendChild(zone);
      }
      ul.appendChild(li);
    });
    const zone = $('[data-nouvelles]');
    if (!zone.childNodes.length) ajouterQuestion();
  };

  let nq = 0;
  const ajouterQuestion = () => {
    const zone = $('[data-nouvelles]');
    const i = ++nq;
    const bloc = el('div', 'admin-question');
    const f1 = el('div', 'field');
    const l1 = el('label', 'lbl', 'Question'); l1.htmlFor = 'nq-' + i;
    const t1 = el('textarea', 'input'); t1.id = 'nq-' + i; t1.rows = 2; t1.maxLength = 2000; t1.dataset.q = '';
    f1.appendChild(l1); f1.appendChild(t1);
    const f2 = el('div', 'field');
    const l2 = el('label', 'lbl', 'Réponses proposées '); l2.htmlFor = 'nc-' + i; l2.appendChild(el('span', 'lbl-opt', '(une par ligne, facultatif : citées en exemple dans l’e-mail)'));
    const t2 = el('textarea', 'input'); t2.id = 'nc-' + i; t2.rows = 2; t2.dataset.c = ''; t2.placeholder = 'Je m’en occupe\nVous vous en chargez (supplément)';
    f2.appendChild(l2); f2.appendChild(t2);
    bloc.appendChild(f1); bloc.appendChild(f2);
    if (zone.childNodes.length) {
      const suppr = el('button', 'link-more', 'Retirer cette question'); suppr.type = 'button';
      suppr.addEventListener('click', () => { bloc.remove(); });
      bloc.appendChild(suppr);
    }
    zone.appendChild(bloc);
    return t1;
  };
  $('[data-ajouter-question]').addEventListener('click', () => ajouterQuestion().focus());

  $('[data-form-questions]').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const err = $('[data-err-questions]');
    const questions = $$('.admin-question', $('[data-nouvelles]')).map((b) => ({
      question: $('[data-q]', b).value.trim(),
      choix: $('[data-c]', b).value.split('\n').map((x) => x.trim()).filter(Boolean)
    })).filter((q) => q.question.length >= 2);
    if (!questions.length) { err.textContent = 'Saisissez au moins une question.'; err.hidden = false; return; }
    if (questions.some((q) => q.choix.length === 1)) { err.textContent = 'Proposez au moins deux réponses, ou aucune pour une réponse libre.'; err.hidden = false; return; }
    const idq = courant.id;
    const envoyees = questions.length > 1 ? questions.length + ' questions envoyées' : 'Question envoyée';
    agir($('[data-btn-questions]'), err, 'questions', { questions }, (j) => (j.mail === false
      ? (questions.length > 1 ? 'Questions enregistrées' : 'Question enregistrée') + ', mais l’e-mail au client n’est pas parti : réessayez plus tard ou écrivez-lui directement.'
      : envoyees + ' : le client a reçu un e-mail.'),
    () => { if (courant && courant.id === idq) { $('[data-nouvelles]').textContent = ''; ajouterQuestion(); } }, idq).catch(() => {});
  });

  // ---------- Devis, signature, démarrage anticipé, rétractation, virement ----------
  const REF_PAIEMENT = { virement: ' par virement', manuel: ' (hors du site)' };
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
    if (f.size > 50 * 1024 * 1024) return dire('Fichier trop lourd (50 Mo max).');
    if (!centimes(montant)) return dire('Montant invalide : par exemple 720 ou 720,50.');
    const id = courant.id;
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
    const d = courant, id = d.id;
    const meme = () => !!courant && courant.id === id;
    const btn = $('[data-btn-paye]'), err = $('[data-err-devis]');
    const attention = sansDemarrageAnticipe(d)
      ? '\n\nAttention : ce client particulier a signé le ' + fmtDate(d.signe_le) + ' sans demander que la mission commence avant la fin du délai de rétractation (devis signé avant le parcours actuel). Ne commencez pas la mission avant la fin de ce délai (14 jours après la signature), ou renvoyez-lui le devis pour qu’il le signe avec la case.'
      : '';
    if (!window.confirm('Virement reçu pour le dossier N° ' + id + ' ?\n' + (d.montant_libelle || 'Montant du devis') + ' : ' + euros(d.montant_cents) + ', référence ' + id + '.\n'
      + 'Le client recevra un e-mail « Paiement reçu » et le dossier passera à la production de ses documents.' + attention)) return;
    occuper(btn, id); err.hidden = true;
    const dire = (m) => { if (meme()) { err.textContent = m; err.hidden = false; } else erreur('Dossier N° ' + id + ' : ' + m); };
    changementEtape(id, '[data-btn-paye]', () => api.relire(id).then((frais) => {
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
    const id = courant.id;   // tous les fichiers vont dans ce dossier, même si une autre fiche est ouverte pendant l'envoi
    const meme = () => !!courant && courant.id === id;
    const err = $('[data-depot-err]'), info = $('[data-depot-info]');
    const lourds = fichiers.filter((f) => f.size > 50 * 1024 * 1024);
    if (lourds.length) { err.textContent = 'Fichier trop lourd (50 Mo max) : ' + lourds.map((f) => f.name).join(', '); err.hidden = false; return; }
    err.hidden = true; info.textContent = 'Envoi en cours…';
    const ko = [];
    fichiers.reduce((p, f) => p.then(() => api.deposer(id + '/agence/' + nomSur(f.name), f, false).catch((ex) => { ko.push(f.name + (/exists|duplicate/i.test(String(ex && ex.message)) ? ' (un fichier du même nom existe déjà)' : '')); })), Promise.resolve())
      .then(() => {
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

  // ---------- Modifications, demande ----------
  const rendreModifs = (d) => {
    const ul = $('[data-modifs]');
    ul.textContent = '';
    const liste = (d.modifications || []).slice().sort((a, b) => new Date(b.demandee_le) - new Date(a.demandee_le));
    $('[data-bloc-modifs]').hidden = !liste.length;
    // Une demande reçue par e-mail à l'étape « validation » laisse le dossier à cette étape
    $('[data-modifs-aide]').hidden = !(d.etape === 'validation' && modifRecente(d));
    liste.forEach((m) => {
      const li = el('li');
      li.appendChild(el('span', 'doc-meta', 'Demandée le ' + fmtHeure(m.demandee_le)));
      li.appendChild(el('p', 'echange-r', m.message));
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
      ['Surfaces', SURFACES.filter((sf) => m2(d[sf[0]])).map((sf) => sf[1] + ' : ' + m2(d[sf[0]])).join('\n')],
      ['Démarrage souhaité', aff(d.calendrier, 'calendrier')], ['Message', d.message], ['Source', aff(d.source, 'source')]
    ].filter((r) => r[1]).forEach((r) => { dl.appendChild(el('dt', '', r[0])); dl.appendChild(el('dd', '', r[1])); });
  };

  // ---------- Session ----------
  // Déconnexion (ici ou dans un autre onglet) : plus aucune donnée client en mémoire ni dans la page
  const oublier = () => {
    dossiers = []; courant = null; dernierOuvert = null;
    enVol.clear(); enCours.clear(); etapesEnVol.clear();
    Object.keys(docsAgence).forEach((k) => { delete docsAgence[k]; });
    ['[data-liste]', '[data-compte-liste]', '[data-d-num]', '[data-d-titre]', '[data-d-sous]', '[data-d-liens]', '[data-alertes]', '[data-etapes]', '[data-messages]', '[data-questions]', '[data-nouvelles]',
      '[data-devis-etat]', '[data-docs-agence]', '[data-docs-client]', '[data-modifs]', '[data-recap]'].forEach((sel) => { const n = $(sel); if (n) n.textContent = ''; });
    ['#a-recherche', '[data-note]', '[data-montant]', '[data-libelle]', '[data-devis-fichier]'].forEach((sel) => { const n = $(sel); if (n) n.value = ''; });
    $('[data-alertes]').hidden = true;
    annoncer(''); erreur('');
  };
  api.surChangement((session, evt) => {
    if (evt === 'TOKEN_REFRESHED' || evt === 'USER_UPDATED') return;
    if (session && session.user) {
      $('[data-compte]').hidden = false;
      $('[data-compte-email]').textContent = session.user.email || '';
      if (charge === session.user.id) return;
      const uid = session.user.id;
      charge = uid; autorise = false;
      api.estAdmin(uid).then((admin) => { if (charge !== uid) return; autorise = admin; if (admin) charger(); else montrer('refus'); })
        .catch(() => { if (charge !== uid) return; montrer('refus'); erreur('Vérification du compte impossible pour le moment.'); });
    } else {
      charge = null; autorise = false;
      oublier();
      $('[data-compte]').hidden = true;
      montrer('connexion');
    }
  });
})();
