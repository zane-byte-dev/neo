/**
 * media-handler.ts — Re-exports media handlers for backward compatibility.
 *
 * Actual implementations live in:
 *   - voice-handler.ts    (voice/audio transcription)
 *   - document-handler.ts (file parsing, spreadsheet conversion, PDF/media upload)
 *   - photo-handler.ts    (image analysis)
 */
export { processVoiceMessage } from './voice-handler.js';
export { processDocumentMessage } from './document-handler.js';
export { processPhotoMessage } from './photo-handler.js';

