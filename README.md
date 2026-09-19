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
        │           2 Noul spéculatifs : opération de masse ? sortie destinée à un client ?
        │           (les 6 questions sont évaluées en parallèle dans le même appel)
        ▼
   route()    ──▶  table catégorie → palier (haiku/sonnet/opus),
        │           palier remonté d'un cran si un Noul dépasse le seuil,
        │           ou si la confiance sur la catégorie passe sous le plancher de sa classe
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

- **Une seule requête, six questions.** Les questions sont évaluées en parallèle et isolément :
  ajouter des Noul ne change quasiment pas la latence.
- **Speculative fan-out.** Deux questions ne servent que sur certaines branches :
  `is_bulk_operation` n'est lue que si la catégorie est `automation`, `is_client_facing` que pour
  `communication` et `deliverable`. `route()` les ignore ailleurs. C'est le pattern documenté :
  poser d'avance une question qui ne servira peut-être pas coûte presque rien, alors qu'un second
  appel coûte un aller-retour. Elles gagnent leur place — un email de relance avec `craft` à 0.64
  (sous le seuil) mais `is_client_facing` à 0.93 est escaladé alors que le seul signal « craft »
  ne l'aurait pas fait.
- **Des questions atomiques.** Plutôt qu'une seule question « quel modèle pour cette tâche ? »
  (qui demanderait un vrai raisonnement), on pose quatre jugements courts et on compose le
  résultat dans le code. Les poids et les seuils vivent dans `routingTable.ts`, donc les ajuster
  ne demande pas de réécrire un prompt.
- **Des critères structurés** (`what` / `not_for` / `examples`) sur les options du Choice. C'est
  le remède documenté quand deux options se confondent, et ici c'est exactement le cas :
  lookup vs analytics, analytics vs investigation, communication vs deliverable.
- **Les Noul renvoient une probabilité, pas un booléen.** Le seuil (`DEFAULT_THRESHOLDS.noul`,
  0.7) est donc un curseur de tolérance au risque, pas une constante figée.
- **La confiance basse fait monter d'un palier, avec un plancher par catégorie.** Un seuil de
  confiance n'est pas un seul nombre : une classe dont les erreurs coûtent cher doit passer une
  barre plus haute avant qu'on fasse confiance au modèle le moins cher. D'où un plancher global à
  0.5, mais 0.75 pour `automation` (qui écrit dans des systèmes), 0.6 pour `investigation` et
  `deliverable`.

## Ce qui a été volontairement écarté

- **Un score de complexité comme signal de routage.** Le pattern « intent routing » de TypeSafe
  ajoute un Score de complexité à côté de l'intention, et le use-case map parle d'« estimate
  difficulty ». Mais le post dont part ce repo dit exactement l'inverse : *« le routage n'est pas
  un score de difficulté. "Ça a l'air dur, envoie au gros modèle" est une intuition, et elle se
  trompe assez souvent pour coûter cher dans les deux sens. »* Les deux sources sont en désaccord
  ici, et j'ai suivi le post : le classificateur reconnaît une catégorie déjà évaluée, il ne juge
  pas la difficulté dans l'abstrait. Si tu veux tester l'autre voie, un Score de complexité
  s'ajoute en une question et se lit dans `route()`.
- **Le composite scoring pondéré.** Le pattern combine plusieurs dimensions en un score unique
  avec des poids. Il sert à *classer* des éléments entre eux ; ici les trois signaux d'escalade
  sont indépendamment suffisants (un seul suffit à justifier un meilleur modèle), donc un OU sur
  des seuils dit la bonne chose et garde un `reasons[]` lisible quand il faut débugger une
  décision. Un score pondéré deviendrait utile si tu voulais un budget de risque continu plutôt
  que des paliers.
- **Le SDK.** Les docs SDK que j'ai sont celles de Python ; ce projet est en TypeScript, donc
  l'appel passe par l'API HTTP documentée plutôt que par un SDK dont je devrais deviner la
  signature. Trois choses en ont quand même été reprises parce qu'elles décrivent le service et
  pas le binding : `TYPESAFE_DEFAULT_MODEL`, `TYPESAFE_BASE_URL`, et un timeout sur l'appel (un
  routeur est sur le chemin de chaque message : une connexion qui pend ne doit pas bloquer
  l'appelant). Le `request_id` que le SDK Python expose sur les réponses et les erreurs n'est pas
  repris : je ne sais pas s'il arrive en en-tête ou dans le corps, et je préfère ne pas deviner —
  en cas d'erreur le corps complet est propagé, donc il y figure s'il est dans le corps.

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
