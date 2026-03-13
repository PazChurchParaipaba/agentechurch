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

interface UserState {
    type: 'REGISTRATION' | 'QUIZ';
    step?: string;
    data?: any;
    lastInteraction: number;
    notifiedInactivity: boolean;
}

export class WhatsAppService {
    public sock: WASocket | undefined;
    private authStateStr = 'auth_session_v2';
    private retryCount = 0;
    private MAX_RETRIES = 999;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private lastMessageAt: number = Date.now();
    private isReconnecting: boolean = false;
    private watchdogTimer: NodeJS.Timeout | null = null;
    private inactivityTimer: NodeJS.Timeout | null = null;

    public qrCodeString: string | null = null;
    public isConnected: boolean = false;
    private LEADER_PHONE = process.env.LEADER_PHONE;

    private userStates: { [key: string]: UserState } = {};

    constructor() {
        this.watchdogTimer = setInterval(() => {
            if (!this.isConnected && !this.isReconnecting) {
                this.scheduleReconnect(0);
            } else if (this.isConnected) {
                const idleMs = Date.now() - this.lastMessageAt;
                if (idleMs > 10 * 60 * 1000) {
                    try {
                        this.sock?.sendPresenceUpdate('available', 'status@broadcast').catch(() => {
                            this.isConnected = false;
                            this.scheduleReconnect(5000);
                        });
                    } catch (e) {
                        this.isConnected = false;
                        this.scheduleReconnect(5000);
                    }
                }
            }
        }, 3 * 60 * 1000);

        // Monitor de Inatividade (20 minutos)
        this.inactivityTimer = setInterval(() => {
            this.checkInactivity();
        }, 1 * 60 * 1000); // Checa a cada minuto
    }

    private async checkInactivity() {
        const now = Date.now();
        const INACTIVITY_THRESHOLD = 20 * 60 * 1000; // 20 minutos

        for (const jid in this.userStates) {
            const state = this.userStates[jid];
            if (!state.notifiedInactivity && (now - state.lastInteraction) > INACTIVITY_THRESHOLD) {
                state.notifiedInactivity = true;
                const msg = state.type === 'REGISTRATION'
                    ? "Oii, você ainda está aí? 😊 Notei que paramos seu cadastro pela metade. Quando puder, me envie a informação que falta para terminarmos! 🙏"
                    : "Oii, você ainda está aí? O quiz ainda está esperando sua resposta! 🌟";
                await this.sendMessage(jid, msg);
            }
        }
    }

    private scheduleReconnect(delayMs: number) {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        const backoffMs = Math.min(delayMs + (this.retryCount * 5000), 5 * 60 * 1000);
        this.isReconnecting = true;
        this.reconnectTimer = setTimeout(() => {
            this.isReconnecting = false;
            this.connectToWhatsApp();
        }, backoffMs);
    }

    async connectToWhatsApp() {
        try {
            const { version } = await fetchLatestBaileysVersion();
            const { state, saveCreds } = await useMultiFileAuthState(this.authStateStr);

            if (this.sock) {
                try { this.sock.end(undefined); } catch (e) { }
                this.sock = undefined;
            }

            this.sock = makeWASocket({
                logger: pino({ level: 'silent' }),
                auth: state,
                version,
                syncFullHistory: false,
                markOnlineOnConnect: true,
                keepAliveIntervalMs: 25000,
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
                    this.retryCount++;
                    this.scheduleReconnect(10000);
                } else if (connection === 'open') {
                    this.isConnected = true;
                    this.qrCodeString = null;
                    this.retryCount = 0;
                    this.lastMessageAt = Date.now();
                }
            });

            // Detecção e Atendimento Humanizado de Chamadas (Voice/Video)
            this.sock.ev.on('call', async (calls: any) => {
                for (const call of calls) {
                    if (call.status === 'offer') {
                        const from = call.from;
                        const callId = call.id;

                        console.log(`📞 Chamada recebida de ${from} (ID: ${callId}). Rejeitando para iniciar Modo Voz...`);

                        try {
                            // Rejeita a chamada para liberar o áudio do celular para o navegador
                            await this.sock?.rejectCall(callId, from);
                        } catch (e) {
                            console.error("Erro ao rejeitar chamada:", e);
                        }

                        // Link Dinâmico Gratuito (voz.html hospedada localmente)
                        const baseUrl = process.env.SELF_URL ? process.env.SELF_URL.replace(/\/$/, '') : 'http://localhost:3000';
                        const voiceRoomLink = `${baseUrl}/voz.html?cid=${from.split('@')[0]}`;

                        const msg = `🌟 *ATENDIMENTO POR VOZ EM REAL-TIME (GRÁTIS)* 🌟\n\nOlá! Notei sua ligação. Para conversarmos por voz em tempo real (estilo *ChatGPT Voice*), clique no link abaixo:\n\n🔗 ${voiceRoomLink}\n\nLá eu consigo te ouvir e falar sem custos! 🙏Paraipaba! 🎤`;

                        await this.sendMessage(from, msg);
                    }
                }
            });

            this.sock.ev.on('creds.update', saveCreds);

            // Listener para dar as boas-vindas a novos membros (Funcionalidade 3)
            this.sock.ev.on('group-participants.update', async (event) => {
                if (event.action === 'add') {
                    const groupId = event.id;
                    const newMembers = event.participants;
                    try {
                        // Busca o nome do grupo
                        const groupMeta = await this.sock?.groupMetadata(groupId);
                        const groupName = groupMeta?.subject;

                        for (const member of newMembers) {
                            // Monta a mensagem mencionando o novo membro
                            const memberId = member.id;
                            const welcomeMessage = `Olá, @${memberId.split('@')[0]}! 👋\n\nSeja muito bem-vindo(a) à família *${groupName}*! Que alegria ter você conosco. Sinta-se em casa! 🕊️✨`;
                            
                            // Envia a mensagem para o grupo, com a menção
                            await this.sock?.sendMessage(groupId, {
                                text: welcomeMessage,
                                mentions: [memberId]
                            });
                        }
                    } catch (error) {
                        console.error('Erro ao dar boas-vindas a novo membro:', error);
                    }
                }
            });

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
                        const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }) } as any);
                        imageBase64 = (buffer as Buffer).toString('base64');
                        imageMimeType = msg.message.imageMessage.mimetype || 'image/jpeg';
                        textBody = msg.message.imageMessage.caption || "Analise esta foto.";
                    } catch (e) { console.error("Erro imagem:", e); }
                }

                let isAudioMessage = false;
                if (msg.message.audioMessage) {
                    isAudioMessage = true;
                    try {
                        const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }) } as any);
                        const audioPath = path.join(__dirname, `../../temp_audio_${Date.now()}.ogg`);
                        fs.writeFileSync(audioPath, (buffer as Buffer));
                        const { transcribeAudio } = await import('./ai');
                        const text = await transcribeAudio(fs.createReadStream(audioPath));
                        fs.unlinkSync(audioPath);
                        if (text) textBody = text;
                    } catch (e) { console.error("Erro áudio:", e); }
                }

                if (!textBody && !imageBase64) return;

                // Atualiza último contato se houver estado ativo
                if (this.userStates[remoteJid]) {
                    this.userStates[remoteJid].lastInteraction = Date.now();
                    this.userStates[remoteJid].notifiedInactivity = false;
                }

                const lowerText = textBody ? textBody.toLowerCase() : '';
                const phone = remoteJid.replace(/\D/g, '');
                const isGroup = remoteJid.includes('@g.us');

                // NOVA LÓGICA DE GRUPO: Responder apenas se for mencionado ou se for um comando.
                if (isGroup) {
                    const botJid = this.sock?.user?.id;
                    // a menção pode vir no contextInfo (oficial) ou no texto (manual)
                    const mentionedJid = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                    const isMentioned = mentionedJid.includes(botJid);

                    // Só processa se for menção ou comando com "!"
                    if (!isMentioned && !lowerText.startsWith('!')) {
                        return; // Ignora a mensagem no grupo se não for para o bot
                    }
                }

                // Fluxo de Cadastro e Quiz
                if (!isGroup) {
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
                            if (!match) { await this.sendMessage(remoteJid, "Data inválida (Ex: 10/05/1995). Perguntei sua data de nascimento."); return; }
                            state.data.birth_date = `${match[3]}-${match[2]}-${match[1]}`;
                            state.step = 'WAITING_LIFE_GROUP';
                            await this.sendMessage(remoteJid, "Você faz parte de algum Life Group? Se sim, qual? (Se não, diga \"Não\") 🏠");
                            return;
                        }
                        if (state.step === 'WAITING_LIFE_GROUP') {
                            state.data.life_group = textBody!.trim();
                            const { error } = await supabase.from('members_paraipaba').insert([{ ...state.data, phone, neighborhood: state.data.address }]);
                            if (error) await this.sendMessage(remoteJid, "Erro ao salvar.");
                            else {
                                await this.sendMessage(remoteJid, `Cadastro concluído! ✅ Seja bem-vindo(a), *${state.data.name}*! 🙏`);
                                if (this.LEADER_PHONE) this.sendMessage(this.LEADER_PHONE + '@s.whatsapp.net', `Novo membro (Paraipaba): ${state.data.name} (${state.data.phone_contact})`);
                            }
                            delete this.userStates[remoteJid];
                            return;
                        }
                    }

                    // Lógica de Resposta do Quiz
                    if (state && state.type === 'QUIZ') {
                        const userAnswer = lowerText.trim();
                        const correctAnswer = state.data.answer.toLowerCase();

                        if (userAnswer === correctAnswer || userAnswer.startsWith(correctAnswer)) {
                            await this.sendMessage(remoteJid, `🌟 *Acertou!* 🌟\n\nParabéns! Você arrasou no conhecimento bíblico. 👏🔥\n\n${state.data.explanation}\n\n_Deseja outro? Digite !quiz_`);
                        } else {
                            await this.sendMessage(remoteJid, `❌ *Quase lá...* ❌\n\nA resposta correta era a letra *${state.data.answer.toUpperCase()}*.\n\n${state.data.explanation}\n\n_Não desanime! Tente outro com !quiz_`);
                        }
                        delete this.userStates[remoteJid];
                        return;
                    }

                    const { data: member } = await supabase.from('members_paraipaba').select('id, name').or(`phone.eq.${phone},phone.eq.55${phone}`).maybeSingle();

                    // Se for um novo membro OU se for uma palavra-chave de QR Code (ex: "quero me cadastrar", "visita", "culto")
                    const isNewMemberAction = lowerText.includes('cadastrar') || lowerText.includes('visita') || lowerText.includes('culto') || lowerText.includes('paz paraipaba');

                    if (!member) {
                        const welcomeMsg = `Olá! Que alegria ter você conosco aqui na *Paz Church Paraipaba*! 🕊️✨\n\nSeja muito bem-vindo(a)! Ficamos felizes em te receber no nosso culto. Para que possamos te conhecer melhor e te manter informado sobre tudo o que acontece na nossa família, vamos fazer seu cadastro rapidinho?\n\nPara começar, qual seu *nome completo*?`;

                        await this.sendMessage(remoteJid, welcomeMsg);
                        this.userStates[remoteJid] = {
                            type: 'REGISTRATION',
                            step: 'WAITING_NAME',
                            data: {},
                            lastInteraction: Date.now(),
                            notifiedInactivity: false
                        };
                        return;
                    } else if (isNewMemberAction) {
                        // Se já é membro mas mandou a palavra do QR Code, apenas saúda
                        await this.sendMessage(remoteJid, `Olá, *${member.name}*! Que bom te ver por aqui novamente no nosso culto! 🙏✨ Como posso te ajudar hoje?`);
                        return;
                    }
                }

                // Menu e Comandos
                if (lowerText === 'oi' || lowerText === 'menu' || lowerText === 'ajuda') {
                    await this.sendMessage(remoteJid, "Como posso te ajudar hoje?\n\n1️⃣ Horários e Endereço\n2️⃣ Quero doar (Pix)\n3️⃣ Onde tem uma Life?\n4️⃣ Conversar com a IA\n5️⃣ Falar com a Liderança\n\n!oração [pedido] - Pedir oração\n!quiz - Quiz Bíblico");
                    return;
                }
                if (lowerText === '1') { await this.sendMessage(remoteJid, "📍 Paz Church Paraipaba - CE.\n⏰ Horário de Culto: Domingo às 17h30."); return; }
                if (lowerText === '2') { await this.sendMessage(remoteJid, "🙏 Sua generosidade ajuda o Reino. Chave Pix: (confirme com a secretaria)."); return; }
                if (lowerText === '3') { await this.sendMessage(remoteJid, "Mande sua localização clicando no clipe 📎 e encontrarei a Life mais próxima! 📍"); return; }
                if (lowerText === '5') { await this.sendMessage(remoteJid, "Transferindo para a liderança... 🙏"); if (this.LEADER_PHONE) this.sendMessage(this.LEADER_PHONE + '@s.whatsapp.net', `Atendimento humano solicitado por ${phone}`); return; }

                if (lowerText.startsWith('!oração') || lowerText.startsWith('!oracao')) {
                    const pedido = textBody!.replace(/^!ora[çc]ao\s*/i, '').trim();
                    if (pedido) await this.sendMessage(remoteJid, "Pedido recebido! Estamos orando por você. 🙏");
                    else await this.sendMessage(remoteJid, "Escreva seu pedido após o comando.");
                    return;
                }

                if (lowerText === '!quiz') {
                    const { getAIResponse } = await import('./ai');
                    const quizPrompt = `Crie UMA pergunta de quiz bíblico com 4 opções (a, b, c, d). 
                    No final da sua resposta, adicione OBRIGATORIAMENTE a tag: [RESPOSTA: letra | explicação curta] 
                    Exemplo: [RESPOSTA: a | Moisés libertou o povo do Egito]`;

                    const quiz = await getAIResponse(quizPrompt, remoteJid);
                    const matchAnswer = quiz.match(/\[RESPOSTA:\s*([a-d])\s*\|\s*(.*?)\]/i);

                    if (matchAnswer) {
                        const questionText = quiz.replace(matchAnswer[0], '').trim();
                        await this.sendMessage(remoteJid, `🌟 *QUIZ BÍBLICO* 🌟\n\n${questionText}\n\n_Responda apenas com a letra da opção correta (a, b, c ou d)_`);
                        this.userStates[remoteJid] = {
                            type: 'QUIZ',
                            data: { answer: matchAnswer[1], explanation: matchAnswer[2] },
                            lastInteraction: Date.now(),
                            notifiedInactivity: false
                        };
                    } else {
                        await this.sendMessage(remoteJid, `🌟 *QUIZ BÍBLICO* 🌟\n\n${quiz}`);
                    }
                    return;
                }

                // --- ANÁLISE DE INTERCESSÃO (FUNCIONALIDADE 7 - AVANÇADA) ---
                if (lowerText.startsWith('!analisarintercessao')) {
                    const leaderJid = this.LEADER_PHONE ? `${this.LEADER_PHONE}@s.whatsapp.net` : '';
                    if (!leaderJid || remoteJid !== leaderJid || !isGroup) {
                        await this.sendMessage(remoteJid, "Este é um comando avançado de análise e restrito à liderança.");
                        return;
                    }

                    const groupId = msg.key.remoteJid;
                    if (!groupId) return;

                    await this.sendMessage(leaderJid, `🔬 *Análise de Intercessão Iniciada...*\n\nVou analisar o histórico recente deste grupo para identificar padrões de comportamento de intercessores. Isso pode levar um minuto...`);
                    
                    try {
                        // NOTA: A busca de histórico real no Baileys é muito complexa.
                        // Esta é uma implementação de PROVA DE CONCEITO que assume que as mensagens
                        // são logadas em uma tabela 'messages_log' no Supabase.
                        // Sem esse log, a análise não funcionará.
                        const { data: recentMessages, error } = await supabase
                            .from('messages_log') // Tabela hipotética
                            .select('sender_name, content')
                            .eq('group_id', groupId)
                            .order('created_at', { ascending: false })
                            .limit(100);
                        
                        let historyText = "";
                        if (error || !recentMessages || recentMessages.length === 0) {
                            historyText = "Não foi possível carregar um histórico de mensagens detalhado para análise. O resultado será baseado em conhecimento geral.";
                            console.warn("Não foi possível buscar histórico do grupo para análise. A tabela 'messages_log' existe e contém dados?");
                        } else {
                            historyText = recentMessages.map(m => `${m.sender_name}: ${m.content}`).join('\n');
                        }

                        const { getAIResponse } = await import('./ai');
                        const analysisPrompt = `
                            Aja como um analista de comportamento e teólogo sênior. Sua tarefa é analisar o seguinte histórico de conversas de um grupo de WhatsApp da igreja e identificar de 3 a 5 membros com maior probabilidade de pertencerem ao ministério de intercessão.

                            **Critérios de Análise:**
                            1.  **Proatividade em Oração:** Quem se oferece para orar pelos outros sem que seja pedido?
                            2.  **Linguagem Espiritual:** Quem utiliza termos como "batalha espiritual", "jejum", "clamor", "guerra espiritual" e demonstra autoridade em suas orações?
                            3.  **Profundidade Teológica:** Quem vai além do "estou orando" e oferece conselhos bíblicos sólidos, versículos específicos e palavras de encorajamento profundas e bem fundamentadas?
                            4.  **Consistência:** Quem exibe esse comportamento de forma consistente?

                            **Histórico da Conversa para Análise:**
                            """
                            ${historyText}
                            """

                            **Formato do Relatório:**
                            Gere um relatório confidencial em markdown para a liderança. Para cada "candidato", liste o nome e as evidências (frases ou resumo do comportamento) que justificam sua inclusão na lista. Seja analítico e direto ao ponto. Finalize com um breve resumo de sua conclusão.
                        `;

                        const report = await getAIResponse(analysisPrompt, leaderJid);
                        
                        await this.sendMessage(leaderJid, `*Relatório Confidencial de Análise de Intercessão* 🕵️‍♂️\n\nCom base nos padrões de conversa, aqui estão os membros com maior potencial de intercessão que identifiquei:\n\n${report}`);

                    } catch (e) {
                        await this.sendMessage(leaderJid, "Ocorreu um erro durante a análise. A IA pode estar sobrecarregada ou a estrutura de dados de histórico não foi encontrada.");
                        console.error("Erro na análise de intercessão:", e);
                    }
                    return;
                }

                if (msg.message.locationMessage) {
                    const { degreesLatitude, degreesLongitude } = msg.message.locationMessage;
                    if (!degreesLatitude || !degreesLongitude) return;

                    // --- LÓGICA DE CHECK-IN AUTOMÁTICO (FUNCIONALIDADE 5) ---
                    const { churchConfig } = await import('../config/botConfig');
                    const { calculateDistance } = await import('../utils/location');

                    const now = new Date();
                    // Ajuste para o fuso horário de São Paulo (-3 GMT)
                    const spTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
                    const isSunday = spTime.getDay() === 0; // 0 = Domingo

                    const serviceStart = new Date(spTime);
                    serviceStart.setHours(churchConfig.SUNDAY_SERVICE_TIME.START_HOUR, churchConfig.SUNDAY_SERVICE_TIME.START_MINUTE, 0, 0);
                    
                    const serviceEnd = new Date(spTime);
                    serviceEnd.setHours(churchConfig.SUNDAY_SERVICE_TIME.END_HOUR, churchConfig.SUNDAY_SERVICE_TIME.END_MINUTE, 0, 0);

                    // Verifica se é domingo e se está no horário do culto
                    if (isSunday && spTime >= serviceStart && spTime <= serviceEnd) {
                        const distanceInKm = calculateDistance(
                            degreesLatitude,
                            degreesLongitude,
                            churchConfig.LOCATION.LATITUDE,
                            churchConfig.LOCATION.LONGITUDE
                        );
                        const distanceInMeters = distanceInKm * 1000;

                        if (distanceInMeters <= churchConfig.CHECKIN_RADIUS_METERS) {
                            // Está no raio, proceder com o check-in
                            const phone = remoteJid.replace(/\D/g, '');
                            const { data: member, error: memberError } = await supabase
                                .from('members_paraipaba')
                                .select('id, name')
                                .or(`phone.eq.${phone},phone.eq.55${phone}`)
                                .maybeSingle();

                            if (memberError || !member) {
                                await this.sendMessage(remoteJid, "Você está na igreja, que bênção! Mas não te encontrei no nosso cadastro para fazer o check-in. Fale com alguém da recepção! 😊");
                                return;
                            }

                            // Verifica se já fez check-in hoje
                            const todayStr = spTime.toISOString().split('T')[0]; // YYYY-MM-DD
                            const { data: existingCheckin, error: checkinError } = await supabase
                                .from('checkin_log')
                                .select('id')
                                .eq('member_id', member.id)
                                .gte('checkin_at', `${todayStr}T00:00:00Z`)
                                .lte('checkin_at', `${todayStr}T23:59:59Z`)
                                .maybeSingle();

                            if (existingCheckin) {
                                await this.sendMessage(remoteJid, `Oi, ${member.name}! Seu check-in de hoje já foi registrado. Bom culto! 🙏`);
                                return;
                            }

                            // Insere o novo check-in
                            const { error: newCheckinError } = await supabase
                                .from('checkin_log')
                                .insert({ member_id: member.id, event_name: 'Culto de Domingo' });

                            if (newCheckinError) {
                                await this.sendMessage(remoteJid, "Tentei fazer seu check-in, mas algo deu errado no sistema. Avise alguém da recepção, por favor.");
                            } else {
                                await this.sendMessage(remoteJid, `✅ *Check-in realizado com sucesso, ${member.name}!* \n\nQue alegria ter você aqui conosco. Tenha um culto abençoado! 🕊️`);
                            }

                        } else {
                            // Fora do raio, assume que quer encontrar a Life
                            await this.sendMessage(remoteJid, "Você parece estar um pouco longe para fazer o check-in no culto. Se a ideia era achar a Life Group mais próxima, vou procurar aqui...");
                            const { data: lives } = await supabase.from('lives_mondubim').select('*');
                            if (lives) {
                                const nearest = findNearestLife(degreesLatitude, degreesLongitude, lives);
                                if (nearest) await this.sendMessage(remoteJid, `📍 Encontrei a Life *${nearest.name}*!\nLíder: ${nearest.leader_name}\nEndereço: ${nearest.address}\nDistância: ${nearest.distance.toFixed(2)}km`);
                                else await this.sendMessage(remoteJid, "Não encontrei nenhuma Life próxima.");
                            }
                        }
                        return; // Finaliza o fluxo aqui
                    }
                    // --- FIM DA LÓGICA DE CHECK-IN ---
                    
                    // Comportamento padrão se não for horário de culto
                    const { data: lives } = await supabase.from('lives_mondubim').select('*');
                    if (lives) {
                        const nearest = findNearestLife(degreesLatitude, degreesLongitude, lives);
                        if (nearest) await this.sendMessage(remoteJid, `📍 Encontrei a Life *${nearest.name}*!\nLíder: ${nearest.leader_name}\nEndereço: ${nearest.address}\nDistância: ${nearest.distance.toFixed(2)}km`);
                        else await this.sendMessage(remoteJid, "Não encontrei nenhuma Life próxima.");
                    }
                    return;
                }

                // IA
                try {
                    const { getAIResponse } = await import('./ai');
                    if (this.sock) await this.sock.sendPresenceUpdate(isAudioMessage ? 'recording' : 'composing', remoteJid);

                    // Modificação p/ f97: Se for imagem com legenda "reembolso", dar contexto extra p/ IA
                    let contextMessage = textBody || '';
                    if (imageBase64 && (lowerText.includes('reembolso') || lowerText.includes('nota') || lowerText.includes('recibo'))) {
                        contextMessage = `[MÓDULO REEMBOLSO ATIVO] Extraia o valor total e o nome do estabelecimento desta nota fiscal: ${contextMessage}`;
                    }

                    const aiResponse = await getAIResponse(contextMessage, remoteJid, imageBase64, imageMimeType);

                    if (aiResponse) {
                        const matchImg = aiResponse.match(/\[GERAR_IMAGEM:\s*(.*?)\s*\]/i);
                        const matchPdf = aiResponse.match(/\[GERAR_PDF:\s*(.*?)\s*\|\s*(.*?)\]/is);

                        // f83: Card de Versículo ou Artes Gerais
                        if (matchImg) {
                            await this.sendGeneratedImageMessage(remoteJid, matchImg[1], aiResponse.replace(matchImg[0], '').trim());
                        } else if (matchPdf) {
                            const title = matchPdf[1].trim();
                            const content = matchPdf[2].trim();
                            const pdfPath = path.join(__dirname, `../../${Date.now()}.pdf`);
                            const doc = new PDFDocument();
                            doc.pipe(fs.createWriteStream(pdfPath));
                            doc.fontSize(20).text(title, { align: 'center' }).moveDown().fontSize(12).text(content);
                            doc.end();
                            await new Promise(r => setTimeout(r, 1500));
                            if (this.sock) {
                                await this.sock.sendMessage(remoteJid, { document: fs.readFileSync(pdfPath), fileName: `${title}.pdf`, mimetype: 'application/pdf' });
                            }
                            fs.unlinkSync(pdfPath);
                        } else if (isAudioMessage || lowerText.startsWith('!voz')) {
                            const audioPath = await textToSpeech(aiResponse);
                            if (audioPath) {
                                await this.sendAudioMessage(remoteJid, audioPath);
                                limparAudioTemp(audioPath);
                            } else await this.sendMessage(remoteJid, aiResponse);
                        } else {
                            await this.sendMessage(remoteJid, aiResponse);
                        }
                    }
                    if (this.sock) await this.sock.sendPresenceUpdate('available', remoteJid);
                } catch (e) { console.error("Erro IA:", e); }
            });
        } catch (e) { console.error("Erro total:", e); }
    }

    async sendMessage(to: string, text: string) {
        if (!this.sock) return;
        let jid = to.includes('@') ? to : (to.length >= 14 ? `${to}@lid` : `${to}@s.whatsapp.net`);
        await this.sock.sendMessage(jid, { text });
    }

    async sendGeneratedImageMessage(to: string, prompt: string, caption?: string) {
        if (!this.sock) return;
        try {
            const response = await fetch('https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${process.env.HF_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ inputs: prompt })
            });
            if (!response.ok) throw new Error("Erro HF");
            const buffer = Buffer.from(await response.arrayBuffer());
            let jid = to.includes('@') ? to : (to.length >= 14 ? `${to}@lid` : `${to}@s.whatsapp.net`);
            await this.sock.sendMessage(jid, { image: buffer, caption: caption || '✨ Imagem gerada!' });
        } catch (e) { console.error("Erro imagem gerada:", e); await this.sendMessage(to, "Erro ao gerar imagem."); }
    }

    async sendAudioMessage(to: string, audioPath: string) {
        if (!this.sock) return;
        const jid = to.includes('@') ? to : (to.length >= 14 ? `${to}@lid` : `${to}@s.whatsapp.net`);
        const isMp3 = audioPath.endsWith('.mp3');
        await this.sock.sendMessage(jid, {
            audio: fs.readFileSync(audioPath),
            mimetype: isMp3 ? 'audio/mpeg' : 'audio/ogg; codecs=opus',
            ptt: true
        });
    }

    async sendImage(to: string, content: string | Buffer, caption?: string) {
        if (!this.sock) return;
        const jid = to.includes('@') ? to : (to.length >= 14 ? `${to}@lid` : `${to}@s.whatsapp.net`);
        const imageContent = typeof content === 'string' ? { url: content } : content;
        await this.sock.sendMessage(jid, { image: imageContent, caption });
    }
}

export const waService = new WhatsAppService();
