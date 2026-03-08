/**
 * Serviço de Text-to-Speech (TTS) com Voz Neural Realista
 * Usa a API do Microsoft Edge TTS (Totalmente Gratuito)
 * - Voz extremamente humanizada e natural (pt-BR-AntonioNeural)
 * - Não possui limite de texto para cortes
 */

import * as fs from 'fs';
import * as path from 'path';
import { EdgeTTS } from 'node-edge-tts';

// Pasta temporária para áudios gerados
const TEMP_DIR = path.join(__dirname, '../../temp_tts');

// Garante que a pasta temporária existe
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * Limpa formatação WhatsApp do texto antes de sintetizar.
 */
function limparTextoParaTTS(texto: string): string {
    return texto
        // Remove emojis (usando regex amplo para não poluir o áudio)
        .replace(/[\u{1F000}-\u{1F6FF}\u{1F900}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
        // Corrige pronúncia de Pastor(a)
        .replace(/\bPr\b|\bPr\./g, 'Pastor')
        .replace(/\bPra\b|\bPra\./g, 'Pastora')
        // Remove asteriscos de bold WhatsApp
        .replace(/\*/g, '')
        // Remove underline de itálico
        .replace(/_/g, ' ')
        // Remove cerquilha e outros símbolos que o TTS possa ler literalmente
        .replace(/#/g, '')
        .trim();
}

/**
 * Converte texto em arquivo de áudio MP3 usando Edge TTS.
 * Retorna o caminho do arquivo gerado, ou null em caso de erro.
 */
export async function textToSpeech(texto: string): Promise<string | null> {
    const textoLimpo = limparTextoParaTTS(texto);

    if (!textoLimpo || textoLimpo.length < 3) {
        return null;
    }

    const timestamp = Date.now();
    const mp3Path = path.join(TEMP_DIR, `tts_${timestamp}.mp3`);

    try {
        console.log(`🔊 Gerando áudio TTS Neural humanizado (${textoLimpo.length} chars)...`);

        // Voz Neural Humana do Brasil - Masculino (Pode mudar para pt-BR-FranciscaNeural se quiser feminino)
        const tts = new EdgeTTS({
            voice: 'pt-BR-AntonioNeural',
            lang: 'pt-BR'
        });

        await tts.ttsPromise(textoLimpo, mp3Path);

        if (!fs.existsSync(mp3Path)) {
            throw new Error('Arquivo MP3 não foi criado.');
        }

        const { size } = fs.statSync(mp3Path);
        if (size < 200) {
            throw new Error(`Arquivo muito pequeno (${size} bytes) — falhou. / Possível bloqueio temporário.`);
        }

        console.log(`✅ Áudio Neural gerado com sucesso: ${mp3Path} (${size} bytes)`);
        return mp3Path;

    } catch (error) {
        console.error('❌ Erro ao gerar áudio Neural:', error);
        if (fs.existsSync(mp3Path)) {
            try { fs.unlinkSync(mp3Path); } catch (_) { }
        }
        return null;
    }
}

/**
 * Remove arquivo de áudio temporário após envio.
 */
export function limparAudioTemp(filePath: string): void {
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch (_) {
        // ignora
    }
}
