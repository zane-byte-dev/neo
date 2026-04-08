/**
 * Standalone test for generate_image tool.
 * Run: npx tsx scripts/test-generate-image.ts
 */
import { config as loadEnv } from 'dotenv';
loadEnv();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? '';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const IMAGE_MODEL = 'gemini-2.5-flash-image';

async function testImageGeneration() {
    console.log('=== Test: generate_image ===\n');

    // Step 1: Check API key
    console.log('[1/4] Checking GEMINI_API_KEY...');
    if (!GEMINI_API_KEY) {
        console.error('❌ GEMINI_API_KEY is not set in .env');
        process.exit(1);
    }
    console.log('✅ API key present\n');

    // Step 2: Check model is accessible
    console.log(`[2/4] Checking model ${IMAGE_MODEL} exists...`);
    const modelsRes = await fetch(`${GEMINI_BASE_URL}?key=${GEMINI_API_KEY}`);
    const modelsData = (await modelsRes.json()) as any;
    const modelNames: string[] = modelsData.models?.map((m: any) => m.name) ?? [];
    const found = modelNames.find(n => n.includes(IMAGE_MODEL));
    if (!found) {
        console.error(`❌ Model "${IMAGE_MODEL}" not found. Available models with "image":`);
        modelNames.filter(n => n.toLowerCase().includes('image')).forEach(n => console.log(`  - ${n}`));
        console.log('\nAll models:');
        modelNames.forEach(n => console.log(`  - ${n}`));
        process.exit(1);
    }
    console.log(`✅ Model found: ${found}\n`);

    // Step 3: Call the image generation API
    console.log('[3/4] Calling image generation API (this may take ~15s)...');
    const url = `${GEMINI_BASE_URL}/${IMAGE_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const startTime = Date.now();

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: 'A cute fluffy cat sitting on a wooden floor, soft lighting' }] }],
            generationConfig: {
                responseModalities: ['TEXT', 'IMAGE'],
            },
        }),
        signal: AbortSignal.timeout(60_000),
    });

    const elapsed = Date.now() - startTime;
    console.log(`  HTTP status: ${res.status} (${elapsed}ms)`);

    if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        console.error(`❌ API returned error ${res.status}:`);
        console.error(errorText.slice(0, 500));
        process.exit(1);
    }

    const data = (await res.json()) as any;
    const parts = data.candidates?.[0]?.content?.parts;
    if (!parts || parts.length === 0) {
        console.error('❌ No parts in response');
        console.error(JSON.stringify(data, null, 2).slice(0, 500));
        process.exit(1);
    }

    let hasImage = false;
    let textContent = '';
    for (const part of parts) {
        if (part.inlineData) {
            hasImage = true;
            const sizeKB = Math.round(part.inlineData.data.length * 3 / 4 / 1024);
            console.log(`  📷 Image: ${part.inlineData.mimeType}, ~${sizeKB}KB (base64 len: ${part.inlineData.data.length})`);
        } else if (part.text) {
            textContent += part.text;
        }
    }
    if (textContent) console.log(`  💬 Text: ${textContent.slice(0, 200)}`);

    if (!hasImage) {
        console.error('❌ Response has no image data');
        process.exit(1);
    }
    console.log('✅ Image generated successfully\n');

    // Step 4: Test writing to temp file
    console.log('[4/4] Testing temp file write...');
    const { promises: fs } = await import('node:fs');
    const { join } = await import('node:path');
    const imageData = parts.find((p: any) => p.inlineData)!.inlineData.data;
    const buffer = Buffer.from(imageData, 'base64');
    const tmpDir = join('.tmp', 'images');
    await fs.mkdir(tmpDir, { recursive: true });
    const tmpPath = join(tmpDir, `test_${Date.now()}.png`);
    await fs.writeFile(tmpPath, buffer);
    const stat = await fs.stat(tmpPath);
    console.log(`  Wrote ${stat.size} bytes to ${tmpPath}`);
    await fs.unlink(tmpPath);
    console.log('✅ File I/O works\n');

    console.log('=== All tests passed ✅ ===');
}

testImageGeneration().catch(err => {
    console.error('❌ Unexpected error:', err);
    process.exit(1);
});
