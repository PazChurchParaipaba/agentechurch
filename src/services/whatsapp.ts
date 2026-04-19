import { default as makeWASocket, useMultiFileAuthState, DisconnectReason, WASocket, WAMessage, proto, downloadMediaMessage, Browsers, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as fs from 'fs';
import * as path from 'path';
import { Buffer } from 'buffer';
import pino from 'pino';
import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';
import { supabase } from '../config/supabase';
import { findNearestLife } from '../utils/location';
import { textToSpeech, limparAudioTemp } from './tts';
import PDFDocument from 'pdfkit';

interface UserState {
    type: 'REGISTRATION' | 'QUIZ' | 'WEDDING';
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
    public lastMessageAt: number = Date.now();
    private isReconnecting: boolean = false;
    private watchdogTimer: NodeJS.Timeout | null = null;
    private inactivityTimer: NodeJS.Timeout | null = null;

    public qrCodeString: string | null = null;
    public qrCodeDataUrl: string | null = null;
    public isConnected: boolean = false;
    public connecting: boolean = false;
    private connectionWatchdog: NodeJS.Timeout | null = null;
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
                        this.sock?.sendPresenceUpdate('available').catch(() => {
                            console.log('⚠️ Falha ao atualizar presença, marcando como offline.');
                            this.isConnected = false;
                            this.scheduleReconnect(5000);
                        });
                    } catch (e) {
                        this.isConnected = false;
                        this.scheduleReconnect(5000);
                    }
                } else if (!this.sock || !this.sock.user) {
                    // Se o socket existe mas não tem usuário, algo está errado
                    console.log('⚠️ Socket sem usuário detectado pelo watchdog.');
                    this.isConnected = false;
                    this.scheduleReconnect(5000);
                }
            }
        }, 2 * 60 * 1000); // Check every 2 minutes instead of 3

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

    public async forceReset() {
        console.log('⚠️ Forçando reset geral de conex\u00e3o...');
        this.connecting = false;
        this.isConnected = false;
        this.qrCodeString = null;
        this.qrCodeDataUrl = null;
        this.retryCount = 0;
        this.isReconnecting = false;
        
        if (this.connectionWatchdog) {
            clearTimeout(this.connectionWatchdog);
            this.connectionWatchdog = null;
        }
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.sock) {
            try { this.sock.logout(); } catch(e) {}
            try { this.sock.end(undefined); } catch(e) {}
            this.sock = undefined;
        }

        const authPath = path.resolve(this.authStateStr);
        if (fs.existsSync(authPath)) {
            try { fs.rmSync(authPath, { recursive: true, force: true }); } catch(e) {}
        }
    }

    async connectToWhatsApp() {
        try {
            let version;
            try {
                const latest = await fetchLatestBaileysVersion();
                version = latest.version;
                console.log(`📡 Usando Baileys v${version.join('.')}`);
            } catch (e) {
                console.warn('⚠️ Erro ao buscar vers\u00e3o do WhatsApp, usando fallback...');
                version = [2, 3000, 1015901307]; // Fallback gen\u00e9rico est\u00e1vel
            }

            const { state, saveCreds } = await useMultiFileAuthState(this.authStateStr);

            if (this.sock) {
                try { 
                    this.sock.ev.removeAllListeners('connection.update');
                    this.sock.ev.removeAllListeners('creds.update');
                    this.sock.ev.removeAllListeners('messages.upsert');
                    this.sock.end(undefined); 
                } catch (e) { }
                this.sock = undefined;
            }

            this.sock = makeWASocket({
                logger: pino({ level: 'silent' }), // Alterado para silent para não travar o Koyeb com excesso de logs
                auth: state,
                version,
                browser: ['PazChurch', 'Chrome', '1.0.0'], // Alterado para evitar bloqueios no pareamento
                syncFullHistory: false,
                markOnlineOnConnect: true,
                keepAliveIntervalMs: 30000,
                defaultQueryTimeoutMs: 60000,
                getMessage: async (key) => {
                    return { conversation: 'Mensagem de fallback' };
                }
            });

            this.sock.ev.on('connection.update', async (update: any) => {
                const { connection, lastDisconnect, qr } = update;
                
                if (qr) {
                    this.qrCodeString = qr;
                    this.qrCodeDataUrl = await QRCode.toDataURL(qr);
                    console.log('💠 Novo QR Code gerado.');
                    if (qrcodeTerminal) qrcodeTerminal.generate(qr, { small: true });
                }

                if (connection === 'close') {
                    this.isConnected = false;
                    const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
                    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                    console.log(`❌ Conex\u00e3o fechada. Motivo: ${statusCode || 'Desconhecido'}`);

                    if (statusCode === DisconnectReason.loggedOut) {
                        console.log('🚪 Sess\u00e3o encerrada. Limpando dados de autentica\u00e7\u00e3o...');
                        const authPath = path.resolve(this.authStateStr);
                        if (fs.existsSync(authPath)) {
                            fs.rmSync(authPath, { recursive: true, force: true });
                        }
                        this.qrCodeString = null;
                        this.qrCodeDataUrl = null;
                        this.retryCount = 0;
                    }

                    if (shouldReconnect) {
                        this.retryCount++;
                        const delay = Math.min(10000 * Math.pow(1.5, this.retryCount), 60000);
                        console.log(`⏳ Agendando reconex\u00e3o em ${Math.round(delay/1000)}s... (Tentativa ${this.retryCount})`);
                        this.scheduleReconnect(delay);
                    }
                } else if (connection === 'open') {
                    this.isConnected = true;
                    this.qrCodeString = null;
                    this.qrCodeDataUrl = null;
                    this.retryCount = 0;
                    this.lastMessageAt = Date.now();
                    console.log('✅ WhatsApp conectado com sucesso! 🚀');
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
                        let baseUrl = process.env.SELF_URL ? process.env.SELF_URL.trim().replace(/\/$/, '') : 'http://localhost:3000';
                        if (baseUrl !== 'http://localhost:3000' && !baseUrl.startsWith('http')) {
                            baseUrl = `https://${baseUrl}`;
                        }
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

                const phone = remoteJid.replace(/\D/g, '');
                const isGroup = remoteJid.includes('@g.us');

                const now = new Date();
                const spTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
                const isSunday = spTime.getDay() === 0; // 0 = Domingo
                const dayName = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"][spTime.getDay()];
                const lowerText = textBody ? textBody.toLowerCase() : '';

                // NOVA LÓGICA DE GRUPO: Responder apenas se for mencionado ou se for um comando.
                if (isGroup) {
                    const botJid = this.sock?.user?.id;
                    // a menção pode vir no contextInfo (oficial) ou no texto (manual)
                    const mentionedJid = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                    const isMentioned = mentionedJid.includes(botJid);

                    // Comando /kids: manda o link do Paz Kids (só no grupo)
                    if (lowerText.trim() === '/kids') {
                        let baseUrl = process.env.SELF_URL ? process.env.SELF_URL.trim().replace(/\/$/, '') : 'http://localhost:3000';
                        if (baseUrl !== 'http://localhost:3000' && !baseUrl.startsWith('http')) {
                            baseUrl = `https://${baseUrl}`;
                        }
                        const kidsUrl = `${baseUrl}/pazkids`;
                        await this.sendMessage(remoteJid, `🧒 *Paz Kids – Check-in Infantil*\n\nAcesse o painel de líderes pelo link abaixo:\n\n🔗 ${kidsUrl}\n\n_Cadastre as crianças e gerencie as saídas com QR Code!_ 🙏`);
                        return;
                    }

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
                            const isLid = remoteJid.includes('@lid');
                            if (lowerText.includes('este') && isLid) {
                                await this.sendMessage(remoteJid, "Hmm, no seu caso o WhatsApp escondeu seu número real por segurança (LID). 🙈\n\nPor favor, *digite seu telefone completo com DDD* manualmente para eu salvar seu cadastro certinho!");
                                return;
                            }
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

                    // Lógica de Inscrição Casamento Coletivo
                    if (state && state.type === 'WEDDING') {
                        if (state.step === 'WAITING_COUPLE_NAME') {
                            state.data.couple_names = textBody!.trim();
                            state.step = 'WAITING_PHONE';
                            await this.sendMessage(remoteJid, "2️⃣ Telefone para contato:");
                            return;
                        }
                        if (state.step === 'WAITING_PHONE') {
                            state.data.phone_contact = textBody!.trim();
                            state.step = 'WAITING_CIVIL_STATUS';
                            await this.sendMessage(remoteJid, "3️⃣ Situação do casamento civil:\nDigite o número da opção:\n\n1 - Já somos casados no civil\n2 - Ainda não somos casados no civil");
                            return;
                        }
                        if (state.step === 'WAITING_CIVIL_STATUS') {
                            const opt = textBody!.trim();
                            if (opt === '1' || opt === '2') {
                                state.data.civil_status = opt === '1' ? 'Já casados no civil' : 'Ainda não casados no civil';
                                const { error } = await supabase.from('wedding_registrations').insert([{
                                    couple_names: state.data.couple_names,
                                    phone_contact: state.data.phone_contact,
                                    civil_status: state.data.civil_status,
                                    requester_jid: remoteJid
                                }]);

                                if (error) {
                                    console.error("Erro wedding:", error);
                                    await this.sendMessage(remoteJid, "Erro ao salvar sua inscrição. Por favor, tente novamente mais tarde.");
                                } else {
                                    await this.sendMessage(remoteJid, "Assim que recebermos suas respostas, nossa equipe irá analisar o cadastro e entrar em contato com vocês com mais informações sobre o casamento coletivo.\n\nDeus abençoe essa nova etapa da vida de vocês! 💙");
                                    if (this.LEADER_PHONE) this.sendMessage(this.LEADER_PHONE + '@s.whatsapp.net', `🔔 Nova inscrição Casamento Coletivo: ${state.data.couple_names} (${state.data.phone_contact})`);
                                }
                                delete this.userStates[remoteJid];
                                return;
                            } else {
                                await this.sendMessage(remoteJid, "Por favor, digite 1 ou 2.");
                                return;
                            }
                        }
                    }

                    // Busca hibrida (JID vs Telefone Real) para garantir que reconhecemos ele mesmo se o ID do whatsapp mudar ou for LID
                    const { data: member } = await supabase
                        .from('members_paraipaba')
                        .select('id, name')
                        .or(`phone.eq.${phone},phone_contact.ilike.%${phone}%`)
                        .maybeSingle();

                    // Trigger Casamento Coletivo
                    const isWeddingTrigger = lowerText.includes('casamento coletivo') || (lowerText.includes('casamento') && !member);
                    if (isWeddingTrigger) {
                        const welcomeWedding = `💍 CASAMENTO COLETIVO – PAZ CHURCH\n(27 DE JUNHO/2026)\n\nQue alegria receber o contato de vocês!\nPara iniciar o cadastro do Casamento Coletivo, responda as perguntas abaixo:\n\n1️⃣ Nome do casal:\n(Exemplo: João e Maria)`;
                        await this.sendMessage(remoteJid, welcomeWedding);
                        this.userStates[remoteJid] = {
                            type: 'WEDDING',
                            step: 'WAITING_COUPLE_NAME',
                            data: {},
                            lastInteraction: Date.now(),
                            notifiedInactivity: false
                        };
                        return;
                    }

                    // Fluxo de Cadastro - Humanizado e Otimizado
                    if (!member) {
                        const { getAIResponse } = await import('./ai');
                        
                        // Prompt p/ IA lidar com o primeiro contato de forma humana
                        const introPrompt = `Aja como o Agente da Igreja da Paz Church Paraipaba. Recebemos uma mensagem de um NOVO contato (não cadastrado). 
                        A mensagem dele foi: "${textBody}". 
                        Hoje é ${dayName}. 
                        Gere uma saudação extremamente calorosa, empática e humana. NÃO pareça um robô. 
                        No final, de forma sutil, peça o nome completo dele para que possamos "dar as boas vindas de forma oficial à nossa família".`;

                        const aiGreeting = await getAIResponse(introPrompt, remoteJid);
                        
                        if (isAudioMessage) {
                            const audioPath = await textToSpeech(aiGreeting);
                            if (audioPath) {
                                await this.sendAudioMessage(remoteJid, audioPath);
                                limparAudioTemp(audioPath);
                                await this.sendMessage(remoteJid, "*[Agente da Igreja]* " + aiGreeting);
                            } else {
                                await this.sendMessage(remoteJid, aiGreeting);
                            }
                        } else {
                            await this.sendMessage(remoteJid, aiGreeting);
                        }

                        // Inicia o estado de registro, mas sem o prompt robótico imediato
                        this.userStates[remoteJid] = {
                            type: 'REGISTRATION',
                            step: 'WAITING_NAME',
                            data: {},
                            lastInteraction: Date.now(),
                            notifiedInactivity: false
                        };
                        return;
                    }
                }

                // Menu e Comandos
                if (lowerText === 'oi' || lowerText === 'menu' || lowerText === 'ajuda') {
                    const menu = "Como posso te ajudar hoje?\n\n1️⃣ Horários e Endereço\n2️⃣ Quero doar (Pix)\n3️⃣ Onde tem uma Life?\n4️⃣ Conversar com a IA\n5️⃣ Falar com a Liderança\n\n!oração [pedido] - Pedir oração\n!quiz - Quiz Bíblico";
                    if (isAudioMessage) {
                        const audioPath = await textToSpeech("Olá! Eu sou o assistente da Paz Church Paraipaba. Como posso te ajudar hoje? Você pode escolher uma das opções abaixo ou apenas continuar falando comigo.");
                        if (audioPath) {
                             await this.sendAudioMessage(remoteJid, audioPath);
                             limparAudioTemp(audioPath);
                        }
                    }
                    await this.sendMessage(remoteJid, menu);
                    return;
                }
                if (lowerText === '1') {
                    const msg = `📍 Paz Church Paraipaba - CE.\n⏰ Horário de Culto: Domingo às 17h30.`;
                    if (isAudioMessage) {
                        const audioPath = await textToSpeech("Nós estamos localizados em Paraipaba, Ceará. Nossa Celebração da Família acontece todos os domingos às cinco e meia da tarde. Esperamos você!");
                        if (audioPath) { await this.sendAudioMessage(remoteJid, audioPath); limparAudioTemp(audioPath); }
                    }
                    await this.sendMessage(remoteJid, msg); 
                    return; 
                }
                if (lowerText === '2') {
                    const msg = "🙏 Sua generosidade ajuda o Reino. Chave Pix: (confirme com a secretaria).";
                    if (isAudioMessage) {
                        const audioPath = await textToSpeech("Sua generosidade é muito importante para o Reino de Deus. Para doações via Pix, por favor confirme a chave atual com a nossa secretaria.");
                        if (audioPath) { await this.sendAudioMessage(remoteJid, audioPath); limparAudioTemp(audioPath); }
                    }
                    await this.sendMessage(remoteJid, msg); 
                    return; 
                }
                if (lowerText === '3') { 
                    const msg = "Mande sua localização clicando no clipe 📎 e encontrarei a Life mais próxima! 📍";
                    if (isAudioMessage) {
                        const audioPath = await textToSpeech("Para encontrar a Life Group mais próxima de você, por favor, clique no ícone do clipe e envie sua localização atual.");
                        if (audioPath) { await this.sendAudioMessage(remoteJid, audioPath); limparAudioTemp(audioPath); }
                    }
                    await this.sendMessage(remoteJid, msg); 
                    return; 
                }
                if (lowerText === '5') { 
                    const msg = "Transferindo para a liderança... 🙏";
                    if (isAudioMessage) {
                        const audioPath = await textToSpeech("Entendido. Estou transferindo seu atendimento para um de nossos líderes. Em breve eles entrarão em contato.");
                        if (audioPath) { await this.sendAudioMessage(remoteJid, audioPath); limparAudioTemp(audioPath); }
                    }
                    await this.sendMessage(remoteJid, msg); 
                    if (this.LEADER_PHONE) this.sendMessage(this.LEADER_PHONE + '@s.whatsapp.net', `Atendimento humano solicitado por ${phone}`); 
                    return; 
                }

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

                // --- RELATÓRIO DE PRESENÇA (WIFI + CHECK-IN) ---
                if (lowerText === '!relatorio' || lowerText === '!presenca') {
                    try {
                        // 1. Definir data do último culto (Domingo)
                        const today = new Date();
                        const lastSunday = new Date(today);
                        if (today.getDay() !== 0) { // Se não for domingo, pega o anterior
                            lastSunday.setDate(today.getDate() - today.getDay());
                        }
                        const dateStr = lastSunday.toISOString().split('T')[0];

                        // 2. Buscar Pico de Conexões WiFi
                        const { data: wifiData } = await supabase
                            .from('wifi_attendance')
                            .select('connection_count')
                            .eq('service_date', dateStr);
                        
                        const peakWifi = wifiData && wifiData.length > 0 
                            ? Math.max(...wifiData.map(d => d.connection_count || 0)) 
                            : 0;

                        // 3. Buscar Check-ins Manuais
                        const { count: checkinCount } = await supabase
                            .from('checkin_log')
                            .select('*', { count: 'exact', head: true })
                            .filter('checked_in_at', 'gte', `${dateStr}T00:00:00Z`)
                            .filter('checked_in_at', 'lte', `${dateStr}T23:59:59Z`);

                        // 4. Buscar Paz Kids (atual ou total do dia)
                        const { count: kidsCount } = await supabase
                            .from('children')
                            .select('*', { count: 'exact', head: true });

                        const report = `📊 *RELATÓRIO DE PRESENÇA* 📊\n` +
                            `📅 *Culto:* ${lastSunday.toLocaleDateString('pt-BR')}\n` +
                            `⏰ *Horário:* 17h30\n\n` +
                            `🌐 *Dispositivos no WiFi:* ${peakWifi}\n` +
                            `👤 *Check-ins Manuais:* ${checkinCount || 0}\n` +
                            `🧒 *Paz Kids (Check-in):* ${kidsCount || 0}\n\n` +
                            `📈 *Estimativa Total:* ~${Math.max(peakWifi, (checkinCount || 0) + (kidsCount || 0))} pessoas.\n\n` +
                            `_Este relatório compara os dados da rede com os check-ins oficiais._ 🕊️`;

                        await this.sendMessage(remoteJid, report);
                    } catch (e: any) {
                        console.error('Erro ao gerar relatório:', e);
                        await this.sendMessage(remoteJid, "Desculpe, houve um erro ao processar o relatório de presença. 😰");
                    }
                    return;
                }

                if (msg.message.locationMessage) {
                    const { degreesLatitude, degreesLongitude } = msg.message.locationMessage;
                    if (!degreesLatitude || !degreesLongitude) return;

                    // --- LÓGICA DE CHECK-IN AUTOMÁTICO (FUNCIONALIDADE 5) ---
                    const { churchConfig } = await import('../config/botConfig');
                    const { calculateDistance } = await import('../utils/location');

                    // Verifica se é domingo e se está no horário do culto
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
                    if (isAudioMessage) {
                        contextMessage = `[O USUÁRIO ENVIOU UM ÁUDIO] Responda de forma sucinta e amigável. Hoje é ${dayName}. Contexto: ${contextMessage}`;
                    }
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
                            const pdfPath = path.join(__dirname, `../../temp_tts/pdf_${Date.now()}.pdf`);
                            const doc = new PDFDocument();
                            doc.pipe(fs.createWriteStream(pdfPath));
                            doc.fontSize(20).text(title, { align: 'center' }).moveDown().fontSize(12).text(content);
                            doc.end();
                            
                            // Bufferiza para não depender do disco por muito tempo
                            await new Promise(r => setTimeout(r, 1500));
                            if (this.sock && fs.existsSync(pdfPath)) {
                                await this.sock.sendMessage(remoteJid, { document: fs.readFileSync(pdfPath), fileName: `${title}.pdf`, mimetype: 'application/pdf' });
                                try { fs.unlinkSync(pdfPath); } catch(_) {}
                            }
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
    }
    
    // Helper para evitar hangs (travamentos eternos da conexão wa socket)
    private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage = 'Tempo limite excedido da conexão (Timeout)'): Promise<T> {
        let timeoutId: NodeJS.Timeout;
        const timeoutPromise = new Promise<T>((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
        });
        return Promise.race([
            promise.finally(() => clearTimeout(timeoutId)),
            timeoutPromise
        ]);
    }

    async sendMessage(to: string, text: string) {
        if (!this.sock || !this.isConnected) {
            console.error(`❌ Falha ao enviar mensagem para ${to}: Socket desconectado.`);
            throw new Error('Whatsapp não está conectado.');
        }
        try {
            const jid = await this.resolveJid(to);
            // Timeout de 15 segundos em vez de travar o disparo para sempre
            await this.withTimeout(this.sock.sendMessage(jid, { text }), 15000);
            this.lastMessageAt = Date.now();
        } catch (e: any) {
            console.error(`❌ Erro ao enviar mensagem para ${to}:`, e.message);
            if (e.message.includes('Closed') || e.message.includes('Timeout')) {
                this.isConnected = false;
                this.scheduleReconnect(5000);
            }
            throw e; // Lança o erro para o disparo não computar como sucesso
        }
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

    /**
     * Resolve o JID correto de um número usando sock.onWhatsApp().
     * Isso garante que contas LID (novo padrão WhatsApp) sejam encontradas.
     * Fallback: usa @s.whatsapp.net se a consulta falhar.
     */
    async resolveJid(phone: string): Promise<string> {
        if (phone.includes('@')) return phone; // já é um JID (@s.whatsapp.net ou @g.us)
        
        const clean = phone.replace(/\D/g, '');
        // Adiciona DDI 55 p/ números brasileiros se necessário (10 ou 11 dígitos)
        const normalized = (!clean.startsWith('55') && (clean.length === 10 || clean.length === 11))
            ? '55' + clean : clean;

        // Se o número tiver o formato padrão (DDI + DDD + 8 ou 9 dígitos), já podemos construir o JID.
        // Isso evita o onWhatsApp (rede/CPU) que trava o sistema em broadcasts.
        if (normalized.length >= 10 && normalized.length <= 13) {
            return `${normalized}@s.whatsapp.net`;
        }

        try {
            if (this.sock && normalized.length > 5) { // Evita consulta de números muito curtos
                // Consulta super lenta/pesada: limitamos a 5 segundos para não travar!
                const [result] = await this.withTimeout(this.sock.onWhatsApp(normalized), 5000, 'onWhatsApp timeout');
                if (result?.exists && result.jid) {
                    return result.jid;
                }
            }
        } catch (e: any) {
            console.warn(`⚠️ Erro ao resolver JID para ${normalized}: ${e.message}. Usando fallback de comprimento.`);
        }
        
        return normalized.length >= 14 ? `${normalized}@lid` : `${normalized}@s.whatsapp.net`;
    }

    async sendImage(to: string, content: string | Buffer, caption?: string) {
        if (!this.sock || !this.isConnected) {
            throw new Error('Whatsapp não está conectado.');
        }
        const jid = await this.resolveJid(to);
        const imageContent = typeof content === 'string' ? { url: content } : content;
        try {
            await this.withTimeout(this.sock.sendMessage(jid, { image: imageContent, caption }), 25000); // 25s timeout pra imagem
            this.lastMessageAt = Date.now();
        } catch (e: any) {
            console.error(`❌ Erro ao enviar imagem para ${to}:`, e.message);
            if (e.message.includes('Closed') || e.message.includes('Timeout')) {
                this.isConnected = false;
                this.scheduleReconnect(5000);
            }
            throw e;
        }
    }
}

export const waService = new WhatsAppService();
