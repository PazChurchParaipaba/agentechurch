import cron from 'node-cron';
import { supabase } from '../config/supabase';
import { waService } from './whatsapp';
import { getAIResponse } from './ai';

// Configuração do ID do grupo da igreja via .env ou Hardcoded (Correção solicitada)
const CHURCH_GROUP_ID = process.env.WHATSAPP_GROUP_ID || '120363134268223078@g.us';

// Número do Pastor ou Líder Principal para notificações
const LEADER_PHONE = process.env.LEADER_PHONE || '';

export function initScheduler() {
    console.log('📅 Inicializando agendador de tarefas...');

    // Tarefa 1: Verificar aniversariantes todos os dias às 08:00
    cron.schedule('0 8 * * *', async () => {
        console.log('🔍 Verificando aniversariantes do dia...');
        const today = new Date();
        const day = today.getDate();
        const month = today.getMonth() + 1; // JS months are 0-indexed

        const { data: members, error } = await supabase.from('members_paraipaba').select('*');

        if (error || !members) {
            console.error('Erro ao buscar membros para aniversário:', error);
            return;
        }

        const birthdays = members.filter((m: any) => {
            if (!m.birth_date) return false;
            // Robustez: aceitar Date object ou string YYYY-MM-DD
            const bdate = new Date(m.birth_date);
            // Resetar time para evitar bugs de fuso se vier com T00:00:00.000Z
            return bdate.getUTCDate() === day && (bdate.getUTCMonth() + 1) === month;
        });

        if (birthdays.length === 0) {
            console.log('Nenhum aniversariante hoje.');
            return;
        }

        console.log(`🎉 Encontrados ${birthdays.length} aniversariantes.`);

        // 1. Mandar DM privada para CADA UM
        for (const member of birthdays) {
            if (member.phone) {
                let jid = member.phone;
                if (!jid.includes('@')) {
                    jid = jid.length >= 14 ? `${jid}@lid` : `${jid}@s.whatsapp.net`;
                }

                try {
                    const prompt = `Gere uma mensagem curta e carinhosa de feliz aniversário de 1 parágrafo para o membro "${member.name}" da Paz Church Paraipaba. Use um tom pastoral e amigável. Cite um versículo de benção.`;
                    const aiMsg = await getAIResponse(prompt, member.phone);
                    const msg = aiMsg && !aiMsg.includes("Desculpe") ? aiMsg : `Olá *${member.name}*! Feliz aniversário! 🎉 Que Deus te abençoe ricamente hoje e sempre. Amamos sua vida! ❤️`;

                    await waService.sendMessage(jid, msg);
                } catch (e) {
                    const fallback = `Olá *${member.name}*, a paz! 🕊️\n\nDesejamos um Feliz Aniversário! 🎉🎂 Que o Senhor te abençoe ricamente hoje!`;
                    await waService.sendMessage(jid, fallback);
                }
            }
        }

        // 2. Mandar no Grupo uma Imagem Real Personalizada
        if (CHURCH_GROUP_ID) {
            for (const member of birthdays) {
                try {
                    const prompt = `Gere uma legenda festiva e alegre para um post de aniversário no grupo da igreja para o membro "${member.name}". Use emojis e termine convidando todos a darem parabéns.`;
                    const aiGroupMsg = await getAIResponse(prompt, CHURCH_GROUP_ID);
                    const groupMsg = aiGroupMsg && !aiGroupMsg.includes("Desculpe") ? aiGroupMsg : `🎉 *HOJE É DIA DE FESTA!* 🎉\n\nVamos celebrar a maravilhosa vida do(a) nosso(a) amado(a) *${member.name}*! 🎂🎈 Deixem seus parabéns aqui! 👏👏🎈`;

                    // Montar url da imagem (usando prompt em inglês customizado)
                    const promptImg = `A beautiful 3D birthday celebration card, Christian theme, bright and joyful, luxurious balloons and cake, elegant typography with the text "Feliz Aniversário ${member.name}", high quality, 8k`;

                    // Enviar a imagem com a legenda (via método do whatsapp.ts)
                    await waService.sendGeneratedImageMessage(CHURCH_GROUP_ID, promptImg, groupMsg);
                } catch (e) {
                    console.error("Erro ao enviar aniversário no grupo:", e);
                }
            }
        }
    }, { timezone: "America/Sao_Paulo" });

    // Tarefa 3: Devocional Diário (Melhoria 6) - Todo dia às 06:30
    cron.schedule('30 6 * * *', async () => {
        if (!CHURCH_GROUP_ID) return;

        console.log('📖 Enviando devocional diário...');

        const themes = [
            "Graça e Misericórdia", "Fé em tempos difíceis", "O poder da oração",
            "Amor ao próximo", "Gratidão", "Sabedoria de Provérbios",
            "A alegria do Senhor", "Caminhando com o Espírito Santo",
            "Vencendo o medo", "Propósito de vida em Cristo"
        ];
        const randomTheme = themes[Math.floor(Math.random() * themes.length)];
        const todayStr = new Date().toLocaleDateString('pt-BR');

        // Tentar gerar via IA ou usar lista pré-definida
        try {
            // Prompt para a IA gerar um devocional curto
            const prompt = `Gere um devocional cristão INÉDITO para hoje (${todayStr}) sobre o tema "${randomTheme}". 
            Instruções:
            1. Um título inspirador.
            2. Um versículo bíblico chave (capítulo e versículo).
            3. Uma reflexão prática de 2 a 3 parágrafos curtos.
            4. Uma oração final.
            5. Use poucos emojis, mantenha um tom de conselheiro maduro.
            Não repita textos anteriores.`;

            const devocional = await getAIResponse(prompt, CHURCH_GROUP_ID);

            if (devocional && !devocional.includes("Desculpe") && !devocional.includes("problema técnico")) {
                const msg = `☀️ *BOM DIA FAMÍLIA PAZ!* ☀️\n_Devocional ${todayStr}_\n\n${devocional}\n\nTenha um dia vitorioso em nome de Jesus! 🙏🔥`;
                await waService.sendMessage(CHURCH_GROUP_ID, msg);
            } else {
                // Fallback mais variado baseado no tema
                const fallbackMsg = `☀️ *Bom dia Família!* ☀️\n\nHoje nossa reflexão é sobre *${randomTheme}*.\n\n"O Senhor é bom, um refúgio em tempos de angústia. Ele cuida dos que nele confiam." - Naum 1:7 📖\n\nQue sua manhã seja repleta da presença de Deus! 🙏`;
                await waService.sendMessage(CHURCH_GROUP_ID, fallbackMsg);
            }
        } catch (e) {
            console.error("Erro ao gerar devocional:", e);
        }
    }, { timezone: "America/Sao_Paulo" });

    // Tarefa 6: Lembrete de Culto de Domingo (Domingo às 09:00)
    cron.schedule('0 9 * * 0', async () => {
        if (!CHURCH_GROUP_ID) return;
        const msg = `🚨 *Bom dia Família Paz! Hoje é dia de Celebração!* 🚨\n\nVenha buscar ao Senhor conosco na Casa do Pai! 🔥\n\n📍 Paz Church Paraipaba\n⏰ Horário: 17h30\n\nPrepare seu coração, traga sua família e convide um amigo! 🙏✨`;
        await waService.sendMessage(CHURCH_GROUP_ID, msg);
    }, { timezone: "America/Sao_Paulo" });

    // ---------------------------------------------------------------
    // KEEP-ALIVE: pinga o próprio servidor a cada 10 minutos
    // Impede hibernação no Render free tier (dorme após 15 min idle)
    // Configure SELF_URL=https://seu-app.onrender.com no .env / painel
    // ---------------------------------------------------------------
    const SELF_URL = process.env.SELF_URL;
    if (SELF_URL) {
        console.log(`💓 Keep-alive ativado → pingando ${SELF_URL} a cada 10 min`);
        cron.schedule('*/10 * * * *', async () => {
            try {
                const res = await fetch(`${SELF_URL.replace(/\/$/, '')}/`);
                console.log(`💓 Keep-alive OK (status ${res.status})`);
            } catch (e: any) {
                console.warn(`💔 Keep-alive falhou: ${e.message}`);
            }
        });
    } else {
        console.log('ℹ️ SELF_URL não configurado — keep-alive desativado');
    }
}
