// Page Contact — prise de contact simple, distincte des demandes de devis.
// D'abord une question : la demande concerne-t-elle un devis ? Oui → lien vers la page Devis (formulaire en huit
// écrans, dossier et espace client). Non → coordonnées et message, envoyés par FormSubmit à contact@atomes.studio,
// sans dossier. Objet du mail : `Nouveau message — Prénom Nom`, ou `Nouveau message — Société (Prénom Nom)` ;
// à garder distinct de l'objet des devis (`Nouveau projet — …`).
(() => {
  const form = document.getElementById('message');
  if (!form) {
    // Transition : ancienne page Contact (formulaire de devis) encore en cache, chargée avec ce script → page Devis
    if (document.getElementById('demande')) location.replace('devis.html');
    return;
  }

  const ENDPOINT_AJAX = 'https://formsubmit.co/ajax/contact@atomes.studio';
  const ECHEC = 'L’envoi a échoué. Réessayez ou écrivez-nous directement à contact@atomes.studio.';
  const ECHEC_RESEAU = 'L’envoi a échoué (connexion). Réessayez ou écrivez-nous directement à contact@atomes.studio.';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const el = {
    choix: $$('[data-devis]', form),
    panneaux: $$('[data-panneau]', form),
    submit: $('[data-submit]', form),
    sendErr: $('[data-send-err]', form),
    liveAlert: $('[data-live-alert]', form),
    sent: $('[data-sent]'),
    reset: $('[data-reset]')
  };
  const initial = () => ({ choix: '', tried: false, envoi: false, sent: false, erreur: '' });
  let s = initial();
  const val = (name) => (form.elements[name] ? form.elements[name].value : '');
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- Validation (messages courts : ils s'affichent sur la ligne du libellé, sans décaler le formulaire) ----
  const CHAMPS = ['prenom', 'nom', 'email', 'telephone', 'message'];
  const validate = () => {
    const e = {};
    if (!val('prenom').trim()) e.prenom = 'Champ requis';
    if (!val('nom').trim()) e.nom = 'Champ requis';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(val('email').trim())) e.email = 'Adresse invalide';
    if (val('telephone').trim() && val('telephone').replace(/\D/g, '').length < 10) e.telephone = 'Incomplet';
    if (val('message').trim().length < 10) e.message = '10 caractères minimum';
    else if (val('message').length > 5000) e.message = '5 000 caractères maximum';
    return e;
  };

  // ---- Champs envoyés à FormSubmit (libellés français ; « email » sert d'adresse de réponse) ----
  const champs = () => {
    const out = [];
    const add = (k, v) => { if (v !== undefined && v !== null && String(v).trim() !== '') out.push([k, String(v).trim()]); };
    const qui = (val('prenom').trim() + ' ' + val('nom').trim()).trim();
    const societe = val('societe').trim();
    add('Prénom', val('prenom')); add('Nom', val('nom')); add('email', val('email')); add('Téléphone', val('telephone'));
    add('Société ou organisme', societe); add('Message', val('message'));
    add('_subject', 'Nouveau message — ' + (societe ? societe + ' (' + qui + ')' : qui));
    add('_template', 'table');
    if (val('_honey')) add('_honey', val('_honey'));
    return out;
  };

  // ---- Rendu ----
  const setErr = (key, msg) => {
    const n = $('[data-err="' + key + '"]', form);
    if (n) { n.textContent = msg || ''; n.hidden = !msg; }
    const inp = form.elements[key];
    if (inp) { if (msg) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid'); }
  };

  const render = () => {
    form.hidden = s.sent;
    if (el.sent) el.sent.hidden = !s.sent;
    el.choix.forEach((c) => {
      const on = c.dataset.devis === s.choix;
      c.classList.toggle('is-on', on);
      c.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    // Panneau de la réponse choisie (sur grand écran, les deux sont superposés : la hauteur ne change pas)
    el.panneaux.forEach((p) => {
      const on = p.dataset.panneau === s.choix;
      if (on && !p.classList.contains('is-on') && !reduceMotion) { p.classList.remove('is-new'); void p.offsetWidth; p.classList.add('is-new'); }
      p.classList.toggle('is-on', on);
    });
    const errs = s.tried ? validate() : {};
    CHAMPS.forEach((k) => setErr(k, errs[k]));
    if (el.liveAlert) el.liveAlert.textContent = '';   // renseignée juste après par envoyer() en cas d'erreurs
    if (el.submit) {
      el.submit.setAttribute('aria-disabled', s.envoi ? 'true' : 'false');
      el.submit.textContent = s.envoi ? 'Envoi en cours…' : 'Envoyer le message';
    }
    if (el.sendErr) { el.sendErr.textContent = s.erreur; el.sendErr.hidden = !s.erreur; }
  };

  // ---- Envoi ----
  const envoyer = (e) => {
    e.preventDefault();
    if (s.choix !== 'non' || s.envoi) return;
    const erreurs = Object.keys(validate());
    if (erreurs.length) {
      s.tried = true; render();
      if (el.liveAlert) el.liveAlert.textContent = erreurs.length + (erreurs.length > 1 ? ' champs à corriger' : ' champ à corriger');
      const premier = form.elements[erreurs[0]];
      if (premier) { premier.focus({ preventScroll: true }); premier.closest('.field').scrollIntoView({ block: 'nearest' }); }
      return;
    }
    s.envoi = true; s.erreur = ''; render();
    const fd = new FormData();
    champs().forEach(([k, v]) => fd.append(k, v));
    fetch(ENDPOINT_AJAX, { method: 'POST', headers: { 'Accept': 'application/json' }, body: fd })
      .then((r) => r.json())
      .then((res) => {
        s.envoi = false;
        if (res && (res.success === 'true' || res.success === true)) s.sent = true;
        else s.erreur = ECHEC;
        render();
        if (s.sent && el.sent) { el.sent.focus({ preventScroll: true }); el.sent.scrollIntoView({ block: 'nearest' }); }
      })
      .catch(() => { s.envoi = false; s.erreur = ECHEC_RESEAU; render(); });
  };

  const reset = () => {
    s = initial(); form.reset(); render();
    if (el.choix[0]) el.choix[0].focus();
  };

  // ---- Écouteurs ----
  el.choix.forEach((c) => c.addEventListener('click', () => { s.choix = c.dataset.devis; s.erreur = ''; render(); }));
  form.addEventListener('submit', envoyer);
  form.addEventListener('input', () => { if (s.tried) render(); });
  if (el.reset) el.reset.addEventListener('click', reset);

  // Transition : un formulaire de devis resté en cache sur cette adresse revient ici après un envoi FormSubmit
  // avec pièces jointes (?envoye=1) : afficher une confirmation plutôt qu'un formulaire vide.
  if (new URLSearchParams(location.search).get('envoye') === '1') {
    s.sent = true;
    history.replaceState(null, '', location.pathname);
  }
  render();
  if (s.sent && el.sent) el.sent.focus();
})();
