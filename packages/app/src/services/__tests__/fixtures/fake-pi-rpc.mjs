import { createInterface } from 'node:readline';

const lines = createInterface({ input: process.stdin });

function send(message) {
    process.stdout.write(`${JSON.stringify(message)}\n`);
}

lines.on('line', (line) => {
    const command = JSON.parse(line);
    if (command.type === 'get_state') {
        send({ type: 'response', id: command.id, command: command.type, success: true, data: { sessionId: 'fake-session', sessionFile: '/tmp/fake-session.jsonl' } });
        return;
    }
    if (command.type === 'prompt') {
        send({ type: 'response', id: command.id, command: command.type, success: true });
        send({ type: 'agent_start' });
        send({ type: 'tool_execution_start', toolCallId: 'tool-1', toolName: 'knowledge_search', args: { query: 'video' } });
        send({ type: 'tool_execution_end', toolCallId: 'tool-1', toolName: 'knowledge_search', result: { content: [] }, isError: false });
        send({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'done' } });
        send({ type: 'agent_settled' });
        return;
    }
    if (command.type === 'set_model') {
        send({ type: 'response', id: command.id, command: command.type, success: true });
        send({ type: 'model_selected', provider: command.provider, modelId: command.modelId });
        return;
    }
    if (command.type === 'abort') {
        send({ type: 'response', id: command.id, command: command.type, success: true });
        return;
    }
    send({ type: 'response', id: command.id, command: command.type, success: false, error: 'unsupported command' });
});
