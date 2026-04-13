import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { GEMINI_API_KEY, GEMINI_BASE_URL } from '../../config.js';
import type { Tool, ToolContext } from '../_base.js';

const IMAGE_MODEL = 'gemini-2.5-flash-image';

export const generateImageTool: Tool = {
    meta: { category: 'ai', version: '1.0.0', requiresEnv: ['GEMINI_API_KEY'] },
    declaration: {
        name: 'generate_image',
        description:
            '使用 AI 生成图片并发送给用户。支持任意文字描述，可指定宽高比。' +
            '适用于：创意插画、产品概念图、风格化照片、图标设计等。',
        parameters: {
            type: 'object',
            properties: {
                prompt: {
                    type: 'string',
                    description: '图片描述（英文效果更好），尽量详细描述想要的内容、风格、色调等',
                },
                aspect_ratio: {
                    type: 'string',
                    description: '宽高比: "1:1"（默认）, "16:9", "9:16", "4:3", "3:4"',
                },
            },
            required: ['prompt'],
        },
    },
    handler: async (args, _workDir, context?: ToolContext) => {
        const prompt = String(args.prompt ?? '');
        if (!prompt) return '[Error] prompt is required.';

        const url = `${GEMINI_BASE_URL}/${IMAGE_MODEL}:generateContent`;

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    responseModalities: ['TEXT', 'IMAGE'],
                },
            }),
            signal: AbortSignal.timeout(60_000),
        });

        if (!res.ok) {
            const errorText = await res.text().catch(() => '');
            return `[Error] Image generation API failed (${res.status}): ${errorText.slice(0, 200)}`;
        }

        const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data: string; mimeType?: string }; text?: string }> } }> };
        const parts = data.candidates?.[0]?.content?.parts;
        if (!parts || parts.length === 0) {
            return '[Error] No image generated. The model may have refused the prompt.';
        }

        // Extract image and text parts
        let imageData: string | null = null;
        let mimeType = 'image/png';
        let textResponse = '';

        for (const part of parts) {
            if (part.inlineData) {
                imageData = part.inlineData.data;
                mimeType = part.inlineData.mimeType || 'image/png';
            } else if (part.text) {
                textResponse += part.text;
            }
        }

        if (!imageData) {
            return textResponse || '[Error] No image data in response.';
        }

        if (!context) {
            return '[Error] generate_image requires a platform context to send the image.';
        }

        if (context.imageCallback) {
            // Web context: stream the image back via SSE
            await context.imageCallback(imageData, mimeType, textResponse || undefined);
        } else {
            // Platform context (e.g. Telegram): send via adapter
            const adapter = (context as unknown as Record<string, unknown>).adapter as { sendPhoto: (sessionId: string, path: string, caption?: string) => Promise<void> } | undefined;
            if (!adapter) return textResponse || '[Error] No image delivery method available.';
            const buffer = Buffer.from(imageData, 'base64');
            // Save to temp file (Telegraf needs file path or stream)
            const tmpDir = join('.tmp', 'images');
            await fs.mkdir(tmpDir, { recursive: true });
            const ext = mimeType.includes('png') ? 'png' : 'jpg';
            const tmpPath = join(tmpDir, `gen_${Date.now()}.${ext}`);
            await fs.writeFile(tmpPath, buffer);
            try {
                await adapter.sendPhoto(context.sessionId, tmpPath, textResponse || undefined);
            } finally {
                await fs.unlink(tmpPath).catch(() => {});
            }
        }

        return textResponse
            ? `[Image sent] ${textResponse}`
            : '[Image sent] 图片已生成并发送。';
    },
};
