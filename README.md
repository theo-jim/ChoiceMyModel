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
        │           1 Choice : quelle classe de tâche ?  (lookup, review, debug, implement,
        │                      refactor, test, docs, chore, other)
        │           5 Noul   : 4+ systèmes ? difficile à annuler ? jugement de conception ?
        │                      travail mécanique en masse ? besoin d'écrire des fichiers ?
        │           (les 6 questions évaluées en parallèle dans le même appel)
        ▼
   route()    ──▶  classe → tier (light/mid/frontier), puis tier → modèle du roster choisi
        ▼
-k claude -a '--model claude-sonnet-5 --permission-mode acceptEdits'
```

La table de routage parle en **tiers**, pas en noms de modèles : ce que les évals apprennent
(« un lookup tient le score sur le tier light ») est une propriété de la classe de tâche, pas du
vendeur. Chaque vendeur a son propre roster.

| Tier | claude | codex |
| --- | --- | --- |
| light | `claude-haiku-4-5` | `gpt-5.6-luna` + `model_reasoning_effort=low` |
| mid | `claude-sonnet-5` | `gpt-5.6-terra` + `model_reasoning_effort=high` |
| frontier | `claude-opus-5` | `gpt-5.6-sol` + `model_reasoning_effort=xhigh` |

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
| Review the auth diff | `review` | codex terra, **`--sandbox read-only`** (aucune écriture nécessaire) |
| Fix the flaky auth test | `debug` | claude sonnet-5, `acceptEdits` |
| Rename `fetchUser` across the repo | `chore` | codex luna à `low` — mécanique en masse, on descend |
| Migrate the payments schema and backfill | `implement` | claude opus-5 — *hard to reverse* + *spans 4+ systems* |

## Les choix de conception qui viennent de la doc TypeSafe

- **Une seule requête, six questions**, évaluées en parallèle : les cinq Noul ne coûtent presque
  rien de plus que le Choice.
- **Speculative fan-out.** `is_bulk_mechanical` n'est lue que sur `chore` et `refactor`,
  `needs_write_access` sert à choisir le sandbox codex. Poser d'avance une question qui ne servira
  peut-être pas coûte moins cher qu'un second aller-retour.
- **Des critères structurés** (`what` / `not_for` / `examples`) sur les options du Choice, pour les
  frontières qui se confondent : debug vs implement, refactor vs chore, review vs lookup.
- **Les Noul renvoient une probabilité**, donc le seuil (0.7) est un curseur de tolérance au
  risque, pas un booléen.
- **Plancher de confiance par classe.** Un seuil n'est pas un seul nombre : `implement` doit
  passer 0.75 avant qu'on fasse confiance au tier bon marché, `lookup` se contente de 0.5.
- **Le mécanique en masse descend d'un cran, mais jamais au détriment d'un signal de risque** — « en
  masse » *et* « difficile à annuler » est la combinaison la plus dangereuse, pas une raison
  d'économiser.

## Ce qui a été volontairement écarté

- **Un score de complexité comme signal de routage.** Le pattern « intent routing » de TypeSafe en
  ajoute un, mais le post dont part ce repo dit l'inverse : *« le routage n'est pas un score de
  difficulté »*. Les deux sources sont en désaccord, j'ai suivi le post.
- **Un mode lecture seule pour les workers claude.** herd ne documente que `--permission-mode
  acceptEdits` pour claude ; je n'invente pas de flag. Le distinguo lecture/écriture n'est donc
  appliqué qu'à codex, où `--sandbox read-only` est documenté.
- **Un démon.** L'appel a lieu une fois par worker spawné, un événement lourd : le démarrage de
  l'interpréteur ne se voit pas à cette fréquence, et herd assume « three files, no daemon ».
  `npm run dev` expose quand même un `POST /choose` si tu préfères un service.

## Ce qui est un point de départ, pas un résultat

- **`DEFAULT_ROUTING_TABLE`** est une heuristique, pas une table dérivée d'évals réelles. Fais
  grossir `src/evals/cases.ts` avec de vraies tâches que tu as données à des workers, puis
  `npm run eval` pour l'ajuster classe par classe.
- **Rien n'a été testé contre les API réelles** : aucune clé disponible dans l'environnement où ce
  code a été écrit, et `api.typesafe.ai` y est bloqué par le proxy. Vérifiés : typecheck, build,
  12 tests du routeur, et le pipeline complet contre un `fetch` stubbé sur les deux vendeurs.
- **Le comparatif Jev / Claude** reste disponible : `CLASSIFIER=claude npm run eval` fait tourner
  le même jeu avec Claude Haiku 4.5 comme classificateur. Ses probabilités ne sont pas calibrées,
  contrairement à celles de Jev — c'est une baseline, pas un signal équivalent.
