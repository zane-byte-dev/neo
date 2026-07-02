# Workflow Template Wizard Dev Plan

## Status

Draft. No implementation has started.

## Scope

First slice adds a template-driven creation path on top of the existing Workflow engine.

Included:

- Template catalog.
- Wizard form.
- JSON generation and preview.
- Save through existing Workflow API.
- Immediate manual run shortcut after creation.

Not included:

- New Workflow step types.
- Visual DAG editor.
- External event connectors beyond existing manual/webhook/cron.

## Data Model

No backend schema change is required for the first slice if templates only generate existing `WorkflowDefinition` JSON.

Suggested frontend template shape:

```ts
interface WorkflowTemplateSpec {
  id: string;
  name: string;
  description: string;
  defaults: {
    trigger: 'manual' | 'cron' | 'webhook';
    steps: Array<'transform' | 'agent' | 'skill'>;
  };
  buildWorkflow(input: WizardInput): WorkflowDraft;
}
```

If templates need server-side validation later, move the catalog to `src/services/workflow-templates.ts` and expose `GET /api/workflow-templates`.

## Backend Plan

First slice can reuse existing APIs:

- `GET /api/workflows`
- `PUT /api/workflows/:id`
- `POST /api/workflows/:id/run`

Backend additions only if needed:

- Add a dry-run endpoint that validates and normalizes a draft without saving.
- Return richer validation errors from workflow normalization.

Suggested files:

- `src/services/workflow-service.ts`
- `src/routes/workflows.ts`
- `src/routes/__tests__/workflows*.test.ts`

## Frontend Plan

Suggested files:

- `packages/web/src/components/WorkflowTemplateWizard.tsx`
- `packages/web/src/lib/workflowTemplates.ts`
- `packages/web/src/lib/workflow-validation.ts`
- `packages/web/src/components/SettingsPanel.tsx`

UI steps:

1. Add “从模板创建” action in Automations.
2. Render template catalog modal.
3. Build wizard steps for selected template.
4. Generate draft Workflow JSON.
5. Run existing client-side validation.
6. Save via existing API.
7. Offer “立即运行一次” and link to run history.

## Template MVP

### Morning Brief

- Trigger: cron or manual.
- Steps: transform input -> agent summary.
- Optional output: Telegram chat ID if already supported.

### Webhook Summary

- Trigger: webhook.
- Steps: transform webhook payload -> agent summary.
- Output: webhook response.

### Notebook Archive

- Trigger: manual or webhook.
- Steps: transform source text -> skill or agent summary.
- First slice may stop at generated summary if Notebook write tool is not yet reusable.

## Testing

Backend:

- Existing Workflow route tests should cover save/run.
- Add normalization test for generated drafts if dry-run endpoint is introduced.

Frontend:

- Unit test `buildWorkflow` template functions if the web test stack supports it.
- Otherwise validate through `npm --workspace neo-web run build` and browser smoke.

Validation commands:

```bash
npm run build
npm --workspace neo-web run build
npm run docs:check
```

## Documentation Updates

- Update [AUTOMATION.md](../../user-guide/AUTOMATION.md) with template wizard usage.
- Update [ROADMAP.md](../../product/ROADMAP.md) after implementation.
- Add `test-report.md` with screenshots or smoke notes.

## Risks

- Templates can hide complexity but still produce invalid workflows if fields are underspecified.
- Too many templates will clutter the UI; keep first slice to three.
- Notebook output may need a proper internal write step before the archive template feels complete.