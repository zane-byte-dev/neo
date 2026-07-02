import type { WorkflowDefinition } from '../types'

type WorkflowSavePayload = Omit<WorkflowDefinition, 'id' | 'createdAt' | 'updatedAt' | 'lastRun'> & Partial<Pick<WorkflowDefinition, 'id'>>

const WORKFLOW_ID_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/

export type WorkflowValidationCode =
    | 'invalidJson'
    | 'invalidWorkflowId'
    | 'workflowBodyObject'
    | 'workflowEnabledBoolean'
    | 'workflowTriggerObject'
    | 'workflowTriggerType'
    | 'workflowTriggerCron'
    | 'workflowTriggerSecret'
    | 'workflowStepsArray'
    | 'workflowStepsMin'
    | 'workflowStepsMax'
    | 'workflowStepObject'
    | 'workflowStepIdPattern'
    | 'workflowStepNameString'
    | 'workflowStepType'
    | 'workflowStepTemplate'
    | 'workflowStepMessage'
    | 'workflowStepSkillName'
    | 'workflowStepArgsObject'

export interface WorkflowValidationIssue {
    code: WorkflowValidationCode
    path?: string
    line?: number
    column?: number
    offset?: number
    meta?: Record<string, string | number>
}

export type WorkflowValidationResult =
    | { ok: true; value: WorkflowSavePayload }
    | { ok: false; error: WorkflowValidationIssue }

class WorkflowValidationError extends Error {
    readonly issue: Omit<WorkflowValidationIssue, 'line' | 'column' | 'offset'>

    constructor(issue: Omit<WorkflowValidationIssue, 'line' | 'column' | 'offset'>) {
        super(issue.code)
        this.issue = issue
    }
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
    Boolean(value) && typeof value === 'object' && !Array.isArray(value)
)

const fail = (
    code: WorkflowValidationCode,
    path?: string,
    meta?: Record<string, string | number>,
): never => {
    throw new WorkflowValidationError({ code, ...(path ? { path } : {}), ...(meta ? { meta } : {}) })
}

const clampOffset = (source: string, offset: number): number => {
    if (!Number.isFinite(offset)) return 0
    return Math.max(0, Math.min(source.length, offset))
}

const firstContentOffset = (source: string): number => {
    const match = source.match(/\S/)
    return match ? match.index ?? 0 : 0
}

const offsetToLineColumn = (source: string, offset: number): { line: number; column: number } => {
    const safeOffset = clampOffset(source, offset)
    let line = 1
    let lineStart = 0

    for (let index = 0; index < safeOffset; index += 1) {
        if (source[index] === '\n') {
            line += 1
            lineStart = index + 1
        }
    }

    return { line, column: safeOffset - lineStart + 1 }
}

const lineColumnToOffset = (source: string, line: number, column: number): number => {
    const targetLine = Math.max(1, line)
    const targetColumn = Math.max(1, column)
    let currentLine = 1
    let currentOffset = 0

    while (currentLine < targetLine && currentOffset < source.length) {
        if (source[currentOffset] === '\n') currentLine += 1
        currentOffset += 1
    }

    return clampOffset(source, currentOffset + targetColumn - 1)
}

const findMatchingBracket = (source: string, start: number, open: '{' | '[', close: '}' | ']'): number | undefined => {
    let depth = 0
    let inString = false
    let escaped = false

    for (let index = start; index < source.length; index += 1) {
        const char = source[index]

        if (inString) {
            if (escaped) escaped = false
            else if (char === '\\') escaped = true
            else if (char === '"') inString = false
            continue
        }

        if (char === '"') {
            inString = true
            continue
        }

        if (char === open) {
            depth += 1
            continue
        }

        if (char === close) {
            depth -= 1
            if (depth === 0) return index
        }
    }

    return undefined
}

const findKeyValueStart = (source: string, key: string, from = 0, to = source.length): number | undefined => {
    const needle = `"${key}"`
    let searchFrom = from

    while (searchFrom < to) {
        const keyIndex = source.indexOf(needle, searchFrom)
        if (keyIndex < 0 || keyIndex >= to) return undefined
        let cursor = keyIndex + needle.length

        while (cursor < to && /\s/.test(source[cursor])) cursor += 1
        if (source[cursor] !== ':') {
            searchFrom = keyIndex + needle.length
            continue
        }

        cursor += 1
        while (cursor < to && /\s/.test(source[cursor])) cursor += 1
        return cursor
    }

    return undefined
}

const findKeyOffset = (source: string, key: string, from = 0, to = source.length): number | undefined => {
    const needle = `"${key}"`
    const keyIndex = source.indexOf(needle, from)
    if (keyIndex < 0 || keyIndex >= to) return undefined
    return keyIndex
}

const findArrayItemRange = (
    source: string,
    arrayStart: number,
    arrayEnd: number,
    targetIndex: number,
): { start: number; end: number } | undefined => {
    let index = 0
    let itemStart: number | undefined
    let depth = 0
    let inString = false
    let escaped = false

    for (let cursor = arrayStart + 1; cursor < arrayEnd; cursor += 1) {
        const char = source[cursor]

        if (inString) {
            if (escaped) escaped = false
            else if (char === '\\') escaped = true
            else if (char === '"') inString = false
            continue
        }

        if (char === '"') {
            inString = true
            if (itemStart === undefined) itemStart = cursor
            continue
        }

        if (itemStart === undefined) {
            if (/\s/.test(char) || char === ',') continue
            itemStart = cursor
        }

        if (char === '{' || char === '[') {
            depth += 1
            continue
        }

        if (char === '}' || char === ']') {
            depth = Math.max(0, depth - 1)
            continue
        }

        if (char === ',' && depth === 0) {
            if (index === targetIndex && itemStart !== undefined) {
                return { start: itemStart, end: cursor }
            }
            index += 1
            itemStart = undefined
        }
    }

    if (itemStart !== undefined && index === targetIndex) {
        return { start: itemStart, end: arrayEnd }
    }

    return undefined
}

const locatePathOffset = (source: string, path?: string): number => {
    if (!path || path === '$') return firstContentOffset(source)

    const stepMatch = path.match(/^steps\[(\d+)](?:\.(.+))?$/)
    if (stepMatch) {
        const stepsValueStart = findKeyValueStart(source, 'steps')
        const stepsKeyOffset = findKeyOffset(source, 'steps')
        if (stepsValueStart === undefined) return stepsKeyOffset ?? firstContentOffset(source)
        const arrayStart = source.indexOf('[', stepsValueStart)
        if (arrayStart < 0) return stepsValueStart
        const arrayEnd = findMatchingBracket(source, arrayStart, '[', ']')
        if (arrayEnd === undefined) return arrayStart
        const itemRange = findArrayItemRange(source, arrayStart, arrayEnd, Number(stepMatch[1]))
        if (!itemRange) return arrayStart
        const stepField = stepMatch[2]
        if (!stepField) return itemRange.start
        return findKeyOffset(source, stepField, itemRange.start, itemRange.end) ?? itemRange.start
    }

    const triggerMatch = path.match(/^trigger(?:\.(.+))?$/)
    if (triggerMatch) {
        const triggerValueStart = findKeyValueStart(source, 'trigger')
        const triggerKeyOffset = findKeyOffset(source, 'trigger')
        if (triggerValueStart === undefined) return triggerKeyOffset ?? firstContentOffset(source)
        const triggerField = triggerMatch[1]
        if (!triggerField) return triggerValueStart
        const objectStart = source.indexOf('{', triggerValueStart)
        if (objectStart < 0) return triggerValueStart
        const objectEnd = findMatchingBracket(source, objectStart, '{', '}')
        if (objectEnd === undefined) return objectStart
        return findKeyOffset(source, triggerField, objectStart, objectEnd) ?? objectStart
    }

    return findKeyValueStart(source, path) ?? findKeyOffset(source, path) ?? firstContentOffset(source)
}

const attachLocation = (
    source: string,
    issue: Omit<WorkflowValidationIssue, 'line' | 'column' | 'offset'>,
): WorkflowValidationIssue => {
    const offset = locatePathOffset(source, issue.path)
    const { line, column } = offsetToLineColumn(source, offset)
    return { ...issue, offset, line, column }
}

const syntaxIssue = (source: string, error: unknown): WorkflowValidationIssue => {
    const reason = error instanceof Error ? error.message : String(error)
    const positionMatch = reason.match(/position\s+(\d+)/i)
    const lineColumnMatch = reason.match(/line\s+(\d+)\s+column\s+(\d+)/i)

    let offset = firstContentOffset(source)
    let location = offsetToLineColumn(source, offset)

    if (positionMatch) {
        offset = clampOffset(source, Number(positionMatch[1]))
        location = offsetToLineColumn(source, offset)
    } else if (lineColumnMatch) {
        location = {
            line: Number(lineColumnMatch[1]),
            column: Number(lineColumnMatch[2]),
        }
        offset = lineColumnToOffset(source, location.line, location.column)
    }

    return {
        code: 'invalidJson',
        path: '$',
        offset,
        line: location.line,
        column: location.column,
        ...(reason ? { meta: { reason } } : {}),
    }
}

const validateTrigger = (value: unknown): void => {
    if (value === undefined) return
    if (!isRecord(value)) fail('workflowTriggerObject', 'trigger')

    const trigger = value as Record<string, unknown>

    const triggerType = trigger.type
    if (triggerType !== 'manual' && triggerType !== 'webhook' && triggerType !== 'cron') {
        fail('workflowTriggerType', 'trigger.type')
    }

    if (triggerType === 'cron') {
        const cron = typeof trigger.cron === 'string' ? trigger.cron.trim() : ''
        if (!cron) fail('workflowTriggerCron', 'trigger.cron')
    }

    if (triggerType === 'webhook' && 'secret' in trigger && trigger.secret !== undefined && typeof trigger.secret !== 'string') {
        fail('workflowTriggerSecret', 'trigger.secret')
    }
}

const validateStep = (value: unknown, index: number): void => {
    if (!isRecord(value)) {
        fail('workflowStepObject', `steps[${index}]`, { step: index + 1 })
    }

    const step = value as Record<string, unknown>

    const stepId = typeof step.id === 'string' && step.id.trim() ? step.id.trim() : `step_${index + 1}`

    if ('id' in step && (typeof step.id !== 'string' || !WORKFLOW_ID_PATTERN.test(step.id.trim()))) {
        fail('workflowStepIdPattern', `steps[${index}].id`, { step: index + 1 })
    }

    if ('name' in step && step.name !== undefined && typeof step.name !== 'string') {
        fail('workflowStepNameString', `steps[${index}].name`, { stepId })
    }

    const stepType = step.type
    if (stepType !== 'transform' && stepType !== 'agent' && stepType !== 'skill') {
        fail('workflowStepType', `steps[${index}].type`, { step: index + 1 })
    }

    if (stepType === 'transform') {
        if (typeof step.template !== 'string' || !step.template.trim()) {
            fail('workflowStepTemplate', `steps[${index}].template`, { stepId })
        }
        return
    }

    if (stepType === 'agent') {
        if (typeof step.message !== 'string' || !step.message.trim()) {
            fail('workflowStepMessage', `steps[${index}].message`, { stepId })
        }
        return
    }

    if (typeof step.skillName !== 'string' || !step.skillName.trim()) {
        fail('workflowStepSkillName', `steps[${index}].skillName`, { stepId })
    }

    if ('args' in step && step.args !== undefined && !isRecord(step.args)) {
        fail('workflowStepArgsObject', `steps[${index}].args`, { stepId })
    }
}

const validateWorkflowValue = (value: unknown): void => {
    if (!isRecord(value)) fail('workflowBodyObject', '$')

    const workflow = value as Record<string, unknown>

    if ('enabled' in workflow && workflow.enabled !== undefined && typeof workflow.enabled !== 'boolean') {
        fail('workflowEnabledBoolean', 'enabled')
    }

    validateTrigger(workflow.trigger)

    const steps = workflow.steps
    if (!Array.isArray(steps)) fail('workflowStepsArray', 'steps')
    const stepList = steps as unknown[]
    if (stepList.length === 0) fail('workflowStepsMin', 'steps')
    if (stepList.length > 20) fail('workflowStepsMax', 'steps', { max: 20 })

    stepList.forEach((step: unknown, index: number) => validateStep(step, index))
}

export function validateWorkflowId(id: string): WorkflowValidationIssue | null {
    if (!WORKFLOW_ID_PATTERN.test(id.trim())) {
        return { code: 'invalidWorkflowId' }
    }
    return null
}

export function validateWorkflowJson(source: string): WorkflowValidationResult {
    let parsed: unknown

    try {
        parsed = JSON.parse(source)
    } catch (error) {
        return { ok: false, error: syntaxIssue(source, error) }
    }

    try {
        validateWorkflowValue(parsed)
        return { ok: true, value: parsed as WorkflowSavePayload }
    } catch (error) {
        if (error instanceof WorkflowValidationError) {
            return { ok: false, error: attachLocation(source, error.issue) }
        }
        throw error
    }
}