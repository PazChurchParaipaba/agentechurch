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
                const msg = `Olá *${member.name}*, a paz! 🕊️\n\nFeliz aniversário! 🎉🎂\nQue Deus continue te abençoando ricamente neste novo ciclo. Nós da Paz Church amamos você! ❤️`;

                // Lógica de JID inteligente (igual ao whatsapp.ts)
                let jid = member.phone;
                if (!jid.includes('@')) {
                    if (jid.length >= 14) {
                        jid = `${jid}@lid`;
                    } else {
                        jid = `${jid}@s.whatsapp.net`;
                    }
                }

                await waService.sendMessage(jid, msg);
            }
        }

        // 2. Mandar no Grupo uma Imagem Real Personalizada
        if (CHURCH_GROUP_ID) {
            for (const member of birthdays) {
                // Montar o texto do post
                const groupMsg = `🎉 *HOJE É DIA DE FESTA!* 🎉\n\nVamos celebrar a maravilhosa vida do(a) nosso(a) amado(a) *${member.name}*! 🎂🎈\n\nDesejamos que o Senhor derrame chuvas de bênçãos sobre a sua vida, lhe concedendo paz, saúde, alegria e muitos anos de vida na presença dEle!\n\n*"O Senhor te abençoe e te guarde; o Senhor faça resplandecer o seu rosto sobre ti e te conceda paz."* (Números 6:24-26)\n\nDeixem seus parabéns aqui! 👏👏🎈`;

                // Montar url da imagem (usando prompt em inglês customizado)
                const promptImg = `A beautiful 3D birthday celebration card, Christian theme, bright and joyful, luxurious balloons and cake, elegant typography with the text "Feliz Aniversário ${member.name}", high quality, 8k`;

                // Enviar a imagem com a legenda (via método do whatsapp.ts)
                await waService.sendGeneratedImageMessage(CHURCH_GROUP_ID, promptImg, groupMsg);
            }
        }
    }, { timezone: "America/Sao_Paulo" });

    // Tarefa 3: Devocional Diário (Melhoria 6) - Todo dia às 06:30
    cron.schedule('30 6 * * *', async () => {
        if (!CHURCH_GROUP_ID) return;

        console.log('📖 Enviando devocional diário...');

        // Tentar gerar via IA ou usar lista pré-definida
        try {
            const prompt = "Gere um devocional cristão curto (1 parágrafo) com um versículo chave e uma oração. Termine com 'Paz Church Paraipaba'.";
            const devocional = await getAIResponse(prompt, 'system_scheduler');

            if (devocional && !devocional.includes("Desculpe")) {
                const msg = `☀️ *BOM DIA FAMÍLIA PAZ!* ☀️\n\n${devocional}\n\nTenham um dia transbordante! 🙏`;
                await waService.sendMessage(CHURCH_GROUP_ID, msg);
            } else {
                // Fallback se a IA falhar
                const fallbackMsg = `☀️ *Bom dia Família!* ☀️\n\n"Este é o dia que fez o Senhor; regozijemo-nos e alegremo-nos nele." - Salmos 118:24 📖\n\nQue seu dia seja cheio da presença de Deus! 🙏`;
                await waService.sendMessage(CHURCH_GROUP_ID, fallbackMsg);
            }
        } catch (e) {
            console.error("Erro ao gerar devocional:", e);
        }
    }, { timezone: "America/Sao_Paulo" });

    // TADEL - Terça às 18:00
    cron.schedule('0 18 * * 2', async () => {
        if (CHURCH_GROUP_ID) waService.sendMessage(CHURCH_GROUP_ID, `🚨 *TADEL HOJE!* 🚨\n\nÉ dia de treinamento e crescimento espiritual! 🔥\n\n⏰ 19h30\n📍 Rua Antônio Henrique, 363, Centro\n\nEsperamos todos os líderes e vocacionados! 📖`);
    }, { timezone: "America/Sao_Paulo" });

    // Culto de Sexta - Sexta às 18:00
    cron.schedule('0 18 * * 5', async () => {
        if (CHURCH_GROUP_ID) waService.sendMessage(CHURCH_GROUP_ID, `🔥 *CULTO DE SEXTA!* 🔥\n\nVenha buscar a face do Senhor conosco hoje!\n\n⏰ 19h30\n📍 Rua Antônio Henrique, 363, Centro\n\nTraga um convidado! 🙌`);
    }, { timezone: "America/Sao_Paulo" });

    // Culto de Domingo - Domingo às 16:00
    cron.schedule('0 16 * * 0', async () => {
        if (CHURCH_GROUP_ID) waService.sendMessage(CHURCH_GROUP_ID, `💒 *DOMINGO É DIA DE CELEBRAÇÃO!* 💒\n\nNosso culto principal está chegando!\n\n⏰ 17h30\n📍 Rua Antônio Henrique, 363, Centro (Ao lado do Estádio)\n\nVenha em família! ❤️`);
    }, { timezone: "America/Sao_Paulo" });
}
