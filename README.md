# ChoiceMyModel

Un routeur de modèles bâti sur **Jev** (TypeSafe) : Jev classe chaque tâche entrante en un seul
appel, et une table de routage envoie la tâche vers le modèle Claude le moins cher qui tient la
barre pour sa catégorie.

L'idée centrale du post qui a inspiré ce repo : **le routage n'est pas un score de difficulté
« à vue »**. Ça se construit avec des évals par cas d'usage, et la table de routage est le
résultat de ce travail — pas une intuition.

## Comment ça marche

```
TaskState { text, context? }
        │
        ▼
  classify()  ──▶  POST api.typesafe.ai/v1/systemone   (model: jev-latest)
        │           1 Choice  : quelle catégorie d'usage ?   → choice + probabilities + confidence
        │           3 Noul    : touche 4+ systèmes ? difficile à annuler ?
        │                       le soin rédactionnel est-il la vraie difficulté ?  → 0–1 chacun
        │           (les 4 questions sont évaluées en parallèle dans le même appel)
        ▼
   route()    ──▶  table catégorie → palier (haiku/sonnet/opus),
        │           palier remonté d'un cran si un Noul dépasse le seuil,
        │           ou si la confiance sur la catégorie est trop basse
        ▼
RoutingDecision { tier, model, classification, escalated, reasons }
```

| Fichier | Rôle |
| --- | --- |
| `src/typesafe.ts` | Client HTTP de l'API System One (`POST /v1/systemone`) |
| `src/classifiers/jev.ts` | Les 4 questions typées envoyées à Jev — **le cœur du système** |
| `src/classifiers/claude.ts` | Backend de comparaison (Claude Haiku 4.5, tool call forcé) |
| `src/routingTable.ts` | Table de routage + seuils, pure et testable sans appel réseau |
| `src/chooseModel.ts` | Point d'entrée : classify + route |
| `src/server.ts` | Wrapper HTTP minimal (`POST /choose`) |
| `src/evals/` | Jeu d'évals + harnais precision/recall/F1 et latence p50/p95 |

## Démarrage

```bash
npm install
cp .env.example .env    # renseigner TYPESAFE_API_KEY
npm run build
npm test                 # tests du routeur, aucun appel réseau
npm run eval             # fait tourner Jev sur src/evals/cases.ts
npm run dev              # serveur HTTP sur :8787
```

## Utilisation en librairie

```ts
import { chooseModel } from "choicemymodel";

const decision = await chooseModel({
  text: "Mets à jour le statut GHL de chaque contact qui a payé aujourd'hui",
});
// {
//   tier: "opus", model: "claude-opus-5", escalated: true,
//   reasons: ["hard to reverse if wrong"],
//   classification: { useCase: "automation", useCaseConfidence: 0.86,
//                     hardToReverse: 0.94, ... }
// }
```

## Utilisation en HTTP (pour brancher herd/herdr sans partager le runtime)

```bash
curl -X POST http://localhost:8787/choose \
  -H "content-type: application/json" \
  -d '{"text": "Résume ce fil de 40 messages en 3 points"}'
```

## Les choix de conception qui viennent de la doc TypeSafe

- **Une seule requête, quatre questions.** Les questions sont évaluées en parallèle et
  isolément : ajouter les trois Noul ne change quasiment pas la latence. C'est le pattern
  « speculative fan-out » — poser une question dont la réponse ne servira peut-être pas coûte
  presque rien.
- **Des questions atomiques.** Plutôt qu'une seule question « quel modèle pour cette tâche ? »
  (qui demanderait un vrai raisonnement), on pose quatre jugements courts et on compose le
  résultat dans le code. Les poids et les seuils vivent dans `routingTable.ts`, donc les ajuster
  ne demande pas de réécrire un prompt.
- **Des critères structurés** (`what` / `not_for` / `examples`) sur les options du Choice. C'est
  le remède documenté quand deux options se confondent, et ici c'est exactement le cas :
  lookup vs analytics, analytics vs investigation, communication vs deliverable.
- **Les Noul renvoient une probabilité, pas un booléen.** Le seuil (`DEFAULT_THRESHOLDS.noul`,
  0.7) est donc un curseur de tolérance au risque, pas une constante figée.
- **La confiance basse fait monter d'un palier.** Si Jev n'est pas sûr de la catégorie
  (`useCaseConfidence < 0.5`), on ne parie pas sur le modèle le moins cher : une tâche mal
  reconnue est précisément le cas où sous-servir coûte cher.

## Comparer Jev et un LLM classique

Le post compare un classificateur précédent à Jev avant de basculer. Les deux backends sont
donc branchables :

```bash
CLASSIFIER=jev npm run eval       # défaut
CLASSIFIER=claude npm run eval    # Claude Haiku 4.5, pour comparer
```

Le harnais affiche accuracy, precision/recall/F1 par cas d'usage, et latence p50/p95.

Une nuance à garder en tête : les probabilités de Jev sont calibrées (entraînement RLCD, elles
sont optimisées contre les résultats observés), celles que Claude renvoie sur lui-même ne le sont
pas. Le backend Claude est une baseline à battre, pas un signal équivalent.

## Ce qui est un point de départ, pas un résultat

- **`DEFAULT_ROUTING_TABLE`** est une heuristique de démarrage, pas une table dérivée de vraies
  évals. Le post est explicite : la table doit être le résultat de scores mesurés par cas d'usage
  sur du vrai trafic. `src/evals/cases.ts` contient un petit jeu d'exemples ancrés dans vos
  projets (GHL, Doctolib, Crisp) — à faire grossir avec de vrais messages de herd/herdr et leur
  bonne catégorie.
- **Les seuils** (`DEFAULT_THRESHOLDS`) sont à calibrer en traçant confiance contre justesse sur
  vos données. La doc TypeSafe recommande d'ailleurs des seuils différents selon l'enjeu de
  l'action plutôt qu'un seul seuil global — si une catégorie déclenche des écritures, elle mérite
  un seuil plus strict que les lectures.
- **Rien n'a été testé contre l'API réelle** : ni `TYPESAFE_API_KEY` ni `ANTHROPIC_API_KEY`
  n'étaient disponibles dans l'environnement où ce code a été écrit, et `api.typesafe.ai` y est
  bloqué par le proxy réseau. Ce qui est vérifié : le typecheck, le build, les 8 tests du routeur,
  et la forme exacte de la requête (endpoint, headers, `{state, model, questions}`) contre un
  `fetch` stubbé. `npm run eval` avec ta clé est la première chose à lancer.
