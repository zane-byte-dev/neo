# First-run Checklist Implementation Plan

## Product Input

Product Brief: [brief.md](brief.md)

Goal: add a lightweight, dismissible onboarding checklist to the empty Chat welcome state so new users can see the shortest path to value.

## Current System

- `web/src/components/WelcomeScreen.tsx` renders the empty-chat welcome state and three quick-start cards.
- `web/src/components/ChatArea.tsx` renders `WelcomeScreen` whenever `chatMessages.length === 0`.
- `web/src/api.ts` already exposes `fetchModels()`, `notebookListNotebooks()`, and `notebookList()`.
- `web/src/stores/useAppStore.ts` uses Zustand persist for selected UI state.
- `web/src/i18n/locales/en.ts` and `zh.ts` define shared translation keys.

## Target Design

Add a compact checklist below the welcome headline and above the existing quick-start cards.

The MVP checklist contains three steps:

- Configure a model.
- Send the first message.
- Create a Notebook note.

Completion state sources:

- Model: `fetchModels()` has at least one `model.configured === true`.
- Message: current in-memory messages contain a user message, or loaded chats indicate an existing non-default chat.
- Notebook: at least one notebook has at least one entry via `notebookListNotebooks()` + `notebookList(notebook)`.

Dismissal is stored in the persisted frontend store for this MVP. The backend preferences schema is not expanded in this iteration.

## Scope

In scope:

- Add persisted `firstRunChecklistDismissed` state to the app store.
- Add checklist UI and actions to `WelcomeScreen`.
- Add i18n keys for the checklist and existing welcome card text touched by this change.
- Keep the existing quick-start cards.

Out of scope:

- Full guided tour or modal onboarding.
- Backend user preference schema changes.
- Settings page restructuring.
- System health panel.

## Files To Change

- `web/src/types/index.ts`
- `web/src/stores/slices/uiSlice.ts`
- `web/src/stores/useAppStore.ts`
- `web/src/components/WelcomeScreen.tsx`
- `web/src/i18n/locales/en.ts`
- `web/src/i18n/locales/zh.ts`
- `docs/README.md`

## Data Model / API / UI Changes

No backend API changes.

Frontend store adds:

```ts
firstRunChecklistDismissed: boolean
setFirstRunChecklistDismissed: (dismissed: boolean) => void
```

UI actions:

- Configure model -> `/settings/models`
- Send first message -> create or focus chat input
- Create notebook note -> `/notebook/article/new?notebook=personal`

## Implementation Steps

1. Extend the app state and persisted store with `firstRunChecklistDismissed`.
2. Update `WelcomeScreen` to fetch model and notebook completion state when the checklist is visible.
3. Compute message completion from loaded chat/message state.
4. Render the checklist with completed/pending states and compact action buttons.
5. Add English and Chinese i18n keys.
6. Run docs and frontend build verification.

## Test Plan

- Run `npm run docs:check` for documentation links.
- Run `npm --prefix web run build` for TypeScript and Vite build verification.
- Manual smoke checks once dev server is available:
  - Empty Chat shows checklist.
  - Dismiss hides checklist after refresh.
  - Configure model action opens settings models tab.
  - Send-message action focuses the chat input.
  - Notebook action opens the new note route.

## Compatibility And Migration

- Bump the persisted web store version so existing users get `firstRunChecklistDismissed: false` by default.
- Older local storage data remains valid; missing checklist state is treated as not dismissed.

## Risks

- Notebook completion currently requires one lightweight request per notebook; keep this behind the welcome screen only.
- Existing users with server-side sessions but no loaded messages may be marked as having sent a first message based on chat metadata.
- Model status can be slow if providers are checked live; checklist should remain usable while loading.

## Out Of Scope

- Persisting checklist dismissal in backend user preferences.
- Tracking source import separately from note creation.
- Adding dedicated frontend tests; the web package currently has no test runner setup.