# ChoiceMyModel

Équivalent maison du duo **Jev / Cortex** décrit dans le post LinkedIn qui a inspiré ce repo :
un classificateur rapide et bon marché qui répond à des questions typées sur une tâche en un
seul appel ("System One" — il ne rédige rien, il décide), et une table de routage qui envoie
chaque tâche vers le modèle Claude le moins cher qui tient la barre pour sa catégorie.

L'idée centrale du post, et celle que ce repo essaie de respecter : **le routage n'est pas un
score de difficulté "à vue"**. Ça se construit avec des évals par cas d'usage, et la table de
routage est le résultat de ce travail — pas une intuition.

## Comment ça marche

```
TaskState { text, context? }
        │
        ▼
  classify()   ──▶  Claude Haiku 4.5, 1 appel, tool_choice forcé
        │            répond en une passe : useCase, spansMultipleSystems,
        │            hardToReverse, craftIsMainDifficulty, confidence
        ▼
   route()    ──▶  table useCase → tier (haiku/sonnet/opus),
        │           tier remonté d'un cran si la tâche est difficile à
        │           annuler, touche 4+ systèmes, ou si le soin rédactionnel
        │           est la vraie difficulté
        ▼
RoutingDecision { tier, model, classification, escalated, reasons }
```

- `src/classify.ts` — le classificateur (le rôle de **Jev**)
- `src/routingTable.ts` — la table de routage pure, testable sans appel API (le rôle de **Cortex**)
- `src/chooseModel.ts` — combine les deux, c'est le point d'entrée principal
- `src/server.ts` — wrapper HTTP minimal (`POST /choose`) pour appeler ça depuis n'importe quel
  langage/système, y compris herd/herdr
- `src/evals/` — jeu d'évals de départ + harnais qui calcule précision/recall/F1 par cas d'usage

## Démarrage

```bash
npm install
cp .env.example .env   # renseigner ANTHROPIC_API_KEY
npm run build
npm test                # tests unitaires du routeur (aucun appel API)
npm run eval             # fait tourner le classificateur sur src/evals/cases.ts (appelle l'API)
npm run dev               # démarre le serveur HTTP sur :8787
```

## Utilisation en librairie

```ts
import { chooseModel } from "choicemymodel";

const decision = await chooseModel({
  text: "Mets à jour le statut GHL de chaque contact qui a payé aujourd'hui",
});
// { tier: "opus", model: "claude-opus-5", escalated: true,
//   reasons: ["hard to reverse if wrong"], classification: {...} }
```

## Utilisation en HTTP (pour brancher sur herd/herdr sans partager le runtime)

```bash
curl -X POST http://localhost:8787/choose \
  -H "content-type: application/json" \
  -d '{"text": "Résume ce fil de 40 messages en 3 points"}'
```

## Intégrer dans herd/herdr

Je n'ai pas le code de herd/herdr sous la main dans cette session, donc ce repo expose
volontairement **les deux** points d'entrée (import direct + HTTP) plutôt que de figer un choix :

- si herdr est en Node/TS et peut ajouter cette dépendance : importer `chooseModel()` directement ;
- sinon (autre langage, ou tu préfères garder le routeur comme un service séparé) : lancer
  `npm run dev`/`npm start` et appeler `POST /choose` depuis herdr avant de dispatcher le message.

## Ce qui est un point de départ, pas un résultat

- **`DEFAULT_ROUTING_TABLE`** (`src/routingTable.ts`) est une heuristique de démarrage, pas une
  table dérivée de vraies évals. Le post est explicite là-dessus : la table doit être le résultat
  de scores mesurés par cas d'usage sur du vrai trafic. `src/evals/cases.ts` contient un petit jeu
  d'exemples ancrés dans vos projets (GHL, Doctolib, Crisp) pour démarrer — à faire grossir avec
  de vrais messages de herd/herdr et leur bonne catégorie, puis à faire tourner via `npm run eval`
  pour ajuster la table par cas d'usage plutôt qu'en bloc.
- **Le classificateur n'a pas été testé en conditions réelles dans cet environnement** (pas de
  clé `ANTHROPIC_API_KEY` disponible ici) : le typecheck, le build et les tests unitaires du
  routeur passent, mais `npm run eval` avec ta propre clé est la première chose à lancer pour
  vérifier que `classify()` catégorise correctement tes tâches.
- La règle d'escalade (`hardToReverse` / `spansMultipleSystems` / `craftIsMainDifficulty` → +1
  palier) est volontairement simple. Une fois que tu as des scores réels par cas d'usage, tu
  peux directement remplacer `DEFAULT_ROUTING_TABLE` et/ou la logique d'escalade dans
  `route()`.
