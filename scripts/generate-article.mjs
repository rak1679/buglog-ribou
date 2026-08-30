// Génère un nouvel article BugLog via l'IA Gemini et l'écrit dans Firebase.
// Lancé chaque semaine par GitHub Actions (voir .github/workflows/weekly-article.yml).
// Nécessite Node.js 20+ (fetch natif). Aucune dépendance externe.

const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL || "https://buglog-d884a-default-rtdb.europe-west1.firebasedatabase.app";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL_PRIMARY = "gemini-3.5-flash";
const GEMINI_MODEL_FALLBACK = "gemini-3.5-flash-lite";

if(!FIREBASE_API_KEY || !GEMINI_API_KEY){
  console.error("Secrets manquants : FIREBASE_API_KEY et/ou GEMINI_API_KEY ne sont pas définis.");
  process.exit(1);
}

// Titres déjà publiés en dur sur le site, pour éviter que l'IA ne les régénère.
const EXISTING_BASE_TITLES = [
  "Pourquoi Windows plante avec un écran bleu (et ce que le code vous dit vraiment)",
  "Votre PC s'éteint tout seul sous charge ? Voici comment traquer la surchauffe",
  "Les 4 signes qu'un disque dur est en train de mourir (et comment réagir à temps)",
  "Code 43 : pourquoi Windows voit votre carte graphique sans pouvoir l'utiliser",
  "Wi-Fi connecté mais « pas d'accès à Internet » : comprendre où ça bloque",
  "Autonomie qui s'effondre : ce que l'usure d'une batterie de portable veut vraiment dire"
];

function slugify(str){
  return str
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

async function firebaseSignInAnonymous(){
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true })
  });
  const data = await res.json();
  if(!res.ok || !data.idToken){
    throw new Error("Échec de l'authentification Firebase anonyme : " + JSON.stringify(data));
  }
  return data.idToken;
}

async function fetchCustomArticles(idToken){
  const res = await fetch(`${FIREBASE_DB_URL}/buglog/custom-articles.json?auth=${idToken}`);
  if(!res.ok) throw new Error("Échec de lecture de custom-articles : " + res.status);
  const raw = await res.json(); // soit null, soit une chaîne JSON (voir format de stockage du site)
  if(!raw) return [];
  try{ return JSON.parse(raw); }catch(e){ return []; }
}

async function saveCustomArticles(idToken, list){
  const stringValue = JSON.stringify(list);       // valeur "métier" (tableau encodé en JSON texte)
  const putBody = JSON.stringify(stringValue);     // ré-encodage pour que Firebase stocke bien une STRING
  const res = await fetch(`${FIREBASE_DB_URL}/buglog/custom-articles.json?auth=${idToken}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: putBody
  });
  if(!res.ok){
    const errText = await res.text();
    throw new Error("Échec d'écriture dans Firebase : " + res.status + " " + errText);
  }
}

async function callGeminiWithModel(prompt, model){
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/interactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
    body: JSON.stringify({
      model: model,
      input: prompt,
      generation_config: { max_output_tokens: 1600, thinking_level: "low" }
    })
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

async function callGemini(prompt){
  let result = await callGeminiWithModel(prompt, GEMINI_MODEL_PRIMARY);
  if(!result.ok && (result.status === 429 || result.data?.error?.status === 'RESOURCE_EXHAUSTED')){
    console.log(`Quota ${GEMINI_MODEL_PRIMARY} atteint, bascule sur ${GEMINI_MODEL_FALLBACK}.`);
    result = await callGeminiWithModel(prompt, GEMINI_MODEL_FALLBACK);
  }
  if(!result.ok || result.data?.error){
    throw new Error("Erreur API Gemini : " + JSON.stringify(result.data?.error || result.data));
  }
  const steps = result.data?.steps || [];
  return steps
    .filter(s => s.type === "model_output")
    .flatMap(s => (s.content || []).filter(c => c.type === "text").map(c => c.text || ""))
    .join("\n")
    .trim();
}

async function generateArticle(existingTitles){
  const prompt = `Tu écris un nouvel article pour le blog de BugLog, un site francophone de dépannage informatique (Windows, macOS, Linux, matériel, réseau). Le ton est clair, concret, orienté "pourquoi ça arrive et comment le diagnostiquer", comme les articles existants du site.

Articles déjà publiés, ne choisis PAS un sujet trop proche de ceux-ci :
${existingTitles.map(t => "- " + t).join("\n")}

Choisis un sujet de panne ou problème informatique courant et utile, différent de la liste ci-dessus.

Réponds UNIQUEMENT avec un objet JSON strict, sans texte autour ni balises markdown, avec exactement ces clés :
{
  "tag": "Windows" | "macOS" | "Linux" | "Matériel" | "Réseau",
  "titre": "titre accrocheur de l'article, une phrase",
  "resume": "résumé d'une à deux phrases",
  "corps": "contenu HTML de l'article : plusieurs <p>, au moins 2 titres <h4>, une liste <ul><li> si pertinent, et éventuellement des balises <code> pour les commandes. 400 à 600 mots. Pas de <h1>/<h2>/<h3>, pas de <script>."
}`;

  const raw = await callGemini(prompt);
  const clean = raw.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(clean);

  const today = new Date().toISOString().slice(0, 10);
  const id = slugify(parsed.titre) + '-' + today;

  return {
    id,
    tag: parsed.tag,
    date: today,
    titre: parsed.titre,
    resume: parsed.resume,
    corps: parsed.corps
  };
}

async function main(){
  console.log("Connexion à Firebase…");
  const idToken = await firebaseSignInAnonymous();

  console.log("Lecture des articles existants…");
  const customArticles = await fetchCustomArticles(idToken);
  const allTitles = [...EXISTING_BASE_TITLES, ...customArticles.map(a => a.titre)];

  console.log("Génération de l'article via Gemini…");
  const newArticle = await generateArticle(allTitles);
  console.log("Nouvel article :", newArticle.titre);

  customArticles.push(newArticle);
  console.log("Écriture dans Firebase…");
  await saveCustomArticles(idToken, customArticles);

  console.log("✅ Article publié :", newArticle.id);
}

main().catch(err => {
  console.error("❌ Échec de la génération automatique :", err);
  process.exit(1);
});
