# codboard — Claude Code plugin

Plugin Claude Code qui embarque le serveur MCP `codboard` (HTTP hébergé), le
workflow watcher (skills à la demande), une commande d'initialisation `/codboard:init`
**et des hooks déterministes** qui rendent la synchronisation **forte et automatique** —
pas seulement suggérée. Une fois le plugin installé, les outils codboard sont disponibles,
Claude sait piloter le board sans copier-coller, et le harness **force** la sync à chaque
jalon. Tu **autorises la connexion dans ton navigateur** (OAuth), sans clé à coller.

> **Pourquoi des hooks ?** Les skills sont à *chargement conditionnel* : un agent qui
> n'estime pas « travailler un ticket CodBoard » ne les charge jamais, donc ne synchronise
> rien — la sync reste probabiliste. Les **hooks** sont exécutés par le harness Claude Code
> (pas par le modèle) : ils sont déterministes. C'est ce qui transforme « merci de garder le
> board à jour » en garantie. Voir la section [Synchronisation FORTE](#synchronisation-forte-hooks--codboardinit).

> **Périmètre.** Les hooks et skills ciblent **Claude Code** (CLI + Claude Code web). Les
> agents non-Claude auront **leur propre plugin CodBoard dédié** (Copilot, Cursor, Codex —
> à venir) : un dev qui utilise un autre provider installe le plugin de ce provider, donc
> l'init de Claude Code ne génère **pas** de pointeurs à leur place. Côté serveur, les
> réponses MCP portent aussi des rappels valables pour tout client MCP.

## Où vivent les fichiers

Ce plugin est publié dans la marketplace **[`badjilounes/claude-code-plugins`](https://github.com/badjilounes/claude-code-plugins)** :
le catalogue est à la racine de ce repo, le plugin dans `plugins/codboard/`.

```
claude-code-plugins/               (repo = marketplace)
├── .claude-plugin/
│   └── marketplace.json           # catalogue : liste le plugin "codboard" → ./plugins/codboard
└── plugins/codboard/                 (racine du plugin)
    ├── .claude-plugin/
    │   └── plugin.json            # manifeste du plugin
    ├── .mcp.json                  # serveur MCP codboard (juste l'URL — auth OAuth au navigateur)
    ├── commands/
    │   └── init.md               # /codboard:init — lie le repo à son projet (pointeur committé)
    ├── hooks/
    │   ├── hooks.json            # câblage : SessionStart / Pre+PostToolUse / Stop
    │   ├── lib.mjs               # helpers partagés (pointeur + ledger local + git, zéro appel API)
    │   ├── session-start.mjs     # injecte le workflow au démarrage + reset du ledger + capte la branche
    │   ├── post-work.mjs         # consigne « du code a changé » (gate d'existence)
    │   ├── post-bash.mjs         # consigne branche créée/poussée, PR, commit + rappel juste-à-temps
    │   ├── post-github.mjs       # idem via le serveur MCP GitHub (sessions web, sans `gh`)
    │   ├── post-codboard.mjs     # solde les jalons synchronisés + cache autoMergeMode
    │   ├── pre-merge-guard.mjs   # bloque un merge contraire à autoMergeMode (Bash *et* MCP)
    │   ├── stop-check.mjs        # bloque la fin de tour tant qu'un jalon n'est pas synchro
    │   └── hooks.test.mjs        # `node hooks/hooks.test.mjs` — rejoue les sessions qui passaient au travers
    ├── skills/
    │   ├── codboard-workflow/        # entrée : lit .codboard/config.json, charge get_workflow
    │   ├── codboard-task/            # cycle de vie d'une tâche (request → tasks, présence)
    │   ├── codboard-watch/           # boucle de veille : commentaires + auto-merge
    │   └── codboard-report/          # reporting selon le reportPrompt du projet + cadence
    └── README.md
```

> Le catalogue est **à la racine du repo** parce que le CLI
> `claude plugin marketplace add <owner/repo>` cherche `.claude-plugin/marketplace.json`
> **à la racine** du repo distant — il n'existe aucune syntaxe `owner/repo/subdir` ni de flag
> `--path`. Le plugin, lui, peut vivre dans un sous-dossier (`source: ./plugins/codboard`).

## Authentification : OAuth au navigateur (pas de clé à coller)

Le [`.mcp.json`](.mcp.json) ne déclare **que l'URL** du serveur. À la première utilisation,
Claude découvre l'OAuth du serveur, ouvre ton navigateur et te fait **autoriser le connecteur
CodBoard** (login email/mdp ou « Continuer avec mon compte CodBoard » → Google/GitHub). Aucune
`CODBOARD_API_KEY` à exporter côté client (cf. [ADR 0014](https://github.com/badjilounes/board/blob/main/docs/adr/0014-oauth-mcp-http-connecteur-claude-ai.md) / [0015](https://github.com/badjilounes/board/blob/main/docs/adr/0015-login-board-connecteur-mcp-pont-consentement-web.md)).

> La clé API par projet reste utile **uniquement** pour les usages **machine/CI** ou le
> **repli MCP-seul** (`claude mcp add … --header "x-api-key: …"`) — le serveur accepte
> encore `x-api-key` en parallèle de l'OAuth. Elle se génère et se gère depuis la page
> **Connect** (onglet Overview) de l'app CodBoard.

---

## Cible 1 — Install en CLI (Claude Code local)

> **Cet install ne survit pas à une session hébergée.** `claude plugin install` écrit dans
> `~/.claude/`, et Claude Code web démarre chaque session dans un conteneur neuf : le plugin
> n'y est pas, aucun hook ne tourne, et **rien ne signale l'absence** — un repo peut porter
> `.codboard/config.json` et n'être gardé par rien. Le CLI sert à essayer le plugin sur ta
> machine ; le point durable est le `.claude/settings.json` committé de la **Cible 2**, que
> `/codboard:init` écrit désormais pour toi.

```bash
claude plugin marketplace add badjilounes/claude-code-plugins
claude plugin install codboard@badjilounes
```

À la première utilisation d'un outil codboard, **autorise le connecteur dans le navigateur**.
Vérifie ensuite :

```bash
/mcp     # doit lister "codboard" comme connecté
```

Pour **tester en local avant de pousser** (depuis un clone de ce repo) :

```bash
claude plugin marketplace add ./            # depuis la racine du repo marketplace
claude plugin install codboard@badjilounes
```

Puis retire l'ancien serveur MCP ajouté à la main, pour éviter le doublon :

```bash
claude mcp remove codboard
```

## Cible 2 — Install sur Claude web (fichier committé)

Il n'y a **pas d'upload manuel** : sur **Claude Code web** (sessions cloud sur un repo GitHub
connecté), le fichier lu au démarrage de session est le `.claude/settings.json` committé du
repo sur lequel tu travailles. Il déclare le marketplace + active le plugin :

```json
{
  "extraKnownMarketplaces": {
    "badjilounes": {
      "source": { "source": "github", "repo": "badjilounes/claude-code-plugins" }
    }
  },
  "enabledPlugins": {
    "codboard@badjilounes": true
  }
}
```

Conditions pour que le web l'honore :

1. La marketplace doit être **sur GitHub** — ce repo est **public** (un repo privé couvert
   par le compte GitHub connecté marche aussi) ; source `github` → réseau requis, pas de
   chemin local dans le clone cloud.
2. Autorise le connecteur **dans le navigateur** à la première utilisation — **aucun secret
   cloud à définir** (l'OAuth remplace la clé).
3. L'hôte du serveur MCP (`mcp.codboard.com`) n'est pas sur l'allowlist
   réseau « Trusted » par défaut ⇒ autorise l'accès réseau (Full/Custom) côté environnement web.

> **claude.ai chat (grand public)** n'a **pas** de plugins ni de skills importables — juste
> des « Connectors ». Ajoute CodBoard via Settings → Connectors → Add custom connector →
> `https://mcp.codboard.com/mcp` ; le connecteur lance **le même OAuth**
> (autorisation au navigateur). Tu obtiens les **outils** MCP, mais **pas les skills** du plugin.

---

## Synchronisation FORTE (hooks + `/codboard:init`)

Trois pièces transforment la sync « au bon vouloir de l'agent » en sync **garantie**. Le
paramétrage (workflow, automation, testing, reporting) **reste dans CodBoard** ; le repo ne
contient qu'un **pointeur** — jamais les valeurs (elles changent par projet, les recopier
dans `CLAUDE.md` c'est se garantir un fichier qui ment).

### 1. `/codboard:init` — écrit le pointeur

Une commande à lancer une fois par repo. **Une seule interaction : sélectionner le projet**
(et seulement s'il n'est pas résolu automatiquement — `.codboard/config.json` existant,
argument, remote git, ou projet unique). Elle écrit alors, sans autre validation :

- **`.codboard/config.json`** (committé, sans secret) : `projectId`, `repositoryId`,
  `workflowId`, `boardUrl`. C'est *la* liaison repo ↔ projet CodBoard.
- la ligne `.gitignore` du ledger de session (`.codboard/session-state.json`) — la seule
  partie de `.codboard/` à ne pas committer.
- **`.claude/settings.json`** (committé, en **fusion** — les autres plugins et hooks du repo
  sont préservés) : `extraKnownMarketplaces.badjilounes` + `enabledPlugins`
  `["codboard@badjilounes"]`. Sans lui le pointeur ne sert à rien en session hébergée : le
  repo est *tracké* mais le plugin n'est pas *installé*, donc aucun hook ne tourne. Les deux
  clés vont ensemble — sans la marketplace, `codboard@badjilounes` ne résout pas.

Puis elle **s'arrête** : pas de `git add` / commit / merge — les fichiers restent en working
tree, l'utilisateur les revoit et les commit lui-même.

**Rien d'autre n'est écrit.** Pas d'édition de `CLAUDE.md` (le hook `SessionStart` lit
`config.json` et injecte le pointeur à chaque session — un bloc dans `CLAUDE.md` serait
redondant), pas de PR template, pas de `AGENTS.md` / `copilot-instructions.md`. Un PR
template est un choix propre au client ; les agents non-Claude relèvent de **leurs plugins
dédiés** (Copilot/Cursor/Codex).

> **Pourquoi `.claude/settings.json` n'est plus optionnel.** Il l'était jusqu'à la v0.8.0,
> et c'est ce qui a produit la panne : un repo portait `.codboard/config.json` sans que le
> plugin soit déclaré, donc tournait sans le moindre hook, sans que rien ne le signale.
> Écrire le pointeur sans activer le plugin, c'est livrer une serrure sans porte. Le fichier
> change bien la config de toute personne qui clone — c'est l'effet voulu, et `/codboard:init`
> le dit explicitement avant que l'utilisateur commit.

### 2. Les hooks — l'application déterministe

Les hooks n'ont **pas** accès au token OAuth du MCP : ils **n'appellent jamais l'API**. Ils
lisent le pointeur committé et un **ledger local** (`.codboard/session-state.json`, non
committé) alimenté par ce qu'ils observent des appels d'outils.

| Hook | Événement | Ce qu'il garantit |
| --- | --- | --- |
| `session-start` | `SessionStart` | Chaque session d'un repo tracké démarre en connaissant CodBoard et l'ordre d'appeler `get_workflow` — sans dépendre du déclenchement d'une skill. **Capte aussi la branche courante** (`git rev-parse`), parce qu'en session hébergée elle est créée par le harness avant le premier tour : aucune commande observable ne la fabrique. Repo non initialisé ⇒ propose `/codboard:init`. |
| `post-work` | `PostToolUse(Edit\|Write\|…)` | **Gate d'existence** : consigne que la session a modifié du code. Sans lui, éditer → commit → push → stop satisfait tous les autres gates avec zéro ticket sur le board. |
| `post-bash` | `PostToolUse(Bash)` | Consigne branche **créée ou poussée** (toutes les formes : `checkout -b`/`-B`, `switch -c`/`-C`/`--create`, `git branch`, `push -u`, et tout `git push` sur une branche de travail), PR ouverte, commit — puis pousse un rappel juste-à-temps (une fois par jalon). |
| `post-github` | `PostToolUse(mcp __*github*__)` | Les mêmes jalons via le **serveur MCP GitHub** : `create_pull_request`, `create_branch`, `push_files`. Indispensable en session Claude Code web, où `gh` n'existe pas — sans lui la détection de PR est structurellement morte. |
| `post-codboard` | `PostToolUse(mcp __*codboard*__)` | Met en cache la config des **trois** sources (`get_workflow`, `get_project`, `list_repositories`) dans le ledger, et solde les obligations au fil des appels (`start_execution`/`log_activity` soldent le gate d'existence ; `set_task_branch`, `set_task_pull_request`, `upsert_report`, `complete_execution`/`change_task_status`→terminal). **Miroirs distants (ADR 0044) :** à chaque `change_task_status`/`change_request_status`, rappelle à l'agent de **redéclarer** les miroirs distants en lecture seule — statut du ticket via `update_request` (remoteStatus) et état de PR via `set_task_pull_request` — pour que les badges restent frais. Le hook ne lit jamais le distant ni n'appelle l'API : c'est l'agent, déjà connecté, qui redéclare. |
| `pre-merge-guard` | `PreToolUse(Bash \| mcp __*github*__)` | Intercepte `gh pr merge` **et** `merge_pull_request`/`enable_pr_auto_merge` : **deny** si `autoMergeMode: none`, **ask** si la politique n'a pas encore été lue, **laisse passer sans confirmation** les modes permissifs (le mode configuré vaut autorisation). Un appel MCP nomme son dépôt (`owner`/`repo`), ce qui est plus précis que le remote du répertoire courant. |
| `stop-check` | `Stop` | **Bloque la fin du tour** tant qu'une obligation n'est pas remplie : code modifié sans run ouvert, branche/PR non mirroré, report périmé vs cadence. Garde anti-boucle via `stop_hook_active`. |

La config est **lue à l'exécution** (jamais figée) depuis **trois** sources — un workflow est
une machine à états et rien d'autre (ADR 0069) — et mappée à l'enforcement :

| Section | Champs | Ce que les hooks en font |
| --- | --- | --- |
| **Workflow** | `statuses`, `transitions` (+ `policy`), `playbook` | Gate branche/PR au `Stop`. Un projet peut porter **plusieurs workflows nommés** (`list_workflows`, `get_workflow({ taskId })`). Chaque transition est validée **côté serveur** au `change_task_status` : gardes d'evidence (artefact `change_request`, `reason`, preuves `branch`/`pullRequest`/`tests`/`acceptanceCriteria` sous `strict`) **et** policy d'exécution — `human_only`/`agent_only`/rôles et approbation humaine (`human_approval` via directive `approve_transition`) refusent le franchissement (403). Avant de tenter un passage, `get_transition_policy({ id, toStatus })` répond sans rien modifier ce qui manque encore (`missing`) et si le passage serait refusé (`wouldBlock`). |
| **Dépôt** (`list_repositories`) | `automation.{autoMergeMode, autoCreatePr, ciCheckName}` | `autoMergeMode` → garde de merge, **par dépôt** : le hook compare le remote du répertoire courant aux dépôts du projet, donc l'API et le site de docs peuvent répondre différemment. Un mode non-`none` **vaut mandat** : contrainte satisfaite ⇒ merge **sans redemander** (seul `none` = merge par l'owner). `reportingCadence` → alimente le gate Report. `autoRun` (`mode` off/on_demand/eligible, `leaseMinutes`, `maxConcurrent`, `statuses`) dit si le projet **distribue du travail** : `claim_next_task` répond `claimed` avec un bail, ou `auto_run_off` / `max_concurrent_reached` / `nothing_claimable`. CodBoard ne démarre jamais un agent — l'agent demande. |
| **Projet** (`get_project`) | `reportPrompt`, `reportingCadence`, `autoRun`, `watch` | Après une fin de tâche (ou chaque note, selon la cadence), un report périmé bloque le `Stop` — sauf cadence `manual`. `autoRun` (`mode` off/on_demand/eligible, `leaseMinutes`, `maxConcurrent`, `statuses`) dit si le projet **distribue du travail** : `claim_next_task` répond `claimed` avec un bail, ou `auto_run_off` / `max_concurrent_reached` / `nothing_claimable`. CodBoard ne démarre jamais un agent — l'agent demande. |
| **Plan de test & capture** | `policy.proofs.{testPlan, capture}` sur une transition | Plus de gate local : quand la transition l'exige, c'est le **serveur** qui refuse le passage. `get_transition_policy` dit ce qui manque avant d'essayer. |

Tous les hooks **no-op** hors d'un repo tracké (pas de `.codboard/config.json`) et
n'échouent jamais une session (toute erreur interne → sortie 0 silencieuse). Le gate
Report ne s'active qu'une fois `get_project` lu (politique inconnue ⇒ pas de
blocage surprise) ; les gates existence, branche/PR et la garde de merge sont toujours actifs.

> **Deux règles tirées d'une session qui est passée au travers.** (1) Un capteur qui
> n'observe que `Bash` + `gh` est **aveugle dans l'environnement principal du plugin** :
> une session Claude Code web n'a pas de `gh`, et sa branche est créée par le harness avant
> le premier tour. Chaque gate doit donc couvrir la voie Bash **et** la voie MCP. (2) Vérifier
> qu'un jalon est *mirroré* ne vérifie jamais qu'il *existe* : tant qu'aucun gate ne
> demandait « où est le run ? », travailler sans ticket satisfaisait toutes les conditions.
> `hooks/hooks.test.mjs` rejoue ces deux cas — lance-le après toute modification des hooks.

### 3. Filet côté serveur

Rappels portés par les réponses MCP (valables pour **tout** client MCP, pas seulement Claude
Code) + détection de dérive board ↔ GitHub côté produit. Ces éléments vivent dans
[badjilounes/board](https://github.com/badjilounes/board) et sont documentés dans son ADR de
synchronisation forte.

> **Anti-pattern à éviter.** Recopier le workflow, `autoMergeMode`, la liste des jalons ou
> la politique de merge dans `CLAUDE.md` (comme le faisait le contournement manuel avant ce
> plugin) : le fichier diverge dès que l'owner change la config dans CodBoard. Le besoin
> (sync forte, systématique) est juste ; l'implémentation correcte est *pointeur + hooks +
> `get_workflow`*, pas duplication.

## Les 4 skills

Le handoff prompt (auparavant un pavé collé depuis la web app) est découpé par
*job-to-be-done*. Claude ne charge chaque skill que quand elle est pertinente
(progressive disclosure) :

| Skill | Rôle |
| --- | --- |
| `codboard-workflow` | Au début de session : lit `.codboard/config.json` (le pointeur écrit par `/codboard:init`) puis `get_workflow`, lit statuses/transitions/playbook/automation/reportPrompt, orchestre les autres skills. |
| `codboard-task` | Ticket → `create_request` → `create_task`, start/finish, status/branch/PR, **run déclaré** (`start_execution` → `executionId`, `log_activity` pour ce que la branche et la PR ne disent pas, `complete_execution`/`fail_execution`), présence (`start_session`/`heartbeat_task`/`end_session`), plan de test (`add_test_step`/`update_test_step`/`remove_test_step`/`list_test_steps`) + hébergement des médias sur R2 (`create_media_upload` → URL présignée, l'agent PUT les octets). |
| `codboard-watch` | Boucle à **deux inbox** : `list_comments` (commentaires) + `list_pending_directives` (directives `create_pr`/`merge_pr` → ouvrir/merger la PR puis `resolve_task_directive`) ; puis politique permanente `autoCreatePr` + les 4 modes `autoMergeMode` du dépôt de la tâche — un mode non-`none` dont la contrainte est satisfaite déclenche le merge **sans redemander** à l'utilisateur. |
| `codboard-report` | `list_work_notes` → `upsert_report` selon `reportPrompt` et `reportingCadence`. |

**Aucune valeur runtime n'est figée dans les skills.** `autoMergeMode`, `reportPrompt`,
`reportingCadence` sont par projet et lues via `get_workflow` à chaque session — les skills
encodent la *procédure*, pas les *paramètres*.

## Source de vérité

Ces skills sont la **source canonique** du workflow watcher et vivent ici, dans la
marketplace. Le produit — app, API, MCP server, docs ADR — reste dans le repo
**[badjilounes/board](https://github.com/badjilounes/board)**. Le handoff prompt de la web
app ne subsiste plus que dans le **repli MCP-seul** (client sans plugin, donc sans skills) ;
pour Claude Code en plugin, les skills le remplacent.
