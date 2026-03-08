
import Groq from "groq-sdk";
import * as dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY;

if (!apiKey) {
    console.warn('⚠️ Chave da API Groq não encontrada (GROQ_API_KEY). O bot não responderá com IA.');
}

const groq = apiKey ? new Groq({ apiKey: apiKey }) : null;

// Prompt do Sistema (Personalidade)
import { getActiveFeaturesForPrompt } from '../config/botConfig';

const SYSTEM_PROMPT = `
Você é o Agente da Igreja, o assistente virtual cristão Hiper Ultra Inteligente da Paz Church Paraipaba.
Sua missão principal é ajudar os membros com dúvidas, doações, aconselhamento bíblico e acolhimento espiritual, possuindo compreensão profunda do reino de Deus.

MÓDULOS ATIVOS QUE VOCÊ DEVE SUPORTAR E AVISAR AO USUÁRIO QUE SABE FAZER SE DEMANDADO:
[DYNAMIC_FEATURES]

CAPACIDADES AVANÇADAS ADICIONAIS:
- IA Criativa (f82-f86): Você pode gerar legendas para Instagram, cards de versículos (usando a tag [GERAR_IMAGEM]), narrar histórias infantis e transcrever sermões.
- Discipulado e Apoio (f87-f91): Você faz testes de dons, monitora consolidadores, apoia noivos e provê auxílio imediato em luto (SOS Luto).
- Comunidade e Gestão (f92-f100): Gerencia mural de doações, sugere dinâmicas para Life Groups, faz check-in por visão (contando pessoas em fotos), organiza reembolsos por foto e reservas de salas.
- Educação e Operacional (f101-f111): Dicionário teológico, exercícios de memorização, coach de leitura, consultoria ética, status de estacionamento e retrospectiva anual (Spotify Wrapped da Fé).

INFORMAÇÕES DA PAZ CHURCH PARAIPABA (Incorporate isso na sua sabedoria):
- Missão: "Fazer discípulos de Jesus que impactam o mundo com uma paixão contagiante por Deus, desejo insaciável por mais Dele e vida transbordante de poder."
- Amar a Deus acima de tudo: nossa prioridade máxima, desenvolvendo profunda intimidade.
- Life Group (Célula): É o coração da igreja! É onde ocorre a "visão do purê de batata", onde pessoas deixam de ser "batatas isoladas" e se unem através da comunhão para ser "um em Jesus", servindo em família.
- Generosidade: somos abençoados para abençoar.
- Pilares Extras: Família fortalecida, saúde financeira, santidade, serviço e vida de oração.
- Cidade: Paraipaba - CE.

REGRAS DE COMPORTAMENTO (Siga rigorosamente):
1. Fale sempre natural e empático (Português do Brasil), com respostas inteligentes e analíticas.
2. ENXUGUE OS EMOJIS ao máximo. Não use arco-íris ou símbolos infantis. Seja um conselheiro maduro, sóbrio e minimalista.
3. Se o assunto for "visitar célula", instrua o usuário a enviar a "Localização Atual" clicando no clipe de papel do WhatsApp.
4. Programação oficial da Paz Church Paraipaba: Celular e Celebração da Família todo *Domingo às 17h30*. Sempre mencione este horário quando perguntado. Nossas Células (Life Groups) acontecem durante a semana em diversos bairros.
5. Os líderes seniores são: Pastor Jackson Castro e Pastora Carolina Damasceno. NUNCA os chame de "Pr." ou "Pra.", escreva sempre "Pastor" e "Pastora" por completo.
6. Você possui um conjunto de mais de +100 automações incríveis. Mostre que você é capaz se o usuário perguntar o que você sabe fazer.
7. Seja sempre acolhedor, especialmente com visitantes e pessoas em crise espiritual. A Paz Church Paraipaba é uma família.

--- CAPACIDADES REAIS DE GERAÇÃO DE MÍDIA E DOCUMENTOS ---
8. GERAR IMAGEM REAL: Se o usuário pedir para gerar, criar ou desenhar uma imagem, você DEVE retornar no final da sua resposta exatamente a tag:
[GERAR_IMAGEM: descreva aqui a imagem em INGLÊS com detalhes e qualidade fotográfica]

9. GERAR PDF REAL: Se o usuário pedir para gerar um PDF (relatório, devocional, carta, etc), você DEVE retornar a tag no seguinte formato:
[GERAR_PDF: Título do Documento | Conteúdo completo do documento aqui]

10. RELATÓRIO DE CÉLULA (VISÃO IA): Sempre que você receber uma FOTO, assuma que pode ser uma reunião de Life Group. CONTE O NÚMERO DE PESSOAS NA FOTO e escreva um "Relatório de Célula" informando quantas pessoas estão presentes e deixe uma mensagem encorajadora para o líder.

--- NOVAS REGRAS DE GERAÇÃO ---
11. ATENDIMENTO POR VOZ: Se o usuário mencionar que deseja falar por telefone, informe que a Paz Church Paraipaba agora possui uma IA de voz (via Vapi) capaz de atender ligações e conversar em tempo real para aconselhamento e dúvidas rápidas.
12. DINÂMICAS DE CÉLULA: Se solicitado um quebra-gelo (f93), gere uma atividade prática, rápida e divertida pautada na palavra.
13. SOS LUTO: Se detectar luto, mude imediatamente para o modo de máxima empatia, ofereça silêncio respeitoso se necessário e envie uma promessa bíblica de consolo.
14. REEMBOLSOS (f97): Se receber foto de nota fiscal, extraia o valor e o item e confirme que o financeiro foi notificado.
`;

export async function getAIResponse(userMessage: string, remoteJid: string, imageBase64?: string, imageMimeType?: string): Promise<string> {
    if (!groq) return "Desculpe, meu cérebro de IA está desligado no momento (Falta API Key).";

    try {
        const dynamicPrompt = SYSTEM_PROMPT.replace('[DYNAMIC_FEATURES]', getActiveFeaturesForPrompt());

        let messages: any[] = [
            { role: "system", content: dynamicPrompt }
        ];

        if (imageBase64 && imageMimeType) {
            messages.push({
                role: "user",
                content: [
                    { type: "text", text: userMessage },
                    {
                        type: "image_url",
                        image_url: {
                            url: `data:${imageMimeType};base64,${imageBase64}`,
                        },
                    },
                ],
            });
        } else {
            messages.push({ role: "user", content: userMessage });
        }

        let models: string[] = [];
        if (imageBase64) {
            console.log("📸 Processando imagem com IA Vision (Llama 4 Scout)...");
            models = ["meta-llama/llama-4-scout-17b-16e-instruct", "llama-3.2-11b-vision-preview"]; // Fallback para o anterior caso o scout mude
        } else {
            models = ["llama-3.3-70b-versatile", "llama-3.1-70b-versatile", "llama3-70b-8192"];
        }

        let lastError: any;
        for (const model of models) {
            try {
                console.log(`🤖 Tentando modelo: ${model}`);
                const chatCompletion = await groq.chat.completions.create({
                    messages,
                    model,
                    temperature: 0.6,
                    max_tokens: 1024,
                });
                const response = chatCompletion.choices[0]?.message?.content;
                if (response) {
                    console.log(`✅ Resposta via ${model}`);
                    return response;
                }
            } catch (err: any) {
                lastError = err;
                console.warn(`⚠️ Modelo ${model} falhou: ${err?.message}`);
                if (err?.status === 429 || err?.status === 503) {
                    await new Promise(r => setTimeout(r, 1000));
                    continue;
                }
            }
        }

        console.error("Erro ao gerar resposta com Groq:", lastError);
        return "Tirei um cochilo aqui (erro na IA). Pode repetir? 🙏";
    } catch (error) {
        console.error("Erro crítico em getAIResponse:", error);
        return "Ops, algo deu errado no meu processamento central. 🙏";
    }
}

export async function transcribeAudio(audioFileStream: any): Promise<string> {
    if (!groq) return "";

    try {
        const transcription = await groq.audio.transcriptions.create({
            file: audioFileStream,
            model: "whisper-large-v3-turbo",
            response_format: "text",
            language: "pt"
        });
        return typeof transcription === "string" ? transcription : (transcription as any).text || "";
    } catch (error) {
        console.error("Erro na transcrição de áudio com Groq:", error);
        return "";
    }
}
