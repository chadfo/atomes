// =============================================================================
// atomes.studio — fonction « espace » (Supabase Edge Function, Deno)
// Actions de l'espace client et de l'espace agence, paiement par carte (Stripe), e-mails (Resend).
//   Client  : repondre (questions), signer (devis), payer (session Stripe), paiement (retour Stripe),
//             valider (documents), modifier (demande de modification)
//   Agence  : questions, devis (envoi du devis signable), etape, option (suivi administratif), paye
//   Stripe  : webhook checkout.session.completed, format « instantané » ou « léger » (requête signée,
//             en-tête stripe-signature)
// Appel : POST JSON { action, projet, … } avec l'en-tête Authorization: Bearer <jeton de session Supabase>.
// « Verify JWT » est désactivé pour cette fonction : le jeton est vérifié ici (Stripe n'en envoie pas).
// Les transitions d'étapes passent par projets.etape : le déclencheur SQL recalcule la timeline
// (migration 0004).
//
// Secrets : RESEND_API_KEY, SB_SECRET_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET ; facultatifs
// MAIL_AGENCE, MAIL_FROM, SITE_URL, ORIGINES_AUTORISEES (mêmes valeurs que pour la fonction « demande »).
// =============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const STRIPE_VERSION = "2024-06-20";
const MAIL_AGENCE = Deno.env.get("MAIL_AGENCE") ?? "contact@atomes.studio";
const MAIL_FROM = Deno.env.get("MAIL_FROM") ?? "Atomes studio <contact@atomes.studio>";
const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://atomes.studio").replace(/\/$/, "");
const ORIGINES = (Deno.env.get("ORIGINES_AUTORISEES") ??
  `${SITE_URL},https://www.atomes.studio,http://localhost:3000`).split(",").map((s) => s.trim());
const ESPACE_CLIENT = `${SITE_URL}/dossier/`;
const ESPACE_AGENCE = `${SITE_URL}/admin/`;

type Etape = { cle: string; ordre: number; libelle: string; statut: string; optionnelle: boolean; action: string | null; fait_le: string | null };
type Question = { id: number; question: string; choix: string[] | null; reponse: string | null; commentaire: string | null; repondue_le: string | null };
type Projet = {
  id: string; client_id: string | null; prenom: string; nom: string; email: string; type: string; commune: string;
  etape: string; suivi_administratif: boolean;
  devis_chemin: string | null; devis_empreinte: string | null; montant_cents: number | null; montant_libelle: string | null;
  signe_le: string | null; signe_empreinte: string | null;
  paye_le: string | null; paiement_ref: string | null; paiement_session: string | null;
  etapes: Etape[]; questions: Question[];
};
// deno-lint-ignore no-explicit-any
type Session = any;   // objet Stripe (Checkout Session) : id, url, status, payment_status, amount_total, metadata, expires_at, payment_intent
// deno-lint-ignore no-explicit-any
type Sb = any;
type Contexte = { sb: Sb; projet: Projet; corps: Record<string, unknown>; req: Request; base: string };
type Action = (c: Contexte) => Promise<Record<string, unknown>>;

// Refus attendu (saisie invalide, mauvaise étape…) : message lisible renvoyé au navigateur.
class Refus extends Error {
  statut: number;
  constructor(message: string, statut = 400) { super(message); this.statut = statut; }
}

Deno.serve(async (req) => {
  const origine = req.headers.get("origin") ?? "";
  const cors = corsHeaders(origine);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, erreur: "Méthode non autorisée" }, 405, cors);
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  // Stripe : confirmation de paiement (pas de jeton Supabase, requête signée par Stripe).
  const signature = req.headers.get("stripe-signature");
  if (signature) return webhookStripe(sb, req, signature);

  try {
    let corps: Record<string, unknown>;
    try { corps = await req.json(); } catch { throw new Refus("Requête illisible"); }
    const action = String(corps.action ?? "");
    const jeton = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!jeton) throw new Refus("Session expirée : reconnectez-vous", 401);
    const { data: auth, error: errAuth } = await sb.auth.getUser(jeton);
    const user = auth?.user;
    if (errAuth || !user) throw new Refus("Session expirée : reconnectez-vous", 401);
    const estClient = Object.hasOwn(ACTIONS_CLIENT, action), estAgence = Object.hasOwn(ACTIONS_AGENCE, action);
    if (!estClient && !estAgence) throw new Refus("Action inconnue");
    if (estAgence && !(await estAdmin(sb, user.id))) throw new Refus("Action réservée à l'agence", 403);
    const projet = await chargerProjet(sb, String(corps.projet ?? ""));
    if (!projet) throw new Refus("Dossier introuvable", 404);
    if (estClient && projet.client_id !== user.id) {
      // Compte agence ouvert sur l'espace client (même navigateur) : message explicite. Autre compte : même
      // réponse que pour un dossier inexistant (l'existence des numéros de dossier n'est pas révélée).
      if (await estAdmin(sb, user.id)) {
        throw new Refus("Action réservée au client du dossier : connectez-vous avec son adresse e-mail, dans une fenêtre privée ou sur un autre appareil.", 403);
      }
      throw new Refus("Dossier introuvable", 404);
    }
    const c: Contexte = { sb, projet, corps, req, base: ORIGINES.includes(origine) ? origine : SITE_URL };
    return json({ ok: true, ...(await (estClient ? ACTIONS_CLIENT : ACTIONS_AGENCE)[action](c)) }, 200, cors);
  } catch (e) {
    if (e instanceof Refus) return json({ ok: false, erreur: e.message }, e.statut, cors);
    console.error("espace", e);
    return json({ ok: false, erreur: "Erreur du serveur, réessayez dans quelques minutes" }, 500, cors);
  }
});

// ---------- Actions du client ------------------------------------------------

const ACTIONS_CLIENT: Record<string, Action> = {
  // Réponses aux questions de l'agence (une réponse parmi les choix proposés, ou libre ; commentaire facultatif).
  async repondre({ sb, projet, corps }) {
    const reponses = Array.isArray(corps.reponses) ? corps.reponses : [];
    const enAttente = projet.questions.filter((q) => !q.repondue_le);
    const faites: Question[] = [];
    for (const r of reponses as Record<string, unknown>[]) {
      const q = enAttente.find((x) => x.id === Number(r?.id));
      if (!q || faites.some((f) => f.id === q.id)) continue;
      const reponse = propre(String(r?.reponse ?? ""), 5000);
      const commentaire = propre(String(r?.commentaire ?? ""), 5000);
      if (q.choix?.length) {
        if (!q.choix.includes(reponse)) throw new Refus("Choisissez une des réponses proposées");
      } else if (!reponse) continue;
      const { data, error } = await sb.from("questions")
        .update({ reponse, commentaire: commentaire || null, repondue_le: new Date().toISOString() })
        .eq("id", q.id).is("repondue_le", null).select("id");
      if (error) throw error;
      if (data?.length) faites.push({ ...q, reponse, commentaire });
    }
    if (!faites.length) throw new Refus("Aucune réponse à enregistrer");
    await mailAgence(projet, `Réponses du client — dossier ${projet.id} (${projet.nom})`, "Réponses du client", [
      p(`${esc(projet.prenom)} ${esc(projet.nom)} a répondu à vos questions.`),
      tableau(faites.map((q) => [q.question, q.reponse + (q.commentaire ? `\n${q.commentaire}` : "")] as [string, string]), true),
    ].join(""));
    return { repondues: faites.length };
  },

  // Signature électronique simple : case « Bon pour accord », nom saisi, date, adresse IP, navigateur et
  // empreinte SHA-256 du PDF signé. Elle porte sur la version et le montant affichés au client (corps.empreinte,
  // corps.montant) : un devis remplacé depuis l'affichage, ou pendant l'envoi, est refusé (409, page relue).
  async signer({ sb, projet, corps, req }) {
    if (projet.signe_le && String(corps.empreinte ?? "") === projet.signe_empreinte) return { deja: true };   // double envoi
    exigerAction(projet, "signer");
    if (!projet.devis_chemin || !projet.devis_empreinte) throw new Refus("Le devis n'est pas encore disponible");
    if (corps.accepte !== true) throw new Refus("Cochez « Bon pour accord » pour signer le devis");
    const nom = propre(String(corps.nom ?? ""), 120);
    if (nom.length < 3) throw new Refus("Saisissez votre nom et votre prénom");
    if (String(corps.empreinte ?? "") !== projet.devis_empreinte || Number(corps.montant ?? 0) !== Number(projet.montant_cents ?? 0)) {
      throw new Refus(DEVIS_CHANGE, 409);
    }
    const empreinte = await empreinteFichier(sb, projet.devis_chemin);
    if (empreinte !== projet.devis_empreinte) throw new Refus(DEVIS_CHANGE, 409);
    const le = new Date();
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
    const navigateur = propre(req.headers.get("user-agent") ?? "", 300) || null;
    const suivante = etapeSuivante(projet);
    // Écriture conditionnelle : même étape, même version et même montant qu'à la lecture, pas encore signé.
    const { data, error } = await sb.from("projets").update({
      signe_le: le.toISOString(), signe_nom: nom, signe_ip: ip, signe_agent: navigateur, signe_empreinte: empreinte, etape: suivante,
    }).eq("id", projet.id).eq("etape", projet.etape).is("signe_le", null)
      .eq("devis_empreinte", empreinte).eq("montant_cents", projet.montant_cents).select("id");
    if (error) throw refusSql(error);
    if (!data?.length) {
      // Rien d'écrit : double envoi (déjà signé, même version) ou dossier modifié entre-temps par l'agence.
      const relu = await chargerProjet(sb, projet.id);
      if (relu?.signe_le && relu.signe_empreinte === empreinte && relu.devis_empreinte === empreinte && relu.montant_cents === projet.montant_cents) {
        return { deja: true };
      }
      const change = !relu || relu.devis_empreinte !== empreinte || relu.montant_cents !== projet.montant_cents;
      throw new Refus(change ? DEVIS_CHANGE : "Le dossier a changé entre-temps : vérifiez-le avant de signer", 409);
    }
    const fichier = projet.devis_chemin.split("/").pop() ?? "";
    const preuve: [string, string][] = [["Signé le", dateParis(le)], ["Par", nom], ["Document", fichier], ["Empreinte SHA-256", empreinte]];
    await mailClient(projet, `Devis signé — dossier ${projet.id}`, "Devis signé", [
      `<h1 style="${H1}">Merci ${esc(projet.prenom)}, votre devis est signé.</h1>`,
      tableau(preuve),
      p("Prochaine étape&nbsp;: le paiement par carte bancaire, depuis votre espace client."),
      tableau([["À régler", montantTexte(projet)]]),
      bouton("Payer en ligne", ESPACE_CLIENT),
    ].join(""));
    await mailAgence(projet, `Devis signé — dossier ${projet.id} (${projet.nom})`, "Devis signé", [
      p(`${esc(projet.prenom)} ${esc(projet.nom)} a signé le devis en ligne («&nbsp;Bon pour accord&nbsp;»).`),
      tableau([...preuve, ["Adresse IP", ip ?? ""], ["Navigateur", navigateur ?? ""], ["Montant à payer", montantTexte(projet)]]),
    ].join(""));
    return { etape: suivante };
  },

  // Paiement par carte : une seule session Stripe Checkout ouverte par dossier (valable 1 h), réutilisée si le
  // client clique de nouveau ; expirée et remplacée si elle ne correspond plus au devis. Retour sur l'espace client.
  async payer({ sb, projet, base }) {
    if (projet.paye_le) return { deja: true };
    exigerAction(projet, "payer");
    if (!projet.montant_cents) throw new Refus("Le montant n'est pas encore défini");
    if (projet.signe_le && projet.signe_empreinte !== projet.devis_empreinte) {
      throw new Refus("Le devis a été mis à jour : rechargez la page et signez la dernière version", 409);
    }
    if (!STRIPE_KEY) throw new Refus("Le paiement en ligne n'est pas encore activé : nous revenons vers vous.", 503);
    if (projet.paiement_session) {
      const s = await stripe(`checkout/sessions/${projet.paiement_session}`, undefined, "GET", true);
      if (s?.payment_status === "paid" && s.metadata?.projet === projet.id) {
        // Déjà payé (retour sur le site manqué, webhook pas encore reçu) : paiement enregistré, aucune nouvelle session.
        const r = await marquerPaye(sb, projet, String(s.payment_intent ?? s.id), Number(s.amount_total ?? 0), s.metadata?.empreinte ?? null);
        if (r === "anomalie") throw new Refus("Un paiement a déjà été reçu pour une version précédente du devis : nous revenons vers vous.", 409);
        return { deja: true };
      }
      if (s?.status === "open") {
        if (s.url && Number(s.amount_total) === projet.montant_cents && s.metadata?.empreinte === projet.devis_empreinte &&
          Number(s.expires_at ?? 0) - Date.now() / 1000 > 600) return { url: s.url };
        await stripe(`checkout/sessions/${s.id}/expire`, {});   // échec (payée entre-temps) : refus, pas de 2e session
      }
    }
    const session = await stripe("checkout/sessions", {
      "mode": "payment",
      "payment_method_types[0]": "card",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "eur",
      "line_items[0][price_data][unit_amount]": String(projet.montant_cents),
      "line_items[0][price_data][product_data][name]": `${projet.montant_libelle || "Montant du devis"} — dossier ${projet.id}`,
      "line_items[0][price_data][product_data][description]": `${projet.type} · ${projet.commune}`,
      "customer_email": projet.email,
      "client_reference_id": projet.id,
      "metadata[projet]": projet.id,
      "metadata[empreinte]": projet.devis_empreinte ?? "",
      "payment_intent_data[metadata][projet]": projet.id,
      "payment_intent_data[description]": `Atomes studio — dossier ${projet.id}`,
      "locale": "fr",
      "expires_at": String(Math.floor(Date.now() / 1000) + 3600),
      "success_url": `${base}/dossier/?paiement=ok&session={CHECKOUT_SESSION_ID}#${projet.id}`,
      "cancel_url": `${base}/dossier/?paiement=annule#${projet.id}`,
    });
    await majProjet(sb, projet.id, { paiement_session: session.id });
    return { url: session.url };
  },

  // Retour de Stripe : vérification de la session (le webhook fait foi, ceci accélère l'affichage).
  // Paiement qui ne correspond plus au devis en cours : { verification: true } (l'agence est alertée par le webhook).
  async paiement({ sb, projet, corps }) {
    if (projet.paye_le) return { paye: true };
    const id = String(corps.session ?? "");
    if (!/^cs_[A-Za-z0-9_]+$/.test(id) || !STRIPE_KEY) return { paye: false };
    const s = await stripe(`checkout/sessions/${id}`, undefined, "GET", true);
    if (!s || s.metadata?.projet !== projet.id || s.payment_status !== "paid") return { paye: false };
    const r = await marquerPaye(sb, projet, String(s.payment_intent ?? s.id), Number(s.amount_total ?? 0), s.metadata?.empreinte ?? null);
    return r === "anomalie" ? { paye: false, verification: true } : { paye: true };
  },

  // Documents validés : étape suivante (dépôt avec l'option de suivi, sinon dossier clos).
  async valider({ sb, projet }) {
    exigerAction(projet, "valider");
    const suivante = etapeSuivante(projet);
    await majProjet(sb, projet.id, { documents_valides_le: new Date().toISOString(), etape: suivante });
    await mailAgence(projet, `Documents validés — dossier ${projet.id} (${projet.nom})`, "Documents validés",
      p(`${esc(projet.prenom)} ${esc(projet.nom)} a validé ses documents. ${suivante === "depot" ? "Option de suivi administratif : le dossier passe au dépôt." : "Le dossier est clos."}`));
    if (suivante === "clos") await mailClient(projet, `Dossier clos — dossier ${projet.id}`, "Dossier clos", [
      `<h1 style="${H1}">Merci ${esc(projet.prenom)}, vos documents sont validés.</h1>`,
      p("Votre dossier est clos. Vos documents restent disponibles dans votre espace client. Merci de votre confiance."),
      bouton("Ouvrir mon espace client", ESPACE_CLIENT),
    ].join(""));
    else await mailClient(projet, `Documents validés — dossier ${projet.id}`, "Documents validés", [
      `<h1 style="${H1}">Merci ${esc(projet.prenom)}, vos documents sont validés.</h1>`,
      p("Nous préparons le dépôt de votre démarche administrative et vous tenons informé de son avancement."),
      bouton("Suivre mon dossier", ESPACE_CLIENT),
    ].join(""));
    return { etape: suivante };
  },

  // Demande de modification : message enregistré, retour à l'étape « Production de vos documents ».
  async modifier({ sb, projet, corps }) {
    exigerAction(projet, "valider");
    const message = propre(String(corps.message ?? ""), 5000);
    if (message.length < 5) throw new Refus("Décrivez la modification souhaitée");
    const precedente = etapePrecedente(projet);
    const { error } = await sb.from("modifications").insert({ projet_id: projet.id, message });
    if (error) throw error;
    await majProjet(sb, projet.id, { etape: precedente });
    await mailAgence(projet, `Modification demandée — dossier ${projet.id} (${projet.nom})`, "Modification demandée", [
      p(`${esc(projet.prenom)} ${esc(projet.nom)} demande une modification de ses documents. Le dossier revient à l'étape « Production de vos documents ».`),
      tableau([["Message", message]]),
    ].join(""));
    return { etape: precedente };
  },
};

// ---------- Actions de l'agence ----------------------------------------------

const ACTIONS_AGENCE: Record<string, Action> = {
  // Questions au client (réponse libre, ou à choisir parmi au moins deux propositions) : un seul e-mail.
  async questions({ sb, projet, corps }) {
    const liste = (Array.isArray(corps.questions) ? corps.questions : []) as Record<string, unknown>[];
    const lignes = liste.map((x) => ({
      question: propre(String(x?.question ?? ""), 2000),
      choix: (Array.isArray(x?.choix) ? x.choix : []).map((c: unknown) => propre(String(c), 200)).filter(Boolean).slice(0, 10),
    })).filter((x) => x.question.length >= 2);
    if (!lignes.length) throw new Refus("Saisissez au moins une question");
    if (lignes.some((x) => x.choix.length === 1)) throw new Refus("Proposez au moins deux réponses, ou aucune pour une réponse libre");
    const { error } = await sb.from("questions").insert(lignes.map((x) => ({ projet_id: projet.id, question: x.question, choix: x.choix.length ? x.choix : null })));
    if (error) throw error;
    const plusieurs = lignes.length > 1;
    await mailClient(projet, `${plusieurs ? "Quelques questions" : "Une question"} sur votre dossier ${projet.id}`, plusieurs ? "Nos questions" : "Notre question", [
      `<h1 style="${H1}">Bonjour ${esc(projet.prenom)},</h1>`,
      p(`Pour affiner votre demande, nous avons ${plusieurs ? "quelques questions" : "une question"}&nbsp;:`),
      `<ul style="margin:0 0 18px;padding-left:18px;font-size:15px;line-height:24px">${lignes.map((x) =>
        `<li style="margin:0 0 8px">${esc(x.question)}${x.choix.length ? `<br><span style="color:#7a7368">${esc(x.choix.join(" · "))}</span>` : ""}</li>`).join("")}</ul>`,
      p("Répondez directement dans votre espace client."),
      bouton("Répondre à nos questions", ESPACE_CLIENT),
    ].join(""));
    return { posees: lignes.length };
  },

  // Envoi du devis : PDF déposé dans <id>/agence/ (un fichier par version, jamais écrasé), montant à payer à la
  // signature ; empreinte calculée ici. Refusé une fois le dossier payé, même si le paiement arrive pendant l'envoi.
  async devis({ sb, projet, corps }) {
    if (projet.paye_le) throw new Refus(DEJA_PAYE, 409);
    const chemin = String(corps.chemin ?? "");
    if (!chemin.startsWith(`${projet.id}/agence/`) || !/\.pdf$/i.test(chemin) || chemin.includes("..") || chemin.split("/").length !== 3) {
      throw new Refus("Le devis doit être un PDF déposé dans les documents de l'agence");
    }
    const cents = montantCents(corps.montant);
    if (!cents) throw new Refus("Montant invalide");
    const libelle = propre(String(corps.libelle ?? ""), 120) || "Montant du devis";
    const empreinte = await empreinteFichier(sb, chemin);
    // Session de paiement de l'ancien devis expirée. Stripe injoignable : on continue (un paiement tardif de
    // l'ancien devis ne serait pas enregistré et l'agence serait alertée).
    let payee: Session = null;
    try { payee = await fermerSession(projet); } catch (e) { console.error("stripe : session non expirée", projet.id, e); }
    if (payee) throw new Refus("Le client vient de régler le devis en cours par carte : il ne peut plus être remplacé. Rechargez le dossier.", 409);
    const { data: fait, error } = await sb.from("projets").update({
      devis_chemin: chemin, devis_empreinte: empreinte, devis_envoye_le: new Date().toISOString(),
      montant_cents: cents, montant_libelle: libelle, paiement_session: null,
      signe_le: null, signe_nom: null, signe_ip: null, signe_agent: null, signe_empreinte: null,
      etape: "signature",
    }).eq("id", projet.id).is("paye_le", null).select("id");
    if (error) throw refusSql(error);
    if (!fait?.length) throw new Refus(DEJA_PAYE, 409);
    const maj: Projet = { ...projet, montant_cents: cents, montant_libelle: libelle };
    await mailClient(projet, `Votre devis est prêt — dossier ${projet.id}`, "Votre devis", [
      `<h1 style="${H1}">Bonjour ${esc(projet.prenom)}, votre devis est prêt.</h1>`,
      p("Lisez-le dans votre espace client, puis signez-le en ligne. Le paiement par carte bancaire se fait ensuite depuis votre espace."),
      tableau([["À régler à la signature", montantTexte(maj)]]),
      bouton("Lire et signer mon devis", ESPACE_CLIENT),
    ].join(""));
    return { etape: "signature", empreinte };
  },

  // Changement d'étape ; e-mail au client quand le dossier avance vers une étape qui l'attend ou le concerne.
  async etape({ sb, projet, corps }) {
    const cle = String(corps.cle ?? "");
    const cible = projet.etapes.find((e) => e.cle === cle);
    if (!cible) throw new Refus("Étape inconnue");
    if (cible.optionnelle && !projet.suivi_administratif) throw new Refus("Activez d'abord le suivi administratif");
    if (cle === "signature" && !projet.devis_chemin) throw new Refus("Envoyez d'abord le devis (PDF et montant)");
    if (cle === "paiement" && !projet.montant_cents) throw new Refus("Envoyez d'abord le devis (PDF et montant)");
    if (cle === projet.etape) return { etape: cle };
    const avance = cible.ordre > ordreCourant(projet);
    await majProjet(sb, projet.id, { etape: cle });
    const mail = avance ? MAILS_ETAPE[cle] : undefined;
    if (mail) await mailClient(projet, `${mail.sujet} — dossier ${projet.id}`, mail.sujet, [
      `<h1 style="${H1}">Bonjour ${esc(projet.prenom)},</h1>`, p(mail.texte), bouton(mail.bouton, ESPACE_CLIENT),
    ].join(""));
    return { etape: cle, mail: !!mail };
  },

  // Option de suivi administratif (étapes 8 à 10). Activée sur un dossier qui a dépassé le dépôt sans y passer
  // (dossier clos, par exemple) : le dossier est rouvert au dépôt. Désactivation refusée par la base si le dossier
  // est sur l'une de ces étapes ; leurs dates sont conservées si l'option est retirée puis rétablie.
  async option({ sb, projet, corps }) {
    const suivi = corps.suivi === true;
    const o = ordreCourant(projet);
    const rouvrir = suivi && !projet.suivi_administratif && projet.etapes.some((e) => e.optionnelle && e.ordre < o && !e.fait_le);
    const depot = projet.etapes.find((e) => e.optionnelle)?.cle ?? "depot";
    await majProjet(sb, projet.id, rouvrir ? { suivi_administratif: true, etape: depot } : { suivi_administratif: suivi });
    return { suivi, etape: rouvrir ? depot : projet.etape };
  },

  // Paiement reçu hors du site (exception) : même effet qu'un paiement par carte. Si le client vient de régler
  // le devis en cours par carte (webhook pas encore reçu), c'est ce paiement qui est enregistré ; une session
  // encore ouverte est expirée.
  async paye({ sb, projet }) {
    if (projet.paye_le) return { deja: true };
    if (!projet.montant_cents) throw new Refus("Montant non défini");
    let carte: Session = null;
    try { carte = await fermerSession(projet); } catch (e) { console.error("stripe : session non vérifiée", projet.id, e); }
    const r = carte
      ? await marquerPaye(sb, projet, String(carte.payment_intent ?? carte.id), Number(carte.amount_total ?? 0), carte.metadata?.empreinte ?? null)
      : await marquerPaye(sb, projet, "manuel", projet.montant_cents, projet.devis_empreinte);
    return r === "paye" ? { paye: true, carte: !!carte } : { deja: true };
  },
};

const DEVIS_CHANGE = "Le devis a été mis à jour : lisez la nouvelle version avant de la signer";
const DEJA_PAYE = "Ce dossier est déjà payé : le devis ne peut plus être remplacé";

const MAILS_ETAPE: Record<string, { sujet: string; texte: string; bouton: string }> = {
  validation: { sujet: "Vos documents sont prêts", texte: "Vos documents sont disponibles dans votre espace client. Vérifiez-les, puis validez-les ou demandez une modification.", bouton: "Voir mes documents" },
  instruction: { sujet: "Votre dossier est déposé", texte: "Votre démarche administrative est déposée. Nous suivons son instruction et vous tenons informé.", bouton: "Suivre mon dossier" },
  accordee: { sujet: "Démarche administrative validée", texte: "Bonne nouvelle&nbsp;: votre démarche administrative est validée. Les documents correspondants sont dans votre espace client.", bouton: "Ouvrir mon espace client" },
  clos: { sujet: "Dossier clos", texte: "Votre dossier est clos. Vos documents restent disponibles dans votre espace client. Merci de votre confiance.", bouton: "Ouvrir mon espace client" },
};

// ---------- Paiement Stripe --------------------------------------------------

async function webhookStripe(sb: Sb, req: Request, entete: string): Promise<Response> {
  const corps = await req.text();
  if (!STRIPE_WEBHOOK_SECRET || !(await signatureStripeValide(corps, entete))) {
    return new Response(JSON.stringify({ erreur: "signature invalide" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  try {
    const evt = JSON.parse(corps);
    // Deux formats de destination : « instantané » (snapshot : checkout.session.completed, session dans data.object)
    // et « léger » (thin : v1.checkout.session.completed, session à relire chez Stripe).
    const type = String(evt.type ?? "").replace(/^v1\./, "");
    let traite = false;
    if (type === "checkout.session.completed" || type === "checkout.session.async_payment_succeeded") {
      let s: Session = evt.data?.object ?? null;
      const lie = evt.related_object;
      if (!s && lie?.type === "checkout.session" && /^cs_[A-Za-z0-9_]+$/.test(String(lie.id ?? ""))) {
        s = await stripe(`checkout/sessions/${lie.id}`, undefined, "GET");   // erreur → 500 : Stripe réessaiera
      }
      s = s ?? {};
      const projet = s.payment_status === "paid" && s.metadata?.projet ? await chargerProjet(sb, String(s.metadata.projet)) : null;
      if (projet) {
        await marquerPaye(sb, projet, String(s.payment_intent ?? s.id), Number(s.amount_total ?? 0), s.metadata?.empreinte ?? null, true);
        traite = true;
      }
    } else console.warn("webhook stripe : événement ignoré", String(evt.type ?? ""));
    return new Response(JSON.stringify({ recu: true, type: String(evt.type ?? ""), traite }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("webhook stripe", e);   // 500 : Stripe renverra l'événement plus tard
    return new Response(JSON.stringify({ erreur: "traitement impossible" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}

// En-tête « t=<horodatage>,v1=<signature>[,v1=…] » : HMAC-SHA256 de « <t>.<corps> » avec le secret du webhook.
async function signatureStripeValide(corps: string, entete: string): Promise<boolean> {
  const morceaux = entete.split(",").map((x) => x.trim().split("="));
  const t = morceaux.find(([k]) => k === "t")?.[1] ?? "";
  const v1 = morceaux.filter(([k]) => k === "v1").map(([, v]) => v ?? "");
  if (!/^\d+$/.test(t) || !v1.length || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const cle = await crypto.subtle.importKey("raw", new TextEncoder().encode(STRIPE_WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const attendu = hex(new Uint8Array(await crypto.subtle.sign("HMAC", cle, new TextEncoder().encode(`${t}.${corps}`))));
  return v1.some((v) => egalConstant(v, attendu));
}

// Enregistre un paiement : paye_le, paiement_ref et passage en production en une seule écriture (après une erreur,
// la nouvelle tentative de Stripe rattrape tout). Idempotent : un seul enregistrement et un seul jeu d'e-mails, même
// si Stripe et le retour du client arrivent ensemble. Rien n'est enregistré pour un paiement par carte qui ne
// correspond pas au devis en cours (montant ou version), ni pour un second paiement : l'agence est alertée par
// e-mail quand `alerter` est vrai (webhook seulement, pour un seul envoi par paiement).
async function marquerPaye(sb: Sb, projet: Projet, ref: string, montantPaye: number, empreintePayee: string | null,
  alerter = false): Promise<"paye" | "deja" | "anomalie"> {
  const carte = ref !== "manuel";
  for (let essai = 0; essai < 3; essai++) {
    if (projet.paye_le) {
      if (carte && alerter && projet.paiement_ref !== ref) await alerteDoublon(projet, ref, montantPaye);
      return "deja";
    }
    if (carte && (montantPaye !== projet.montant_cents || (empreintePayee || null) !== (projet.devis_empreinte || null))) {
      if (alerter) await alerteEcart(projet, ref, montantPaye);
      return "anomalie";
    }
    const valeurs: Record<string, unknown> = { paye_le: new Date().toISOString(), paiement_ref: ref };
    if (projet.etape === "paiement") valeurs.etape = etapeSuivante(projet);
    const { data, error } = await sb.from("projets").update(valeurs)
      .eq("id", projet.id).eq("etape", projet.etape).is("paye_le", null).select("id");
    if (error) throw refusSql(error);
    if (data?.length) {
      const montant = euros(montantPaye);
      await mailClient(projet, `Paiement reçu — dossier ${projet.id}`, "Paiement reçu", [
        `<h1 style="${H1}">Merci ${esc(projet.prenom)}, votre paiement est bien reçu.</h1>`,
        p(`Nous avons reçu votre paiement de ${esc(montant)}. Nous lançons la production de vos documents et vous prévenons dès qu'ils sont prêts.`),
        bouton("Suivre mon dossier", ESPACE_CLIENT),
      ].join(""));
      await mailAgence(projet, `Paiement reçu — dossier ${projet.id} (${projet.nom}) : ${montant}`, "Paiement reçu", [
        p(`${esc(projet.prenom)} ${esc(projet.nom)} a payé ${esc(montant)}. Le dossier passe à la production des documents.`),
        tableau([["Montant", montant], ["Référence", ref === "manuel" ? "Paiement reçu hors du site (marqué par l'agence)" : ref]]),
      ].join(""));
      return "paye";
    }
    // Rien d'écrit : payé entre-temps, ou étape changée par l'agence. Nouvel essai sur l'état relu.
    const relu = await chargerProjet(sb, projet.id);
    if (!relu) return "deja";
    projet = relu;
  }
  throw new Error(`paiement du dossier ${projet.id} : enregistrement impossible (dossier modifié pendant l'écriture)`);
}

// Paiement par carte qui ne correspond pas au devis en cours (session d'un devis remplacé, autre montant).
async function alerteEcart(projet: Projet, ref: string, montantPaye: number): Promise<void> {
  const montant = euros(montantPaye);
  console.error("paiement à vérifier : ne correspond pas au devis en cours", projet.id, ref, montantPaye, projet.montant_cents);
  await mailAgence(projet, `Paiement à vérifier — dossier ${projet.id} (${projet.nom}) : ${montant}`, "Paiement à vérifier", [
    p(`Un paiement par carte de ${esc(montant)} a été reçu pour ce dossier, mais il ne correspond pas au devis en cours (montant ou version du devis différents)&nbsp;: il n'a pas été enregistré et le dossier n'a pas avancé.`),
    tableau([["Montant payé", montant], ["Référence Stripe", ref], ["Devis en cours", projet.montant_cents ? montantTexte(projet) : "Aucun"]]),
    p("Remboursez ce paiement depuis le tableau de bord Stripe ou, s'il convient, enregistrez-le avec « Marquer comme payé » dans l'espace agence."),
  ].join(""));
}

// Paiement par carte reçu pour un dossier déjà payé, avec une autre référence.
async function alerteDoublon(projet: Projet, ref: string, montantPaye: number): Promise<void> {
  const montant = euros(montantPaye);
  console.error("paiement en double", projet.id, ref, projet.paiement_ref);
  if (!projet.paiement_ref || projet.paiement_ref === "manuel") {
    await mailAgence(projet, `Paiement à vérifier — dossier ${projet.id} (${projet.nom}) : ${montant}`, "Paiement à vérifier", [
      p(`Un paiement par carte de ${esc(montant)} a été reçu pour ce dossier, déjà marqué payé hors du site. S'il s'agit du même règlement, il n'y a rien à faire&nbsp;; sinon, remboursez-le depuis le tableau de bord Stripe.`),
      tableau([["Montant payé", montant], ["Référence Stripe", ref]]),
    ].join(""));
  } else {
    await mailAgence(projet, `Paiement en double — dossier ${projet.id} (${projet.nom}) : ${montant}`, "Paiement en double", [
      p(`Ce dossier a été payé une seconde fois par carte (${esc(montant)}). Remboursez ce second paiement depuis le tableau de bord Stripe.`),
      tableau([["Second paiement", ref], ["Paiement enregistré", projet.paiement_ref]]),
    ].join(""));
  }
}

// Session de paiement mémorisée, avant un nouveau devis ou un paiement hors du site : expirée si elle est encore
// ouverte. Renvoie la session si elle est déjà payée pour le devis en cours (paiement par carte à ne pas perdre).
async function fermerSession(projet: Projet): Promise<Session> {
  if (!projet.paiement_session || !STRIPE_KEY) return null;
  const s = await stripe(`checkout/sessions/${projet.paiement_session}`, undefined, "GET", true);
  if (!s) return null;
  if (s.status === "open") {
    await stripe(`checkout/sessions/${s.id}/expire`, {});
    return null;
  }
  const conforme = s.payment_status === "paid" && s.metadata?.projet === projet.id && Number(s.amount_total) === projet.montant_cents &&
    (s.metadata?.empreinte ?? null) === (projet.devis_empreinte ?? null);
  return conforme ? s : null;
}

// API Stripe, version épinglée (le comportement ne dépend pas de la version par défaut du compte).
// `absentNul` : une ressource introuvable (404) renvoie null au lieu d'un refus.
async function stripe(chemin: string, params?: Record<string, string>, methode = "POST", absentNul = false): Promise<Session> {
  const r = await fetch(`https://api.stripe.com/v1/${chemin}`, {
    method: methode,
    headers: { "Authorization": `Bearer ${STRIPE_KEY}`, "Content-Type": "application/x-www-form-urlencoded", "Stripe-Version": STRIPE_VERSION },
    body: params ? new URLSearchParams(params).toString() : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 404 && absentNul) return null;
  if (!r.ok) {
    console.error("stripe", r.status, j?.error?.message);
    throw new Refus("Le paiement en ligne est momentanément indisponible. Réessayez dans quelques minutes.", 502);
  }
  return j;
}

// ---------- Outils -----------------------------------------------------------

async function chargerProjet(sb: Sb, id: string): Promise<Projet | null> {
  if (!/^[0-9]{12}$/.test(id)) return null;
  const { data, error } = await sb.from("projets").select("*, etapes(*), questions(*)").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  data.etapes = (data.etapes ?? []).sort((a: Etape, b: Etape) => a.ordre - b.ordre);
  data.questions = data.questions ?? [];
  return data as Projet;
}

async function estAdmin(sb: Sb, userId: string): Promise<boolean> {
  const { data, error } = await sb.from("admins").select("user_id").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return !!data;
}

// Mise à jour du dossier ; les refus du déclencheur (étape inconnue, suivi non activé) deviennent des messages lisibles.
async function majProjet(sb: Sb, id: string, valeurs: Record<string, unknown>): Promise<void> {
  const { error } = await sb.from("projets").update(valeurs).eq("id", id);
  if (error) throw refusSql(error);
}

function refusSql(error: { message?: string }): Error {
  const m = String(error?.message ?? "");
  return /suivi administratif|Étape inconnue/.test(m) ? new Refus(m.replace(/^.*?(L'étape|Étape)/, "$1"), 409) : new Error(m);
}

function ordreCourant(projet: Projet): number {
  return projet.etapes.find((e) => e.cle === projet.etape)?.ordre ?? 0;
}

// Étape suivante visible (les étapes optionnelles sont sautées sans l'option de suivi).
function etapeSuivante(projet: Projet): string {
  const o = ordreCourant(projet);
  const e = projet.etapes.find((x) => x.ordre > o && (!x.optionnelle || projet.suivi_administratif));
  if (!e) throw new Refus("Ce dossier est déjà à la dernière étape", 409);
  return e.cle;
}

function etapePrecedente(projet: Projet): string {
  const o = ordreCourant(projet);
  const e = projet.etapes.filter((x) => x.ordre < o && (!x.optionnelle || projet.suivi_administratif)).pop();
  if (!e) throw new Refus("Ce dossier est à la première étape", 409);
  return e.cle;
}

function exigerAction(projet: Projet, action: string): void {
  const e = projet.etapes.find((x) => x.cle === projet.etape);
  if (!e || e.action !== action) throw new Refus("Cette action n'est pas possible à cette étape du dossier", 409);
}

async function empreinteFichier(sb: Sb, chemin: string): Promise<string> {
  const { data, error } = await sb.storage.from("dossiers").download(chemin);
  if (error || !data) throw new Refus("Devis introuvable dans les documents de l'agence", 404);
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", await data.arrayBuffer())));
}

function hex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function egalConstant(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// « 480 », « 480,5 », « 1 200,00 », « 480.50 » → centimes ; entre 1 € et 100 000 €.
function montantCents(v: unknown): number | null {
  const s = String(v ?? "").replace(/[\s  €]/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const c = Math.round(Number(s) * 100);
  return c >= 100 && c <= 10_000_000 ? c : null;
}

function euros(cents: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);
}

function montantTexte(projet: Projet): string {
  return `${projet.montant_libelle || "Montant du devis"}\u00a0: ${euros(projet.montant_cents ?? 0)}`;
}

function dateParis(d: Date): string {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", dateStyle: "long", timeStyle: "short" }).format(d);
}

// Nettoyage d'une valeur texte : caractères de contrôle retirés (sauf retours à la ligne), longueur bornée.
function propre(v: string, max: number): string {
  return v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim().slice(0, max);
}

function corsHeaders(origine: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": ORIGINES.includes(origine) ? origine : ORIGINES[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(corps: unknown, statut: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(corps), { status: statut, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
}

// ---------- E-mails (même gabarit et même signature que la fonction « demande ») ----------

async function envoyerMail(m: { to: string; subject: string; html: string; replyTo?: string }): Promise<boolean> {
  if (!RESEND_KEY) { console.warn("RESEND_API_KEY absent : e-mail non envoyé", m.subject); return false; }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: MAIL_FROM, to: [m.to], subject: m.subject.replace(/\s+/g, " ").trim(), html: m.html, reply_to: m.replyTo }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) console.error("resend", r.status, await r.text());
    return r.ok;
  } catch (e) {
    console.error("resend", e);
    return false;
  }
}

// Un e-mail qui échoue ne fait jamais échouer l'action (déjà enregistrée) : il est seulement journalisé.
const mailClient = (projet: Projet, sujet: string, titre: string, corps: string) =>
  envoyerMail({ to: projet.email, replyTo: MAIL_AGENCE, subject: sujet, html: gabarit(titre, corps) });
const mailAgence = (projet: Projet, sujet: string, titre: string, corps: string) =>
  envoyerMail({ to: MAIL_AGENCE, replyTo: projet.email, subject: sujet, html: gabarit(`${titre} — dossier ${projet.id}`, corps + p(`<a href="${ESPACE_AGENCE}#${projet.id}" style="color:#171512">Ouvrir le dossier dans l'espace agence</a>`)) });

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const KICKER = "font-size:11px;line-height:16px;letter-spacing:2px;text-transform:uppercase;color:#8d8d8d";
const H1 = "margin:0 0 18px;font-size:22px;line-height:28px;font-weight:bold";
const LOGO_URL = `${SITE_URL}/images/logo-signature.gif`;

const SIGNATURE = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:Helvetica,Arial,sans-serif;color:#141414">
<tr>
<td style="padding:0 16px 0 0;vertical-align:middle;font-size:0;line-height:0"><a href="${SITE_URL}" style="text-decoration:none"><img src="${LOGO_URL}" alt="atomes.studio" width="68" height="68" style="display:block;border:0;width:68px;height:68px"></a></td>
<td style="padding:0 0 0 16px;border-left:1px solid #d6d6d6;vertical-align:middle">
<div style="font-size:17px;line-height:20px"><a href="${SITE_URL}" style="text-decoration:none;color:#141414"><strong style="font-weight:bold">atomes</strong><span style="color:#8d8d8d">.studio</span></a></div>
<div style="font-size:8px;line-height:12px;letter-spacing:1.6px;color:#8d8d8d;padding-top:3px">ARCHITECTURE.&nbsp; CONSTRUCTION.&nbsp; R&Eacute;NOVATION.</div>
<div style="font-size:13px;line-height:18px;font-weight:bold;padding-top:10px">Simon Charles</div>
<div style="font-size:12px;line-height:18px;color:#3a3a3a"><a href="tel:+33607265820" style="color:#3a3a3a;text-decoration:none">06 07 26 58 20</a><span style="color:#c4c4c4">&nbsp;&nbsp;|&nbsp;&nbsp;</span><a href="mailto:contact@atomes.studio" style="color:#3a3a3a;text-decoration:none">contact@atomes.studio</a></div>
<div style="font-size:12px;line-height:18px;color:#7a7a7a">31 rue Chevalier Paul, 83000 Toulon</div>
</td>
</tr>
</table>`;

function gabarit(titre: string, corps: string): string {
  return `<!doctype html><html lang="fr"><body style="margin:0;padding:32px 16px;background:#f4f2ee;font-family:Helvetica,Arial,sans-serif;color:#141414">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e3ded4">
<tr><td style="padding:36px 40px">
<div style="${KICKER};margin-bottom:14px">${esc(titre)}</div>
${corps}
<div style="margin-top:36px;padding-top:24px;border-top:1px solid #e3ded4">${SIGNATURE}</div>
</td></tr>
</table>
</td></tr></table></body></html>`;
}

const p = (s: string) => `<p style="margin:0 0 14px;font-size:15px;line-height:24px">${s}</p>`;
const bouton = (texte: string, url: string) =>
  `<p style="margin:8px 0 26px"><a href="${url}" style="display:inline-block;background:#171512;color:#ffffff;text-decoration:none;font-size:12px;line-height:16px;letter-spacing:2px;text-transform:uppercase;padding:14px 24px">${esc(texte)}</a></p>`;

// Tableau libellé / valeur ; « question » : libellé en texte courant (questions longues) plutôt qu'en petites capitales.
function tableau(lignes: [string, string][], question = false): string {
  const tr = lignes.filter(([, v]) => v).map(([k, v]) =>
    `<tr><td style="padding:7px 12px 7px 0;${question ? "font-size:14px;line-height:21px;color:#5a5a5a;width:45%" : KICKER + ";white-space:nowrap"};vertical-align:top">${esc(k)}</td><td style="padding:7px 0;font-size:14px;line-height:21px;vertical-align:top;word-break:break-word">${esc(v).replace(/\n/g, "<br>")}</td></tr>`).join("");
  return `<table style="border-collapse:collapse;width:100%;margin:8px 0 18px">${tr}</table>`;
}
