import type { AgentKind, UseCase } from "../types.js";

export interface EvalCase {
  id: string;
  text: string;
  expectedUseCase: UseCase;
  /** Omitted where there is no clear-cut expectation for vendor fit yet. */
  expectedKind?: AgentKind;
}

/**
 * Seed set only. Routing should be pinned by evals against your OWN traffic,
 * not vibes — grow this file with real task texts you have handed to herd
 * workers, plus the class you would have picked for each.
 */
export const EVAL_CASES: EvalCase[] = [
  { id: "lookup-1", text: "Where is the retry logic for the webhook client defined?", expectedUseCase: "lookup" },
  { id: "lookup-2", text: "Which endpoints currently go through the auth middleware?", expectedUseCase: "lookup" },
  { id: "review-1", text: "Review the auth diff on this branch and report anything risky.", expectedUseCase: "review" },
  { id: "review-2", text: "Check PR #214 for SQL injection and missing input validation.", expectedUseCase: "review" },
  { id: "debug-1", text: "Fix the flaky auth test in tests/auth_test.py.", expectedUseCase: "debug" },
  { id: "debug-2", text: "The Doctolib sync silently dropped 12 appointments yesterday, find out why and fix it.", expectedUseCase: "debug" },
  { id: "implement-1", text: "Add a CSV export endpoint to the payment hub API.", expectedUseCase: "implement" },
  { id: "implement-2", text: "Implement the password reset flow, including the email template.", expectedUseCase: "implement" },
  { id: "refactor-1", text: "Extract the billing logic out of views.py into its own module.", expectedUseCase: "refactor" },
  { id: "refactor-2", text: "Replace the callback chain in the GHL client with async/await.", expectedUseCase: "refactor" },
  { id: "test-1", text: "Add integration tests covering the payment hub webhook handler.", expectedUseCase: "test" },
  { id: "test-2", text: "Backfill unit tests for the invoice parser.", expectedUseCase: "test" },
  { id: "docs-1", text: "Document the socket API in docs/socket-api.md.", expectedUseCase: "docs" },
  { id: "docs-2", text: "Update the README install section for the new CLI.", expectedUseCase: "docs" },
  { id: "chore-1", text: "Bump every dependency to its latest minor version and fix the lockfile.", expectedUseCase: "chore", expectedKind: "codex" },
  { id: "chore-2", text: "Rename the symbol `fetchUser` to `loadUser` across the whole repo.", expectedUseCase: "chore", expectedKind: "codex" },
  { id: "vendor-implement-1", text: "Design and implement the password reset flow, including deciding the email template's structure.", expectedUseCase: "implement", expectedKind: "claude" },
  { id: "vendor-refactor-1", text: "Replace every occurrence of `req.body.userId` with `req.user.id` across all 40 route handlers, same substitution everywhere.", expectedUseCase: "refactor", expectedKind: "codex" },

  // Real verbatim texts handed to herd-spawn workers (harvested 2026-09-20 from a
  // live herd session, before choicemymodel routing was active — see git history
  // for context). expectedKind omitted: these ran with -k claude by default, not
  // via a deliberate vendor pick, so there is no ground truth to pin.
  {
    id: "other-1",
    text: "Installe et vérifie localement le CLI de ce repo (ChoiceMyModel, un routeur de modèle Jev-style pour herd-spawn). Étapes : 1) npm install 2) npm run build 3) npm link pour exposer la commande `choicemymodel` globalement 4) vérifier que le fichier .env à la racine contient bien TYPESAFE_API_KEY (ne pas l'afficher en clair dans ton rapport, juste dire s'il est renseigné ou vide) 5) tester la commande avec : choicemymodel \"Review the auth diff\" --kind codex — et vérifier qu'elle renvoie un JSON valide avec tier/worker/args 6) tester aussi le mode --shell : eval \"$(choicemymodel --shell \"Fix a flaky test\")\" puis echo $HERD_KIND $HERD_ARGS pour confirmer que les variables sont bien exportées. Si npm link échoue par manque de permissions, propose npm link --force ou signale l'erreur exacte sans la contourner silencieusement. Rapporte en français dans /tmp/herd/install-cmm.md : ce qui a marché, la sortie de la commande de test, et tout problème rencontré (dépendances manquantes, clé API absente, erreurs de build TypeScript, etc.).",
    expectedUseCase: "other",
  },
  {
    id: "debug-3",
    text: "Corrige les 3 problèmes que tu as identifiés dans ton rapport, avec de vrais fixes (pas de contournement) : 1. BLOQUANT — src/cli.ts:99, le garde d'entrée `if (import.meta.url === `file://${process.argv[1]}`)` échoue silencieusement quand la commande est invoquée via un lien symbolique (cas npm link). Corrige en comparant les chemins résolus via fs.realpathSync plutôt que les chaînes brutes (ou toute autre solution robuste au symlink que tu juges meilleure — à toi de voir la plus propre). 2. MINEUR — HERD_KIND='' (chaîne vide) dans .env n'est pas traité comme absent à cause du `??=`. Traite une chaîne vide comme undefined pour HERD_KIND dans la résolution du kind par défaut (parseArgs ou équivalent dans src/cli.ts). 3. tsconfig.json n'a pas \"types\": [\"node\"] dans compilerOptions, ce qui casse npm run build et npm run typecheck avec 32 erreurs TS (Cannot find name 'process'/'console'/etc). Ajoute-le. Après chaque fix : relance npm run typecheck et npm test pour vérifier que rien ne casse. Puis reteste concrètement le scénario qui a échoué avant (invocation via le lien npm-global existant : `choicemymodel \"Review the auth diff\" --kind codex` en conditions réelles depuis un shell avec ~/.npm-global/bin dans le PATH, et le mode --shell avec HERD_KIND='' dans .env) pour confirmer que les 2 bugs CLI sont bien résolus en pratique, pas juste en théorie. Ne commit rien. Écris un rapport final dans /tmp/herd/install-cmm.md (tu peux écraser l'ancien) : diffs appliqués, résultats des tests, résultats des retests manuels.",
    expectedUseCase: "debug",
  },
  {
    id: "other-2",
    text: "Lance le serveur local de ce repo (ChoiceMyModel, routeur de modèle Jev-style) pour vérifier qu'il démarre et répond correctement. Utilise le skill 'run' du projet s'il y en a un, sinon : npm run dev (= tsx --env-file-if-exists=.env src/server.ts, port 8787 par défaut, voir .env). Étapes : 1) démarre le serveur en arrière-plan 2) attends qu'il soit prêt (log de démarrage) 3) fais une requête de test contre son endpoint HTTP (regarde src/server.ts pour connaître la route et le format attendu, probablement un POST avec une tâche à classifier, similaire à ce que fait le CLI choicemymodel) 4) vérifie que la réponse contient bien tier/worker comme la CLI 5) arrête proprement le serveur à la fin. Ne modifie aucun fichier du repo, c'est un test de fumée en lecture seule (sauf pour lancer/arrêter le process). Rapporte en français dans /tmp/herd/run-cmm.md : commande utilisée pour lancer le serveur, requête de test envoyée, réponse reçue (JSON complet), et tout problème rencontré (port déjà utilisé, erreur au démarrage, timeout, etc.).",
    expectedUseCase: "other",
  },
];
