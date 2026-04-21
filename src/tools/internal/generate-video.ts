/**
 * generate-video.ts — Generate video using Google Veo 3.1 via Gen AI SDK.
 *
 * This tool is exposed to the agent as `generate_video`. It submits a prompt
 * to the Veo model, polls until the video is ready, saves the downloaded file,
 * and streams the URL back to the client via `videoCallback`.
 */
import { GoogleGenAI } from '@google/genai';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { GEMINI_API_KEY } from '../../config.js';
import type { Tool } from '../_base.js';
import { log } from '../../utils/logger.js';

const VEO_MODEL = 'veo-3.1-generate-preview';
const POLL_INTERVAL_MS = 10_000;
const MAX_POLL_ATTEMPTS = 60; // 10 minutes max

export const generateVideoTool: Tool = {
    meta: {
        category: 'ai',
        version: '1.0.0',
        requiresEnv: ['GEMINI_API_KEY'],
        enabled: !!GEMINI_API_KEY,
        permission: 'write',
    },
    declaration: {
        name: 'generate_video',
        description:
            'Generate a short video (4-8 seconds, with audio) from a text prompt using Veo 3.1. ' +
            'Good for cinematic scenes, animations, product demos, nature footage, etc. ' +
            'The prompt should be descriptive — include subject, action, style, camera movement, and mood. ' +
            'Returns the video URL. Video generation takes 30 seconds to several minutes.',
        parameters: {
            type: 'object',
            properties: {
                prompt: {
                    type: 'string',
                    description: 'Detailed description of the video to generate. Include subject, action, style, camera angles, and mood.',
                },
                aspect_ratio: {
                    type: 'string',
                    description: 'Video aspect ratio: "16:9" (landscape, default) or "9:16" (portrait).',
                    enum: ['16:9', '9:16'],
                },
            },
            required: ['prompt'],
        },
    },

    handler: async (args, workDir, context) => {
        const prompt = String(args.prompt ?? '').trim();
        if (!prompt) return 'Error: prompt is required';
        if (!GEMINI_API_KEY) return 'Error: GEMINI_API_KEY not configured';

        const aspectRatio = args.aspect_ratio === '9:16' ? '9:16' : '16:9';
        const sessionId = context?.sessionId ?? 'default';

        log.info('generate_video', `Starting video generation: "${prompt.slice(0, 80)}..." (${aspectRatio})`);

        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

        try {
            // Start the generation
            let operation = await ai.models.generateVideos({
                model: VEO_MODEL,
                prompt,
                config: {
                    aspectRatio,
                    personGeneration: 'allow_all',
                },
            });

            // Poll until done
            const signal = context?.signal;
            let attempts = 0;
            while (!operation.done) {
                if (signal?.aborted) {
                    return 'Error: Video generation cancelled (client disconnected)';
                }
                if (attempts >= MAX_POLL_ATTEMPTS) {
                    return 'Error: Video generation timed out after 10 minutes';
                }
                await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
                operation = await ai.operations.getVideosOperation({ operation });
                attempts++;
                if (attempts % 3 === 0) {
                    log.info('generate_video', `Polling... attempt ${attempts}`);
                }
            }

            // Get the generated video
            const generatedVideo = operation.response?.generatedVideos?.[0];
            if (!generatedVideo?.video) {
                return 'Error: No video was generated. The prompt may have been blocked by safety filters.';
            }

            // Save to disk
            const filename = `vid_${Date.now()}.mp4`;
            const dir = join(workDir, '.tmp', sessionId);
            await fs.mkdir(dir, { recursive: true });
            const filePath = join(dir, filename);

            // Download the video directly to disk
            await ai.files.download({ file: generatedVideo.video, downloadPath: filePath });

            const url = `/api/assets/${sessionId}/${filename}`;
            const stat = await fs.stat(filePath);
            log.info('generate_video', `Video saved: ${filePath} (${stat.size} bytes)`);

            // Stream video URL back to client
            if (context?.videoCallback) {
                await context.videoCallback(url);
            }

            return `Video generated successfully. URL: ${url}`;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            log.error('generate_video', `Error: ${msg}`);
            return `Error generating video: ${msg}`;
        }
    },
};
