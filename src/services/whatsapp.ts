/// <reference types="node" />
import { default as makeWASocket, useMultiFileAuthState, DisconnectReason, WASocket, WAMessage, proto, downloadMediaMessage, Browsers, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as fs from 'fs';
import * as path from 'path';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { supabase } from '../config/supabase';
import { findNearestLife } from '../utils/location';
import { textToSpeech, limparAudioTemp } from './tts';
import PDFDocument from 'pdfkit';

interface QuizData {
    question: string;
    options: string[];
    answer: string;
    explanation: string;
}

interface UserState {
    type: 'REGISTRATION' | 'QUIZ';
    step?: string;
    data: any;
    lastInteraction: number;
    notifiedInactivity: boolean;
}

export class WhatsAppService {
    public sock: WASocket | undefined;
    private authStateStr = 'auth_session_v2';
    private retryCount = 0;
    public qrCodeString: string | null = null;
    public isConnected: boolean = false;
    private LEADER_PHONE = process.env.LEADER_PHONE;
    private lastMessageAt: number = Date.now();
    private lastNotificationAt: number = 0;
    private userStates: { [key: string]: UserState } = {};

    constructor() { }

    async connectToWhatsApp() {
        try {
            const { version } = await fetchLatestBaileysVersion();
            const { state, saveCreds } = await useMultiFileAuthState(this.authStateStr);

            this.sock = makeWASocket({
                logger: pino({ level: 'silent' }),
                auth: state,
                version,
                syncFullHistory: false,
                markOnlineOnConnect: true,
                keepAliveIntervalMs: 30000,
            });

            this.sock.ev.on('connection.update', (update: any) => {
                const { connection, lastDisconnect, qr } = update;
                if (qr) {
                    this.qrCodeString = qr;
                    qrcode.generate(qr, { small: true });
                }
                if (connection === 'close') {
                    this.isConnected = false;
                    const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
                    if (statusCode === DisconnectReason.loggedOut) {
                        const authPath = path.resolve(this.authStateStr);
                        if (fs.existsSync(authPath)) fs.rmSync(authPath, { recursive: true, force: true });
                    }
                    this.scheduleReconnect(10000);
                } else if (connection === 'open') {
                    this.isConnected = true;
                    this.qrCodeString = null;
                    this.retryCount = 0;
                    this.lastMessageAt = Date.now();
                }
            });

            this.sock.ev.on('call', async (calls: any) => {
                for (const call of calls) {
                    if (call.status === 'offer') {
                        const from = call.from;
                        const callId = call.id;
                        try {
                            await this.sock?.rejectCall(callId, from);
                        } catch (e) { }

                        const baseUrl = process.env.SELF_URL ? process.env.SELF_URL.replace(/\/$/, '') : 'http://localhost:3000';
                        const voiceRoomLink = `${baseUrl}/voz.html?cid=${from.split('@')[0]}`;
                        const msg = `🌟 *ATENDIMENTO POR VOZ EM REAL-TIME (GRÁTIS)* 🌟\n\nOlá! Notei sua ligação. Para conversarmos por voz em tempo real (estilo *ChatGPT Voice*), clique no link abaixo:\n\n🔗 ${voiceRoomLink}\n\nLá eu consigo te ouvir e falar sem custos! 🙏Paraipaba! 🎤`;
                        await this.sendMessage(from, msg);
                    }
                }
            });

            this.sock.ev.on('creds.update', saveCreds);

            this.sock.ev.on('messages.upsert', async (m: any) => {
                const msg = m.messages[0];
                if (!msg.message || m.type !== 'notify') return;
                const remoteJid = msg.key.remoteJid;
                if (!remoteJid || remoteJid === 'status@broadcast' || msg.key.fromMe) return;

                let textBody = msg.message.conversation || msg.message.extendedTextMessage?.text;
                let imageBase64: string | undefined;
                let imageMimeType: string | undefined;

                if (msg.message.imageMessage) {
                    try {
                        const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: this.sock?.updateMediaMessage } as any);
                        imageBase64 = (buffer as Buffer).toString('base64');
                        imageMimeType = msg.message.imageMessage.mimetype || 'image/jpeg';
                        textBody = msg.message.imageMessage.caption || "Analise esta foto por favor.";
                    } catch (e) { }
                }

                let isAudioMessage = false;
                if (msg.message.audioMessage) {
                    isAudioMessage = true;
                    try {
                        const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: this.sock?.updateMediaMessage } as any);
                        const audioPath = path.join(__dirname, `../../temp_audio_${Date.now()}.ogg`);
                        fs.writeFileSync(audioPath, (buffer as Buffer));
                        const { transcribeAudio } = await import('./ai');
                        const text = await transcribeAudio(fs.createReadStream(audioPath));
                        fs.unlinkSync(audioPath);
                        if (text) textBody = text;
                    } catch (e) { }
                }

                if (!textBody && !msg.message.locationMessage) return;

                const lowerText = textBody?.toLowerCase() || '';
                let phone = remoteJid.replace(/\D/g, '');

                if (remoteJid.includes('@g.us')) return;

                const state = this.userStates[remoteJid];
                if (state && state.type === 'REGISTRATION') {
                    if (state.step === 'WAITING_NAME') {
                        if (textBody!.length < 3) { await this.sendMessage(remoteJid, "Nome muito curto. 😊"); return; }
                        state.data.name = textBody!.trim();
                        state.step = 'WAITING_PHONE';
                        await this.sendMessage(remoteJid, `Prazer, *${state.data.name}*! 👋\n\nAgora, qual seu telefone principal?`);
                        return;
                    }
                    if (state.step === 'WAITING_PHONE') {
                        state.data.phone_contact = lowerText.includes('este') ? phone : textBody!.replace(/\D/g, '');
                        state.step = 'WAITING_EMAIL';
                        await this.sendMessage(remoteJid, "Anotado! Qual seu E-mail? 📧");
                        return;
                    }
                    if (state.step === 'WAITING_EMAIL') {
                        state.data.email = textBody!.trim();
                        state.step = 'WAITING_CEP';
                        await this.sendMessage(remoteJid, "Perfeito! Qual seu CEP? 📮");
                        return;
                    }
                    if (state.step === 'WAITING_CEP') {
                        state.data.cep = textBody!.replace(/\D/g, '');
                        if (state.data.cep.length < 8) { await this.sendMessage(remoteJid, "CEP inválido."); return; }
                        state.step = 'WAITING_ADDRESS';
                        await this.sendMessage(remoteJid, "Qual seu endereço completo? 🏠");
                        return;
                    }
                    if (state.step === 'WAITING_ADDRESS') {
                        state.data.address = textBody!.trim();
                        state.step = 'WAITING_BIRTHDATE';
                        await this.sendMessage(remoteJid, "Qual sua data de nascimento? (dd/mm/aaaa) 🎂");
                        return;
                    }
                    if (state.step === 'WAITING_BIRTHDATE') {
                        const match = textBody!.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
                        if (!match) { await this.sendMessage(remoteJid, "Data inválida (Ex: 10/05/1995)."); return; }
                        state.data.birth_date = `${match[3]}-${match[2]}-${match[1]}`;
                        state.step = 'WAITING_LIFE_GROUP';
                        await this.sendMessage(remoteJid, "Você faz parte de algum Life Group? Se sim, qual? 🏠");
                        return;
                    }
                    if (state.step === 'WAITING_LIFE_GROUP') {
                        state.data.life_group = textBody!.trim();
                        const { error } = await supabase.from('members_paraipaba').insert([{ ...state.data, phone, neighborhood: state.data.address, created_at: new Date().toISOString() }]);
                        if (error) await this.sendMessage(remoteJid, "Erro ao salvar.");
                        else {
                            await this.sendMessage(remoteJid, `Cadastro concluído! ✅ Seja bem-vindo(a), *${state.data.name}*! 🙏`);
                            if (this.LEADER_PHONE) this.sendMessage(this.LEADER_PHONE + '@s.whatsapp.net', `Novo membro: ${state.data.name} (${phone})`);
                        }
                        delete this.userStates[remoteJid];
                        return;
                    }
                }

                if (state && state.type === 'QUIZ') {
                    const userAnswer = lowerText.trim();
                    const correctAnswer = state.data.answer.toLowerCase();
                    if (userAnswer === correctAnswer || userAnswer.startsWith(correctAnswer)) {
                        await this.sendMessage(remoteJid, `🌟 *Acertou!* 🌟\n\n${state.data.explanation}\n\n_Deseja outro? Digite !quiz_`);
                    } else {
                        await this.sendMessage(remoteJid, `❌ *Quase lá...* ❌\n\nA resposta correta era a letra *${state.data.answer.toUpperCase()}*.\n\n${state.data.explanation}`);
                    }
                    delete this.userStates[remoteJid];
                    return;
                }

                const { data: member } = await supabase.from('members_paraipaba').select('id, name').or(`phone.eq.${phone},phone.eq.55${phone}`).maybeSingle();
                if (!member) {
                    await this.sendMessage(remoteJid, "Olá! Que alegria ter você aqui na Paz Church Paraipaba! 🕊️\n\nVamos fazer seu cadastro rapidinho? Qual seu nome completo?");
                    this.userStates[remoteJid] = { type: 'REGISTRATION', step: 'WAITING_NAME', data: {}, lastInteraction: Date.now(), notifiedInactivity: false };
                    return;
                }

                if (lowerText === 'oi' || lowerText === 'olá' || lowerText === 'menu' || lowerText === '/ajuda') {
                    await this.sendMessage(remoteJid, `Olá ${member.name}! Como posso te ajudar hoje?\n\n1️⃣ Horários e Endereço\n2️⃣ Doações (PIX)\n3️⃣ Encontrar Célula (Life)\n4️⃣ Falar com IA\n5️⃣ Falar com Pastor\n\n!oração - Pedido de oração\n!presente - Check-in\n!quiz - Quiz Bíblico`);
                    return;
                }

                if (lowerText === '1') {
                    await this.sendMessage(remoteJid, `📍 *Paz Church Paraipaba*\nRua Antônio Henrique, 363, Centro\n\n⏰ Domingo às 17h30`);
                    return;
                }
                if (lowerText === '2') {
                    await this.sendMessage(remoteJid, `📱 *PIX (CNPJ)*: *56.895.009/0001-62*\nPaz Church Paraipaba 🙏`);
                    return;
                }
                if (lowerText === '3') {
                    await this.sendMessage(remoteJid, "Me envie sua *Localização Atual* para eu encontrar a Life mais próxima! 📍");
                    return;
                }
                if (lowerText === '5') {
                    await this.sendMessage(remoteJid, "Transferindo para nossa liderança... 🙏");
                    if (this.LEADER_PHONE) this.sendMessage(this.LEADER_PHONE + '@s.whatsapp.net', `⚠️ Membro ${member.name} (${phone}) solicitou atendimento.`);
                    return;
                }

                if (lowerText.startsWith('!oração')) {
                    const pedido = textBody!.replace('!oração', '').trim();
                    if (!pedido) { await this.sendMessage(remoteJid, "Digite seu pedido após !oração"); return; }
                    await supabase.from('prayer_requests').insert([{ phone, member_name: member.name, request: pedido }]);
                    await this.sendMessage(remoteJid, "🙏 Recebemos seu pedido e estamos orando!");
                    return;
                }

                if (lowerText === '!quiz') {
                    try {
                        const { getAIResponse } = await import('./ai');
                        const quizRaw = await getAIResponse('Crie um quiz bíblico JSON: {"question": "...", "options": ["a) ...", "b) ..."], "answer": "a", "explanation": "..."}', remoteJid);
                        const quizData = JSON.parse(quizRaw.match(/\{.*\}/s)?.[0] || '{}');
                        if (quizData.question) {
                            this.userStates[remoteJid] = { type: 'QUIZ', data: quizData, lastInteraction: Date.now(), notifiedInactivity: false };
                            await this.sendMessage(remoteJid, `🌟 *QUIZ BÍBLICO* 🌟\n\n${quizData.question}\n\n${quizData.options.join('\n')}`);
                        }
                    } catch (e) { }
                    return;
                }

                if (msg.message.locationMessage) {
                    const { degreesLatitude, degreesLongitude } = msg.message.locationMessage;
                    const { data: lives } = await supabase.from('lives_paraipaba').select('*');
                    if (lives) {
                        const nearest = findNearestLife(degreesLatitude, degreesLongitude, lives);
                        if (nearest && nearest.distance < 50) {
                            await this.sendMessage(remoteJid, `📍 Encontrei uma Life!\n\n*Nome:* ${nearest.name}\n*Líder:* ${nearest.leader_name}\n*Distância:* ${nearest.distance.toFixed(2)}km`);
                        } else {
                            await this.sendMessage(remoteJid, "Não encontrei nenhuma Life próxima.");
                        }
                    }
                    return;
                }

                try {
                    const { getAIResponse } = await import('./ai');
                    if (this.sock) await this.sock.sendPresenceUpdate(isAudioMessage ? 'recording' : 'composing', remoteJid);
                    let aiResponse = await getAIResponse(textBody!, remoteJid, imageBase64, imageMimeType);

                    if (aiResponse) {
                        const matchImage = aiResponse.match(/\[GERAR_IMAGEM:\s*(.*?)\]/is);
                        if (matchImage) {
                            const promptImg = matchImage[1].trim();
                            aiResponse = aiResponse.replace(matchImage[0], '').trim();
                            await this.sendGeneratedImageMessage(remoteJid, promptImg, aiResponse);
                            return;
                        }

                        const matchPdf = aiResponse.match(/\[GERAR_PDF:\s*(.*?)\s*\|\s*(.*?)\]/is);
                        if (matchPdf) {
                            const titlePdf = matchPdf[1].trim();
                            const contentPdf = matchPdf[2].trim();
                            aiResponse = aiResponse.replace(matchPdf[0], '').trim();
                            const pdfPath = path.join(__dirname, `../../${Date.now()}.pdf`);
                            const doc = new PDFDocument();
                            doc.pipe(fs.createWriteStream(pdfPath));
                            doc.text(contentPdf);
                            doc.end();
                            await new Promise(r => setTimeout(r, 1000));
                            if (aiResponse) await this.sendMessage(remoteJid, aiResponse);
                            await this.sock?.sendMessage(remoteJid, { document: fs.readFileSync(pdfPath), fileName: `${titlePdf}.pdf`, mimetype: 'application/pdf' });
                            fs.unlinkSync(pdfPath);
                            return;
                        }

                        if (isAudioMessage) {
                            await this.sendAudioMessage(remoteJid, await textToSpeech(aiResponse));
                        } else {
                            await this.sendMessage(remoteJid, aiResponse);
                        }
                    }
                } catch (e) { }
            });

        } catch (err) {
            console.error('Erro fatal:', err);
            this.scheduleReconnect(15000);
        }
    }

    private scheduleReconnect(ms: number) {
        setTimeout(() => this.connectToWhatsApp(), ms);
    }

    async sendMessage(to: string, text: string) {
        if (!this.sock || !to) return;
        let jid = to.includes('@') ? to : (to.length >= 14 ? `${to}@lid` : `${to}@s.whatsapp.net`);
        try {
            await this.sock.sendMessage(jid, { text });
        } catch (e) { }
    }

    async sendGeneratedImageMessage(to: string, prompt: string, caption?: string) {
        if (!this.sock) return;
        try {
            const response = await fetch('https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${process.env.HF_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ inputs: prompt })
            });
            if (response.ok) {
                const buffer = Buffer.from(await response.arrayBuffer());
                await this.sock.sendMessage(to, { image: buffer, caption });
            }
        } catch (e) { }
    }

    async sendAudioMessage(to: string, audioPath: string) {
        if (!this.sock || !to) return;
        try {
            await this.sock.sendMessage(to, { audio: fs.readFileSync(audioPath), mimetype: 'audio/ogg; codecs=opus', ptt: true });
        } catch (e) { }
    }

    async sendImage(to: string, image: string | Buffer, caption?: string) {
        if (!this.sock || !to) return;
        try {
            const content = typeof image === 'string' ? { url: image } : image;
            await this.sock.sendMessage(to, { image: content as any, caption });
        } catch (e) { }
    }
}

export const waService = new WhatsAppService();
