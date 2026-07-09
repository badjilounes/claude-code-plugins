# codboard — Claude Code plugin

Plugin Claude Code qui embarque le serveur MCP `codboard` (HTTP hébergé) **et**
le workflow watcher sous forme de skills chargées à la demande. Remplace le « handoff
prompt » qu'on collait à la main : une fois le plugin installé, les outils codboard sont
disponibles et Claude sait comment piloter le board sans copier-coller — et tu **autorises
la connexion dans ton navigateur** (OAuth), sans clé à coller.

> **Périmètre.** Cette itération cible **Claude Code uniquement** (CLI + Claude Code web).
> L'intégration Codex / Cursor se fera dans une itération ultérieure.

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
    ├── skills/
    │   ├── codboard-workflow/        # entrée : charge get_workflow, oriente la session
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

## Les 4 skills

Le handoff prompt (auparavant un pavé collé depuis la web app) est découpé par
*job-to-be-done*. Claude ne charge chaque skill que quand elle est pertinente
(progressive disclosure) :

| Skill | Rôle |
| --- | --- |
| `codboard-workflow` | Au début de session : `get_workflow`, lire statuses/transitions/playbook/automation/reportPrompt, orchestrer les autres skills. |
| `codboard-task` | Ticket → `create_request` → `create_task`, start/finish, status/branch/PR, présence (`start_session`/`heartbeat_task`/`end_session`), plan de test (`add_test_step`/`update_test_step`/`remove_test_step`/`list_test_steps`) + médias par URL externe. |
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
