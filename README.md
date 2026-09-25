# ChoiceMyModel

Choisit quel agent et quel modèle [herd](https://github.com/vladzima/herd) doit donner à chaque
worker qu'il spawne. Jev ([TypeSafe](https://docs.typesafe.ai)) classe la tâche en un seul appel,
et une table de routage produit les flags `-k` / `-a` de `herd-spawn`.

## Le problème

`herd-spawn [-k kind] [-a "agent args"] <name> <cwd> "<task>"` laisse le choix du modèle au head
agent, guidé par de la prose dans `SKILL.md` : *« Sol at xhigh/max only for genuinely hard
problems, Luna at low/medium for bulk mechanical work »*. C'est une décision prise au jugé, à
chaque spawn, sur l'axe de la difficulté perçue.

Le routage par évals dit l'inverse : on mesure par classe de tâche quel est le modèle le moins
cher qui tient le score, et à l'exécution le classificateur ne juge pas la difficulté dans
l'abstrait — il reconnaît une classe déjà évaluée.

## Comment ça marche

```
"Fix the flaky auth test"
        │
        ▼
  classify()  ──▶  POST api.typesafe.ai/v1/systemone   (model: jev-latest)
        │           2 Choice : quelle classe de tâche ? (lookup, review, debug, implement,
        │                      refactor, test, docs, chore, other)
        │                      quel est l'effet le plus étendu de l'exécution ? (read_only,
        │                      local_write, external_effect)
        │           3 Noul   : 4+ systèmes ? difficile à annuler ? mécanique en masse ou
        │                      jugement de conception ?
        │           (les 5 questions évaluées en parallèle dans le même appel)
        ▼
   route()    ──▶  classe → tier (light/mid/frontier), puis tier → sélecteur du roster choisi
        ▼
chooseModel() ──▶  côté codex seulement : résout le sélecteur en vrai id de modèle via
        │           ~/.codex/config.toml (voir src/codexModel.ts)
        ▼
-k claude -a '--model sonnet --permission-mode acceptEdits'
```

La table de routage parle en **tiers**, pas en noms de modèles : ce que les évals apprennent
(« un lookup tient le score sur le tier light ») est une propriété de la classe de tâche, pas du
vendeur. Chaque vendeur a son propre roster, mais aucun des deux n'y fige un id de modèle : côté
claude ce sont des alias nus que le CLI résout lui-même, côté codex un suffixe de tier dont le
préfixe de version est lu dans la config Codex à l'exécution (`chooseModel()`, jamais `route()`).

| Tier | claude (`--model`) | codex (roster) | codex (résolu, exemple) |
| --- | --- | --- | --- |
| light | `haiku` | `luna` + `model_reasoning_effort=low` | `gpt-5.6-luna` |
| mid | `sonnet` | `terra` + `model_reasoning_effort=high` | `gpt-5.6-terra` |
| frontier | `opus` | `sol` + `model_reasoning_effort=xhigh` | `gpt-5.6-sol` |

Les niveaux de reasoning codex suivent la recommandation de herd (Luna pour le mécanique, Terra
pour le code ordinaire, Sol réservé aux problèmes vraiment durs). Claude Code n'a pas de flag
équivalent, donc le tier seul y porte la décision.

## Usage

```bash
npm install && npm run build && npm link      # expose `choicemymodel`
cp .env.example .env                           # renseigner TYPESAFE_API_KEY
```

```bash
$ choicemymodel "Review the auth diff" --kind codex
{
  "tier": "mid",
  "worker": {
    "kind": "codex",
    "model": "gpt-5.6-terra",
    "effort": "high",
    "args": "-m gpt-5.6-terra -c model_reasoning_effort=high --sandbox read-only"
  },
  "escalated": false,
  "reasons": []
}
```

Depuis un script shell :

```bash
eval "$(choicemymodel --shell "Review the auth diff")"
herd-spawn -k "$HERD_KIND" -a "$HERD_ARGS" review-auth ~/proj "Review the auth diff"
```

## Brancher sur herd

Ajoute ceci dans `~/.claude/skills/herd/SKILL.md`, juste avant la section « Spawn a worker » :

> ### Picking the worker model
>
> Before every `herd-spawn`, run `choicemymodel "<full task text>"` and use the `kind` and `args`
> fields of its JSON output as `-k` and `-a`. Do not pick the model yourself — the routing table
> behind that command is pinned by evals per task class. If the command fails, fall back to the
> defaults below and say so in your report.

Le head garde la main sur tout le reste (nommage, cwd, watch, reports) ; seule la décision de
modèle sort de son jugement.

## Quelques exemples de décisions

| Tâche | Classe | Décision |
| --- | --- | --- |
| Review the auth diff | `review` | codex terra, **`--sandbox read-only`** (`execution_scope: read_only`) |
| Fix the flaky auth test | `debug` | claude sonnet, `acceptEdits` |
| Rename `fetchUser` across the repo | `chore` | codex luna à `low` — mécanique en masse, on descend |
| Migrate the payments schema and backfill | `implement` | claude opus — *hard to reverse* force le tier frontier |

## Les choix de conception qui viennent de la doc TypeSafe

- **Le SDK officiel `@typesafe-ai/sdk`**, pas un client HTTP maison. Les réponses sont typées par
  nom de question et par option : `answers.use_case.choice` est l'union littérale de mes propres
  classes, donc plus aucun narrowing à la main. Timeout, retries, `baseURL` et modèle par défaut
  viennent du SDK et de ses variables d'environnement.
- **Une seule requête, cinq questions**, évaluées en parallèle : les trois Noul ne coûtent presque
  rien de plus que les deux Choice.
- **Un seul signal pour mécanique-en-masse vs jugement-de-conception.** `solution_shape` remplace
  les deux anciens Noul quasi-inverses (`craft_is_main_difficulty` / `is_bulk_mechanical`) : lu sur
  `chore`/`refactor` pour la désescalade, sur toutes les classes pour l'escalade côté conception.
- **Le vendeur (claude vs codex) part d'une table par défaut, pas d'un Noul dédié.**
  `DEFAULT_VENDOR_TABLE` fixe un vendeur par classe (claude par défaut, codex pour `chore`/`test`),
  et `solution_shape` peut la retourner à ses extrêmes : fortement mécanique bascule vers codex même
  si la table dit claude, fortement jugement de conception reste sur claude même si la table dit
  codex. `--kind` / `HERD_KIND` restent une échappatoire : s'ils sont fournis, ils priment toujours.
- **Des critères structurés** (`what` / `not_for` / `examples`) sur les options du Choice, pour les
  frontières qui se confondent : debug vs implement, refactor vs chore, review vs lookup.
- **Les Noul renvoient une probabilité**, donc le seuil (0.7) est un curseur de tolérance au
  risque, pas un booléen.
- **Plancher de confiance par classe.** Un seuil n'est pas un seul nombre : `implement` doit
  passer 0.75 avant qu'on fasse confiance au tier bon marché, `lookup` se contente de 0.5.
- **Le mécanique en masse descend d'un cran, mais jamais au détriment d'un signal de risque** — « en
  masse » *et* « difficile à annuler » est la combinaison la plus dangereuse, pas une raison
  d'économiser.
- **Un risque critique force le tier frontier, il ne se contente pas d'escalader d'un cran.**
  `hard_to_reverse` et `execution_scope: external_effect` sautent directement au tier frontier ;
  les autres signaux (portée multi-systèmes, jugement de conception, confiance faible) escaladent
  toujours d'un seul cran, même combinés entre eux — un OR de signaux faibles n'a jamais le même
  effet qu'un seul signal fort.
- **Moindre privilège pour les deux vendeurs, sur trois niveaux (`execution_scope`).**
  `read_only` obtient un worker en lecture seule (`--permission-mode plan` pour claude,
  `--sandbox read-only` pour codex). `local_write` obtient `acceptEdits` / `workspace-write`.
  `external_effect` obtient aussi `acceptEdits` / `workspace-write`, mais contribue en plus au
  risque critique ci-dessus : un effet qui sort de la copie de travail mérite le meilleur modèle,
  pas seulement le bon mode d'écriture.
- **Aucun id de modèle codex figé dans le code.** Le roster ne connaît que le suffixe de tier
  (`luna`/`terra`/`sol`) ; `chooseModel()` lit `~/.codex/config.toml` pour en tirer le préfixe de
  version au moment de l'appel (`src/codexModel.ts`). Config absente, illisible ou valeur hors
  schéma : échec explicite avec un message actionnable, jamais un repli silencieux vers un id codé
  en dur qui finirait par diverger de ce que Codex résout réellement. `route()` reste pur et
  synchrone : seule cette résolution touche le système de fichiers, et uniquement depuis
  `chooseModel()`.

## Ce qui a été volontairement écarté

- **Un score de complexité comme signal de routage.** Le pattern « intent routing » de TypeSafe en
  ajoute un, mais le post dont part ce repo dit l'inverse : *« le routage n'est pas un score de
  difficulté »*. Les deux sources sont en désaccord, j'ai suivi le post.
- **Un démon.** L'appel a lieu une fois par worker spawné, un événement lourd : le démarrage de
  l'interpréteur ne se voit pas à cette fréquence, et herd assume « three files, no daemon ».
  `npm run dev` expose quand même un `POST /choose` si tu préfères un service.

## Ce qui est un point de départ, pas un résultat

- **`DEFAULT_ROUTING_TABLE`** est une heuristique, pas une table dérivée d'évals réelles. Fais
  grossir `src/evals/cases.ts` avec de vraies tâches que tu as données à des workers, puis
  `npm run eval` pour l'ajuster classe par classe.
- **Rien n'a été testé contre les API réelles** : aucune clé disponible, et `api.typesafe.ai` est
  bloqué par le proxy. Vérifiés (`npm run typecheck` couvre `src` *et* `test`, `npm test`) : le
  routeur, le classifieur Jev à travers son SDK contre un `fetch` stubbé — corps de requête
  inclus —, le parseur d'arguments du CLI et le serveur HTTP (codes de statut
  400 / 413 / 502, plafond de corps, messages d'erreur génériques).
