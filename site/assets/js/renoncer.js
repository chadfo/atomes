// Formulaire public de rétractation (renoncer/ ; décisions de Simon du 21 octobre 2026) : le particulier qui a signé son
// devis en ligne renonce au contrat sans connexion ni lien reçu par e-mail (articles L221-21 et D221-5 du code de la
// consommation ; conditions générales, article 11.3). Page ouverte par le lien « Renoncer au contrat ici » du pied de
// page de l'espace client, de la page d'action et de cette page, ou directement (atomes.studio/renoncer/).
// Champs : nom et prénom, numéro de dossier et adresse e-mail de la demande (ils identifient le contrat), autre adresse
// pour l'accusé de réception (facultative) ; aucun motif, aucune étape de plus. Rien n'est lu au chargement : envoi au
// clic seulement, à l'action « renoncer_formulaire » de la fonction « espace » (config.js : espaceUrl), POST JSON avec
// l'en-tête apikey, sans session ni jeton. Réponses : rétractation reçue (date et heure, accusé de réception parti ou
// non), déjà reçue, refus (format, contrat introuvable, délai expiré : texte de la fonction, affiché tel quel, l'adresse
// contact@atomes.studio en lien). Champs sans name (aucun envoi natif) ; nom, numéro et adresses jamais dans une URL,
// un stockage ni un journal.
// Mode démo sans backend : renoncer/?demo (rétractation reçue simulée, aucune requête ; la confirmation le dit à la
// place de l'accusé de réception : « Démonstration : rien n’a été envoyé. »).
(() => {
  const cfg = window.ATOMES_CONFIG || {};
  const demo = new URLSearchParams(location.search).has('demo');
  const $ = (sel, root) => (root || document).querySelector(sel);
  const el = (tag, cls, texte) => { const n = document.createElement(tag); if (cls) n.className = cls; if (texte !== undefined) n.textContent = texte; return n; };

  // Date et heure à l'heure de Paris (comme les e-mails et la page d'action) ; « 1er » comme dans les e-mails (règle
  // premier() de la fonction « espace ») : « 1er octobre 2026 à 14:05 ».
  const premier = (s) => s.replace(/(^|\s)1(\s)/, '$11er$2');
  const dateValide = (iso) => !!iso && !isNaN(new Date(iso).getTime());
  const fmtHeure = (iso) => (dateValide(iso) ? premier(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long', timeStyle: 'short' }).format(new Date(iso))) : '');

  // Textes repris de la page d'action (mode « renoncer ») ; MSG_DOSSIER : refus de la fonction pour ce champ.
  const ECHEC = 'Action impossible pour le moment. Réessayez dans quelques minutes ou écrivez-nous à contact@atomes.studio.';
  const MSG_NOM = 'Saisissez votre nom et votre prénom.';
  const MSG_DOSSIER = 'Saisissez le numéro de dossier (12 chiffres).';
  const MSG_EMAIL = 'Adresse email invalide';
  // Accusé de réception non parti (réponse mail: false de la fonction) : ce que la page dit à la place de « envoyé ».
  const ACCUSE_ENVOYE = 'Un accusé de réception vous a été envoyé par e-mail.';
  // Démo : aucune requête, aucun accusé de réception ; dit à la place de ACCUSE_ENVOYE.
  const DEMO = 'Démonstration : rien n’a été envoyé.';
  const ACCUSE_NON_ENVOYE = 'L’accusé de réception n’a pas pu vous être envoyé par e-mail pour le moment : conservez cette page (imprimez-la ou enregistrez-la). Nous vous l’adresserons dans les meilleurs délais.';
  // Une seule adresse : ni virgule, ni point-virgule, ni chevrons, ni guillemets (même règle que la fonction).
  const EMAIL = /^[^@\s,;<>"'()]+@[^@\s,;<>"'()]+\.[^@\s,;<>"'()]+$/;
  const CONTACT = 'contact@atomes.studio';
  const URL_ESPACE = cfg.espaceUrl || (cfg.supabaseUrl ? String(cfg.supabaseUrl).replace(/\/$/, '') + '/functions/v1/espace' : '');

  // Espace non activé (config.js vide) : message plein écran à la place du formulaire.
  if (!demo && !URL_ESPACE) { $('[data-vue="formulaire"]').hidden = true; $('[data-vue="erreur"]').hidden = false; return; }

  const form = $('[data-form]');
  const bloc = $('[data-bloc]');
  const btn = $('[data-confirmer]');
  const LIBELLE = btn.textContent;
  const errEnvoi = $('[data-err-envoi]');
  const champs = { nom: $('#ren-nom'), dossier: $('#ren-dossier'), email: $('#ren-email'), accuse: $('#ren-accuse') };

  // Valeurs envoyées : nom sans espaces autour ; numéro de dossier et adresses sans aucun espace (recopiés d'un e-mail,
  // comme les lit la fonction).
  const valeurs = () => ({
    nom: champs.nom.value.trim(), dossier: champs.dossier.value.replace(/\s/g, ''),
    email: champs.email.value.replace(/\s/g, ''), accuse: champs.accuse.value.replace(/\s/g, '')
  });
  // Formats (mêmes règles que la fonction : nom de 3 caractères au moins, 120 au plus par le maxlength du champ ;
  // 12 chiffres ; adresses de 200 caractères au plus), dans l'ordre du formulaire ; à l'envoi, le message du premier
  // champ invalide, sous ce champ (focalisé).
  const REGLES = [
    ['nom', MSG_NOM, (v) => v.nom.length >= 3],
    ['dossier', MSG_DOSSIER, (v) => /^[0-9]{12}$/.test(v.dossier)],
    ['email', MSG_EMAIL, (v) => v.email.length <= 200 && EMAIL.test(v.email)],
    ['accuse', MSG_EMAIL, (v) => !v.accuse || (v.accuse.length <= 200 && EMAIL.test(v.accuse))]
  ];
  const zone = (cle) => $('#' + champs[cle].id + '-err');
  const signaler = (cle, msg) => {
    const z = zone(cle);
    z.textContent = msg || ''; z.hidden = !msg;
    if (msg) champs[cle].setAttribute('aria-invalid', 'true'); else champs[cle].removeAttribute('aria-invalid');
  };
  // Message retiré dès que le champ est corrigé
  REGLES.forEach(([cle, , valide]) => champs[cle].addEventListener('input', () => { if (!zone(cle).hidden && valide(valeurs())) signaler(cle, ''); }));

  // Refus écrit sous le formulaire ; l'adresse contact@atomes.studio y devient un lien (texte de la fonction compris).
  const ecrireRefus = (msg) => {
    errEnvoi.textContent = '';
    String(msg).split(CONTACT).forEach((morceau, i) => {
      if (i) { const a = el('a', '', CONTACT); a.href = 'mailto:' + CONTACT; errEnvoi.appendChild(a); }
      if (morceau) errEnvoi.appendChild(document.createTextNode(morceau));
    });
    errEnvoi.hidden = false;
  };

  // Envoi à la fonction « espace » (ou démo). Refus : erreur portant le texte de la fonction ; une requête qui n'aboutit
  // pas (réseau coupé, requête bloquée par le réseau ou le navigateur), un 401 (fonction antérieure à ce formulaire, qui
  // exige une session) et une erreur du serveur (5xx : texte générique de la fonction, sans l'adresse de contact) ne
  // sont jamais montrés tels quels : message d'échec, qui donne contact@atomes.studio (jamais un seul moyen de renoncer).
  const envoyer = (corps) => {
    if (demo) return new Promise((res) => setTimeout(() => res({ ok: true, retracte_le: new Date().toISOString(), mail: true }), 250));
    const entetes = { 'Content-Type': 'application/json' };
    if (cfg.supabaseAnonKey) entetes.apikey = cfg.supabaseAnonKey;
    return fetch(URL_ESPACE, { method: 'POST', headers: entetes, body: JSON.stringify(corps), cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' })
      .catch(() => { throw new Error(ECHEC); })
      .then((r) => r.json().catch(() => ({})).then((j) => {
        if (r.ok && j && j.ok) return j;
        throw new Error(r.status !== 401 && r.status < 500 && j && typeof j.erreur === 'string' && j.erreur ? j.erreur : ECHEC);
      }));
  };

  // Rétractation reçue (date et heure de réception, récapitulatif, accusé parti ou non) ou déjà reçue : la confirmation
  // remplace le formulaire, focalisée (annoncée par les lecteurs d'écran). Son haut caché sous la barre de navigation
  // collante (zoom, petit écran), elle est alignée en haut, juste sous la barre (scroll-padding-top de html) ; sinon,
  // défilement minimal.
  const confirmer = (r, v) => {
    const ok = el('div', 'action-ok');
    ok.tabIndex = -1;
    ok.setAttribute('role', 'status');
    if (r.deja) {
      ok.appendChild(el('p', 'action-ok-titre', 'Votre rétractation était déjà enregistrée.'));
      if (dateValide(r.retracte_le)) ok.appendChild(el('p', '', 'Vous avez renoncé au contrat le ' + fmtHeure(r.retracte_le) + '.'));
    } else {
      const le = dateValide(r.retracte_le) ? r.retracte_le : null;
      ok.appendChild(el('p', 'action-ok-titre', le ? 'Votre rétractation a bien été reçue le ' + fmtHeure(le) + '.' : 'Votre rétractation a bien été reçue.'));
      const dl = el('dl', 'recap-liste');
      [['Dossier', 'N° ' + v.dossier], ['Nom', v.nom], ['Reçue le', fmtHeure(le)]].filter((x) => x[1])
        .forEach((x) => { dl.appendChild(el('dt', '', x[0])); dl.appendChild(el('dd', '', x[1])); });
      ok.appendChild(dl);
      ok.appendChild(el('p', '', demo ? DEMO : r.mail === false ? ACCUSE_NON_ENVOYE : ACCUSE_ENVOYE));
    }
    bloc.textContent = '';
    bloc.appendChild(ok);
    ok.focus({ preventScroll: true });
    const barre = $('.nav');
    ok.scrollIntoView({ block: barre && ok.getBoundingClientRect().top < barre.getBoundingClientRect().bottom ? 'start' : 'nearest' });
  };

  // « Confirmer la rétractation » : formats contrôlés (aucune requête sinon), bouton bloqué pendant l'envoi ; refus ou
  // panne : message sous le formulaire, saisie gardée, bouton rétabli et focalisé.
  let envoi = false;
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (envoi) return;
    const v = valeurs();
    REGLES.forEach(([cle]) => signaler(cle, ''));
    const faute = REGLES.find(([, , valide]) => !valide(v));
    if (faute) { signaler(faute[0], faute[1]); champs[faute[0]].focus(); return; }
    const corps = { action: 'renoncer_formulaire', nom: v.nom, dossier: v.dossier, email: v.email };
    if (v.accuse) corps.email_accuse = v.accuse;
    envoi = true;
    errEnvoi.hidden = true;
    btn.disabled = true; btn.textContent = 'Envoi…';
    envoyer(corps).then((r) => confirmer(r, v), (ex) => {
      envoi = false;
      btn.disabled = false; btn.textContent = LIBELLE;
      ecrireRefus(ex.message || ECHEC);
      btn.focus();
    });
  });
})();
