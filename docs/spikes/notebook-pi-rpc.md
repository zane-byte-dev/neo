# Notebook → pi RPC → ATM artifact spike

Date: 2026-07-13

## Result

The vertical spike passed with a real model and the existing
`ifs视频专家调研任务_20260608.md` Notebook source.

Observed tool sequence:

```text
Neo spike runner
  → pi --mode rpc
  → knowledge_search (ATM CLI adapter)
  → knowledge_get (ATM CLI adapter)
  → artifact_save (ATM CLI adapter)
  → workspace/artifacts/*.md
```

The artifact contains schema v1 frontmatter, producer `pi`, the source document
ID/path/line range, and inline line citations. The final pi response returned the
saved artifact path. The bridge test suite separately covers prompt acceptance,
event streaming, `agent_settled`, abort, unsupported commands, and process exit.

## Decisions

1. **Context injection**: do not add a new pi RPC context command. Neo sends a
   task/profile instruction in the prompt, while the pi extension retrieves
   selected Notebook content through ATM tools. Large source text is not copied
   into process arguments.
2. **Process ownership**: Neo's thin local bridge directly owns pi child
   processes. The experimental pi orchestrator is not a stable dependency. This
   decision can be revisited only after orchestrator API and recovery tests exist.
3. **Event mapping**: `message_update.text_delta` maps to Neo text streaming;
   thinking deltas map to thought activity; `tool_execution_*` maps to tool cards;
   `extension_ui_request` maps to approval/input UI; `agent_settled` is the run
   completion boundary. RPC command responses are acknowledgements, not terminal
   run events.
4. **Artifact ownership**: pi calls ATM `artifact_save`. Neo renders the returned
   artifact reference and does not parse final prose to create a second copy.
5. **Unattended policy**: ATM chooses cwd/profile/timeout/concurrency/retry; pi
   enforces the tool policy through an extension; atx is responsible for any hard
   provider-cost ceiling. Skills are behavior, not a security boundary.

## Implementation notes

- `PiRpcBridge` uses strict JSONL framing, request IDs, bounded stderr capture,
  startup/prompt timeouts, graceful termination, and `agent_settled` completion.
- Explicit `--extension` paths are loaded with global extension discovery off.
  Provider extensions are passed explicitly as well.
- The initial spike used the JSON CLI adapter. The extension now keeps a lazy
  ATM MCP stdio process and exposes all five stable tools; `/atm-tools-status`
  verifies the MCP path without a model call. Neo management pages use the same
  domain behavior through ATM's loopback-only HTTP API.
- Production chat now has a dual path: legacy remains the default, while
  `NEO_PI_RPC_ENABLED=opt-in` selects pi per request and `1` makes pi the
  default with an explicit legacy escape hatch.

## Production-path verification

The bridge was subsequently mounted behind `NEO_PI_RPC_ENABLED` and tested via
the real Neo HTTP API with temporary state directories:

- ordinary chat streamed `text` and `done`, then persisted both user and
  assistant messages in Neo's existing JSONL projection;
- after a full Neo server restart, the same Neo session resumed the saved pi
  session file and correctly answered from the previous turn;
- Notebook chat emitted thought, `knowledge_search` tool start/result, text,
  citations, and done through the existing Web SSE contract;
- a citation bug found during the first run (multiple chunks of one document
  collapsed to one citation) was fixed by using document + line range identity;
  the rerun cited `【3】` and delivered citation entries 1–8 with matching line
  ranges;
- the generated artifact remains readable at
  `workspace/artifacts/ifs视频专家与coding-agent集成调研报告-spike_1783913310.md`.

Validation also included full Neo regression tests outside the restricted macOS
sandbox: 117 test files and 932 tests passed. Type checks for runtime, agent,
app, and Web all passed. Existing lint debt remains warnings-only.

## Content skill migration

The selected content workflows now live as pi skills rather than Neo runtime
workflows:

- `pi/skills/notebook-report`
- `pi/skills/article-draft`
- `pi/skills/news-brief`

All three passed the Codex skill validator and are explicitly loaded into each
managed pi process with global skill discovery disabled. The Notebook Studio
report route invokes `/skill:notebook-report`; its legacy implementation remains
only as the feature-flag fallback. Article and news workflows are available to
chat and future automation through the same pi skill mechanism and have no
dependency on Neo agent-core.

A real authenticated Studio request completed in 42 seconds and saved
`workspace/artifacts/ifs-视频专家集成可行性简报_1783914955.md`. The body used eight
distinct inline citation numbers, and the artifact frontmatter recorded the same
eight numbers with exact source line ranges. Targeted bridge/route regression
tests (38), the full type check, and the production build passed after the
migration.

## Optional ATX provider verification

ATX is an opt-in pi provider plugin, not a required hop. With
`NEO_PI_ATX_ENABLED` unset, Neo loads no ATX extension and pi uses its own
configured provider. With the flag set to `1`, Neo loads the bundled ATX
provider and selects `NEO_PI_ATX_MODEL` (a concrete model or ATX alias).

The real opt-in smoke routed a Notebook request through ATX to DeepSeek. It
completed three streamed model turns, called `knowledge_search` and
`knowledge_get`, and returned the cited answer through Neo SSE. ATX recorded
the selected model, upstream, latency, and input/output usage for each turn.
The smoke also exposed and fixed two ATX compatibility bugs: legacy entries
without model prefixes could fall back to the wrong active provider, and a
client's local Gateway Bearer token could leak into upstream Authorization.

Neo's former Local AI Gateway was then removed: `/v1/*` routes, protocol
translation, provider service, and API-token authentication are gone. A clean
production build removes stale auto-loaded route files, and a production smoke
confirmed `GET /v1/models` now returns 404.

## Legacy runtime removal

After the Pi and optional-ATX paths passed, Neo's duplicate execution stack was
removed rather than left dormant:

- deleted `@neo/runtime`, the AI SDK agent loop, model router/client, tool
  registry/executor, sandbox, memory, MCP loader, user skill executor, and
  approval/checkpoint control plane;
- deleted Neo Cron/Workflow/Webhook execution, the CLI/REPL runtime, Local AI
  Gateway protocol handlers, and stale management route entrypoints;
- deleted the SQLite knowledge index and removed `better-sqlite3`, AI SDK,
  `node-cron`, and runtime dependencies from the lockfile;
- migrated Notebook overview, guide, mind-map, report, audio-script, and note
  actions to managed pi RPC; and
- retained `packages/agent` only as a legacy package name for file-backed user,
  session, and Notebook data adapters. It contains no agent execution code.

The post-removal production build passed. A real authenticated chat request
included `runtime: "legacy"` and still returned `PI_ONLY_OK` through Pi SSE,
proving the escape hatch is gone. Both user and assistant messages persisted.
After a full Neo restart, the same session resumed its pi transcript and recalled
`PI_ONLY_OK`. The retained suite has 36 files and 295 tests; type checks, docs
links, and the production build pass.
