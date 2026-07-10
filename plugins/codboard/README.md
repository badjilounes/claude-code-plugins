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
    │   ├── lib.mjs               # helpers partagés (pointeur + ledger local, zéro appel API)
    │   ├── session-start.mjs     # injecte le workflow au démarrage + reset du ledger
    │   ├── post-bash.mjs         # consigne branche/PR créées + rappel juste-à-temps
    │   ├── post-codboard.mjs     # solde les jalons synchronisés + cache autoMergeMode
    │   ├── pre-merge-guard.mjs   # bloque un merge contraire à autoMergeMode
    │   └── stop-check.mjs        # bloque la fin de tour tant qu'un jalon n'est pas synchro
    ├── skills/
    │   ├── codboard-workflow/        # entrée : lit .codboard/config.json, charge get_workflow
    │   ├── codboard-task/            # cycle de vie d'une tâche (request → tasks, présence)
    │   ├── codboard-watch/           # boucle de veille : commentaires + auto-merge
    │   └── codboard-report/          # reporting selon reportPrompt + cadence
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

### 1. `/codboard:init` — le geste d'installation projet

Une commande à lancer une fois par repo. Elle résout le projet / repo / workflow via les
outils MCP et écrit :

- **`.codboard/config.json`** (committé, sans secret) : `projectId`, `repositoryId`,
  `workflowId`, `boardUrl`. C'est *la* liaison repo ↔ projet CodBoard.
- un **bloc géré dans `CLAUDE.md`** entre `<!-- codboard:begin -->` / `<!-- codboard:end -->`
  (idempotent, ré-applicable) — **des pointeurs seulement** : « lis `get_workflow`, c'est la
  source de vérité, ne recopie pas ses valeurs ici ».
- la ligne `.gitignore` pour le ledger de session (`.codboard/session-state.json`).
- (optionnel, sur accord) une ligne de checklist PR, et un `.claude/settings.json` committé
  pour activer le plugin **pour toute l'équipe** sur clone (CLI + Claude Code web). La
  couverture des agents non-Claude (Copilot/Cursor/Codex) relèvera de **leurs plugins
  dédiés**, pas de pointeurs générés ici.

### 2. Les hooks — l'application déterministe

Les hooks n'ont **pas** accès au token OAuth du MCP : ils **n'appellent jamais l'API**. Ils
lisent le pointeur committé et un **ledger local** (`.codboard/session-state.json`, non
committé) alimenté par ce qu'ils observent des appels d'outils.

| Hook | Événement | Ce qu'il garantit |
| --- | --- | --- |
| `session-start` | `SessionStart` | Chaque session d'un repo tracké démarre en connaissant CodBoard et l'ordre d'appeler `get_workflow` — sans dépendre du déclenchement d'une skill. Repo non initialisé ⇒ propose `/codboard:init`. |
| `post-bash` | `PostToolUse(Bash)` | Consigne « branche créée » / « PR ouverte » dans le ledger et pousse un rappel juste-à-temps (une fois par jalon). |
| `post-codboard` | `PostToolUse(mcp __*codboard*__)` | Met en cache **les 4 sections** de `get_workflow` (Workflow/Automation/Testing/Report) dans le ledger, et solde les obligations au fil des appels (`set_task_branch`, `set_task_pull_request`, `add_test_step`, `create_media_upload`, `upsert_report`, `complete_execution`/`change_task_status`→terminal). |
| `pre-merge-guard` | `PreToolUse(Bash)` | Intercepte `gh pr merge` : **deny** si `autoMergeMode: none`, **ask** si la politique n'a pas encore été lue. |
| `stop-check` | `Stop` | **Bloque la fin du tour** tant qu'une obligation des 4 sections n'est pas remplie (branche/PR non mirroré, plan de test/capture manquant si requis, report périmé vs cadence). Garde anti-boucle via `stop_hook_active`. |

Les 4 sections de config sont **lues via `get_workflow`** (jamais figées) et mappées à
l'enforcement :

| Section | Champs | Ce que les hooks en font |
| --- | --- | --- |
| **Workflow** | `statuses`, `transitions`, `playbook` | Gate branche/PR au `Stop`. Les transitions gardées (artefact `change_request`, `reason`) sont validées **côté serveur** au `change_task_status`. |
| **Automation** | `autoMergeMode`, `watch`, `reportingCadence` | `autoMergeMode` → garde de merge. `reportingCadence` → alimente le gate Report. |
| **Testing** | `testing.testPlans`, `testing.capture.{screenshots,video}` | Une tâche finie sans plan de test (`always`) ou sans capture (`required`) bloque le `Stop`. |
| **Report** | `reportPrompt`, `reportingCadence` | Après une fin de tâche (ou chaque note, selon la cadence), un report périmé bloque le `Stop` — sauf cadence `manual`. |

Tous les hooks **no-op** hors d'un repo tracké (pas de `.codboard/config.json`) et
n'échouent jamais une session (toute erreur interne → sortie 0 silencieuse). Les gates
Testing/Report ne s'activent qu'une fois `get_workflow` lu (politique inconnue ⇒ pas de
blocage surprise) ; les gates branche/PR et la garde de merge sont toujours actifs.

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
| `codboard-task` | Ticket → `create_request` → `create_task`, start/finish, status/branch/PR, présence (`start_session`/`heartbeat_task`/`end_session`), plan de test (`add_test_step`/`update_test_step`/`remove_test_step`/`list_test_steps`) + hébergement des médias sur R2 (`create_media_upload` → URL présignée, l'agent PUT les octets). |
| `codboard-watch` | Boucle : `list_comments` + application des 4 modes `automation.autoMergeMode`. |
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
