// =============================================================================
// atomes.studio — fonction « espace » (Supabase Edge Function, Deno) — parcours v3 : tout par e-mail
// Les échanges avec le client passent par e-mail (chaque e-mail montre la timeline du dossier) ; l'espace
// client est en lecture seule.
//   Liens d'action (page site/action/, jeton signé reçu par e-mail, sans session) :
//             infos (lecture), signer (devis), valider (documents), renoncer (rétractation d'un particulier)
//   Client  : infos_espace (coordonnées de virement, lien de rétractation ; lecture seule, session Supabase)
//   Agence  : questions, devis (envoi du devis à signer), etape, option (suivi administratif),
//             paye (« Virement reçu »), rattacher et supprimer_message (messages à vérifier), renvoyer (confirmation
//             du contrat ou accusé de rétractation qui n'a pas pu partir)
//   Resend  : webhook email.received (réponse du client à l'ancienne adresse de réponse du dossier,
//             d<id>-…@REPONSES_DOMAINE, encore reçue pour les e-mails envoyés avant le moteur : texte et pièces
//             jointes ajoutés au dossier), requête signée (en-têtes svix-id, svix-timestamp, svix-signature)
//   Moteur  : le moteur de l'agence (dossier atomes-moteur, sur l'ordinateur de l'agence) lit contact@ et simon@
//             et ajoute au dossier les e-mails des clients (messages « imap:<Message-ID> ») ; « rattacher » un tel
//             message le marque à traiter, le moteur range ses pièces jointes à son passage suivant
// Les e-mails au client ont pour adresse de réponse MAIL_AGENCE (contact@) : le client écrit toujours à l'agence.
// Appel : POST JSON { action, projet, … } avec Authorization: Bearer <session Supabase>, ou { action, jeton, … }
// pour les liens d'action. « Verify JWT » est désactivé : la session ou le jeton sont vérifiés ici (Resend
// n'envoie ni l'un ni l'autre). Les transitions d'étapes passent par projets.etape : le déclencheur SQL
// recalcule la timeline (migration 0004) ; table messages, colonnes demarrage_anticipe_* et retracte_* :
// migration 0005.
//
// Secrets : RESEND_API_KEY, SB_SECRET_KEY, JETON_SECRET (au moins 32 caractères aléatoires), VIREMENT_IBAN,
// VIREMENT_BIC, VIREMENT_TITULAIRE ; RESEND_WEBHOOK_SECRET (whsec_… du
// webhook Resend) et REPONSES_DOMAINE (ex. r.atomes.studio), le temps de recevoir les réponses aux anciens
// e-mails ; facultatifs MAIL_AGENCE, MAIL_FROM, SITE_URL, ORIGINES_AUTORISEES (mêmes valeurs que pour la fonction
// « demande ») et RESEND_RECEPTION_KEY (clé du compte Resend qui reçoit les réponses, s'il est distinct de celui
// des envois : SETUP-ESPACE-CLIENT.md § 7).
// Sans JETON_SECRET : aucun lien d'action (refus 503). Sans REPONSES_DOMAINE : le webhook Resend n'ajoute plus rien.
// Les liens placés dans les e-mails mènent toujours à SITE_URL (jamais à l'origine de la requête, par exemple un
// essai depuis localhost) ; seuls les liens renvoyés à la page qui appelle suivent son origine (ORIGINES).
// =============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
// Lecture des e-mails reçus : clé du compte (ou de l'équipe) Resend réservé à la réception, pour que des e-mails reçus
// en nombre n'épuisent pas le quota des envois (devis, confirmations, liens de connexion) ; à défaut, la clé d'envoi.
const RESEND_RECEPTION_KEY = (Deno.env.get("RESEND_RECEPTION_KEY") ?? "").trim() || RESEND_KEY;
const JETON_SECRET = secretJetons(Deno.env.get("JETON_SECRET") ?? "");
const RESEND_WEBHOOK_SECRET = (Deno.env.get("RESEND_WEBHOOK_SECRET") ?? "").trim();
const REPONSES_DOMAINE = (Deno.env.get("REPONSES_DOMAINE") ?? "").trim().toLowerCase().replace(/^@/, "");
const VIREMENT = coordonneesVirement();
const MAIL_AGENCE = Deno.env.get("MAIL_AGENCE") ?? "contact@atomes.studio";
const MAIL_FROM = Deno.env.get("MAIL_FROM") ?? "Atomes studio <contact@atomes.studio>";
const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://atomes.studio").replace(/\/$/, "");
const ORIGINES = (Deno.env.get("ORIGINES_AUTORISEES") ??
  `${SITE_URL},https://www.atomes.studio,http://localhost:3000`).split(",").map((s) => s.trim());
const ESPACE_CLIENT = `${SITE_URL}/dossier/`;
const ESPACE_AGENCE = `${SITE_URL}/admin/`;

const DUREE_SIGNER = 30 * 86400;                  // validité des liens, en secondes
const DUREE_VALIDER = 90 * 86400;
const MAX_DEVIS_JOINT = 15 * 1024 * 1024;         // au-delà, le devis n'est pas joint à l'e-mail (lien seulement)
const MAX_PIECE = 25 * 1024 * 1024;               // pièces jointes reçues du client
const MAX_PIECES = 20;                            // par message
const MAX_PIECES_TOTAL = 100 * 1024 * 1024;       // par message
// E-mails reçus en nombre (chaque e-mail reçu compte dans le quota Resend) : au-delà de ces limites par dossier et
// par 24 h, l'e-mail n'est pas enregistré (il reste visible chez Resend, Emails → Receiving).
const MAX_MESSAGES_JOUR = 30;                     // messages vérifiés
const MAX_A_VERIFIER_JOUR = 20;                   // messages à vérifier
const MAX_VOLUME_DOSSIER = 200 * 1024 * 1024;     // pièces du client rangées dans <id>/client/, en tout
const MIN_IMAGE_INTEGREE = 20 * 1024;             // image intégrée au texte (logo, signature) : ignorée en dessous
const BAIL_TRAITEMENT = 10 * 60 * 1000;           // traitement d'un e-mail reçu en cours : relivraison refusée (503)
const MAX_BRUT = 200000;                          // texte ou HTML reçu : caractères analysés au plus
const MAX_LIGNE = 2000;                           // caractères d'une ligne examinés pour repérer une citation
// SHA-256 des logos des e-mails de l'agence (site/images/logo-signature.gif et .png, logo-mail.png) : une messagerie
// qui joint à la réponse les images de l'e-mail cité les renvoie telles quelles. À mettre à jour si le logo change.
const EMPREINTES_LOGOS = new Set([
  "df2fcfe8bf24c1c41fc98d7d4cf71235eb8a83b4e75564535f5da68bb6a19e62",
  "c57cba25a0b694dd30b3c868626217a48070886377c108b3b9b365184de4669e",
  "c6553a44f47afb29cb972687aa8f774a16f914d23249ec32a116a83771cb4df4",
]);
// Pièces jointes acceptées (extension → type enregistré), comme le formulaire de devis.
const TYPES_PIECES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
  heic: "image/heic", heif: "image/heif", pdf: "application/pdf",
};

// Textes juridiques (cahier des charges § 7), à reprendre mot pour mot ; renvoyés tels quels à la page d'action
// (source unique). À faire valider par l'Ordre des architectes.
const TEXTES = {
  case: "Je demande que la mission commence avant la fin du délai de rétractation de 14 jours. Je reconnais perdre ce droit une fois la mission entièrement exécutée, et devoir, si je me rétracte avant, le montant du travail déjà réalisé.",
  bouton: "Signer et commander avec obligation de paiement",
  retractation: "Vous disposez de 14 jours à compter de la signature pour renoncer au contrat, sans avoir à vous justifier : depuis le lien « Renoncer au contrat ici », avec le formulaire type ou par toute déclaration claire adressée à Atomes studio. Si vous renoncez, les sommes versées vous sont remboursées sous 14 jours, déduction faite du montant du travail déjà réalisé à votre demande.",
  formulaire: [
    "Formulaire de rétractation",
    "(Veuillez compléter et renvoyer le présent formulaire uniquement si vous souhaitez vous rétracter du contrat.)",
    "À l'attention d'Atomes studio, Simon Charles, 31 rue Chevalier Paul, 83000 Toulon, contact@atomes.studio :",
    "Je vous notifie par la présente ma rétractation du contrat portant sur la prestation de services ci-dessous :",
    "Dossier N° : …",
    "Devis signé le : …",
    "Nom du consommateur : …",
    "Adresse du consommateur : …",
    "Signature du consommateur (uniquement en cas de notification du présent formulaire sur papier) : …",
    "Date : …",
  ].join("\n"),
};
const CASE_COCHEE = "Vous avez demandé que la mission commence avant la fin du délai de rétractation.";

const LIEN_INVALIDE = "Lien invalide";
const LIEN_EXPIRE = "Ce lien a expiré : écrivez-nous à contact@atomes.studio pour en recevoir un nouveau";
const DELAI_EXPIRE = "Le délai de rétractation est expiré";
const DEVIS_CHANGE = "Le devis a été mis à jour : utilisez le lien du dernier e-mail reçu";
const DEJA_PAYE = "Ce dossier est déjà payé : le devis ne peut plus être remplacé";
const PAS_DE_CONTRAT = "Aucun devis signé n'est en cours sur ce dossier : il n'y a pas de contrat auquel renoncer.";
const CONTRAT_PRECEDENT = "Ce lien concerne un contrat précédent : utilisez le lien « Renoncer au contrat ici » du dernier e-mail reçu, ou écrivez-nous à contact@atomes.studio.";
const STOCKAGE_INDISPONIBLE = "Documents momentanément indisponibles : réessayez dans quelques minutes";

type Etape = {
  cle: string; ordre: number; libelle: string; statut: string; optionnelle: boolean; action: string | null;
  fait_le: string | null; debut_le: string | null;
};
type Question = { id: number; question: string; choix: string[] | null; reponse: string | null; posee_le: string; repondue_le: string | null };
type Projet = {
  id: string; client_id: string | null; profil: string; prenom: string; nom: string; email: string; type: string; commune: string;
  precisions: Record<string, string> | null; etape: string; suivi_administratif: boolean;
  devis_chemin: string | null; devis_empreinte: string | null; devis_envoye_le: string | null;
  montant_cents: number | null; montant_libelle: string | null;
  signe_le: string | null; signe_nom: string | null; signe_ip: string | null; signe_agent: string | null; signe_empreinte: string | null;
  demarrage_anticipe_le: string | null; demarrage_anticipe_texte: string | null;
  retracte_le: string | null; retracte_nom: string | null; retracte_email: string | null; retracte_ip: string | null; retracte_agent: string | null;
  paye_le: string | null; paiement_ref: string | null; documents_valides_le: string | null;
  envois_echoues: Echec[] | null;
  etapes: Etape[]; questions: Question[];
};
// E-mail légal au client qui n'a pas pu partir pendant une action par lien (confirmation du contrat, accusé de
// rétractation) : noté dans projets.envois_echoues, signalé dans l'espace agence avec un bouton « Renvoyer ».
type Echec = { quoi: "confirmation" | "retractation"; sujet: string; le: string };
// Pièce rangée dans <id>/client/ ; id_resend : identifiant de la pièce jointe chez Resend (une reprise du traitement ne
// la range pas une seconde fois).
type Piece = { nom: string; chemin: string; taille: number; id_resend?: string };
// Pièce jointe annoncée d'un message à vérifier : nom et taille seulement, rien n'est rangé (chemin nul).
type PieceAnnoncee = { nom: string; chemin: null; taille: number };
type Message = {
  id: number; projet_id: string; recu_le: string; expediteur: string; sujet: string | null; texte: string | null;
  texte_complet: string | null; pieces: (Piece | PieceAnnoncee)[]; verifie: boolean; etape: string | null; resend_id: string | null;
  traite?: boolean; traitement_le?: string | null;
};
type Charge = { a: string; p: string; e: number; d?: string };   // charge utile d'un jeton de lien d'action
type Doc = { nom: string; chemin: string; taille: number; date: string | null; url?: string };
type PieceJointe = { filename: string; content: string };      // pièce jointe d'un e-mail envoyé (base64)
// Bilan du traitement d'un message vérifié : pièces rangées (nouvelles : par cette tentative), écartées (format,
// taille, limite), ignorées (images intégrées : logo, signature, image de l'e-mail cité), questions répondues,
// demande de modification, pièces que Resend ne conserve plus.
type Bilan = {
  pieces: Piece[]; nouvelles: Piece[]; ecartees: string[]; ignorees: string[]; questions: number; modification: boolean; indisponibles: boolean;
};
// deno-lint-ignore no-explicit-any
type Sb = any;
// deno-lint-ignore no-explicit-any
type Json = any;
type Contexte = { sb: Sb; projet: Projet; corps: Record<string, unknown>; req: Request; base: string };
type ContexteLien = Contexte & { jeton: Charge };
type Action = (c: Contexte) => Promise<Record<string, unknown>>;
type ActionLien = (c: ContexteLien) => Promise<Record<string, unknown>>;

// Refus attendu (saisie invalide, mauvaise étape, lien expiré…) : message lisible renvoyé au navigateur.
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

  // Resend : e-mail reçu à l'adresse de réponse d'un dossier (requête signée, sans session ni jeton).
  if (["svix-id", "svix-timestamp", "svix-signature"].some((h) => req.headers.has(h))) return webhookResend(sb, req);

  try {
    let corps: Record<string, unknown>;
    try { corps = await req.json(); } catch { throw new Refus("Requête illisible"); }
    if (!corps || typeof corps !== "object" || Array.isArray(corps)) throw new Refus("Requête illisible");
    const action = String(corps.action ?? "");
    // Base des liens renvoyés à la page qui appelle (lien de rétractation affiché après la signature ou dans l'espace
    // client) : son origine si elle est autorisée, sinon le site. Les liens des e-mails mènent toujours à SITE_URL.
    const base = ORIGINES.includes(origine) ? origine : SITE_URL;

    // Lien d'action reçu par e-mail : le jeton signé tient lieu de session.
    if (Object.hasOwn(corps, "jeton")) return json({ ok: true, ...(await actionParLien(sb, action, corps, req, base)) }, 200, cors);

    const session = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!session) throw new Refus("Session expirée : reconnectez-vous", 401);
    const { data: auth, error: errAuth } = await sb.auth.getUser(session);
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
    const c: Contexte = { sb, projet, corps, req, base };
    return json({ ok: true, ...(await (estClient ? ACTIONS_CLIENT : ACTIONS_AGENCE)[action](c)) }, 200, cors);
  } catch (e) {
    if (e instanceof Refus) return json({ ok: false, erreur: e.message }, e.statut, cors);
    console.error("espace", e);
    return json({ ok: false, erreur: "Erreur du serveur, réessayez dans quelques minutes" }, 500, cors);
  }
});

// ---------- Actions par lien (page d'action, jeton reçu par e-mail) ----------------------------

async function actionParLien(sb: Sb, action: string, corps: Record<string, unknown>, req: Request, base: string): Promise<Record<string, unknown>> {
  if (!Object.hasOwn(ACTIONS_LIEN, action)) throw new Refus("Action inconnue");
  if (!JETON_SECRET) throw new Refus("Liens indisponibles", 503);
  const { charge, expire } = await lireJeton(String(corps.jeton ?? ""));
  if (action !== "infos" && charge.a !== action) throw new Refus(LIEN_INVALIDE);
  if (expire) {
    // Lien de rétractation périmé : message précis quand le délai du contrat en cours est lui aussi écoulé.
    if (charge.a === "renoncer") {
      const p = await chargerProjet(sb, charge.p);
      if (p?.signe_le && Date.now() > finRetractation(p.signe_le).getTime()) throw new Refus(DELAI_EXPIRE, 410);
    }
    throw new Refus(LIEN_EXPIRE, 410);
  }
  const projet = await chargerProjet(sb, charge.p);
  if (!projet) throw new Refus("Dossier introuvable", 404);
  return await ACTIONS_LIEN[action]({ sb, projet, corps, req, base, jeton: charge });
}

const ACTIONS_LIEN: Record<string, ActionLien> = {
  // Lecture pour la page d'action : dossier, timeline, puis selon le lien (mode) le devis à signer, les documents
  // à valider ou l'état de la rétractation. Aucune écriture.
  async infos({ sb, projet, jeton, base }) {
    const particulier = estParticulier(projet);
    const r: Record<string, unknown> = {
      mode: jeton.a,
      dossier: { id: projet.id, type: typeAffiche(projet), commune: projet.commune, prenom: projet.prenom, particulier, etape: projet.etape },
      timeline: timelinePublique(projet),
    };
    if (jeton.a === "signer") {
      if (!projet.devis_chemin || !projet.devis_empreinte || jeton.d !== projet.devis_empreinte.slice(0, 16)) throw new Refus(DEVIS_CHANGE, 409);
      // Lien signé du PDF : en cas de panne du stockage, la page est servie sans (« Document indisponible pour le
      // moment ») ; la signature vérifie de toute façon le fichier.
      const url = await urlSignee(sb, projet.devis_chemin).catch((e) => { console.error("lien du devis impossible", projet.id, e?.message ?? e); return null; });
      r.devis = {
        nom: projet.devis_chemin.split("/").pop() ?? "devis.pdf", url,
        empreinte: projet.devis_empreinte, montant_cents: projet.montant_cents, montant_libelle: projet.montant_libelle || "Montant du devis",
        envoye_le: projet.devis_envoye_le,
      };
      r.signe = projet.signe_le ? { le: projet.signe_le, nom: projet.signe_nom } : null;
      r.textes = TEXTES;
      r.renoncer = await lienRenoncer(projet, base);
    } else if (jeton.a === "valider") {
      r.documents = (await documentsAgence(sb, projet, true)).map(({ nom, url, taille, date }) => ({ nom, url, taille, date }));
      // Nouvelle demande de validation (dossier revenu à cette étape) : une validation précédente ne vaut plus.
      r.valide_le = projet.etape === "validation" ? null : projet.documents_valides_le;
    } else {
      if (!particulier) throw new Refus("La rétractation ne s'applique qu'aux contrats conclus par un particulier.", 409);
      if (!projet.signe_le) throw new Refus(PAS_DE_CONTRAT, 409);
      if (jeton.d !== await empreinteContrat(projet)) throw new Refus(CONTRAT_PRECEDENT, 409);
      r.signe_le = projet.signe_le;
      r.date_limite = dernierJourRetractation(projet.signe_le);
      r.retracte_le = projet.retracte_le;
      // Accusé de réception de la rétractation parti par e-mail (faux tant qu'il reste à renvoyer).
      if (projet.retracte_le) r.accuse_envoye = !echecs(projet).some((x) => x.quoi === "retractation");
      r.expire = Date.now() > finRetractation(projet.signe_le).getTime();
      r.textes = TEXTES;
    }
    return r;
  },

  // Signature électronique simple : nom saisi, date, adresse IP, navigateur et empreinte SHA-256 du PDF signé.
  // Elle porte sur la version et le montant affichés (corps.empreinte, corps.montant) et sur le devis du lien
  // (jeton.d) : un devis remplacé depuis est refusé (409). Particulier : case de démarrage anticipé obligatoire.
  async signer({ sb, projet, corps, req, base, jeton }) {
    if (projet.signe_le && String(corps.empreinte ?? "") === projet.signe_empreinte) {
      return { deja: true, renoncer: await lienRenoncer(projet, base) };   // double envoi
    }
    if (!projet.devis_empreinte || jeton.d !== projet.devis_empreinte.slice(0, 16)) throw new Refus(DEVIS_CHANGE, 409);
    if (projet.etape !== "signature") throw new Refus("Ce devis ne peut pas être signé à cette étape du dossier : écrivez-nous à contact@atomes.studio.", 409);
    if (!projet.devis_chemin) throw new Refus("Le devis n'est pas encore disponible", 409);
    if (corps.accepte !== true) throw new Refus(`Confirmez la signature avec le bouton « ${TEXTES.bouton} »`);
    const nom = propre(String(corps.nom ?? ""), 120);
    if (nom.length < 3) throw new Refus("Saisissez votre nom et votre prénom");
    if (String(corps.empreinte ?? "") !== projet.devis_empreinte || Number(corps.montant ?? 0) !== Number(projet.montant_cents ?? 0)) {
      throw new Refus(DEVIS_CHANGE, 409);
    }
    const particulier = estParticulier(projet);
    if (particulier && corps.demarrage !== true) throw new Refus("Cochez la case de démarrage de la mission pour signer");
    const { octets: pdf, empreinte } = await empreinteFichier(sb, projet.devis_chemin);
    if (empreinte !== projet.devis_empreinte) throw new Refus(DEVIS_CHANGE, 409);
    const le = new Date();
    const ip = ipClient(req);
    const navigateur = propre(req.headers.get("user-agent") ?? "", 300) || null;
    const suivante = etapeSuivante(projet);
    const valeurs = {
      signe_le: le.toISOString(), signe_nom: nom, signe_ip: ip, signe_agent: navigateur, signe_empreinte: empreinte,
      demarrage_anticipe_le: particulier ? le.toISOString() : null, demarrage_anticipe_texte: particulier ? TEXTES.case : null,
      etape: suivante,
    };
    // Écriture conditionnelle : à l'étape de signature, pas encore signé, même version et même montant qu'à la lecture.
    const { data, error } = await sb.from("projets").update(valeurs)
      .eq("id", projet.id).eq("etape", "signature").is("signe_le", null)
      .eq("devis_empreinte", empreinte).eq("montant_cents", projet.montant_cents).select("id");
    if (error) throw refusSql(error);
    if (!data?.length) {
      // Rien d'écrit : double envoi (déjà signé, même version) ou dossier modifié entre-temps par l'agence.
      const relu = await chargerProjet(sb, projet.id);
      if (relu?.signe_le && relu.signe_empreinte === empreinte && relu.devis_empreinte === empreinte && relu.montant_cents === projet.montant_cents) {
        return { deja: true, renoncer: await lienRenoncer(relu, base) };
      }
      const change = !relu || relu.devis_empreinte !== empreinte || relu.montant_cents !== projet.montant_cents;
      throw new Refus(change ? DEVIS_CHANGE : "Le dossier a changé entre-temps : rechargez la page avant de signer", 409);
    }
    const maj = await relire(sb, projet, valeurs);
    // Lien renvoyé à la page qui signe (son origine) ; celui de l'e-mail mène toujours au site (mailConfirmation).
    const renoncer = particulier ? await lienRenoncer(maj, base) : null;
    // Confirmation du contrat (cahier des charges § 5) ; si elle ne part pas, c'est noté pour l'agence (« Renvoyer »).
    const mail = await mailConfirmation(maj, pdf);
    if (!mail) await majEchecs(sb, maj, [], { quoi: "confirmation", sujet: `Devis signé — dossier ${projet.id}`, le: new Date().toISOString() });
    await mailAgence(maj, `Devis signé — dossier ${projet.id} (${projet.nom})`, "Devis signé", [
      p(`${esc(projet.prenom)} ${esc(projet.nom)} a signé le devis en ligne (bouton «&nbsp;${esc(TEXTES.bouton)}&nbsp;»).`),
      tableau([
        ...preuveSignature(maj), ["Adresse IP", ip ?? ""], ["Navigateur", navigateur ?? ""],
        ["Démarrage anticipé", particulier ? `Case cochée le ${dateParis(le)} : « ${TEXTES.case} »` : "Sans objet (client professionnel)"],
        ["Montant à régler", montantTexte(maj)], ["Référence du virement", projet.id],
        ["Fin du délai de rétractation", particulier ? `${dateJour(dernierJourRetractation(le))} inclus` : ""],
      ]),
      mail
        ? p("Le client a reçu la confirmation de sa commande avec le devis signé et les instructions de virement. Quand le virement arrive, cliquez sur «&nbsp;Virement reçu&nbsp;» dans l'espace agence.")
        : alerte("La confirmation de la commande (devis signé, instructions de virement" + (particulier ? ", information sur la rétractation" : "") + ") n'a pas pu être envoyée au client&nbsp;: renvoyez-la depuis l'espace agence (bouton «&nbsp;Renvoyer&nbsp;» en tête de la fiche du dossier)."),
    ].join(""));
    return { etape: suivante, renoncer, mail };
  },

  // Documents validés : étape suivante (dépôt avec l'option de suivi, sinon dossier clos).
  async valider({ sb, projet }) {
    if (projet.etape !== "validation") {
      if (projet.documents_valides_le) return { deja: true, valide_le: projet.documents_valides_le };
      throw new Refus("Vos documents ne sont pas en attente de validation : écrivez-nous à contact@atomes.studio si besoin.", 409);
    }
    const suivante = etapeSuivante(projet);
    const le = new Date().toISOString();
    const { data, error } = await sb.from("projets").update({ documents_valides_le: le, etape: suivante })
      .eq("id", projet.id).eq("etape", "validation").select("id");
    if (error) throw refusSql(error);
    if (!data?.length) {
      const relu = await chargerProjet(sb, projet.id);
      if (relu?.documents_valides_le && relu.etape !== "validation") return { deja: true, valide_le: relu.documents_valides_le };
      throw new Refus("Le dossier a changé entre-temps : rechargez la page", 409);
    }
    const maj = await relire(sb, projet, { documents_valides_le: le, etape: suivante });
    await mailAgence(maj, `Documents validés — dossier ${projet.id} (${projet.nom})`, "Documents validés",
      p(`${esc(projet.prenom)} ${esc(projet.nom)} a validé ses documents. ${suivante === "depot" ? "Option de suivi administratif : le dossier passe au dépôt." : "Le dossier est clos."}`));
    const mail = suivante === "clos"
      ? await mailClient(maj, `Dossier clos — dossier ${projet.id}`, "Dossier clos", [
        `<h1 style="${H1}">Merci ${esc(projet.prenom)}, vos documents sont validés.</h1>`,
        p("Votre dossier est clos. Vos documents restent disponibles dans votre espace client. Merci de votre confiance."),
        bouton("Ouvrir mon espace client", ESPACE_CLIENT),
      ].join(""))
      : await mailClient(maj, `Documents validés — dossier ${projet.id}`, "Documents validés", [
        `<h1 style="${H1}">Merci ${esc(projet.prenom)}, vos documents sont validés.</h1>`,
        p("Nous préparons le dépôt de votre démarche administrative et vous tenons informé de son avancement."),
        bouton("Suivre mon dossier", ESPACE_CLIENT),
      ].join(""));
    return { etape: suivante, valide_le: le, mail };
  },

  // Rétractation d'un particulier (renonciation au contrat), pendant le délai légal. L'étape ne change pas :
  // l'agence arrête la mission et rembourse s'il y a lieu. Le lien porte sur le contrat en cours (jeton.d) : celui
  // d'un contrat précédent (devis remplacé puis signé de nouveau) est refusé.
  async renoncer({ sb, projet, corps, req, jeton }) {
    if (!estParticulier(projet)) throw new Refus("La rétractation ne s'applique qu'aux contrats conclus par un particulier.", 409);
    if (!projet.signe_le) throw new Refus(PAS_DE_CONTRAT, 409);
    if (jeton.d !== await empreinteContrat(projet)) throw new Refus(CONTRAT_PRECEDENT, 409);
    if (projet.retracte_le) return { deja: true, retracte_le: projet.retracte_le };
    if (Date.now() > finRetractation(projet.signe_le).getTime()) throw new Refus(DELAI_EXPIRE, 410);
    const nom = propre(String(corps.nom ?? ""), 120);
    if (nom.length < 3) throw new Refus("Saisissez votre nom et votre prénom");
    const email = propre(String(corps.email ?? ""), 200).toLowerCase();
    if (email && !EMAIL.test(email)) throw new Refus("Saisissez une adresse e-mail valide");
    const le = new Date();
    const ip = ipClient(req);
    const navigateur = propre(req.headers.get("user-agent") ?? "", 300) || null;
    const valeurs = { retracte_le: le.toISOString(), retracte_nom: nom, retracte_email: email || null, retracte_ip: ip, retracte_agent: navigateur };
    const { data, error } = await sb.from("projets").update(valeurs).eq("id", projet.id).is("retracte_le", null).select("id");
    if (error) throw refusSql(error);
    if (!data?.length) {
      const relu = await chargerProjet(sb, projet.id);
      if (relu?.retracte_le) return { deja: true, retracte_le: relu.retracte_le };
      throw new Refus("Le dossier a changé entre-temps : rechargez la page", 409);
    }
    const maj = await relire(sb, projet, valeurs);
    // Accusé de réception (à l'adresse du dossier, et séparément à l'adresse saisie si elle diffère) ; s'il ne part
    // nulle part, c'est noté pour l'agence (« Renvoyer ») et la page le dit au client. Une confirmation du contrat
    // restée à renvoyer n'a plus lieu d'être (contrat rétracté).
    const mail = await mailsAccuse(maj);
    await majEchecs(sb, maj, ["confirmation"], mail ? null : { quoi: "retractation", sujet: `Rétractation reçue — dossier ${projet.id}`, le: new Date().toISOString() });
    const signeLe = dateParis(new Date(projet.signe_le));
    await mailAgence(maj, `Rétractation — dossier ${projet.id} (${projet.nom})`, "Rétractation", [
      p(`${esc(projet.prenom)} ${esc(projet.nom)} a renoncé au contrat (droit de rétractation) le ${esc(dateParis(le))}. <strong>Arrêtez la mission.</strong>`),
      projet.paye_le
        ? alerte(`Un virement a été reçu le ${esc(dateParis(new Date(projet.paye_le)))}&nbsp;: remboursez-le sous 14 jours, déduction faite, le cas échéant, du montant du travail déjà réalisé à sa demande.`)
        : p("Aucun virement n'est enregistré pour ce dossier."),
      mail ? "" : alerte("L'accusé de réception de la rétractation n'a pas pu être envoyé au client&nbsp;: renvoyez-le depuis l'espace agence (bouton «&nbsp;Renvoyer&nbsp;» en tête de la fiche du dossier)."),
      tableau([
        ["Nom saisi", nom], ["Adresse e-mail saisie", email], ["Devis signé le", signeLe],
        ["Démarrage anticipé demandé le", projet.demarrage_anticipe_le ? dateParis(new Date(projet.demarrage_anticipe_le)) : "Non"],
        ["Montant du devis", projet.montant_cents ? montantTexte(projet) : ""], ["Adresse IP", ip ?? ""], ["Navigateur", navigateur ?? ""],
      ]),
    ].join(""));
    return { retracte_le: valeurs.retracte_le, mail };
  },
};

// ---------- Action du client (session Supabase, lecture seule) -----------------------------------

const ACTIONS_CLIENT: Record<string, Action> = {
  // Coordonnées de virement (dossier en attente de paiement ou payé) et lien de rétractation (particulier signé,
  // dans le délai) : l'espace client n'a aucune action, il renvoie vers la page d'action.
  async infos_espace({ projet, base }) {
    const virement = !!projet.montant_cents && !projet.retracte_le && (projet.etape === "paiement" || !!projet.paye_le);
    return {
      virement: virement ? {
        iban: VIREMENT.iban ? ibanLisible(VIREMENT.iban) : null, bic: VIREMENT.bic || null, titulaire: VIREMENT.titulaire || null, reference: projet.id,
      } : null,
      renoncer: await lienRenoncer(projet, base),
    };
  },
};

// ---------- Actions de l'agence ----------------------------------------------

const ACTIONS_AGENCE: Record<string, Action> = {
  // Questions au client (réponse libre, ou propositions données en exemple) : un seul e-mail ; le client répond
  // à l'e-mail (adresse de réponse contact@) et le moteur de l'agence ajoute sa réponse au dossier.
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
    const mail = await mailClient(projet, `${plusieurs ? "Quelques questions" : "Une question"} sur votre dossier ${projet.id}`, plusieurs ? "Nos questions" : "Notre question", [
      `<h1 style="${H1}">Bonjour ${esc(projet.prenom)},</h1>`,
      p(`Pour affiner votre demande, nous avons ${plusieurs ? "quelques questions" : "une question"}&nbsp;:`),
      `<ul style="margin:0 0 18px;padding-left:18px;font-size:15px;line-height:24px">${lignes.map((x) =>
        `<li style="margin:0 0 8px">${esc(x.question)}${x.choix.length ? `<br><span style="color:#7a7368">Par exemple&nbsp;: ${esc(x.choix.join(" · "))}</span>` : ""}</li>`).join("")}</ul>`,
      p("Répondez simplement à cet e-mail&nbsp;: votre réponse s'ajoute à votre dossier."),
      p("Vous pouvez y joindre des photos ou des documents PDF."),
    ].join(""));
    return { posees: lignes.length, mail };
  },

  // Envoi du devis : PDF déposé dans <id>/agence/ (un fichier par version, jamais écrasé), montant à régler par
  // virement après la signature ; empreinte calculée ici. Signature, démarrage anticipé et rétractation remis à
  // zéro (nouveau contrat). Refusé une fois le dossier payé. E-mail : PDF joint et lien de signature (30 jours) ;
  // pour un particulier, information sur la rétractation et formulaire type avant la signature. Le lien est aussi
  // renvoyé à l'agence (à transmettre au client si l'e-mail n'est pas parti : mail faux).
  async devis({ sb, projet, corps }) {
    if (projet.paye_le) throw new Refus(DEJA_PAYE, 409);
    if (!JETON_SECRET) throw new Refus("Liens indisponibles : configurez le secret JETON_SECRET (voir SETUP-ESPACE-CLIENT.md) avant d'envoyer un devis.", 503);
    // Accusé de rétractation encore à renvoyer : le nouveau devis effacerait la rétractation qu'il prouve.
    if (echecs(projet).some((x) => x.quoi === "retractation")) {
      throw new Refus("L'accusé de réception de la rétractation du client n'est pas encore parti : renvoyez-le d'abord (bandeau en tête de la fiche), puis envoyez le nouveau devis.", 409);
    }
    const chemin = String(corps.chemin ?? "");
    if (!chemin.startsWith(`${projet.id}/agence/`) || !/\.pdf$/i.test(chemin) || chemin.includes("..") || chemin.split("/").length !== 3) {
      throw new Refus("Le devis doit être un PDF déposé dans les documents de l'agence");
    }
    const cents = montantCents(corps.montant);
    if (!cents) throw new Refus("Montant invalide");
    const libelle = propre(String(corps.libelle ?? ""), 120) || "Montant du devis";
    const { octets: pdf, empreinte } = await empreinteFichier(sb, chemin);
    const valeurs = {
      devis_chemin: chemin, devis_empreinte: empreinte, devis_envoye_le: new Date().toISOString(),
      montant_cents: cents, montant_libelle: libelle,
      signe_le: null, signe_nom: null, signe_ip: null, signe_agent: null, signe_empreinte: null,
      demarrage_anticipe_le: null, demarrage_anticipe_texte: null,
      retracte_le: null, retracte_nom: null, retracte_email: null, retracte_ip: null, retracte_agent: null,
      etape: "signature",
      // Confirmation du contrat précédent restée à renvoyer : sans objet (nouveau contrat).
      ...(echecs(projet).some((x) => x.quoi === "confirmation") ? { envois_echoues: echecs(projet).filter((x) => x.quoi !== "confirmation") } : {}),
    };
    const { data: fait, error } = await sb.from("projets").update(valeurs).eq("id", projet.id).is("paye_le", null).select("id");
    if (error) throw refusSql(error);
    if (!fait?.length) throw new Refus(DEJA_PAYE, 409);
    const maj = await relire(sb, projet, valeurs);
    const lien = await lienAction(SITE_URL, "signer", projet.id, Math.floor(Date.now() / 1000) + DUREE_SIGNER, empreinte.slice(0, 16));
    const fichier = chemin.split("/").pop() ?? "devis.pdf";
    const joint = pdf.byteLength <= MAX_DEVIS_JOINT;
    const mail = await mailClient(maj, `Votre devis est prêt — dossier ${projet.id}`, "Votre devis", [
      `<h1 style="${H1}">Bonjour ${esc(projet.prenom)}, votre devis est prêt.</h1>`,
      p(joint ? "Vous le trouverez en pièce jointe. Lisez-le, puis signez-le en ligne&nbsp;:" : "Lisez-le, puis signez-le en ligne&nbsp;:"),
      bouton("Lire et signer mon devis", lien),
      tableau([["Montant", montantTexte(maj)]]),
      p("Le règlement se fait par virement, après la signature&nbsp;: vous recevrez alors la confirmation de votre commande, les coordonnées bancaires et la référence à indiquer."),
      p("Ce lien est personnel et reste valable 30&nbsp;jours."),
      estParticulier(maj) ? retractationHtml(null, "") : "",
    ].join(""), joint ? [{ filename: fichier, content: base64(new Uint8Array(pdf)) }] : []);
    return { etape: "signature", empreinte, lien, mail };
  },

  // Changement d'étape ; e-mail au client quand le dossier avance vers une étape qui l'attend ou le concerne, sauf
  // après une rétractation (mission arrêtée : aucun e-mail de mission au client qui a renoncé). Demande de validation :
  // refusée sans document de l'agence ; nouveau tour (une validation précédente ne vaut plus). Écriture conditionnelle
  // (étape lue) : deux demandes simultanées ne partent qu'une fois. Réponse : mail = l'e-mail est parti.
  async etape({ sb, projet, corps }) {
    const cle = String(corps.cle ?? "");
    const cible = projet.etapes.find((e) => e.cle === cle);
    if (!cible) throw new Refus("Étape inconnue");
    if (cible.optionnelle && !projet.suivi_administratif) throw new Refus("Activez d'abord le suivi administratif");
    if (cle === "signature" && !projet.devis_chemin) throw new Refus("Envoyez d'abord le devis (PDF et montant)");
    if (cle === "paiement" && !projet.montant_cents) throw new Refus("Envoyez d'abord le devis (PDF et montant)");
    if (cle === projet.etape) return { etape: cle, mail: false };
    const avance = cible.ordre > ordreCourant(projet);
    const mailEtape = avance && (cle === "validation" || Object.hasOwn(MAILS_ETAPE, cle));
    const prevenir = mailEtape && !projet.retracte_le;
    let docs: Doc[] = [];
    if (prevenir && cle === "validation") {
      docs = await documentsAgence(sb, projet, false);
      if (!docs.length) throw new Refus("Déposez d'abord les documents à valider (documents de l'agence), puis demandez la validation.", 409);
    }
    const valeurs: Record<string, unknown> = { etape: cle };
    if (avance && cle === "validation") valeurs.documents_valides_le = null;
    const { data, error } = await sb.from("projets").update(valeurs).eq("id", projet.id).eq("etape", projet.etape).select("id");
    if (error) throw refusSql(error);
    if (!data?.length) {
      const relu = await chargerProjet(sb, projet.id);
      if (relu?.etape === cle) return { etape: cle, deja: true, mail: false };
      throw new Refus("Le dossier a changé entre-temps : rechargez-le", 409);
    }
    if (!prevenir) return { etape: cle, mail: false, ...(mailEtape ? { retracte: true } : {}) };
    const maj = await relire(sb, projet, valeurs as Partial<Projet>);
    let mail: boolean;
    if (cle === "validation") mail = await mailDocumentsPrets(maj, docs);
    else {
      const m = MAILS_ETAPE[cle];
      mail = await mailClient(maj, `${m.sujet} — dossier ${projet.id}`, m.sujet, [
        `<h1 style="${H1}">Bonjour ${esc(projet.prenom)},</h1>`, p(m.texte), bouton(m.bouton, ESPACE_CLIENT),
      ].join(""));
    }
    return { etape: cle, mail };
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

  // « Virement reçu » : paiement enregistré (paiement_ref = 'virement') et, à l'étape « Paiement », passage à la
  // production, en une seule écriture conditionnelle. Refusé après une rétractation (mission arrêtée).
  async paye({ sb, projet }) {
    if (projet.paye_le) return { deja: true };
    if (!projet.montant_cents) throw new Refus("Montant non défini");
    if (projet.retracte_le) {
      throw new Refus(`Le client s'est rétracté le ${dateParis(new Date(projet.retracte_le))} : la mission est arrêtée et le virement n'est pas enregistré. S'il a été reçu, remboursez-le sous 14 jours.`, 409);
    }
    const valeurs: Record<string, unknown> = { paye_le: new Date().toISOString(), paiement_ref: "virement" };
    if (projet.etape === "paiement") valeurs.etape = etapeSuivante(projet);
    const { data, error } = await sb.from("projets").update(valeurs)
      .eq("id", projet.id).eq("etape", projet.etape).is("paye_le", null).is("retracte_le", null).select("id");
    if (error) throw refusSql(error);
    if (!data?.length) {
      const relu = await chargerProjet(sb, projet.id);
      if (relu?.paye_le) return { deja: true };
      throw new Refus("Le dossier a changé entre-temps : rechargez-le", 409);
    }
    const maj = await relire(sb, projet, valeurs as Partial<Projet>);
    const montant = euros(projet.montant_cents);
    const production = valeurs.etape === "production";
    const mail = await mailClient(maj, `Paiement reçu — dossier ${projet.id}`, "Paiement reçu", [
      `<h1 style="${H1}">Merci ${esc(projet.prenom)}, votre virement est bien reçu.</h1>`,
      p(`Nous avons bien reçu votre virement de ${esc(montant)} (référence ${projet.id}).${production ? " Nous lançons la production de vos documents et vous prévenons dès qu'ils sont prêts." : ""}`),
    ].join(""));
    await mailAgence(maj, `Paiement reçu — dossier ${projet.id} (${projet.nom}) : ${montant}`, "Paiement reçu", [
      p(`Virement de ${esc(projet.prenom)} ${esc(projet.nom)} enregistré dans l'espace agence («&nbsp;Virement reçu&nbsp;»).${production ? " Le dossier passe à la production des documents." : ""}`),
      tableau([["Montant", montantTexte(projet)], ["Référence du virement", projet.id]]),
    ].join(""));
    return { paye: true, etape: maj.etape, mail };
  },

  // « Renvoyer » : e-mail légal qui n'a pas pu partir pendant une action du client par lien (confirmation du contrat,
  // accusé de réception de la rétractation), renvoyé tel qu'il est dû aujourd'hui. Une fois parti, il n'est plus
  // signalé dans l'espace agence. Réponse { renvoye, mail }.
  async renvoyer({ sb, projet, corps }) {
    const quoi = String(corps.quoi ?? "");
    let mail: boolean;
    if (quoi === "confirmation") {
      if (!projet.signe_le || !projet.devis_chemin || !projet.signe_empreinte || projet.signe_empreinte !== projet.devis_empreinte) {
        throw new Refus("Aucun devis signé n'est en cours : il n'y a pas de confirmation à renvoyer.", 409);
      }
      if (projet.retracte_le) throw new Refus("Le client a renoncé au contrat : renvoyez-lui plutôt l'accusé de réception de sa rétractation.", 409);
      const { octets, empreinte } = await empreinteFichier(sb, projet.devis_chemin);
      if (empreinte !== projet.signe_empreinte) throw new Refus("Le PDF du devis signé a changé dans le stockage : la confirmation n'est pas renvoyée.", 409);
      mail = await mailConfirmation(projet, octets);
    } else if (quoi === "retractation") {
      if (!projet.retracte_le) throw new Refus("Aucune rétractation n'est enregistrée sur ce dossier.", 409);
      mail = await mailsAccuse(projet);
    } else throw new Refus("E-mail à renvoyer inconnu");
    if (mail) await majEchecs(sb, projet, [quoi], null);
    return { renvoye: quoi, mail };
  },

  // Message à vérifier reconnu par l'agence : rattaché au dossier comme un message vérifié (pièces jointes relues
  // chez Resend et rangées, questions répondues, demande de modification). Aucun e-mail au client. Sur un message
  // vérifié dont le traitement s'est interrompu (« Traitement incomplet ») : traitement repris là où il s'est arrêté.
  async rattacher({ sb, projet, corps }) {
    const message = await lireMessage(sb, projet, corps.message);
    // Message lu par le moteur de l'agence (contact@ ou simon@) : ses pièces jointes ne sont pas chez Resend mais
    // dans la copie gardée par le moteur. Il est marqué vérifié et à traiter : le moteur range ses pièces, répond
    // aux questions et note la demande de modification à son passage suivant (toutes les 5 minutes).
    if (duMoteur(message)) {
      if (message.verifie) return message.traite === false ? { moteur: true, reprise: true } : { deja: true };
      const { data, error } = await sb.from("messages").update({ verifie: true, traite: false, traitement_le: null })
        .eq("id", message.id).eq("verifie", false).select("id");
      if (error) throw error;
      if (!data?.length) return { deja: true };
      return { rattache: true, moteur: true };
    }
    if (message.verifie) {
      if (message.traite !== false) return { deja: true };
      let bilan: Bilan | null;
      try {
        bilan = await reprendre(sb, projet, message, true);
      } catch (e) {
        console.error("reprise du traitement du message", projet.id, message.id, e);
        throw new Refus("Pièces jointes momentanément indisponibles : réessayez dans quelques minutes.", 502);
      }
      if (!bilan) throw new Refus("Ce message est en cours de traitement : réessayez dans quelques minutes.", 409);
      return { rattache: true, reprise: true, ...resumeBilan(bilan) };
    }
    const { data, error } = await sb.from("messages").update({ verifie: true }).eq("id", message.id).eq("verifie", false).select("id");
    if (error) throw error;
    if (!data?.length) return { deja: true };
    const bilan = nouveauBilan();
    try {
      await traiterMessageVerifie(sb, projet, { ...message, verifie: true }, bilan, true, await htmlRecu(message.resend_id));
    } catch (e) {
      // Retour à l'état « à vérifier » (fichiers rangés par cette tentative retirés) : l'agence pourra réessayer.
      console.error("rattachement du message", projet.id, message.id, e);
      await retirerFichiers(sb, bilan.nouvelles);
      const { error: errRetour } = await sb.from("messages").update({ verifie: false, pieces: message.pieces }).eq("id", message.id)
        .then((x: { error: unknown }) => x, (err: unknown) => ({ error: err }));
      if (errRetour) console.error("message resté rattaché sans ses pièces, à vérifier", projet.id, message.id, errRetour);
      throw new Refus("Pièces jointes momentanément indisponibles : réessayez dans quelques minutes.", 502);
    }
    return { rattache: true, ...resumeBilan(bilan) };
  },

  // Suppression d'un message à vérifier (non vérifié seulement). Message déjà absent : { deja: true } (double clic).
  async supprimer_message({ sb, projet, corps }) {
    let message: Message;
    try { message = await lireMessage(sb, projet, corps.message); } catch (e) {
      if (e instanceof Refus && e.statut === 404) return { deja: true };
      throw e;
    }
    if (message.verifie) throw new Refus("Ce message est rattaché au dossier : il ne peut plus être supprimé", 409);
    const { data, error } = await sb.from("messages").delete().eq("id", message.id).eq("verifie", false).select("id");
    if (error) throw error;
    if (!data?.length) {
      const { data: reste } = await sb.from("messages").select("verifie").eq("id", message.id).maybeSingle();
      if (!reste) return { deja: true };
      throw new Refus("Ce message vient d'être rattaché au dossier : il n'a pas été supprimé", 409);
    }
    return { supprime: true };
  },
};

const MAILS_ETAPE: Record<string, { sujet: string; texte: string; bouton: string }> = {
  instruction: { sujet: "Votre dossier est déposé", texte: "Votre démarche administrative est déposée. Nous suivons son instruction et vous tenons informé.", bouton: "Suivre mon dossier" },
  accordee: { sujet: "Démarche administrative validée", texte: "Bonne nouvelle&nbsp;: votre démarche administrative est validée. Les documents correspondants sont dans votre espace client.", bouton: "Ouvrir mon espace client" },
  clos: { sujet: "Dossier clos", texte: "Votre dossier est clos. Vos documents restent disponibles dans votre espace client. Merci de votre confiance.", bouton: "Ouvrir mon espace client" },
};

// E-mail « Vos documents sont prêts » (passage à l'étape « Validation de vos documents ») : liste des documents
// de l'agence, lien de validation (90 jours) ; une modification se demande en répondant à l'e-mail. Faux si l'e-mail
// n'est pas parti.
async function mailDocumentsPrets(projet: Projet, docs: Doc[]): Promise<boolean> {
  const lien = JETON_SECRET ? await lienAction(SITE_URL, "valider", projet.id, Math.floor(Date.now() / 1000) + DUREE_VALIDER) : "";
  return await mailClient(projet, `Vos documents sont prêts — dossier ${projet.id}`, "Vos documents sont prêts", [
    `<h1 style="${H1}">Bonjour ${esc(projet.prenom)}, vos documents sont prêts.</h1>`,
    docs.length
      ? p("Voici les documents de votre dossier&nbsp;:") + `<ul style="margin:0 0 18px;padding-left:18px;font-size:14px;line-height:24px">${docs.map((d) =>
        `<li>${esc(d.nom)} <span style="color:#7a7368">(${ko(d.taille)})</span></li>`).join("")}</ul>`
      : p("Vos documents sont disponibles dans votre espace client."),
    lien ? p("Vérifiez-les, puis validez-les&nbsp;:") + bouton("Voir et valider mes documents", lien) : "",
    p(lien
      ? "Pour demander une modification, répondez simplement à cet e-mail en précisant ce que vous souhaitez changer."
      : "Pour les valider ou demander une modification, répondez simplement à cet e-mail."),
  ].join(""));
}

// ---------- Webhook Resend : e-mail reçu --------------------------------------
// Doc Resend : webhook email.received (métadonnées seulement), GET /emails/receiving/{id} (text, html, headers,
// authentication), GET /emails/receiving/{email_id}/attachments (download_url valable 1 h, content_disposition,
// content_id) ; signature Svix ; après un échec, nouvelles tentatives 5 s, 5 min, 30 min, 2 h, 5 h, 10 h et 10 h plus
// tard (Svix n'attend une réponse que quelques secondes).

async function webhookResend(sb: Sb, req: Request): Promise<Response> {
  const brut = await req.text();
  if (!RESEND_WEBHOOK_SECRET || !(await signatureSvixValide(req.headers, brut))) return reponseWebhook({ erreur: "signature invalide" }, 400);
  let evt: Json;
  try { evt = JSON.parse(brut); } catch { return reponseWebhook({ erreur: "corps illisible" }, 400); }
  const type = String(evt?.type ?? "");
  if (type !== "email.received") {
    console.warn("webhook resend : événement ignoré", type);
    return reponseWebhook({ recu: true, type, traite: false }, 200);
  }
  try {
    return reponseWebhook({ recu: true, type, ...(await recevoirEmail(sb, evt.data ?? {})) }, 200);
  } catch (e) {
    // Traitement en cours ailleurs (503) ou erreur passagère (500) : Resend renverra l'événement plus tard.
    if (e instanceof Refus) return reponseWebhook({ erreur: e.message }, e.statut);
    console.error("webhook resend", e);
    return reponseWebhook({ erreur: "traitement impossible" }, 500);
  }
}

// Signature Svix : HMAC-SHA256 (clé = base64 décodé après « whsec_ ») de « svix-id.svix-timestamp.corps brut »,
// en base64, comparée à chaque « v1,<signature> » de l'en-tête svix-signature ; horodatage à ± 5 minutes.
async function signatureSvixValide(entetes: Headers, corps: string): Promise<boolean> {
  const id = entetes.get("svix-id") ?? "", t = entetes.get("svix-timestamp") ?? "", signatures = entetes.get("svix-signature") ?? "";
  if (!id || !signatures || !/^\d{1,12}$/.test(t) || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  let cle: CryptoKey;
  try {
    const octets = Uint8Array.from(atob(RESEND_WEBHOOK_SECRET.replace(/^whsec_/, "")), (c) => c.charCodeAt(0));
    if (!octets.length) return false;
    cle = await crypto.subtle.importKey("raw", octets, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  } catch { return false; }
  const attendu = base64(new Uint8Array(await crypto.subtle.sign("HMAC", cle, new TextEncoder().encode(`${id}.${t}.${corps}`))));
  return signatures.split(" ").some((s) => {
    const [version, valeur] = s.split(",");
    return version === "v1" && !!valeur && egalConstant(valeur, attendu);
  });
}

// Réponse du client : dossier retrouvé par l'adresse de réponse, e-mail lu chez Resend, message enregistré
// (resend_id unique : un événement relivré n'est traité qu'une fois), puis, s'il est vérifié, pièces jointes
// rangées, questions répondues et demande de modification, et e-mail « Réponse du client » à l'agence. Message à
// vérifier : e-mail à l'agence au plus une fois par heure et par dossier, aucun si SPF, DKIM et DMARC échouent tous.
// Un message vérifié est enregistré « en cours de traitement » (bail de 10 minutes), puis marqué traité : une erreur
// passagère (Resend, base, stockage) répond 500 et la nouvelle tentative de Resend reprend là où le traitement s'est
// arrêté (pièces déjà rangées gardées) ; une relivraison pendant le traitement reçoit 503 (Resend réessaiera), jamais
// un faux « doublon ».
async function recevoirEmail(sb: Sb, data: Json): Promise<Record<string, unknown>> {
  const emailId = String(data?.email_id ?? "");
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(emailId)) { console.warn("webhook resend : identifiant d'e-mail absent"); return { traite: false }; }
  const id = await dossierDestinataire(data);
  if (!id) { console.warn("webhook resend : aucune adresse de dossier valable", emailId); return { traite: false }; }
  const projet = await chargerProjet(sb, id);
  if (!projet) { console.warn("webhook resend : dossier introuvable", id, emailId); return { traite: false }; }
  const { data: deja, error: errDeja } = await sb.from("messages").select("*").eq("resend_id", emailId).maybeSingle();
  if (errDeja) throw errDeja;
  if (deja) return await relivraison(sb, projet, versMessage(deja));

  const email = await resendApi(`emails/receiving/${encodeURIComponent(emailId)}?html_format=cid`);
  if (!email) throw new Error(`e-mail reçu ${emailId} introuvable chez Resend`);
  const entetes = enTetes(email.headers);
  if (reponseAutomatique(entetes)) { console.warn("webhook resend : réponse automatique ignorée", id, emailId); return { traite: false, automatique: true }; }

  // Expéditeur : adresse simple, la même dans le champ « from » de Resend et dans l'en-tête From (sinon : à vérifier).
  const brutDe = email.from ?? data?.from ?? entetes["from"]?.[0] ?? "";
  const expediteur = expediteurSur(brutDe, entetes["from"]);
  const a = (email.authentication ?? {}) as Record<string, unknown>;
  const auth = { spf: resultat(a.spf), dkim: resultat(a.dkim), dmarc: resultat(a.dmarc) };
  const memeAdresse = !!expediteur && expediteur === projet.email.trim().toLowerCase();
  const verifie = memeAdresse && authentifie(auth);
  // E-mails reçus en nombre : au-delà de la limite du dossier sur 24 h, l'e-mail n'est pas enregistré.
  if ((await compterMessages(sb, projet.id, verifie, 86400000)) >= (verifie ? MAX_MESSAGES_JOUR : MAX_A_VERIFIER_JOUR)) {
    console.warn("webhook resend : limite de messages du dossier atteinte, e-mail non enregistré", id, emailId);
    return { traite: false, limite: true };
  }
  const prevenir = !verifie && !echecTotal(auth) && (await compterMessages(sb, projet.id, false, 3600000)) === 0;
  const complet = texteComplet(email);
  const texte = sansCitation(complet).slice(0, 20000);
  const recuLe = dateValide(email.created_at) ?? dateValide(data?.created_at) ?? new Date().toISOString();
  // Pièces jointes annoncées : rangées seulement pour un message vérifié ; pour un message à vérifier, leurs noms sont
  // gardés (chemin nul) pour que l'agence les voie avant de le rattacher.
  const metas = (Array.isArray(email.attachments) ? email.attachments : Array.isArray(data?.attachments) ? data.attachments : []) as Json[];
  const annoncees: PieceAnnoncee[] = metas.slice(0, 50).map((x) => ({ nom: propre(String(x?.filename ?? ""), 200) || "pièce", chemin: null, taille: Number(x?.size) || 0 }));
  const { data: ligne, error } = await sb.from("messages").insert({
    projet_id: projet.id, recu_le: recuLe, expediteur: expediteur || propre(String(brutDe), 200).toLowerCase() || "inconnu",
    sujet: propre(String(email.subject ?? data?.subject ?? ""), 300) || null, texte: texte || null, texte_complet: complet || null,
    pieces: verifie ? [] : annoncees, verifie, etape: projet.etape, resend_id: emailId, auth,
    traite: !verifie, traitement_le: verifie ? new Date().toISOString() : null,
  }).select("*").single();
  if (error) {
    if (error.code !== "23505") throw error;
    // Même e-mail enregistré au même moment par une autre livraison : traité comme une relivraison.
    const { data: autre, error: errAutre } = await sb.from("messages").select("*").eq("resend_id", emailId).maybeSingle();
    if (errAutre) throw errAutre;
    if (!autre) throw new Error(`message reçu ${emailId} : doublon introuvable`);
    return await relivraison(sb, projet, versMessage(autre));
  }
  if (!ligne?.id) throw new Error(`message reçu ${emailId} : insertion sans retour`);
  const message = versMessage(ligne);
  if (verifie) {
    const bilan = await traiterEtMarquer(sb, projet, message, false, typeof email.html === "string" ? email.html : null);
    await mailReponse(projet, message, bilan);
    return { traite: true, verifie, pieces: bilan.pieces.length };
  }
  if (prevenir) await mailAVerifier(projet, message, memeAdresse, auth, annoncees);
  return { traite: true, verifie, pieces: 0, agence_prevenue: prevenir };
}

// Relivraison d'un e-mail déjà enregistré : traité → doublon (200) ; traitement en cours ailleurs → 503 (Resend
// réessaiera) ; traitement interrompu (erreur passagère, délai dépassé) → repris là où il s'est arrêté.
async function relivraison(sb: Sb, projet: Projet, message: Message): Promise<Record<string, unknown>> {
  if (!message.verifie || message.traite !== false) return { traite: false, doublon: true };
  const bilan = await reprendre(sb, projet, message, false);
  if (!bilan) throw new Refus("traitement en cours", 503);
  await mailReponse(projet, message, bilan);
  return { traite: true, verifie: true, reprise: true, pieces: bilan.pieces.length };
}

// Reprise d'un message vérifié dont le traitement n'est pas terminé : bail pris par une écriture conditionnelle (une
// seule reprise à la fois), pièces déjà rangées gardées. null si un autre traitement tient le bail.
async function reprendre(sb: Sb, projet: Projet, message: Message, tardif: boolean): Promise<Bilan | null> {
  const bail = message.traitement_le ?? null;
  if (bail && Date.now() - Date.parse(bail) < BAIL_TRAITEMENT) return null;
  const le = new Date().toISOString();
  const q = sb.from("messages").update({ traitement_le: le }).eq("id", message.id).eq("traite", false);
  const { data, error } = await (bail ? q.eq("traitement_le", bail) : q.is("traitement_le", null)).select("id");
  if (error) throw error;
  if (!data?.length) return null;
  return await traiterEtMarquer(sb, projet, { ...message, traitement_le: le }, tardif);
}

// Traitement d'un message vérifié (étapes 6 à 8), puis message marqué traité. En cas d'erreur, le bail est rendu (la
// nouvelle tentative reprend aussitôt) ; les pièces déjà rangées restent notées dans le message. html non fourni : relu
// chez Resend (repérage des images de l'e-mail cité).
async function traiterEtMarquer(sb: Sb, projet: Projet, message: Message, tardif: boolean, html?: string | null): Promise<Bilan> {
  const bilan = nouveauBilan();
  try {
    await traiterMessageVerifie(sb, projet, message, bilan, tardif, html === undefined ? await htmlRecu(message.resend_id) : html);
    const { error } = await sb.from("messages").update({ traite: true, traitement_le: null }).eq("id", message.id);
    if (error) throw error;
  } catch (e) {
    const { error } = await sb.from("messages").update({ traitement_le: null }).eq("id", message.id)
      .then((x: { error: unknown }) => x, (err: unknown) => ({ error: err }));
    if (error) console.error("message reçu : traitement interrompu, reprise possible dans 10 minutes", message.projet_id, message.id, error);
    throw e;
  }
  return bilan;
}

// Étapes 6 à 8 d'un message vérifié. `bilan` est rempli au fur et à mesure ; chaque pièce rangée est aussitôt notée
// dans le message (une reprise ne la range pas une seconde fois). `tardif` (rattachement ou reprise par l'agence) : un
// e-mail que Resend ne conserve plus est rattaché sans ses pièces ; à la réception (webhook), une liste de pièces
// introuvable est une erreur passagère (Resend réessaiera). `html` : HTML reçu (images de l'e-mail cité).
async function traiterMessageVerifie(sb: Sb, projet: Projet, message: Message, bilan: Bilan, tardif: boolean, html: string | null): Promise<void> {
  // 6. Pièces jointes (images et PDF, 25 Mo au plus) rangées dans <id>/client/, nom unique.
  const rangees = message.pieces.filter((x): x is Piece => !!x && typeof x.chemin === "string" && !!x.chemin);
  bilan.pieces.push(...rangees);
  if (message.resend_id) {
    const liste = await resendApi(`emails/receiving/${encodeURIComponent(message.resend_id)}/attachments`);
    if (!liste && !tardif) throw new Error(`pièces jointes de l'e-mail ${message.resend_id} introuvables chez Resend`);
    if (!liste) bilan.indisponibles = true;   // e-mail plus conservé chez Resend
    else {
      const contenu = await contenuClient(sb, projet.id);
      const prefixe = idParis(new Date(message.recu_le));
      const images = imagesDuHtml(html);
      let total = rangees.reduce((s, x) => s + (Number(x.taille) || 0), 0);
      for (const x of (Array.isArray(liste.data) ? liste.data : []) as Json[]) {
        const idResend = String(x?.id ?? "");
        if (idResend && rangees.some((r) => r.id_resend === idResend)) continue;   // rangée par une tentative précédente
        const nomRecu = propre(String(x?.filename ?? ""), 200) || "piece";
        const ext = extensionPiece(nomRecu, String(x?.content_type ?? ""));
        const taille = Number(x?.size ?? 0);
        if (!ext) { bilan.ecartees.push(`${nomRecu} (format non pris en charge)`); continue; }
        if (taille > MAX_PIECE) { bilan.ecartees.push(`${nomRecu} (plus de 25 Mo)`); continue; }
        // Image intégrée au texte : celle de l'e-mail cité, ou petite image (logo, signature), n'est pas un document.
        const integree = TYPES_PIECES[ext].startsWith("image/") && estIntegree(x);
        if (integree) {
          const cid = normCid(x?.content_id);
          if (images && cid && images.toutes.has(cid) && !images.reponse.has(cid)) { bilan.ignorees.push(`${nomRecu} (image de l'e-mail cité)`); continue; }
          if (taille > 0 && taille < MIN_IMAGE_INTEGREE) { bilan.ignorees.push(`${nomRecu} (petite image : logo ou signature)`); continue; }
        }
        if (bilan.pieces.length >= MAX_PIECES || total + taille > MAX_PIECES_TOTAL) { bilan.ecartees.push(`${nomRecu} (limite du message atteinte)`); continue; }
        if (contenu.volume + taille > MAX_VOLUME_DOSSIER) { bilan.ecartees.push(`${nomRecu} (espace du dossier plein : 200 Mo de pièces)`); continue; }
        if (!x?.download_url) throw new Error("pièce jointe sans lien de téléchargement");
        const r = await fetch(String(x.download_url), { signal: AbortSignal.timeout(60000) });
        if (!r.ok) throw new Error(`pièce jointe : téléchargement impossible (${r.status})`);
        const octets = await r.arrayBuffer();
        if (octets.byteLength > MAX_PIECE) { bilan.ecartees.push(`${nomRecu} (plus de 25 Mo)`); continue; }
        if (integree && octets.byteLength < MIN_IMAGE_INTEGREE) { bilan.ignorees.push(`${nomRecu} (petite image : logo ou signature)`); continue; }
        if (integree && EMPREINTES_LOGOS.has(hex(new Uint8Array(await crypto.subtle.digest("SHA-256", octets))))) {
          bilan.ignorees.push(`${nomRecu} (logo d'Atomes studio)`);
          continue;
        }
        if (contenu.volume + octets.byteLength > MAX_VOLUME_DOSSIER) { bilan.ecartees.push(`${nomRecu} (espace du dossier plein : 200 Mo de pièces)`); continue; }
        total += octets.byteLength;
        contenu.volume += octets.byteLength;
        const nom = await deposerPiece(sb, projet.id, nomSur(nomRecu, ext), octets, TYPES_PIECES[ext], contenu.noms, prefixe);
        const piece: Piece = { nom, chemin: `${projet.id}/client/${nom}`, taille: octets.byteLength, ...(idResend ? { id_resend: idResend } : {}) };
        bilan.pieces.push(piece);
        bilan.nouvelles.push(piece);
        // Pièce notée aussitôt dans le message : une reprise après une erreur ne la range pas une seconde fois.
        const { error } = await sb.from("messages").update({ pieces: bilan.pieces }).eq("id", message.id);
        if (error) throw error;
      }
    }
  }
  // Noms annoncés d'un message rattaché par l'agence remplacés par les pièces rangées (gardés si Resend ne conserve
  // plus l'e-mail : l'agence sait quelles pièces redemander au client).
  if (!bilan.indisponibles && message.pieces.some((x) => !x?.chemin)) {
    const { error } = await sb.from("messages").update({ pieces: bilan.pieces }).eq("id", message.id);
    if (error) throw error;
  }
  // 7. Questions sans réponse, posées avant la réception : la réponse est le texte du message.
  const reponse = (message.texte || (bilan.pieces.length ? `Pièces jointes : ${bilan.pieces.map((x) => x.nom).join(", ")}` : "")).slice(0, 5000);
  if (reponse) {
    const { data, error } = await sb.from("questions").update({ reponse, repondue_le: message.recu_le })
      .eq("projet_id", projet.id).is("repondue_le", null).lte("posee_le", message.recu_le).select("id");
    if (error) throw error;
    bilan.questions = data?.length ?? 0;
  }
  // 8. Étape « Validation de vos documents » : le message est une demande de modification (l'agence décide), notée
  // une seule fois même si le traitement est repris.
  if (message.etape === "validation" && projet.etape === "validation") {
    const { data: deja, error: errDeja } = await sb.from("modifications").select("id").eq("projet_id", projet.id).eq("demandee_le", message.recu_le).limit(1);
    if (errDeja) throw errDeja;
    if (!deja?.length) {
      const { error } = await sb.from("modifications").insert({ projet_id: projet.id, message: reponse || "Message sans texte", demandee_le: message.recu_le });
      if (error) throw error;
    }
    bilan.modification = true;
  }
}

// E-mail à l'agence pour un message vérifié : texte, pièces rangées, écartées, images ignorées, questions, modification.
async function mailReponse(projet: Projet, message: Message, bilan: Bilan): Promise<void> {
  await mailAgence(projet, `Réponse du client — dossier ${projet.id} (${projet.nom})`, "Réponse du client", [
    p(`${esc(projet.prenom)} ${esc(projet.nom)} a répondu par e-mail${message.sujet ? ` («&nbsp;${esc(message.sujet)}&nbsp;»)` : ""}.`),
    citation(message.texte || "(message sans texte)"),
    bilan.pieces.length ? p(`Pièces jointes rangées dans le dossier&nbsp;: ${esc(bilan.pieces.map((x) => x.nom).join(", "))}.`) : "",
    bilan.ecartees.length ? alerte(`Pièces jointes non rangées&nbsp;: ${esc(bilan.ecartees.join(", "))}.`) : "",
    bilan.ignorees.length ? p(`Images intégrées au texte, non rangées&nbsp;: ${esc(bilan.ignorees.join(", "))}.`) : "",
    bilan.questions ? p(bilan.questions > 1 ? `${bilan.questions} questions sont marquées comme répondues.` : "1 question est marquée comme répondue.") : "",
    bilan.modification ? p("Le dossier est à l'étape «&nbsp;Validation de vos documents&nbsp;»&nbsp;: ce message est enregistré comme une demande de modification.") : "",
  ].join(""));
}

// E-mail à l'agence pour un message à vérifier : expéditeur, authentification, texte, pièces non rangées.
async function mailAVerifier(projet: Projet, message: Message, memeAdresse: boolean, auth: Record<string, string | null>, annoncees: PieceAnnoncee[]): Promise<void> {
  const nonRangees = annoncees.map((x) => `${x.nom}${x.taille ? ` (${ko(x.taille)})` : ""}`);
  await mailAgence(projet, `Message à vérifier — dossier ${projet.id}`, "Message à vérifier", [
    p(`Un e-mail est arrivé à l'adresse de réponse de ce dossier, mais ${!memeAdresse ? "son expéditeur n'est pas l'adresse du client" : "l'authentification de l'expéditeur a échoué"}&nbsp;: il n'a pas été ajouté au dossier et ses pièces jointes n'ont pas été rangées.`),
    tableau([
      ["Expéditeur", message.expediteur || "inconnu"], ["Adresse du client", projet.email], ["Sujet", message.sujet ?? ""],
      ["Authentification", `SPF : ${auth.spf ?? "—"} · DKIM : ${auth.dkim ?? "—"} · DMARC : ${auth.dmarc ?? "—"}`],
      ["Pièces jointes non rangées", nonRangees.join(", ")],
    ]),
    citation(message.texte || "(message sans texte)"),
    p("Si vous le reconnaissez, rattachez-le au dossier depuis l'espace agence (ses pièces jointes seront alors rangées)&nbsp;; sinon, supprimez-le. Les autres messages à vérifier de ce dossier reçus dans l'heure s'affichent dans l'espace agence, sans nouvel e-mail."),
  ].join(""));
}

// Messages du dossier reçus depuis `duree` millisecondes (vérifiés ou à vérifier) : limites et regroupement des avis.
async function compterMessages(sb: Sb, projetId: string, verifie: boolean, duree: number): Promise<number> {
  const { count, error } = await sb.from("messages").select("id", { count: "exact", head: true })
    .eq("projet_id", projetId).eq("verifie", verifie).gte("recu_le", new Date(Date.now() - duree).toISOString());
  if (error) throw error;
  return count ?? 0;
}

async function retirerFichiers(sb: Sb, pieces: Piece[]): Promise<void> {
  if (!pieces.length) return;
  try {
    const { error } = await sb.storage.from("dossiers").remove(pieces.map((x) => x.chemin));
    if (error) throw error;
  } catch (e) {
    console.error("pièces jointes non retirées", pieces.map((x) => x.chemin).join(", "), e);
  }
}

async function lireMessage(sb: Sb, projet: Projet, v: unknown): Promise<Message> {
  const id = Number(v);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Refus("Message introuvable", 404);
  const { data, error } = await sb.from("messages").select("*").eq("id", id).eq("projet_id", projet.id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Refus("Message introuvable", 404);
  return versMessage(data);
}

// Message enregistré par le moteur de l'agence (lecture de contact@ et simon@) : identifiant « imap:<Message-ID> ».
function duMoteur(message: Message): boolean {
  return typeof message.resend_id === "string" && message.resend_id.startsWith("imap:");
}

function versMessage(ligne: Json): Message {
  return { ...ligne, pieces: Array.isArray(ligne?.pieces) ? ligne.pieces : [] } as Message;
}

function nouveauBilan(): Bilan {
  return { pieces: [], nouvelles: [], ecartees: [], ignorees: [], questions: 0, modification: false, indisponibles: false };
}

// Bilan renvoyé à l'espace agence (rattachement, reprise) ; non_rangees : pièces écartées (format, taille, limite) et
// images intégrées ignorées, avec la raison.
function resumeBilan(bilan: Bilan): Record<string, unknown> {
  return {
    pieces: bilan.pieces, non_rangees: [...bilan.ecartees, ...bilan.ignorees], questions: bilan.questions,
    modification: bilan.modification, pieces_indisponibles: bilan.indisponibles,
  };
}

// API Resend des e-mails reçus (lecture) ; null si la ressource n'existe pas (404), exception sinon (erreur passagère).
async function resendApi(chemin: string): Promise<Json> {
  if (!RESEND_RECEPTION_KEY) throw new Error("RESEND_API_KEY absent : lecture de l'e-mail reçu impossible");
  const r = await fetch(`https://api.resend.com/${chemin}`, {
    headers: { "Authorization": `Bearer ${RESEND_RECEPTION_KEY}` }, signal: AbortSignal.timeout(15000),
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`resend : lecture impossible (${r.status})`);
  return await r.json();
}

// HTML d'un e-mail reçu (repérage des images de l'e-mail cité) ; null si Resend ne le conserve plus.
async function htmlRecu(resendId: string | null): Promise<string | null> {
  if (!resendId) return null;
  const email = await resendApi(`emails/receiving/${encodeURIComponent(resendId)}?html_format=cid`);
  return typeof email?.html === "string" ? email.html : null;
}

// Pièces déjà rangées dans <id>/client/ : noms (dépôt sans écraser) et volume total (limite du dossier).
async function contenuClient(sb: Sb, id: string): Promise<{ noms: Set<string>; volume: number }> {
  const { data, error } = await sb.storage.from("dossiers").list(`${id}/client`, { limit: 1000 });
  if (error) throw error;
  const liste = (data ?? []) as Json[];
  return { noms: new Set(liste.map((f) => String(f?.name ?? ""))), volume: liste.reduce((s, f) => s + (Number(f?.metadata?.size) || 0), 0) };
}

// Dépôt sans écraser : nom reçu, sinon préfixé « AAMMJJHHMMSS- » (heure de réception), puis numéroté.
async function deposerPiece(sb: Sb, id: string, nom: string, octets: ArrayBuffer, type: string, pris: Set<string>, prefixe: string): Promise<string> {
  const candidats = [nom, `${prefixe}-${nom}`, ...Array.from({ length: 8 }, (_, k) => `${prefixe}-${k + 2}-${nom}`)];
  for (const c of candidats) {
    if (pris.has(c)) continue;
    const { error } = await sb.storage.from("dossiers").upload(`${id}/client/${c}`, octets, { contentType: type, upsert: false });
    if (!error) { pris.add(c); return c; }
    if (/exist|duplicate|409/i.test(`${error.message ?? ""} ${error.statusCode ?? ""}`)) { pris.add(c); continue; }
    throw new Error(`dépôt de ${id}/client/${c} : ${error.message ?? "erreur"}`);
  }
  throw new Error(`dépôt de ${nom} : aucun nom disponible`);
}

// Extension retenue : celle du nom si elle est acceptée ; un autre format (docx, zip, exe…) est écarté ; sans
// extension (ou avec une fin numérique, « Scan 13.10.2026 »), d'après le type annoncé.
function extensionPiece(nom: string, type: string): string {
  const ext = (/\.([a-z0-9]{1,5})$/i.exec(nom)?.[1] ?? "").toLowerCase();
  if (Object.hasOwn(TYPES_PIECES, ext)) return ext;
  if (ext && !/^[0-9]+$/.test(ext)) return "";
  const t = type.toLowerCase().split(";")[0].trim();
  return Object.keys(TYPES_PIECES).find((k) => TYPES_PIECES[k] === t) ?? "";
}

// Nom de fichier sûr : accents retirés, caractères spéciaux remplacés, extension retenue en fin de nom.
function nomSur(nom: string, ext: string): string {
  const base = nom.replace(new RegExp(`\\.${ext}$`, "i"), "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "piece";
  return `${base}.${ext}`;
}

// Pièce intégrée au texte de l'e-mail : Content-Disposition « inline », ou référencée par un Content-ID sans être
// déclarée comme pièce jointe.
function estIntegree(x: Json): boolean {
  const d = String(x?.content_disposition ?? "").trim().toLowerCase();
  return d === "inline" || (d !== "attachment" && !!x?.content_id);
}

const normCid = (v: unknown) => String(v ?? "").trim().replace(/^<|>$/g, "").toLowerCase();

// Images intégrées du HTML reçu (src="cid:…") : toutes, et celles de la réponse (au-dessus de la citation, repérée
// comme pour le texte). null sans HTML ni image intégrée.
function imagesDuHtml(html: string | null): { toutes: Set<string>; reponse: Set<string> } | null {
  if (!html) return null;
  const marque = texteDepuisHtml(html.slice(0, MAX_BRUT), true);
  const cids = (t: string) => new Set([...t.matchAll(/\u0001([^\u0001]{1,300})\u0001/g)].map((m) => normCid(m[1])));
  const toutes = cids(marque);
  return toutes.size ? { toutes, reponse: cids(sansCitation(marque)) } : null;
}

// En-têtes de l'e-mail reçu (objet ou liste), clés en minuscules, valeurs en liste.
function enTetes(h: unknown): Record<string, string[]> {
  const r: Record<string, string[]> = {};
  const ajoute = (k: unknown, v: unknown) => {
    const cle = String(k ?? "").trim().toLowerCase();
    if (cle) (r[cle] ??= []).push(...(Array.isArray(v) ? v : [v]).map((x) => String(x ?? "")));
  };
  if (Array.isArray(h)) for (const x of h as Json[]) ajoute(x?.name ?? x?.key, x?.value);
  else if (h && typeof h === "object") for (const [k, v] of Object.entries(h)) ajoute(k, v);
  return r;
}

// Réponse automatique (absence, accusé de lecture, liste de diffusion) : Auto-Submitted autre que « no »,
// X-Autoreply, X-Autorespond, Precedence bulk / auto_reply / list.
function reponseAutomatique(e: Record<string, string[]>): boolean {
  const valeurs = (k: string) => (e[k] ?? []).map((v) => v.trim().toLowerCase());
  if (valeurs("auto-submitted").some((v) => v && !/^no\b/.test(v))) return true;
  if (e["x-autoreply"] || e["x-autorespond"]) return true;
  return valeurs("precedence").some((v) => ["bulk", "auto_reply", "list"].includes(v));
}

// Authentification de l'expéditeur, d'après les résultats calculés par le serveur de réception de Resend (jamais
// d'après des en-têtes du message, que l'expéditeur écrit lui-même) : DMARC « pass », ou DKIM « pass » (pour Resend :
// signature valable d'un domaine identique à celui de l'adresse From ; DMARC reste « gray » pour un domaine en
// p=none, comme gmail.com, outlook.com ou hotmail.fr). DMARC « fail » refuse. SPF seul ne suffit pas : il porte sur
// l'enveloppe, pas sur l'adresse From.
function authentifie(auth: { spf: string | null; dkim: string | null; dmarc: string | null }): boolean {
  if (auth.dmarc === "fail") return false;
  return auth.dmarc === "pass" || auth.dkim === "pass";
}

// SPF, DKIM et DMARC tous en échec : e-mail sans doute forgé, l'agence n'en est pas prévenue par e-mail.
function echecTotal(auth: { spf: string | null; dkim: string | null; dmarc: string | null }): boolean {
  return auth.spf === "fail" && auth.dkim === "fail" && auth.dmarc === "fail";
}

function resultat(v: unknown): string | null {
  const s = String(v ?? "").trim().toLowerCase();
  return s ? s.slice(0, 40) : null;
}

// Adresse de l'expéditeur, seulement si elle est simple et la même dans le champ « from » de Resend et dans l'en-tête
// From du message (un seul) ; sinon vide : le message est à vérifier. Une partie locale entre guillemets
// ("client@exemple.fr"@pirate.example), un commentaire ou plusieurs adresses ne sont jamais réduits à une adresse :
// DMARC et DKIM portent sur le domaine de l'adresse entière.
function expediteurSur(champ: unknown, from: string[] | undefined): string {
  const deChamp = adresseDe(champ);
  const deEntete = from && from.length === 1 ? adresseDe(from[0]) : "";
  return deChamp && deChamp === deEntete ? deChamp : "";
}

// « adresse » ou « Nom <adresse> » (contenu du dernier <…>, rien après) → adresse simple en minuscules, sinon vide.
function adresseDe(v: unknown): string {
  const s = String(v ?? "").slice(0, 1000).trim();
  const i = s.lastIndexOf("<");
  if (i < 0) return adresseSimple(s);
  const j = s.indexOf(">", i);
  return j > i && !s.slice(j + 1).trim() ? adresseSimple(s.slice(i + 1, j)) : "";
}

// Adresse simple (RFC 5322 dot-atom) : caractères autorisés hors guillemets, un seul @, domaine à points.
function adresseSimple(v: string): string {
  const s = v.trim().toLowerCase();
  return s.length <= 254 && /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(s) ? s : "";
}

// Dossier destinataire : première adresse de réponse valable parmi « to », « cc » puis « received_for » (découpage
// simple, en temps linéaire, des valeurs « Nom <adresse> »).
async function dossierDestinataire(data: Json): Promise<string | null> {
  if (!JETON_SECRET || !REPONSES_DOMAINE) return null;
  for (const liste of [data?.to, data?.cc, data?.received_for]) {
    for (const brut of (Array.isArray(liste) ? liste : liste ? [liste] : []).slice(0, 50)) {
      for (const a of String(brut).toLowerCase().slice(0, 2000).split(/[\s<>"',;:]+/)) {
        const m = /^d([0-9]{12})-([0-9a-f]{20})@([a-z0-9.-]{1,253})$/.exec(a);
        if (m && m[3] === REPONSES_DOMAINE && egalConstant(m[2], await macReponse(m[1]))) return m[1];
      }
    }
  }
  return null;
}

// Texte de l'e-mail reçu : partie texte, sinon HTML converti en texte (200 000 caractères analysés au plus).
function texteComplet(email: Json): string {
  const texte = typeof email?.text === "string" ? email.text.slice(0, MAX_BRUT) : "";
  const t = texte.trim() ? texte : typeof email?.html === "string" ? texteDepuisHtml(email.html.slice(0, MAX_BRUT)) : "";
  return propre(t.replace(/\r\n?/g, "\n"), 100000);
}

// HTML → texte, en temps linéaire (le contenu reçu peut être fait pour ralentir des expressions régulières) :
// commentaires et blocs head, style, script et title retirés par un balayage, balises sans « < » ni « > » intérieurs,
// espaces de fin de ligne retirés ligne par ligne. marquer : images intégrées (src="cid:…") remplacées par un repère
// \u0001<cid>\u0001 (repérage des images de l'e-mail cité, jamais enregistré).
function texteDepuisHtml(html: string, marquer = false): string {
  let t = retirerBlocs(html)
    .replace(/<blockquote\b[^<>]*>/gi, "\n> ")                      // début de citation : repère pour la coupure
    .replace(/<hr\b[^<>]*>/gi, "\n________________________________\n")
    .replace(/<br\b[^<>]*>/gi, "\n")
    .replace(/<li\b[^<>]*>/gi, "\n- ")
    .replace(/<\/(?:p|div|li|tr|h[1-6]|table|blockquote|ul|ol)\s*>/gi, "\n");
  if (marquer) t = t.replace(/<img\b[^<>]*?\bsrc\s*=\s*["']?cid:([^"'\s<>]{1,300})[^<>]*>/gi, (_m, c: string) => ` \u0001${c}\u0001 `);
  return decoderEntites(t.replace(/<[^<>]*>/g, "")).split("\n").map((l) => l.trimEnd()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Commentaires et blocs head, style, script, title retirés en un seul balayage. Un commentaire, un style, un script ou
// un titre non fermés courent jusqu'à la fin (comme dans un navigateur) ; une balise head non fermée est laissée.
function retirerBlocs(html: string): string {
  const bas = html.toLowerCase();
  const fins: Record<string, number> = {};   // dernière balise fermante de chaque bloc (évite de chercher en vain)
  let r = "", i = 0;
  while (i < html.length) {
    const j = bas.indexOf("<", i);
    if (j < 0) { r += html.slice(i); break; }
    r += html.slice(i, j);
    if (bas.startsWith("<!--", j)) {
      const k = bas.indexOf("-->", j + 4);
      i = k < 0 ? html.length : k + 3;
      continue;
    }
    const nom = /^<(head|style|script|title)\b/.exec(bas.slice(j, j + 8))?.[1];
    if (nom) {
      fins[nom] ??= bas.lastIndexOf(`</${nom}`);
      const k = fins[nom] > j ? bas.indexOf(`</${nom}`, j + 1) : -1;
      if (k >= 0) {
        const g = bas.indexOf(">", k);
        i = g < 0 ? html.length : g + 1;
        continue;
      }
      if (nom !== "head") { i = html.length; continue; }
    }
    r += "<";
    i = j + 1;
  }
  return r;
}

const ENTITES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", laquo: "«", raquo: "»", rsquo: "’", lsquo: "‘", ldquo: "“",
  rdquo: "”", hellip: "…", ndash: "–", mdash: "—", euro: "€", deg: "°", eacute: "é", egrave: "è", ecirc: "ê", euml: "ë",
  agrave: "à", acirc: "â", ccedil: "ç", icirc: "î", iuml: "ï", ocirc: "ô", ugrave: "ù", ucirc: "û", uuml: "ü", oelig: "œ",
  Eacute: "É", Egrave: "È", Ecirc: "Ê", Agrave: "À", Acirc: "Â", Ccedil: "Ç", Ocirc: "Ô", OElig: "Œ",
};
function decoderEntites(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, (tout, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : tout;
    }
    return ENTITES[e] ?? tout;
  });
}

// Réponse sans la citation de l'e-mail d'origine : texte au-dessus de la première ligne de citation (« > »,
// « Le … a écrit : », « On … wrote: », « De : », « From: », « -----Original Message----- », « ----- Mail original ----- »,
// « Message du JJ/MM/AA … », « Envoyé de mon … », « Obtenir Outlook pour iOS »).
// Réponse écrite sous la citation : lignes citées et attribution retirées.
function sansCitation(complet: string): string {
  const lignes = complet.replace(/\r\n?/g, "\n").split("\n");
  const coupe = (ls: string[]) => {
    for (let i = 0; i < ls.length; i++) if (estCoupure(ls[i], ls[i + 1] ?? "")) return ls.slice(0, i);
    return ls;
  };
  let r = nettoyer(coupe(lignes));
  if (!r && lignes.some((l) => /^\s*>/.test(l.slice(0, MAX_LIGNE)))) {
    const hors: string[] = [];
    for (let i = 0; i < lignes.length; i++) {
      if (/^\s*>/.test(lignes[i].slice(0, MAX_LIGNE))) continue;
      const n = attribution(lignes[i], lignes[i + 1] ?? "");
      if (n) { i += n - 1; continue; }
      hors.push(lignes[i]);
    }
    r = nettoyer(coupe(hors));
  }
  return r;
}

// « Le lun. 13 oct. 2026 à 10:00, Atomes studio <contact@atomes.studio> a écrit : » (ou « On … wrote: »), parfois
// coupée sur deux lignes : nombre de lignes occupées (0 si ce n'est pas une attribution). Lignes examinées sur 2 000
// caractères au plus.
function attribution(ligne: string, suivante: string): number {
  const l = ligne.slice(0, MAX_LIGNE), s = suivante.slice(0, MAX_LIGNE);
  const fr = /^\s*Le\s.+\sa\s+écrit\s*:\s*$/i, en = /^\s*On\s.+\swrote\s*:\s*$/i;
  if (fr.test(l) || en.test(l)) return 1;
  const deux = `${l.trimEnd()} ${s.trim()}`;
  if ((/^\s*Le\s/i.test(l) && fr.test(deux)) || (/^\s*On\s/i.test(l) && en.test(deux))) return 2;
  return 0;
}

function estCoupure(ligne: string, suivante: string): boolean {
  const l = ligne.slice(0, MAX_LIGNE);
  return /^\s*>/.test(l) || attribution(l, suivante) > 0
    || /^\s*(?:\*\s*)?(?:De|From)\s*:\s*\S/i.test(l)
    || /^\s*-{2,}\s*(?:Original Message|Message d'origine|Message original|Mail original|Forwarded message|Message transféré)\s*-{2,}\s*$/i.test(l)
    || /^\s*Message du \d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+(?:à\s+)?\d{1,2}[:h]\d{2})?\s*$/i.test(l)
    || /^\s*_{10,}\s*$/.test(l)
    || /^\s*(?:Envoyé de mon|Envoyé depuis mon|Sent from my)\s/i.test(l)
    || /^\s*(?:Obtenir|Get) Outlook (?:pour|for) (?:iOS|Android)\s*$/i.test(l);
}

// Espaces de fin de ligne retirés, séparateurs (« -- », « ____ ») et lignes vides retirés en fin de réponse (jamais
// la première ligne), trois retours à la ligne ou plus réduits à deux. Temps linéaire.
function nettoyer(lignes: string[]): string {
  const ls = lignes.map((l) => l.trimEnd());
  while (ls.length > 1 && (!ls[ls.length - 1] || /^\s*[-_]{2,}$/.test(ls[ls.length - 1]))) ls.pop();
  return ls.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function reponseWebhook(corps: unknown, statut: number): Response {
  return new Response(JSON.stringify(corps), { status: statut, headers: { "Content-Type": "application/json" } });
}

// ---------- Jetons des liens d'action et adresses de réponse -------------------
// Jeton = base64url(JSON { a: action, p: dossier, e: expiration en secondes, d?: 16 premiers caractères de
// l'empreinte du devis }) + « . » + base64url(HMAC-SHA256(JETON_SECRET, première partie)). Sans état : un nouveau
// devis invalide les liens de signature des versions précédentes (d).

function secretJetons(v: string): string {
  const s = v.trim();
  if (s && s.length < 32) console.error("JETON_SECRET trop court (32 caractères au moins) : liens d'action et adresses de réponse désactivés");
  return s.length >= 32 ? s : "";
}

async function creerJeton(a: string, p: string, e: number, d?: string): Promise<string> {
  const charge = b64url(new TextEncoder().encode(JSON.stringify(d ? { a, p, e, d } : { a, p, e })));
  return `${charge}.${b64url(await hmac(JETON_SECRET, charge))}`;
}

async function lireJeton(jeton: string): Promise<{ charge: Charge; expire: boolean }> {
  const m = /^([A-Za-z0-9_-]{10,2000})\.([A-Za-z0-9_-]{43})$/.exec(jeton);
  if (!m || !egalConstant(m[2], b64url(await hmac(JETON_SECRET, m[1])))) throw new Refus(LIEN_INVALIDE);
  let charge: Charge;
  try { charge = JSON.parse(new TextDecoder().decode(deB64url(m[1]))); } catch { throw new Refus(LIEN_INVALIDE); }
  if (!charge || typeof charge !== "object" || !["signer", "valider", "renoncer"].includes(charge.a) || !/^[0-9]{12}$/.test(String(charge.p))
    || !Number.isSafeInteger(charge.e) || (charge.d !== undefined && !/^[0-9a-f]{16}$/.test(String(charge.d)))) {
    throw new Refus(LIEN_INVALIDE);
  }
  return { charge, expire: Math.floor(Date.now() / 1000) > charge.e };
}

// Lien vers la page d'action ; le jeton est dans le fragment (jamais envoyé au serveur de pages ni dans le Referer).
async function lienAction(base: string, a: string, id: string, e: number, d?: string): Promise<string> {
  return `${base}/action/#t=${await creerJeton(a, id, e, d)}`;
}

// Lien de rétractation (particulier, devis signé, non rétracté, dans le délai), valable jusqu'à la fin du délai et
// lié au contrat en cours (d) : après un nouveau devis signé, le lien d'un contrat précédent ne vaut plus.
async function lienRenoncer(projet: Projet, base: string): Promise<{ url: string; date_limite: string } | null> {
  if (!JETON_SECRET || !estParticulier(projet) || !projet.signe_le || projet.retracte_le) return null;
  const fin = finRetractation(projet.signe_le);
  if (Date.now() > fin.getTime()) return null;
  return {
    url: await lienAction(base, "renoncer", projet.id, Math.floor(fin.getTime() / 1000), await empreinteContrat(projet)),
    date_limite: dernierJourRetractation(projet.signe_le),
  };
}

// Empreinte du contrat en cours (jeton de rétractation, d) : 16 premiers caractères hexadécimaux de
// SHA-256(date de signature + empreinte du devis signé).
async function empreinteContrat(projet: Projet): Promise<string> {
  const le = projet.signe_le ? new Date(projet.signe_le).toISOString() : "";
  const octets = new TextEncoder().encode(le + (projet.signe_empreinte ?? ""));
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", octets))).slice(0, 16);
}

// Adresse de réponse du dossier : d<id>-<mac>@REPONSES_DOMAINE, mac = 20 premiers caractères hexadécimaux de
// HMAC-SHA256(JETON_SECRET, "reponse:" + id). Sans configuration : MAIL_AGENCE.
async function macReponse(id: string): Promise<string> {
  return hex(await hmac(JETON_SECRET, `reponse:${id}`)).slice(0, 20);
}

// Ancienne adresse de réponse du dossier (plus donnée comme adresse de réponse ; encore reçue par le webhook tant
// que REPONSES_DOMAINE est configuré).
async function adresseDossier(id: string): Promise<string> {
  return JETON_SECRET && REPONSES_DOMAINE ? `d${id}-${await macReponse(id)}@${REPONSES_DOMAINE}` : MAIL_AGENCE;
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const cle = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cle, new TextEncoder().encode(message)));
}

function base64(octets: Uint8Array): string {
  let s = "";
  for (let i = 0; i < octets.length; i += 0x8000) s += String.fromCharCode(...octets.subarray(i, i + 0x8000));
  return btoa(s);
}

function b64url(octets: Uint8Array): string {
  return base64(octets).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function deB64url(s: string): Uint8Array {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(t + "===".slice((t.length + 3) % 4)), (c) => c.charCodeAt(0));
}

// ---------- Délai de rétractation (particulier) ----------------------------------
// 14 jours à compter de la signature (le jour de la signature ne compte pas) ; dernier jour reporté au premier
// jour ouvrable s'il tombe un samedi, un dimanche ou un jour férié ; fin à 23:59:59, heure de Paris.

function dernierJourRetractation(signeLe: string | Date): string {
  const [a, m, j] = jourParis(new Date(signeLe));
  for (let t = Date.UTC(a, m - 1, j + 14); ; t += 86400000) {
    const d = new Date(t), iso = d.toISOString().slice(0, 10);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !joursFeries(d.getUTCFullYear()).has(iso)) return iso;
  }
}

function finRetractation(signeLe: string | Date): Date {
  const [a, m, j] = dernierJourRetractation(signeLe).split("-").map(Number);
  return new Date(instantParis(a, m, j, 23, 59, 59).getTime() + 999);
}

// Jours fériés français : 1er janvier, lundi de Pâques, 1er mai, 8 mai, Ascension, lundi de Pentecôte, 14 juillet,
// 15 août, 1er novembre, 11 novembre, 25 décembre.
function joursFeries(annee: number): Set<string> {
  const pq = paques(annee), jour = 86400000;
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  return new Set([
    `${annee}-01-01`, iso(pq + jour), `${annee}-05-01`, `${annee}-05-08`, iso(pq + 39 * jour), iso(pq + 50 * jour),
    `${annee}-07-14`, `${annee}-08-15`, `${annee}-11-01`, `${annee}-11-11`, `${annee}-12-25`,
  ]);
}

// Dimanche de Pâques (algorithme grégorien anonyme), en millisecondes UTC.
function paques(y: number): number {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return Date.UTC(y, Math.floor(n / 31) - 1, (n % 31) + 1);
}

// Date et heure de Paris d'un instant : [année, mois, jour, heure, minute, seconde].
function partiesParis(d: Date): number[] {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(d);
  const v = (t: string) => Number(parts.find((x) => x.type === t)?.value ?? 0);
  return [v("year"), v("month"), v("day"), v("hour"), v("minute"), v("second")];
}

function jourParis(d: Date): [number, number, number] {
  const [a, m, j] = partiesParis(d);
  return [a, m, j];
}

// Instant correspondant à une heure de Paris (décalage d'hiver ou d'été de ce jour-là).
function instantParis(a: number, m: number, j: number, h: number, mi: number, s: number): Date {
  const voulu = Date.UTC(a, m - 1, j, h, mi, s);
  let t = voulu;
  for (let k = 0; k < 2; k++) {
    const [pa, pm, pj, ph, pmi, ps] = partiesParis(new Date(t));
    t += voulu - Date.UTC(pa, pm - 1, pj, ph, pmi, ps);
  }
  return new Date(t);
}

// AAMMJJHHMMSS à l'heure de Paris (préfixe des pièces jointes homonymes).
function idParis(d: Date): string {
  const [a, m, j, h, mi, s] = partiesParis(d);
  return [a % 100, m, j, h, mi, s].map((x) => String(x).padStart(2, "0")).join("");
}

// ---------- Outils -----------------------------------------------------------

async function chargerProjet(sb: Sb, id: string): Promise<Projet | null> {
  if (!/^[0-9]{12}$/.test(id)) return null;
  const { data, error } = await sb.from("projets").select("*, etapes(*), questions(*)").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  data.etapes = (data.etapes ?? []).sort((a: Etape, b: Etape) => a.ordre - b.ordre);
  data.questions = data.questions ?? [];
  data.envois_echoues = Array.isArray(data.envois_echoues) ? data.envois_echoues : [];
  return data as Projet;
}

// Dossier relu après une écriture (timeline recalculée par le déclencheur) ; à défaut, valeurs locales.
async function relire(sb: Sb, projet: Projet, maj: Partial<Projet>): Promise<Projet> {
  try {
    const relu = await chargerProjet(sb, projet.id);
    if (relu) return relu;
  } catch (e) {
    console.error("relecture du dossier", projet.id, e);
  }
  return { ...projet, ...maj };
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

// Étapes visibles par le client (optionnelles seulement avec l'option de suivi).
function timelinePublique(projet: Projet) {
  return projet.etapes.filter((e) => !e.optionnelle || projet.suivi_administratif).map((e) => ({
    cle: e.cle, libelle: e.libelle, statut: e.statut, fait_le: e.fait_le, debut_le: e.debut_le ?? null, courante: e.cle === projet.etape,
  }));
}

// Particulier sauf profil « Professionnel » explicite (les protections du consommateur s'appliquent par défaut).
function estParticulier(projet: Projet): boolean {
  return projet.profil !== "Professionnel";
}

function typeAffiche(projet: Projet): string {
  return projet.type === "Autre" && projet.precisions?.type ? `Autre : ${projet.precisions.type}` : projet.type;
}

// Documents de l'agence (<id>/agence/), sans les repères de dossier ni les devis ; liens signés valables 1 h.
async function documentsAgence(sb: Sb, projet: Projet, avecLiens: boolean): Promise<Doc[]> {
  const { data, error } = await sb.storage.from("dossiers").list(`${projet.id}/agence`, { limit: 1000, sortBy: { column: "name", order: "asc" } });
  if (error) throw error;
  const devis = new RegExp(`^devis-${projet.id}-[0-9]{12}\\.pdf$`, "i");
  const docs: Doc[] = ((data ?? []) as Json[])
    .filter((f) => f?.id && f.name && !String(f.name).startsWith(".") && !devis.test(f.name) && `${projet.id}/agence/${f.name}` !== projet.devis_chemin)
    .map((f) => ({ nom: String(f.name), chemin: `${projet.id}/agence/${f.name}`, taille: Number(f.metadata?.size ?? 0), date: f.updated_at ?? f.created_at ?? null }));
  if (!avecLiens) return docs;
  const signes: Doc[] = [];
  for (const d of docs) {
    try { signes.push({ ...d, url: await urlSignee(sb, d.chemin, d.nom) }); }
    catch (e) {
      // Fichier retiré entre-temps : ignoré ; panne passagère : document listé sans lien (« indisponible pour le moment »).
      console.error("lien de document impossible", d.chemin, e instanceof Error ? e.message : e);
      if (e instanceof Refus && e.statut === 503) signes.push(d);
    }
  }
  return signes;
}

// Objet absent du stockage (retiré, jamais déposé), à distinguer d'une panne passagère (503, « Réessayer »).
function absent(error: Json): boolean {
  return /not[ _]?found|does not exist/i.test(`${error?.message ?? ""} ${error?.error ?? ""}`) || String(error?.statusCode ?? "") === "404" || error?.status === 404;
}

async function urlSignee(sb: Sb, chemin: string, telecharger?: string): Promise<string> {
  const { data, error } = await sb.storage.from("dossiers").createSignedUrl(chemin, 3600, telecharger ? { download: telecharger } : undefined);
  if (data?.signedUrl) return data.signedUrl;
  if (!error || absent(error)) throw new Refus("Document introuvable : écrivez-nous à contact@atomes.studio", 404);
  throw new Refus(STOCKAGE_INDISPONIBLE, 503);
}

// Devis lu dans le stockage : contenu (pièce jointe des e-mails) et empreinte SHA-256 (hexadécimal).
async function empreinteFichier(sb: Sb, chemin: string): Promise<{ octets: ArrayBuffer; empreinte: string }> {
  const { data, error } = await sb.storage.from("dossiers").download(chemin);
  if (!data) {
    if (!error || absent(error)) throw new Refus("Devis introuvable dans les documents de l'agence", 404);
    throw new Refus(STOCKAGE_INDISPONIBLE, 503);
  }
  const octets: ArrayBuffer = await data.arrayBuffer();
  return { octets, empreinte: hex(new Uint8Array(await crypto.subtle.digest("SHA-256", octets))) };
}

// Adresse IP du client pour la preuve (signature, rétractation) : celle qu'ajoute la plateforme (CF-Connecting-IP,
// sinon dernier élément de X-Forwarded-For, que le relais complète), suivie de la chaîne X-Forwarded-For entière
// quand elle contient d'autres valeurs : une valeur écrite par le client n'est jamais retenue seule comme son adresse.
function ipClient(req: Request): string | null {
  const chaine = (req.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(-10);
  const ip = (req.headers.get("cf-connecting-ip") ?? "").trim() || chaine[chaine.length - 1] || "";
  if (!ip) return null;
  return propre(chaine.some((x) => x !== ip) ? `${ip} (X-Forwarded-For : ${chaine.join(", ")})` : ip, 300);
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

// Adresse e-mail saisie (rétractation) : une seule adresse, sans virgule, point-virgule, chevrons ni guillemets.
const EMAIL = /^[^@\s,;<>"'()]+@[^@\s,;<>"'()]+\.[^@\s,;<>"'()]+$/;

// Coordonnées bancaires (secrets VIREMENT_*), contrôlées au chargement : IBAN (clé de contrôle modulo 97) et titulaire
// obligatoires ensemble (la banque du client vérifie le nom du bénéficiaire), BIC facultatif mais bien formé. Sinon
// rien n'est affiché (« Les coordonnées bancaires figurent sur votre devis. ») et l'erreur est journalisée : un IBAN
// mal recopié ne doit jamais partir chez un client.
function coordonneesVirement(): { iban: string; bic: string; titulaire: string } {
  const iban = (Deno.env.get("VIREMENT_IBAN") ?? "").replace(/\s+/g, "").toUpperCase();
  const bic = (Deno.env.get("VIREMENT_BIC") ?? "").replace(/\s+/g, "").toUpperCase();
  const titulaire = (Deno.env.get("VIREMENT_TITULAIRE") ?? "").trim().slice(0, 140);
  const aucun = { iban: "", bic: "", titulaire: "" };
  if (!iban && !bic && !titulaire) return aucun;
  if (!ibanValide(iban)) { console.error("VIREMENT_IBAN absent ou invalide (format ou clé de contrôle) : coordonnées bancaires non affichées"); return aucun; }
  if (!titulaire) { console.error("VIREMENT_TITULAIRE absent : coordonnées bancaires non affichées"); return aucun; }
  if (bic && !/^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/.test(bic)) { console.error("VIREMENT_BIC mal formé : BIC non affiché"); return { iban, bic: "", titulaire }; }
  return { iban, bic, titulaire };
}

// IBAN (ISO 13616) : 2 lettres, 2 chiffres de contrôle, 11 à 30 caractères ; reste de la division par 97 égal à 1.
function ibanValide(iban: string): boolean {
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  let reste = 0;
  for (const c of iban.slice(4) + iban.slice(0, 4)) {
    const v = c >= "A" ? String(c.charCodeAt(0) - 55) : c;
    for (const chiffre of v) reste = (reste * 10 + Number(chiffre)) % 97;
  }
  return reste === 1;
}

// « 480 », « 480,5 », « 1 200,00 », « 480.50 » → centimes ; entre 1 € et 100 000 €.
function montantCents(v: unknown): number | null {
  const s = String(v ?? "").replace(/[\s\u00a0\u202f€]/g, "").replace(",", ".");
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

function ibanLisible(iban: string): string {
  return iban.replace(/(.{4})(?=.)/g, "$1 ");
}

// « 1 octobre » → « 1er octobre ».
const premier = (s: string) => s.replace(/(^|\s)1(\s)/, "$11er$2");

function dateParis(d: Date): string {
  return premier(new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", dateStyle: "long", timeStyle: "short" }).format(d));
}

// « 12 octobre » (année ajoutée si ce n'est pas l'année en cours).
function dateCourte(v: string): string {
  const d = new Date(v);
  const annee = (x: Date) => new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", year: "numeric" }).format(x);
  const autre = annee(d) !== annee(new Date());
  return premier(new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", ...(autre ? { year: "numeric" } : {}) }).format(d));
}

// « AAAA-MM-JJ » → « lundi 26 octobre 2026 ».
function dateJour(iso: string): string {
  const [a, m, j] = iso.split("-").map(Number);
  return premier(new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(Date.UTC(a, m - 1, j))));
}

function dateValide(v: unknown): string | null {
  const t = Date.parse(String(v ?? ""));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
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

async function envoyerMail(m: { to: string[]; subject: string; html: string; replyTo?: string; attachments?: PieceJointe[] }): Promise<boolean> {
  if (!RESEND_KEY) { console.warn("RESEND_API_KEY absent : e-mail non envoyé", m.subject); return false; }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: MAIL_FROM, to: m.to, subject: m.subject.replace(/\s+/g, " ").trim(), html: m.html, reply_to: m.replyTo,
        ...(m.attachments?.length ? { attachments: m.attachments } : {}),
      }),
      signal: AbortSignal.timeout(m.attachments?.length ? 30000 : 10000),
    });
    if (!r.ok) console.error("resend", r.status, await r.text());
    return r.ok;
  } catch (e) {
    console.error("resend", e);
    return false;
  }
}

// E-mail au client : réponse à MAIL_AGENCE (contact@ ; le moteur de l'agence ajoute la réponse au dossier),
// timeline et lien vers l'espace client en pied. Un e-mail qui échoue ne fait jamais échouer l'action (déjà
// enregistrée) : le résultat (faux si l'e-mail n'est pas parti) est renvoyé à l'appelant, qui le signale.
async function mailClient(projet: Projet, sujet: string, titre: string, corps: string, pieces: PieceJointe[] = []): Promise<boolean> {
  return envoyerMail({
    to: [projet.email], replyTo: MAIL_AGENCE, subject: sujet, attachments: pieces,
    html: gabarit(titre, corps + timelineHtml(projet) + p(`<a href="${ESPACE_CLIENT}" style="color:#171512">Suivre mon dossier en ligne</a>`)),
  });
}

const mailAgence = (projet: Projet, sujet: string, titre: string, corps: string) =>
  envoyerMail({ to: [MAIL_AGENCE], replyTo: projet.email, subject: sujet, html: gabarit(`${titre} — dossier ${projet.id}`, corps + p(`<a href="${ESPACE_AGENCE}#${projet.id}" style="color:#171512">Ouvrir le dossier dans l'espace agence</a>`)) });

// Timeline : étapes visibles, marque (✓ faite, ● en cours, ○ à venir), numéro, libellé, date ; étape courante en gras.
function timelineHtml(projet: Projet): string {
  const visibles = projet.etapes.filter((e) => !e.optionnelle || projet.suivi_administratif);
  if (!visibles.length) return "";
  const lignes = visibles.map((e, i) => {
    const courante = e.cle === projet.etape;
    const marque = e.statut === "fait" ? "✓" : e.statut === "en_cours" ? "●" : "○";
    const date = e.statut === "fait" && e.fait_le ? `le ${dateCourte(e.fait_le)}` : e.statut === "en_cours" && e.debut_le ? `depuis le ${dateCourte(e.debut_le)}` : "";
    const style = courante ? "font-weight:bold;color:#141414" : e.statut === "a_venir" ? "color:#8d8d8d" : "color:#3a3a3a";
    const td = (s: string, plus = "") => `<td style="padding:5px 10px 5px 0;vertical-align:top;${style}${plus}">${s}</td>`;
    return `<tr>${td(marque, ";width:14px")}${td(String(i + 1), ";width:18px")}${td(esc(e.libelle))}${td(esc(date), ";padding-right:0;text-align:right;white-space:nowrap")}</tr>`;
  }).join("");
  return `<div style="${KICKER};margin:28px 0 6px">Avancement de votre dossier</div><table role="presentation" style="border-collapse:collapse;width:100%;margin:0 0 18px;font-size:14px;line-height:20px">${lignes}</table>`;
}

// Instructions de virement : montant, coordonnées bancaires (secrets VIREMENT_*), référence = numéro du dossier.
// Une valeur par ligne, sous son libellé (toute la largeur sur un téléphone) ; référence, BIC et groupes de l'IBAN
// jamais coupés.
function virementHtml(projet: Projet): string {
  const entier = (v: string) => v.split(" ").map((x) => `<span style="white-space:nowrap">${esc(x)}</span>`).join(" ");
  const lignes: [string, string][] = [["Montant", esc(montantTexte(projet))]];
  if (VIREMENT.iban) lignes.push(["Titulaire", esc(VIREMENT.titulaire)], ["IBAN", entier(ibanLisible(VIREMENT.iban))], ["BIC", VIREMENT.bic ? entier(VIREMENT.bic) : ""]);
  lignes.push(["Référence à indiquer", `<strong style="white-space:nowrap">${esc(projet.id)}</strong>`]);
  return [
    titreBloc("Règlement par virement"),
    `<div style="margin:8px 0 18px">${lignes.filter(([, v]) => v).map(([k, v]) =>
      `<div style="${KICKER}">${esc(k)}</div><div style="margin:2px 0 12px;font-size:15px;line-height:22px">${v}</div>`).join("")}</div>`,
    VIREMENT.iban ? "" : p("Les coordonnées bancaires figurent sur votre devis."),
    p("Indiquez cette référence dans le libellé de votre virement."),
  ].join("");
}

// Droit de rétractation (particulier) : information, date limite et lien « Renoncer au contrat ici » (après la
// signature), formulaire type (aussi avant la signature, dans l'e-mail du devis : dateLimite nulle, pas de lien).
function retractationHtml(dateLimite: string | null, lien: string): string {
  return [
    titreBloc("Droit de rétractation"),
    p(esc(TEXTES.retractation)),
    dateLimite ? p(`Vous pouvez renoncer au contrat jusqu'au <strong>${esc(dateJour(dateLimite))}</strong> inclus.`) : "",
    lien ? bouton("Renoncer au contrat ici", lien) : "",
    `<div style="margin:0 0 18px;padding:14px 16px;border:1px solid #e3ded4;font-size:13px;line-height:20px;color:#3a3a3a">${TEXTES.formulaire.split("\n").map(esc).join("<br>")}</div>`,
  ].join("");
}

// Preuve de la signature (e-mails « Devis signé ») : date, nom, document, empreinte du PDF signé.
function preuveSignature(projet: Projet): [string, string][] {
  return [
    ["Signé le", projet.signe_le ? dateParis(new Date(projet.signe_le)) : ""], ["Par", projet.signe_nom ?? ""],
    ["Document", (projet.devis_chemin ?? "").split("/").pop() || "devis.pdf"], ["Empreinte SHA-256", projet.signe_empreinte ?? ""],
  ];
}

// Confirmation du contrat (cahier des charges § 5) : envoyée à la signature, puis par l'agence (« Renvoyer ») si elle
// n'est pas partie. pdf : devis signé, joint s'il fait 15 Mo au plus. Faux si l'e-mail n'est pas parti.
async function mailConfirmation(projet: Projet, pdf: ArrayBuffer | null): Promise<boolean> {
  const particulier = estParticulier(projet);
  const fichier = (projet.devis_chemin ?? "").split("/").pop() || "devis.pdf";
  const joint = !!pdf && pdf.byteLength <= MAX_DEVIS_JOINT;
  const renoncer = particulier ? await lienRenoncer(projet, SITE_URL) : null;
  return await mailClient(projet, `Devis signé — dossier ${projet.id}`, "Devis signé", [
    `<h1 style="${H1}">Merci ${esc(projet.prenom)}, votre devis est signé.</h1>`,
    tableau(preuveSignature(projet)),
    p(joint ? "Cet e-mail confirme votre commande&nbsp;: votre devis signé y est joint." : "Cet e-mail confirme votre commande. Votre devis signé est disponible dans votre espace client."),
    particulier && projet.demarrage_anticipe_le ? p(esc(CASE_COCHEE)) : "",
    virementHtml(projet),
    particulier && projet.signe_le ? retractationHtml(dernierJourRetractation(projet.signe_le), renoncer?.url ?? "") : "",
  ].join(""), joint && pdf ? [{ filename: fichier, content: base64(new Uint8Array(pdf)) }] : []);
}

// Accusé de réception de la rétractation : complet (timeline, réponse à l'adresse du dossier) à l'adresse du dossier ;
// à l'adresse saisie, si elle diffère, un envoi séparé, sans timeline, réponse à l'agence (cette adresse est choisie
// par le détenteur du lien). Vrai si l'accusé est parti vers au moins une des deux adresses.
async function mailsAccuse(projet: Projet): Promise<boolean> {
  const sujet = `Rétractation reçue — dossier ${projet.id}`;
  const corps = [
    `<h1 style="${H1}">Votre rétractation est bien reçue.</h1>`,
    p("Nous accusons réception de votre rétractation du contrat suivant&nbsp;:"),
    tableau([
      ["Nom", projet.retracte_nom ?? ""], ["Dossier N°", projet.id], ["Devis signé le", projet.signe_le ? dateParis(new Date(projet.signe_le)) : ""],
      ["Rétractation reçue le", projet.retracte_le ? dateParis(new Date(projet.retracte_le)) : ""],
    ]),
    p("Conservez cet e-mail&nbsp;: il en est la preuve."),
  ].join("");
  const auDossier = await mailClient(projet, sujet, "Accusé de réception", corps);
  const saisie = (projet.retracte_email ?? "").trim().toLowerCase();
  const autre = saisie && saisie !== projet.email.trim().toLowerCase()
    ? await envoyerMail({ to: [saisie], replyTo: MAIL_AGENCE, subject: sujet, html: gabarit("Accusé de réception", corps) })
    : false;
  return auDossier || autre;
}

// E-mails légaux non partis pendant une action par lien : notés dans le dossier (espace agence : « Renvoyer »), retirés
// une fois renvoyés. Une erreur d'écriture est journalisée, sans faire échouer l'action déjà enregistrée.
function echecs(projet: Projet): Echec[] {
  return Array.isArray(projet.envois_echoues) ? projet.envois_echoues.filter((x) => x && typeof x === "object") : [];
}

// Mentions retirées (e-mail renvoyé, ou qui n'a plus lieu d'être) et mention ajoutée (e-mail non parti), en une écriture.
async function majEchecs(sb: Sb, projet: Projet, retirer: string[], ajouter: Echec | null): Promise<void> {
  const avant = echecs(projet);
  const apres = [...avant.filter((x) => !retirer.includes(x.quoi) && x.quoi !== ajouter?.quoi), ...(ajouter ? [ajouter] : [])];
  if (!ajouter && apres.length === avant.length) return;
  try {
    const { error } = await sb.from("projets").update({ envois_echoues: apres }).eq("id", projet.id);
    if (error) throw error;
  } catch (e) {
    console.error("e-mails à renvoyer : dossier non mis à jour", projet.id, ajouter?.quoi ?? retirer.join(","), e);
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const ko = (o: number) => (o >= 1048576 ? (o / 1048576).toFixed(1).replace(".", ",") + " Mo" : Math.max(1, Math.round(o / 1024)) + " Ko");
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
const titreBloc = (s: string) => `<div style="${KICKER};margin:24px 0 6px">${esc(s)}</div>`;
const alerte = (s: string) => `<p style="margin:0 0 14px;padding:12px 14px;border:1px solid #d8896b;font-size:14px;line-height:21px;color:#8a4a2c">${s}</p>`;
const citation = (s: string) => `<div style="margin:0 0 18px;padding:10px 14px;border-left:3px solid #e3ded4;font-size:14px;line-height:21px;color:#3a3a3a;word-break:break-word">${esc(s.slice(0, 5000)).replace(/\n/g, "<br>")}</div>`;
const bouton = (texte: string, url: string) =>
  `<p style="margin:8px 0 26px"><a href="${esc(url)}" style="display:inline-block;background:#171512;color:#ffffff;text-decoration:none;font-size:12px;line-height:16px;letter-spacing:2px;text-transform:uppercase;padding:14px 24px">${esc(texte)}</a></p>`;

// Tableau libellé / valeur (lignes vides omises). Libellé sur 38 % de la largeur, à la ligne si besoin : sur un
// téléphone, la valeur garde la place de s'afficher (une empreinte ou un navigateur se coupent, les dates non).
function tableau(lignes: [string, string][]): string {
  const tr = lignes.filter(([, v]) => v).map(([k, v]) =>
    `<tr><td style="padding:7px 12px 7px 0;${KICKER};width:38%;vertical-align:top">${esc(k)}</td><td style="padding:7px 0;font-size:14px;line-height:21px;vertical-align:top;word-break:break-word">${esc(v).replace(/\n/g, "<br>")}</td></tr>`).join("");
  return `<table style="border-collapse:collapse;width:100%;margin:8px 0 18px">${tr}</table>`;
}
