// =============================================================================
// atomes.studio — fonction « demande » (Supabase Edge Function, Deno)
// Reçoit le formulaire de contact (multipart : champs + pièces jointes) et :
//   1. crée le dossier dans la table projets (id = AAMMJJHHMMSS, heure de Paris),
//      la timeline est créée par le déclencheur SQL ;
//   2. dépose les pièces jointes dans le bucket privé « dossiers/<id>/client/ » ;
//   3. crée le compte client (ou rattache un compte existant) ;
//   4. envoie deux e-mails via Resend : accusé de réception au client,
//      notification à l'agence (même objet que l'ancien FormSubmit).
// Une fois le dossier créé, la réponse est toujours ok:true ; les échecs partiels
// (pièce non déposée, e-mail non envoyé, compte non créé) sont signalés dedans :
//   { ok: true, id: "261012173615", fichiers: 2, fichiers_echoues: [], compte: true,
//     mails: { client: true, agence: true } }
//
// Secrets (Edge Functions → Secrets) : RESEND_API_KEY ; facultatifs MAIL_AGENCE,
// MAIL_FROM, SITE_URL, ORIGINES_AUTORISEES. SUPABASE_URL et
// SUPABASE_SERVICE_ROLE_KEY sont fournis automatiquement.
// =============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
// Clé serveur : SB_SECRET_KEY (clé « secret » sb_secret_…, à définir dans les secrets) ou, à défaut,
// la clé service_role historique fournie automatiquement.
const SERVICE_KEY = Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const MAIL_AGENCE = Deno.env.get("MAIL_AGENCE") ?? "contact@atomes.studio";
const MAIL_FROM = Deno.env.get("MAIL_FROM") ?? "Atomes studio <contact@atomes.studio>";
const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://atomes.studio").replace(/\/$/, "");
const ORIGINES = (Deno.env.get("ORIGINES_AUTORISEES") ??
  `${SITE_URL},https://www.atomes.studio,http://localhost:3000`).split(",").map((s) => s.trim());

const MAX_FICHIERS = 10;
const MAX_TOTAL = 10 * 1024 * 1024;          // 10 Mo au total, comme le formulaire
const MAX_ESSAIS_ID = 10;
const MAX_PAR_EMAIL_24H = 3;                 // limites simples contre les envois en masse
const MAX_GLOBAL_1H = 30;

// Valeurs fermées du formulaire (doivent rester identiques à contact.html).
const TYPES = ["Construction", "Rénovation", "Extension", "Démolition", "Aménagement intérieur", "Aménagement extérieur", "Autre"];
const DOCS = ["Permis de construire", "Déclaration préalable", "Permis d'aménager", "Permis de démolir", "Dossier de consultation des entreprises", "Perspective", "Réalisation de plans", "Avis d'architecte / étude simple", "Autre", "Je ne sais pas encore"];
// États possibles du bien selon le type de projet (mêmes règles que contact.js).
const BIENS_PAR_TYPE: Record<string, string[]> = {
  "Construction": ["Terrain nu", "Terrain bâti", "Autre"],
  "Rénovation": ["Maison", "Appartement", "Immeuble", "Local ou bâtiment pro", "Annexe, dépendance ou garage", "Autre"],
  "Extension": ["Maison", "Appartement", "Immeuble", "Local ou bâtiment pro", "Annexe, dépendance ou garage", "Autre"],
  "Démolition": ["Maison", "Immeuble", "Local ou bâtiment pro", "Annexe, dépendance ou garage", "Autre"],
  "Aménagement intérieur": ["Maison", "Appartement", "Immeuble", "Local ou bâtiment pro", "Annexe, dépendance ou garage", "Autre"],
  "Aménagement extérieur": ["Maison", "Appartement", "Immeuble", "Local ou bâtiment pro", "Terrain nu", "Autre"],
  "Autre": ["Terrain nu", "Terrain bâti", "Maison", "Appartement", "Immeuble", "Local ou bâtiment pro", "Annexe, dépendance ou garage", "Autre"],
};
const BIENS = ["Terrain nu", "Terrain bâti", "Maison", "Appartement", "Immeuble", "Local ou bâtiment pro", "Annexe, dépendance ou garage", "Autre"];
// Précisions libres saisies pour les choix « Autre » (champs du formulaire → clés enregistrées).
const PRECISIONS: [string, string][] = [["typeAutre", "type"], ["bienAutre", "bien"], ["docsAutre", "documents"], ["calendrierAutre", "calendrier"], ["sourceAutre", "source"]];
const CALENDRIERS = ["Dès que possible", "Dans 3 à 6 mois", "Dans 6 à 12 mois", "Plus tard", "Pas encore défini", "Autre"];
const SOURCES = ["Instagram", "Recherche Google", "Bouche-à-oreille", "Un projet vu sur place", "Autre"];
// Extensions acceptées → type de contenu enregistré (le type annoncé par le navigateur ne fait pas foi).
const EXTENSIONS: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
  heic: "image/heic", heif: "image/heif", pdf: "application/pdf",
};

type Demande = {
  profil: string; societe: string; activite: string; prenom: string; nom: string; email: string; telephone: string;
  type: string; docs: string[]; adresse: string; commune: string; codePostal: string; cadastre: string; bien: string;
  surface: string; surfaceExistante: string; empriseExistante: string; emprise: string; surfaceTerrain: string;
  budget: string; calendrier: string; message: string; source: string;
  precisions: Record<string, string>;
};
type Depose = { nom: string; chemin: string; taille: number };

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin") ?? "");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, erreur: "Méthode non autorisée" }, 405, cors);

  // Taille annoncée vérifiée avant de lire le corps (marge pour les champs texte et les en-têtes multipart).
  const taille = Number(req.headers.get("content-length") ?? 0);
  if (taille > MAX_TOTAL + 512 * 1024) return json({ ok: false, erreur: "Pièces jointes trop lourdes (10 Mo max au total)" }, 413, cors);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ ok: false, erreur: "Formulaire illisible" }, 400, cors);
  }

  // Pot de miel : un robot a rempli le champ caché → on répond « ok » sans rien faire.
  if (texte(form, "_honey", 200)) return json({ ok: true, id: null }, 200, cors);

  const profil = texte(form, "profil", 40) === "Professionnel" ? "Professionnel" : "Particulier";
  const d: Demande = {
    profil,
    societe: profil === "Professionnel" ? texte(form, "societe", 200) : "",
    activite: profil === "Professionnel" ? texte(form, "activite", 200) : "",
    prenom: texte(form, "prenom", 120), nom: texte(form, "nom", 120),
    email: texte(form, "email", 200).toLowerCase(), telephone: texte(form, "telephone", 40),
    type: choix(form, "type", TYPES),
    docs: form.getAll("docs").map((v) => propre(String(v), 80)).filter((v) => DOCS.includes(v)).slice(0, DOCS.length).sort((a, b) => DOCS.indexOf(a) - DOCS.indexOf(b)),
    adresse: texte(form, "adresse", 300), commune: texte(form, "commune", 120), codePostal: texte(form, "codePostal", 10),
    cadastre: texte(form, "cadastre", 120), bien: choix(form, "bien", BIENS),
    surface: nombre(form, "surface"), surfaceExistante: nombre(form, "surfaceExistante"),
    empriseExistante: nombre(form, "empriseExistante"), emprise: nombre(form, "emprise"), surfaceTerrain: nombre(form, "surfaceTerrain"),
    budget: "", calendrier: choix(form, "calendrier", CALENDRIERS),
    message: texte(form, "message", 5000), source: choix(form, "source", SOURCES),
    precisions: {},
  };
  // Précisions libres, gardées seulement pour les choix « Autre » ; obligatoires sauf pour la source.
  const autre: Record<string, boolean> = {
    type: d.type === "Autre", bien: d.bien === "Autre", documents: d.docs.includes("Autre"),
    calendrier: d.calendrier === "Autre", source: d.source === "Autre",
  };
  for (const [champ, cle] of PRECISIONS) {
    const v = texte(form, champ, 200);
    if (autre[cle] && v) d.precisions[cle] = v;
  }

  const invalides: string[] = [];
  if (!d.prenom) invalides.push("prenom");
  if (!d.nom) invalides.push("nom");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) invalides.push("email");
  if (!d.type) invalides.push("type");
  if (!d.docs.length) invalides.push("docs");
  if (!d.commune) invalides.push("commune");
  if (!d.bien || !(BIENS_PAR_TYPE[d.type] ?? BIENS).includes(d.bien)) invalides.push("bien");
  for (const [champ, cle] of PRECISIONS) if (autre[cle] && cle !== "source" && !d.precisions[cle]) invalides.push(champ);
  if (d.codePostal && !/^\d{5}$/.test(d.codePostal)) invalides.push("codePostal");
  if (invalides.length) return json({ ok: false, erreur: "Champs invalides", champs: invalides }, 400, cors);

  const fichiers = form.getAll("fichiers").filter((f): f is File => f instanceof File && f.size > 0);
  if (fichiers.length > MAX_FICHIERS) return json({ ok: false, erreur: `${MAX_FICHIERS} pièces jointes maximum` }, 400, cors);
  if (fichiers.reduce((a, f) => a + f.size, 0) > MAX_TOTAL) return json({ ok: false, erreur: "Pièces jointes trop lourdes (10 Mo max au total)" }, 413, cors);
  for (const f of fichiers) {
    if (!EXTENSIONS[extension(f.name)]) return json({ ok: false, erreur: `Format non pris en charge : ${f.name} (images et PDF uniquement)` }, 415, cors);
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  // Limites de débit (par adresse sur 24 h, globale sur 1 h) : le formulaire bascule alors sur FormSubmit.
  try {
    const il24h = new Date(Date.now() - 86400000).toISOString();
    const il1h = new Date(Date.now() - 3600000).toISOString();
    const { count: parEmail } = await sb.from("projets").select("id", { count: "exact", head: true }).eq("email", d.email).gte("cree_le", il24h);
    if ((parEmail ?? 0) >= MAX_PAR_EMAIL_24H) return json({ ok: false, erreur: "Trop de demandes pour cette adresse aujourd'hui" }, 429, cors);
    const { count: global } = await sb.from("projets").select("id", { count: "exact", head: true }).gte("cree_le", il1h);
    if ((global ?? 0) >= MAX_GLOBAL_1H) return json({ ok: false, erreur: "Service momentanément saturé" }, 429, cors);
  } catch (e) {
    console.error("limite de débit", e);
  }

  // 1. Dossier : identifiant horodaté, seconde suivante en cas de collision (contrainte unique).
  let date = new Date();
  let id = "";
  let insere = false;
  for (let essai = 0; essai < MAX_ESSAIS_ID && !insere; essai++) {
    id = idDossier(date);
    const { error } = await sb.from("projets").insert({ id, ...ligneProjet(d) });
    if (!error) insere = true;
    else if (error.code === "23505") date = new Date(date.getTime() + 1000);
    else {
      console.error("insertion projet", error.message);
      return json({ ok: false, erreur: "Enregistrement impossible" }, 500, cors);
    }
  }
  if (!insere) return json({ ok: false, erreur: "Identifiant indisponible" }, 500, cors);

  // À partir d'ici le dossier existe : tout échec est signalé dans la réponse, jamais en erreur HTTP.
  const deposes: Depose[] = [];
  const echoues: string[] = [];
  let clientId: string | null = null;
  const mails = { client: false, agence: false };

  // 2. Pièces jointes → dossiers/<id>/client/NN-nom.ext (+ repères de dossiers pour le tableau de bord Supabase)
  try {
    for (let i = 0; i < fichiers.length; i++) {
      const f = fichiers[i];
      const nom = nomSur(f.name, i + 1);
      const chemin = `${id}/client/${nom}`;
      const { error } = await sb.storage.from("dossiers").upload(chemin, await f.arrayBuffer(), {
        contentType: EXTENSIONS[extension(f.name)],
        upsert: false,
      });
      if (error) { console.error("dépôt", chemin, error.message); echoues.push(f.name); }
      else deposes.push({ nom, chemin, taille: f.size });
    }
    for (const sousDossier of ["client", "agence"]) {
      const { error } = await sb.storage.from("dossiers").upload(`${id}/${sousDossier}/.emptyFolderPlaceholder`, new Uint8Array(0), { contentType: "application/octet-stream", upsert: true });
      if (error) console.warn("repère de dossier", sousDossier, error.message);
    }
  } catch (e) {
    console.error("pièces jointes", e);
    for (const f of fichiers) if (!deposes.some((x) => x.taille === f.size && x.nom.endsWith(nomSur(f.name, 0).slice(3)))) echoues.push(f.name);
  }

  // 3. Compte client : réutilisé s'il existe déjà (deuxième projet), sinon créé (connexion par lien e-mail).
  try {
    const { data: existant, error: errRpc } = await sb.rpc("user_id_par_email", { p_email: d.email });
    if (errRpc) console.error("user_id_par_email", errRpc.message);
    if (existant) clientId = existant as string;
    else {
      const { data, error } = await sb.auth.admin.createUser({
        email: d.email,
        email_confirm: true,
        user_metadata: { prenom: d.prenom, nom: d.nom },
        app_metadata: { origine: "demande" }, // marque non modifiable par l'utilisateur : seuls ces comptes sont rattachés automatiquement
      });
      if (!error) clientId = data.user?.id ?? null;
      else {
        console.error("création du compte", error.message);
        const { data: retrouve } = await sb.rpc("user_id_par_email", { p_email: d.email }); // créé entre-temps ?
        if (retrouve) clientId = retrouve as string;
      }
    }
    if (clientId) {
      const { error } = await sb.from("projets").update({ client_id: clientId }).eq("id", id);
      if (error) { console.error("rattachement du compte", error.message); clientId = null; }
    }
  } catch (e) {
    console.error("compte client", e);
    clientId = null;
  }

  // 4. E-mails.
  try {
    if (RESEND_KEY) {
      mails.agence = await envoyerMail({
        to: MAIL_AGENCE,
        replyTo: d.email,
        subject: ligne(`Nouveau projet — ${aff(d, d.type, "type")} · ${d.docs[0] ? aff(d, d.docs[0], "documents") : "à définir"} · ${d.commune} (${d.nom})`),
        html: htmlAgence(id, d, deposes, echoues, clientId !== null),
      });
      mails.client = await envoyerMail({
        to: d.email,
        replyTo: MAIL_AGENCE,
        subject: `Votre demande est bien reçue — dossier ${id}`,
        html: htmlClient(id, d, deposes, echoues),
      });
    } else {
      console.warn("RESEND_API_KEY absent : aucun e-mail envoyé pour le dossier", id);
    }
  } catch (e) {
    console.error("e-mails", e);
  }

  return json({ ok: true, id, fichiers: deposes.length, fichiers_echoues: echoues, compte: clientId !== null, mails }, 200, cors);
});

// ---------- Outils ------------------------------------------------------------

// Surfaces du formulaire, toutes facultatives (même liste que contact.js et dossier.js) : [clé, libellé].
const SURFACES: [keyof Demande, string][] = [
  ["surfaceExistante", "Surface habitable existante"], ["surface", "Surface habitable créée"],
  ["empriseExistante", "Emprise au sol du bâti existant"], ["emprise", "Emprise au sol du bâti après projet"],
  ["surfaceTerrain", "Surface de la parcelle"],
];

// Nettoyage d'une valeur texte : caractères de contrôle retirés, espaces normalisés, longueur bornée.
function propre(v: string, max: number): string {
  return v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim().slice(0, max);
}

function texte(form: FormData, cle: string, max: number): string {
  const v = form.get(cle);
  return typeof v === "string" ? propre(v, max) : "";
}

// Valeur d'une liste fermée ; vide si absente ou inconnue (« — » = non renseigné).
function choix(form: FormData, cle: string, valeurs: string[]): string {
  const v = texte(form, cle, 100);
  return valeurs.includes(v) ? v : "";
}

function nombre(form: FormData, cle: string): string {
  const v = texte(form, cle, 20).replace(",", ".");
  return v && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) < 1e7 ? String(Number(v)) : "";
}

function extension(nom: string): string {
  return (/\.([a-z0-9]{1,5})$/i.exec(nom)?.[1] ?? "").toLowerCase();
}

// AAMMJJHHMMSS à l'heure de Paris, ex. 261012173615 pour le 12/10/2026 à 17:36:15.
function idDossier(d: Date): string {
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris", hourCycle: "h23",
    year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(d);
  const v = (t: string) => (parts.find((p) => p.type === t)?.value ?? "00").padStart(2, "0").slice(-2);
  return v("year") + v("month") + v("day") + v("hour") + v("minute") + v("second");
}

function ligneProjet(d: Demande) {
  const num = (s: string) => (s === "" ? null : Number(s));
  const txt = (s: string) => (s === "" ? null : s);
  return {
    profil: d.profil, societe: txt(d.societe), activite: txt(d.activite),
    prenom: d.prenom, nom: d.nom, email: d.email, telephone: txt(d.telephone),
    type: d.type, documents: d.docs, adresse: txt(d.adresse), commune: d.commune, code_postal: txt(d.codePostal),
    cadastre: txt(d.cadastre), bien: txt(d.bien),
    surface: num(d.surface), surface_existante: num(d.surfaceExistante), emprise_existante: num(d.empriseExistante), emprise: num(d.emprise), surface_terrain: num(d.surfaceTerrain),
    budget: txt(d.budget), calendrier: txt(d.calendrier), message: txt(d.message), source: txt(d.source),
    precisions: d.precisions,
  };
}

// Nom de fichier sûr : accents retirés, caractères spéciaux remplacés, extension conservée, préfixe d'ordre.
function nomSur(nom: string, i: number): string {
  const ext = extension(nom);
  const base = nom.slice(0, ext ? -(ext.length + 1) : undefined)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "fichier";
  return `${String(i).padStart(2, "0")}-${base}${ext ? "." + ext : ""}`;
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": ORIGINES.includes(origin) ? origin : ORIGINES[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(corps: unknown, statut: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(corps), { status: statut, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
}

async function envoyerMail(m: { to: string; subject: string; html: string; replyTo?: string }): Promise<boolean> {
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: MAIL_FROM, to: [m.to], subject: m.subject, html: m.html, reply_to: m.replyTo }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) console.error("resend", r.status, await r.text());
    return r.ok;
  } catch (e) {
    console.error("resend", e);
    return false;
  }
}

// ---------- E-mails -----------------------------------------------------------

// Valeur affichée : « Autre : précision » quand le choix est « Autre »
const aff = (d: Demande, v: string, cle: string) => (v === "Autre" && d.precisions[cle] ? "Autre : " + d.precisions[cle] : v);
// Objet du mail sur une seule ligne, quel que soit le contenu saisi
const ligne = (v: string) => v.replace(/\s+/g, " ").trim();

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const ko = (o: number) => (o >= 1048576 ? (o / 1048576).toFixed(1).replace(".", ",") + " Mo" : Math.max(1, Math.round(o / 1024)) + " Ko");
const KICKER = "font-size:11px;line-height:16px;letter-spacing:2px;text-transform:uppercase;color:#8d8d8d";
const LOGO_URL = `${SITE_URL}/images/logo-signature.gif`;

// Signature commune à tous les e-mails de l'agence (même bloc que emails/signature.html).
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
const titreBloc = (s: string, marge = "24px 0 6px") => `<div style="${KICKER};margin:${marge}">${esc(s)}</div>`;
const alerte = (s: string) => `<p style="margin:0 0 14px;padding:12px 14px;border:1px solid #d8896b;font-size:14px;line-height:21px;color:#8a4a2c">${s}</p>`;

function tableau(lignes: [string, string][]): string {
  const tr = lignes.filter(([, v]) => v).map(([k, v]) =>
    `<tr><td style="padding:7px 12px 7px 0;${KICKER};vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:7px 0;font-size:14px;line-height:21px;vertical-align:top">${esc(v).replace(/\n/g, "<br>")}</td></tr>`).join("");
  return `<table style="border-collapse:collapse;width:100%;margin:8px 0 18px">${tr}</table>`;
}

function recap(d: Demande): [string, string][] {
  const m2 = (s: string) => (s ? s + " m²" : "");
  return [
    ["Profil", d.profil], ["Société", d.societe], ["Activité", d.activite],
    ["Prénom", d.prenom], ["Nom", d.nom], ["Email", d.email], ["Téléphone", d.telephone],
    ["Type de projet", aff(d, d.type, "type")], ["Documents souhaités", d.docs.map((x) => aff(d, x, "documents")).join(", ")],
    ["Adresse du projet", d.adresse], ["Commune", d.commune], ["Code postal", d.codePostal], ["Référence cadastrale", d.cadastre],
    ["État actuel du bien", aff(d, d.bien, "bien")],
    ...SURFACES.map(([cle, libelle]) => [libelle, m2(String(d[cle]))] as [string, string]),
    ["Démarrage souhaité", aff(d, d.calendrier, "calendrier")], ["Message", d.message], ["Source", aff(d, d.source, "source")],
  ];
}

function listeFichiers(deposes: Depose[], echoues: string[]): string {
  const ok = deposes.length
    ? `<ul style="margin:0 0 14px;padding-left:18px;font-size:14px;line-height:24px">${deposes.map((f) => `<li>${esc(f.nom)} <span style="color:#7a7368">(${ko(f.taille)})</span></li>`).join("")}</ul>`
    : p("Aucune pièce jointe.");
  const rate = echoues.length ? alerte(`Pièces non enregistrées : ${esc(echoues.join(", "))}.`) : "";
  return ok + rate;
}

function htmlClient(id: string, d: Demande, deposes: Depose[], echoues: string[]): string {
  const espace = `${SITE_URL}/dossier/`;
  return gabarit("Demande reçue", [
    `<h1 style="margin:0 0 18px;font-size:24px;line-height:30px;font-weight:bold">Merci ${esc(d.prenom)}, votre demande est bien reçue.</h1>`,
    p(`Votre dossier porte le numéro <strong>${id}</strong>. Nous étudions votre projet et revenons vers vous sous 48&nbsp;h ouvrées.`),
    p(`Vous pouvez suivre l'avancement de votre dossier, consulter les documents que nous vous transmettrons et déposer des pièces dans votre espace client. Connectez-vous avec cette adresse e-mail (${esc(d.email)})&nbsp;: un lien de connexion vous est envoyé à chaque fois, sans mot de passe.`),
    `<p style="margin:0 0 26px"><a href="${espace}" style="display:inline-block;background:#171512;color:#ffffff;text-decoration:none;font-size:12px;line-height:16px;letter-spacing:2px;text-transform:uppercase;padding:14px 24px">Accéder à mon dossier</a></p>`,
    titreBloc("Votre demande"),
    tableau([["Type de projet", aff(d, d.type, "type")], ["Documents souhaités", d.docs.map((x) => aff(d, x, "documents")).join(", ")], ["Commune", d.commune], ["Démarrage souhaité", aff(d, d.calendrier, "calendrier")]]),
    titreBloc("Pièces jointes reçues", "0 0 6px"),
    listeFichiers(deposes, echoues),
    echoues.length ? p("Vous pourrez déposer à nouveau ces pièces dans votre espace client.") : "",
  ].join(""));
}

function htmlAgence(id: string, d: Demande, deposes: Depose[], echoues: string[], compte: boolean): string {
  const ref = SUPABASE_URL.replace(/^https?:\/\//, "").split(".")[0];
  const tableUrl = `https://supabase.com/dashboard/project/${ref}/editor`;
  const storageUrl = `https://supabase.com/dashboard/project/${ref}/storage/buckets/dossiers/${id}`;
  return gabarit(`Nouveau projet — dossier ${id}`, [
    `<h1 style="margin:0 0 18px;font-size:22px;line-height:28px;font-weight:bold">${esc(aff(d, d.type, "type"))} · ${esc(d.commune)} — ${esc(d.prenom)} ${esc(d.nom)}</h1>`,
    compte ? "" : alerte(`Compte client non créé pour ${esc(d.email)} : le client ne peut pas encore se connecter. Voir « Rattraper un dossier sans compte » dans SETUP-ESPACE-CLIENT.md.`),
    tableau(recap(d)),
    titreBloc(`Pièces jointes (${deposes.length})`, "0 0 6px"),
    listeFichiers(deposes, echoues),
    p(`Dossier dans Supabase&nbsp;: <a href="${tableUrl}" style="color:#171512">table projets</a> · <a href="${storageUrl}" style="color:#171512">fichiers du dossier</a>. Répondre à cet e-mail écrit directement au client.`),
  ].join(""));
}
