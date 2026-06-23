export class GatewayError extends Error {
    constructor(
        public readonly status: number,
        public readonly code: string,
        message: string,
        public readonly type = 'invalid_request_error',
    ) {
        super(message);
        this.name = 'GatewayError';
    }
}

export function isGatewayError(err: unknown): err is GatewayError {
    return err instanceof GatewayError;
}

export function toGatewayError(err: unknown): GatewayError {
    if (isGatewayError(err)) return err;
    const e = err as { status?: number; cause?: { status?: number }; message?: string };
    const status = e.status ?? e.cause?.status ?? 502;
    if (status === 401 || status === 403) {
        return new GatewayError(status, 'provider_not_configured', 'Upstream provider is not configured');
    }
    if (status === 429) {
        return new GatewayError(429, 'upstream_rate_limited', 'Upstream provider rate limited the request');
    }
    if (status >= 400 && status < 500) {
        return new GatewayError(status, 'upstream_request_error', 'Upstream provider rejected the request');
    }
    const message = e.message && e.message.toLowerCase().includes('timeout')
        ? 'Upstream provider timed out'
        : 'Upstream provider failed';
    return new GatewayError(status >= 500 ? status : 502, 'upstream_error', message, 'server_error');
}