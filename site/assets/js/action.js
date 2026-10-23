// Page d'action (parcours v3) : ouverte depuis un lien reçu par e-mail, https://atomes.studio/action/#t=<jeton>.
// Trois modes, fixés par le jeton : signer (devis), valider (documents), renoncer (rétractation d'un particulier, pour
// les anciens liens seulement : la fonction n'en crée plus ; le lien « Renoncer au contrat ici » du pied de page mène
// au formulaire public, renoncer/).
// Le jeton est lu dans le fragment de l'adresse (jamais envoyé au serveur de pages ni dans le Referer), effacé aussitôt
// de la barre d'adresse et gardé en mémoire ; il n'est jamais journalisé. Au chargement, seule la lecture « infos » est
// faite : signer, valider et renoncer exigent un clic. Appels : fonction « espace » (config.js : espaceUrl), POST JSON
// avec l'en-tête apikey, sans session ni supabase-js. Textes juridiques (case, phrase des conditions générales au-dessus
// du bouton, bouton) : ceux renvoyés par la fonction, source unique (la phrase et le bouton ont ici une copie de
// secours). L'information sur la rétractation et le formulaire type figurent dans les conditions générales, à la fin
// du devis (décision de Simon du 21 octobre 2026).
// Mode démo sans backend : action/?demo=signer (particulier), ?demo=signer-pro, ?demo=valider, ?demo=renoncer.
(() => {
  const cfg = window.ATOMES_CONFIG || {};
  const params = new URLSearchParams(location.search);
  const demo = params.has('demo');
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const el = (tag, cls, texte) => { const n = document.createElement(tag); if (cls) n.className = cls; if (texte !== undefined) n.textContent = texte; return n; };

  // Dates à l'heure de Paris (comme les e-mails et le délai de rétractation) ; « 1er » comme dans les e-mails (règle
  // premier() de la fonction « espace ») : « jeudi 1er octobre 2026 ».
  const premier = (s) => s.replace(/(^|\s)1(\s)/, '$11er$2');
  const fmt = (o) => new Intl.DateTimeFormat('fr-FR', Object.assign({ timeZone: 'Europe/Paris' }, o));
  const dateValide = (iso) => !!iso && !isNaN(new Date(iso).getTime());
  const fmtDate = (iso) => (dateValide(iso) ? premier(fmt({ day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso))) : '');
  const fmtCourt = (iso) => (dateValide(iso) ? premier(fmt({ day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso))) : '');
  const fmtHeure = (iso) => (dateValide(iso) ? premier(fmt({ dateStyle: 'long', timeStyle: 'short' }).format(new Date(iso))) : '');
  // Date limite « AAAA-MM-JJ » (dernier jour du délai, heure de Paris) : « mercredi 28 octobre 2026 ».
  const fmtLimite = (jour) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(jour || ''));
    return m ? premier(fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)))) : '';
  };
  const fmtTaille = (o) => (o >= 1048576 ? (o / 1048576).toFixed(1).replace('.', ',') + ' Mo' : Math.max(1, Math.round((o || 0) / 1024)) + ' Ko');
  const euros = (c) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format((c || 0) / 100);
  // Adresse renvoyée par la fonction (lien signé d'un document) : http(s) seulement.
  const urlSure = (u) => {
    if (!u) return '';
    try { const x = new URL(String(u), location.href); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch (ex) { return ''; }
  };

  const ECHEC = 'Action impossible pour le moment. Réessayez dans quelques minutes ou écrivez-nous à contact@atomes.studio.';
  const RESEAU = 'Connexion impossible : vérifiez votre accès à Internet, puis réessayez.';
  const MSG_CASE = 'Cochez la case de démarrage de la mission pour signer.';
  const MSG_NOM = 'Saisissez votre nom et votre prénom.';
  const MSG_EMAIL = 'Adresse email invalide';
  // Une seule adresse : ni virgule, ni point-virgule, ni chevrons, ni guillemets (même règle que la fonction).
  const EMAIL = /^[^@\s,;<>"'()]+@[^@\s,;<>"'()]+\.[^@\s,;<>"'()]+$/;
  // E-mail légal non parti (réponse mail: false de la fonction) : ce que la page dit à la place de « envoyé ».
  const ACCUSE_ENVOYE = 'Un accusé de réception vous a été envoyé par e-mail.';
  const ACCUSE_NON_ENVOYE = 'L’accusé de réception n’a pas pu vous être envoyé par e-mail pour le moment : conservez cette page (imprimez-la ou enregistrez-la). Nous vous l’adresserons dans les meilleurs délais.';
  const LIEN_INVALIDE = 'Ce lien n’est pas valide : ouvrez-le de nouveau depuis l’e-mail reçu, en entier.';
  const BOUTON_SIGNER = 'Signer et commander avec obligation de paiement';   // § 7 ; textes.bouton de la fonction prévaut
  const CGV = 'En signant, vous acceptez nos conditions générales, jointes au devis.';   // textes.cgv de la fonction prévaut
  const TITRES = { signer: 'Signature du devis', valider: 'Vos documents', renoncer: 'Renoncer au contrat' };
  const ETIQUETTES = { signer: 'Votre devis', valider: 'Documents à valider', renoncer: 'Votre rétractation' };
  const URL_ESPACE = cfg.espaceUrl || (cfg.supabaseUrl ? String(cfg.supabaseUrl).replace(/\/$/, '') + '/functions/v1/espace' : '');

  const vues = {};
  $$('[data-vue]').forEach((v) => { vues[v.dataset.vue] = v; });
  const montrer = (nom) => { Object.keys(vues).forEach((k) => { vues[k].hidden = k !== nom; }); };

  // ---------- Jeton : fragment #t=…, retiré de la barre d'adresse, gardé en mémoire ----------
  let jeton = '';
  const lireJeton = () => {
    const h = location.hash.replace(/^#/, '');
    if (!/(^|&)t=/.test(h)) return null;   // pas de jeton dans le fragment
    const t = (new URLSearchParams(h).get('t') || '').trim();
    history.replaceState(history.state, '', location.pathname + location.search);
    return t;
  };
  const jetonValide = (t) => t.length < 4096 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(t);

  // ---------- Appels à la fonction « espace » (ou démo) ----------
  let demoApi = null;
  const appeler = (action, corps) => {
    const envoi = Object.assign({ action, jeton }, corps || {});
    if (demo) return demoApi(envoi);
    const entetes = { 'Content-Type': 'application/json' };
    if (cfg.supabaseAnonKey) entetes.apikey = cfg.supabaseAnonKey;
    return fetch(URL_ESPACE, { method: 'POST', headers: entetes, body: JSON.stringify(envoi), cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' })
      .catch(() => { const e = new Error(RESEAU); e.reseau = true; throw e; })
      .then((r) => r.json().catch(() => ({})).then((j) => {
        if (!r.ok || !j || !j.ok) { const e = new Error((j && j.erreur) || ECHEC); e.statut = r.status; throw e; }
        return j;
      }));
  };

  // ---------- Messages ----------
  const pleinEcran = (titre, message, reessayer, focus) => {
    $('[data-err-titre]').textContent = titre;
    $('[data-err-msg]').textContent = message;
    $('[data-reessayer-zone]').hidden = !reessayer;
    document.title = titre + ' — Atomes studio';
    montrer('erreur');
    if (focus) $('[data-err-titre]').focus();
  };
  // Lien inutilisable : invalide (400 « Lien invalide »), dossier introuvable (404), expiré (410).
  const lienMort = (ex) => !!ex && (ex.statut === 410 || ex.statut === 404 || (ex.statut === 400 && /lien/i.test(ex.message || '')));
  const erreurLien = (ex, focus) => {
    const msg = ex.message && !/^lien invalide\.?$/i.test(ex.message.trim()) ? ex.message : LIEN_INVALIDE;
    if (ex.statut === 410) pleinEcran(/délai/i.test(msg) ? 'Délai expiré' : 'Lien expiré', msg, false, focus);
    else pleinEcran('Lien invalide', msg, false, focus);
  };
  // Erreur de la lecture « infos » : lien mort, refus explicite (lien indisponible), ou panne (bouton « Réessayer »).
  const erreurInfos = (ex, focus) => {
    if (lienMort(ex)) return erreurLien(ex, focus);
    if (ex.statut && ex.statut < 500 && ex.statut !== 429) return pleinEcran('Lien indisponible', ex.message || ECHEC, false, focus);
    pleinEcran('Page indisponible', ex.message || ECHEC, true, focus);
  };
  const annoncer = (message) => {
    const n = $('[data-notice]');
    n.textContent = message || '';
    n.hidden = !message;
    if (message) { n.focus({ preventScroll: true }); n.scrollIntoView({ block: 'nearest' }); }
  };
  let compteur = 0;
  const champErreur = () => { const n = el('div', 'f-err'); n.id = 'act-err-' + (++compteur); n.setAttribute('role', 'alert'); n.hidden = true; return n; };
  const erreurChamp = (err, msg, champ) => { err.textContent = msg; err.hidden = false; if (champ) { champ.setAttribute('aria-invalid', 'true'); champ.focus(); } };
  const effacerErreur = (err, msg, champ) => { if (err.textContent === msg) err.hidden = true; if (champ) champ.removeAttribute('aria-invalid'); };
  const texte = (t, cls) => el('p', cls || 'action-texte', t);
  const ecrire = (parent, ...noeuds) => { noeuds.forEach((x) => parent.appendChild(typeof x === 'string' ? document.createTextNode(x) : x)); return parent; };
  const lienContact = () => { const a = el('a', '', 'contact@atomes.studio'); a.href = 'mailto:contact@atomes.studio'; return a; };

  // ---------- Chargement ----------
  let etat = null;      // dernière réponse « infos »
  let luLe = 0;         // heure de cette lecture (les liens signés valent une heure)
  let generation = 0;   // un autre lien ouvert dans l'onglet rend caduques les réponses en attente
  // focus : la page suit une action de la personne (autre lien ouvert dans l'onglet, « Réessayer ») ; le titre reçoit
  // le focus, pour qu'un lecteur d'écran annonce la nouvelle page.
  const demarrer = (focus) => {
    const g = ++generation;
    montrer('chargement');
    appeler('infos').then((j) => { if (g === generation) rendre(j, focus); }, (ex) => { if (g === generation) erreurInfos(ex, !!focus); });
  };
  // Relecture après un refus 409 (dossier modifié entre-temps) ou un double envoi : page refaite, message en tête
  // (focalisé), sinon focus sur le titre.
  const relire = (message) => {
    const g = generation;
    return appeler('infos').then((j) => { if (g !== generation) return; rendre(j, !message); if (message) annoncer(message); }, (ex) => {
      if (g !== generation) return;
      if (ex.reseau || !ex.statut || ex.statut >= 500) annoncer(message || ex.message || ECHEC);
      else erreurInfos(ex, true);
    });
  };
  // Après une action réussie : timeline relue (l'étape a changé), sans toucher au message de confirmation.
  const relireTimeline = (suite) => {
    const g = generation;
    return appeler('infos').then((j) => {
      if (g !== generation) return;
      etat = j; luLe = Date.now();
      rendreTimeline(j.timeline || []);
      if (suite) suite(j);
    }, () => { if (g === generation && suite) suite(null); });
  };

  const rendre = (j, focus) => {
    if (!j || !TITRES[j.mode] || !j.dossier) { pleinEcran('Page indisponible', ECHEC, true, !!focus); return; }
    etat = j; luLe = Date.now();
    document.title = TITRES[j.mode] + ' — Atomes studio';
    $('[data-d-num]').textContent = 'DOSSIER N° ' + (j.dossier.id || '');
    $('[data-d-titre]').textContent = TITRES[j.mode];
    $('[data-d-sous]').textContent = [j.dossier.type, j.dossier.commune].filter(Boolean).join(' · ');
    $('[data-mode-lbl]').textContent = ETIQUETTES[j.mode];
    annoncer('');
    rendreTimeline(j.timeline || []);
    const bloc = $('[data-mode]');
    bloc.textContent = '';
    if (j.mode === 'signer') blocSigner(bloc, j);
    else if (j.mode === 'valider') blocValider(bloc, j);
    else blocRenoncer(bloc, j);
    montrer('page');
    if (focus) $('[data-d-titre]').focus({ preventScroll: false });
  };

  // ---------- Timeline compacte (lecture seule) ----------
  const rendreTimeline = (liste) => {
    const ol = $('[data-timeline]');
    ol.textContent = '';
    liste.forEach((e, i) => {
      const statut = ['fait', 'en_cours', 'a_venir'].includes(e.statut) ? e.statut : 'a_venir';
      const li = el('li', 'tl-' + statut + (e.courante ? ' tl-courante' : ''));
      if (e.courante) li.setAttribute('aria-current', 'step');
      li.appendChild(el('span', 'tl-mark'));
      const corps = el('div', 'tl-body');
      const titre = el('div', 'tl-title');
      titre.appendChild(el('span', 'tl-num', String(i + 1).padStart(2, '0')));
      titre.appendChild(document.createTextNode(e.libelle || ''));
      corps.appendChild(titre);
      corps.appendChild(el('span', 'sr-only', statut === 'fait' ? 'Fait' : statut === 'en_cours' ? 'En cours' : 'À venir'));
      li.appendChild(corps);
      li.appendChild(el('span', 'tl-date', statut === 'fait' ? fmtCourt(e.fait_le) : statut === 'en_cours' ? (e.debut_le ? 'Depuis le ' + fmtCourt(e.debut_le) : 'En cours') : ''));
      ol.appendChild(li);
    });
  };
  const etapeCourante = (j) => (j.timeline || []).find((e) => e.courante) || null;

  // ---------- Documents : liens signés valables une heure ----------
  // Au-delà de 50 minutes après la lecture, le lien est redemandé (lecture « infos ») au moment du clic.
  const urlDocument = (j, cle) => (cle === 'devis' ? j.devis && j.devis.url : ((j.documents || []).find((d) => d.nom === cle) || {}).url);
  const lienDocument = (libelle, cls, cle, aria) => {
    const url = urlSure(urlDocument(etat, cle));
    if (!url) return el('span', 'doc-meta', 'Document indisponible pour le moment.');
    const a = el('a', cls, libelle);
    a.dataset.doc = cle;
    a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    if (aria) a.setAttribute('aria-label', aria);
    a.addEventListener('click', (ev) => {
      if (demo) { ev.preventDefault(); annoncer('Démo : le document s’ouvrirait dans un nouvel onglet.'); return; }
      if (Date.now() - luLe < 50 * 60000) return;   // lien encore valable : ouverture normale
      ev.preventDefault();
      const fenetre = window.open('about:blank', '_blank');
      appeler('infos').then((j) => {
        etat = j; luLe = Date.now();
        $$('a[data-doc]').forEach((x) => { const u = urlSure(urlDocument(j, x.dataset.doc)); if (u) x.href = u; });
        const u = urlSure(urlDocument(j, cle));
        if (!u) throw new Error('document absent');
        if (fenetre) { fenetre.opener = null; fenetre.location.href = u; } else location.assign(u);
      }).catch((ex) => {
        if (fenetre) fenetre.close();
        if (lienMort(ex)) erreurLien(ex, true);
        else annoncer('Le document ne peut pas être ouvert pour le moment. Réessayez dans quelques minutes.');
      });
    });
    return a;
  };

  // Envoi d'une action (clic) : bouton bloqué pendant l'envoi ; lien mort → message plein écran ; 409 → message et
  // page relue ; autre refus ou réseau → message sous le bouton, bouton rétabli et focalisé.
  const agir = (btn, err, action, corps, succes) => {
    const g = generation;
    const libelle = btn.textContent;
    btn.disabled = true; btn.textContent = 'Envoi…'; err.hidden = true;
    appeler(action, corps).then((r) => { if (g === generation) succes(r); }, (ex) => {
      if (g !== generation) return;
      if (lienMort(ex)) return erreurLien(ex, true);
      if (ex.statut === 409) return relire(ex.message || ECHEC);
      btn.disabled = false; btn.textContent = libelle;
      err.textContent = ex.message || ECHEC; err.hidden = false;
      btn.focus();
    });
  };
  // Confirmation affichée et focalisée (annoncée par les lecteurs d'écran). Son haut caché sous la barre de navigation
  // collante (zoom, petit écran), elle est alignée en haut, juste sous la barre (scroll-padding-top de html) ; sinon,
  // défilement minimal.
  const confirmation = (zone, ...lignes) => {
    const ok = el('div', 'action-ok');
    ok.tabIndex = -1;
    ok.setAttribute('role', 'status');
    lignes.forEach((l, i) => ok.appendChild(typeof l === 'string' ? el('p', i ? '' : 'action-ok-titre', l) : l));
    zone.textContent = '';
    zone.appendChild(ok);
    ok.focus({ preventScroll: true });
    const barre = $('.nav');
    ok.scrollIntoView({ block: barre && ok.getBoundingClientRect().top < barre.getBoundingClientRect().bottom ? 'start' : 'nearest' });
    return ok;
  };
  // Formulaire type de rétractation (texte de la fonction, une ligne par élément), sous le formulaire du mode « renoncer ».
  const texteFormulaire = (t) => (Array.isArray(t && t.formulaire) ? t.formulaire.join('\n') : String((t && t.formulaire) || ''));
  const boiteFormulaire = (formulaire) => {
    const box = el('div', 'retractation');
    box.appendChild(el('p', 'lbl', 'Formulaire type'));
    box.appendChild(el('p', 'formulaire-type', formulaire));
    return box;
  };

  // ---------- Mode « signer » ----------
  const blocSigner = (bloc, j) => {
    const devis = j.devis;
    const courante = etapeCourante(j);
    if (j.signe) {
      bloc.appendChild(texte('Ce devis est signé depuis le ' + fmtDate(j.signe.le) + '.'));
      if (devis) bloc.appendChild(lienDocument('Lire le devis (PDF)', 'btn btn--ghost', 'devis'));
      return;
    }
    if (!devis) { bloc.appendChild(texte('Votre devis sera bientôt disponible.')); return; }
    if (courante && courante.cle !== 'signature') {
      bloc.appendChild(texte('Ce devis n’est pas en attente de signature pour le moment. Nous vous écrirons dès qu’il le sera.'));
      return;
    }
    const particulier = j.dossier.particulier !== false;
    const t = j.textes || {};
    // Particulier : la case vient de la fonction (texte enregistré avec la signature) ; sans elle, pas de signature
    // possible.
    if (particulier && !t.case) { bloc.appendChild(texte(ECHEC)); return; }
    const montant = el('p', 'montant');
    montant.appendChild(el('span', '', 'À régler par virement' + (devis.montant_libelle ? ' · ' + devis.montant_libelle : '')));
    montant.appendChild(el('strong', '', euros(devis.montant_cents)));
    bloc.appendChild(montant);
    if (devis.envoye_le || devis.nom) bloc.appendChild(el('p', 'doc-meta', [devis.envoye_le ? 'Envoyé le ' + fmtDate(devis.envoye_le) : '', devis.nom].filter(Boolean).join(' · ')));
    bloc.appendChild(lienDocument('Lire le devis (PDF)', 'btn btn--ghost', 'devis'));

    const f = el('form', 'action-form'); f.noValidate = true;
    const err = champErreur();
    let cb = null;
    if (particulier) {
      const lab = el('label', 'case');
      cb = el('input'); cb.type = 'checkbox'; cb.id = 'sig-demarrage'; cb.setAttribute('aria-describedby', err.id);
      lab.htmlFor = cb.id;
      lab.appendChild(cb); lab.appendChild(el('span', '', t.case));
      f.appendChild(lab);
    }
    const champ = el('div', 'field');
    const lnom = el('label', 'lbl', 'Votre nom et prénom'); lnom.htmlFor = 'sig-nom';
    const inom = el('input', 'input'); inom.id = 'sig-nom'; inom.autocomplete = 'name'; inom.maxLength = 120; inom.setAttribute('aria-describedby', err.id);
    champ.appendChild(lnom); champ.appendChild(inom);
    f.appendChild(champ);
    f.appendChild(el('p', 'f-hint', 'Votre signature électronique est enregistrée avec la date, l’heure, votre adresse IP, votre navigateur et l’empreinte du devis. Vous recevez une confirmation par e-mail.'));
    const signer = el('button', 'btn', t.bouton || BOUTON_SIGNER); signer.type = 'submit';
    // Phrase des conditions générales, pour tous les clients, juste au-dessus du bouton, qu'elle décrit.
    const cgv = el('p', 'action-cgv', t.cgv || CGV); cgv.id = 'sig-cgv';
    signer.setAttribute('aria-describedby', cgv.id);
    // Particulier : signature impossible tant que la case n'est pas cochée (bouton indisponible, explication au clic).
    const majBouton = () => { if (!cb || cb.checked) signer.removeAttribute('aria-disabled'); else signer.setAttribute('aria-disabled', 'true'); };
    majBouton();
    if (cb) cb.addEventListener('change', () => { majBouton(); if (cb.checked) effacerErreur(err, MSG_CASE, cb); });
    inom.addEventListener('input', () => { if (inom.value.trim().length >= 3) effacerErreur(err, MSG_NOM, inom); });
    const actions = el('div', 'form-actions'); actions.appendChild(signer);
    f.appendChild(err); f.appendChild(cgv); f.appendChild(actions);
    f.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (signer.disabled) return;
      if (cb && !cb.checked) { erreurChamp(err, MSG_CASE, cb); return; }
      const nom = inom.value.trim();
      if (nom.length < 3) { erreurChamp(err, MSG_NOM, inom); return; }
      agir(signer, err, 'signer', { nom, accepte: true, demarrage: !!(cb && cb.checked), empreinte: devis.empreinte, montant: devis.montant_cents }, (r) => {
        if (r.deja) { relire('Ce devis est déjà signé.'); return; }
        const zone = el('div', 'action-bloc');
        bloc.textContent = '';
        bloc.appendChild(zone);
        // Confirmation du contrat non partie (mail: false) : la page ne l'annonce pas comme envoyée.
        if (r.mail === false) {
          confirmation(zone, 'Merci, votre devis est signé.', 'La confirmation de votre commande et les informations de virement n’ont pas pu vous être envoyées par e-mail pour le moment : nous vous les adresserons dans les meilleurs délais.');
        } else confirmation(zone, 'Merci, votre devis est signé. Vous allez recevoir par e-mail la confirmation et les informations de virement.');
        relireTimeline();
      });
    });
    bloc.appendChild(f);
  };

  // ---------- Mode « valider » ----------
  const blocValider = (bloc, j) => {
    const docs = Array.isArray(j.documents) ? j.documents : [];
    if (docs.length) {
      const ul = el('ul', 'docs'); ul.setAttribute('role', 'list');
      docs.forEach((d) => {
        const li = el('li');
        const g = el('div');
        g.appendChild(el('span', 'doc-name', d.nom || ''));
        g.appendChild(el('span', 'doc-meta', [d.taille ? fmtTaille(d.taille) : '', fmtDate(d.date)].filter(Boolean).join(' · ')));
        li.appendChild(g);
        li.appendChild(lienDocument('Télécharger', 'link-more', d.nom, 'Télécharger ' + (d.nom || 'le document')));
        ul.appendChild(li);
      });
      bloc.appendChild(ul);
    } else bloc.appendChild(el('p', 'docs-vide', 'Aucun document pour le moment.'));
    const zone = el('div', 'action-bloc');
    bloc.appendChild(zone);
    const courante = etapeCourante(j);
    // Nouvelle demande de validation (dossier revenu à cette étape) : une validation précédente ne compte plus.
    if (j.valide_le && !(courante && courante.cle === 'validation')) { zone.appendChild(texte('Vos documents ont été validés le ' + fmtDate(j.valide_le) + '. Merci.')); return; }
    if (courante && courante.cle !== 'validation') {
      zone.appendChild(texte('Vos documents ne sont pas en attente de validation pour le moment. Nous vous écrirons dès qu’ils le seront.'));
      return;
    }
    zone.appendChild(el('p', 'f-hint', 'Pour demander une modification, répondez simplement à l’e-mail reçu ou écrivez-nous depuis votre espace client.'));
    const err = champErreur();
    const valider = el('button', 'btn', 'Je valide mes documents'); valider.type = 'button';
    const actions = el('div', 'form-actions'); actions.appendChild(valider);
    zone.appendChild(err); zone.appendChild(actions);
    valider.addEventListener('click', () => {
      if (valider.disabled) return;
      agir(valider, err, 'valider', {}, (r) => {
        if (r.deja) { relire('Vos documents sont déjà validés.'); return; }
        confirmation(zone, r.etape === 'depot' ? 'Merci, vos documents sont validés. Nous préparons le dépôt de votre démarche.'
          : r.etape === 'clos' ? 'Merci, vos documents sont validés. Votre dossier est clos.' : 'Merci, vos documents sont validés.');
        relireTimeline();
      });
    });
  };

  // ---------- Mode « renoncer » (particulier, pendant le délai de rétractation) ----------
  const accuse = (j, le, nom) => {
    const dl = el('dl', 'recap-liste');
    [['Dossier', 'N° ' + (j.dossier.id || '')], ['Nom', nom || ''], ['Devis signé le', fmtDate(j.signe_le)], ['Reçue le', fmtHeure(le)]]
      .filter((x) => x[1]).forEach((x) => { dl.appendChild(el('dt', '', x[0])); dl.appendChild(el('dd', '', x[1])); });
    return dl;
  };
  const blocRenoncer = (bloc, j) => {
    if (j.retracte_le) {
      bloc.appendChild(texte('Vous avez renoncé au contrat le ' + fmtHeure(j.retracte_le) + '.'));
      // accuse_envoye faux : l'accusé n'est pas (encore) parti, l'agence doit le renvoyer.
      bloc.appendChild(texte(j.accuse_envoye === false ? 'L’accusé de réception n’a pas encore pu vous être envoyé par e-mail : nous vous l’adresserons dans les meilleurs délais.' : ACCUSE_ENVOYE));
      return;
    }
    if (j.dossier.particulier === false) { bloc.appendChild(texte('Le droit de rétractation ne s’applique pas à ce dossier.')); return; }
    if (!j.signe_le) { bloc.appendChild(texte('Aucun devis signé n’est en cours sur ce dossier.')); return; }
    const limite = fmtLimite(j.date_limite);
    if (j.expire) {
      bloc.appendChild(texte(limite ? 'Le délai de rétractation a pris fin le ' + limite + '.' : 'Le délai de rétractation est expiré.'));
      bloc.appendChild(ecrire(el('p', 'action-texte'), 'Pour toute question, écrivez-nous à ', lienContact(), '.'));
      return;
    }
    bloc.appendChild(texte('Devis signé le ' + fmtDate(j.signe_le) + '. ' + (limite
      ? 'Vous pouvez renoncer au contrat jusqu’au ' + limite + ' inclus, sans avoir à vous justifier.'
      : 'Vous pouvez renoncer au contrat pendant le délai de rétractation, sans avoir à vous justifier.')));
    const f = el('form', 'action-form'); f.noValidate = true;
    const err = champErreur();
    const champ = (id, libelle, opt, attrs) => {
      const c = el('div', 'field');
      const l = el('label', 'lbl', libelle); l.htmlFor = id;
      if (opt) { l.appendChild(document.createTextNode(' ')); l.appendChild(el('span', 'lbl-opt', opt)); }
      const i = el('input', 'input'); i.id = id; i.setAttribute('aria-describedby', err.id);
      Object.assign(i, attrs);
      c.appendChild(l); c.appendChild(i);
      f.appendChild(c);
      return i;
    };
    const inom = champ('ren-nom', 'Votre nom et prénom', '', { autocomplete: 'name', maxLength: 120 });
    const imail = champ('ren-email', 'Email', '(pour l’accusé de réception)', { type: 'email', autocomplete: 'email', maxLength: 200, placeholder: 'vous@exemple.fr' });
    const confirmer = el('button', 'btn', 'Confirmer la rétractation'); confirmer.type = 'submit';
    const actions = el('div', 'form-actions'); actions.appendChild(confirmer);
    f.appendChild(err); f.appendChild(actions);
    inom.addEventListener('input', () => { if (inom.value.trim().length >= 3) effacerErreur(err, MSG_NOM, inom); });
    imail.addEventListener('input', () => effacerErreur(err, MSG_EMAIL, imail));
    f.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (confirmer.disabled) return;
      const nom = inom.value.trim(), email = imail.value.trim();
      if (nom.length < 3) { erreurChamp(err, MSG_NOM, inom); return; }
      if (!EMAIL.test(email)) { erreurChamp(err, MSG_EMAIL, imail); return; }
      agir(confirmer, err, 'renoncer', { nom, email }, (r) => {
        if (r.deja) { relire('Votre rétractation était déjà enregistrée.'); return; }
        // Accusé non parti (mail: false) : l'accusé affiché ici est à conserver, l'agence le renverra par e-mail.
        const afficher = (le) => {
          bloc.textContent = '';
          const zone = el('div', 'action-bloc');
          bloc.appendChild(zone);
          confirmation(zone, le ? 'Votre rétractation a bien été reçue le ' + fmtHeure(le) + '.' : 'Votre rétractation a bien été reçue.',
            accuse(j, le, nom), r.mail === false ? ACCUSE_NON_ENVOYE : ACCUSE_ENVOYE);
        };
        // Heure de réception : celle renvoyée par la fonction, sinon relue (« infos »).
        if (dateValide(r.retracte_le)) { afficher(r.retracte_le); relireTimeline(); }
        else relireTimeline((n) => afficher(n && dateValide(n.retracte_le) ? n.retracte_le : null));
      });
    });
    bloc.appendChild(f);
    const formulaire = texteFormulaire(j.textes);
    if (formulaire) bloc.appendChild(boiteFormulaire(formulaire));
  };

  // ---------- Démo : réponses simulées, sans aucune requête ----------
  const apiDemo = (scenario) => {
    const now = Date.now(), jour = 86400000;
    const iso = (t) => new Date(t).toISOString();
    const pro = scenario === 'signer-pro';
    const mode = scenario === 'valider' || scenario === 'renoncer' ? scenario : 'signer';
    const MODELE = [['demande', 'Demande reçue'], ['traitement', 'Traitement de votre demande'], ['devis', 'Production de votre devis'],
      ['signature', 'Validation de votre devis'], ['paiement', 'Paiement'], ['production', 'Production de vos documents'],
      ['validation', 'Validation de vos documents'], ['clos', 'Dossier clos']];
    let courante = mode === 'signer' ? 'signature' : mode === 'valider' ? 'validation' : 'paiement';
    const signeLe = iso(now - 2 * jour);
    const d = { signe: mode === 'signer' ? null : { le: signeLe, nom: 'Jean Dupont' }, valide_le: null, retracte_le: null };
    const limite = new Date(now + 12 * jour).toISOString().slice(0, 10);
    // Textes de démonstration : copie mot pour mot des textes de TEXTES (fonction « espace ») que la page affiche ; la
    // fonction les envoie en service.
    const TEXTES = {
      case: 'Je demande que la mission commence avant la fin du délai de rétractation de 14 jours. Je reconnais perdre mon droit de rétractation une fois la mission entièrement exécutée, et devoir, si je me rétracte avant, un montant proportionné au travail déjà réalisé.',
      cgv: CGV,
      bouton: BOUTON_SIGNER,
      formulaire: ['Formulaire de rétractation', '(Veuillez compléter et renvoyer le présent formulaire uniquement si vous souhaitez vous rétracter du contrat.)',
        "À l'attention d'Atomes studio, Simon Charles, 31 rue Chevalier Paul, 83000 Toulon, contact@atomes.studio :",
        'Je vous notifie par la présente ma rétractation du contrat portant sur la prestation de services ci-dessous :',
        'Dossier N° : …', 'Devis signé le : …', 'Nom du consommateur : …', 'Adresse du consommateur : …',
        'Signature du consommateur (uniquement en cas de notification du présent formulaire sur papier) : …', 'Date : …']
    };
    const timeline = () => {
      const o = MODELE.findIndex((m) => m[0] === courante);
      return MODELE.map((m, i) => {
        const fait = i < o || (i === o && m[0] === 'clos');
        return { cle: m[0], libelle: m[1], statut: fait ? 'fait' : i === o ? 'en_cours' : 'a_venir', fait_le: fait ? iso(now - (12 - i) * jour) : null, debut_le: i === o ? iso(now - jour) : null, courante: i === o };
      });
    };
    const infos = () => {
      const r = { ok: true, mode, dossier: { id: '261003091422', type: 'Extension', commune: 'Hyères', prenom: 'Jean', particulier: !pro }, timeline: timeline() };
      if (mode === 'signer') Object.assign(r, { devis: { nom: 'devis-261003091422-261008101500.pdf', url: '#', empreinte: 'demo', montant_cents: 72000, montant_libelle: 'Acompte de 40 %', envoye_le: iso(now - jour) }, signe: d.signe, textes: { case: TEXTES.case, bouton: TEXTES.bouton, cgv: TEXTES.cgv } });
      if (mode === 'valider') Object.assign(r, { documents: [{ nom: 'Plans-et-perspective-261003091422.pdf', url: '#', taille: 3145728, date: iso(now - jour) }, { nom: 'Notice-descriptive-261003091422.pdf', url: '#', taille: 284000, date: iso(now - jour) }], valide_le: d.valide_le });
      if (mode === 'renoncer') Object.assign(r, { signe_le: signeLe, date_limite: limite, retracte_le: d.retracte_le, expire: false, textes: { formulaire: TEXTES.formulaire } });
      return r;
    };
    const actions = {
      infos,
      signer: (c) => {
        if (d.signe) return { ok: true, deja: true };
        d.signe = { le: iso(Date.now()), nom: c.nom }; courante = 'paiement';
        return { ok: true, etape: 'paiement', mail: true };
      },
      valider: () => { if (d.valide_le) return { ok: true, deja: true }; d.valide_le = iso(Date.now()); courante = 'clos'; return { ok: true, etape: 'clos', mail: true }; },
      renoncer: () => { if (d.retracte_le) return { ok: true, deja: true }; d.retracte_le = iso(Date.now()); return { ok: true, retracte_le: d.retracte_le, mail: true }; }
    };
    return (corps) => new Promise((res) => setTimeout(() => res(actions[corps.action](corps)), 250));
  };

  // ---------- Démarrage ----------
  $('[data-reessayer]').addEventListener('click', () => demarrer(true));
  const ouvrirLien = (focus) => {
    const t = lireJeton();   // lu et retiré de la barre d'adresse avant toute autre chose
    if (!URL_ESPACE) { pleinEcran('Page indisponible', 'Ce service n’est pas encore disponible.', false, focus); return; }
    if (t === null) {
      pleinEcran('Lien à rouvrir', 'Ouvrez cette page depuis le lien reçu par e-mail. Pour votre sécurité, le lien n’est pas conservé dans l’adresse de la page : après un rechargement, rouvrez-le depuis l’e-mail.', false, focus);
      return;
    }
    if (!jetonValide(t)) { generation++; pleinEcran('Lien invalide', LIEN_INVALIDE, false, focus); return; }
    jeton = t;
    demarrer(focus);
  };
  // Autre lien ouvert dans le même onglet (même page, nouveau fragment) : il remplace le précédent.
  window.addEventListener('hashchange', () => { if (!demo && /(^#|&)t=/.test(location.hash)) ouvrirLien(true); });

  if (demo) { demoApi = apiDemo(params.get('demo')); demarrer(); }
  else ouvrirLien(false);
})();
